import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import Decimal from "decimal.js";
import { dirname, join } from "node:path";
import PDFDocument from "pdfkit";
import { AuditService } from "../audit/audit.service";
import { businessDate } from "../auth/business-date";
import { NotificationsService } from "../notifications/notifications.service";
import type { AuthUser } from "../auth/auth.types";
import { reauthKey, verifyReauthToken } from "../auth/reauth";
import { cipherText, plainText } from "../common/data-crypto";
import { PrismaService } from "../database/prisma.service";
import { ScopeService } from "../organization/scope.service";
import { PayrollSourceEvents } from "../payroll-events/payroll-source-events.service";
import type { EmployeeResult } from "./payroll-engine";
import { sha256 } from "./payroll-engine";
import type { ApproveDto, LockDto, ReturnDto } from "./payroll.dto";
import { CP_CODES, PayrollService } from "./payroll.service";

type Db = Prisma.TransactionClient;
const key = (date: Date) => date.toISOString().slice(0, 10);
// Operational reminder window for unpaid periods, not a legal deadline (that is FR-7.5.4 late-payment compensation).
const PAYMENT_DUE_WARNING_DAYS = 3;
const FONT = join(dirname(require.resolve("@expo-google-fonts/be-vietnam-pro/package.json")), "400Regular", "BeVietnamPro_400Regular.ttf");
const FONT_BOLD = join(dirname(require.resolve("@expo-google-fonts/be-vietnam-pro/package.json")), "700Bold", "BeVietnamPro_700Bold.ttf");
const CP_TITLE: Record<string, string> = { "CP-01": "Lương dưới mức tối thiểu vùng theo địa điểm", "CP-02": "Lương thử việc dưới 85%", "CP-03": "Vượt trần làm thêm giờ", "CP-04": "Khấu trừ vượt 30% thu nhập", "CP-05": "Thực lĩnh âm", "CP-06": "Còn ngày công lỗi chưa giải trình", "CP-07": "Thuộc diện BH nhưng thiếu lương đóng", "CP-08": "Chênh lệch kỳ trước vượt ngưỡng", "CP-09": "Thu nhập sản phẩm dưới tối thiểu vùng", TAX_EXCEPTION: "Ngoại lệ miễn thuế thiếu căn cứ" };
function fail(kind: "conflict" | "bad" | "forbidden", code: string, message: string, details?: Record<string, unknown>): never {
  const body = { code, message, ...(details ? { details } : {}) };
  throw kind === "conflict" ? new ConflictException(body) : kind === "forbidden" ? new ForbiddenException(body) : new BadRequestException(body);
}

@Injectable()
export class PayrollApprovalService {
  private readonly key: Buffer;
  private readonly reauthKey: Buffer;
  constructor(private readonly prisma: PrismaService, private readonly scope: ScopeService, private readonly audit: AuditService, private readonly payroll: PayrollService, private readonly events: PayrollSourceEvents, private readonly notifications: NotificationsService, config: ConfigService) {
    this.key = Buffer.from(config.getOrThrow<string>("HR_DATA_KEY"), "base64");
    this.reauthKey = reauthKey(config.getOrThrow<string>("HR_DATA_KEY"));
  }

  private async sheetFor(user: AuthUser, id: string, permission: "payroll.read" | "payroll.approve" | "payroll.lock", db: Db = this.prisma) {
    if (!user.roles.includes("KT") || !user.permissions.includes(permission)) throw new ForbiddenException("KT chưa được cấp quyền thao tác này trên bảng lương.");
    const sheet = await db.payrollSheet.findUnique({ where: { id }, include: { payrollPeriod: true } });
    if (!sheet) throw new NotFoundException("Không tìm thấy bảng lương.");
    if (!(await this.scope.load(user, permission, db)).allowed.has(sheet.payrollPeriod.siteOrgUnitId)) throw new ForbiddenException("Kỳ lương nằm ngoài phạm vi được phân quyền.");
    return sheet;
  }

  private async totals(db: Db, sheetId: string) {
    const rows = await db.payrollEmployee.findMany({ where: { sheetId, status: "OK" } });
    const sum = (field: keyof EmployeeResult["totals"]) => rows.reduce((total, row) => total.plus(JSON.parse(plainText(this.key, row.totalsCipher))[field]), new Decimal(0)).toString();
    return { employees: rows.length, gross: sum("gross"), insuranceEmployee: sum("insuranceEmployee"), insuranceEmployer: sum("insuranceEmployer"), tax: sum("tax"), net: sum("net") };
  }

