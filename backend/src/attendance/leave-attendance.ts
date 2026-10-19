import Decimal from "decimal.js";
import type { ComputedDay, EngineSchedule } from "./attendance.types";
export interface ApprovedLeaveSource {
  requestId: string; revision: number; workDate: string; scheduleId: string; orgUnitId: string;
  startAt: string; endAt: string; minutes: number; workMinutes: number;
  attendanceSymbol: string; isPaid: boolean; countsAsWorkday: boolean;
  holiday: boolean; holidayParameterId: string; typeVersionId: string;
}
export interface LeaveAttendance {
  minutes: number; paidMinutes: number; countedUnits: string; symbols: string[]; sources: ApprovedLeaveSource[];
}
type Range = { start: number; end: number };
const MINUTE = 60000;
function subtract(ranges: Range[], excluded: Range[]): Range[] {
  for (const cut of excluded) ranges = ranges.flatMap(range => cut.end <= range.start || cut.start >= range.end ? [range] : [{ start: range.start, end: Math.min(range.end, cut.start) }, { start: Math.max(range.start, cut.end), end: range.end }].filter(r => r.end > r.start));
  return ranges;
}
function working(schedule: EngineSchedule): Range[] {
  const start = Date.parse(schedule.startAt), end = Date.parse(schedule.endAt);
  const pause = start + schedule.breakStartOffset * MINUTE;
  return schedule.paidBreak || !schedule.breakMinutes ? [{start,end}] : subtract([{start,end}], [{start:pause,end:pause+schedule.breakMinutes*MINUTE}]);
}
function ranges(sources: ApprovedLeaveSource[]): Range[] { return sources.map(source => ({start:Date.parse(source.startAt),end:Date.parse(source.endAt)})); }
function minutes(items: Range[]): number { return items.reduce((sum,r) => sum+(r.end-r.start)/MINUTE,0); }
export function leavePairingSchedule(schedule: EngineSchedule, sources: ApprovedLeaveSource[]): EngineSchedule {
  if (!sources.length) return schedule;
  const remaining = subtract(working(schedule), ranges(sources));
  return remaining.length ? {...schedule,pairingStartAt:new Date(remaining[0].start).toISOString(),pairingEndAt:new Date(remaining.at(-1)!.end).toISOString()} : schedule;
}
export function applyApprovedLeave(day: ComputedDay, schedule: EngineSchedule, sources: ApprovedLeaveSource[]): {day: ComputedDay; leave: LeaveAttendance} {
  const leave: LeaveAttendance = {minutes:0,paidMinutes:0,countedUnits:"0",symbols:[],sources};
  if (!sources.length) return {day,leave};
  const valid = sources.filter(s => s.scheduleId === schedule.id && s.workMinutes === schedule.workMinutes && s.orgUnitId === schedule.orgUnitId && Date.parse(s.startAt) >= Date.parse(schedule.startAt) && Date.parse(s.endAt) <= Date.parse(schedule.endAt));
  const flags = [...day.flags];
  if (valid.length !== sources.length) flags.push("LEAVE_SCHEDULE_CHANGED");
  const work = working(schedule), cuts = ranges(valid), remaining = subtract(work,cuts);
  leave.minutes = minutes(work)-minutes(remaining);
  leave.symbols = [...new Set(valid.map(s=>s.attendanceSymbol))];
  const present = day.segments.map(s=>({start:Date.parse(s.startAt),end:Date.parse(s.endAt)}));
  const credited = (predicate: (s: ApprovedLeaveSource)=>boolean) => minutes(subtract(work, present))-minutes(subtract(subtract(work,present),ranges(valid.filter(predicate))));
  leave.paidMinutes = credited(s=>s.isPaid);
  leave.countedUnits = new Decimal(credited(s=>s.countsAsWorkday)).div(schedule.workMinutes).toFixed(6);
  if (minutes(subtract(present,cuts)) < minutes(present)) flags.push("LEAVE_WORK_OVERLAP");
  let late = day.lateMinutes, early = day.earlyMinutes;
  if (day.checkInAt && day.checkOutAt && !flags.some(f=>["MISSING_IN","MISSING_OUT","INVALID_PAIR","AMBIGUOUS"].includes(f))) {
    const start = Date.parse(day.checkInAt), end = Date.parse(day.checkOutAt);
    late = Math.ceil(minutes(remaining.map(r=>({start:r.start,end:Math.min(r.end,start)})).filter(r=>r.end>r.start)));
    early = Math.ceil(minutes(remaining.map(r=>({start:Math.max(r.start,end),end:r.end})).filter(r=>r.end>r.start)));
  }
  const full = remaining.length === 0 && valid.length === sources.length;
  const finalFlags = flags.filter(f=> !(f==="LATE"&&(!late||full)) && !(f==="EARLY"&&(!early||full)) && !(full&&["ABSENT","MISSING_IN","MISSING_OUT"].includes(f)));
  return {day:{...day,flags:finalFlags,lateMinutes:full?0:late,earlyMinutes:full?0:early,absent:full?false:day.absent,status:full&&!finalFlags.some(f=>["AMBIGUOUS","INVALID_PAIR"].includes(f))?"OK":day.status,workUnits:Decimal.min(1,new Decimal(day.workUnits).plus(leave.countedUnits)).toFixed(6)},leave};
}
