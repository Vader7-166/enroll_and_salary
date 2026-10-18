import { computeAttendance } from "./attendance-engine";
import type {
  ActualEngineInput,
  ActualEngineResult,
  ActualPair,
  ActualRequestInput,
  ActualSegment,
  ComputedActual,
} from "./overtime-actual.types";
import type { ComputedDay, EnginePunch, EngineSchedule, PairingRules, PunchResolution } from "./attendance.types";

const MINUTE_MS = 60_000;
const VIETNAM_OFFSET_MS = 7 * 60 * MINUTE_MS;
const ACTIVE_STATUSES = new Set(["DRAFT", "PENDING", "RETURNED", "APPROVED"]);

type Range = { start: number; end: number };
type Group = { key: string; employeeId: string; orgUnitId: string; workDate: string; requests: ActualRequestInput[]; schedules: EngineSchedule[]; assigned: boolean };
type Context = { id: string; groupKey: string; scheduleIds: string[]; virtual: boolean; start: number; end: number; rules: PairingRules };

function groupKey(employeeId: string, orgUnitId: string, workDate: string): string {
  return `${employeeId}:${orgUnitId}:${workDate}`;
}

function isoAt(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

function roundMinutes(value: number): number {
  return Number(value.toFixed(6));
}

function rangeFor(value: Pick<ActualRequestInput, "startAt" | "endAt">): Range {
  return { start: new Date(value.startAt).getTime(), end: new Date(value.endAt).getTime() };
}

function mergeRanges(ranges: Range[]): Range[] {
  const sorted = ranges.filter(range => range.end > range.start).sort((left, right) => left.start - right.start || left.end - right.end);
  const merged: Range[] = [];
  for (const range of sorted) {
    const last = merged.at(-1);
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

function subtractRanges(source: Range, exclusions: Range[]): Range[] {
  const remaining: Range[] = [];
  let cursor = source.start;
  for (const exclusion of exclusions) {
    if (exclusion.end <= cursor) continue;
    if (exclusion.start >= source.end) break;
    if (exclusion.start > cursor) remaining.push({ start: cursor, end: Math.min(exclusion.start, source.end) });
    cursor = Math.max(cursor, exclusion.end);
    if (cursor >= source.end) break;
  }
  if (cursor < source.end) remaining.push({ start: cursor, end: source.end });
  return remaining;
}

function localVietnamDate(timestamp: number): Date {
  return new Date(timestamp + VIETNAM_OFFSET_MS);
}

function vietnamDate(timestamp: number): string {
  const local = localVietnamDate(timestamp);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, "0")}-${String(local.getUTCDate()).padStart(2, "0")}`;
}

function isDaytime(timestamp: number): boolean {
  const hour = localVietnamDate(timestamp).getUTCHours();
  return hour >= 6 && hour < 22;
}

function nextVietnamBoundaryAfter(timestamp: number): number {
  const local = localVietnamDate(timestamp);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth();
  const day = local.getUTCDate();
  const boundary = (boundaryDay: number, hour: number) => Date.UTC(year, month, boundaryDay, hour) - VIETNAM_OFFSET_MS;
  return [boundary(day, 0), boundary(day, 6), boundary(day, 22), boundary(day + 1, 0)].find(candidate => candidate > timestamp)!;
}

function hasRangeAt(ranges: Range[], timestamp: number): boolean {
  return ranges.some(range => range.start <= timestamp && timestamp < range.end);
}

function contextPair(day: ComputedDay | undefined, context: Context): ActualPair {
  const flags = [...(day?.flags ?? ["MISSING_IN", "MISSING_OUT"])];
  if (!day?.checkInId && !flags.includes("MISSING_IN")) flags.push("MISSING_IN");
  if (!day?.checkOutId && !flags.includes("MISSING_OUT")) flags.push("MISSING_OUT");
  return {
    contextId: context.id,
    scheduleIds: context.scheduleIds,
    checkInId: day?.checkInId ?? null,
    checkOutId: day?.checkOutId ?? null,
    checkInAt: day?.checkInAt ?? null,
    checkOutAt: day?.checkOutAt ?? null,
    flags,
  };
}

function validPair(pair: ActualPair): boolean {
  return pair.checkInAt !== null && pair.checkOutAt !== null
    && !pair.flags.includes("AMBIGUOUS") && !pair.flags.includes("INVALID_PAIR")
    && !pair.flags.includes("MISSING_IN") && !pair.flags.includes("MISSING_OUT");
}

function pairRange(pair: ActualPair): Range | null {
  if (!validPair(pair)) return null;
  const start = new Date(pair.checkInAt!).getTime();
  const end = new Date(pair.checkOutAt!).getTime();
  return end > start ? { start, end } : null;
}

function buildSegments(workRanges: Range[], approvedRanges: Range[], requests: ActualRequestInput[]): ActualSegment[] {
  const segments: ActualSegment[] = [];
  const approvalEdges = approvedRanges.flatMap(range => [range.start, range.end]);
  for (const range of workRanges) {
    let cursor = range.start;
    while (cursor < range.end) {
      const approvalBoundary = approvalEdges.filter(edge => edge > cursor && edge < range.end).sort((left, right) => left - right)[0] ?? range.end;
      const end = Math.min(range.end, approvalBoundary, nextVietnamBoundaryAfter(cursor));
      const eligible = hasRangeAt(approvedRanges, cursor);
      segments.push({
        startAt: isoAt(cursor), endAt: isoAt(end), calendarDate: vietnamDate(cursor),
        kind: isDaytime(cursor) ? "DAY" : "NIGHT", minutes: roundMinutes((end - cursor) / MINUTE_MS),
        eligible,
        requestIds: eligible ? requests.filter(request => {
          const requestRange = rangeFor(request);
          return request.status === "APPROVED" && requestRange.start < end && requestRange.end > cursor;
        }).map(request => request.id) : [],
      });
      cursor = end;
    }
  }
  return segments;
}

function relevantResolution(resolution: PunchResolution, punchesById: Map<string, EnginePunch>, contexts: Context[]): boolean {
  const punch = punchesById.get(resolution.punchId);
  if (!punch) return false;
  const at = new Date(punch.punchedAt).getTime();
  return contexts.some(context => at >= context.start - context.rules.inBeforeMinutes * MINUTE_MS
    && at <= context.end + context.rules.outAfterMinutes * MINUTE_MS);
}

/** Computes observed overtime from approved ranges and punch-derived attendance, never payment. */
export function computeOvertimeAttendance(input: ActualEngineInput): ActualEngineResult {
  const groups = new Map<string, Group>();
  const ensureGroup = (employeeId: string, orgUnitId: string, workDate: string): Group => {
    const key = groupKey(employeeId, orgUnitId, workDate);
    const existing = groups.get(key);
    if (existing) return existing;
    const group = { key, employeeId, orgUnitId, workDate, requests: [], schedules: [], assigned: false };
    groups.set(key, group);
    return group;
  };
  for (const request of input.requests) ensureGroup(request.employeeId, request.orgUnitId, request.workDate).requests.push(request);
  for (const assignment of input.assignments) ensureGroup(assignment.employeeId, assignment.orgUnitId, assignment.workDate).assigned = true;
  for (const schedule of input.schedules) ensureGroup(schedule.employeeId, schedule.orgUnitId, schedule.workDate).schedules.push(schedule);

  const contexts: Context[] = [];
  const engineSchedules: EngineSchedule[] = [];
  const rulesBySchedule: Record<string, PairingRules> = {};
  for (const group of groups.values()) {
    const rules = input.rules[`${group.orgUnitId}:${group.workDate}`];
    if (!rules) continue;
    const intervals = [
      ...group.schedules.map(schedule => ({ ...rangeFor(schedule), schedule })),
      ...group.requests.filter(request => request.status === "APPROVED").map(request => ({ ...rangeFor(request), schedule: undefined })),
    ].filter(interval => interval.end > interval.start).sort((left, right) => left.start - right.start || left.end - right.end);
    const components: Array<{ start: number; end: number; schedules: EngineSchedule[] }> = [];
    for (const interval of intervals) {
      const current = components.at(-1);
      if (current && interval.start <= current.end) {
        current.end = Math.max(current.end, interval.end);
        if (interval.schedule) current.schedules.push(interval.schedule);
      } else components.push({ start: interval.start, end: interval.end, schedules: interval.schedule ? [interval.schedule] : [] });
    }
    for (let index = 0; index < components.length; index += 1) {
      const component = components[index];
      const uniqueSchedules = [...new Map(component.schedules.map(schedule => [schedule.id, schedule])).values()];
      const virtual = uniqueSchedules.length !== 1;
      const id = virtual ? `__ot_context__${group.key}:${index}` : uniqueSchedules[0].id;
      const context: Context = { id, groupKey: group.key, scheduleIds: uniqueSchedules.map(schedule => schedule.id), virtual, start: component.start, end: component.end, rules };
      contexts.push(context);
      const schedule = virtual
        ? { id, employeeId: group.employeeId, orgUnitId: group.orgUnitId, workDate: group.workDate, startAt: isoAt(component.start), endAt: isoAt(component.end), workMinutes: 0, breakStartOffset: 0, breakMinutes: 0, paidBreak: true }
        : { ...uniqueSchedules[0], pairingStartAt: isoAt(component.start), pairingEndAt: isoAt(component.end) };
      engineSchedules.push(schedule);
      rulesBySchedule[id] = rules;
    }
  }

  const rawAttendance = computeAttendance(engineSchedules, input.punches, rulesBySchedule);
  const virtualIds = new Set(contexts.filter(context => context.virtual).map(context => context.id));
  const attendance = {
    days: rawAttendance.days.filter(day => !virtualIds.has(day.scheduleId)),
    punches: rawAttendance.punches.map(resolution => virtualIds.has(resolution.scheduleId ?? "") ? { ...resolution, scheduleId: null } : resolution),
  };
  const rawDaysById = new Map(rawAttendance.days.map(day => [day.scheduleId, day]));
  const punchesById = new Map(input.punches.map(punch => [punch.id, punch]));
  const resolutionsById = new Map(attendance.punches.map(resolution => [resolution.punchId, resolution]));
  const contextsByGroup = new Map<string, Context[]>();
  for (const context of contexts) {
    const groupContexts = contextsByGroup.get(context.groupKey);
    if (groupContexts) groupContexts.push(context); else contextsByGroup.set(context.groupKey, [context]);
  }

  // Only adjacent, explicit unmatched events can establish unapproved presence.
  // Resolve ownership once across all business dates; a next-day OUT is never reused.
  const explicitPairs = new Map<string, ActualPair[]>();
  const explicitOwners = new Map<string, string>();
  const unmatchedByEmployee = new Map<string, EnginePunch[]>();
  for (const punch of input.punches) {
    if (resolutionsById.get(punch.id)?.status !== "UNMATCHED") continue;
    const list = unmatchedByEmployee.get(punch.employeeId) ?? [];
    list.push(punch); unmatchedByEmployee.set(punch.employeeId, list);
  }
  const standaloneGroups = [...groups.values()].filter(group => group.assigned && !(contextsByGroup.get(group.key)?.length));
  for (const punches of unmatchedByEmployee.values()) {
    punches.sort((a, b) => Date.parse(a.punchedAt) - Date.parse(b.punchedAt) || a.id.localeCompare(b.id));
    for (let index = 0; index + 1 < punches.length; index += 1) {
      const checkIn = punches[index], checkOut = punches[index + 1];
      const start = Date.parse(checkIn.punchedAt), end = Date.parse(checkOut.punchedAt);
      if (checkIn.direction !== "IN" || checkOut.direction !== "OUT" || end <= start || end - start > 24 * 60 * MINUTE_MS) continue;
      const owners = standaloneGroups.filter(group => {
        if (group.employeeId !== checkIn.employeeId) return false;
        const rules = input.rules[group.orgUnitId + ":" + group.workDate];
        if (!rules) return false;
        if (!group.requests.length) return vietnamDate(start) === group.workDate;
        return group.requests.some(request => {
          const range = rangeFor(request);
          return start >= range.start - rules.inBeforeMinutes * MINUTE_MS && end <= range.end + rules.outAfterMinutes * MINUTE_MS;
        });
      });
      if (owners.length !== 1) continue;
      const owner = owners[0];
      const pairs = explicitPairs.get(owner.key) ?? [];
      pairs.push({ contextId: "explicit:" + owner.key + ":" + pairs.length, scheduleIds: [], checkInId: checkIn.id, checkOutId: checkOut.id, checkInAt: checkIn.punchedAt, checkOutAt: checkOut.punchedAt, flags: ["UNAPPROVED_WORK"] });
      explicitPairs.set(owner.key, pairs);
      explicitOwners.set(checkIn.id, owner.key); explicitOwners.set(checkOut.id, owner.key);
      index += 1;
    }
  }

  const actuals: ComputedActual[] = [];
  for (const group of groups.values()) {
    if (group.requests.length === 0 && !group.assigned) continue;
    const rules = input.rules[group.orgUnitId + ":" + group.workDate];
    if (!rules) continue;
    const approvedRanges = mergeRanges(group.requests.filter(request => request.status === "APPROVED").map(rangeFor));
    const activeRequestedMinutes = roundMinutes(group.requests.filter(request => ACTIVE_STATUSES.has(request.status)).reduce((total, request) => total + request.requestedMinutes, 0));
    const approvedMinutes = roundMinutes(approvedRanges.reduce((total, range) => total + (range.end - range.start) / MINUTE_MS, 0));
    const groupContexts = contextsByGroup.get(group.key) ?? [];
    const pairs = groupContexts.map(context => contextPair(rawDaysById.get(context.id), context));
    pairs.push(...(explicitPairs.get(group.key) ?? []));
    const flags = new Set<string>();
    const now = Date.now();
    for (const [index, context] of groupContexts.entries()) {
      const pair = pairs[index];
      if (now < context.end + rules.outAfterMinutes * MINUTE_MS && !validPair(pair)) flags.add("AWAITING_PUNCHES");
      else for (const flag of pair.flags) {
        if (["AMBIGUOUS", "INVALID_PAIR", "MISSING_IN", "MISSING_OUT"].includes(flag)) { flags.add(flag); flags.add("UNMATCHED_PUNCH"); }
      }
    }
    const standalonePunches = (unmatchedByEmployee.get(group.employeeId) ?? []).filter(punch => {
      const owner = explicitOwners.get(punch.id);
      if (owner) return owner === group.key;
      return !groupContexts.length && vietnamDate(Date.parse(punch.punchedAt)) === group.workDate;
    });
    if (!pairs.length) {
      if (group.requests.some(request => now < rangeFor(request).end + rules.outAfterMinutes * MINUTE_MS)) flags.add("AWAITING_PUNCHES");
      else if (group.requests.length || standalonePunches.length) flags.add("UNMATCHED_PUNCH");
    }
    if (standalonePunches.some(punch => !explicitOwners.has(punch.id))) flags.add("UNMATCHED_PUNCH");
    const normalRanges = mergeRanges(group.schedules.map(rangeFor));
    const observedRanges = mergeRanges(pairs.map(pairRange).filter((range): range is Range => range !== null)).flatMap(range => subtractRanges(range, normalRanges));
    const segments = buildSegments(observedRanges, approvedRanges, group.requests);
    const actualMinutes = roundMinutes(segments.reduce((total, segment) => total + segment.minutes, 0));
    const eligibleMinutes = roundMinutes(segments.filter(segment => segment.eligible).reduce((total, segment) => total + segment.minutes, 0));
    const unapprovedMinutes = roundMinutes(Math.max(0, actualMinutes - eligibleMinutes));
    const unworkedApprovedMinutes = roundMinutes(Math.max(0, approvedMinutes - eligibleMinutes));
    if (unapprovedMinutes > 0) flags.add("UNAPPROVED_WORK");
    if (unworkedApprovedMinutes > 0 && !flags.has("AWAITING_PUNCHES")) flags.add("APPROVED_NOT_WORKED");
    const punchIds = input.punches.filter(punch => punch.employeeId === group.employeeId && relevantResolution(resolutionsById.get(punch.id)!, punchesById, groupContexts)).map(punch => punch.id);
    punchIds.push(...standalonePunches.map(punch => punch.id));
    for (const pair of pairs) {
      if (pair.checkInId) punchIds.push(pair.checkInId);
      if (pair.checkOutId) punchIds.push(pair.checkOutId);
    }
    actuals.push({
      employeeId: group.employeeId, orgUnitId: group.orgUnitId, workDate: group.workDate,
      requestedMinutes: activeRequestedMinutes, approvedMinutes, actualMinutes, eligibleMinutes,
      dayMinutes: roundMinutes(segments.filter(segment => segment.kind === "DAY" && segment.eligible).reduce((total, segment) => total + segment.minutes, 0)),
      nightMinutes: roundMinutes(segments.filter(segment => segment.kind === "NIGHT" && segment.eligible).reduce((total, segment) => total + segment.minutes, 0)),
      unapprovedMinutes, unworkedApprovedMinutes, flags: [...flags].sort(), segments, pairs,
      requests: group.requests, punchIds: [...new Set(punchIds)],
    });
  }
  return { attendance, actuals };
}
