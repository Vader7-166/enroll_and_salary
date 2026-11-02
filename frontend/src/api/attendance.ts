import { api } from "./client";
import type { Correction } from "./corrections";

export type PunchDirection = "IN" | "OUT" | "AUTO";
export type RawPunchState = "PROCESSED" | "WAITING" | "LATE" | "UNMATCHED" | "AMBIGUOUS" | "SUPPRESSED";
export type BatchStatus = "REJECTED" | "ACCEPTED" | "ACCEPTED_WITH_EXCEPTIONS";

export interface ImportMapping {
  columns: { employeeCode: number; date: number; time: number; deviceCode: number; direction: number };
  delimiter: "," | ";" | "\t" | "|";
  encoding: "utf8" | "utf16le" | "windows1258";
  skipRows: number;
  dateFormat: "YYYY-MM-DD" | "DD/MM/YYYY";
  timeFormat: "HH:mm:ss" | "HH:mm";
}

export interface AttendancePeriod {
  id: string;
  code: string;
  scopeOrgUnitId?: string | null;
  status?: string;
  startDate?: string;
  endDate?: string;
}

export interface AttendanceSite { id: string; code: string; name: string; orgUnitId: string; periodIds: string[] }
export interface AttendanceProfile { id: string; siteId: string; name: string; mapping: ImportMapping; revision: number }
export interface AttendanceContext { sites: AttendanceSite[]; units: { id: string; code: string; name: string; siteId: string }[]; periods: AttendancePeriod[]; profiles: AttendanceProfile[] }

export interface RawRow {
  id: string;
  employee: { id: string; code: string; fullName: string };
  punchedAt: string;
  direction: PunchDirection;
  deviceCode: string;
  batchId: string;
  rowNumber: number;
  source: string[];
  state: RawPunchState;
  reason: string | null;
  workDate: string | null;
  periodId: string | null;
  scheduleId: string | null;
}

export interface ImportPeriodSummary { periodId: string | null; periodCode: string | null; processed: number; waiting: number; late: number }
export interface ImportSummary {
  inserted: number; duplicates: number; processed: number; waiting: number; late: number; exceptionDays: number;
  periods: ImportPeriodSummary[];
}
export interface Batch {
  id: string;
  siteId: string;
  siteName: string;
  fileName: string;
  fileHash: string;
  status: BatchStatus;
  createdAt: string;
  createdBy: { id: string; displayName: string };
  totalRows: number;
  summary: ImportSummary;
  errors: { row: number; code: string; message: string }[];
}

export interface AttendanceSegment { startAt: string; endAt: string; calendarDate: string; kind: "DAY" | "NIGHT"; minutes: number }
export interface DailyRow {
  id: string;
  employee: { id: string; code: string; fullName: string };
  orgUnitId: string;
  orgUnitCode: string;
  orgUnitName: string;
  workDate: string;
  shift: { code: string; name: string; startAt: string; endAt: string; workMinutes: number; paidBreak: boolean; breakMinutes: number };
  checkInAt: string | null;
  checkOutAt: string | null;
  status: "OK" | "ERR";
  flags: string[];
  workedMinutes: number;
  dayMinutes: number;
  nightMinutes: number;
  lateMinutes: number;
  earlyMinutes: number;
  absent: boolean;
   workUnits: string;
   leave: {minutes?:number;paidMinutes?:number;countedUnits?:string;symbols?:string[];sources?:Array<{requestId:string;revision:number;attendanceSymbol:string;startAt:string;endAt:string;typeVersionId:string;holiday:boolean;holidayParameterId:string}>};
  processedAt: string;
  periodId: string;
  adjustmentId: string | null;
  correctionId: string | null;
}

export interface Page<T> { items: T[]; total: number; page: number; pageSize: number }
export interface BoardResult extends Page<DailyRow> {
  summary: { days: number; exceptionDays: number; workedMinutes: number; nightMinutes: number };
  period: AttendancePeriod;
}

