import Decimal from "decimal.js";

// Pure compulsory-insurance math (BR-47…50). Rates, floors and caps always arrive as resolved inputs.
const Money = Decimal.clone({ precision: 60, rounding: Decimal.ROUND_HALF_UP });
export type InsuranceKind = "BHXH" | "BHYT" | "BHTN";
export const INSURANCE_KINDS: InsuranceKind[] = ["BHXH", "BHYT", "BHTN"];
export type ContractKind = "INDEFINITE" | "FIXED_TERM" | "PROBATION" | "UNDER_ONE_MONTH" | "PIECEWORK" | "COLLABORATOR";
export type ReasonCode = "ELIGIBLE" | "NO_CONTRACT" | "CONTRACT_UNDER_1_MONTH" | "PROBATION_ONLY" | "CONTRACT_NOT_ELIGIBLE" | "UNPAID_LEAVE_14_DAYS" | "RETIREE" | "FOREIGNER_NO_UNEMPLOYMENT";

export interface EligibilityInput {
  month: string;
  contracts: Array<{ type: ContractKind; insuranceEligible: boolean }>;
  statuses: string[];
  unpaidLeaveDays: number;
  unpaidLeaveThreshold: number;
}
export interface Eligibility { month: string; eligible: Record<InsuranceKind, boolean>; reasonCode: ReasonCode; reasons: ReasonCode[] }

/** Monthly participation with the reason that decided it (BR-49). */
export function insuranceEligibility(input: EligibilityInput): Eligibility {
  const none = (reasonCode: ReasonCode): Eligibility => ({ month: input.month, eligible: { BHXH: false, BHYT: false, BHTN: false }, reasonCode, reasons: [reasonCode] });
  if (!input.contracts.length) return none("NO_CONTRACT");
  if (input.contracts.some(contract => contract.insuranceEligible)) {
    if (input.unpaidLeaveDays >= input.unpaidLeaveThreshold) return none("UNPAID_LEAVE_14_DAYS");
    if (input.statuses.includes("PENSIONER")) return none("RETIREE");
    if (input.statuses.includes("FOREIGN_WORKER")) return { month: input.month, eligible: { BHXH: true, BHYT: true, BHTN: false }, reasonCode: "ELIGIBLE", reasons: ["ELIGIBLE", "FOREIGNER_NO_UNEMPLOYMENT"] };
    return { month: input.month, eligible: { BHXH: true, BHYT: true, BHTN: true }, reasonCode: "ELIGIBLE", reasons: ["ELIGIBLE"] };
  }
  if (input.contracts.every(contract => contract.type === "PROBATION")) return none("PROBATION_ONLY");
  if (input.contracts.some(contract => contract.type === "UNDER_ONE_MONTH" || contract.type === "FIXED_TERM")) return none("CONTRACT_UNDER_1_MONTH");
  return none("CONTRACT_NOT_ELIGIBLE");
}

export interface InsurableComponent { code: string; name: string; amount: string; insurable: boolean }
export interface InsurableInput {
  components: InsurableComponent[];
  regionalMinimum: string;
  trainedAddon: string | null;
  caps: Record<InsuranceKind, string | null>;
}
export interface InsurableSalary {
  raw: string; included: Array<{ code: string; amount: string }>; excluded: Array<{ code: string; amount: string }>;
  floor: string; perKind: Record<InsuranceKind, { beforeClamp: string; floorApplied: boolean; cap: string | null; capApplied: boolean; value: string }>;
}

