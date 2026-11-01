import Decimal from "decimal.js";

// Pure PIT math (06 §7–8; BR-52…56). Rulesets, norms and deductions always arrive as resolved inputs.
const Money = Decimal.clone({ precision: 60, rounding: Decimal.ROUND_HALF_UP });
export type TaxSubject = "RESIDENT_PROGRESSIVE" | "RESIDENT_FLAT_10" | "NON_RESIDENT";
export type ExemptionMode = "PREMIUM_ONLY" | "ELIGIBLE_PAYMENT";
export type IncomeKind = "SALARY" | "OT" | "NIGHT_ALLOWANCE" | "NIGHT_BASE_PORTION" | "MEAL" | "UNUSED_LEAVE" | "OTHER_TAXABLE" | "NON_TAXABLE";

export class PitError extends Error {
  constructor(readonly code: string, message: string, readonly details?: Record<string, unknown>) { super(message); }
}

export interface Bracket { basis: "MONTH" | "YEAR"; bracketNo: number; lower: string; upper: string | null; rate: string }
export interface RulesetSettings {
  selfDeduction?: string; dependentDeduction?: string; voluntaryPensionCapMonth?: string; medicalEducationCapYear?: string | null;
  rate?: string; threshold?: string; belowThresholdOnRequestOnly?: boolean;
}
export interface Ruleset { id: string; code: string; subject: TaxSubject; exemptionMode: ExemptionMode; effectiveFrom: string; effectiveTo: string | null; settings: RulesetSettings; brackets: Bracket[]; legalBasis: string; status: string }
export interface TaxContext {
  taxPeriod: string; subject: TaxSubject; ruleset: Ruleset; paymentDate: string; paymentDateStatus: "PROJECTED" | "ACTUAL"; mode: "CALCULATE" | "REPLAY_FILED";
}

/** Picks exactly one ruleset by payment date and subject; never by run date or attendance period (BR-52). */
export function selectTaxContext(input: { rulesets: Ruleset[]; subject: TaxSubject; paymentDate: string; paymentDateStatus: "PROJECTED" | "ACTUAL"; mode?: "CALCULATE" | "REPLAY_FILED"; filed?: TaxContext | null }): TaxContext {
  if (input.mode === "REPLAY_FILED") {
    if (!input.filed) throw new PitError("TAX_REPLAY_SNAPSHOT_MISSING", "Không có snapshot ngữ cảnh của khoản đã khai để tái hiện.");
    return input.filed;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.paymentDate)) throw new PitError("PAYMENT_DATE_REQUIRED", "Cần ngày chi trả thực tế hoặc dự kiến.");
  const matches = input.rulesets.filter(ruleset => ruleset.subject === input.subject && ruleset.effectiveFrom <= input.paymentDate && (ruleset.effectiveTo === null || ruleset.effectiveTo >= input.paymentDate));
  if (matches.length !== 1) throw new PitError("TAX_RULESET_INVALID", `Cần đúng một bộ quy tắc ${input.subject} hiệu lực tại ${input.paymentDate}; tìm thấy ${matches.length}.`, { subject: input.subject, paymentDate: input.paymentDate, count: matches.length });
  return { taxPeriod: input.paymentDate.slice(0, 7), subject: input.subject, ruleset: matches[0], paymentDate: input.paymentDate, paymentDateStatus: input.paymentDateStatus, mode: "CALCULATE" };
}

export interface IncomeItem { sourceRef: string; kind: IncomeKind; amountPaid: string; basePortion?: string | null; eligibleAmount?: string | null; evidenceRef?: string | null }
export interface ExemptionLine { sourceRef: string; kind: IncomeKind; amountPaid: string; exempt: string; taxable: string; rule: string; exception?: string }
export interface ExemptionResult { lines: ExemptionLine[]; exempt: string; taxable: string; exceptions: Array<{ code: string; sourceRef: string; message: string }> }

/**
 * Splits each non-overlapping income item into exempt + taxable (always summing to the amount paid).
 * PREMIUM_ONLY exempts the premium above normal-hour pay; ELIGIBLE_PAYMENT exempts up to the verified
 * eligible amount. Night base pay is its own item so it is never counted twice with time salary (TC-T06).
 */
