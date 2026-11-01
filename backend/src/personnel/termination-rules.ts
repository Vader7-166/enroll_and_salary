import Decimal from "decimal.js";

// Pure severance / job-loss allowance math (BLLĐ 2019 Điều 46, 47; NĐ 145/2020 Điều 8). Every rate arrives as a parameter.
const Money = Decimal.clone({ precision: 60, rounding: Decimal.ROUND_HALF_UP });

/** Full calendar months from the hire date up to the day after the last working day. */
export function workedMonths(hireDate: string, lastDay: string): number {
  const [hy, hm, hd] = hireDate.split("-").map(Number);
  const end = new Date(Date.parse(lastDay + "T00:00:00Z") + 86400000);
  const [ey, em, ed] = [end.getUTCFullYear(), end.getUTCMonth() + 1, end.getUTCDate()];
  return Math.max(0, (ey - hy) * 12 + (em - hm) - (ed < hd ? 1 : 0));
}

/** Whole years plus the remainder rule: from `halfFrom` months = 1/2 year, from `fullFrom` months = 1 year. */
export function serviceYears(months: number, halfFrom: number, fullFrom: number): Decimal {
  const remainder = months % 12;
  const part = remainder >= fullFrom ? 1 : remainder >= halfFrom ? 0.5 : 0;
  return new Money(Math.floor(months / 12)).plus(part);
}

export interface AllowanceInput {
  kind: "SEVERANCE" | "JOB_LOSS";
  workedMonths: number;
  unemploymentMonths: number;
  previouslyPaidMonths: number;
  averageSalary: string;
  monthsPerYear: string;
  minimumMonths: string | null;
  halfFrom: number;
  fullFrom: number;
}

/** Counted time = worked − unemployment-insurance participation − time already compensated; job loss has a floor. */
export function allowance(input: AllowanceInput) {
  const countedMonths = Math.max(0, input.workedMonths - input.unemploymentMonths - input.previouslyPaidMonths);
  const years = serviceYears(countedMonths, input.halfFrom, input.fullFrom);
  const computed = years.times(input.monthsPerYear).times(input.averageSalary);
  const minimum = input.kind === "JOB_LOSS" && input.minimumMonths !== null ? new Money(input.minimumMonths).times(input.averageSalary) : null;
  const minimumApplied = minimum !== null && computed.lt(minimum);
  const amount = (minimumApplied ? minimum! : computed).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  return { countedMonths, years: years.toString(), computed: computed.toString(), minimum: minimum?.toString() ?? null, minimumApplied, amount: amount.toString() };
}

export function averageSalary(monthly: string[]): string {
  if (!monthly.length) return "0";
  return monthly.reduce((total, value) => total.plus(value), new Money(0)).div(monthly.length).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toString();
}

/** Unused annual leave paid at the termination-day daily rate (monthly salary ÷ standard workdays). */
export function unusedLeavePay(days: string, monthlySalary: string, standardWorkdays: string) {
  const dailyRate = new Money(monthlySalary).div(standardWorkdays);
  return { days: new Money(days).toString(), dailyRate: dailyRate.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString(), amount: dailyRate.times(days).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toString() };
}
