import Decimal from "decimal.js";
import { createHash } from "node:crypto";
import { nightAllowancePay, otPay, type PayBucket } from "../overtime-pay/overtime-pay-engine";

// Pure payroll pipeline (06 §6.2). Every source arrives pre-loaded; insurance and tax are injected hooks.
const Money = Decimal.clone({ precision: 60, rounding: Decimal.ROUND_HALF_UP });
const DAY = 86_400_000;

export type LineType = "MAIN" | "OT" | "NIGHT_ALLOWANCE" | "ALLOWANCE" | "BONUS" | "BENEFIT" | "TERMINATION" | "INSURANCE_EMPLOYEE" | "UNION_FEE" | "INSURANCE_EMPLOYER" | "TAX" | "DEDUCTION" | "ADJUSTMENT" | "EMPLOYER_COST" | "NET";
export type Severity = "BLOCKING" | "WARNING";
export interface SourceRef { sourceType: string; sourceId: string; versionId?: string | null; sourceHash?: string | null }
export interface PayLine {
  lineType: LineType; label: string; componentId: string | null; componentCode: string | null; amount: string; quantity?: string; rate?: string;
  paramCode?: string; sourceReference?: string; trace: Record<string, unknown>; sources: SourceRef[];
  flags?: { isInsurable: boolean; taxClassification: string; isOtBase: boolean; componentType: string };
}
export interface Violation { code: string; severity: Severity; message: string; details?: Record<string, unknown> }
export interface ComponentFlags { isInsurable: boolean; taxClassification: "TAXABLE" | "NON_TAXABLE" | "CONDITIONAL"; isOtBase: boolean; isProrated: boolean; componentType: "EARNING" | "DEDUCTION" | "EMPLOYER_COST"; code: string; name: string }
export interface PlanLine { componentId: string; role: "BASE" | "ADDITIONAL" | "NOT_APPLICABLE"; sourceType: string; formulaCode?: string; allocation: string }
export interface PlanVersion { id: string; payMode: string; status: string; effectiveFrom: string; effectiveTo: string | null; lines: PlanLine[] }
export interface InputLine {
  id: string; componentId: string; inputType: string; valueState: "PRESENT" | "CONFIRMED_ZERO" | "NOT_APPLICABLE"; amount: string | null; allocatedAmount: string | null;
  workFrom: string; workTo: string; inputHash: string; batchId: string; businessReference: string | null; teamAllocationKey: string | null; formulaCode: string | null;
  bindingVersions: string[]; provenance: string;
}
export interface SalarySegment { componentId: string | null; componentCode: string | null; componentName: string; from: string; to: string; amount: string; salaryBasis: "MONTHLY" | "HOURLY"; source: string; sourceId: string; reference: string }
export interface UnitSegment { orgUnitId: string; orgUnitCode: string; orgUnitName: string; siteId: string | null; wageRegionCode: string | null; costCenterCode: string | null; from: string; to: string; days: number; minimumMonth: { id: string; value: string } | null; minimumHour: { id: string; value: string } | null }
export interface AttendanceDay { workDate: string; workUnits: string; workedMinutes: number; status: string; correctionId: string | null }
export interface ContractInfo { id: string; type: string; salary: string; officialSalary: string | null; salaryBasis: "MONTHLY" | "HOURLY"; startDate: string; endDate: string | null }
/** Confirmed adjustment from an earlier period (late-payment compensation, retro pay) waiting for this open period. */
export interface PendingAdjustment {
  id: string; kind: string; label: string; amount: string; originPeriodCode: string; explanation: string;
  /** Retro pay: the gross difference is income of this payment (taxed by this period's payment date); the insurance difference is deductible. */
  taxable?: { income: string; insuranceEmployee: string };
}
/** Confirmed bonus allocation whose plan pays in this period (FR-7.3.1). */
export interface BonusItem { id: string; planCode: string; label: string; amount: string; componentId: string | null; componentCode: string | null; taxClassification: "TAXABLE" | "NON_TAXABLE" | "CONDITIONAL"; trace: Record<string, unknown> }
export interface EmployeeContext {
  employee: { id: string; code: string; fullName: string; hireDate: string; terminationDate: string | null };
  period: { id: string; code: string; dateFrom: string; dateTo: string; paymentDate: string | null; month: string };
  planVersions: PlanVersion[];
  components: Record<string, ComponentFlags>;
  inputs: InputLine[];
  salary: SalarySegment[];
  units: UnitSegment[];
  attendance: { available: boolean; days: AttendanceDay[]; regularMinutes: string; lockHashes: string[] };
  buckets: PayBucket[];
  bucketHash: string | null;
  contracts: ContractInfo[];
  previousGross: string | null;
  adjustments?: PendingAdjustment[];
  bonuses?: BonusItem[];
  terminations?: TerminationPayItem[];
  benefits?: BenefitItem[];
  params: { standardWorkdays: { id: string; value: string } | null; deductionMaxNetRatio: { id: string; value: string } | null; varianceThreshold: { id: string; value: string } | null; otMonthMaxMinutes: { id: string; value: string } | null; probationMinRatio: { id: string; value: string } | null; roundingScale: number };
}
/** Confirmed termination payments bound to this period (FR-9.3.1, FR-6.2.3): severance/job-loss and unused leave pay. */
export interface TerminationPayItem { id: string; kind: "SEVERANCE" | "JOB_LOSS" | "UNUSED_LEAVE_PAY"; label: string; amount: string; decisionNumber: string; trace: Record<string, unknown> }
/** Confirmed payroll-included welfare allocations of this period (FR-9.2.1); taxed per the catalog's treatment. */
export interface BenefitItem { id: string; code: string; label: string; amount: string; taxTreatment: "TAXABLE" | "NON_TAXABLE" | "EXEMPT_UP_TO_LIMIT"; exemptLimit: string | null; batchCode: string; periodCode: string }
export interface InsuranceOutcome {
  eligible: Record<string, boolean>; reasonCode: string; insurableRaw: string | null; cp07: Violation | null;
  lines: Array<{ kind: string; base: string; employee: string; employer: string; rateId: string | null }>; trace: Record<string, unknown>;
}
export interface TaxItem { sourceRef: string; kind: string; amountPaid: string; basePortion?: string | null; eligibleAmount?: string | null; evidenceRef?: string | null }
export interface TaxOutcome { tax: string; branch: string; rulesetId: string; rulesetCode: string; taxPeriod: string; exceptions: Array<{ code: string; sourceRef: string; message: string }>; trace: Record<string, unknown> }
export interface Hooks {
  insurance(extraInsurable: Array<{ code: string; name: string; amount: string; insurable: boolean }>): Promise<InsuranceOutcome>;
  tax(items: TaxItem[], insuranceEmployee: string): Promise<TaxOutcome>;
  /** Plug-in stages for bonus/welfare (step 4) and retro/late-payment adjustments (step 10). */
  extraEarnings?(ctx: EmployeeContext): Promise<PayLine[]>;
  extraAdjustments?(ctx: EmployeeContext): Promise<PayLine[]>;
}
export interface EmployeeResult {
  employeeId: string; status: "OK" | "ERROR"; errors: Array<{ code: string; message: string; details?: Record<string, unknown> }>;
  lines: PayLine[]; totals: { gross: string; insuranceEmployee: string; unionFee: string; insuranceEmployer: string; tax: string; deductions: string; adjustments: string; net: string; employerCost: string };
  violations: Violation[]; costAllocation: Array<{ costCenterCode: string | null; orgUnitId: string; days: number; ratio: string; amount: string }>;
  hourlyRate: { numerator: string; denominatorHours: string; rate: string } | null; otMinutes: string; sourceHash: string;
}

