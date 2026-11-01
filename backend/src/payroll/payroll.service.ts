import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, type PayrollPeriod } from "@prisma/client";
import Decimal from "decimal.js";
import { AuditService } from "../audit/audit.service";
import { businessDate } from "../auth/business-date";
import type { AuthUser } from "../auth/auth.types";
import { cipherText, plainText } from "../common/data-crypto";
import { PrismaService } from "../database/prisma.service";
import { effectiveAt, ScopeService } from "../organization/scope.service";
import { OvertimePayService } from "../overtime-pay/overtime-pay.service";
import type { PayBucket } from "../overtime-pay/overtime-pay-engine";
import { PitService } from "../personal-income-tax/pit.service";
import { PayrollSourceEvents } from "../payroll-events/payroll-source-events.service";
import type { Ruleset } from "../personal-income-tax/pit-engine";
import { salaryTimeline, unitSegments } from "../salary-decisions/salary-timeline";
import { SocialInsuranceService } from "../social-insurance/social-insurance.service";
import { calculateEmployee, contextHash, sha256, StageError, unitWork, type ComponentFlags, type EmployeeContext, type EmployeeResult, type InputLine, type BonusItem, type BenefitItem, type TerminationPayItem, type Hooks, type PendingAdjustment, type PlanVersion, type Violation } from "./payroll-engine";
import type { AcknowledgeDto, StartRunDto } from "./payroll.dto";

type Db = Prisma.TransactionClient;
const DAY = 86_400_000;
const CHUNK = 200;
export const CP_CODES = ["CP-01", "CP-02", "CP-03", "CP-04", "CP-05", "CP-06", "CP-07", "CP-08", "CP-09", "TAX_EXCEPTION"] as const;
const key = (date: Date) => date.toISOString().slice(0, 10);
const date = (text: string) => new Date(text + "T00:00:00.000Z");
function fail(kind: "conflict" | "bad", code: string, message: string, details?: Record<string, unknown>): never {
  const body = { code, message, ...(details ? { details } : {}) };
  throw kind === "conflict" ? new ConflictException(body) : new BadRequestException(body);
}
type Snapshot = { teams?: Array<{ days?: Array<{ employee: { id: string }; workDate: string; workUnits: string; workedMinutes: number; status: string; correctionId: string | null }> }>; payrollTime?: { regular: Array<{ employeeId: string; workDate: string; segments: Array<{ startAt: string; endAt: string }> }> } };

@Injectable()
export class PayrollService {
  private readonly key: Buffer;
  private readonly logger = new Logger(PayrollService.name);
  constructor(
    private readonly prisma: PrismaService, private readonly scope: ScopeService, private readonly audit: AuditService,
    private readonly overtimePay: OvertimePayService, private readonly insurance: SocialInsuranceService, private readonly pit: PitService,
    private readonly events: PayrollSourceEvents,
    config: ConfigService,
  ) {
    this.key = Buffer.from(config.getOrThrow<string>("HR_DATA_KEY"), "base64");
  }

  private encrypt(value: unknown) { return cipherText(this.key, JSON.stringify(value)); }
  private decrypt<T>(value: string): T { return JSON.parse(plainText(this.key, value, "bảng lương")) as T; }

  private assertRole(user: AuthUser, permission: "payroll.read" | "payroll.calculate") {
    if (!user.roles.includes("KT") || !user.permissions.includes(permission)) throw new ForbiddenException("Chỉ KT được cấp quyền mới được xem hoặc tính bảng lương.");
  }

  private async period(db: Db, id: string) {
    const period = await db.payrollPeriod.findUnique({ where: { id } });
    if (!period) throw new NotFoundException("Không tìm thấy kỳ lương.");
    return period;
  }

  private async assertSite(user: AuthUser, permission: "payroll.read" | "payroll.calculate", siteOrgUnitId: string, db: Db = this.prisma) {
    this.assertRole(user, permission);
    const scope = await this.scope.load(user, permission, db);
    if (!scope.allowed.has(siteOrgUnitId)) throw new ForbiddenException("Kỳ lương nằm ngoài phạm vi được phân quyền.");
    return scope;
  }

  /** Employees the user may see now: primary unit in scope and no active exclusion. */
  private async visibleEmployees(user: AuthUser, permission: "payroll.read" | "payroll.calculate", ids: string[], db: Db = this.prisma) {
    const scope = await this.scope.load(user, permission, db);
    const today = businessDate();
    const rows = await db.employee.findMany({ where: { id: { in: ids }, exclusions: { none: { userAccountId: user.id, ...effectiveAt(today) } } }, include: { assignments: { where: { isPrimary: true } } } });
    return new Set(rows.filter(row => row.assignments.some(assignment => scope.allowed.has(assignment.orgUnitId))).map(row => row.id));
  }

  /** Attendance periods of the site overlapping the payroll period; every one must be LOCKED (TC-K06). */
  async attendanceSources(db: Db, period: PayrollPeriod) {
    const periods = await db.businessPeriod.findMany({ where: { periodType: "ATTENDANCE", scopeOrgUnitId: period.siteOrgUnitId, dateFrom: { lte: period.dateTo }, dateTo: { gte: period.dateFrom } }, orderBy: { dateFrom: "asc" } });
    const open = periods.filter(item => item.status !== "LOCKED");
    if (!periods.length || open.length) fail("conflict", "PERIOD_NOT_LOCKED", periods.length ? "Còn kỳ công nguồn chưa khóa: " + open.map(item => item.code).join(", ") : "Chưa có kỳ công nguồn của cơ sở trong kỳ lương.", { periods: periods.map(item => ({ id: item.id, code: item.code, status: item.status })) });
    const events = await db.attendancePeriodLockEvent.findMany({ where: { periodId: { in: periods.map(item => item.id) }, action: "LOCK" } });
    return periods.map(item => ({ period: item, event: events.find(event => event.periodId === item.id)! }));
  }

