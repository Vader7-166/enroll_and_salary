import Decimal from "decimal.js";

// Pure OT classification and pay math (06 §5.4). No database, no clock: every rate comes from resolved parameters.
const Money = Decimal.clone({ precision: 60, rounding: Decimal.ROUND_HALF_UP });
const MINUTE_MS = 60_000;
const VIETNAM_OFFSET_MS = 7 * 60 * MINUTE_MS;

export type DayType = "THUONG" | "NGHI_TUAN" | "LE_TET";
export type BucketKind = "OT" | "NIGHT_REGULAR";
export const RATE_PARAMETER_CODES = ["OT_RATE_WEEKDAY", "OT_RATE_WEEKLY_REST", "OT_RATE_HOLIDAY", "NIGHT_ALLOWANCE_RATE", "NIGHT_OT_ADDON_RATE"] as const;
export type RateParameterCode = typeof RATE_PARAMETER_CODES[number];

export interface ParameterSource { id: string; paramCode: string; scopeKey: string; effectiveFrom: string; value: string; legalBasis?: string }
/** Parameters resolved for one work date and site; any missing code makes the whole work day unrateable. */
export type RateParameters = Partial<Record<RateParameterCode, ParameterSource>>;
export interface DayCalendar { holidays: string[]; weeklyRestDays: number[]; holidayStatus?: string; holidayReference?: string }
export interface TimeInterval { startAt: string; endAt: string }
export interface OvertimeInterval extends TimeInterval { eligible: boolean }
export interface WorkDayInput {
  employeeId: string; orgUnitId: string; workDate: string;
  overtime: OvertimeInterval[];
  regular: TimeInterval[];
  parameters: RateParameters;
  calendar: DayCalendar;
}
export interface ClassifiedSegment { startAt: string; endAt: string; calendarDate: string; dayType: DayType; isNight: boolean; minutes: string }
export interface RateBreakdown {
  dayType: DayType; isNight: boolean; hasDayOt: boolean;
  dayRate: string; nightAllowance: string; addonRate: string; daytimeRate: string;
  formula: string; parameters: ParameterSource[];
}
export interface PayBucket {
  employeeId: string; orgUnitId: string; workDate: string; kind: BucketKind;
  dayType: DayType; isNight: boolean; hasDayOt: boolean; minutes: string; rate: string; rateBreakdown: RateBreakdown;
}
export interface WorkDayError { code: "OT_RATE_PARAMETER_MISSING"; message: string; paramCodes: string[]; employeeId: string; orgUnitId: string; workDate: string }
export interface WorkDayResult {
  buckets: PayBucket[]; hasDayOt: boolean;
  segments: { overtime: Array<ClassifiedSegment & { eligible: boolean }>; regularNight: ClassifiedSegment[] };
  error?: WorkDayError;
}

