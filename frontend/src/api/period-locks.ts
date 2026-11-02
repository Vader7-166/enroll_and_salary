import { api } from "./client";
import type { TeamConfirmationActor, TeamConfirmationDay, TeamConfirmationOvertime, TeamConfirmationPeriod, TeamConfirmationSnapshot, TeamConfirmationSummary, TeamConfirmationTeam } from "./attendance-confirmations";
import type { WorkshopClosureIssue } from "./workshop-closures";

export interface PeriodLockPeriod extends TeamConfirmationPeriod {
  scopeOrgUnitId: string;
  scopeName: string;
}
export interface PeriodLockPrevious {
  id: string;
  code: string;
  status: string;
  dateFrom: string;
  dateTo: string;
}
export interface PeriodLockSummary extends TeamConfirmationSummary {
  workshops: number;
  closedWorkshops: number;
}
export interface PeriodLockIssue extends WorkshopClosureIssue {
  workshopOrgUnitId?: string;
  workshopName?: string;
}
export interface PeriodLockWorkshop {
  workshop: TeamConfirmationTeam;
  state: string;
  revision: number;
  sourceHash: string;
  closureId: string | null;
  summary: TeamConfirmationSummary;
  blockers: PeriodLockIssue[];
  warnings: PeriodLockIssue[];
}
export interface PeriodLockSourceTeam {
  team: TeamConfirmationTeam;
  revision: number;
  sourceHash: string;
  confirmationId?: string;
  days: TeamConfirmationDay[];
  overtime: TeamConfirmationOvertime[];
  snapshot: TeamConfirmationSnapshot;
}
export interface PeriodLockSnapshot {
  schemaVersion: 1;
  period: Pick<PeriodLockPeriod, "id" | "code" | "dateFrom" | "dateTo" | "scopeOrgUnitId" | "scopeName">;
  summary: PeriodLockSummary;
  workshops: PeriodLockWorkshop[];
  teams: PeriodLockSourceTeam[];
  accessItems: { employeeId: string; orgUnitId: string; workDate: string; sourceDates: string[] }[];
  initialization: boolean;
  previousPeriod: PeriodLockPrevious | null;
}
export interface PeriodLockSource {
  id: string;
  sourceHash: string;
  actor: TeamConfirmationActor;
  occurredAt: string;
  snapshot: PeriodLockSnapshot;
}
export interface PeriodLockHistory {
  id: string;
  revision: number;
  action: "RETURN" | "LOCK";
  sourceHash: string;
  note: string;
  actor: TeamConfirmationActor;
  occurredAt: string;
  snapshot: Partial<PeriodLockSnapshot> & { [key: string]: unknown };
}
export interface PeriodLockReview {
  period: PeriodLockPeriod;
  revision: number;
  sourceHash: string;
  canLock: boolean;
  canReturn: boolean;
  initialization: boolean;
  previousPeriod: PeriodLockPrevious | null;
  summary: PeriodLockSummary;
  blockers: PeriodLockIssue[];
  warnings: PeriodLockIssue[];
  workshops: PeriodLockWorkshop[];
  history: PeriodLockHistory[];
  lockedSource: PeriodLockSource | null;
}
export interface PeriodLockToken {
  periodId: string;
  revision: number;
  sourceHash: string;
}
export interface PeriodLockInput extends PeriodLockToken {
  reviewed: true;
  acknowledgeWarnings: boolean;
  note?: string;
}
export interface PeriodReturnInput extends PeriodLockToken {
  reason: string;
}
export interface PeriodLockResult {
  id: string;
  revision: number;
  sourceHash: string;
  occurredAt: string;
}
const base = "/api/attendance/period-locks";
export const periodLocksApi = {
  review: (periodId: string) => api<PeriodLockReview>(`${base}/review?${new URLSearchParams({ periodId })}`),
  lock: (input: PeriodLockInput) => api<PeriodLockResult>(base, { method: "POST", body: JSON.stringify(input) }),
  return: (input: PeriodReturnInput) => api<PeriodLockResult>(`${base}/return`, { method: "POST", body: JSON.stringify(input) }),
};
