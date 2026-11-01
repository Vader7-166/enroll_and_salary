import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, type SiBenefitType } from "@prisma/client";
import Decimal from "decimal.js";
import { createHash } from "node:crypto";
import { AuditService } from "../../audit/audit.service";
import { businessDate } from "../../auth/business-date";
import type { AuthUser } from "../../auth/auth.types";
import { cipherText, plainText } from "../../common/data-crypto";
import { PrismaService } from "../../database/prisma.service";
import { effectiveAt, ScopeService } from "../../organization/scope.service";
import { benefitDayCount, entitlementDays, estimateBenefit, type BenefitType } from "./benefit-rules";

type Db = Prisma.TransactionClient;
const key = (value: Date) => value.toISOString().slice(0, 10);
const date = (value: string, label: string) => {
  const parsed = new Date(value + "T00:00:00Z");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(parsed.getTime()) || key(parsed) !== value) throw new BadRequestException({ code: "DATE_INVALID", message: label + " không hợp lệ." });
  return parsed;
};
const shiftMonth = (month: string, delta: number) => { const [year, value] = month.split("-").map(Number); return new Date(Date.UTC(year, value - 1 + delta, 1)).toISOString().slice(0, 7); };
function fail(kind: "conflict" | "bad" | "forbidden" | "missing", code: string, message: string, details?: Record<string, unknown>): never {
  const body = { code, message, ...(details ? { details } : {}) };
  throw kind === "conflict" ? new ConflictException(body) : kind === "forbidden" ? new ForbiddenException(body) : kind === "missing" ? new NotFoundException(body) : new BadRequestException(body);
}
const MAX_FILE = 5 * 1024 * 1024;
const FILE_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);
export const BENEFIT_LABELS: Record<BenefitType, string> = { SICK: "Ốm đau", CHILD_SICK: "Con ốm", MATERNITY: "Thai sản", PRENATAL: "Khám thai", RECOVERY: "Dưỡng sức phục hồi sức khỏe" };

export interface RecordInput { employeeId?: string; benefitType?: string; documentNumber?: string; facility?: string; dateFrom?: string; dateTo?: string; leaveRequestId?: string; externalContributionMonths?: string; externalEvidence?: string }

/** KT tracking of benefits paid by the social insurance fund (FR-6.4.1, BR-35): estimate with trace, then the actual payout. */
@Injectable()
export class SicknessMaternityService {
  private readonly key: Buffer;
  constructor(private readonly prisma: PrismaService, private readonly scope: ScopeService, private readonly audit: AuditService, config: ConfigService) {
    this.key = Buffer.from(config.getOrThrow<string>("HR_DATA_KEY"), "base64");
  }
  private encrypt(value: unknown) { return cipherText(this.key, JSON.stringify(value)); }

  private async employee(db: Db, user: AuthUser, permission: "insurance.read" | "insurance.manage", employeeId: string) {
    if (!user.roles.includes("KT") || !user.permissions.includes(permission)) fail("forbidden", "FORBIDDEN", "Chỉ KT được quản lý hồ sơ ốm đau, thai sản.");
    const scope = await this.scope.load(user, permission, db);
    const today = businessDate();
    const employee = await db.employee.findFirst({ where: { id: employeeId, assignments: { some: { orgUnitId: { in: [...scope.allowed] }, ...effectiveAt(today) } }, exclusions: { none: { userAccountId: user.id, ...effectiveAt(today) } } },
      select: { id: true, code: true, fullName: true, assignments: { where: { isPrimary: true, ...effectiveAt(today) }, select: { orgUnitId: true } } } });
    if (!employee) fail("forbidden", "OUT_OF_SCOPE", "Nhân viên nằm ngoài phạm vi được phân quyền.");
    return employee;
  }

  private async parameter(db: Db, code: string, at: Date) {
    const row = await db.legalParameter.findFirst({ where: { paramCode: code, scopeKey: "GLOBAL", ...effectiveAt(at) }, orderBy: { effectiveFrom: "desc" } });
    if (!row) fail("conflict", "PARAMETER_MISSING", "Thiếu tham số " + code + " hiệu lực tại " + key(at) + ".");
    return row;
  }

  /** Locked-payroll BHXH months and their insurable salary (the contribution history known to the system). */
  private async contributions(db: Db, employeeId: string, beforeMonth: string) {
    const rows = await db.insuranceContribution.findMany({ where: { employeeId, contributionMonth: { lt: beforeMonth }, payrollEmployee: { sheet: { status: "LOCKED" } } }, orderBy: { contributionMonth: "desc" } });
    const months = new Map<string, string>();
    for (const row of rows) {
      if (!(row.eligible as Record<string, boolean>).BHXH || months.has(row.contributionMonth)) continue;
      const detail = JSON.parse(plainText(this.key, row.detailCipher, "bảo hiểm")) as { salary: { perKind: { BHXH: { value: string } } } | null };
      if (detail.salary) months.set(row.contributionMonth, detail.salary.perKind.BHXH.value);
    }
    return months;
  }