export interface ActualRow {
  id: string;
  employee: { id: string; code: string; fullName: string };
  orgUnitId: string;
  orgUnitCode: string;
  orgUnitName: string;
  periodId: string;
  workDate: string;
  requestedMinutes: number;
  approvedMinutes: number;
  actualMinutes: number;
  eligibleMinutes: number;
  dayMinutes: number;
  nightMinutes: number;
  unapprovedMinutes: number;
  unworkedApprovedMinutes: number;
  flags: string[];
  processedAt: string;
  adjustmentId: string | null;
  correctionId: string | null;
}

export interface OvertimeActualResult extends Page<ActualRow> {
  summary: {
    requestedMinutes: number;
    approvedMinutes: number;
    actualMinutes: number;
    eligibleMinutes: number;
    dayMinutes: number;
    nightMinutes: number;
    unapprovedMinutes: number;
    exceptionDays: number;
  };
  period: AttendancePeriod;
}

export interface OvertimeActualDetail {
  actual: ActualRow;
  segments: (AttendanceSegment & { eligible: boolean; requestIds: string[] })[];
  pairs: {
    contextId: string;
    scheduleIds: string[];
    checkInId: string | null;
    checkOutId: string | null;
    checkInAt: string | null;
    checkOutAt: string | null;
    flags: string[];
  }[];
  requests: {
    id: string;
    title: string;
    status: string;
    revision: number;
    startAt: string;
    endAt: string;
    requestedMinutes: number;
    consentReference: string;
    employeeId: string;
    orgUnitId: string;
    workDate: string;
  }[];
  punches: RawRow[];
  corrections?: Correction[];
  rules: unknown;
}

function query(values: Record<string, string | number | boolean | undefined>): string {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== "") params.set(key, String(value));
  });
  const result = params.toString();
  return result ? `?${result}` : "";
}

export const attendanceApi = {
  context: () => api<AttendanceContext>("/api/attendance/context"),
  createProfile: (payload: { siteId: string; name: string; mapping: ImportMapping }) =>
    api<{ profile: AttendanceProfile }>("/api/attendance/profiles", { method: "POST", body: JSON.stringify(payload) }),
  importFile: (file: File, siteId: string, referencePeriodId: string, profileId?: string) => {
    const body = new FormData();
    body.set("file", file);
    body.set("siteId", siteId);
    body.set("referencePeriodId", referencePeriodId);
    if (profileId) body.set("profileId", profileId);
    return api<{ batch: Batch }>("/api/attendance/imports", { method: "POST", body });
  },
  imports: (siteId: string, page: number, pageSize: number) =>
    api<Page<Batch>>(`/api/attendance/imports${query({ siteId, page, pageSize })}`),
  importDetail: (id: string) => api<{ batch: Batch; punches: RawRow[] }>(`/api/attendance/imports/${id}`),
  board: (filters: { periodId: string; orgUnitId?: string; search?: string; exceptionsOnly?: boolean; page: number; pageSize: number }) =>
    api<BoardResult>(`/api/attendance/board${query(filters)}`),
  overtimeActuals: (filters: { periodId: string; orgUnitId?: string; search?: string; exceptionsOnly?: boolean; page: number; pageSize: number }) =>
    api<OvertimeActualResult>(`/api/attendance/overtime-actuals${query(filters)}`),
  overtimeActual: (id: string) => api<OvertimeActualDetail>(`/api/attendance/overtime-actuals/${id}`),
  day: (id: string) => api<{ day: DailyRow; punches: RawRow[]; segments: AttendanceSegment[]; corrections: Correction[] }>(`/api/attendance/days/${id}`),
  punches: (filters: { siteId: string; state?: RawPunchState; search?: string; page: number; pageSize: number }) =>
    api<Page<RawRow>>(`/api/attendance/punches${query(filters)}`),
  process: (payload: { siteId: string; referencePeriodId: string }) =>
    api<{ summary: ImportSummary }>("/api/attendance/process", { method: "POST", body: JSON.stringify(payload) }),
};