export class StageError extends Error {
  constructor(readonly code: string, message: string, readonly details?: Record<string, unknown>) { super(message); }
}

const sum = (values: Array<string | Decimal>) => values.reduce<Decimal>((total, value) => total.plus(value), new Money(0));
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return "{" + Object.entries(value).filter(([, item]) => item !== undefined).sort(([left], [right]) => left.localeCompare(right)).map(([name, item]) => JSON.stringify(name) + ":" + canonical(item)).join(",") + "}";
}
export const sha256 = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
const overlaps = (from: string, to: string, otherFrom: string, otherTo: string | null) => from <= (otherTo ?? "9999-12-31") && to >= otherFrom;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / DAY) + 1;

const MAIN_TYPES = new Set(["TIME", "PRODUCT", "PIECEWORK", "COMMISSION", "THREE_P"]);
const REQUIRED_TYPES = new Set(["TIME", "PRODUCT", "PIECEWORK", "COMMISSION", "THREE_P", "ALLOWANCE"]);

/** Stage 0: one effective plan, CONFIRMED-only inputs, no double sources, required lines present (TC-I02, I07). */
export function checkInputs(ctx: EmployeeContext) {
  const versions = ctx.planVersions.filter(version => overlaps(ctx.period.dateFrom, ctx.period.dateTo, version.effectiveFrom, version.effectiveTo));
  if (!versions.length) throw new StageError("PAY_PLAN_MISSING", "Nhân viên chưa có phương án lương hiệu lực trong kỳ.");
  for (let index = 1; index < versions.length; index += 1)
    if (overlaps(versions[index].effectiveFrom, versions[index].effectiveTo ?? "9999-12-31", versions[index - 1].effectiveFrom, versions[index - 1].effectiveTo)) throw new StageError("PAY_PLAN_CONFLICT", "Hai phương án lương chồng hiệu lực.");
  const lines = new Map<string, PlanLine>();
  for (const version of versions) for (const line of version.lines) {
    const prior = lines.get(line.componentId);
    if (prior && (prior.role !== line.role || prior.sourceType !== line.sourceType)) throw new StageError("PAY_PLAN_SEGMENTED", "Phương án đổi vai trò cấu phần giữa kỳ; tách kỳ lương hoặc lập nguồn theo đoạn.", { componentId: line.componentId });
    lines.set(line.componentId, line);
  }
  for (const input of ctx.inputs) {
    const line = lines.get(input.componentId);
    if (input.inputType !== "ADJUSTMENT" && input.inputType !== "DEDUCTION" && input.inputType !== "BONUS" && input.inputType !== "EMPLOYER_COST" && !line) throw new StageError("PAYROLL_INPUT_CONFLICT", "Nguồn đã xác nhận không thuộc phương án lương.", { inputId: input.id });
    if (input.valueState === "NOT_APPLICABLE" && line?.role !== "NOT_APPLICABLE") throw new StageError("PAYROLL_INPUT_CONFLICT", "NOT_APPLICABLE phải khớp dòng không áp dụng của phương án.", { inputId: input.id });
  }
  const seen = new Map<string, InputLine[]>();
  for (const input of ctx.inputs) {
    if (input.inputType === "ADJUSTMENT") continue;
    const key = [input.componentId, input.inputType, input.businessReference ?? ""].join("|");
    const prior = seen.get(key) ?? [];
    if (prior.some(other => other.batchId !== input.batchId && overlaps(input.workFrom, input.workTo, other.workFrom, other.workTo) && other.inputHash !== input.inputHash))
      throw new StageError("PAYROLL_SOURCE_DUPLICATE", "Hai nguồn xác nhận cùng cấu phần/mốc chồng khoảng; không cộng trùng.", { componentId: input.componentId });
    if (prior.some(other => other.inputHash === input.inputHash)) continue;
    seen.set(key, [...prior, input]);
  }
  return { planLines: [...lines.values()], versions };
}

