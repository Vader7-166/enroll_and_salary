import Decimal from "decimal.js";
import { progressiveTax, type Ruleset } from "../pit-engine";

// Pure annual settlement (FR-8.5.1, BR-55): the YEAR brackets apply to the year's assessable income, never a monthly rate.
const Money = Decimal.clone({ precision: 60, rounding: Decimal.ROUND_HALF_UP });

export interface WithholdingFacts {
  id: string; paymentKey: string; paymentDate: string; rulesetCode: string; branch: string; filingStatus: string;
  taxable: string; exempt: string; insurance: string; voluntaryPension: string; charity: string; medicalEducation: string; tax: string;
}

export function annualSettlement(input: { rows: WithholdingFacts[]; ruleset: Pick<Ruleset, "code" | "settings" | "brackets">; selfMonths: number; dependentMonths: number }) {
  const settings = input.ruleset.settings;
  if (!settings.selfDeduction || !settings.dependentDeduction) throw new Error("TAX_RULESET_INVALID");
  const sum = (pick: (row: WithholdingFacts) => string) => input.rows.reduce((total, row) => total.plus(pick(row)), new Money(0));
  const taxableIncome = sum(row => row.taxable), exempt = sum(row => row.exempt);
  const pensionCap = new Money(settings.voluntaryPensionCapMonth ?? 0).times(12);
  const medicalCap = settings.medicalEducationCapYear ? new Money(settings.medicalEducationCapYear) : new Money(0);
  const deductions = {
    self: new Money(settings.selfDeduction).times(input.selfMonths),
    dependents: new Money(settings.dependentDeduction).times(input.dependentMonths),
    insurance: sum(row => row.insurance),
    voluntaryPension: Decimal.min(sum(row => row.voluntaryPension), pensionCap),
    charity: sum(row => row.charity),
    medicalEducation: Decimal.min(sum(row => row.medicalEducation), medicalCap),
  };
  const totalDeductions = Object.values(deductions).reduce((total, value) => total.plus(value), new Money(0));
  const assessable = Decimal.max(0, taxableIncome.minus(totalDeductions));
  const tax = progressiveTax(assessable.toString(), input.ruleset.brackets, "YEAR");
  const withheld = sum(row => row.tax);
  const difference = new Money(tax.tax).minus(withheld);
  const text = (value: Decimal.Value) => new Money(value).toString();
  return {
    rulesetCode: input.ruleset.code, payments: input.rows.length, totalIncome: text(taxableIncome.plus(exempt)), exempt: text(exempt), taxableIncome: text(taxableIncome),
    selfMonths: input.selfMonths, dependentMonths: input.dependentMonths,
    deductions: Object.fromEntries(Object.entries(deductions).map(([name, value]) => [name, text(value)])) as Record<keyof typeof deductions, string>,
    totalDeductions: text(totalDeductions), assessableIncome: text(assessable), annualTax: tax.tax, brackets: tax.parts, withheld: text(withheld),
    difference: difference.toString(), direction: difference.gt(0) ? "PAYABLE" as const : difference.lt(0) ? "REFUND" as const : "NONE" as const,
  };
}
