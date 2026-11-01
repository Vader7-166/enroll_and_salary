import Decimal from "decimal.js";

// Pure estimate of a social-insurance-paid leave benefit (FR-6.4.1, BR-35). Every rate and day count is a parameter.
const Money = Decimal.clone({ precision: 60, rounding: Decimal.ROUND_HALF_UP });
export type BenefitType = "SICK" | "CHILD_SICK" | "MATERNITY" | "PRENATAL" | "RECOVERY";
const DAY = 86400000;
/** Counted in working days (weekly rest excluded); the others in calendar days. */
export const WORKING_DAY_TYPES = new Set<BenefitType>(["SICK", "CHILD_SICK", "PRENATAL"]);

export function benefitDayCount(type: BenefitType, from: string, to: string, restWeekdays: number[]) {
  let count = 0;
  for (let time = Date.parse(from + "T00:00:00Z"); time <= Date.parse(to + "T00:00:00Z"); time += DAY) {
    const isoWeekday = ((new Date(time).getUTCDay() + 6) % 7) + 1;
    if (!WORKING_DAY_TYPES.has(type) || !restWeekdays.includes(isoWeekday)) count++;
  }
  return count;
}

/** Yearly (or per-event for maternity) entitlement; sickness depends on whole years of contribution. */
export function entitlementDays(type: BenefitType, contributionMonths: number, params: { sicknessBands: Array<{ fromYears: number; days: number }>; childSick: number; prenatal: number; recovery: number; maternity: number }) {
  if (type === "SICK") {
    const years = Math.floor(contributionMonths / 12);
    return [...params.sicknessBands].sort((left, right) => right.fromYears - left.fromYears).find(band => years >= band.fromYears)?.days ?? 0;
  }
  return { CHILD_SICK: params.childSick, PRENATAL: params.prenatal, RECOVERY: params.recovery, MATERNITY: params.maternity }[type];
}

export interface EstimateInput {
  type: BenefitType; recordDays: number; usedThisYear: number; entitlement: number;
  /** BHXH insurable salary of the month before (sickness) or the last 6 months (maternity); empty = no data. */
  baseSalaries: string[]; rate: string; standardDays: number;
  contributionMonthsLast12: number; maternityMinMonths: number;
}

/** Benefit days = min(record days, entitlement left this year); amount = days × rate × base ÷ (24 working / 30 calendar). */
export function estimateBenefit(input: EstimateInput) {
  const yearly = input.type !== "MATERNITY";
  const remaining = Math.max(0, input.entitlement - (yearly ? input.usedThisYear : 0));
  const days = Math.min(input.recordDays, remaining);
  const trace = { recordDays: input.recordDays, entitlement: input.entitlement, usedThisYear: yearly ? input.usedThisYear : null, remaining, rate: input.rate,
    divisor: WORKING_DAY_TYPES.has(input.type) ? input.standardDays : 30, baseSalaries: input.baseSalaries };
  if (input.type === "MATERNITY" && input.contributionMonthsLast12 < input.maternityMinMonths)
    return { status: "NOT_ELIGIBLE" as const, days: 0, base: null, daily: null, amount: null, reason: "Chưa đủ " + input.maternityMinMonths + " tháng đóng BHXH trong 12 tháng trước khi nghỉ.", trace };
  if (!input.baseSalaries.length)
    return { status: "INSUFFICIENT_DATA" as const, days, base: null, daily: null, amount: null, reason: "Không có lương đóng BHXH đã khóa của các tháng căn cứ; không tự giả định.", trace };
  const base = input.baseSalaries.reduce((total, value) => total.plus(value), new Money(0)).div(input.baseSalaries.length);
  const daily = base.times(input.rate).div(trace.divisor);
  return { status: "ESTIMATED" as const, days, base: base.toDecimalPlaces(0).toString(), daily: daily.toDecimalPlaces(2).toString(), amount: daily.times(days).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toString(), reason: null, trace };
}
