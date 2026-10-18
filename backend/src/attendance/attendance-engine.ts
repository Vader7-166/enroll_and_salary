import Decimal from "decimal.js";
import {
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

type IndexedPunch = EnginePunch & { index: number; at: number };
type ScheduleContext = { schedule: EngineSchedule; rules: PairingRules; start: number; end: number };
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
  if (next === undefined) {
    throw new Error("Could not determine the next Vietnam time boundary");
  }
  return next;
}

function belongsToWindow(timestamp: number, center: number, beforeMinutes: number, afterMinutes: number): boolean {
  return timestamp >= center - beforeMinutes * MINUTE_MS && timestamp <= center + afterMinutes * MINUTE_MS;
}

function candidatesForPunch(punch: IndexedPunch, schedules: ScheduleContext[]): Candidate[] {
  const candidates: Candidate[] = [];
  for (const { schedule, rules, start, end } of schedules) {
    const inWindow = belongsToWindow(punch.at, start, rules.inBeforeMinutes, rules.inAfterMinutes);
    const outWindow = belongsToWindow(punch.at, end, rules.outBeforeMinutes, rules.outAfterMinutes);
    if ((punch.direction === "IN" || punch.direction === "AUTO") && inWindow) {
      candidates.push({ scheduleId: schedule.id, role: "IN" });
    }
    if ((punch.direction === "OUT" || punch.direction === "AUTO") && outWindow) {
      candidates.push({ scheduleId: schedule.id, role: "OUT" });
    }
  }
  return candidates;
}

function addSegment(intervalStart: number, intervalEnd: number, segments: RawSegment[]): void {
  let cursor = intervalStart;
  while (cursor < intervalEnd) {
    const next = Math.min(intervalEnd, nextVietnamBoundaryAfter(cursor));
    segments.push({
      startAt: isoAt(cursor),
      endAt: isoAt(next),
      calendarDate: vietnamCalendarDate(cursor),
      kind: isDaytimeVietnam(cursor) ? "DAY" : "NIGHT",
      rawMinutes: (next - cursor) / MINUTE_MS,
    });
    cursor = next;
  }
}

function attendanceSegments(start: number, end: number, schedule: EngineSchedule): AttendanceSegment[] {
  const rawSegments: RawSegment[] = [];
  if (end <= start) {
    return [];
  }

  if (schedule.paidBreak || schedule.breakMinutes <= 0) {
    addSegment(start, end, rawSegments);
  } else {
    const breakStart = new Date(schedule.startAt).getTime() + schedule.breakStartOffset * MINUTE_MS;
    const breakEnd = breakStart + schedule.breakMinutes * MINUTE_MS;
    addSegment(start, Math.min(end, breakStart), rawSegments);
    addSegment(Math.max(start, breakEnd), end, rawSegments);
  }

  const totals = new Map<AttendanceSegment["kind"], number>([["DAY", 0], ["NIGHT", 0]]);
  for (const segment of rawSegments) {
    totals.set(segment.kind, (totals.get(segment.kind) ?? 0) + segment.rawMinutes);
  }
  const roundedTotals = new Map<AttendanceSegment["kind"], number>();
  for (const [kind, rawTotal] of totals) {
    roundedTotals.set(kind, roundMinutes(rawTotal));
  }

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
    return {
      startAt: segment.startAt,
      endAt: segment.endAt,
      calendarDate: segment.calendarDate,
      kind: segment.kind,
      minutes,
    };
  });
}

function workUnit(workedMinutes: number, scheduledMinutes: number): string {
  if (workedMinutes <= 0 || scheduledMinutes <= 0) {
    return "0";
  }
  return Decimal.min(new Decimal(workedMinutes).dividedBy(scheduledMinutes), 1).toString();
}

