import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, type TerminationReason } from "@prisma/client";
import Decimal from "decimal.js";
import { createHash } from "node:crypto";
import { AuditService } from "../audit/audit.service";
import { businessDate } from "../auth/business-date";
import type { AuthUser } from "../auth/auth.types";
import { reauthKey, verifyReauthToken } from "../auth/reauth";
import { cipherText, plainText } from "../common/data-crypto";
import { PrismaService } from "../database/prisma.service";
import { fundTotals } from "../leave/leave-fund-engine";
import { effectiveAt, ScopeService } from "../organization/scope.service";
import { PayrollSourceEvents } from "../payroll-events/payroll-source-events.service";
import { salaryTimeline, unitSegments } from "../salary-decisions/salary-timeline";
import { InsuranceChangesService } from "../social-insurance/changes/insurance-changes.service";
import { allowance, averageSalary, unusedLeavePay, workedMonths } from "./termination-rules";

type Db = Prisma.TransactionClient;
const DAY = 86400000;
const date = (value: string) => new Date(value + "T00:00:00.000Z");
const key = (value: Date) => value.toISOString().slice(0, 10);
function fail(kind: "conflict" | "bad" | "forbidden" | "missing", code: string, message: string, details?: Record<string, unknown>): never {
  const body = { code, message, ...(details ? { details } : {}) };
  throw kind === "conflict" ? new ConflictException(body) : kind === "forbidden" ? new ForbiddenException(body) : kind === "missing" ? new NotFoundException(body) : new BadRequestException(body);
}
/** Reasons that carry an allowance (BLLĐ 2019 Điều 46, 47); the others pay none. */
const ALLOWANCE_OF: Record<TerminationReason, "SEVERANCE" | "JOB_LOSS" | "NONE"> = { RESIGNATION: "SEVERANCE", CONTRACT_EXPIRY: "SEVERANCE", MUTUAL_AGREEMENT: "SEVERANCE", JOB_LOSS: "JOB_LOSS", OTHER: "NONE" };
export type AlertKind = "EXPIRING" | "OVERDUE" | "PROBATION_ENDING" | "FIXED_TERM_LIMIT";

export interface TerminationInput { employeeId: string; decisionNumber: string; effectiveDate: string; reason: TerminationReason; legalBasis: string; note?: string; externalUnemploymentMonths?: number; externalUnemploymentEvidence?: string }

@Injectable()
export class TerminationService {
  private readonly key: Buffer;
  private readonly reauthKey: Buffer;
  constructor(private readonly prisma: PrismaService, private readonly scope: ScopeService, private readonly audit: AuditService, private readonly events: PayrollSourceEvents,
    private readonly insurance: InsuranceChangesService, config: ConfigService) {
    this.key = Buffer.from(config.getOrThrow<string>("HR_DATA_KEY"), "base64");
    this.reauthKey = reauthKey(config.getOrThrow<string>("HR_DATA_KEY"));
  }
  private encrypt(value: unknown) { return cipherText(this.key, JSON.stringify(value)); }

  private async parameter(db: Db, code: string, at: Date, fallback?: string): Promise<{ id: string | null; value: string }> {
    const row = await db.legalParameter.findFirst({ where: { paramCode: code, scopeKey: "GLOBAL", subjectType: "ALL", ...effectiveAt(at) }, orderBy: { effectiveFrom: "desc" } });
    if (!row && fallback === undefined) fail("conflict", "PARAMETER_MISSING", "Thiếu tham số " + code + " hiệu lực tại " + key(at) + ".");
    return { id: row?.id ?? null, value: row ? String(row.value) : fallback! };
  }

  /** KT with the permission whose scope (on the business date and the given date) contains the employee. */
  private async employee(db: Db, user: AuthUser, permission: "contract.read" | "contract.manage", employeeId: string, at: Date) {
    if (!user.roles.includes("KT")) fail("forbidden", "FORBIDDEN", "Chỉ KT được xử lý cảnh báo và chấm dứt hợp đồng.");
    const [current, dated] = await Promise.all([this.scope.load(user, permission, db), this.scope.load(user, permission, db, at)]);
    const visible = (scope: typeof current, day: Date): Prisma.EmployeeWhereInput => ({ assignments: { some: { ...effectiveAt(day), orgUnitId: { in: [...scope.allowed] } } }, exclusions: { none: { userAccountId: user.id, ...effectiveAt(day) } } });
    const employee = await db.employee.findFirst({ where: { id: employeeId, AND: [visible(current, current.asOf), visible(dated, at)] }, select: { id: true, code: true, fullName: true, hireDate: true, terminationDate: true, status: true } });
    if (!employee) fail("forbidden", "OUT_OF_SCOPE", "Nhân viên nằm ngoài phạm vi được phân quyền.");
    return employee;
  }