  private async estimate(db: Db, input: { employeeId: string; type: BenefitType; from: Date; to: Date; externalMonths: number; excludeId?: string }) {
    const at = input.from;
    const [rate, standard, bands, child, prenatal, recovery, maternity, minMonths] = await Promise.all([
      this.parameter(db, input.type === "MATERNITY" ? "MATERNITY_BENEFIT_RATE" : "SICKNESS_BENEFIT_RATE", at), this.parameter(db, "SI_BENEFIT_STANDARD_DAYS", at),
      this.parameter(db, "SICKNESS_DAYS_BY_SERVICE", at), this.parameter(db, "CHILD_SICK_DAYS_PER_YEAR", at), this.parameter(db, "PRENATAL_DAYS_PER_YEAR", at),
      this.parameter(db, "RECOVERY_DAYS_PER_YEAR", at), this.parameter(db, "MATERNITY_DAYS", at), this.parameter(db, "MATERNITY_MIN_CONTRIBUTION_MONTHS", at)]);
    const rest = await db.legalParameter.findFirst({ where: { paramCode: "WEEKLY_REST_DAYS", scopeKey: "GLOBAL", ...effectiveAt(at) }, orderBy: { effectiveFrom: "desc" } });
    const restWeekdays = ((rest?.value as { days?: number[] } | null)?.days) ?? [7];
    const month = key(at).slice(0, 7);
    const history = await this.contributions(db, input.employeeId, month);
    const contributionMonths = history.size + input.externalMonths;
    const last12 = [...history.keys()].filter(value => value >= shiftMonth(month, -12)).length;
    const baseMonths = input.type === "MATERNITY" ? [...history.keys()].slice(0, 6) : [...history.keys()].slice(0, 1).filter(value => value === shiftMonth(month, -1));
    const yearStart = new Date(Date.UTC(at.getUTCFullYear(), 0, 1)), yearEnd = new Date(Date.UTC(at.getUTCFullYear(), 11, 31));
    const used = await db.sicknessMaternityRecord.aggregate({ where: { employeeId: input.employeeId, benefitType: input.type as SiBenefitType, dateFrom: { gte: yearStart, lte: yearEnd }, ...(input.excludeId ? { id: { not: input.excludeId } } : {}) }, _sum: { benefitDays: true } });
    const recordDays = benefitDayCount(input.type, key(input.from), key(input.to), restWeekdays);
    const entitlement = entitlementDays(input.type, contributionMonths, { sicknessBands: bands.value as Array<{ fromYears: number; days: number }>, childSick: Number(child.value), prenatal: Number(prenatal.value), recovery: Number(recovery.value), maternity: Number(maternity.value) });
    const result = estimateBenefit({ type: input.type, recordDays, usedThisYear: Number(used._sum.benefitDays ?? 0), entitlement, baseSalaries: baseMonths.map(value => history.get(value)!),
      rate: String(rate.value), standardDays: Number(standard.value), contributionMonthsLast12: last12, maternityMinMonths: Number(minMonths.value) });
    return { ...result, label: "Dự tính", contributionMonths, contributionMonthsSystem: history.size, contributionMonthsExternal: input.externalMonths, baseMonths, restWeekdays,
      parameters: Object.fromEntries([rate, standard, bands, child, prenatal, recovery, maternity, minMonths].map(row => [row.paramCode, row.id])) };
  }