  /** Approval gate: completed fresh run, no ERROR employee, no BLOCKING violation, every CP-08 acknowledged. */
  private async blockers(db: Db, sheet: { id: string; lastRunId: string | null; sourceHash: string | null }) {
    const issues: Array<{ code: string; message: string; employees?: Array<{ id: string; code: string; fullName: string }> }> = [];
    const run = sheet.lastRunId ? await db.payrollRun.findUnique({ where: { id: sheet.lastRunId } }) : null;
    if (!run || run.status !== "COMPLETED" || run.sourceHash !== sheet.sourceHash) issues.push({ code: "PAYROLL_NOT_CALCULATED", message: "Bảng lương chưa có lần tính hoàn tất khớp nguồn hiện hành." });
    const errors = await db.payrollEmployee.findMany({ where: { sheetId: sheet.id, status: "ERROR" }, include: { employee: { select: { id: true, code: true, fullName: true } } } });
    if (errors.length) issues.push({ code: "PAYROLL_EMPLOYEE_ERRORS", message: `${errors.length} nhân viên còn lỗi tính lương.`, employees: errors.map(row => row.employee) });
    if (sheet.lastRunId) {
      const results = await db.complianceCheckResult.findMany({ where: { runId: sheet.lastRunId } });
      for (const row of results) {
        if (row.severity === "BLOCKING" && row.violationCount > 0) issues.push({ code: row.code, message: `${row.code}: ${row.violationCount} vi phạm chặn duyệt.` });
        if (row.severity === "WARNING") {
          const acknowledged = new Set((row.acknowledgements as Array<{ employeeId: string }>).map(ack => ack.employeeId));
          const pending = row.employeeIds.filter(id => !acknowledged.has(id));
          if (pending.length) issues.push({ code: "CP-08_PENDING", message: `${pending.length} cảnh báo CP-08 chưa được xác nhận.` });
        }
      }
    }
    return issues;
  }

  /** Daily job: periods paying within PAYMENT_DUE_WARNING_DAYS without a paid salary batch alert the site KT. */
  async notifyPaymentsDue(asOf = businessDate()) {
    const until = new Date(asOf.getTime() + PAYMENT_DUE_WARNING_DAYS * 86400000);
    const periods = await this.prisma.payrollPeriod.findMany({
      where: { expectedPaymentDate: { gte: asOf, lte: until }, salaryPaymentItems: { none: { active: true, batch: { status: "PAID" } } } },
      select: { id: true, code: true, siteOrgUnitId: true, expectedPaymentDate: true, payrollSheet: { select: { status: true } } },
    });
    for (const period of periods) {
      const due = key(period.expectedPaymentDate!);
      await this.notifications.emit({ type: "PAYROLL_PAYMENT_DUE", linkKey: "payroll", roles: ["KT"], permission: "payroll.payment", scopeOrgUnitId: period.siteOrgUnitId,
        payload: { payrollPeriodId: period.id, expectedPaymentDate: due, sheetStatus: period.payrollSheet?.status ?? null }, dedupeKey: "PAYROLL_PAYMENT_DUE:" + period.id + ":" + due,
        title: "Kỳ lương " + period.code + " đến hạn chi ngày " + due + " (bảng lương: " + (period.payrollSheet?.status ?? "chưa lập") + ")" });
    }
    return periods.length;
  }

