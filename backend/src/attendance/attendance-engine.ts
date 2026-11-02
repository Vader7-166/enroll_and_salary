import Decimal from "decimal.js";
import {
  type ApprovedAttendanceAdjustment,
  type AttendanceSegment,
  type ComputedDay,
  type EnginePunch,
  type EngineResult,
  type EngineSchedule,
  type PairingRules,
  type PunchResolution,
} from "./attendance.types";

const MINUTE_MS = 60_000;
const VIETNAM_OFFSET_MS = 7 * 60 * MINUTE_MS;

type Role = "IN" | "OUT";
type Range = { start: number; end: number };
type IndexedPunch = EnginePunch & { index: number; at: number };
type ScheduleContext = {
  schedule: EngineSchedule; rules: PairingRules; start: number; end: number;
  pairingStart: number; pairingEnd: number;
};
type Candidate = { scheduleId: string; role: Role };
type AssignedPunch = IndexedPunch & { scheduleId: string; role: Role };
type RawSegment = Omit<AttendanceSegment, "minutes"> & { rawMinutes: number };

function roundMinutes(value: number): number {
  return Number(value.toFixed(6));
}

function isoAt(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

function localVietnamDate(timestamp: number): Date {
  return new Date(timestamp + VIETNAM_OFFSET_MS);
}

function vietnamCalendarDate(timestamp: number): string {
  const date = localVietnamDate(timestamp);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function isDaytimeVietnam(timestamp: number): boolean {
  const hour = localVietnamDate(timestamp).getUTCHours();
  return hour >= 6 && hour < 22;
}

function vietnamBoundary(year: number, month: number, day: number, hour: number): number {
  return Date.UTC(year, month, day, hour) - VIETNAM_OFFSET_MS;
}

function nextVietnamBoundaryAfter(timestamp: number): number {
  const local = localVietnamDate(timestamp);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth();
  const day = local.getUTCDate();
  const candidates = [
    vietnamBoundary(year, month, day, 0),
    vietnamBoundary(year, month, day, 6),
    vietnamBoundary(year, month, day, 22),
    vietnamBoundary(year, month, day + 1, 0),
  ];
  const next = candidates.find(candidate => candidate > timestamp);
  if (next === undefined) throw new Error("Could not determine the next Vietnam time boundary");
  return next;
}

function belongsToWindow(timestamp: number, center: number, beforeMinutes: number, afterMinutes: number): boolean {
  return timestamp >= center - beforeMinutes * MINUTE_MS && timestamp <= center + afterMinutes * MINUTE_MS;
}

function candidatesForPunch(punch: IndexedPunch, schedules: ScheduleContext[]): Candidate[] {
  const candidates: Candidate[] = [];
  for (const { schedule, rules, pairingStart, pairingEnd } of schedules) {
    const inWindow = belongsToWindow(punch.at, pairingStart, rules.inBeforeMinutes, rules.inAfterMinutes);
    const outWindow = belongsToWindow(punch.at, pairingEnd, rules.outBeforeMinutes, rules.outAfterMinutes);
    if ((punch.direction === "IN" || punch.direction === "AUTO") && inWindow) candidates.push({ scheduleId: schedule.id, role: "IN" });
    if ((punch.direction === "OUT" || punch.direction === "AUTO") && outWindow) candidates.push({ scheduleId: schedule.id, role: "OUT" });
  }
  return candidates;
}

function mergeRanges(ranges: Range[]): Range[] {
  const merged: Range[] = [];
  for (const range of ranges.filter(range => range.end > range.start).sort((left, right) => left.start - right.start || left.end - right.end)) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

function addSegment(intervalStart: number, intervalEnd: number, segments: RawSegment[]): void {
  let cursor = intervalStart;
  while (cursor < intervalEnd) {
    const next = Math.min(intervalEnd, nextVietnamBoundaryAfter(cursor));
    segments.push({
      startAt: isoAt(cursor), endAt: isoAt(next), calendarDate: vietnamCalendarDate(cursor),
      kind: isDaytimeVietnam(cursor) ? "DAY" : "NIGHT", rawMinutes: (next - cursor) / MINUTE_MS,
    });
    cursor = next;
  }
}

function attendanceSegmentsForIntervals(intervals: Range[], schedule: EngineSchedule): AttendanceSegment[] {
  const rawSegments: RawSegment[] = [];
  const scheduleStart = new Date(schedule.startAt).getTime();
  const scheduleEnd = new Date(schedule.endAt).getTime();
  const clipped = mergeRanges(intervals.map(range => ({
    start: Math.max(range.start, scheduleStart), end: Math.min(range.end, scheduleEnd),
  })));
  const breakStart = scheduleStart + schedule.breakStartOffset * MINUTE_MS;
  const breakEnd = breakStart + schedule.breakMinutes * MINUTE_MS;
  for (const range of clipped) {
    if (schedule.paidBreak || schedule.breakMinutes <= 0) addSegment(range.start, range.end, rawSegments);
    else {
      addSegment(range.start, Math.min(range.end, breakStart), rawSegments);
      addSegment(Math.max(range.start, breakEnd), range.end, rawSegments);
    }
  }
  const totals = new Map<AttendanceSegment["kind"], number>([["DAY", 0], ["NIGHT", 0]]);
  for (const segment of rawSegments) totals.set(segment.kind, (totals.get(segment.kind) ?? 0) + segment.rawMinutes);
  const roundedTotals = new Map<AttendanceSegment["kind"], number>();
  for (const [kind, rawTotal] of totals) roundedTotals.set(kind, roundMinutes(rawTotal));
  const lastByKind = new Map<AttendanceSegment["kind"], number>();
  rawSegments.forEach((segment, index) => lastByKind.set(segment.kind, index));
  const roundedSoFar = new Map<AttendanceSegment["kind"], number>([["DAY", 0], ["NIGHT", 0]]);
  return rawSegments.map((segment, index) => {
    const rounded = roundMinutes(segment.rawMinutes);
    const current = (roundedSoFar.get(segment.kind) ?? 0) + rounded;
    roundedSoFar.set(segment.kind, current);
    const minutes = lastByKind.get(segment.kind) === index
      ? roundMinutes((roundedTotals.get(segment.kind) ?? 0) - ((roundedSoFar.get(segment.kind) ?? 0) - rounded))
      : rounded;
    return { startAt: segment.startAt, endAt: segment.endAt, calendarDate: segment.calendarDate, kind: segment.kind, minutes };
  });
}


function workUnit(workedMinutes: number, scheduledMinutes: number): string {
  if (workedMinutes <= 0 || scheduledMinutes <= 0) return "0";
  return Decimal.min(new Decimal(workedMinutes).dividedBy(scheduledMinutes), 1).toString();
}

function emptyDay(schedule: EngineSchedule, adjustmentId?: string): ComputedDay {
  return {
    scheduleId: schedule.id, employeeId: schedule.employeeId, orgUnitId: schedule.orgUnitId, workDate: schedule.workDate,
    checkInId: null, checkOutId: null, checkInAt: null, checkOutAt: null, status: "ERR", flags: ["ABSENT"],
    workedMinutes: 0, dayMinutes: 0, nightMinutes: 0, lateMinutes: 0, earlyMinutes: 0, absent: true, workUnits: "0", segments: [],
    ...(adjustmentId ? { adjustmentId } : {}),
  };
}

function finalizeWorkedDay(day: ComputedDay, schedule: EngineSchedule, intervals: Range[]): ComputedDay {
  const segments = attendanceSegmentsForIntervals(intervals, schedule);
  const workedMinutes = roundMinutes(segments.reduce((total, segment) => total + segment.minutes, 0));
  const dayMinutes = roundMinutes(segments.filter(segment => segment.kind === "DAY").reduce((total, segment) => total + segment.minutes, 0));
  return {
    ...day,
    segments,
    workedMinutes,
    dayMinutes,
    nightMinutes: roundMinutes(workedMinutes - dayMinutes),
    workUnits: workUnit(workedMinutes, schedule.workMinutes),
  };
}

function replacementDay(schedule: EngineSchedule, context: ScheduleContext, adjustment: ApprovedAttendanceAdjustment): ComputedDay {
  const effectiveIntervals = mergeRanges((adjustment.intervals ?? []).map(interval => ({
    start: Math.max(new Date(interval.startAt).getTime(), context.start),
    end: Math.min(new Date(interval.endAt).getTime(), context.end),
  })));
  if (effectiveIntervals.length === 0) return emptyDay(schedule, adjustment.id);
  const first = effectiveIntervals[0];
  const last = effectiveIntervals.at(-1)!;
  const lateMinutes = first.start > context.start ? Math.ceil((first.start - context.start) / MINUTE_MS) : 0;
  const earlyMinutes = last.end < context.end ? Math.ceil((context.end - last.end) / MINUTE_MS) : 0;
  const day: ComputedDay = {
    scheduleId: schedule.id, employeeId: schedule.employeeId, orgUnitId: schedule.orgUnitId, workDate: schedule.workDate,
    checkInId: null, checkOutId: null, checkInAt: isoAt(first.start), checkOutAt: isoAt(last.end),
    status: "OK", flags: [], workedMinutes: 0, dayMinutes: 0, nightMinutes: 0, lateMinutes, earlyMinutes,
    absent: false, workUnits: "0", segments: [], adjustmentId: adjustment.id,
  };
  if (lateMinutes > 0) day.flags.push("LATE");
  if (earlyMinutes > 0) day.flags.push("EARLY");
  return finalizeWorkedDay(day, schedule, effectiveIntervals);
}

function applyExplanation(day: ComputedDay, schedule: EngineSchedule, adjustment: ApprovedAttendanceAdjustment): ComputedDay {
  const adjusted = { ...day, adjustmentId: adjustment.id };
  if (!adjustment.excuseLateEarly || day.status !== "OK" || !day.checkInAt || !day.checkOutAt) return adjusted;
  if ((day.lateMinutes <= 0 && day.earlyMinutes <= 0) || day.lateMinutes >= 15 || day.earlyMinutes >= 15) return adjusted;
  const start = day.lateMinutes > 0 ? new Date(schedule.startAt).getTime() : new Date(day.checkInAt).getTime();
  const end = day.earlyMinutes > 0 ? new Date(schedule.endAt).getTime() : new Date(day.checkOutAt).getTime();
  return finalizeWorkedDay({
    ...adjusted,
    flags: adjusted.flags.filter(flag => flag !== "LATE" && flag !== "EARLY"),
    lateMinutes: 0,
    earlyMinutes: 0,
  }, schedule, [{ start, end }]);
}

function deduplicate(assigned: AssignedPunch[], rulesBySchedule: Record<string, PairingRules>, resolutions: PunchResolution[]): AssignedPunch[] {
  const byScheduleRole = new Map<string, AssignedPunch[]>();
  for (const punch of assigned) {
    const key = `${punch.scheduleId}\u0000${punch.role}`;
    const group = byScheduleRole.get(key);
    if (group) group.push(punch); else byScheduleRole.set(key, [punch]);
  }
  const retained: AssignedPunch[] = [];
  for (const group of byScheduleRole.values()) {
    group.sort((left, right) => left.at - right.at || left.index - right.index);
    const duplicateWindow = rulesBySchedule[group[0].scheduleId].duplicateWindowMinutes * MINUTE_MS;
    let clusterStart = 0;
    const retainCluster = (start: number, end: number): void => {
      const selectedIndex = group[start].role === "IN" ? start : end - 1;
      for (let index = start; index < end; index += 1) {
        const punch = group[index];
        if (index === selectedIndex) retained.push(punch);
        else resolutions[punch.index] = { punchId: punch.id, scheduleId: punch.scheduleId, status: "SUPPRESSED", reason: "DUPLICATE_PUNCH" };
      }
    };
    for (let index = 1; index <= group.length; index += 1) {
      if (index === group.length || group[index].at - group[index - 1].at > duplicateWindow) {
        retainCluster(clusterStart, index);
        clusterStart = index;
      }
    }
  }
  return retained;
}

/** Computes regular attendance from raw punches and optional approved effective-presence adjustments. */
export function computeAttendance(
  schedules: EngineSchedule[],
  punches: EnginePunch[],
  rulesBySchedule: Record<string, PairingRules>,
  adjustments: ApprovedAttendanceAdjustment[] = [],
): EngineResult {
  const adjustmentsByTarget = new Map(adjustments.map(adjustment => [
    `${adjustment.employeeId}:${adjustment.orgUnitId}:${adjustment.workDate}`,
    adjustment,
  ]));
  const schedulesByEmployee = new Map<string, ScheduleContext[]>();
  const scheduleById = new Map<string, ScheduleContext>();
  for (const schedule of schedules) {
    const context: ScheduleContext = {
      schedule, rules: rulesBySchedule[schedule.id],
      start: new Date(schedule.startAt).getTime(), end: new Date(schedule.endAt).getTime(),
      pairingStart: new Date(schedule.pairingStartAt ?? schedule.startAt).getTime(),
      pairingEnd: new Date(schedule.pairingEndAt ?? schedule.endAt).getTime(),
    };
    scheduleById.set(schedule.id, context);
    const employeeSchedules = schedulesByEmployee.get(schedule.employeeId);
    if (employeeSchedules) employeeSchedules.push(context); else schedulesByEmployee.set(schedule.employeeId, [context]);
  }
  const punchesByEmployee = new Map<string, IndexedPunch[]>();
  punches.forEach((punch, index) => {
    const indexed = { ...punch, index, at: new Date(punch.punchedAt).getTime() };
    const employeePunches = punchesByEmployee.get(punch.employeeId);
    if (employeePunches) employeePunches.push(indexed); else punchesByEmployee.set(punch.employeeId, [indexed]);
  });
  const resolutions: PunchResolution[] = new Array(punches.length);
  const assignments: AssignedPunch[] = [];
  const ambiguousSchedules = new Set<string>();
  for (const [employeeId, employeePunches] of punchesByEmployee) {
    const employeeSchedules = schedulesByEmployee.get(employeeId) ?? [];
    for (const punch of employeePunches) {
      if (employeeSchedules.length === 0) {
        resolutions[punch.index] = { punchId: punch.id, scheduleId: null, status: "UNMATCHED", reason: "NO_APPROVED_SHIFT" };
        continue;
      }
      const candidates = candidatesForPunch(punch, employeeSchedules);
      if (candidates.length === 0) resolutions[punch.index] = { punchId: punch.id, scheduleId: null, status: "UNMATCHED", reason: "OUTSIDE_WINDOW" };
      else if (candidates.length > 1) {
        for (const candidate of candidates) ambiguousSchedules.add(candidate.scheduleId);
        resolutions[punch.index] = { punchId: punch.id, scheduleId: null, status: "AMBIGUOUS", reason: "AMBIGUOUS" };
      } else assignments.push({ ...punch, scheduleId: candidates[0].scheduleId, role: candidates[0].role });
    }
  }
  const retained = deduplicate(assignments, rulesBySchedule, resolutions);
  const retainedBySchedule = new Map<string, { in: AssignedPunch[]; out: AssignedPunch[] }>();
  for (const punch of retained) {
    const pair = retainedBySchedule.get(punch.scheduleId) ?? { in: [], out: [] };
    pair[punch.role === "IN" ? "in" : "out"].push(punch);
    retainedBySchedule.set(punch.scheduleId, pair);
  }
  const selectedPunches = new Set<number>();
  const days = schedules.map(schedule => {
    const context = scheduleById.get(schedule.id)!;
    const adjustment = adjustmentsByTarget.get(`${schedule.employeeId}:${schedule.orgUnitId}:${schedule.workDate}`);
    const pair = retainedBySchedule.get(schedule.id) ?? { in: [], out: [] };
    pair.in.sort((left, right) => left.at - right.at || left.index - right.index);
    pair.out.sort((left, right) => left.at - right.at || left.index - right.index);
    const checkIn = pair.in[0]; const checkOut = pair.out.at(-1);
    if (checkIn) selectedPunches.add(checkIn.index);
    if (checkOut) selectedPunches.add(checkOut.index);
    if (adjustment?.intervals !== null && adjustment) return replacementDay(schedule, context, adjustment);
    let day: ComputedDay;
    if (!checkIn && !checkOut) {
      day = emptyDay(schedule);
      if (ambiguousSchedules.has(schedule.id)) day.flags = ["AMBIGUOUS"];
    } else {
      const flags: string[] = [];
      if (ambiguousSchedules.has(schedule.id)) flags.push("AMBIGUOUS");
      if (!checkIn) flags.push("MISSING_IN");
      if (!checkOut) flags.push("MISSING_OUT");
      day = {
        scheduleId: schedule.id, employeeId: schedule.employeeId, orgUnitId: schedule.orgUnitId, workDate: schedule.workDate,
        checkInId: checkIn?.id ?? null, checkOutId: checkOut?.id ?? null,
        checkInAt: checkIn ? isoAt(checkIn.at) : null, checkOutAt: checkOut ? isoAt(checkOut.at) : null,
        status: "ERR", flags, workedMinutes: 0, dayMinutes: 0, nightMinutes: 0, lateMinutes: 0, earlyMinutes: 0,
        absent: false, workUnits: "0", segments: [],
      };
      if (checkIn && checkOut && checkOut.at > checkIn.at && !ambiguousSchedules.has(schedule.id)) {
        day = finalizeWorkedDay(day, schedule, [{ start: Math.max(checkIn.at, context.start), end: Math.min(checkOut.at, context.end) }]);
        day.lateMinutes = checkIn.at > context.start ? Math.ceil((checkIn.at - context.start) / MINUTE_MS) : 0;
        day.earlyMinutes = checkOut.at < context.end ? Math.ceil((context.end - checkOut.at) / MINUTE_MS) : 0;
        if (day.lateMinutes > 0) day.flags.push("LATE");
        if (day.earlyMinutes > 0) day.flags.push("EARLY");
        day.status = "OK";
      } else if (checkIn && checkOut && checkOut.at <= checkIn.at) day.flags.push("INVALID_PAIR");
    }
    return adjustment ? applyExplanation(day, schedule, adjustment) : day;
  });
  for (const assigned of assignments) {
    if (resolutions[assigned.index]) continue;
    resolutions[assigned.index] = {
      punchId: assigned.id, scheduleId: assigned.scheduleId,
      status: "MATCHED", reason: selectedPunches.has(assigned.index) ? null : "EXTRA_PUNCH",
    };
  }
  return { days, punches: resolutions };
}