  async create(user: AuthUser, file: Express.Multer.File | undefined, body: RecordInput, ip?: string) {
    if (!user.roles.includes("KT") || !user.permissions.includes("insurance.manage")) fail("forbidden", "FORBIDDEN", "Chỉ KT được quản lý hồ sơ ốm đau, thai sản.");
    const type = body.benefitType as BenefitType;
    if (!["SICK", "CHILD_SICK", "MATERNITY", "PRENATAL", "RECOVERY"].includes(type)) fail("bad", "BENEFIT_TYPE_INVALID", "Loại chế độ không hợp lệ.");
    if (!body.employeeId || !/^[0-9a-f-]{36}$/i.test(body.employeeId)) fail("bad", "EMPLOYEE_REQUIRED", "Chọn nhân viên.");
    if (!body.documentNumber?.trim() || !body.facility?.trim()) fail("bad", "DOCUMENT_REQUIRED", "Nhập số chứng từ và cơ sở y tế.");
    if (!file?.buffer?.length) fail("bad", "EVIDENCE_REQUIRED", "Thiếu tệp chứng từ (giấy chứng nhận nghỉ việc hưởng BHXH, giấy ra viện…).");
    if (file.size > MAX_FILE || !FILE_TYPES.has(file.mimetype)) fail("bad", "EVIDENCE_INVALID", "Chứng từ là PDF/JPEG/PNG tối đa 5 MB.");
    const from = date(body.dateFrom ?? "", "Ngày bắt đầu"), to = date(body.dateTo ?? "", "Ngày kết thúc");
    if (to < from) fail("bad", "DATE_RANGE_INVALID", "Ngày kết thúc phải từ ngày bắt đầu trở đi.");
    const externalMonths = body.externalContributionMonths ? Number(body.externalContributionMonths) : 0;
    if (!Number.isInteger(externalMonths) || externalMonths < 0 || externalMonths > 600) fail("bad", "EXTERNAL_MONTHS_INVALID", "Số tháng đóng BHXH ngoài hệ thống không hợp lệ.");
    if (externalMonths > 0 && !body.externalEvidence?.trim()) fail("bad", "EXTERNAL_EVIDENCE_REQUIRED", "Số tháng đóng ngoài hệ thống cần chứng từ (sổ BHXH…).");
    const created = await this.prisma.$transaction(async db => {
      const employee = await this.employee(db, user, "insurance.manage", body.employeeId!);
      await db.$queryRaw`SELECT id FROM employee WHERE id = ${employee.id}::uuid FOR UPDATE`;
      // The leave type of the benefit must be an SI-paid, document-backed type in force (company or site catalog).
      const versions = await db.leaveTypeVersion.findMany({ where: { leaveType: { code: type }, ...effectiveAt(from) }, include: { leaveType: true } });
      const policy = versions.find(version => version.active && version.siPaid && version.requiresDocument);
      if (!policy) fail("conflict", "POLICY_NOT_EFFECTIVE", "Loại nghỉ " + type + " không có chính sách hưởng BHXH có chứng từ hiệu lực tại ngày bắt đầu.");
      const overlap = await db.sicknessMaternityRecord.findFirst({ where: { employeeId: employee.id, dateFrom: { lte: to }, dateTo: { gte: from } }, select: { id: true, documentNumber: true, dateFrom: true, dateTo: true } });
      if (overlap) fail("conflict", "RECORD_OVERLAP", "Khoảng ngày chồng hồ sơ " + overlap.documentNumber + " (" + key(overlap.dateFrom) + " → " + key(overlap.dateTo) + ").", { recordId: overlap.id });
      if (body.leaveRequestId) {
        const leave = await db.leaveRequest.findUnique({ where: { id: body.leaveRequestId }, include: { leaveType: true } });
        if (!leave || leave.employeeId !== employee.id || leave.status !== "APPROVED" || leave.leaveType.code !== type || leave.dateFrom > from || leave.dateTo < to)
          fail("conflict", "LEAVE_REQUEST_MISMATCH", "Đơn nghỉ liên kết phải đã duyệt, cùng nhân viên, cùng loại và bao trùm khoảng ngày của hồ sơ.");
      }
      const estimate = await this.estimate(db, { employeeId: employee.id, type, from, to, externalMonths });
      const row = await db.sicknessMaternityRecord.create({ data: {
        employeeId: employee.id, benefitType: type, leaveRequestId: body.leaveRequestId ?? null, documentNumber: body.documentNumber!.trim(), facility: body.facility!.trim(), dateFrom: from, dateTo: to,
        externalContributionMonths: externalMonths, externalEvidence: body.externalEvidence?.trim() || null,
        evidenceFileName: file.originalname.slice(0, 255), evidenceContentType: file.mimetype, evidenceSize: file.size, evidenceSha256: createHash("sha256").update(file.buffer).digest("hex"), evidenceCipher: cipherText(this.key, file.buffer.toString("base64")),
        benefitDays: estimate.days, estimateCipher: this.encrypt({ ...estimate, leaveTypeVersionId: policy.id }), estimateStatus: estimate.status, createdById: user.id } });
      await this.audit.record({ actorId: user.id, entityType: "sickness_maternity_record", entityId: row.id, action: "CREATE", result: "SUCCESS",
        newValue: { employeeId: employee.id, type, dateFrom: key(from), dateTo: key(to), documentNumber: row.documentNumber, estimateStatus: estimate.status, evidenceSha256: row.evidenceSha256 }, ipAddress: ip }, db);
      return row.id;
    });
    return this.detail(user, created);
  }