  async approve(user: AuthUser, id: string, dto: ApproveDto, ip?: string) {
    return this.prisma.$transaction(async db => {
      const sheet = await this.sheetFor(user, id, "payroll.approve", db);
      await db.$queryRaw`SELECT id FROM payroll_sheet WHERE id = ${id}::uuid FOR UPDATE`;
      if (sheet.status !== "DRAFT") fail("conflict", "PAYROLL_SHEET_NOT_DRAFT", "Chỉ bảng lương nháp mới được duyệt.");
      if (sheet.revision !== dto.revision) fail("conflict", "STALE_REVISION", "Bảng lương đã thay đổi; tải lại trước khi duyệt.");
      const issues = await this.blockers(db, sheet);
      if (issues.length) fail("conflict", "PAYROLL_APPROVAL_BLOCKED", "Chưa đủ điều kiện duyệt: " + issues.map(issue => issue.message).join(" "), { issues });
      const totals = await this.totals(db, id);
      const updated = await db.payrollSheet.update({ where: { id }, data: { status: "APPROVED", approvedSourceHash: sheet.sourceHash, approvedAt: new Date(), approvedById: user.id, revision: { increment: 1 }, updatedAt: new Date() } });
      await db.payrollSheetHistory.create({ data: { sheetId: id, action: "APPROVE", fromStatus: "DRAFT", toStatus: "APPROVED", revision: updated.revision, sourceHash: sheet.sourceHash, totalsCipher: cipherText(this.key, JSON.stringify(totals)), reason: dto.note?.trim() || null, actorId: user.id } });
      await this.audit.record({ actorId: user.id, entityType: "payroll_sheet", entityId: id, action: "APPROVE", result: "SUCCESS", newValue: { revision: updated.revision, sourceHash: sheet.sourceHash, employees: totals.employees }, ipAddress: ip }, db);
      return { status: updated.status, revision: updated.revision, sourceHash: updated.sourceHash };
    }, { isolationLevel: "Serializable" });
  }

  async returnToDraft(user: AuthUser, id: string, dto: ReturnDto, ip?: string) {
    return this.prisma.$transaction(async db => {
      const sheet = await this.sheetFor(user, id, "payroll.approve", db);
      if (sheet.status !== "APPROVED") fail("conflict", "PAYROLL_SHEET_NOT_APPROVED", "Chỉ bảng lương đã duyệt mới trả về nháp.");
      if (sheet.revision !== dto.revision) fail("conflict", "STALE_REVISION", "Bảng lương đã thay đổi; tải lại trước khi thao tác.");
      await this.events.returnToDraft(db, id, user.id, dto.reason.trim());
      void ip;
      return { status: "DRAFT", revision: sheet.revision + 1 };
    }, { isolationLevel: "Serializable" });
  }