  // ---- Alerts (FR-2.4.1, 2.4.2; BR-58): a query, never a state change ----

  async alerts(user: AuthUser, query: { days?: string }) {
    if (!user.roles.includes("KT")) fail("forbidden", "FORBIDDEN", "Chỉ KT được xem cảnh báo hợp đồng.");
    const today = businessDate();
    const scope = await this.scope.load(user, "contract.read");
    const configured = await this.parameter(this.prisma, "CONTRACT_EXPIRY_WARNING_DAYS", today, "30");
    const days = query.days ? Number(query.days) : Number(configured.value);
    if (![30, 60].includes(days)) fail("bad", "ALERT_DAYS_INVALID", "Ngưỡng cảnh báo chỉ nhận 30 hoặc 60 ngày.");
    const maxFixed = Number((await this.parameter(this.prisma, "FIXED_TERM_MAX_COUNT", today, "2")).value);
    const until = new Date(today.getTime() + days * DAY);
    const employees = await this.prisma.employee.findMany({
      where: { status: "ACTIVE", assignments: { some: { ...effectiveAt(today), orgUnitId: { in: [...scope.allowed] } } }, exclusions: { none: { userAccountId: user.id, ...effectiveAt(today) } } },
      select: { id: true, code: true, fullName: true, contracts: { where: { status: "ACTIVE" }, orderBy: { startDate: "asc" }, select: { id: true, number: true, type: true, startDate: true, endDate: true, terminatedOn: true } },
        assignments: { where: { isPrimary: true, ...effectiveAt(today) }, select: { orgUnit: { select: { code: true } } } } },
      orderBy: { code: "asc" },
    });
    const items: Array<{ kind: AlertKind; employee: { id: string; code: string; fullName: string; unitCode: string | null }; contract: { id: string; number: string; type: string; startDate: string; endDate: string | null }; daysLeft: number | null; message: string }> = [];
    for (const employee of employees) {
      const person = { id: employee.id, code: employee.code, fullName: employee.fullName, unitCode: employee.assignments[0]?.orgUnit.code ?? null };
      const view = (contract: (typeof employee.contracts)[number]) => ({ id: contract.id, number: contract.number, type: contract.type, startDate: key(contract.startDate), endDate: contract.endDate ? key(contract.endDate) : null });
      const live = employee.contracts.filter(contract => !contract.terminatedOn);
      // The contract in force (or most recently ended) is what an alert is about.
      const current = live.filter(contract => contract.startDate <= until).at(-1);
      if (current?.endDate) {
        const daysLeft = Math.round((current.endDate.getTime() - today.getTime()) / DAY);
        const probation = current.type === "PROBATION";
        const newer = live.some(contract => contract.startDate > current.endDate!);
        if (!newer && daysLeft < 0) items.push({ kind: "OVERDUE", employee: person, contract: view(current), daysLeft, message: (probation ? "Thử việc" : "Hợp đồng") + " đã quá hạn " + -daysLeft + " ngày, chưa có hợp đồng tiếp theo." });
        else if (!newer && current.endDate <= until) items.push({ kind: probation ? "PROBATION_ENDING" : "EXPIRING", employee: person, contract: view(current), daysLeft, message: (probation ? "Thử việc kết thúc" : "Hợp đồng hết hạn") + " sau " + daysLeft + " ngày." });
      }
      // Consecutive fixed-term contracts since the last indefinite one (BR-58).
      let fixed = 0;
      for (const contract of employee.contracts) fixed = contract.type === "INDEFINITE" ? 0 : contract.type === "FIXED_TERM" ? fixed + 1 : fixed;
      const lastFixed = [...employee.contracts].reverse().find(contract => contract.type === "FIXED_TERM");
      if (fixed >= maxFixed && lastFixed && !employee.contracts.some(contract => contract.type === "INDEFINITE" && contract.startDate > lastFixed.startDate))
        items.push({ kind: "FIXED_TERM_LIMIT", employee: person, contract: view(lastFixed), daysLeft: lastFixed.endDate ? Math.round((lastFixed.endDate.getTime() - today.getTime()) / DAY) : null,
          message: "Đã ký " + fixed + " hợp đồng xác định thời hạn liên tiếp; lần ký tiếp theo phải là hợp đồng không xác định thời hạn." });
    }
    const order: Record<AlertKind, number> = { OVERDUE: 0, PROBATION_ENDING: 1, EXPIRING: 2, FIXED_TERM_LIMIT: 3 };
    items.sort((left, right) => order[left.kind] - order[right.kind] || (left.daysLeft ?? 9999) - (right.daysLeft ?? 9999));
    return { asOf: key(today), days, fixedTermMaxCount: maxFixed, items };
  }