  /** Records the amount the insurance fund actually paid; the estimate stays as recorded. */
  async pay(user: AuthUser, id: string, dto: { revision: number; amount: string; paidDate: string; reference: string }, ip?: string) {
    if (!/^\d{1,15}$/.test(dto.amount)) fail("bad", "AMOUNT_INVALID", "Số tiền BHXH đã chi là số nguyên không âm.");
    const paid = date(dto.paidDate, "Ngày chi");
    await this.prisma.$transaction(async db => {
      const row = await db.sicknessMaternityRecord.findUnique({ where: { id } });
      if (!row) fail("missing", "NOT_FOUND", "Không tìm thấy hồ sơ.");
      await this.employee(db, user, "insurance.manage", row.employeeId);
      if (row.revision !== dto.revision) fail("conflict", "STALE_REVISION", "Hồ sơ đã thay đổi; tải lại.");
      await db.sicknessMaternityRecord.update({ where: { id }, data: { paidAmountCipher: cipherText(this.key, dto.amount), paidDate: paid, paidReference: dto.reference.trim(), paidRecordedById: user.id, revision: { increment: 1 } } });
      await this.audit.record({ actorId: user.id, entityType: "sickness_maternity_record", entityId: id, action: "RECORD_PAYMENT", result: "SUCCESS", newValue: { paidDate: dto.paidDate, reference: dto.reference.trim() }, ipAddress: ip }, db);
    });
    return this.detail(user, id);
  }

  private view(row: Prisma.SicknessMaternityRecordGetPayload<{ include: { employee: { select: { id: true; code: true; fullName: true } } } }>) {
    const estimate = JSON.parse(plainText(this.key, row.estimateCipher, "chế độ BHXH")) as ReturnType<typeof estimateBenefit> & Record<string, unknown>;
    const paid = row.paidAmountCipher ? plainText(this.key, row.paidAmountCipher, "chế độ BHXH") : null;
    return { id: row.id, employee: row.employee, benefitType: row.benefitType, benefitLabel: BENEFIT_LABELS[row.benefitType as BenefitType], leaveRequestId: row.leaveRequestId, documentNumber: row.documentNumber, facility: row.facility,
      dateFrom: key(row.dateFrom), dateTo: key(row.dateTo), externalContributionMonths: row.externalContributionMonths, externalEvidence: row.externalEvidence,
      evidence: { fileName: row.evidenceFileName, contentType: row.evidenceContentType, size: row.evidenceSize, sha256: row.evidenceSha256 }, estimateStatus: row.estimateStatus, estimate,
      paidAmount: paid, paidDate: row.paidDate ? key(row.paidDate) : null, paidReference: row.paidReference,
      difference: paid !== null && estimate.amount !== null ? new Decimal(paid).minus(estimate.amount).toString() : null, revision: row.revision, createdAt: row.createdAt.toISOString() };
  }

  async detail(user: AuthUser, id: string) {
    const row = await this.prisma.sicknessMaternityRecord.findUnique({ where: { id }, include: { employee: { select: { id: true, code: true, fullName: true } } } });
    if (!row) fail("missing", "NOT_FOUND", "Không tìm thấy hồ sơ.");
    await this.employee(this.prisma, user, "insurance.read", row.employeeId);
    return { record: this.view(row) };
  }

  async list(user: AuthUser, query: { employeeId?: string; year?: string }) {
    if (!user.roles.includes("KT") || !user.permissions.includes("insurance.read")) fail("forbidden", "FORBIDDEN", "Chỉ KT được xem hồ sơ ốm đau, thai sản.");
    const scope = await this.scope.load(user, "insurance.read");
    const today = businessDate();
    const year = query.year ? Number(query.year) : null;
    const rows = await this.prisma.sicknessMaternityRecord.findMany({
      where: { ...(query.employeeId ? { employeeId: query.employeeId } : {}), ...(year ? { dateFrom: { gte: new Date(Date.UTC(year, 0, 1)), lte: new Date(Date.UTC(year, 11, 31)) } } : {}),
        employee: { assignments: { some: { orgUnitId: { in: [...scope.allowed] }, ...effectiveAt(today) } }, exclusions: { none: { userAccountId: user.id, ...effectiveAt(today) } } } },
      include: { employee: { select: { id: true, code: true, fullName: true } } }, orderBy: { dateFrom: "desc" }, take: 200 });
    return { items: rows.map(row => this.view(row)) };
  }

  async evidence(user: AuthUser, id: string, ip?: string) {
    const row = await this.prisma.sicknessMaternityRecord.findUnique({ where: { id } });
    if (!row) fail("missing", "NOT_FOUND", "Không tìm thấy hồ sơ.");
    await this.employee(this.prisma, user, "insurance.read", row.employeeId);
    await this.audit.record({ actorId: user.id, entityType: "sickness_maternity_record", entityId: id, action: "DOWNLOAD_EVIDENCE", result: "ALLOWED", ipAddress: ip });
    return { content: Buffer.from(plainText(this.key, row.evidenceCipher, "chứng từ"), "base64"), fileName: row.evidenceFileName, contentType: row.evidenceContentType };
  }
}