  /**
   * One-way atomic lock (FR-7.5.2): re-authenticated KT, same revision, attendance sources still LOCKED, current
   * source hash equal to the approved one (else back to DRAFT), previous site period locked unless initial.
   */
  async lock(user: AuthUser, sessionId: string, id: string, dto: LockDto, ip?: string) {
    if (!verifyReauthToken(this.reauthKey, sessionId, dto.reauthToken)) fail("forbidden", "REAUTH_REQUIRED", "Nhập lại mật khẩu để khóa kỳ lương.");
    const drafted = await this.prisma.$transaction(async db => {
      const sheet = await this.sheetFor(user, id, "payroll.lock", db);
      await db.$queryRaw`SELECT id FROM payroll_sheet WHERE id = ${id}::uuid FOR UPDATE`;
      await db.$queryRaw`SELECT id FROM payroll_period WHERE id = ${sheet.payrollPeriodId}::uuid FOR UPDATE`;
      if (sheet.status === "LOCKED") fail("conflict", "PAYROLL_SHEET_LOCKED", "Kỳ lương đã khóa và không thể khóa lại hay mở khóa.");
      if (sheet.status !== "APPROVED") fail("conflict", "PAYROLL_SHEET_NOT_APPROVED", "Chỉ bảng lương đã duyệt mới được khóa.");
      if (sheet.revision !== dto.revision) fail("conflict", "STALE_REVISION", "Bảng lương đã thay đổi; tải lại trước khi khóa.");
      const current = await this.payroll.currentSourceHashes(db, sheet.payrollPeriod);
      const run = await db.payrollRun.findUniqueOrThrow({ where: { id: sheet.lastRunId! } });
      if (current.sourceHash !== sheet.approvedSourceHash || current.paramSnapshotHash !== run.paramSnapshotHash) {
        await this.events.returnToDraft(db, id, user.id, "Hash nguồn khi khóa khác lúc duyệt", "AUTO_DRAFT");
        return { drafted: true, current };
      }
      const previous = await db.payrollPeriod.findFirst({ where: { siteOrgUnitId: sheet.payrollPeriod.siteOrgUnitId, dateTo: { lt: sheet.payrollPeriod.dateFrom } }, orderBy: { dateTo: "desc" } });
      if (!sheet.payrollPeriod.isInitial && previous && previous.status !== "LOCKED") fail("conflict", "PREV_PERIOD_NOT_LOCKED", `Kỳ lương trước ${previous.code} cùng cơ sở chưa khóa.`, { previousPeriodId: previous.id });
      const employees = await db.payrollEmployee.findMany({ where: { sheetId: id }, include: { lines: { orderBy: { lineNo: "asc" } }, employee: { select: { code: true, fullName: true } } }, orderBy: { employeeId: "asc" } });
      const adjustments = await this.payroll.pendingAdjustments(db, employees.filter(row => row.status === "OK").map(row => row.employeeId), sheet.payrollPeriod);
      const compliance = await db.complianceCheckResult.findMany({ where: { runId: sheet.lastRunId! }, orderBy: { code: "asc" } });
      const complianceSummary = compliance.map(row => ({ code: row.code, severity: row.severity, violationCount: row.violationCount, acknowledged: (row.acknowledgements as unknown[]).length }));
      const parameters = { versionSet: run.versionSet, paramSnapshotHash: run.paramSnapshotHash, attendanceLocks: run.attendanceLocks, ...(await this.legalParameters(db, sheet.payrollPeriod.dateTo)) };
      const content = {
        period: { id: sheet.payrollPeriod.id, code: sheet.payrollPeriod.code, siteOrgUnitId: sheet.payrollPeriod.siteOrgUnitId, dateFrom: key(sheet.payrollPeriod.dateFrom), dateTo: key(sheet.payrollPeriod.dateTo), expectedPaymentDate: sheet.payrollPeriod.expectedPaymentDate ? key(sheet.payrollPeriod.expectedPaymentDate) : null },
        sheet: { id, revision: sheet.revision, runId: sheet.lastRunId, sourceHash: sheet.sourceHash },
        employees: employees.map(row => ({ employeeId: row.employeeId, code: row.employee.code, fullName: row.employee.fullName, status: row.status, sourceHash: row.sourceHash, totals: JSON.parse(plainText(this.key, row.totalsCipher)),
          units: (JSON.parse(plainText(this.key, row.detailCipher)) as { unitWork?: unknown[] }).unitWork ?? [],
          lines: row.lines.map(line => ({ lineNo: line.lineNo, lineType: line.lineType, label: line.label, componentCode: line.componentCode, sourceReference: line.sourceReference, quantity: (JSON.parse(plainText(this.key, line.traceCipher)) as { quantity?: string | null }).quantity ?? null, amount: plainText(this.key, line.amountCipher) })) })),
        adjustmentIds: adjustments.map(row => row.item.id).sort(),
        compliance: complianceSummary, parameters,
      };
      const contentHash = sha256(content);
      const snapshot = await db.payrollSnapshot.create({ data: { sheetId: id, contentCipher: cipherText(this.key, JSON.stringify(content)), contentHash, sourceHash: sheet.sourceHash!, compliance: complianceSummary as Prisma.InputJsonValue, parameters: parameters as Prisma.InputJsonValue, complianceResultIds: compliance.map(row => row.id), lockedById: user.id } });
      const totals = await this.totals(db, id);
      const updated = await db.payrollSheet.update({ where: { id }, data: { status: "LOCKED", lockedAt: snapshot.lockedAt, lockedById: user.id, revision: { increment: 1 }, updatedAt: new Date() } });
      await db.payrollPeriod.update({ where: { id: sheet.payrollPeriodId }, data: { status: "LOCKED" } });
      const withholdings = await db.taxWithholding.findMany({ where: { payrollPeriodId: sheet.payrollPeriodId, status: "DRAFT", originalWithholdingId: null } });
      for (const row of withholdings) await db.taxWithholding.update({ where: { id: row.id }, data: { status: "LOCKED", updatedAt: new Date() } });
      await this.deductionUsage(db, withholdings);
      if (adjustments.length) await db.payrollAdjustment.updateMany({ where: { id: { in: adjustments.map(row => row.item.id) } }, data: { appliedPayrollPeriodId: sheet.payrollPeriodId, appliedAt: snapshot.lockedAt } });
      await db.payrollSheetHistory.create({ data: { sheetId: id, action: "LOCK", fromStatus: "APPROVED", toStatus: "LOCKED", revision: updated.revision, sourceHash: sheet.sourceHash, totalsCipher: cipherText(this.key, JSON.stringify(totals)), reason: dto.note?.trim() || null, actorId: user.id } });
      await this.audit.record({ actorId: user.id, entityType: "payroll_sheet", entityId: id, action: "LOCK", result: "SUCCESS", newValue: { snapshotId: snapshot.id, contentHash, revision: updated.revision, payrollPeriodId: sheet.payrollPeriodId, withholdings: withholdings.length, adjustmentsApplied: adjustments.length }, ipAddress: ip }, db);
      return { drafted: false, snapshot: { id: snapshot.id, contentHash, lockedAt: snapshot.lockedAt.toISOString() }, revision: updated.revision };
    }, { isolationLevel: "Serializable", timeout: 120_000 });
    if (drafted.drafted) fail("conflict", "PAYROLL_SOURCE_CHANGED", "Nguồn bảng lương đã thay đổi sau khi duyệt; bảng lương đã về Nháp, cần tính và duyệt lại.");
    return drafted;
  }