function round(value: Decimal, scale: number) { return new Money(value).toDecimalPlaces(scale, Decimal.ROUND_HALF_UP); }
function flagsOf(ctx: EmployeeContext, componentId: string): ComponentFlags {
  const flags = ctx.components[componentId];
  if (!flags) throw new StageError("PAYROLL_COMPONENT_MISSING", "Không có phiên bản cấu phần lương hiệu lực.", { componentId });
  return flags;
}
function lineFlags(flags: ComponentFlags) { return { isInsurable: flags.isInsurable, taxClassification: flags.taxClassification, isOtBase: flags.isOtBase, componentType: flags.componentType }; }

function paidUnits(ctx: EmployeeContext, from: string, to: string) {
  return sum(ctx.attendance.days.filter(day => day.workDate >= from && day.workDate <= to).map(day => day.workUnits));
}
function workedHours(ctx: EmployeeContext, from: string, to: string) {
  return sum(ctx.attendance.days.filter(day => day.workDate >= from && day.workDate <= to).map(day => String(day.workedMinutes))).div(60);
}

/** Stage 1: main pay by plan — confirmed inputs first; a TIME base line without input is computed from the salary timeline (FIX-01, TC-P02). */
export function mainPay(ctx: EmployeeContext, planLines: PlanLine[]): PayLine[] {
  const scale = ctx.params.roundingScale;
  const lines: PayLine[] = [];
  for (const planLine of planLines) {
    if (planLine.role === "NOT_APPLICABLE") continue;
    const flags = flagsOf(ctx, planLine.componentId);
    const inputs = ctx.inputs.filter(input => input.componentId === planLine.componentId && input.inputType !== "ADJUSTMENT" && input.inputType !== "DEDUCTION");
    const lineType: LineType = MAIN_TYPES.has(planLine.sourceType) ? "MAIN" : planLine.sourceType === "BONUS" ? "BONUS" : planLine.sourceType === "EMPLOYER_COST" ? "EMPLOYER_COST" : "ALLOWANCE";
    if (inputs.length) {
      const unique = [...new Map(inputs.map(input => [input.inputHash, input])).values()];
      for (const input of unique) {
        const raw = input.valueState === "CONFIRMED_ZERO" ? new Money(0) : new Money(input.teamAllocationKey ? input.allocatedAmount ?? "0" : input.amount ?? "0");
        lines.push({ lineType, label: flags.name, componentId: planLine.componentId, componentCode: flags.code, amount: round(raw, scale).toString(), flags: lineFlags(flags),
          sourceReference: input.businessReference ?? undefined,
          trace: { source: "CONFIRMED_INPUT", inputId: input.id, valueState: input.valueState, formulaCode: input.formulaCode, rawAmount: raw.toString(), teamAllocationKey: input.teamAllocationKey, workFrom: input.workFrom, workTo: input.workTo, provenance: input.provenance },
          sources: [{ sourceType: "PAYROLL_INPUT_LINE", sourceId: input.id, sourceHash: input.inputHash }, ...input.bindingVersions.map(versionId => ({ sourceType: "CONFIGURATION_VERSION", sourceId: versionId, versionId }))] });
      }
      continue;
    }
    if (!REQUIRED_TYPES.has(planLine.sourceType)) continue;
    if (planLine.sourceType === "TIME" || planLine.sourceType === "ALLOWANCE") {
      const segments = ctx.salary.filter(segment => planLine.sourceType === "TIME" ? segment.componentId === null : segment.componentId === planLine.componentId);
      if (!segments.length) throw new StageError("PAYROLL_INPUT_MISSING", "Thiếu nguồn lương cho cấu phần " + flags.code + "; không coi là 0.", { componentId: planLine.componentId });
      if (!ctx.attendance.available) throw new StageError("PAYROLL_INPUT_MISSING", "Thiếu công đã khóa của nhân viên trong kỳ.", { source: "ATTENDANCE" });
      const standard = ctx.params.standardWorkdays;
      if (!standard) throw new StageError("PAYROLL_PARAMETER_MISSING", "Thiếu tham số ngày công chuẩn PAYROLL_STANDARD_WORKDAYS.");
      const parts = segments.map(segment => {
        const prorate = planLine.sourceType === "TIME" || flags.isProrated;
        if (segment.salaryBasis === "HOURLY") {
          const hours = workedHours(ctx, segment.from, segment.to);
          return { segment, quantity: hours.toString(), unit: "giờ", amount: new Money(segment.amount).times(hours) };
        }
        const units = paidUnits(ctx, segment.from, segment.to);
        const amount = prorate ? new Money(segment.amount).times(units).div(standard.value) : new Money(segment.amount);
        return { segment, quantity: units.toString(), unit: "công", amount };
      });
      const total = sum(parts.map(part => part.amount));
      lines.push({ lineType, label: flags.name, componentId: planLine.componentId, componentCode: flags.code, amount: round(total, scale).toString(), flags: lineFlags(flags), paramCode: "PAYROLL_STANDARD_WORKDAYS",
        quantity: sum(parts.map(part => part.quantity)).toString(),
        trace: { source: "SALARY_TIMELINE", formula: planLine.sourceType === "TIME" || flags.isProrated ? "lương_tháng × công_được_trả ÷ công_chuẩn" : "mức cố định", standardWorkdays: standard.value,
          segments: parts.map(part => ({ from: part.segment.from, to: part.segment.to, rate: part.segment.amount, basis: part.segment.salaryBasis, quantity: part.quantity, unit: part.unit, amount: part.amount.toString(), source: part.segment.source, reference: part.segment.reference })) },
        sources: [...parts.map(part => ({ sourceType: part.segment.source === "CONTRACT" ? "EMPLOYMENT_CONTRACT" : "SALARY_DECISION", sourceId: part.segment.sourceId })), { sourceType: "LEGAL_PARAMETER", sourceId: standard.id }, ...ctx.attendance.lockHashes.map(hash => ({ sourceType: "ATTENDANCE_LOCK", sourceId: hash, sourceHash: hash }))] });
      continue;
    }
    throw new StageError("PAYROLL_INPUT_MISSING", "Thiếu nguồn xác nhận cho cấu phần bắt buộc " + flags.code + "; không coi là 0.", { componentId: planLine.componentId, sourceType: planLine.sourceType });
  }
  return lines;
}

