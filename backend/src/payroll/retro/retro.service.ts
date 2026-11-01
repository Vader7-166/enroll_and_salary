import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Prisma } from "@prisma/client";
import Decimal from "decimal.js";
import { AuditService } from "../../audit/audit.service";
import type { AuthUser } from "../../auth/auth.types";
import { reauthKey, verifyReauthToken } from "../../auth/reauth";
import { cipherText, plainText } from "../../common/data-crypto";
import { PrismaService } from "../../database/prisma.service";
import { ScopeService } from "../../organization/scope.service";
import { PayrollSourceEvents } from "../../payroll-events/payroll-source-events.service";
import { sha256, StageError, type EmployeeResult } from "../payroll-engine";
import type { ConfirmRetroDto, RetroCalculateDto } from "../payroll-adjustments.dto";
import { PayrollService } from "../payroll.service";
import { retroDiff, type SnapshotEmployee, type Totals } from "./retro-diff";

type Db = Prisma.TransactionClient;
const key = (value: Date) => value.toISOString().slice(0, 10);
function fail(kind: "conflict" | "bad" | "forbidden", code: string, message: string, details?: Record<string, unknown>): never {
  const body = { code, message, ...(details ? { details } : {}) };
  throw kind === "conflict" ? new ConflictException(body) : kind === "forbidden" ? new ForbiddenException(body) : new BadRequestException(body);
}

/** Retro differences from a decision effective in locked periods, booked into the open period after confirmation (FR-7.4.2, BR-42, UAT-11). */
@Injectable()
export class RetroService {
  private readonly key: Buffer;
  private readonly reauthKey: Buffer;
  constructor(private readonly prisma: PrismaService, private readonly scope: ScopeService, private readonly audit: AuditService, private readonly payroll: PayrollService, private readonly events: PayrollSourceEvents, config: ConfigService) {
    this.key = Buffer.from(config.getOrThrow<string>("HR_DATA_KEY"), "base64");
    this.reauthKey = reauthKey(config.getOrThrow<string>("HR_DATA_KEY"));
  }

  private assertRole(user: AuthUser) {
    if (!user.roles.includes("KT") || !user.permissions.includes("payroll.adjust")) throw new ForbiddenException("Chỉ KT được cấp quyền mới được tính và xác nhận điều chỉnh hồi tố.");
  }
  private async assertSites(user: AuthUser, siteIds: string[], db: Db = this.prisma) {
    const allowed = (await this.scope.load(user, "payroll.adjust", db)).allowed;
    if (siteIds.some(id => !allowed.has(id))) throw new ForbiddenException("Kỳ lương nằm ngoài phạm vi được phân quyền.");
  }

  async candidates(user: AuthUser, status?: string) {
    this.assertRole(user);
    const allowed = (await this.scope.load(user, "payroll.adjust")).allowed;
    const rows = await this.prisma.retroCandidate.findMany({ where: status ? { status: status as never } : {}, include: { employee: { select: { id: true, code: true, fullName: true } }, decision: { select: { id: true, decisionNumber: true, effectiveFrom: true } }, payrollPeriod: true }, orderBy: [{ createdAt: "desc" }], take: 300 });
    const calculations = await this.prisma.retroCalculation.findMany({ where: { candidateIds: { hasSome: rows.map(row => row.id) } }, orderBy: { createdAt: "desc" }, select: { id: true, status: true, candidateIds: true, createdAt: true } });
    return { items: rows.filter(row => allowed.has(row.payrollPeriod.siteOrgUnitId)).map(row => {
      const latest = calculations.find(item => item.candidateIds.includes(row.id));
      return { id: row.id, status: row.status, note: row.note, employee: row.employee, decision: { id: row.decision.id, decisionNumber: row.decision.decisionNumber, effectiveFrom: key(row.decision.effectiveFrom) }, payrollPeriod: { id: row.payrollPeriod.id, code: row.payrollPeriod.code, dateFrom: key(row.payrollPeriod.dateFrom), dateTo: key(row.payrollPeriod.dateTo) }, calculation: latest ? { id: latest.id, status: latest.status } : null };
    }) };
  }