  /** Annual deduction usage (medical/education, voluntary pension, charity) accumulates only when payroll locks. */
  private async deductionUsage(db: Db, withholdings: Array<{ employeeId: string; taxPeriod: string; detailCipher: string }>) {
    for (const row of withholdings) {
      const detail = JSON.parse(plainText(this.key, row.detailCipher)) as { deductions?: Record<string, string> };
      const year = Number(row.taxPeriod.slice(0, 4));
      for (const [kind, field] of [["MEDICAL_EDUCATION", "medicalEducation"], ["VOLUNTARY_PENSION", "voluntaryPension"], ["CHARITY", "charity"]] as const) {
        const amount = new Decimal(detail.deductions?.[field] ?? 0);
        if (amount.isZero()) continue;
        const existing = await db.taxDeductionUsage.findUnique({ where: { employeeId_taxYear_kind: { employeeId: row.employeeId, taxYear: year, kind } } });
        const used = new Decimal(existing ? plainText(this.key, existing.usedAmountCipher) : 0).plus(amount).toString();
        await db.taxDeductionUsage.upsert({ where: { employeeId_taxYear_kind: { employeeId: row.employeeId, taxYear: year, kind } }, update: { usedAmountCipher: cipherText(this.key, used), updatedAt: new Date() }, create: { employeeId: row.employeeId, taxYear: year, kind, usedAmountCipher: cipherText(this.key, used) } });
      }
    }
  }

