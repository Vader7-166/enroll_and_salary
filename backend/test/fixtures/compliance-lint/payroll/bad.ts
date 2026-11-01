// Fixture for lint-compliance.test.cjs: every line below breaks one rule on purpose.
declare const line: { amount: string; netSalary: { toNumber(): number } };
declare function legalParameter(code: string, at: Date): number;
export const a = parseFloat(line.amount);
export const b = Number(line.amount);
export const c = line.netSalary.toNumber();
export const minimum = 4960000;
export const rate = 0.175;
export const p = legalParameter("REGION_MIN_WAGE", new Date());
// compliance-lint-ignore money-float: documented boundary
export const ignored = Number(line.amount);
export const months = Number(legalParameter("SEVERANCE_MONTHS", new Date(2026, 0, 1)));