function emptyDay(schedule: EngineSchedule): ComputedDay {
  return {
    scheduleId: schedule.id,
    employeeId: schedule.employeeId,
    orgUnitId: schedule.orgUnitId,
    workDate: schedule.workDate,
    checkInId: null,
    checkOutId: null,
    checkInAt: null,
    checkOutAt: null,
    status: "ERR",
    flags: ["ABSENT"],
    workedMinutes: 0,
    dayMinutes: 0,
    nightMinutes: 0,
    lateMinutes: 0,
    earlyMinutes: 0,
    absent: true,
    workUnits: "0",
    segments: [],
  };
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
        if (index === selectedIndex) {
          retained.push(punch);
        } else {
          resolutions[punch.index] = {
            punchId: punch.id,
            scheduleId: punch.scheduleId,
            status: "SUPPRESSED",
            reason: "DUPLICATE_PUNCH",
          };
        }
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

export function computeAttendance(
  schedules: EngineSchedule[],
  punches: EnginePunch[],
  rulesBySchedule: Record<string, PairingRules>,
): EngineResult {
  const schedulesByEmployee = new Map<string, ScheduleContext[]>();
  const scheduleById = new Map<string, ScheduleContext>();
  for (const schedule of schedules) {
    const context: ScheduleContext = {
      schedule,
      rules: rulesBySchedule[schedule.id],
      start: new Date(schedule.startAt).getTime(),
      end: new Date(schedule.endAt).getTime(),
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
      if (candidates.length === 0) {
        resolutions[punch.index] = { punchId: punch.id, scheduleId: null, status: "UNMATCHED", reason: "OUTSIDE_WINDOW" };
      } else if (candidates.length > 1) {
        for (const candidate of candidates) ambiguousSchedules.add(candidate.scheduleId);
        resolutions[punch.index] = { punchId: punch.id, scheduleId: null, status: "AMBIGUOUS", reason: "AMBIGUOUS" };
      } else {
        const candidate = candidates[0];
        assignments.push({ ...punch, scheduleId: candidate.scheduleId, role: candidate.role });
      }
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
    const pair = retainedBySchedule.get(schedule.id) ?? { in: [], out: [] };
    pair.in.sort((left, right) => left.at - right.at || left.index - right.index);
    pair.out.sort((left, right) => left.at - right.at || left.index - right.index);
    const checkIn = pair.in[0];
    const checkOut = pair.out.at(-1);
    if (checkIn) selectedPunches.add(checkIn.index);
    if (checkOut) selectedPunches.add(checkOut.index);

    if (!checkIn && !checkOut) {
      const day = emptyDay(schedule);
      if (ambiguousSchedules.has(schedule.id)) day.flags = ["AMBIGUOUS"];
      return day;
    }

    const flags: string[] = [];
    if (ambiguousSchedules.has(schedule.id)) flags.push("AMBIGUOUS");
    if (!checkIn) flags.push("MISSING_IN");
    if (!checkOut) flags.push("MISSING_OUT");
    const day: ComputedDay = {
      scheduleId: schedule.id,
      employeeId: schedule.employeeId,
      orgUnitId: schedule.orgUnitId,
      workDate: schedule.workDate,
      checkInId: checkIn?.id ?? null,
      checkOutId: checkOut?.id ?? null,
      checkInAt: checkIn ? isoAt(checkIn.at) : null,
      checkOutAt: checkOut ? isoAt(checkOut.at) : null,
      status: "ERR",
      flags,
      workedMinutes: 0,
      dayMinutes: 0,
      nightMinutes: 0,
      lateMinutes: 0,
      earlyMinutes: 0,
      absent: false,
      workUnits: "0",
      segments: [],
    };

    if (!checkIn || !checkOut) return day;
    if (checkOut.at <= checkIn.at) {
      day.flags.push("INVALID_PAIR");
      return day;
    }
    if (ambiguousSchedules.has(schedule.id)) return day;

    const workedStart = Math.max(checkIn.at, context.start);
    const workedEnd = Math.min(checkOut.at, context.end);
    day.segments = attendanceSegments(workedStart, workedEnd, schedule);
    const rawWorked = day.segments.reduce((total, segment) => total + segment.minutes, 0);
    day.workedMinutes = roundMinutes(rawWorked);
    day.dayMinutes = roundMinutes(day.segments.filter(segment => segment.kind === "DAY").reduce((total, segment) => total + segment.minutes, 0));
    day.nightMinutes = roundMinutes(day.workedMinutes - day.dayMinutes);
    day.lateMinutes = checkIn.at > context.start ? Math.ceil((checkIn.at - context.start) / MINUTE_MS) : 0;
    day.earlyMinutes = checkOut.at < context.end ? Math.ceil((context.end - checkOut.at) / MINUTE_MS) : 0;
    if (day.lateMinutes > 0) day.flags.push("LATE");
    if (day.earlyMinutes > 0) day.flags.push("EARLY");
    day.status = "OK";
    day.workUnits = workUnit(day.workedMinutes, schedule.workMinutes);
    return day;
  });

  for (const assigned of assignments) {
    if (resolutions[assigned.index]) continue;
    resolutions[assigned.index] = {
      punchId: assigned.id,
      scheduleId: assigned.scheduleId,
      status: "MATCHED",
      reason: selectedPunches.has(assigned.index) ? null : "EXTRA_PUNCH",
    };
  }

  return { days, punches: resolutions };
}