/** Stages 2–3: hourly rate per BR-15 (Σ OT-base pay ÷ normal hours worked, never 26 × 8) then OT and night allowance. */
export function overtimeStages(ctx: EmployeeContext, earned: PayLine[]) {
  const scale = ctx.params.roundingScale;
  const otBuckets = ctx.buckets.filter(bucket => bucket.kind === "OT"), nightBuckets = ctx.buckets.filter(bucket => bucket.kind === "NIGHT_REGULAR");
  if (!otBuckets.length && !nightBuckets.length) return { lines: [] as PayLine[], hourly: null, nightBase: null as Decimal | null };
  const numerator = sum(earned.filter(line => line.flags?.isOtBase).map(line => line.amount));
  const denominator = new Money(ctx.attendance.regularMinutes).div(60);
  if (numerator.lte(0) || denominator.lte(0)) throw new StageError("PAYROLL_INPUT_MISSING", "Thiếu tử số (cấu phần căn cứ OT) hoặc mẫu số (giờ bình thường đã khóa) để dựng đơn giá giờ OT.", { numerator: numerator.toString(), denominatorHours: denominator.toString() });
  const hourly = numerator.div(denominator);
  const hourlyTrace = { numerator: numerator.toString(), denominatorHours: denominator.toString(), rate: hourly.toString() };
  const lines: PayLine[] = [];
  const sources = (buckets: PayBucket[]) => [{ sourceType: "OVERTIME_PAY_BUCKETS", sourceId: ctx.period.id, sourceHash: ctx.bucketHash }, ...buckets.map(bucket => ({ sourceType: "OVERTIME_BUCKET", sourceId: [bucket.workDate, bucket.kind, bucket.dayType, bucket.isNight, bucket.hasDayOt].join(":") }))];
  if (otBuckets.length) {
    const pay = otPay(hourly.toString(), otBuckets);
    lines.push({ lineType: "OT", label: "Tiền làm thêm giờ", componentId: null, componentCode: null, amount: round(new Money(pay.amount), scale).toString(), quantity: sum(pay.lines.map(line => line.hours)).toString(), rate: hourly.toString(),
      paramCode: "OT_RATE_*", trace: { hourlyRate: hourlyTrace, buckets: pay.lines, rawAmount: pay.amount }, sources: sources(otBuckets),
      flags: { isInsurable: false, taxClassification: "CONDITIONAL", isOtBase: false, componentType: "EARNING" } });
  }
  let nightBase: Decimal | null = null;
  if (nightBuckets.length) {
    const pay = nightAllowancePay(hourly.toString(), nightBuckets);
    const hours = sum(pay.lines.map(line => line.hours));
    nightBase = hourly.times(hours);
    lines.push({ lineType: "NIGHT_ALLOWANCE", label: "Phụ cấp làm việc ban đêm", componentId: null, componentCode: null, amount: round(new Money(pay.amount), scale).toString(), quantity: hours.toString(), rate: hourly.toString(),
      paramCode: "NIGHT_ALLOWANCE_RATE", trace: { hourlyRate: hourlyTrace, buckets: pay.lines, rawAmount: pay.amount, nightBasePortion: nightBase.toString() }, sources: sources(nightBuckets),
      flags: { isInsurable: false, taxClassification: "CONDITIONAL", isOtBase: false, componentType: "EARNING" } });
  }
  return { lines, hourly: hourlyTrace, nightBase };
}

