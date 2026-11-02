import Decimal from "decimal.js";

export type WorkingCondition = "NORMAL" | "HAZARDOUS" | "EXTREME";
export type FundEntry = {
  kind: string;
  bucket: string;
  days: { toString(): string } | string;
  expiresAt: Date | null;
  operation: { effectiveDate: Date };
};
export type EntitlementMonth = {
  month: number;
  policyVersionId: string;
  policyOrgUnitId: string;
  status: string;
  decisionReference: string;
  normalDays: number;
  hazardousDays: number;
  extremeDays: number;
};
export type LeaveEntitlementCalculation = {
  year: number;
  effectiveDate: string;
  hireDate: string;
  terminationDate: string | null;
  serviceAsOf: string;
  serviceYears: number;
  seniorityDays: number;
  workingCondition: WorkingCondition;
  eligibleMonths: number[];
  months: Array<EntitlementMonth & { baseDays: number; seniorityDays: number }>;
  entitledDays: string;
  accessDates: string[];
  precision: string;
  qualificationSource: string;
};
export function daysText(value: Decimal.Value): string {
  return new Decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}
export function completedServiceYears(hireDate: Date, asOf: Date): number {
  let years = asOf.getUTCFullYear() - hireDate.getUTCFullYear();
  const anniversary = new Date(Date.UTC(asOf.getUTCFullYear(), hireDate.getUTCMonth(), hireDate.getUTCDate()));
  if (asOf < anniversary) years--;
  return Math.max(0, years);
}
export function entitlementCalculation(input: {
  year: number;
  hireDate: Date;
  terminationDate: Date | null;
  effectiveDate: Date;
  workingCondition: WorkingCondition;
  months: EntitlementMonth[];
  accessDates: string[];
}): LeaveEntitlementCalculation {
  const serviceAsOf = input.terminationDate && input.terminationDate < input.effectiveDate ? input.terminationDate : input.effectiveDate;
  const serviceYears = completedServiceYears(input.hireDate, serviceAsOf);
  const seniorityDays = Math.floor(serviceYears / 5);
  let entitlement = new Decimal(0);
  const months = input.months.map(month => {
    const baseDays = input.workingCondition === "NORMAL" ? month.normalDays : input.workingCondition === "HAZARDOUS" ? month.hazardousDays : month.extremeDays;
    entitlement = entitlement.plus(new Decimal(baseDays).plus(seniorityDays).div(12));
    return { ...month, baseDays, seniorityDays };
  });
  return {
    year: input.year,
    effectiveDate: input.effectiveDate.toISOString().slice(0, 10),
    hireDate: input.hireDate.toISOString().slice(0, 10),
    terminationDate: input.terminationDate?.toISOString().slice(0, 10) ?? null,
    serviceAsOf: serviceAsOf.toISOString().slice(0, 10),
    serviceYears,
    seniorityDays,
    workingCondition: input.workingCondition,
    eligibleMonths: months.map(month => month.month),
    months,
    entitledDays: daysText(entitlement),
    accessDates: input.accessDates,
    precision: "HALF_UP_2_DECIMALS",
    qualificationSource: "ACCOUNTANT_CONFIRMED_MONTHS",
  };
}
export function fundTotals(entries: FundEntry[], year: number, asOf: Date) {
  const visible = entries.filter(entry => entry.operation.effectiveDate <= asOf);
  const sum = (predicate: (entry: FundEntry) => boolean) => visible.reduce((total, entry) => predicate(entry) ? total.plus(entry.days.toString()) : total, new Decimal(0));
  const annual = sum(entry => entry.bucket === "ANNUAL");
  const advance = sum(entry => entry.bucket === "ADVANCE");
  const carry = sum(entry => entry.bucket === "CARRY" && (!entry.expiresAt || entry.expiresAt >= asOf));
  const expired = sum(entry => entry.bucket === "CARRY" && Boolean(entry.expiresAt && entry.expiresAt < asOf));
  const available = Decimal.max(0, annual.plus(advance).plus(carry));
  const pendingAnnual = asOf.getUTCFullYear() > year ? Decimal.max(0, annual) : new Decimal(0);
  return {
    entitledDays: daysText(sum(entry => entry.kind === "ENTITLEMENT" || entry.kind === "RECALCULATION")),
    adjustmentDays: daysText(sum(entry => entry.kind === "ADJUSTMENT")),
    carriedDays: daysText(sum(entry => entry.kind === "CARRY_IN")),
    carriedOutDays: daysText(sum(entry => entry.kind === "CARRY_OUT").negated()),
    advanceDays: daysText(sum(entry => entry.kind === "ADVANCE_IN")),
    advancedToPreviousDays: daysText(sum(entry => entry.kind === "ADVANCE_OUT").negated()),
    usedDays: daysText(sum(entry => entry.kind === "USE").negated()),
    refundedDays: daysText(sum(entry => entry.kind === "REFUND")),
    annualDays: daysText(annual),
    availableDays: daysText(available),
    expiredCarryDays: daysText(Decimal.max(0, expired)),
    reconciliationDays: daysText(Decimal.max(0, expired).plus(pendingAnnual)),
  };
}
export function carryExpiry(year: number, month: number, day: number): Date {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return new Date(Date.UTC(year, month - 1, Math.min(day, lastDay)));
}

// A backdated debit must remain solvent at every later ledger boundary, not just today.
export function spendableAnnual(entries: FundEntry[], year: number, effectiveDate: Date, today: Date): Decimal {
  const dates = [effectiveDate, today, ...entries.map(entry => entry.operation.effectiveDate).filter(date => date >= effectiveDate && date <= today)];
  let minimum: Decimal | undefined;
  for (const date of dates) {
    const totals = fundTotals(entries, year, date);
    const available = Decimal.min(Decimal.max(0, totals.annualDays), totals.availableDays);
    minimum = minimum ? Decimal.min(minimum, available) : available;
  }
  return minimum ?? new Decimal(0);
}