function localParts(timestamp: number) {
  const local = new Date(timestamp + VIETNAM_OFFSET_MS);
  return { year: local.getUTCFullYear(), month: local.getUTCMonth(), day: local.getUTCDate(), hour: local.getUTCHours(), weekday: local.getUTCDay() };
}
function calendarDateOf(timestamp: number): string {
  const { year, month, day } = localParts(timestamp);
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
function nextBoundary(timestamp: number): number {
  const { year, month, day } = localParts(timestamp);
  const at = (boundaryDay: number, hour: number) => Date.UTC(year, month, boundaryDay, hour) - VIETNAM_OFFSET_MS;
  return [at(day, 0), at(day, 6), at(day, 22), at(day + 1, 0)].find(candidate => candidate > timestamp)!;
}
function isNightAt(timestamp: number): boolean {
  const { hour } = localParts(timestamp);
  return hour < 6 || hour >= 22;
}
/** ISO weekday of a YYYY-MM-DD calendar date: Monday 1 … Sunday 7. */
export function isoWeekday(calendarDate: string): number {
  const weekday = new Date(calendarDate + "T00:00:00Z").getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

/** Day type follows the calendar date of each piece, not the work date (a shift may cross into a holiday). */
export function dayTypeOf(calendarDate: string, calendar: DayCalendar): DayType {
  if (calendar.holidays.includes(calendarDate)) return "LE_TET";
  if (calendar.weeklyRestDays.includes(isoWeekday(calendarDate))) return "NGHI_TUAN";
  return "THUONG";
}

/** Splits an interval at 00:00, 06:00 and 22:00 Vietnam time and labels each piece. */
export function splitInterval(interval: TimeInterval, calendar: DayCalendar): ClassifiedSegment[] {
  const start = Date.parse(interval.startAt), end = Date.parse(interval.endAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) throw new Error("Khoảng thời gian không hợp lệ.");
  const pieces: ClassifiedSegment[] = [];
  for (let cursor = start; cursor < end;) {
    const pieceEnd = Math.min(end, nextBoundary(cursor));
    const calendarDate = calendarDateOf(cursor);
    pieces.push({
      startAt: new Date(cursor).toISOString(), endAt: new Date(pieceEnd).toISOString(), calendarDate,
      dayType: dayTypeOf(calendarDate, calendar), isNight: isNightAt(cursor),
      minutes: new Money(pieceEnd - cursor).div(MINUTE_MS).toString(),
    });
    cursor = pieceEnd;
  }
  return pieces;
}

function parameterValue(parameters: RateParameters, code: RateParameterCode): Decimal {
  const source = parameters[code];
  if (!source || !/^\d+(?:\.\d+)?$/.test(source.value)) throw new Error("Thiếu tham số " + code);
  return new Money(source.value);
}

export function missingRateParameters(parameters: RateParameters): RateParameterCode[] {
  return RATE_PARAMETER_CODES.filter(code => !parameters[code] || !/^\d+(?:\.\d+)?$/.test(parameters[code]!.value));
}

const DAY_RATE_CODE: Record<DayType, RateParameterCode> = { THUONG: "OT_RATE_WEEKDAY", NGHI_TUAN: "OT_RATE_WEEKLY_REST", LE_TET: "OT_RATE_HOLIDAY" };

/**
 * OT rate per Điều 57 NĐ 145/2020: day pieces use r_day; night pieces use
 * r_day + night allowance + addon × r_daytime, where r_daytime is 1.00 only for
 * a weekday work day without daytime OT and r_day otherwise.
 */
export function otRate(dayType: DayType, isNight: boolean, hasDayOt: boolean, parameters: RateParameters): { rate: string; breakdown: RateBreakdown } {
  const dayRateCode = DAY_RATE_CODE[dayType];
  const dayRate = parameterValue(parameters, dayRateCode);
  const used = [parameters[dayRateCode]!];
  if (!isNight) {
    return { rate: dayRate.toString(), breakdown: { dayType, isNight, hasDayOt, dayRate: dayRate.toString(), nightAllowance: "0", addonRate: "0", daytimeRate: "0", formula: "r_ngày", parameters: used } };
  }
  const nightAllowance = parameterValue(parameters, "NIGHT_ALLOWANCE_RATE");
  const addonRate = parameterValue(parameters, "NIGHT_OT_ADDON_RATE");
  const daytimeRate = dayType === "THUONG" && !hasDayOt ? new Money(1) : dayRate;
  used.push(parameters.NIGHT_ALLOWANCE_RATE!, parameters.NIGHT_OT_ADDON_RATE!);
  const rate = dayRate.plus(nightAllowance).plus(addonRate.times(daytimeRate));
  return {
    rate: rate.toString(),
    breakdown: { dayType, isNight, hasDayOt, dayRate: dayRate.toString(), nightAllowance: nightAllowance.toString(), addonRate: addonRate.toString(), daytimeRate: daytimeRate.toString(), formula: "r_ngày + phụ_cấp_đêm + hệ_số_cộng × r_ban_ngày", parameters: used },
  };
}

/**
 * Builds pay buckets for one work day in the fixed order of 06 §5.4:
 * classify pieces → decide hasDayOt on the whole work day → apply rates.
 */
export function buildWorkDay(input: WorkDayInput): WorkDayResult {
  const overtime = input.overtime.flatMap(interval => splitInterval(interval, input.calendar).map(piece => ({ ...piece, eligible: interval.eligible })));
  const regularNight = input.regular.flatMap(interval => splitInterval(interval, input.calendar)).filter(piece => piece.isNight);
  const hasDayOt = overtime.some(piece => piece.eligible && !piece.isNight && new Money(piece.minutes).gt(0));
  const segments = { overtime, regularNight };
  const paid = overtime.filter(piece => piece.eligible);
  if (!paid.length && !regularNight.length) return { buckets: [], hasDayOt, segments };
  const missing = missingRateParameters(input.parameters).filter(code => paid.length || code === "NIGHT_ALLOWANCE_RATE");
  if (missing.length) {
    return {
      buckets: [], hasDayOt, segments,
      error: { code: "OT_RATE_PARAMETER_MISSING", message: "Thiếu tham số hệ số OT hiệu lực tại ngày công: " + missing.join(", "), paramCodes: missing, employeeId: input.employeeId, orgUnitId: input.orgUnitId, workDate: input.workDate },
    };
  }
  const buckets = new Map<string, PayBucket>();
  const add = (kind: BucketKind, piece: ClassifiedSegment, rate: { rate: string; breakdown: RateBreakdown }, flag: boolean) => {
    const key = [kind, piece.dayType, piece.isNight, flag].join(":");
    const existing = buckets.get(key);
    if (existing) { existing.minutes = new Money(existing.minutes).plus(piece.minutes).toString(); return; }
    buckets.set(key, { employeeId: input.employeeId, orgUnitId: input.orgUnitId, workDate: input.workDate, kind, dayType: piece.dayType, isNight: piece.isNight, hasDayOt: flag, minutes: piece.minutes, rate: rate.rate, rateBreakdown: rate.breakdown });
  };
  for (const piece of paid) add("OT", piece, otRate(piece.dayType, piece.isNight, hasDayOt, input.parameters), hasDayOt);
  for (const piece of regularNight) {
    const allowance = input.parameters.NIGHT_ALLOWANCE_RATE!;
    add("NIGHT_REGULAR", piece, { rate: new Money(allowance.value).toString(), breakdown: { dayType: piece.dayType, isNight: true, hasDayOt: false, dayRate: "0", nightAllowance: new Money(allowance.value).toString(), addonRate: "0", daytimeRate: "0", formula: "phụ_cấp_đêm", parameters: [allowance] } }, false);
  }
  return { buckets: [...buckets.values()].sort(compareBuckets), hasDayOt, segments };
}

export function compareBuckets(left: PayBucket, right: PayBucket): number {
  return left.employeeId.localeCompare(right.employeeId) || left.workDate.localeCompare(right.workDate) || left.kind.localeCompare(right.kind)
    || left.dayType.localeCompare(right.dayType) || Number(left.isNight) - Number(right.isNight) || Number(left.hasDayOt) - Number(right.hasDayOt);
}

export interface PayTraceLine { workDate: string; kind: BucketKind; dayType: DayType; isNight: boolean; hours: string; rate: string; amount: string; rateBreakdown: RateBreakdown }
export interface PayResult { hourlyRate: string; amount: string; lines: PayTraceLine[] }

function pay(hourlyRate: string, buckets: Array<Pick<PayBucket, "workDate" | "kind" | "dayType" | "isNight" | "minutes" | "rate" | "rateBreakdown">>, kind: BucketKind): PayResult {
  if (!/^\d+(?:\.\d+)?$/.test(hourlyRate)) throw new Error("Đơn giá giờ phải là chuỗi số thập phân không âm.");
  const hourly = new Money(hourlyRate);
  const lines = buckets.filter(bucket => bucket.kind === kind).map(bucket => {
    const hours = new Money(bucket.minutes).div(60);
    return { workDate: bucket.workDate, kind: bucket.kind, dayType: bucket.dayType, isNight: bucket.isNight, hours: hours.toString(), rate: bucket.rate, amount: hourly.times(bucket.rate).times(hours).toString(), rateBreakdown: bucket.rateBreakdown };
  });
  return { hourlyRate: hourly.toString(), amount: lines.reduce((total, line) => total.plus(line.amount), new Money(0)).toString(), lines };
}

/** OT pay = Σ hourly rate × bucket rate × hours. Unrounded; the payroll engine owns rounding. */
export function otPay(hourlyRate: string, buckets: Parameters<typeof pay>[1]): PayResult { return pay(hourlyRate, buckets, "OT"); }
/** Night allowance for regular (non-OT) night hours = Σ hourly rate × NIGHT_ALLOWANCE_RATE × hours. */
export function nightAllowancePay(hourlyRate: string, buckets: Parameters<typeof pay>[1]): PayResult { return pay(hourlyRate, buckets, "NIGHT_REGULAR"); }
