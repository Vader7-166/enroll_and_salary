import type { AttendanceSegment, EnginePunch, EngineResult, EngineSchedule, PairingRules } from "./attendance.types";

export interface ActualRequestInput {
  id: string; employeeId: string; orgUnitId: string; workDate: string;
  title: string; status: string; revision: number; startAt: string; endAt: string;
  requestedMinutes: number; consentReference: string;
}
export interface ActualAssignment { employeeId: string; orgUnitId: string; workDate: string }
export interface ActualSegment extends AttendanceSegment { eligible: boolean; requestIds: string[] }
export interface ActualPair {
  contextId: string; scheduleIds: string[]; checkInId: string | null; checkOutId: string | null;
  checkInAt: string | null; checkOutAt: string | null; flags: string[];
}
export interface ComputedActual extends ActualAssignment {
  requestedMinutes: number; approvedMinutes: number; actualMinutes: number; eligibleMinutes: number;
  dayMinutes: number; nightMinutes: number; unapprovedMinutes: number; unworkedApprovedMinutes: number;
  flags: string[]; segments: ActualSegment[]; pairs: ActualPair[];
  requests: ActualRequestInput[]; punchIds: string[];
}
export interface ActualEngineInput {
  schedules: EngineSchedule[]; requests: ActualRequestInput[]; punches: EnginePunch[];
  assignments: ActualAssignment[];
  // Key: orgUnitId + ":" + workDate. Resolved by dated policy in the service.
  rules: Record<string, PairingRules>;
}
export interface ActualEngineResult { attendance: EngineResult; actuals: ComputedActual[] }