const MEAL = /(^|_)AN_CA|SUAT_AN|MEAL/;
/** Classifies each earning once into PIT income items; the night base portion is split out of time pay only once (TC-T06). */
export function taxItems(earnings: PayLine[], nightBase: Decimal | null, hourly: { rate: string } | null): TaxItem[] {
  const items: TaxItem[] = [];
  let remainingNightBase = nightBase ?? new Money(0);
  earnings.forEach((line, index) => {
    const ref = `${line.lineType}:${line.componentCode ?? "SYSTEM"}:${index}`;
    if (line.lineType === "OT") {
      const hours = new Money(line.quantity ?? "0");
      items.push({ sourceRef: ref, kind: "OT", amountPaid: line.amount, basePortion: hourly ? round(hours.times(hourly.rate), 6).toString() : null, eligibleAmount: line.amount, evidenceRef: "overtime_pay_bucket LOCKED" });
    } else if (line.lineType === "NIGHT_ALLOWANCE") {
      items.push({ sourceRef: ref, kind: "NIGHT_ALLOWANCE", amountPaid: line.amount, eligibleAmount: line.amount, evidenceRef: "overtime_pay_bucket LOCKED" });
    } else if (line.lineType === "BENEFIT" && line.trace.taxTreatment === "EXEMPT_UP_TO_LIMIT") {
      const exempt = Decimal.min(line.amount, String(line.trace.exemptLimit ?? "0"));
      items.push({ sourceRef: ref, kind: "NON_TAXABLE", amountPaid: exempt.toString() });
      items.push({ sourceRef: ref + ":OVER_LIMIT", kind: "SALARY", amountPaid: new Money(line.amount).minus(exempt).toString() });
    } else if (line.lineType === "TERMINATION" && line.componentCode === "UNUSED_LEAVE_PAY") {
      // Exempt only where the ruleset's ELIGIBLE_PAYMENT mode allows it (TC-T13); the decision is the evidence.
      items.push({ sourceRef: ref, kind: "UNUSED_LEAVE", amountPaid: line.amount, eligibleAmount: line.amount, evidenceRef: line.sourceReference ?? null });
    } else if (line.flags?.taxClassification === "NON_TAXABLE") items.push({ sourceRef: ref, kind: "NON_TAXABLE", amountPaid: line.amount });
    else if (line.flags?.taxClassification === "CONDITIONAL" && MEAL.test(line.componentCode ?? "")) items.push({ sourceRef: ref, kind: "MEAL", amountPaid: line.amount });
    else if (line.lineType === "MAIN" && line.flags?.isOtBase && remainingNightBase.gt(0)) {
      const split = Decimal.min(remainingNightBase, line.amount);
      remainingNightBase = remainingNightBase.minus(split);
      items.push({ sourceRef: ref, kind: "SALARY", amountPaid: new Money(line.amount).minus(split).toString() });
      items.push({ sourceRef: ref + ":NIGHT_BASE", kind: "NIGHT_BASE_PORTION", amountPaid: split.toString(), eligibleAmount: split.toString(), evidenceRef: "overtime_pay_bucket LOCKED" });
    } else items.push({ sourceRef: ref, kind: "SALARY", amountPaid: line.amount });
  });
  return items.filter(item => !new Money(item.amountPaid).isZero() || item.kind === "SALARY");
}

/** CP checks that only need this employee's lines and sources (CP-01/02/03/04/05/06/07/09). */
export function employeeChecks(ctx: EmployeeContext, input: { totals: EmployeeResult["totals"]; mainPay: Decimal; insurance: InsuranceOutcome | null; planLines: PlanLine[] }): Violation[] {
  const violations: Violation[] = [];
  for (const unit of ctx.units) {
    const agreed = ctx.salary.filter(segment => segment.componentId === null && overlaps(unit.from, unit.to, segment.from, segment.to));
    for (const segment of agreed) {
      const minimum = segment.salaryBasis === "HOURLY" ? unit.minimumHour : unit.minimumMonth;
      if (!minimum) { violations.push({ code: "CP-01", severity: "BLOCKING", message: `Thiếu mức lương tối thiểu vùng ${unit.wageRegionCode ?? "?"} để kiểm tra.`, details: { orgUnitId: unit.orgUnitId } }); continue; }
      if (new Money(segment.amount).lt(minimum.value)) violations.push({ code: "CP-01", severity: "BLOCKING", message: `Lương ${segment.salaryBasis === "HOURLY" ? "giờ" : "tháng"} ${segment.amount} thấp hơn mức tối thiểu vùng ${unit.wageRegionCode} (${minimum.value}) — NĐ 293/2025/NĐ-CP.`, details: { orgUnitId: unit.orgUnitId, region: unit.wageRegionCode, from: unit.from > segment.from ? unit.from : segment.from, to: unit.to < segment.to ? unit.to : segment.to, salary: segment.amount, minimum: minimum.value, parameterId: minimum.id } });
    }
  }
  const ratio = ctx.params.probationMinRatio;
  for (const contract of ctx.contracts.filter(item => item.type === "PROBATION" && item.officialSalary && overlaps(ctx.period.dateFrom, ctx.period.dateTo, item.startDate, item.endDate)))
    if (ratio && new Money(contract.salary).lt(new Money(contract.officialSalary!).times(ratio.value))) violations.push({ code: "CP-02", severity: "BLOCKING", message: `Lương thử việc dưới ${new Money(ratio.value).times(100).toString()}% lương chính thức.`, details: { contractId: contract.id } });
  const otMinutes = sum(ctx.buckets.filter(bucket => bucket.kind === "OT").map(bucket => bucket.minutes));
  if (ctx.params.otMonthMaxMinutes && otMinutes.gt(ctx.params.otMonthMaxMinutes.value)) violations.push({ code: "CP-03", severity: "BLOCKING", message: `OT ${otMinutes.div(60).toString()} giờ vượt trần tháng.`, details: { otMinutes: otMinutes.toString(), cap: ctx.params.otMonthMaxMinutes.value } });
  const ratioCap = ctx.params.deductionMaxNetRatio;
  const base = new Money(input.totals.gross).minus(input.totals.insuranceEmployee).minus(input.totals.unionFee).minus(input.totals.tax);
  if (ratioCap && new Money(input.totals.deductions).gt(0) && new Money(input.totals.deductions).gt(Decimal.max(0, base.times(ratioCap.value)))) violations.push({ code: "CP-04", severity: "BLOCKING", message: `Khấu trừ khác vượt ${new Money(ratioCap.value).times(100).toString()}% thu nhập sau BH và thuế; giãn khấu trừ sang các kỳ sau.`, details: { deductions: input.totals.deductions, cap: round(base.times(ratioCap.value), 0).toString(), suggestedThisPeriod: round(Decimal.max(0, base.times(ratioCap.value)), 0).toString() } });
  if (new Money(input.totals.net).isNegative()) violations.push({ code: "CP-05", severity: "BLOCKING", message: "Thực lĩnh âm.", details: { net: input.totals.net } });
  const errors = ctx.attendance.days.filter(day => day.status === "ERR" && !day.correctionId);
  if (errors.length) violations.push({ code: "CP-06", severity: "BLOCKING", message: `Còn ${errors.length} ngày công lỗi chưa giải trình.`, details: { workDates: errors.map(day => day.workDate) } });
  if (input.insurance?.cp07) violations.push(input.insurance.cp07);
  const base0 = input.planLines.find(line => line.role === "BASE");
  if (base0 && ["PRODUCT", "PIECEWORK"].includes(base0.sourceType)) {
    const unit = ctx.units.at(-1), minimum = unit?.minimumMonth;
    const standard = ctx.params.standardWorkdays;
    if (minimum) {
      const expected = ctx.attendance.available && standard ? Decimal.min(1, paidUnits(ctx, ctx.period.dateFrom, ctx.period.dateTo).div(standard.value)).times(minimum.value) : new Money(minimum.value);
      if (input.mainPay.lt(expected)) violations.push({ code: "CP-09", severity: "BLOCKING", message: `Thu nhập sản phẩm thấp hơn lương tối thiểu vùng ${unit!.wageRegionCode} tương ứng công làm việc.`, details: { productPay: input.mainPay.toString(), minimum: round(expected, 0).toString() } });
    }
  }
  return violations;
}