  /**
   * Replays every locked period touched by the decision (pending candidates of this employee + decision) and stores the
   * difference with DRAFT adjustments for the open period. Locked snapshots are only read; a missing source refuses with no estimate.
   */
  async calculate(user: AuthUser, candidateId: string, dto: RetroCalculateDto, ip?: string) {
    this.assertRole(user);
    const id = await this.prisma.$transaction(async db => {
      const first = await db.retroCandidate.findUnique({ where: { id: candidateId }, include: { decision: true, employee: { select: { id: true, code: true, fullName: true } } } });
      if (!first) throw new NotFoundException("Không tìm thấy ứng viên hồi tố.");
      if (first.status !== "PENDING") fail("conflict", "RETRO_CANDIDATE_RESOLVED", "Ứng viên hồi tố đã được xử lý.");
      const candidates = await db.retroCandidate.findMany({ where: { decisionId: first.decisionId, employeeId: first.employeeId, status: "PENDING" }, include: { payrollPeriod: { include: { payrollSheet: { include: { snapshot: true } } } } }, orderBy: { payrollPeriod: { dateFrom: "asc" } } });
      await this.assertSites(user, candidates.map(row => row.payrollPeriod.siteOrgUnitId), db);
      const periods = [];
      for (const candidate of candidates) {
        const period = candidate.payrollPeriod, snapshot = period.payrollSheet?.snapshot;
        if (!snapshot || period.payrollSheet?.status !== "LOCKED") fail("conflict", "RETRO_SOURCE_UNAVAILABLE", `Kỳ ${period.code} không có snapshot bảng lương đã khóa; không ước lượng chênh lệch.`, { payrollPeriodId: period.id });
        const original = (JSON.parse(plainText(this.key, snapshot.contentCipher, "snapshot bảng lương")) as { employees: SnapshotEmployee[] }).employees.find(row => row.employeeId === first.employeeId);
        if (!original || original.status !== "OK") fail("conflict", "RETRO_SOURCE_UNAVAILABLE", `Snapshot kỳ ${period.code} không có dòng lương hợp lệ của nhân viên.`, { payrollPeriodId: period.id });
        let replay: EmployeeResult;
        try { replay = await this.payroll.replay(db, period, first.employeeId); }
        catch (error) { if (error instanceof StageError) fail("conflict", "RETRO_SOURCE_UNAVAILABLE", error.message, { payrollPeriodId: period.id, cause: error.code }); throw error; }
        if (replay.status !== "OK") fail("conflict", "RETRO_SOURCE_UNAVAILABLE", `Không tái hiện được kỳ ${period.code}: ${replay.errors.map(item => item.message).join("; ")}`, { payrollPeriodId: period.id, errors: replay.errors.map(item => item.code) });
        const { lines, diff } = retroDiff(original, { totals: replay.totals as Totals, lines: replay.lines });
        const withholding = await db.taxWithholding.findFirst({ where: { paymentKey: `payroll:${period.id}:${first.employeeId}`, originalWithholdingId: null }, select: { taxPeriod: true } });
        const amount = new Decimal(diff.gross).minus(diff.insuranceEmployee).minus(diff.unionFee);
        periods.push({ candidateId: candidate.id, periodId: period.id, code: period.code, dateFrom: key(period.dateFrom), dateTo: key(period.dateTo), siteOrgUnitId: period.siteOrgUnitId, taxPeriod: withholding?.taxPeriod ?? null, snapshotHash: snapshot.contentHash, before: original.totals, after: replay.totals, diff, lines,
          adjustment: { kind: amount.isNegative() ? "RETRO_DEDUCT" : "RETRO_PAY", amount: amount.toString(), taxableIncome: diff.gross, insuranceEmployee: diff.insuranceEmployee } });
      }
      const lastOrigin = candidates.at(-1)!.payrollPeriod;
      const target = dto.targetPayrollPeriodId
        ? await db.payrollPeriod.findUnique({ where: { id: dto.targetPayrollPeriodId }, include: { payrollSheet: { select: { status: true } } } })
        : await db.payrollPeriod.findFirst({ where: { siteOrgUnitId: lastOrigin.siteOrgUnitId, status: "OPEN", dateFrom: { gt: lastOrigin.dateTo } }, include: { payrollSheet: { select: { status: true } } }, orderBy: { dateFrom: "asc" } });
      if (!target || target.status !== "OPEN" || target.payrollSheet?.status === "LOCKED" || target.dateFrom <= lastOrigin.dateTo) fail("conflict", "RETRO_TARGET_PERIOD_MISSING", "Chưa có kỳ lương đang mở sau các kỳ gốc để nhận bút toán; tạo kỳ lương mới trước.");
      await this.assertSites(user, [target.siteOrgUnitId], db);
      const previous = await db.retroCalculation.findMany({ where: { status: "CALCULATED", candidateIds: { hasSome: candidates.map(row => row.id) } } });
      for (const row of previous) await this.drop(db, row.id, user.id, "Tính lại");
      const result = { decision: { id: first.decision.id, decisionNumber: first.decision.decisionNumber, effectiveFrom: key(first.decision.effectiveFrom) }, employee: first.employee, target: { id: target.id, code: target.code, dateFrom: key(target.dateFrom), dateTo: key(target.dateTo), expectedPaymentDate: target.expectedPaymentDate ? key(target.expectedPaymentDate) : null },
        periods, total: { gross: periods.reduce((sum, row) => sum.plus(row.diff.gross), new Decimal(0)).toString(), insuranceEmployee: periods.reduce((sum, row) => sum.plus(row.diff.insuranceEmployee), new Decimal(0)).toString(), taxReference: periods.reduce((sum, row) => sum.plus(row.diff.tax), new Decimal(0)).toString(), adjustment: periods.reduce((sum, row) => sum.plus(row.adjustment.amount), new Decimal(0)).toString() } };
      const calculation = await db.retroCalculation.create({ data: { decisionId: first.decisionId, employeeId: first.employeeId, candidateIds: candidates.map(row => row.id), targetPayrollPeriodId: target.id, resultCipher: cipherText(this.key, JSON.stringify(result)), resultHash: sha256(result), createdById: user.id } });
      for (const row of periods.filter(item => !new Decimal(item.adjustment.amount).isZero() || !new Decimal(item.diff.gross).isZero())) {
        const pay = row.adjustment.kind === "RETRO_PAY";
        const explanation = `Kỳ gốc ${row.code} (${row.dateFrom} → ${row.dateTo}) theo quyết định ${first.decision.decisionNumber}: thu nhập ${row.diff.gross}, BH NLĐ ${row.diff.insuranceEmployee}, đoàn phí ${row.diff.unionFee}; thuế kỳ gốc chênh ${row.diff.tax} chỉ tham khảo (kỳ thuế ${row.taxPeriod ?? "?"}), không sửa tờ khai đã nộp.`;
        await db.payrollAdjustment.create({ data: { employeeId: first.employeeId, kind: row.adjustment.kind, status: "DRAFT", label: `${pay ? "Truy lĩnh" : "Truy thu"} lương kỳ ${row.code}`, originPayrollPeriodId: row.periodId, targetPayrollPeriodId: target.id, retroCalculationId: calculation.id, amountCipher: cipherText(this.key, row.adjustment.amount),
          detailCipher: cipherText(this.key, JSON.stringify({ explanation, taxable: { income: row.diff.gross, insuranceEmployee: row.diff.insuranceEmployee }, diff: row.diff, decisionId: first.decisionId, snapshotHash: row.snapshotHash })), sourceType: "RETRO_CANDIDATE", sourceId: row.candidateId, createdById: user.id } });
      }
      await this.audit.record({ actorId: user.id, entityType: "retro_calculation", entityId: calculation.id, action: "CALCULATE", result: "SUCCESS", newValue: { decisionId: first.decisionId, employeeId: first.employeeId, periods: periods.map(row => row.code), target: target.code, adjustment: result.total.adjustment }, ipAddress: ip }, db);
      return calculation.id;
    }, { timeout: 120_000 });
    return this.view(user, id);
  }