/** Σ insurable components, clamped per kind to [regional floor (+ trained addon), kind cap]. */
export function insurableSalary(input: InsurableInput): InsurableSalary {
  const included = input.components.filter(component => component.insurable);
  const raw = included.reduce((total, component) => total.plus(component.amount), new Money(0));
  const floor = new Money(input.regionalMinimum).times(new Money(1).plus(input.trainedAddon ?? 0));
  const perKind = {} as InsurableSalary["perKind"];
  for (const kind of INSURANCE_KINDS) {
    const cap = input.caps[kind];
    const floored = Decimal.max(raw, floor);
    const capped = cap !== null ? Decimal.min(floored, cap) : floored;
    perKind[kind] = { beforeClamp: raw.toString(), floorApplied: raw.lt(floor), cap, capApplied: cap !== null && floored.gt(cap), value: new Money(capped).toString() };
  }
  return {
    raw: raw.toString(), floor: floor.toString(), perKind,
    included: included.map(component => ({ code: component.code, amount: component.amount })),
    excluded: input.components.filter(component => !component.insurable).map(component => ({ code: component.code, amount: component.amount })),
  };
}

export interface RateInput { id: string; employeeRate: string; employerRate: string }
export interface ContributionInput {
  eligibility: Eligibility;
  salary: InsurableSalary;
  rates: Record<InsuranceKind | "KPCD", RateInput | null>;
  unionFee: { rate: string; cap: string; parameterIds: string[] } | null;
  rounding: { scale: number };
}
export interface ContributionLine { kind: InsuranceKind | "KPCD" | "UNION_FEE"; base: string; employeeRate: string; employerRate: string; employee: string; employer: string; rateId: string | null; capApplied?: boolean }
export interface Contribution { lines: ContributionLine[]; employeeTotal: string; employerTotal: string }

const round = (value: Decimal, scale: number) => new Money(value).toDecimalPlaces(scale, Decimal.ROUND_HALF_UP);

/** Employee and employer shares per kind, KPCĐ on the BHXH base, union fee capped; each line rounded (BR-41). */
export function insuranceContribution(input: ContributionInput): Contribution {
  const lines: ContributionLine[] = [];
  for (const kind of INSURANCE_KINDS) {
    const rate = input.rates[kind];
    if (!input.eligibility.eligible[kind] || !rate) continue;
    const base = new Money(input.salary.perKind[kind].value);
    lines.push({ kind, base: base.toString(), employeeRate: rate.employeeRate, employerRate: rate.employerRate, employee: round(base.times(rate.employeeRate), input.rounding.scale).toString(), employer: round(base.times(rate.employerRate), input.rounding.scale).toString(), rateId: rate.id });
  }
  if (input.eligibility.eligible.BHXH) {
    const base = new Money(input.salary.perKind.BHXH.value);
    const kpcd = input.rates.KPCD;
    if (kpcd) lines.push({ kind: "KPCD", base: base.toString(), employeeRate: "0", employerRate: kpcd.employerRate, employee: "0", employer: round(base.times(kpcd.employerRate), input.rounding.scale).toString(), rateId: kpcd.id });
    if (input.unionFee) {
      const fee = round(base.times(input.unionFee.rate), input.rounding.scale);
      const capped = Decimal.min(fee, input.unionFee.cap);
      lines.push({ kind: "UNION_FEE", base: base.toString(), employeeRate: input.unionFee.rate, employerRate: "0", employee: new Money(capped).toString(), employer: "0", rateId: null, capApplied: fee.gt(input.unionFee.cap) });
    }
  }
  return {
    lines,
    employeeTotal: lines.reduce((total, line) => total.plus(line.employee), new Money(0)).toString(),
    employerTotal: lines.reduce((total, line) => total.plus(line.employer), new Money(0)).toString(),
  };
}

export interface Cp07Violation { code: "CP-07"; severity: "BLOCKING"; message: string }
/** CP-07: participating in the month but no valid insurable salary source. */
export function checkCp07(eligibility: Eligibility, salary: Pick<InsurableSalary, "raw"> | null): Cp07Violation | null {
  const participating = INSURANCE_KINDS.some(kind => eligibility.eligible[kind]);
  if (!participating || (salary && new Money(salary.raw).gt(0))) return null;
  return { code: "CP-07", severity: "BLOCKING", message: "Thuộc diện đóng BH trong tháng " + eligibility.month + " nhưng chưa có lương đóng BH hợp lệ." };
}