/** CP-08: gross variance against the previous period beyond the threshold is a WARNING needing KT acknowledgement. */
export function varianceCheck(ctx: EmployeeContext, gross: string): Violation | null {
  const threshold = ctx.params.varianceThreshold;
  if (!threshold || ctx.previousGross === null || new Money(ctx.previousGross).isZero()) return null;
  const change = new Money(gross).minus(ctx.previousGross).abs().div(ctx.previousGross);
  return change.gt(threshold.value) ? { code: "CP-08", severity: "WARNING", message: `Tổng thu nhập chênh ${round(change.times(100), 2).toString()}% so với kỳ trước (ngưỡng ${new Money(threshold.value).times(100).toString()}%).`, details: { previousGross: ctx.previousGross, gross, change: change.toString() } } : null;
}

/** Hash of every source an employee's result depends on; equal hashes mean equal results (TC-P06). */
export function contextHash(ctx: EmployeeContext): string {
  return sha256({ period: ctx.period, plan: ctx.planVersions.map(version => version.id), inputs: ctx.inputs.map(input => input.inputHash).sort(), salary: ctx.salary, units: ctx.units, attendance: ctx.attendance, buckets: ctx.bucketHash, contracts: ctx.contracts.map(contract => contract.id), params: ctx.params, components: ctx.components, ...(ctx.adjustments?.length ? { adjustments: ctx.adjustments } : {}), ...(ctx.bonuses?.length ? { bonuses: ctx.bonuses } : {}), ...(ctx.terminations?.length ? { terminations: ctx.terminations } : {}), ...(ctx.benefits?.length ? { benefits: ctx.benefits } : {}) });
}

/** Stage 4 registry entry: bonuses are earnings before gross aggregation, never insurable here, taxed in this payment (FR-7.3.1). */
export function bonusLines(ctx: EmployeeContext): PayLine[] {
  return (ctx.bonuses ?? []).map(item => ({ lineType: "BONUS" as const, label: item.label, componentId: item.componentId, componentCode: item.componentCode ?? item.planCode, amount: round(new Money(item.amount), ctx.params.roundingScale).toString(),
    sourceReference: item.planCode, trace: { source: "BONUS_ALLOCATION", planCode: item.planCode, ...item.trace }, sources: [{ sourceType: "BONUS_ALLOCATION", sourceId: item.id }],
    flags: { isInsurable: false, taxClassification: item.taxClassification, isOtBase: false, componentType: "EARNING" } }));
}

/** Step 4 plug-in: welfare allocations are earnings outside the insurable salary (FR-9.2.1). */
export function benefitLines(ctx: EmployeeContext): PayLine[] {
  return (ctx.benefits ?? []).map(item => ({ lineType: "BENEFIT" as const, label: item.label, componentId: null, componentCode: item.code, amount: round(new Money(item.amount), ctx.params.roundingScale).toString(),
    sourceReference: "Phúc lợi " + item.batchCode, trace: { source: "BENEFIT_ALLOCATION", taxTreatment: item.taxTreatment, exemptLimit: item.exemptLimit, periodCode: item.periodCode },
    sources: [{ sourceType: "BENEFIT_ALLOCATION", sourceId: item.id }],
    flags: { isInsurable: false, taxClassification: item.taxTreatment === "EXEMPT_UP_TO_LIMIT" ? "CONDITIONAL" : item.taxTreatment, isOtBase: false, componentType: "EARNING" } }));
}