  async view(user: AuthUser, id: string) {
    this.assertRole(user);
    const row = await this.prisma.retroCalculation.findUnique({ where: { id }, include: { targetPayrollPeriod: true, createdBy: { select: { displayName: true } }, decidedBy: { select: { displayName: true } }, adjustments: { select: { id: true, kind: true, status: true, label: true, appliedPayrollPeriodId: true } } } });
    if (!row) throw new NotFoundException("Không tìm thấy kết quả tính hồi tố.");
    await this.assertSites(user, [row.targetPayrollPeriod.siteOrgUnitId]);
    return { calculation: { id: row.id, status: row.status, resultHash: row.resultHash, createdBy: row.createdBy.displayName, createdAt: row.createdAt.toISOString(), decidedBy: row.decidedBy?.displayName ?? null, decidedAt: row.decidedAt?.toISOString() ?? null, adjustments: row.adjustments, ...JSON.parse(plainText(this.key, row.resultCipher, "hồi tố")) } };
  }

  /** Discarding leaves no adjustment behind and keeps the candidates pending. */
  private async drop(db: Db, id: string, actorId: string, reason: string) {
    await db.payrollAdjustment.deleteMany({ where: { retroCalculationId: id, status: "DRAFT" } });
    await db.retroCalculation.update({ where: { id }, data: { status: "DISCARDED", decidedById: actorId, decidedAt: new Date() } });
    await this.audit.record({ actorId, entityType: "retro_calculation", entityId: id, action: "DISCARD", result: "SUCCESS", newValue: { reason } }, db);
  }

  async discard(user: AuthUser, id: string) {
    this.assertRole(user);
    await this.prisma.$transaction(async db => {
      await db.$queryRaw`SELECT id FROM retro_calculation WHERE id = ${id}::uuid FOR UPDATE`;
      const row = await db.retroCalculation.findUnique({ where: { id }, include: { targetPayrollPeriod: true } });
      if (!row) throw new NotFoundException("Không tìm thấy kết quả tính hồi tố.");
      await this.assertSites(user, [row.targetPayrollPeriod.siteOrgUnitId], db);
      if (row.status !== "CALCULATED") fail("conflict", "RETRO_CALCULATION_DECIDED", "Kết quả tính đã được xác nhận hoặc hủy.");
      await this.drop(db, id, user.id, "KT không xác nhận");
    });
    return this.view(user, id);
  }