  async startRun(user: AuthUser, dto: StartRunDto, ip?: string) {
    this.assertRole(user, "payroll.calculate");
    const run = await this.prisma.$transaction(async db => {
      const period = await this.period(db, dto.payrollPeriodId);
      await this.assertSite(user, "payroll.calculate", period.siteOrgUnitId, db);
      const sheet = await db.payrollSheet.findUnique({ where: { payrollPeriodId: period.id } });
      if (period.status === "LOCKED") fail("conflict", "PAYROLL_PERIOD_LOCKED", "Kỳ lương đã khóa; tạo điều chỉnh ở kỳ mở.");
      if (sheet?.status === "LOCKED") fail("conflict", "PAYROLL_SHEET_LOCKED", "Bảng lương đã khóa; điều chỉnh ở kỳ mở.");
      if (sheet?.status === "APPROVED") await this.events.returnToDraft(db, sheet.id, user.id, "Tính lại bảng lương đã duyệt", "RECALCULATE");
      const sources = await this.attendanceSources(db, period);
      if (!period.expectedPaymentDate) fail("conflict", "PAYMENT_DATE_REQUIRED", "Kỳ lương cần ngày chi trả dự kiến để chọn quy tắc thuế.");
      const running = await db.payrollRun.findFirst({ where: { payrollPeriodId: period.id, status: "RUNNING" } });
      if (running) fail("conflict", "PAYROLL_RUN_IN_PROGRESS", "Kỳ lương đang có lần tính chưa hoàn tất.", { runId: running.id });
      const created = await db.payrollRun.create({ data: { payrollPeriodId: period.id, siteOrgUnitId: period.siteOrgUnitId, scope: { employeeIds: dto.employeeIds ?? null }, attendanceLocks: sources.map(item => ({ periodId: item.period.id, code: item.period.code, lockEventId: item.event.id, sourceHash: item.event.sourceHash })), startedById: user.id } });
      await this.audit.record({ actorId: user.id, entityType: "payroll_run", entityId: created.id, action: "START", result: "SUCCESS", newValue: { payrollPeriodId: period.id, employeeIds: dto.employeeIds ?? null }, ipAddress: ip }, db);
      return created;
    }, { isolationLevel: "Serializable" }).catch(error => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") fail("conflict", "PAYROLL_RUN_IN_PROGRESS", "Kỳ lương đang có lần tính chưa hoàn tất.");
      throw error;
    });
    setImmediate(() => void this.execute(run.id).catch(error => this.logger.error("Payroll run failed: " + (error instanceof Error ? error.message : String(error)))));
    return { run: await this.runView(run.id) };
  }

  async cancel(user: AuthUser, id: string, ip?: string) {
    const run = await this.prisma.payrollRun.findUnique({ where: { id } });
    if (!run) throw new NotFoundException("Không tìm thấy lần tính.");
    await this.assertSite(user, "payroll.calculate", run.siteOrgUnitId);
    if (run.status !== "RUNNING") fail("conflict", "PAYROLL_RUN_NOT_RUNNING", "Lần tính đã kết thúc.");
    await this.prisma.payrollRun.update({ where: { id }, data: { cancelRequested: true } });
    await this.audit.record({ actorId: user.id, entityType: "payroll_run", entityId: id, action: "CANCEL_REQUEST", result: "SUCCESS", ipAddress: ip });
    return { run: await this.runView(id) };
  }

  private async parameter(db: Db, paramCode: string, siteId: string | null, regionCode: string | null, at: Date) {
    const scopes = [...(siteId ? ["SITE:" + siteId] : []), ...(regionCode ? ["REGION:" + regionCode] : []), "GLOBAL"];
    const rows = await db.legalParameter.findMany({ where: { paramCode, subjectType: "ALL", applicationBasis: "WORK_DATE", scopeKey: { in: scopes }, ...effectiveAt(at) } });
    const row = scopes.map(scopeKey => rows.find(item => item.scopeKey === scopeKey)).find(Boolean);
    return row ? { id: row.id, value: String(row.value) } : null;
  }

  /** Loads every source for the run once; returns the per-employee contexts in a stable order (06 §6.3). */
  private async load(db: Db, runId: string) {
    const run = await db.payrollRun.findUniqueOrThrow({ where: { id: runId } });
    const period = await db.payrollPeriod.findUniqueOrThrow({ where: { id: run.payrollPeriodId } });
    return { run, ...(await this.loadSources(db, period, run.attendanceLocks as Array<{ periodId: string; lockEventId: string; sourceHash: string }>, (run.scope as { employeeIds?: string[] | null }).employeeIds ?? null)) };
  }

  /**
   * REPLAY of a locked period for one employee (FR-7.4.1): same locked attendance events as the period's last run, sources and
   * parameters as of the period's dates, adjustments that period applied — only sources changed since (e.g. the salary timeline) differ.
   */
  async replay(db: Db, period: PayrollPeriod, employeeId: string) {
    const sheet = await db.payrollSheet.findUnique({ where: { payrollPeriodId: period.id }, include: { lastRun: true } });
    if (!sheet?.lastRun || sheet.status !== "LOCKED") throw new StageError("RETRO_SOURCE_UNAVAILABLE", `Kỳ ${period.code} không có bảng lương đã khóa kèm lần tính để tái hiện.`);
    const locks = sheet.lastRun.attendanceLocks as Array<{ periodId: string; lockEventId: string; sourceHash: string }>;
    if (!Array.isArray(locks) || !locks.length || (await db.attendancePeriodLockEvent.count({ where: { id: { in: locks.map(lock => lock.lockEventId) } } })) !== locks.length) throw new StageError("RETRO_SOURCE_UNAVAILABLE", `Thiếu sự kiện khóa công nguồn của kỳ ${period.code}.`);
    const loaded = await this.loadSources(db, period, locks, [employeeId], "REPLAY");
    const ctx = loaded.contexts[0];
    if (!ctx) throw new StageError("RETRO_SOURCE_UNAVAILABLE", `Nhân viên không thuộc nguồn tính lương của kỳ ${period.code}.`);
    return calculateEmployee(ctx, this.hooks(db, ctx, loaded.rulesets).hooks);
  }

  /** Current source fingerprint of a period (all employees) — the lock-time safety net against missed change events. */
  async currentSourceHashes(db: Db, period: PayrollPeriod) {
    const sources = await this.attendanceSources(db, period);
    const loaded = await this.loadSources(db, period, sources.map(item => ({ periodId: item.period.id, lockEventId: item.event.id, sourceHash: item.event.sourceHash })), null);
    return { sourceHash: sha256({ employees: loaded.contexts.map(ctx => [ctx.employee.id, contextHash(ctx)]).sort(([left], [right]) => String(left).localeCompare(String(right))), locks: loaded.lockHashes }), paramSnapshotHash: this.paramHash(loaded) };
  }

  paramHash(loaded: { params: unknown; rulesets: Ruleset[]; insuranceRateIds: string[] }) {
    return sha256({ params: loaded.params, rulesets: loaded.rulesets.map(ruleset => ruleset.id), insuranceRates: loaded.insuranceRateIds });
  }

  private async loadSources(db: Db, period: PayrollPeriod, locks: Array<{ periodId: string; lockEventId: string; sourceHash: string }>, scopeIds: string[] | null, mode: "RUN" | "REPLAY" = "RUN") {
    const from = key(period.dateFrom), to = key(period.dateTo);
    const events = await db.attendancePeriodLockEvent.findMany({ where: { id: { in: locks.map(lock => lock.lockEventId) } } });
    const days = new Map<string, EmployeeContext["attendance"]["days"]>(), regular = new Map<string, Decimal>();
    for (const event of events) {
      const snapshot = event.snapshot as Snapshot;
      for (const team of snapshot.teams ?? []) for (const day of team.days ?? []) {
        if (day.workDate < from || day.workDate > to) continue;
        days.set(day.employee.id, [...(days.get(day.employee.id) ?? []), { workDate: day.workDate, workUnits: String(day.workUnits), workedMinutes: Number(day.workedMinutes), status: day.status, correctionId: day.correctionId ?? null }]);
      }
      for (const row of snapshot.payrollTime?.regular ?? []) {
        if (row.workDate < from || row.workDate > to) continue;
        const minutes = row.segments.reduce((total, piece) => total.plus(new Decimal(Date.parse(piece.endAt) - Date.parse(piece.startAt)).div(60_000)), new Decimal(0));
        regular.set(row.employeeId, (regular.get(row.employeeId) ?? new Decimal(0)).plus(minutes));
      }
    }
    const buckets = new Map<string, PayBucket[]>();
    let bucketHash = "";
    for (const lock of locks) {
      const result = await this.overtimePay.lockedBuckets(db, lock.periodId);
      if (result.errors.length) fail("conflict", "OT_RATE_PARAMETER_MISSING", "Thiếu tham số hệ số OT cho kỳ công khóa.", { errors: result.errors });
      bucketHash += result.sourceHash;
      for (const bucket of result.buckets) if (bucket.workDate >= from && bucket.workDate <= to) buckets.set(bucket.employeeId, [...(buckets.get(bucket.employeeId) ?? []), bucket]);
    }
    const site = await db.orgUnitVersion.findFirst({ where: { orgUnitId: period.siteOrgUnitId, type: "SITE", ...effectiveAt(period.dateTo) } });
    const siteUnits = await db.orgUnitVersion.findMany({ where: { siteId: site?.siteId ?? "00000000-0000-0000-0000-000000000000", effectiveFrom: { lte: period.dateTo }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: period.dateFrom } }] }, select: { orgUnitId: true } });
    const inputs = await db.payrollInputLine.findMany({ where: { batch: { payrollPeriodId: period.id, status: "CONFIRMED" } }, include: { batch: true }, orderBy: { id: "asc" } });
    const plans = await db.employeePayPlan.findMany({ where: { versions: { some: { effectiveFrom: { lte: period.dateTo }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: period.dateFrom } }] } } }, include: { versions: { orderBy: { effectiveFrom: "asc" } } } });
    const terminations = await this.payableTerminations(db, period, mode);
    const benefits = await this.payableBenefits(db, period.id);
    const candidates = new Set<string>([...days.keys(), ...inputs.map(line => line.employeeId), ...plans.map(plan => plan.employeeId), ...terminations.map(row => row.employeeId), ...benefits.map(row => row.employeeId)]);
    const assigned = await db.employee.findMany({ where: { id: { in: [...candidates] }, assignments: { some: { isPrimary: true, orgUnitId: { in: siteUnits.map(unit => unit.orgUnitId) }, effectiveFrom: { lte: period.dateTo }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: period.dateFrom } }] } } }, orderBy: { code: "asc" } });
    const employees = assigned.filter(employee => !scopeIds || scopeIds.includes(employee.id));
    const componentIds = new Set<string>([...inputs.map(line => line.componentId), ...plans.flatMap(plan => plan.versions.flatMap(version => (version.lines as Array<{ componentId: string }>).map(line => line.componentId)))]);
    const componentRows = await db.salaryComponent.findMany({ where: { id: { in: [...componentIds] } }, include: { versions: { orderBy: { effectiveFrom: "desc" } } } });
    const components: Record<string, ComponentFlags> = {};
    for (const component of componentRows) {
      const version = component.versions.find(item => item.effectiveFrom <= period.dateTo && (!item.effectiveTo || item.effectiveTo >= period.dateTo)) ?? component.versions.find(item => item.effectiveFrom <= period.dateFrom && (!item.effectiveTo || item.effectiveTo >= period.dateFrom));
      if (version && version.active) components[component.id] = { isInsurable: version.isInsurable, taxClassification: version.taxClassification, isOtBase: version.isOtBase, isProrated: version.isProrated, componentType: version.componentType, code: component.code, name: version.name };
    }
    const previous = await db.payrollPeriod.findFirst({ where: { siteOrgUnitId: period.siteOrgUnitId, dateTo: { lt: period.dateFrom }, payrollSheet: { isNot: null } }, orderBy: { dateTo: "desc" }, include: { payrollSheet: { include: { employees: { where: { status: "OK" } } } } } });
    const previousGross = new Map((previous?.payrollSheet?.employees ?? []).map(row => [row.employeeId, this.decrypt<{ gross: string }>(row.totalsCipher).gross]));
    const params = {
      standardWorkdays: await this.parameter(db, "PAYROLL_STANDARD_WORKDAYS", site?.siteId ?? null, null, period.dateTo),
      deductionMaxNetRatio: await this.parameter(db, "DEDUCTION_MAX_NET_RATIO", site?.siteId ?? null, null, period.dateTo),
      varianceThreshold: await this.parameter(db, "PAYROLL_VARIANCE_THRESHOLD", site?.siteId ?? null, null, period.dateTo),
      otMonthMaxMinutes: await this.parameter(db, "OT_MONTH_MAX_MINUTES", site?.siteId ?? null, null, period.dateTo),
      probationMinRatio: await this.parameter(db, "PROBATION_MIN_RATIO", site?.siteId ?? null, null, period.dateTo),
      roundingScale: 0,
    };
    const rulesets = await this.pit.loadRulesets(db);
    const lockHashes = locks.map(lock => lock.sourceHash);
    const adjustments = await this.pendingAdjustments(db, employees.map(employee => employee.id), period, mode);
    const bonuses = await this.payableBonuses(db, employees.map(employee => employee.id), period);
    const contexts: EmployeeContext[] = [];
    for (const employee of employees) {
      const salary = await salaryTimeline(db, this.key, employee.id, period.dateFrom, period.dateTo);
      const unitRows = await unitSegments(db, employee.id, period.dateFrom, period.dateTo);
      const units = [];
      for (const unit of unitRows) units.push({ ...unit, minimumMonth: unit.wageRegionCode ? await this.parameter(db, "MIN_WAGE_MONTH_" + unit.wageRegionCode, unit.siteId, unit.wageRegionCode, date(unit.from)) : null, minimumHour: unit.wageRegionCode ? await this.parameter(db, "MIN_WAGE_HOUR_" + unit.wageRegionCode, unit.siteId, unit.wageRegionCode, date(unit.from)) : null });
      const contracts = await db.employmentContract.findMany({ where: { employeeId: employee.id, status: "ACTIVE", startDate: { lte: period.dateTo }, OR: [{ endDate: null }, { endDate: { gte: period.dateFrom } }] } });
      const plan = plans.find(item => item.employeeId === employee.id);
      contexts.push({
        employee: { id: employee.id, code: employee.code, fullName: employee.fullName, hireDate: key(employee.hireDate), terminationDate: employee.terminationDate ? key(employee.terminationDate) : null },
        period: { id: period.id, code: period.code, dateFrom: from, dateTo: to, paymentDate: period.expectedPaymentDate ? key(period.expectedPaymentDate) : null, month: to.slice(0, 7) },
        planVersions: (plan?.versions ?? []).map(version => ({ id: version.id, payMode: version.payMode, status: version.status, effectiveFrom: key(version.effectiveFrom), effectiveTo: version.effectiveTo ? key(version.effectiveTo) : null, lines: version.lines as unknown as PlanVersion["lines"] })),
        components,
        inputs: inputs.filter(line => line.employeeId === employee.id).map(line => this.inputLine(line)),
        salary, units,
        attendance: { available: days.has(employee.id), days: (days.get(employee.id) ?? []).sort((left, right) => left.workDate.localeCompare(right.workDate)), regularMinutes: (regular.get(employee.id) ?? new Decimal(0)).toString(), lockHashes },
        buckets: buckets.get(employee.id) ?? [], bucketHash: bucketHash ? sha256(bucketHash) : null,
        contracts: contracts.map(contract => ({ id: contract.id, type: contract.type, salary: plainText(this.key, contract.salaryCipher), officialSalary: contract.officialSalaryCipher ? plainText(this.key, contract.officialSalaryCipher) : null, salaryBasis: contract.salaryBasis, startDate: key(contract.startDate), endDate: contract.endDate ? key(contract.endDate) : null })),
        previousGross: previousGross.get(employee.id) ?? null,
        ...(adjustments.some(row => row.employeeId === employee.id) ? { adjustments: adjustments.filter(row => row.employeeId === employee.id).map(row => row.item) } : {}),
        ...(bonuses.some(row => row.employeeId === employee.id) ? { bonuses: bonuses.filter(row => row.employeeId === employee.id).map(row => row.item) } : {}),
        ...(terminations.some(row => row.employeeId === employee.id) ? { terminations: terminations.filter(row => row.employeeId === employee.id).map(row => row.item) } : {}),
        ...(benefits.some(row => row.employeeId === employee.id) ? { benefits: benefits.filter(row => row.employeeId === employee.id).map(row => row.item) } : {}),
        params,
      });
    }
    const insuranceRateIds = (await db.insuranceRate.findMany({ where: { effectiveFrom: { lte: period.dateTo }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: period.dateFrom } }] }, select: { id: true }, orderBy: { id: "asc" } })).map(row => row.id);
    return { period, contexts, rulesets, params, lockHashes, insuranceRateIds };
  }

  /** Confirmed adjustments from earlier periods not yet consumed by a locked period (FR-7.5.4); the lock marks them applied. */
  async pendingAdjustments(db: Db, employeeIds: string[], period: Pick<PayrollPeriod, "id" | "dateFrom">, mode: "RUN" | "REPLAY" = "RUN") {
    const where: Prisma.PayrollAdjustmentWhereInput = mode === "REPLAY" ? { appliedPayrollPeriodId: period.id } : { appliedPayrollPeriodId: null, OR: [{ targetPayrollPeriodId: period.id }, { targetPayrollPeriodId: null, originPayrollPeriod: { dateTo: { lt: period.dateFrom } } }] };
    const rows = await db.payrollAdjustment.findMany({ where: { employeeId: { in: employeeIds }, status: "CONFIRMED", ...where }, include: { originPayrollPeriod: { select: { code: true } } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    return rows.map(row => {
      const detail = this.decrypt<{ explanation: string; taxable?: PendingAdjustment["taxable"] }>(row.detailCipher);
      return { employeeId: row.employeeId, item: { id: row.id, kind: row.kind, label: row.label, amount: plainText(this.key, row.amountCipher, "điều chỉnh lương"), originPeriodCode: row.originPayrollPeriod.code, explanation: detail.explanation, ...(detail.taxable ? { taxable: detail.taxable } : {}) } satisfies PendingAdjustment };
    });
  }

  /**
   * Confirmed termination payments of this period. A normal run also binds items of the site still waiting for a
   * period (confirmed while none was open) whose termination falls on or before the period end; replay reads only
   * what the period already holds.
   */
  async payableTerminations(db: Db, period: Pick<PayrollPeriod, "id" | "siteOrgUnitId" | "dateTo">, mode: "RUN" | "REPLAY" = "RUN") {
    if (mode === "RUN") await db.terminationPaymentItem.updateMany({ where: { payrollPeriodId: null, siteOrgUnitId: period.siteOrgUnitId, decision: { status: "CONFIRMED", effectiveDate: { lte: period.dateTo } } }, data: { payrollPeriodId: period.id } });
    const rows = await db.terminationPaymentItem.findMany({ where: { payrollPeriodId: period.id }, include: { decision: { select: { decisionNumber: true } } }, orderBy: [{ employeeId: "asc" }, { kind: "asc" }] });
    return rows.map(row => ({ employeeId: row.employeeId, item: { id: row.id, kind: row.kind as TerminationPayItem["kind"], label: row.label, amount: plainText(this.key, row.amountCipher, "chấm dứt hợp đồng"), decisionNumber: row.decision.decisionNumber, trace: this.decrypt<Record<string, unknown>>(row.detailCipher) } satisfies TerminationPayItem }));
  }

  /** Confirmed payroll-included welfare allocations bound to this period (FR-9.2.1); unconfirmed batches never reach here. */
  async payableBenefits(db: Db, periodId: string) {
    const rows = await db.benefitAllocation.findMany({ where: { payrollPeriodId: periodId }, include: { catalog: { select: { code: true } }, version: { select: { name: true, exemptLimit: true } }, batch: { select: { code: true } } }, orderBy: [{ employeeId: "asc" }, { catalogId: "asc" }] });
    return rows.map(row => ({ employeeId: row.employeeId, item: { id: row.id, code: row.catalog.code, label: row.version.name, amount: plainText(this.key, row.amountCipher, "phúc lợi"), taxTreatment: row.taxTreatment, exemptLimit: row.version.exemptLimit?.toString() ?? null, batchCode: row.batch.code, periodCode: row.periodCode } satisfies BenefitItem }));
  }

  /** Confirmed bonus allocations whose plan pays in this period; any other period never sees them (FR-7.3.1). */
  async payableBonuses(db: Db, employeeIds: string[], period: Pick<PayrollPeriod, "id" | "dateTo">) {
    const rows = await db.bonusAllocation.findMany({ where: { employeeId: { in: employeeIds }, plan: { status: "CONFIRMED", payPayrollPeriodId: period.id } }, include: { plan: { include: { component: { include: { versions: { orderBy: { effectiveFrom: "desc" } } } } } } }, orderBy: [{ plan: { code: "asc" } }, { id: "asc" }] });
    return rows.map(row => {
      const version = row.plan.component?.versions.find(item => item.effectiveFrom <= period.dateTo && (!item.effectiveTo || item.effectiveTo >= period.dateTo));
      const inputs = this.decrypt<Record<string, string>>(row.inputsCipher);
      return { employeeId: row.employeeId, item: { id: row.id, planCode: row.plan.code, label: row.plan.name, amount: plainText(this.key, row.amountCipher, "thưởng"), componentId: row.plan.componentId, componentCode: row.plan.component?.code ?? null, taxClassification: version?.taxClassification ?? "TAXABLE",
        trace: { bonusType: row.plan.bonusType, decisionReference: row.plan.decisionReference, independentDecisionRef: row.plan.independentDecisionRef, earnFrom: key(row.plan.earnFrom), earnTo: key(row.plan.earnTo), calculationMode: row.plan.calculationMode, formula: row.plan.formula, inputs } } satisfies BonusItem };
    });
  }

  private inputLine(line: Prisma.PayrollInputLineGetPayload<{ include: { batch: true } }>): InputLine {
    const payload = JSON.parse(plainText(this.key, line.payloadCipher)) as { amount?: string; allocatedAmount?: string; formulaCode?: string };
    const binding = line.bindingSnapshotCipher ? JSON.parse(plainText(this.key, line.bindingSnapshotCipher)) as { amount?: string; results?: Array<{ code: string; value: string }>; dependencies?: Array<{ versionId: string }> } : {};
    const amount = line.calculationMode === "FORMULA" ? binding.results?.find(result => result.code === payload.formulaCode)?.value ?? null : binding.amount ?? payload.amount ?? null;
    return { id: line.id, componentId: line.componentId, inputType: line.inputType, valueState: line.valueState as InputLine["valueState"], amount, allocatedAmount: payload.allocatedAmount ?? null, workFrom: key(line.workFrom), workTo: key(line.workTo), inputHash: line.inputHash, batchId: line.batchId, businessReference: line.businessReference, teamAllocationKey: line.teamAllocationKey, formulaCode: payload.formulaCode ?? null, bindingVersions: (binding.dependencies ?? []).map(item => item.versionId).sort(), provenance: line.batch.provenance };
  }

  /** Background worker: chunks of employees, progress, cancel between chunks, per-employee error isolation. */
  async execute(runId: string) {
    try {
      const loaded = await this.prisma.$transaction(db => this.load(db, runId), { timeout: 600_000, isolationLevel: "RepeatableRead" });
      const { run, period, contexts, rulesets } = loaded;
      await this.prisma.payrollRun.update({ where: { id: runId }, data: { progressTotal: contexts.length } });
      const sheet = await this.prisma.payrollSheet.upsert({ where: { payrollPeriodId: period.id }, update: {}, create: { payrollPeriodId: period.id } });
      const results: EmployeeResult[] = [];
      for (let start = 0; start < contexts.length; start += CHUNK) {
        if ((await this.prisma.payrollRun.findUniqueOrThrow({ where: { id: runId } })).cancelRequested) {
          await this.prisma.payrollRun.update({ where: { id: runId }, data: { status: "CANCELLED", finishedAt: new Date() } });
          return;
        }
        for (const ctx of contexts.slice(start, start + CHUNK)) results.push(await this.calculateAndStore(runId, sheet.id, period, ctx, rulesets));
        await this.prisma.payrollRun.update({ where: { id: runId }, data: { progressDone: Math.min(contexts.length, start + CHUNK), errorCount: results.filter(result => result.status === "ERROR").length } });
      }
      await this.finish(runId, sheet.id, loaded, results);
    } catch (error) {
      const message = error instanceof HttpException ? JSON.stringify(error.getResponse()) : error instanceof Error ? error.message : String(error);
      await this.prisma.payrollRun.update({ where: { id: runId }, data: { status: "FAILED", failure: message.slice(0, 2000), finishedAt: new Date() } });
      throw error;
    }
  }

  private async calculateAndStore(runId: string, sheetId: string, period: PayrollPeriod, ctx: EmployeeContext, rulesets: Ruleset[]) {
    return this.prisma.$transaction(async db => {
      const built = this.hooks(db, ctx, rulesets);
      const result = await calculateEmployee(ctx, built.hooks);
      const { insuranceDetail, taxResult } = built.state;
      await db.payrollEmployee.deleteMany({ where: { sheetId, employeeId: ctx.employee.id } });
      const saved = await db.payrollEmployee.create({ data: {
        sheetId, runId, employeeId: ctx.employee.id, status: result.status, errors: result.errors as Prisma.InputJsonValue, sourceHash: result.sourceHash,
        totalsCipher: this.encrypt(result.totals), netPayCipher: cipherText(this.key, result.totals.net),
        insurableSalaryCipher: insuranceDetail ? this.encrypt((insuranceDetail as { salary: unknown }).salary) : null,
        detailCipher: this.encrypt({ violations: result.violations, costAllocation: result.costAllocation, hourlyRate: result.hourlyRate, otMinutes: result.otMinutes, units: ctx.units, unitWork: unitWork(ctx), salary: ctx.salary }),
      } });
      for (const [index, line] of result.lines.entries()) {
        const row = await db.payrollLine.create({ data: { payrollEmployeeId: saved.id, lineNo: index + 1, lineType: line.lineType, label: line.label.slice(0, 200), componentId: line.componentId, componentCode: line.componentCode, paramCode: line.paramCode ?? null, sourceReference: line.sourceReference?.slice(0, 500) ?? null,
          amountCipher: cipherText(this.key, line.amount), traceCipher: this.encrypt({ ...line.trace, quantity: line.quantity ?? null, rate: line.rate ?? null, flags: line.flags ?? null }) } });
        if (line.sources.length) await db.payrollLineInput.createMany({ data: line.sources.map(source => ({ payrollLineId: row.id, sourceType: source.sourceType, sourceId: String(source.sourceId).slice(0, 200), versionId: source.versionId ?? null, sourceHash: source.sourceHash ?? null })) });
      }
      for (const error of result.errors) await db.payrollRunError.create({ data: { runId, employeeId: ctx.employee.id, code: error.code, message: error.message.slice(0, 2000), detail: (error.details ?? {}) as Prisma.InputJsonValue } });
      if (result.status === "OK" && insuranceDetail) {
        const detail = insuranceDetail as Awaited<ReturnType<SocialInsuranceService["compute"]>>;
        await db.insuranceContribution.create({ data: { payrollPeriodId: period.id, payrollEmployeeId: saved.id, employeeId: ctx.employee.id, contributionMonth: ctx.period.month, eligible: detail.eligibility.eligible as Prisma.InputJsonValue, insurableSalaryCipher: detail.salary ? cipherText(this.key, detail.salary.perKind.BHXH.value) : null, detailCipher: this.encrypt({ salary: detail.salary, contribution: detail.contribution, eligibility: detail.eligibility }) } });
      }
      if (result.status === "OK" && taxResult) await this.pit.saveDraft(db, { employeeId: ctx.employee.id, paymentKey: `payroll:${period.id}:${ctx.employee.id}`, payrollPeriodId: period.id, actorId: (await db.payrollRun.findUniqueOrThrow({ where: { id: runId } })).startedById, result: taxResult });
      return result;
    }, { timeout: 60_000 });
  }

  /** Insurance and PIT hooks for one employee; the state keeps the detailed results for persistence. */
  private hooks(db: Db, ctx: EmployeeContext, rulesets: Ruleset[]) {
    const state: { insuranceDetail: Awaited<ReturnType<SocialInsuranceService["compute"]>> | null; taxResult: Awaited<ReturnType<PitService["calculate"]>> | null } = { insuranceDetail: null, taxResult: null };
    let insuranceDetail: typeof state.insuranceDetail = null;
    let taxResult: typeof state.taxResult = null;
    const hooks: Hooks = {
      insurance: async extra => {
        insuranceDetail = state.insuranceDetail = await this.insurance.compute(db, ctx.employee.id, ctx.period.month, extra);
        const lines = insuranceDetail.contribution?.lines ?? [];
        return { eligible: insuranceDetail.eligibility.eligible, reasonCode: insuranceDetail.eligibility.reasonCode, insurableRaw: insuranceDetail.salary?.raw ?? null,
          cp07: insuranceDetail.cp07 ? { code: "CP-07", severity: "BLOCKING", message: insuranceDetail.cp07.message, details: { missing: insuranceDetail.missing } } : null,
          lines: lines.map(line => ({ kind: line.kind, base: line.base, employee: line.employee, employer: line.employer, rateId: line.rateId })), trace: { eligibility: insuranceDetail.eligibility, salary: insuranceDetail.salary } };
      },
      tax: async (items, insuranceEmployee) => {
        try {
          taxResult = state.taxResult = await this.pit.calculate(db, { employeeId: ctx.employee.id, paymentDate: ctx.period.paymentDate!, paymentDateStatus: "PROJECTED", items: items as never, deductions: { insurance: insuranceEmployee } }, rulesets);
        } catch (error) {
          if (error instanceof HttpException) { const body = error.getResponse() as { code?: string; message?: string }; throw new StageError(body.code ?? "TAX_ERROR", body.message ?? "Không tính được thuế."); }
          throw error;
        }
        const value = taxResult!;
        return { tax: value.tax, branch: value.branch, rulesetId: value.context.ruleset.id, rulesetCode: value.context.ruleset.code, taxPeriod: value.context.taxPeriod, exceptions: value.exemptions.exceptions,
          trace: { taxableIncome: value.taxableIncome, deductions: value.deductions, assessableIncome: value.assessableIncome, brackets: value.brackets, exemptions: value.exemptions.lines, dependents: value.dependents, notes: value.notes } };
      },
      };
    return { hooks, state };
  }

  /** Aggregates the compliance gates over the whole sheet and closes the run with its hashes. */
  private async finish(runId: string, sheetId: string, loaded: Awaited<ReturnType<PayrollService["load"]>>, results: EmployeeResult[]) {
    await this.prisma.$transaction(async db => {
      const employees = await db.payrollEmployee.findMany({ where: { sheetId }, orderBy: { employeeId: "asc" } });
      const violations = new Map<string, Array<Violation & { employeeId: string }>>();
      for (const row of employees) for (const violation of this.decrypt<{ violations: Violation[] }>(row.detailCipher).violations) violations.set(violation.code, [...(violations.get(violation.code) ?? []), { ...violation, employeeId: row.employeeId }]);
      for (const code of CP_CODES) {
        const list = violations.get(code) ?? [];
        await db.complianceCheckResult.create({ data: { runId, sheetId, code, severity: code === "CP-08" ? "WARNING" : "BLOCKING", violationCount: list.length, detailsCipher: this.encrypt(list), employeeIds: [...new Set(list.map(item => item.employeeId))] } });
      }
      const sourceHash = sha256({ employees: employees.map(row => [row.employeeId, row.sourceHash]).sort(([left], [right]) => String(left).localeCompare(String(right))), locks: loaded.lockHashes });
      const paramSnapshotHash = this.paramHash(loaded);
      const versionSet = { rulesets: loaded.rulesets.map(ruleset => ruleset.code), configurationVersions: [...new Set(loaded.contexts.flatMap(ctx => ctx.inputs.flatMap(input => input.bindingVersions)))].sort() };
      await db.payrollRun.update({ where: { id: runId }, data: { status: "COMPLETED", finishedAt: new Date(), progressDone: loaded.contexts.length, errorCount: results.filter(result => result.status === "ERROR").length, sourceHash, paramSnapshotHash, versionSet } });
      await db.payrollSheet.update({ where: { id: sheetId }, data: { calcCount: { increment: 1 }, lastRunId: runId, sourceHash, updatedAt: new Date(), revision: { increment: 1 } } });
    }, { timeout: 120_000 });
  }

  async runView(id: string) {
    const run = await this.prisma.payrollRun.findUniqueOrThrow({ where: { id }, include: { startedBy: { select: { id: true, displayName: true } }, payrollPeriod: { select: { code: true } } } });
    return { id: run.id, payrollPeriodId: run.payrollPeriodId, payrollPeriodCode: run.payrollPeriod.code, status: run.status, progressTotal: run.progressTotal, progressDone: run.progressDone, errorCount: run.errorCount, cancelRequested: run.cancelRequested, sourceHash: run.sourceHash, paramSnapshotHash: run.paramSnapshotHash, versionSet: run.versionSet, attendanceLocks: run.attendanceLocks, failure: run.failure, startedBy: run.startedBy, startedAt: run.startedAt.toISOString(), finishedAt: run.finishedAt?.toISOString() ?? null };
  }

  async run(user: AuthUser, id: string) {
    const run = await this.prisma.payrollRun.findUnique({ where: { id } });
    if (!run) throw new NotFoundException("Không tìm thấy lần tính.");
    await this.assertSite(user, "payroll.read", run.siteOrgUnitId);
    const errors = await this.prisma.payrollRunError.findMany({ where: { runId: id }, include: { employee: { select: { id: true, code: true, fullName: true } } }, orderBy: { createdAt: "asc" } });
    const visible = await this.visibleEmployees(user, "payroll.read", errors.map(error => error.employeeId).filter((value): value is string => !!value));
    return { run: await this.runView(id), errors: errors.filter(error => !error.employeeId || visible.has(error.employeeId)).map(error => ({ code: error.code, message: error.message, employee: error.employee, detail: error.detail })) };
  }

  async runs(user: AuthUser, payrollPeriodId: string) {
    const period = await this.period(this.prisma, payrollPeriodId);
    await this.assertSite(user, "payroll.read", period.siteOrgUnitId);
    const rows = await this.prisma.payrollRun.findMany({ where: { payrollPeriodId }, orderBy: { startedAt: "desc" }, take: 20, select: { id: true } });
    return { items: await Promise.all(rows.map(row => this.runView(row.id))) };
  }

  async periods(user: AuthUser) {
    this.assertRole(user, "payroll.read");
    const scope = await this.scope.load(user, "payroll.read");
    const rows = await this.prisma.payrollPeriod.findMany({ where: { siteOrgUnitId: { in: [...scope.allowed] } }, include: { payrollSheet: true, siteOrgUnit: { include: { versions: { orderBy: { effectiveFrom: "desc" }, take: 1 } } } }, orderBy: [{ dateFrom: "desc" }, { code: "asc" }] });
    const today = businessDate();
    const warningDays = Number((await this.parameter(this.prisma, "PAYROLL_DUE_WARNING_DAYS", null, null, today))?.value ?? 3);
    const due = (row: (typeof rows)[number]) => {
      if (!row.expectedPaymentDate || row.status === "LOCKED") return null;
      const daysLeft = Math.round((row.expectedPaymentDate.getTime() - today.getTime()) / DAY);
      return daysLeft <= warningDays ? { daysLeft, overdue: daysLeft < 0, threshold: warningDays } : null;
    };
    return { items: rows.map(row => ({ dueWarning: due(row), isInitial: row.isInitial, id: row.id, code: row.code, siteOrgUnitId: row.siteOrgUnitId, siteName: row.siteOrgUnit.versions[0]?.name ?? row.siteOrgUnit.code, dateFrom: key(row.dateFrom), dateTo: key(row.dateTo), expectedPaymentDate: row.expectedPaymentDate ? key(row.expectedPaymentDate) : null, status: row.status, sheet: row.payrollSheet ? { id: row.payrollSheet.id, status: row.payrollSheet.status, calcCount: row.payrollSheet.calcCount, sourceHash: row.payrollSheet.sourceHash } : null })) };
  }

  private async sheetFor(user: AuthUser, id: string, permission: "payroll.read" | "payroll.calculate" = "payroll.read") {
    const sheet = await this.prisma.payrollSheet.findUnique({ where: { id }, include: { payrollPeriod: true } });
    if (!sheet) throw new NotFoundException("Không tìm thấy bảng lương.");
    await this.assertSite(user, permission, sheet.payrollPeriod.siteOrgUnitId);
    return sheet;
  }

  async sheet(user: AuthUser, id: string) {
    const sheet = await this.sheetFor(user, id);
    const rows = await this.prisma.payrollEmployee.findMany({ where: { sheetId: id }, include: { employee: { select: { id: true, code: true, fullName: true } } }, orderBy: { employee: { code: "asc" } } });
    const visible = await this.visibleEmployees(user, "payroll.read", rows.map(row => row.employeeId));
    const items = rows.filter(row => visible.has(row.employeeId)).map(row => {
      const detail = this.decrypt<{ violations: Violation[]; costAllocation: unknown; hourlyRate: unknown }>(row.detailCipher);
      return { id: row.id, employee: row.employee, status: row.status, errors: row.errors, totals: this.decrypt<EmployeeResult["totals"]>(row.totalsCipher), violations: detail.violations, costAllocation: detail.costAllocation, hourlyRate: detail.hourlyRate, sourceHash: row.sourceHash };
    });
    const sum = (field: keyof EmployeeResult["totals"]) => items.filter(item => item.status === "OK").reduce((total, item) => total.plus(item.totals[field]), new Decimal(0)).toString();
    return { sheet: { id: sheet.id, status: sheet.status, calcCount: sheet.calcCount, lastRunId: sheet.lastRunId, sourceHash: sheet.sourceHash, revision: sheet.revision, payrollPeriod: { id: sheet.payrollPeriod.id, code: sheet.payrollPeriod.code, dateFrom: key(sheet.payrollPeriod.dateFrom), dateTo: key(sheet.payrollPeriod.dateTo), expectedPaymentDate: sheet.payrollPeriod.expectedPaymentDate ? key(sheet.payrollPeriod.expectedPaymentDate) : null, status: sheet.payrollPeriod.status } },
      totals: { employees: items.length, errors: items.filter(item => item.status === "ERROR").length, gross: sum("gross"), insuranceEmployee: sum("insuranceEmployee"), insuranceEmployer: sum("insuranceEmployer"), tax: sum("tax"), net: sum("net") }, items };
  }

  async sheetByPeriod(user: AuthUser, payrollPeriodId: string) {
    const sheet = await this.prisma.payrollSheet.findUnique({ where: { payrollPeriodId } });
    if (!sheet) { const period = await this.period(this.prisma, payrollPeriodId); await this.assertSite(user, "payroll.read", period.siteOrgUnitId); return { sheet: null }; }
    return this.sheet(user, sheet.id);
  }

  async employeeLines(user: AuthUser, sheetId: string, employeeId: string, ip?: string) {
    await this.sheetFor(user, sheetId);
    const row = await this.prisma.payrollEmployee.findUnique({ where: { sheetId_employeeId: { sheetId, employeeId } }, include: { lines: { orderBy: { lineNo: "asc" } }, employee: { select: { id: true, code: true, fullName: true } } } });
    if (!row) throw new NotFoundException("Nhân viên không có trong bảng lương.");
    await this.assertEmployeeVisible(user, employeeId, ip);
    return { employee: row.employee, status: row.status, errors: row.errors, totals: this.decrypt(row.totalsCipher), lines: row.lines.map(line => ({ id: line.id, lineNo: line.lineNo, lineType: line.lineType, label: line.label, componentCode: line.componentCode, paramCode: line.paramCode, sourceReference: line.sourceReference, amount: plainText(this.key, line.amountCipher, "bảng lương") })) };
  }

  private async assertEmployeeVisible(user: AuthUser, employeeId: string, ip?: string) {
    if (!(await this.visibleEmployees(user, "payroll.read", [employeeId])).has(employeeId)) {
      await this.audit.record({ actorId: user.id, entityType: "payroll_line", entityId: employeeId, action: "ACCESS_DENIED", result: "DENIED", ipAddress: ip });
      throw new ForbiddenException("Nhân viên nằm ngoài phạm vi được phân quyền.");
    }
  }

  /** Drill-down reads the stored trace; for OT/night lines it links the locked attendance days and raw punches (no recalculation). */
  async trace(user: AuthUser, lineId: string, ip?: string) {
    this.assertRole(user, "payroll.read");
    const line = await this.prisma.payrollLine.findUnique({ where: { id: lineId }, include: { inputs: true, payrollEmployee: { include: { sheet: { include: { payrollPeriod: true } }, employee: { select: { id: true, code: true, fullName: true } } } } } });
    if (!line) throw new NotFoundException("Không tìm thấy dòng lương.");
    const scope = await this.scope.load(user, "payroll.read");
    if (!scope.allowed.has(line.payrollEmployee.sheet.payrollPeriod.siteOrgUnitId)) {
      await this.audit.record({ actorId: user.id, entityType: "payroll_line", entityId: lineId, action: "ACCESS_DENIED", result: "DENIED", ipAddress: ip });
      throw new ForbiddenException("Kỳ lương nằm ngoài phạm vi được phân quyền.");
    }
    await this.assertEmployeeVisible(user, line.payrollEmployee.employeeId, ip);
    const trace = this.decrypt<Record<string, unknown> & { buckets?: Array<{ workDate: string }>; segments?: Array<{ from: string; to: string }> }>(line.traceCipher);
    let attendance: unknown[] = [];
    const workDates = [...new Set((trace.buckets ?? []).map(bucket => bucket.workDate))];
    if (workDates.length) {
      const rows = await this.prisma.dailyAttendance.findMany({ where: { employeeId: line.payrollEmployee.employeeId, workDate: { in: workDates.map(date) } }, include: { checkIn: true, checkOut: true }, orderBy: { workDate: "asc" } });
      const actuals = await this.prisma.overtimeActual.findMany({ where: { employeeId: line.payrollEmployee.employeeId, workDate: { in: workDates.map(date) } } });
      const punchIds = actuals.flatMap(actual => ((actual.evidence as { punchIds?: string[] }).punchIds ?? []));
      const punches = await this.prisma.rawPunch.findMany({ where: { id: { in: punchIds } }, orderBy: { punchedAt: "asc" } });
      attendance = workDates.map(workDate => ({
        workDate,
        days: rows.filter(row => key(row.workDate) === workDate).map(row => ({ id: row.id, status: row.status, checkInAt: (row.effectiveCheckInAt ?? row.checkIn?.punchedAt)?.toISOString() ?? null, checkOutAt: (row.effectiveCheckOutAt ?? row.checkOut?.punchedAt)?.toISOString() ?? null, workedMinutes: Number(row.workedMinutes) })),
        overtime: actuals.filter(actual => key(actual.workDate) === workDate).map(actual => ({ id: actual.id, actualMinutes: Number(actual.actualMinutes), eligibleMinutes: Number(actual.eligibleMinutes), flags: actual.flags })),
        punches: punches.filter(punch => actuals.some(actual => key(actual.workDate) === workDate && ((actual.evidence as { punchIds?: string[] }).punchIds ?? []).includes(punch.id))).map(punch => ({ id: punch.id, punchedAt: punch.punchedAt.toISOString(), direction: punch.direction, deviceCode: punch.deviceCode })),
      }));
    }
    await this.audit.record({ actorId: user.id, entityType: "payroll_line", entityId: lineId, action: "VIEW_TRACE", result: "ALLOWED", ipAddress: ip });
    return { line: { id: line.id, lineType: line.lineType, label: line.label, componentCode: line.componentCode, paramCode: line.paramCode, sourceReference: line.sourceReference, amount: plainText(this.key, line.amountCipher, "bảng lương") }, employee: line.payrollEmployee.employee, trace, sources: line.inputs.map(input => ({ sourceType: input.sourceType, sourceId: input.sourceId, versionId: input.versionId, sourceHash: input.sourceHash })), attendance };
  }

  async compliance(user: AuthUser, sheetId: string) {
    const sheet = await this.sheetFor(user, sheetId);
    if (!sheet.lastRunId) return { runId: null, items: [] };
    const rows = await this.prisma.complianceCheckResult.findMany({ where: { runId: sheet.lastRunId }, orderBy: { code: "asc" } });
    const visible = await this.visibleEmployees(user, "payroll.read", [...new Set(rows.flatMap(row => row.employeeIds))]);
    return { runId: sheet.lastRunId, items: rows.map(row => {
      const details = this.decrypt<Array<Violation & { employeeId: string }>>(row.detailsCipher).filter(item => visible.has(item.employeeId));
      const acknowledgements = row.acknowledgements as Array<{ employeeId: string }>;
      return { code: row.code, severity: row.severity, violationCount: row.violationCount, details, acknowledgements, pending: row.severity === "WARNING" ? row.employeeIds.filter(id => !acknowledgements.some(ack => ack.employeeId === id)).length : row.violationCount };
    }) };
  }

  /** CP-08 is the only gate KT may acknowledge, one employee at a time with a reason; BLOCKING gates have no override. */
  async acknowledge(user: AuthUser, sheetId: string, dto: AcknowledgeDto, ip?: string) {
    const sheet = await this.sheetFor(user, sheetId, "payroll.calculate");
    if (dto.code !== "CP-08") fail("bad", "COMPLIANCE_NOT_ACKNOWLEDGEABLE", "Chỉ cảnh báo CP-08 được xác nhận; các cổng BLOCKING không có cơ chế ghi đè.");
    await this.assertEmployeeVisible(user, dto.employeeId, ip);
    return this.prisma.$transaction(async db => {
      const row = await db.complianceCheckResult.findUnique({ where: { runId_code: { runId: sheet.lastRunId ?? "", code: "CP-08" } } });
      if (!row || !row.employeeIds.includes(dto.employeeId)) fail("bad", "COMPLIANCE_NOT_FOUND", "Nhân viên không có cảnh báo CP-08 ở lần tính hiện hành.");
      const acknowledgements = row!.acknowledgements as Array<{ employeeId: string; by: string; at: string; reason: string }>;
      if (acknowledgements.some(ack => ack.employeeId === dto.employeeId)) fail("conflict", "COMPLIANCE_ALREADY_ACKNOWLEDGED", "Cảnh báo của nhân viên đã được xác nhận.");
      const next = [...acknowledgements, { employeeId: dto.employeeId, by: user.id, byName: user.displayName, at: new Date().toISOString(), reason: dto.reason.trim() }];
      await db.complianceCheckResult.update({ where: { id: row!.id }, data: { acknowledgements: next as Prisma.InputJsonValue } });
      await this.audit.record({ actorId: user.id, entityType: "compliance_check_result", entityId: row!.id, action: "ACKNOWLEDGE", result: "SUCCESS", newValue: { code: "CP-08", employeeId: dto.employeeId, reason: dto.reason.trim() }, ipAddress: ip }, db);
      return { acknowledged: next.length, pending: row!.employeeIds.length - next.length };
    });
  }
}
