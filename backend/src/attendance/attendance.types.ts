export type PunchDirection = "IN" | "OUT" | "AUTO";
export interface ImportMapping {
  columns: { employeeCode: number; date: number; time: number; deviceCode: number; direction: number };
  delimiter: "," | ";" | "\t" | "|";
  encoding: "utf8" | "utf16le" | "windows1258";
  skipRows: number;
  dateFormat: "YYYY-MM-DD" | "DD/MM/YYYY";
  timeFormat: "HH:mm:ss" | "HH:mm";
}
export const STANDARD_MAPPING: ImportMapping = {
  columns: { employeeCode: 0, date: 1, time: 2, deviceCode: 3, direction: 4 },
  delimiter: ",", encoding: "utf8", skipRows: 0, dateFormat: "YYYY-MM-DD", timeFormat: "HH:mm:ss",
};
export interface ImportRowError { row: number; code: string; message: string }
export interface ParsedPunch { row: number; employeeCode: string; punchedAt: string; deviceCode: string; direction: PunchDirection; source: string[] }
export interface ParsedImport { rows: ParsedPunch[]; errors: ImportRowError[]; totalRows: number }
export interface PairingRules { inBeforeMinutes: number; inAfterMinutes: number; outBeforeMinutes: number; outAfterMinutes: number; duplicateWindowMinutes: number }
export interface EngineSchedule {
  id: string; employeeId: string; orgUnitId: string; workDate: string;
  startAt: string; endAt: string; workMinutes: number;
  breakStartOffset: number; breakMinutes: number; paidBreak: boolean;
  /** Pairing-only centers. Regular attendance always uses startAt/endAt. */
  pairingStartAt?: string;
  pairingEndAt?: string;
}
export interface EnginePunch { id: string; employeeId: string; punchedAt: string; direction: PunchDirection }
export interface ApprovedAttendanceAdjustment {
  id: string; employeeId: string; orgUnitId: string; workDate: string;
  intervals: Array<{ startAt: string; endAt: string }> | null;
  excuseLateEarly: boolean;
}
export interface AttendanceSegment { startAt: string; endAt: string; calendarDate: string; kind: "DAY" | "NIGHT"; minutes: number }
export interface ComputedDay {
  scheduleId: string; employeeId: string; orgUnitId: string; workDate: string;
  checkInId: string | null; checkOutId: string | null; checkInAt: string | null; checkOutAt: string | null;
  status: "OK" | "ERR"; flags: string[]; workedMinutes: number; dayMinutes: number; nightMinutes: number;
  lateMinutes: number; earlyMinutes: number; absent: boolean; workUnits: string; segments: AttendanceSegment[];
  adjustmentId?: string;
}
export interface PunchResolution {
  punchId: string; scheduleId: string | null;
  status: "MATCHED" | "SUPPRESSED" | "UNMATCHED" | "AMBIGUOUS";
  reason: string | null;
}
export interface EngineResult { days: ComputedDay[]; punches: PunchResolution[] }
export interface ImportPeriodSummary { periodId: string | null; periodCode: string | null; processed: number; waiting: number; late: number }
export interface ImportSummary { inserted: number; duplicates: number; processed: number; waiting: number; late: number; exceptionDays: number; periods: ImportPeriodSummary[] }