  /** Re-authenticated confirmation books the adjustments into the open period and resolves the candidates (NFR-33). */
  async confirm(user: AuthUser, sessionId: string, id: string, dto: ConfirmRetroDto, ip?: string) {
    this.assertRole(user);
    if (!verifyReauthToken(this.reauthKey, sessionId, dto.reauthToken)) fail("forbidden", "REAUTH_REQUIRED", "Nhập lại mật khẩu để xác nhận bút toán hồi tố.");
    await this.prisma.$transaction(async db => {
      await db.$queryRaw`SELECT id FROM retro_calculation WHERE id = ${id}::uuid FOR UPDATE`;
      const row = await db.retroCalculation.findUnique({ where: { id }, include: { targetPayrollPeriod: { include: { payrollSheet: { select: { status: true } } } }, employee: { select: { code: true } } } });
      if (!row) throw new NotFoundException("Không tìm thấy kết quả tính hồi tố.");
      await this.assertSites(user, [row.targetPayrollPeriod.siteOrgUnitId], db);
      if (row.status !== "CALCULATED") fail("conflict", "RETRO_CALCULATION_DECIDED", "Kết quả tính đã được xác nhận hoặc hủy.");
      if (dto.resultHash !== row.resultHash) fail("conflict", "STALE_REVISION", "Kết quả tính đã thay đổi; tải lại bảng chênh lệch.");
      if (row.targetPayrollPeriod.status !== "OPEN" || row.targetPayrollPeriod.payrollSheet?.status === "LOCKED") fail("conflict", "RETRO_TARGET_PERIOD_MISSING", "Kỳ nhận bút toán đã khóa; tính lại để chọn kỳ đang mở.");
      const pending = await db.retroCandidate.count({ where: { id: { in: row.candidateIds }, status: "PENDING" } });
      if (pending !== row.candidateIds.length) fail("conflict", "RETRO_CANDIDATE_RESOLVED", "Ứng viên hồi tố đã được xử lý ở nơi khác; tính lại.");
      const confirmed = await db.payrollAdjustment.updateMany({ where: { retroCalculationId: id, status: "DRAFT" }, data: { status: "CONFIRMED", confirmedById: user.id, confirmedAt: new Date() } });
      await db.retroCalculation.update({ where: { id }, data: { status: "CONFIRMED", decidedById: user.id, decidedAt: new Date() } });
      await db.retroCandidate.updateMany({ where: { id: { in: row.candidateIds } }, data: { status: "RESOLVED", note: `Đã ghi bút toán vào kỳ ${row.targetPayrollPeriod.code}`, resolvedById: user.id, resolvedAt: new Date() } });
      await this.events.changed(db, { payrollPeriodIds: [row.targetPayrollPeriodId], source: "RETRO_ADJUSTMENT", reason: "Bút toán hồi tố " + row.employee.code, actorId: user.id });
      await this.audit.record({ actorId: user.id, entityType: "retro_calculation", entityId: id, action: "CONFIRM", result: "SUCCESS", newValue: { adjustments: confirmed.count, target: row.targetPayrollPeriod.code, resultHash: row.resultHash }, ipAddress: ip }, db);
    }, { isolationLevel: "Serializable" });
    return this.view(user, id);
  }

  async adjustments(user: AuthUser, status?: string) {
    this.assertRole(user);
    const allowed = (await this.scope.load(user, "payroll.adjust")).allowed;
    const rows = await this.prisma.payrollAdjustment.findMany({ where: status ? { status: status as never } : {}, include: { employee: { select: { id: true, code: true, fullName: true } }, originPayrollPeriod: true, targetPayrollPeriod: { select: { code: true } }, appliedPayrollPeriod: { select: { code: true } } }, orderBy: { createdAt: "desc" }, take: 300 });
    return { items: rows.filter(row => allowed.has(row.originPayrollPeriod.siteOrgUnitId)).map(row => ({ id: row.id, kind: row.kind, status: row.status, label: row.label, employee: row.employee, amount: plainText(this.key, row.amountCipher, "điều chỉnh lương"), explanation: (JSON.parse(plainText(this.key, row.detailCipher, "điều chỉnh lương")) as { explanation: string }).explanation, originPeriod: row.originPayrollPeriod.code, targetPeriod: row.targetPayrollPeriod?.code ?? null, appliedPeriod: row.appliedPayrollPeriod?.code ?? null, createdAt: row.createdAt.toISOString() })) };
  }
}