/** Step 4 plug-in: termination payments are earnings outside the insurable salary; severance is not taxable income. */
export function terminationLines(ctx: EmployeeContext): PayLine[] {
  return (ctx.terminations ?? []).map(item => ({ lineType: "TERMINATION" as const, label: item.label, componentId: null, componentCode: item.kind, amount: round(new Money(item.amount), ctx.params.roundingScale).toString(),
    sourceReference: "Quyết định chấm dứt " + item.decisionNumber, trace: { source: "TERMINATION_PAYMENT_ITEM", kind: item.kind, decisionNumber: item.decisionNumber, ...item.trace },
    sources: [{ sourceType: "TERMINATION_PAYMENT_ITEM", sourceId: item.id }],
    flags: { isInsurable: false, taxClassification: item.kind === "UNUSED_LEAVE_PAY" ? "CONDITIONAL" : "NON_TAXABLE", isOtBase: false, componentType: "EARNING" } }));
}

/** Stage 10 registry entry: each pending adjustment is its own line naming its origin period (FR-7.5.4, FR-7.4.2). */
export function pendingAdjustmentLines(ctx: EmployeeContext): PayLine[] {
  return (ctx.adjustments ?? []).map(item => ({ lineType: "ADJUSTMENT" as const, label: item.label, componentId: null, componentCode: item.kind, amount: round(new Money(item.amount), ctx.params.roundingScale).toString(),
    sourceReference: "Kỳ gốc " + item.originPeriodCode, trace: { source: "PAYROLL_ADJUSTMENT", kind: item.kind, originPeriodCode: item.originPeriodCode, explanation: item.explanation, rawAmount: item.amount },
    sources: [{ sourceType: "PAYROLL_ADJUSTMENT", sourceId: item.id }] }));
}

/** Paid work units per organisational segment, printed on the payslip for mid-period transfers (UAT-21). */
export function unitWork(ctx: EmployeeContext) {
  return ctx.units.map(unit => ({ orgUnitId: unit.orgUnitId, orgUnitCode: unit.orgUnitCode, orgUnitName: unit.orgUnitName, from: unit.from, to: unit.to, workUnits: paidUnits(ctx, unit.from, unit.to).toString() }));
}