export function splitExemptions(items: IncomeItem[], mode: ExemptionMode, mealNorm: string | null): ExemptionResult {
  const lines: ExemptionLine[] = [];
  const exceptions: ExemptionResult["exceptions"] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.sourceRef)) throw new PitError("TAX_INCOME_DUPLICATE_SOURCE", "Khoản thu nhập trùng nguồn: " + item.sourceRef);
    seen.add(item.sourceRef);
    const paid = new Money(item.amountPaid);
    if (paid.isNegative()) throw new PitError("TAX_INCOME_NEGATIVE", "Khoản thu nhập âm phải xử lý bằng điều chỉnh: " + item.sourceRef);
    let exempt = new Money(0), rule = "TAXABLE", exception: string | undefined;
    const premium = ["OT", "NIGHT_ALLOWANCE", "NIGHT_BASE_PORTION"].includes(item.kind);
    if (item.kind === "NON_TAXABLE") { exempt = paid; rule = "NON_TAXABLE_COMPONENT"; }
    else if (item.kind === "MEAL") {
      if (mealNorm === null) exception = "TAX_MEAL_NORM_MISSING";
      else { exempt = Decimal.min(paid, mealNorm); rule = "MEAL_NORM"; }
    } else if (premium && mode === "PREMIUM_ONLY") {
      const base = item.kind === "NIGHT_BASE_PORTION" ? paid : item.kind === "NIGHT_ALLOWANCE" ? new Money(0) : item.basePortion != null ? new Money(item.basePortion) : null;
      if (base === null) exception = "TAX_EXEMPTION_EVIDENCE_MISSING";
      else { exempt = Decimal.max(0, paid.minus(base)); rule = "PREMIUM_ONLY"; }
    } else if ((premium || item.kind === "UNUSED_LEAVE") && mode === "ELIGIBLE_PAYMENT") {
      if (item.eligibleAmount == null || !item.evidenceRef) exception = "TAX_EXEMPTION_EVIDENCE_MISSING";
      else { exempt = Decimal.min(paid, item.eligibleAmount); rule = "ELIGIBLE_PAYMENT"; }
    }
    if (exception) exceptions.push({ code: exception, sourceRef: item.sourceRef, message: exception === "TAX_MEAL_NORM_MISSING" ? "Thiếu định mức ăn ca hiệu lực tại ngày chi." : "Thiếu căn cứ xác định phần miễn thuế; chưa được duyệt." });
    lines.push({ sourceRef: item.sourceRef, kind: item.kind, amountPaid: paid.toString(), exempt: new Money(exempt).toString(), taxable: paid.minus(exempt).toString(), rule, ...(exception ? { exception } : {}) });
  }
  return { lines, exempt: lines.reduce((total, line) => total.plus(line.exempt), new Money(0)).toString(), taxable: lines.reduce((total, line) => total.plus(line.taxable), new Money(0)).toString(), exceptions };
}

export function progressiveTax(assessable: string, brackets: Bracket[], basis: "MONTH" | "YEAR" = "MONTH") {
  const rows = brackets.filter(bracket => bracket.basis === basis).sort((left, right) => left.bracketNo - right.bracketNo);
  if (!rows.length) throw new PitError("TAX_RULESET_INVALID", "Bộ quy tắc thiếu biểu bậc " + basis + ".");
  const base = Decimal.max(0, assessable);
  let tax = new Money(0);
  const parts = rows.map(bracket => {
    const top = bracket.upper === null ? base : Decimal.min(base, bracket.upper);
    const portion = Decimal.max(0, new Money(top).minus(bracket.lower));
    const amount = portion.times(bracket.rate);
    tax = tax.plus(amount);
    return { bracketNo: bracket.bracketNo, lower: bracket.lower, upper: bracket.upper, rate: bracket.rate, portion: portion.toString(), tax: amount.toString() };
  });
  return { raw: tax.toString(), tax: tax.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toString(), parts };
}

export interface Deductions { insurance: string; dependents: number; voluntaryPension?: string; charity?: string; medicalEducation?: string; medicalEducationUsedThisYear?: string }
export interface WithholdingResult {
  branch: "PROGRESSIVE" | "FLAT_10" | "NON_RESIDENT_20"; context: TaxContext; exemptions: ExemptionResult;
  taxableIncome: string; deductions: Record<string, string>; assessableIncome: string; tax: string; rawTax: string;
  brackets: ReturnType<typeof progressiveTax>["parts"]; notes: string[];
}

/** Residents with a ≥ 3-month contract: personal/dependent/insurance deductions then monthly brackets. */
export function progressive(context: TaxContext, exemptions: ExemptionResult, deductions: Deductions): WithholdingResult {
  const settings = context.ruleset.settings;
  if (!settings.selfDeduction || !settings.dependentDeduction) throw new PitError("TAX_RULESET_INVALID", "Bộ quy tắc lũy tiến thiếu mức giảm trừ gia cảnh.");
  const pensionCap = settings.voluntaryPensionCapMonth ? new Money(settings.voluntaryPensionCapMonth) : new Money(0);
  const medicalCap = settings.medicalEducationCapYear ? Decimal.max(0, new Money(settings.medicalEducationCapYear).minus(deductions.medicalEducationUsedThisYear ?? 0)) : new Money(0);
  const used = {
    self: new Money(settings.selfDeduction),
    dependents: new Money(settings.dependentDeduction).times(deductions.dependents),
    insurance: new Money(deductions.insurance),
    voluntaryPension: Decimal.min(deductions.voluntaryPension ?? 0, pensionCap),
    charity: new Money(deductions.charity ?? 0),
    medicalEducation: Decimal.min(deductions.medicalEducation ?? 0, medicalCap),
  };
  const total = Object.values(used).reduce((sum, value) => sum.plus(value), new Money(0));
  const assessable = Decimal.max(0, new Money(exemptions.taxable).minus(total));
  const tax = progressiveTax(assessable.toString(), context.ruleset.brackets);
  return { branch: "PROGRESSIVE", context, exemptions, taxableIncome: exemptions.taxable, deductions: { ...Object.fromEntries(Object.entries(used).map(([name, value]) => [name, new Money(value).toString()])), total: total.toString() }, assessableIncome: assessable.toString(), tax: tax.tax, rawTax: tax.raw, brackets: tax.parts, notes: [] };
}

