// Pure rotation helpers (FR-3.1.3, 3.2.1): schedules are generated here, then go through the existing validation.

const DAY = 86400000;
const MINUTE = 60000;
const key = (value: Date) => value.toISOString().slice(0, 10);
const day = (value: string) => new Date(value + "T00:00:00Z");

export interface ShiftShape { id: string; startTime: string; endTime: string; crossesMidnight: boolean; workMinutes: number }
export interface GeneratedLine { employeeId: string; workDate: string; shiftId: string }

/** Business-time (UTC+7) window of a shift on a work date; night shifts end the next calendar day. */
export function shiftWindow(workDate: string, shift: Pick<ShiftShape, "startTime" | "endTime" | "crossesMidnight">) {
  const startAt = new Date(workDate + "T" + shift.startTime + ":00+07:00");
  const endAt = new Date(new Date(workDate + "T" + shift.endTime + ":00+07:00").getTime() + (shift.crossesMidnight ? DAY : 0));
  return { startAt, endAt };
}

/** Day i of the range takes cycle position (i + cycleOffset) mod cycleDays; null positions are rest days. */
export function generateFromPattern(sequence: Array<string | null>, members: Array<{ employeeId: string; cycleOffset: number }>, from: string, to: string): GeneratedLine[] {
  if (!sequence.length) return [];
  const lines: GeneratedLine[] = [];
  const days = Math.round((day(to).getTime() - day(from).getTime()) / DAY);
  for (const member of members)
    for (let index = 0; index <= days; index++) {
      const position = ((index + member.cycleOffset) % sequence.length + sequence.length) % sequence.length;
      const shiftId = sequence[position];
      if (shiftId) lines.push({ employeeId: member.employeeId, workDate: key(new Date(day(from).getTime() + index * DAY)), shiftId });
    }
  return lines;
}

/** Consecutive shifts of one person closer than `minRestMinutes` (end of one → start of the next). */
export function restViolations(lines: Array<{ employeeId: string; workDate: string; startAt: Date; endAt: Date }>, minRestMinutes: number) {
  const byEmployee = new Map<string, typeof lines>();
  for (const line of lines) byEmployee.set(line.employeeId, [...(byEmployee.get(line.employeeId) ?? []), line]);
  const result: Array<{ employeeId: string; workDate: string; previousDate: string; gapMinutes: number; requiredMinutes: number }> = [];
  for (const rows of byEmployee.values()) {
    rows.sort((left, right) => left.startAt.getTime() - right.startAt.getTime());
    for (let index = 1; index < rows.length; index++) {
      const gap = (rows[index].startAt.getTime() - rows[index - 1].endAt.getTime()) / MINUTE;
      if (gap < minRestMinutes) result.push({ employeeId: rows[index].employeeId, workDate: rows[index].workDate, previousDate: rows[index - 1].workDate, gapMinutes: gap, requiredMinutes: minRestMinutes });
    }
  }
  return result;
}

/**
 * Source day copied onto a target day. WEEKDAY: the latest source day with the same weekday. CYCLE: the shift keeps
 * the cycle phase (target − source is a multiple of `cycleDays`).
 */
export function copySourceDate(mode: "WEEKDAY" | "CYCLE", sourceFrom: string, sourceTo: string, target: string, cycleDays = 7): string | null {
  const step = mode === "WEEKDAY" ? 7 : cycleDays;
  if (!Number.isInteger(step) || step < 1) return null;
  const distance = Math.round((day(target).getTime() - day(sourceTo).getTime()) / DAY);
  const back = distance <= 0 ? 0 : Math.ceil(distance / step) * step;
  const source = new Date(day(target).getTime() - back * DAY);
  return source >= day(sourceFrom) && source <= day(sourceTo) ? key(source) : null;
}