  // ---- Termination preview (pure read) ----

  async preview(db: Db, input: TerminationInput) {
    const effective = date(input.effectiveDate);
    const employee = await db.employee.findUniqueOrThrow({ where: { id: input.employeeId }, select: { id: true, code: true, fullName: true, hireDate: true } });
    if (effective < employee.hireDate) fail("bad", "TERMINATION_BEFORE_HIRE", "Ngày chấm dứt trước ngày vào làm.");
    const contract = await db.employmentContract.findFirst({ where: { employeeId: employee.id, status: "ACTIVE", terminatedOn: null, startDate: { lte: effective }, OR: [{ endDate: null }, { endDate: { gte: new Date(effective.getTime() - 366 * DAY) } }] }, orderBy: { startDate: "desc" } });
    if (!contract) fail("conflict", "NO_ACTIVE_CONTRACT", "Không có hợp đồng hiệu lực để chấm dứt tại ngày đã chọn.");
    const [unit] = (await unitSegments(db, employee.id, effective, effective));
    if (!unit?.siteOrgUnitId) fail("conflict", "NO_SITE", "Không xác định được cơ sở của nhân viên tại ngày chấm dứt.");
    const allowanceKind = ALLOWANCE_OF[input.reason];
    const parameters: Record<string, string | null> = {};
    const param = async (code: string, fallback?: string) => { const row = await this.parameter(db, code, effective, fallback); parameters[code] = row.id; return row.value; };

    // Average contract salary of the configured months ending with the termination month (BLLĐ Điều 46 khoản 3).
    const averageMonths = Number(await param("SEVERANCE_SALARY_AVERAGE_MONTHS"));
    const months: Array<{ month: string; at: string; amount: string }> = [];
    for (let back = averageMonths - 1; back >= 0; back--) {
      const start = new Date(Date.UTC(effective.getUTCFullYear(), effective.getUTCMonth() - back, 1));
      const end = back === 0 ? effective : new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
      if (end < employee.hireDate) continue;
      const segments = (await salaryTimeline(db, this.key, employee.id, end, end)).filter(segment => segment.salaryBasis === "MONTHLY");
      if (!segments.length) continue;
      months.push({ month: key(start).slice(0, 7), at: key(end), amount: segments.reduce((total, segment) => total.plus(segment.amount), new Decimal(0)).toString() });
    }
    const average = averageSalary(months.map(row => row.amount));
    const finalSalary = months.at(-1)?.amount ?? "0";

    // Service time: worked − BHTN participation (locked payroll + KT-entered external months) − time already paid.
    const worked = workedMonths(key(employee.hireDate), input.effectiveDate);
    const bhtn = await db.$queryRaw<{ months: number }[]>`
      SELECT COUNT(DISTINCT c.contribution_month)::int AS months FROM insurance_contribution c
      JOIN payroll_employee e ON e.id = c.payroll_employee_id JOIN payroll_sheet s ON s.id = e.sheet_id
      WHERE c.employee_id = ${employee.id}::uuid AND s.status = 'LOCKED' AND (c.eligible->>'BHTN')::boolean AND c.contribution_month <= ${input.effectiveDate.slice(0, 7)}`;
    const systemUnemployment = bhtn[0]?.months ?? 0;
    const externalUnemployment = input.externalUnemploymentMonths ?? 0;
    const paid = await db.severanceAllowance.aggregate({ where: { employeeId: employee.id }, _sum: { serviceMonths: true } });
    const service = { workedMonths: worked, unemploymentMonthsSystem: systemUnemployment, unemploymentMonthsExternal: externalUnemployment,
      externalEvidence: input.externalUnemploymentEvidence?.trim() || null, previouslyPaidMonths: paid._sum.serviceMonths ?? 0 };
    let severance: (ReturnType<typeof allowance> & { kind: "SEVERANCE" | "JOB_LOSS"; monthsPerYear: string; averageSalary: string }) | null = null;
    if (allowanceKind !== "NONE") {
      const monthsPerYear = await param(allowanceKind === "SEVERANCE" ? "SEVERANCE_MONTHS_PER_YEAR" : "JOB_LOSS_MONTHS_PER_YEAR");
      const minimumMonths = allowanceKind === "JOB_LOSS" ? await param("JOB_LOSS_MIN_MONTHS") : null;
      const result = allowance({ kind: allowanceKind, workedMonths: worked, unemploymentMonths: systemUnemployment + externalUnemployment, previouslyPaidMonths: service.previouslyPaidMonths,
        averageSalary: average, monthsPerYear, minimumMonths, halfFrom: Number(await param("SEVERANCE_HALF_YEAR_FROM_MONTHS")), fullFrom: Number(await param("SEVERANCE_FULL_YEAR_FROM_MONTHS")) });
      severance = { kind: allowanceKind, monthsPerYear, averageSalary: average, ...result };
    }

    // Unused annual leave at the termination date, paid at that day's daily rate (FR-6.2.3, BR-36).
    const year = effective.getUTCFullYear();
    const balance = await db.leaveBalance.findUnique({ where: { employeeId_year: { employeeId: employee.id, year } }, include: { entries: { include: { operation: { select: { effectiveDate: true } } } } } });
    const leaveDays = balance ? fundTotals(balance.entries, year, effective).availableDays : "0";
    const standardWorkdays = (await db.legalParameter.findFirst({ where: { paramCode: "PAYROLL_STANDARD_WORKDAYS", scopeKey: { in: ["SITE:" + unit.siteId, "GLOBAL"] }, ...effectiveAt(effective) }, orderBy: [{ scopeKey: "desc" }, { effectiveFrom: "desc" }] }))?.value;
    if (!standardWorkdays) fail("conflict", "PARAMETER_MISSING", "Thiếu tham số PAYROLL_STANDARD_WORKDAYS.");
    const unusedLeave = { year, standardWorkdays: String(standardWorkdays), monthlySalary: finalSalary, ...unusedLeavePay(leaveDays, finalSalary, String(standardWorkdays)) };

    const insuranceDecrease = await this.insurance.terminationPreview(db, employee.id, input.effectiveDate);
    const period = await db.payrollPeriod.findFirst({ where: { siteOrgUnitId: unit.siteOrgUnitId, status: "OPEN", dateTo: { gte: effective } }, orderBy: { dateFrom: "asc" }, select: { id: true, code: true, dateFrom: true, dateTo: true } });
    const preview = {
      employee: { id: employee.id, code: employee.code, fullName: employee.fullName, hireDate: key(employee.hireDate) },
      effectiveDate: input.effectiveDate, reason: input.reason, allowanceKind,
      contract: { id: contract.id, number: contract.number, type: contract.type, startDate: key(contract.startDate), endDate: contract.endDate ? key(contract.endDate) : null },
      site: { orgUnitId: unit.siteOrgUnitId, unitCode: unit.orgUnitCode },
      salary: { months, average, final: finalSalary }, service, allowance: severance, unusedLeave,
      insuranceDecrease: insuranceDecrease ? { type: insuranceDecrease.type, reason: insuranceDecrease.reason, effectiveDate: insuranceDecrease.effectiveDate, base: insuranceDecrease.old.base?.BHXH ?? null } : null,
      payrollPeriod: period ? { id: period.id, code: period.code, dateFrom: key(period.dateFrom), dateTo: key(period.dateTo) } : null,
      parameters,
    };
    return { preview, hash: createHash("sha256").update(JSON.stringify(preview)).digest("hex") };
  }

