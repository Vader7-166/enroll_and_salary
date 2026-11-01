// Data-only benefit eligibility (FR-9.1.2): a closed schema evaluated at the batch reference date, never an expression.

export interface EligibilityRule { minServiceMonths?: number; jobGradeCodes?: string[]; contractTypes?: string[]; orgUnitIds?: string[] }
export interface EmployeeFacts { employed: boolean; serviceMonths: number; jobGradeCode: string | null; contractType: string | null; unitPath: string[] }
export interface FailedRule { rule: "EMPLOYED" | keyof EligibilityRule; expected: unknown; actual: unknown }

const KEYS = new Set(["minServiceMonths", "jobGradeCodes", "contractTypes", "orgUnitIds"]);
const CONTRACT_TYPES = new Set(["INDEFINITE", "FIXED_TERM", "PROBATION", "UNDER_ONE_MONTH", "PIECEWORK", "COLLABORATOR"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class EligibilityError extends Error {}

export function parseEligibility(value: unknown): EligibilityRule {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new EligibilityError("Điều kiện hưởng phải là đối tượng.");
  const rule: EligibilityRule = {};
  for (const [field, item] of Object.entries(value)) {
    if (!KEYS.has(field)) throw new EligibilityError("Điều kiện hưởng không hỗ trợ trường " + field + ".");
    const list = (check: (entry: unknown) => boolean, label: string) => {
      if (!Array.isArray(item) || !item.length || item.length > 100 || !item.every(check) || new Set(item).size !== item.length) throw new EligibilityError(label + " phải là danh sách không rỗng, không trùng.");
      return item as string[];
    };
    if (field === "minServiceMonths") {
      if (!Number.isInteger(item) || (item as number) < 0 || (item as number) > 600) throw new EligibilityError("Thâm niên tối thiểu phải là số tháng nguyên 0–600.");
      rule.minServiceMonths = item as number;
    } else if (field === "jobGradeCodes") rule.jobGradeCodes = list(entry => typeof entry === "string" && /^[A-Z0-9_-]{1,10}$/.test(entry), "Cấp bậc");
    else if (field === "contractTypes") rule.contractTypes = list(entry => typeof entry === "string" && CONTRACT_TYPES.has(entry), "Loại hợp đồng");
    else rule.orgUnitIds = list(entry => typeof entry === "string" && UUID.test(entry), "Đơn vị");
  }
  return rule;
}

/** Every failed rule is reported so KT sees why a person is out; units match their whole subtree. */
export function evaluate(rule: EligibilityRule, facts: EmployeeFacts): { eligible: boolean; failed: FailedRule[] } {
  const failed: FailedRule[] = [];
  if (!facts.employed) failed.push({ rule: "EMPLOYED", expected: true, actual: false });
  if (rule.minServiceMonths !== undefined && facts.serviceMonths < rule.minServiceMonths) failed.push({ rule: "minServiceMonths", expected: rule.minServiceMonths, actual: facts.serviceMonths });
  if (rule.jobGradeCodes && !(facts.jobGradeCode && rule.jobGradeCodes.includes(facts.jobGradeCode))) failed.push({ rule: "jobGradeCodes", expected: rule.jobGradeCodes, actual: facts.jobGradeCode });
  if (rule.contractTypes && !(facts.contractType && rule.contractTypes.includes(facts.contractType))) failed.push({ rule: "contractTypes", expected: rule.contractTypes, actual: facts.contractType });
  if (rule.orgUnitIds && !rule.orgUnitIds.some(id => facts.unitPath.includes(id))) failed.push({ rule: "orgUnitIds", expected: rule.orgUnitIds, actual: facts.unitPath[0] ?? null });
  return { eligible: failed.length === 0, failed };
}