/** Residents without a contract or with < 3 months: 10% per payment against the threshold, no family deductions. */
export function flat10(context: TaxContext, exemptions: ExemptionResult, options: { commitment: boolean; voluntaryRequest: boolean }): WithholdingResult {
  const settings = context.ruleset.settings;
  if (!settings.rate || !settings.threshold) throw new PitError("TAX_RULESET_INVALID", "Bộ quy tắc 10% thiếu thuế suất hoặc ngưỡng.");
  const taxable = new Money(exemptions.taxable);
  const notes: string[] = [];
  let withhold: boolean;
  if (taxable.gte(settings.threshold)) {
    withhold = !options.commitment;
    if (options.commitment) notes.push("COMMITMENT_ON_FILE");
  } else {
    withhold = settings.belowThresholdOnRequestOnly === true && options.voluntaryRequest;
    notes.push(withhold ? "VOLUNTARY_REQUEST" : "BELOW_THRESHOLD");
  }
  const raw = withhold ? taxable.times(settings.rate) : new Money(0);
  return { branch: "FLAT_10", context, exemptions, taxableIncome: taxable.toString(), deductions: { total: "0" }, assessableIncome: taxable.toString(), tax: raw.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toString(), rawTax: raw.toString(), brackets: [], notes };
}

/** Non-residents: flat rate on Vietnam-sourced taxable income, never family deductions or brackets. */
export function nonResident20(context: TaxContext, exemptions: ExemptionResult): WithholdingResult {
  const rate = context.ruleset.settings.rate;
  if (!rate) throw new PitError("TAX_RULESET_INVALID", "Bộ quy tắc không cư trú thiếu thuế suất.");
  const raw = new Money(exemptions.taxable).times(rate);
  return { branch: "NON_RESIDENT_20", context, exemptions, taxableIncome: exemptions.taxable, deductions: { total: "0" }, assessableIncome: exemptions.taxable, tax: raw.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toString(), rawTax: raw.toString(), brackets: [], notes: [] };
}

export function withhold(context: TaxContext, items: IncomeItem[], mealNorm: string | null, deductions: Deductions, options: { commitment: boolean; voluntaryRequest: boolean }): WithholdingResult {
  const exemptions = splitExemptions(items, context.ruleset.exemptionMode, mealNorm);
  if (context.subject === "RESIDENT_PROGRESSIVE") return progressive(context, exemptions, deductions);
  if (context.subject === "RESIDENT_FLAT_10") return flat10(context, exemptions, options);
  return nonResident20(context, exemptions);
}

/** Bisection on whole đồng: the smallest gross whose net is within 1 đồng of the target (BR-56). */
export function grossUp(targetNet: string, netFromGross: (gross: Decimal) => Decimal, maxIterations = 100) {
  const target = new Money(targetNet);
  if (!target.gt(0)) throw new PitError("GROSS_UP_INVALID", "Lương NET phải dương.");
  let low = target.floor(), high = target.times(2).ceil();
  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const mid = low.plus(high).div(2).floor();
    const net = netFromGross(mid);
    if (net.minus(target).abs().lte(1)) return { gross: mid.toString(), net: net.toString(), iterations: iteration, difference: net.minus(target).toString() };
    if (net.lt(target)) low = mid.plus(1); else high = mid.minus(1);
    if (low.gt(high)) break;
  }
  throw new PitError("GROSS_UP_NOT_CONVERGED", "Không tìm được GROSS với sai số ≤ 1 đồng sau " + maxIterations + " vòng.");
}

/** NET of a monthly time-salary gross: insurance per kind clamped to [floor, cap] then the context's PIT branch. */
export function netCalculator(input: { context: TaxContext; dependents: number; insurance: Array<{ kind: string; employeeRate: string; cap: string | null }>; insuranceFloor: string | null }) {
  return (gross: Decimal): Decimal => {
    const g = new Money(gross);
    let insurance = new Money(0);
    for (const line of input.insurance) {
      let base = input.insuranceFloor ? Decimal.max(g, input.insuranceFloor) : g;
      if (line.cap) base = Decimal.min(base, line.cap);
      insurance = insurance.plus(new Money(base).times(line.employeeRate).toDecimalPlaces(0, Decimal.ROUND_HALF_UP));
    }
    const result = withhold(input.context, [{ sourceRef: "gross", kind: "SALARY", amountPaid: g.toString() }], null, { insurance: insurance.toString(), dependents: input.dependents }, { commitment: false, voluntaryRequest: false });
    return g.minus(insurance).minus(result.tax);
  };
}
