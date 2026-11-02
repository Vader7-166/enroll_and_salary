export type OvertimeStatus = "DRAFT" | "PENDING" | "APPROVED" | "RETURNED" | "REJECTED" | "CANCELLED";
export type OvertimeAction = "SUBMIT" | "APPROVE" | "RETURN" | "REJECT" | "CANCEL";
export interface OvertimeInput {
  teamOrgUnitId: string;
  title: string;
  workDate: string;
  startAt: string;
  endAt: string;
  reason: string;
  members: Array<{ employeeId: string; consentReference: string }>;
}
export interface OvertimeSnapshot {
  id: string; teamOrgUnitId: string; teamOrgUnitCode: string; title: string;
  workDate: string; startAt: string; endAt: string; requestedMinutes: number; reason: string;
  status: OvertimeStatus; revision: number;
  createdBy: { id: string; displayName: string }; createdAt: string; updatedAt: string;
  members: Array<{ employee: { id: string; code: string; fullName: string }; consentReference: string }>;
}
export interface OvertimeReview {
  approvable: boolean;
  blocking: string[];
  warnings: string[];
  employees: Array<{
    employeeId: string; code: string; dailyMinutes: number; dailyLimitMinutes: number;
    months: Array<{ month: string; minutes: number; limitMinutes: number }>;
    years: Array<{ year: string; minutes: number; limitMinutes: number }>;
  }>;
}
