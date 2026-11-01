import Decimal from "decimal.js";
import { compileFormula } from "../../payroll-configuration/formula-engine";

// Pure bonus rules (FR-7.3.1, FR-7.2.6, BR-45, TC-I07). Variables such as TARGET, KPI_RATE, ATTENDANCE_SCORE come from confirmed sources.
export class BonusRuleError extends Error {
  constructor(readonly code: string, message: string, readonly details?: Record<string, unknown>) { super(message); }
}
export interface BonusVariable { name: string; defaultValue?: string | null }
export interface BonusPlanRule { calculationMode: "AMOUNT" | "FORMULA"; amount?: string | null; formula?: string | null; variables: BonusVariable[] }

export function validatePlanRule(rule: BonusPlanRule) {
  if (rule.calculationMode === "AMOUNT") {
    if (!rule.amount || !/^\d{1,13}(\.\d{1,2})?$/.test(rule.amount) || new Decimal(rule.amount).lte(0)) throw new BonusRuleError("BONUS_AMOUNT_INVALID", "Số tiền thưởng cố định phải là số dương, tối đa 2 chữ số thập phân.");
    return;
  }
  try { compileFormula(rule.formula ?? "", rule.variables.map(variable => variable.name)); }
  catch (error) { throw new BonusRuleError("BONUS_FORMULA_INVALID", (error as Error).message); }
  for (const variable of rule.variables) if (variable.defaultValue != null && !/^-?\d{1,13}(\.\d{1,6})?$/.test(variable.defaultValue)) throw new BonusRuleError("BONUS_FORMULA_INVALID", `Giá trị mặc định của ${variable.name} không hợp lệ.`);
}

/** Amount for one employee; formula inputs fall back to plan defaults, a missing value blocks instead of counting as 0. */
export function computeBonus(rule: BonusPlanRule, inputs: Record<string, string>) {
  if (rule.calculationMode === "AMOUNT") return { amount: new Decimal(rule.amount!).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toString(), values: {} as Record<string, string> };
  const values: Record<string, string> = {};
  for (const variable of rule.variables) {
    const value = inputs[variable.name] ?? variable.defaultValue ?? null;
    if (value === null || value === "" || !/^-?\d{1,13}(\.\d{1,6})?$/.test(String(value))) throw new BonusRuleError("BONUS_INPUT_MISSING", `Thiếu hoặc sai giá trị ${variable.name}; không coi là 0.`, { variable: variable.name });
    values[variable.name] = String(value);
  }
  const raw = compileFormula(rule.formula!, rule.variables.map(variable => variable.name)).evaluate(new Map(Object.entries(values)));
  if (raw.isNegative()) throw new BonusRuleError("BONUS_NEGATIVE", "Thưởng không được âm; điểm chuyên cần hay KPI không dùng để trừ lương.", { raw: raw.toString() });
  return { amount: raw.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toString(), values, raw: raw.toString() };
}

/**
 * TC-I07: a KPI bonus and the employee's P3 pay must not count the same evaluation twice unless the bonus has its own decision.
 * Same source = the bonus plan's KPI reference equals the P3 plan line reference or a confirmed P3 input's business reference.
 */
export function p3Conflict(plan: { kpiSourceReference: string | null; independentDecisionRef: string | null }, employee: { planLines: Array<{ sourceType: string; sourceReference?: string | null }>; p3InputReferences: string[] }) {
  const reference = plan.kpiSourceReference?.trim();
  if (!reference || plan.independentDecisionRef?.trim()) return null;
  const p3Lines = employee.planLines.filter(line => line.sourceType === "THREE_P");
  if (!p3Lines.length) return null;
  const shared = p3Lines.some(line => line.sourceReference?.trim() === reference) || employee.p3InputReferences.some(item => item.trim() === reference);
  return shared ? { code: "BONUS_P3_DOUBLE_COUNT", detail: `Thưởng dùng cùng nguồn KPI "${reference}" đã dùng làm P3 trong phương án lương mà không có quyết định độc lập.` } : null;
}