  private async legalParameters(db: Db, at: Date) {
    const rows = await db.legalParameter.findMany({ where: { paramCode: { in: ["MIN_WAGE_MONTH_I", "MIN_WAGE_MONTH_II", "MIN_WAGE_MONTH_III", "MIN_WAGE_MONTH_IV", "PROBATION_MIN_RATIO", "OT_MONTH_MAX_MINUTES", "DEDUCTION_MAX_NET_RATIO", "PAYROLL_VARIANCE_THRESHOLD", "PAYROLL_STANDARD_WORKDAYS", "BASE_SALARY_MONTH"] }, scopeKey: "GLOBAL", effectiveFrom: { lte: at }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: at } }] }, orderBy: { paramCode: "asc" } });
    return { legalParameters: rows.map(row => ({ id: row.id, paramCode: row.paramCode, value: row.value, effectiveFrom: key(row.effectiveFrom), legalBasis: row.legalBasis })) };
  }

  async history(user: AuthUser, id: string) {
    const sheet = await this.sheetFor(user, id, "payroll.read");
    const rows = await this.prisma.payrollSheetHistory.findMany({ where: { sheetId: id }, include: { actor: { select: { id: true, displayName: true } } }, orderBy: { createdAt: "desc" } });
    const snapshot = await this.prisma.payrollSnapshot.findUnique({ where: { sheetId: id }, include: { lockedBy: { select: { id: true, displayName: true } } } });
    const blockers = sheet.status === "DRAFT" ? await this.blockers(this.prisma, sheet) : [];
    return {
      status: sheet.status, revision: sheet.revision, approvedSourceHash: sheet.approvedSourceHash, blockers,
      snapshot: snapshot && { id: snapshot.id, contentHash: snapshot.contentHash, lockedAt: snapshot.lockedAt.toISOString(), lockedBy: snapshot.lockedBy, compliance: snapshot.compliance },
      items: rows.map(row => ({ id: row.id, action: row.action, fromStatus: row.fromStatus, toStatus: row.toStatus, revision: row.revision, sourceHash: row.sourceHash, reason: row.reason, actor: row.actor, createdAt: row.createdAt.toISOString(), totals: row.totalsCipher ? JSON.parse(plainText(this.key, row.totalsCipher)) : null })),
    };
  }

  /** UAT-20: compliance evidence PDF rebuilt from the locked snapshot only (never recalculated). */
  async complianceReport(user: AuthUser, id: string, ip?: string): Promise<Buffer> {
    const sheet = await this.sheetFor(user, id, "payroll.read");
    const snapshot = await this.prisma.payrollSnapshot.findUnique({ where: { sheetId: id }, include: { lockedBy: { select: { displayName: true } } } });
    if (sheet.status !== "LOCKED" || !snapshot) fail("conflict", "PAYROLL_NOT_LOCKED", "Chỉ kỳ lương đã khóa mới có bằng chứng tuân thủ.");
    const site = await this.prisma.orgUnitVersion.findFirst({ where: { orgUnitId: sheet.payrollPeriod.siteOrgUnitId }, orderBy: { effectiveFrom: "desc" } });
    const compliance = snapshot!.compliance as Array<{ code: string; severity: string; violationCount: number; acknowledged: number }>;
    const parameters = snapshot!.parameters as { legalParameters?: Array<{ paramCode: string; value: unknown; effectiveFrom: string; legalBasis: string }>; versionSet?: { rulesets?: string[] } };
    const document = new PDFDocument({ size: "A4", margin: 48, info: { Title: "Bằng chứng tuân thủ kỳ lương " + sheet.payrollPeriod.code, Subject: "payroll-compliance-evidence", Keywords: "snapshot-sha256:" + snapshot!.contentHash, Author: "HRTP" } });
    const chunks: Buffer[] = [];
    document.on("data", chunk => chunks.push(chunk));
    const done = new Promise<Buffer>(resolve => document.on("end", () => resolve(Buffer.concat(chunks))));
    document.registerFont("regular", FONT); document.registerFont("bold", FONT_BOLD);
    document.font("bold").fontSize(16).text("BẰNG CHỨNG TUÂN THỦ KỲ LƯƠNG");
    document.moveDown(0.5).font("regular").fontSize(10);
    for (const [label, value] of [["Kỳ lương", `${sheet.payrollPeriod.code} (${key(sheet.payrollPeriod.dateFrom)} → ${key(sheet.payrollPeriod.dateTo)})`], ["Cơ sở", site?.name ?? sheet.payrollPeriod.siteOrgUnitId], ["Thời điểm khóa", snapshot!.lockedAt.toISOString()], ["Người khóa", snapshot!.lockedBy.displayName], ["Mã băm snapshot (SHA-256)", snapshot!.contentHash], ["Mã băm nguồn", snapshot!.sourceHash], ["Bộ quy tắc thuế", (parameters.versionSet?.rulesets ?? []).join(", ")]])
      document.font("bold").text(label + ": ", { continued: true }).font("regular").text(String(value));
    document.moveDown().font("bold").fontSize(12).text("Kết quả kiểm tra CP-01…CP-09");
    document.font("regular").fontSize(10);
    for (const code of CP_CODES) {
      const row = compliance.find(item => item.code === code) ?? { code, severity: code === "CP-08" ? "WARNING" : "BLOCKING", violationCount: 0, acknowledged: 0 };
      const result = row.violationCount === 0 ? "ĐẠT" : row.severity === "WARNING" ? `CẢNH BÁO ${row.violationCount} (đã xác nhận ${row.acknowledged})` : `VI PHẠM ${row.violationCount}`;
      document.text(`${code} — ${CP_TITLE[code] ?? code}: ${result} [${row.severity === "WARNING" ? "Cảnh báo" : "Chặn"}]`);
    }
    document.moveDown().font("bold").fontSize(12).text("Tham số pháp lý đã áp dụng");
    document.font("regular").fontSize(9);
    for (const parameter of parameters.legalParameters ?? []) document.text(`${parameter.paramCode} = ${JSON.stringify(parameter.value)} (hiệu lực ${parameter.effectiveFrom}) — ${parameter.legalBasis}`);
    document.moveDown().fontSize(8).text("Báo cáo dựng từ snapshot bất biến của kỳ lương đã khóa; không tính lại. Dữ liệu mô phỏng, không phải hồ sơ doanh nghiệp thật.");
    document.end();
    await this.audit.record({ actorId: user.id, entityType: "payroll_snapshot", entityId: snapshot!.id, action: "EXPORT_COMPLIANCE_PDF", result: "SUCCESS", ipAddress: ip });
    return done;
  }
}