  private normalize(dto: TerminationInput): TerminationInput {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dto.effectiveDate) || key(date(dto.effectiveDate)) !== dto.effectiveDate) fail("bad", "DATE_INVALID", "Ngày chấm dứt không hợp lệ.");
    const external = dto.externalUnemploymentMonths ?? 0;
    if (external > 0 && !dto.externalUnemploymentEvidence?.trim()) fail("bad", "EVIDENCE_REQUIRED", "Số tháng BHTN ngoài hệ thống cần chứng từ.");
    return { ...dto, decisionNumber: dto.decisionNumber.trim(), legalBasis: dto.legalBasis.trim(), note: dto.note?.trim() || undefined, externalUnemploymentMonths: external, externalUnemploymentEvidence: dto.externalUnemploymentEvidence?.trim() || undefined };
  }

  private view(row: Prisma.TerminationDecisionGetPayload<{ include: { createdBy: { select: { displayName: true } }; confirmedBy: { select: { displayName: true } } } }>) {
    return { id: row.id, employeeId: row.employeeId, decisionNumber: row.decisionNumber, effectiveDate: key(row.effectiveDate), reason: row.reason, allowanceKind: row.allowanceKind, legalBasis: row.legalBasis,
      note: row.note, externalUnemploymentMonths: row.externalUnemploymentMonths, externalUnemploymentEvidence: row.externalUnemploymentEvidence, status: row.status, revision: row.revision,
      previewHash: row.previewHash, preview: JSON.parse(plainText(this.key, row.previewCipher, "chấm dứt hợp đồng")), createdBy: row.createdBy.displayName, createdAt: row.createdAt.toISOString(),
      confirmedBy: row.confirmedBy?.displayName ?? null, confirmedAt: row.confirmedAt?.toISOString() ?? null, cancelledAt: row.cancelledAt?.toISOString() ?? null, cancelReason: row.cancelReason };
  }
  private readonly include = { createdBy: { select: { displayName: true } }, confirmedBy: { select: { displayName: true } } } as const;

  /** Saves only the decision inputs and the preview snapshot: no contract, employee, payroll or insurance change (UAT-27). */
  async createDraft(user: AuthUser, dto: TerminationInput, ip?: string) {
    const input = this.normalize(dto);
    return this.prisma.$transaction(async db => {
      await this.employee(db, user, "contract.manage", input.employeeId, date(input.effectiveDate));
      if (await db.terminationDecision.findFirst({ where: { employeeId: input.employeeId, status: { in: ["DRAFT", "CONFIRMED"] } }, select: { id: true } }))
        fail("conflict", "TERMINATION_EXISTS", "Nhân viên đã có quyết định chấm dứt nháp hoặc đã xác nhận.");
      const { preview, hash } = await this.preview(db, input);
      const row = await db.terminationDecision.create({ data: { employeeId: input.employeeId, decisionNumber: input.decisionNumber, effectiveDate: date(input.effectiveDate), reason: input.reason, allowanceKind: preview.allowanceKind,
        legalBasis: input.legalBasis, note: input.note ?? null, externalUnemploymentMonths: input.externalUnemploymentMonths!, externalUnemploymentEvidence: input.externalUnemploymentEvidence ?? null,
        previewCipher: this.encrypt(preview), previewHash: hash, createdById: user.id }, include: this.include });
      await this.audit.record({ actorId: user.id, entityType: "termination_decision", entityId: row.id, action: "CREATE_DRAFT", result: "SUCCESS", newValue: { employeeId: input.employeeId, decisionNumber: input.decisionNumber, effectiveDate: input.effectiveDate, reason: input.reason, previewHash: hash }, ipAddress: ip }, db);
      return { decision: this.view(row) };
    });
  }

  /** Recomputes the preview of a draft (e.g. after leave or salary data changed) so KT reviews current numbers. */
  async refresh(user: AuthUser, id: string, dto: { revision: number }, ip?: string) {
    return this.prisma.$transaction(async db => {
      const row = await this.draft(db, user, id, dto.revision);
      const { preview, hash } = await this.preview(db, this.inputOf(row));
      const updated = await db.terminationDecision.update({ where: { id }, data: { previewCipher: this.encrypt(preview), previewHash: hash, revision: { increment: 1 } }, include: this.include });
      await this.audit.record({ actorId: user.id, entityType: "termination_decision", entityId: id, action: "REFRESH_PREVIEW", result: "SUCCESS", oldValue: { previewHash: row.previewHash }, newValue: { previewHash: hash }, ipAddress: ip }, db);
      return { decision: this.view(updated) };
    });
  }

  private inputOf(row: { employeeId: string; decisionNumber: string; effectiveDate: Date; reason: TerminationReason; legalBasis: string; note: string | null; externalUnemploymentMonths: number; externalUnemploymentEvidence: string | null }): TerminationInput {
    return { employeeId: row.employeeId, decisionNumber: row.decisionNumber, effectiveDate: key(row.effectiveDate), reason: row.reason, legalBasis: row.legalBasis, note: row.note ?? undefined,
      externalUnemploymentMonths: row.externalUnemploymentMonths, externalUnemploymentEvidence: row.externalUnemploymentEvidence ?? undefined };
  }

  private async draft(db: Db, user: AuthUser, id: string, revision: number) {
    await db.$queryRaw`SELECT id FROM termination_decision WHERE id = ${id}::uuid FOR UPDATE`;
    const row = await db.terminationDecision.findUnique({ where: { id } });
    if (!row) fail("missing", "NOT_FOUND", "Không tìm thấy quyết định chấm dứt.");
    await this.employee(db, user, "contract.manage", row.employeeId, row.effectiveDate);
    if (row.status !== "DRAFT") fail("conflict", "TERMINATION_NOT_DRAFT", row.status === "CONFIRMED" ? "Quyết định đã được xác nhận; không xác nhận lại." : "Quyết định đã hủy.");
    if (row.revision !== revision) fail("conflict", "STALE_REVISION", "Quyết định đã thay đổi; tải lại trước khi thao tác.");
    return row;
  }

  /**
   * One transaction (FR-2.5.2, BR-59): re-authenticated KT, preview recomputed and equal to the reviewed snapshot,
   * contract and employee marked terminated, allowance + payment items into the site's nearest open payroll period
   * once (unique per decision and kind), approved sheets back to draft, audit.
   */
  async confirm(user: AuthUser, sessionId: string, id: string, dto: { revision: number; previewHash: string; reauthToken: string }, ip?: string) {
    if (!verifyReauthToken(this.reauthKey, sessionId, dto.reauthToken)) fail("forbidden", "REAUTH_REQUIRED", "Nhập lại mật khẩu để xác nhận chấm dứt hợp đồng.");
    return this.prisma.$transaction(async db => {
      const row = await this.draft(db, user, id, dto.revision);
      if (row.previewHash !== dto.previewHash) fail("conflict", "STALE_PREVIEW", "Bản xem trước đã thay đổi; tải lại trước khi xác nhận.");
      const { preview, hash } = await this.preview(db, this.inputOf(row));
      if (hash !== row.previewHash) fail("conflict", "PREVIEW_CHANGED", "Dữ liệu nguồn đã đổi so với bản xem trước; làm mới xem trước và rà soát lại.", { previewHash: hash });
      await db.$queryRaw`SELECT id FROM employee WHERE id = ${row.employeeId}::uuid FOR UPDATE`;
      await db.employmentContract.update({ where: { id: preview.contract.id }, data: { terminatedOn: row.effectiveDate, terminationDecisionId: row.id } });
      await db.employee.update({ where: { id: row.employeeId }, data: { terminationDate: row.effectiveDate, status: "TERMINATED" } });
      const items: Array<{ kind: "SEVERANCE" | "JOB_LOSS" | "UNUSED_LEAVE_PAY"; label: string; amount: string; detail: Record<string, unknown> }> = [];
      if (preview.allowance && new Decimal(preview.allowance.amount).gt(0)) {
        await db.severanceAllowance.create({ data: { decisionId: row.id, employeeId: row.employeeId, allowanceKind: preview.allowance.kind, serviceMonths: preview.allowance.countedMonths,
          detailCipher: this.encrypt({ ...preview.allowance, service: preview.service, salary: preview.salary }), amountCipher: cipherText(this.key, preview.allowance.amount) } });
        items.push({ kind: preview.allowance.kind, label: preview.allowance.kind === "SEVERANCE" ? "Trợ cấp thôi việc" : "Trợ cấp mất việc làm", amount: preview.allowance.amount, detail: { years: preview.allowance.years, averageSalary: preview.allowance.averageSalary, monthsPerYear: preview.allowance.monthsPerYear, minimumApplied: preview.allowance.minimumApplied } });
      }
      if (new Decimal(preview.unusedLeave.amount).gt(0))
        items.push({ kind: "UNUSED_LEAVE_PAY", label: "Tiền phép năm chưa nghỉ", amount: preview.unusedLeave.amount, detail: { days: preview.unusedLeave.days, dailyRate: preview.unusedLeave.dailyRate, year: preview.unusedLeave.year } });
      for (const item of items) await db.terminationPaymentItem.create({ data: { decisionId: row.id, employeeId: row.employeeId, siteOrgUnitId: preview.site.orgUnitId, kind: item.kind, label: item.label,
        amountCipher: cipherText(this.key, item.amount), detailCipher: this.encrypt(item.detail), payrollPeriodId: preview.payrollPeriod?.id ?? null } });
      const confirmed = await db.terminationDecision.update({ where: { id }, data: { status: "CONFIRMED", confirmedAt: new Date(), confirmedById: user.id, revision: { increment: 1 } }, include: this.include });
      if (preview.payrollPeriod) await this.events.changed(db, { payrollPeriodIds: [preview.payrollPeriod.id], source: "TERMINATION", reason: "Chấm dứt HĐ " + row.decisionNumber, actorId: user.id });
      await this.audit.record({ actorId: user.id, entityType: "termination_decision", entityId: id, action: "CONFIRM", result: "SUCCESS",
        newValue: { employeeId: row.employeeId, contractId: preview.contract.id, effectiveDate: preview.effectiveDate, previewHash: hash, payrollPeriodId: preview.payrollPeriod?.id ?? null, items: items.map(item => item.kind) }, ipAddress: ip }, db);
      return { decision: this.view(confirmed), items: items.map(item => ({ kind: item.kind, label: item.label, amount: item.amount, payrollPeriod: preview.payrollPeriod })) };
      // The decision row lock serializes confirmers: the loser waits, then sees CONFIRMED (TERMINATION_NOT_DRAFT).
    }, { timeout: 60_000 });
  }

  /** A cancelled draft leaves no business data behind: the row only records that it was abandoned. */
  async cancel(user: AuthUser, id: string, dto: { revision: number; reason: string }, ip?: string) {
    if (!dto.reason.trim()) fail("bad", "REASON_REQUIRED", "Nhập lý do hủy quyết định.");
    return this.prisma.$transaction(async db => {
      await this.draft(db, user, id, dto.revision);
      const row = await db.terminationDecision.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: dto.reason.trim(), revision: { increment: 1 } }, include: this.include });
      await this.audit.record({ actorId: user.id, entityType: "termination_decision", entityId: id, action: "CANCEL", result: "SUCCESS", newValue: { reason: dto.reason.trim() }, ipAddress: ip }, db);
      return { decision: this.view(row) };
    });
  }

  async list(user: AuthUser, query: { status?: string }) {
    if (!user.roles.includes("KT")) fail("forbidden", "FORBIDDEN", "Chỉ KT được xem quyết định chấm dứt.");
    const scope = await this.scope.load(user, "contract.read");
    const today = businessDate();
    const rows = await this.prisma.terminationDecision.findMany({
      where: { ...(query.status ? { status: query.status as "DRAFT" } : {}), employee: { assignments: { some: { orgUnitId: { in: [...scope.allowed] }, effectiveFrom: { lte: today } } }, exclusions: { none: { userAccountId: user.id, ...effectiveAt(today) } } } },
      include: { ...this.include, employee: { select: { code: true, fullName: true } } }, orderBy: { createdAt: "desc" }, take: 100,
    });
    return { items: rows.map(row => ({ ...this.view(row), employee: { id: row.employeeId, code: row.employee.code, fullName: row.employee.fullName } })) };
  }

  async detail(user: AuthUser, id: string) {
    const row = await this.prisma.terminationDecision.findUnique({ where: { id }, include: { ...this.include, paymentItems: { include: { payrollPeriod: { select: { code: true } } } } } });
    if (!row) fail("missing", "NOT_FOUND", "Không tìm thấy quyết định chấm dứt.");
    await this.employee(this.prisma, user, "contract.read", row.employeeId, row.effectiveDate);
    return { decision: this.view(row), items: row.paymentItems.map(item => ({ id: item.id, kind: item.kind, label: item.label, amount: plainText(this.key, item.amountCipher, "chấm dứt hợp đồng"), payrollPeriod: item.payrollPeriod?.code ?? null })) };
  }
}