/** Full pipeline for one employee; any stage error isolates this employee as ERROR with a code. */
export async function calculateEmployee(ctx: EmployeeContext, hooks: Hooks): Promise<EmployeeResult> {
  const scale = ctx.params.roundingScale;
  const sourceHash = contextHash(ctx);
  const empty = { gross: "0", insuranceEmployee: "0", unionFee: "0", insuranceEmployer: "0", tax: "0", deductions: "0", adjustments: "0", net: "0", employerCost: "0" };
  try {
    const { planLines } = checkInputs(ctx);
    const main = mainPay(ctx, planLines);
    const overtime = overtimeStages(ctx, main);
    const plugins = [...bonusLines(ctx), ...benefitLines(ctx), ...terminationLines(ctx), ...(hooks.extraEarnings ? await hooks.extraEarnings(ctx) : [])];
    const earnings = [...main.filter(line => line.lineType !== "EMPLOYER_COST"), ...overtime.lines, ...plugins];
    const employerCosts = [...main.filter(line => line.lineType === "EMPLOYER_COST"), ...ctx.inputs.filter(input => input.inputType === "EMPLOYER_COST" && !planLines.some(line => line.componentId === input.componentId)).map(input => inputLine(ctx, input, "EMPLOYER_COST"))];
    const gross = sum(earnings.map(line => line.amount));
    const insurableExtra = earnings.filter(line => line.lineType === "ALLOWANCE" && line.flags?.isInsurable && line.componentId && !ctx.salary.some(segment => segment.componentId === line.componentId)).map(line => ({ code: line.componentCode ?? "ALLOWANCE", name: line.label, amount: line.amount, insurable: true }));
    const insurance = await hooks.insurance(insurableExtra);
    const insuranceLines: PayLine[] = [];
    for (const line of insurance.lines) {
      if (line.kind === "UNION_FEE") { if (!new Money(line.employee).isZero()) insuranceLines.push({ lineType: "UNION_FEE", label: "Đoàn phí công đoàn", componentId: null, componentCode: null, amount: line.employee, paramCode: "UNION_FEE_RATE", trace: { base: line.base }, sources: [{ sourceType: "LEGAL_PARAMETER", sourceId: "UNION_FEE_RATE" }] }); continue; }
      if (!new Money(line.employee).isZero()) insuranceLines.push({ lineType: "INSURANCE_EMPLOYEE", label: line.kind + " (NLĐ)", componentId: null, componentCode: line.kind, amount: line.employee, trace: { base: line.base, kind: line.kind, eligibility: insurance.reasonCode }, sources: line.rateId ? [{ sourceType: "INSURANCE_RATE", sourceId: line.rateId }] : [] });
      if (!new Money(line.employer).isZero()) insuranceLines.push({ lineType: "INSURANCE_EMPLOYER", label: line.kind + " (DN)", componentId: null, componentCode: line.kind, amount: line.employer, trace: { base: line.base, kind: line.kind }, sources: line.rateId ? [{ sourceType: "INSURANCE_RATE", sourceId: line.rateId }] : [] });
    }
    const insuranceEmployee = sum(insuranceLines.filter(line => line.lineType === "INSURANCE_EMPLOYEE").map(line => line.amount));
    const unionFee = sum(insuranceLines.filter(line => line.lineType === "UNION_FEE").map(line => line.amount));
    const retro = (ctx.adjustments ?? []).filter(item => item.taxable);
    const items = [...taxItems(earnings, overtime.nightBase, overtime.hourly), ...retro.filter(item => new Money(item.taxable!.income).gt(0)).map(item => ({ sourceRef: "ADJUSTMENT:" + item.id, kind: "SALARY", amountPaid: item.taxable!.income }))];
    const retroInsurance = sum(retro.map(item => Decimal.max(0, item.taxable!.insuranceEmployee)));
    const tax = await hooks.tax(items, insuranceEmployee.plus(retroInsurance).toString());
    const taxLine: PayLine = { lineType: "TAX", label: "Thuế TNCN", componentId: null, componentCode: null, amount: tax.tax, paramCode: tax.rulesetCode, trace: { ...tax.trace, items, branch: tax.branch, taxPeriod: tax.taxPeriod, exceptions: tax.exceptions }, sources: [{ sourceType: "TAX_RULESET", sourceId: tax.rulesetId }] };
    const deductions = ctx.inputs.filter(input => input.inputType === "DEDUCTION").map(input => inputLine(ctx, input, "DEDUCTION"));
    const adjustments = [...ctx.inputs.filter(input => input.inputType === "ADJUSTMENT").map(input => inputLine(ctx, input, "ADJUSTMENT")), ...pendingAdjustmentLines(ctx), ...(hooks.extraAdjustments ? await hooks.extraAdjustments(ctx) : [])];
    const deductionTotal = sum(deductions.map(line => line.amount)), adjustmentTotal = sum(adjustments.map(line => line.amount));
    const net = round(gross.minus(insuranceEmployee).minus(unionFee).minus(tax.tax).minus(deductionTotal).plus(adjustmentTotal), scale);
    const totals = { gross: gross.toString(), insuranceEmployee: insuranceEmployee.toString(), unionFee: unionFee.toString(), insuranceEmployer: sum(insuranceLines.filter(line => line.lineType === "INSURANCE_EMPLOYER").map(line => line.amount)).toString(), tax: tax.tax, deductions: deductionTotal.toString(), adjustments: adjustmentTotal.toString(), net: net.toString(), employerCost: sum(employerCosts.map(line => line.amount)).toString() };
    const netLine: PayLine = { lineType: "NET", label: "Thực lĩnh", componentId: null, componentCode: null, amount: net.toString(), trace: { formula: "tổng thu nhập − BH − đoàn phí − thuế − khấu trừ khác + điều chỉnh", ...totals }, sources: [] };
    const violations = employeeChecks(ctx, { totals, mainPay: sum(main.filter(line => line.lineType === "MAIN").map(line => line.amount)), insurance, planLines });
    const variance = varianceCheck(ctx, totals.gross);
    if (variance) violations.push(variance);
    for (const exception of tax.exceptions) violations.push({ code: "TAX_EXCEPTION", severity: "BLOCKING", message: exception.message, details: exception });
    const totalDays = ctx.units.reduce((total, unit) => total + unit.days, 0) || 1;
    const costAllocation = ctx.units.map(unit => ({ costCenterCode: unit.costCenterCode, orgUnitId: unit.orgUnitId, days: unit.days, ratio: new Money(unit.days).div(totalDays).toDecimalPlaces(6).toString(), amount: round(gross.times(unit.days).div(totalDays), scale).toString() }));
    return { employeeId: ctx.employee.id, status: "OK", errors: [], lines: [...earnings, ...insuranceLines, taxLine, ...deductions, ...adjustments, ...employerCosts, netLine], totals, violations, costAllocation, hourlyRate: overtime.hourly, otMinutes: sum(ctx.buckets.filter(bucket => bucket.kind === "OT").map(bucket => bucket.minutes)).toString(), sourceHash };
  } catch (error) {
    if (error instanceof StageError) return { employeeId: ctx.employee.id, status: "ERROR", errors: [{ code: error.code, message: error.message, details: error.details }], lines: [], totals: empty, violations: [], costAllocation: [], hourlyRate: null, otMinutes: "0", sourceHash };
    throw error;
  }
}

function inputLine(ctx: EmployeeContext, input: InputLine, lineType: LineType): PayLine {
  const flags = ctx.components[input.componentId];
  const raw = input.valueState === "CONFIRMED_ZERO" ? new Money(0) : new Money(input.amount ?? "0");
  return { lineType, label: flags?.name ?? input.inputType, componentId: input.componentId, componentCode: flags?.code ?? null, amount: round(raw, ctx.params.roundingScale).toString(), sourceReference: input.businessReference ?? undefined,
    trace: { source: "CONFIRMED_INPUT", inputId: input.id, inputType: input.inputType, rawAmount: raw.toString() }, sources: [{ sourceType: "PAYROLL_INPUT_LINE", sourceId: input.id, sourceHash: input.inputHash }],
    ...(flags ? { flags: lineFlags(flags) } : {}) };
}

export { daysBetween };
