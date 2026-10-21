import { api } from "./client";
import type { TeamConfirmationActor, TeamConfirmationIssue, TeamConfirmationPeriod, TeamConfirmationSummary, TeamConfirmationTeam, TeamConfirmationState } from "./attendance-confirmations";

export interface WorkshopClosureIssue extends TeamConfirmationIssue {
  teamOrgUnitId?: string;
  teamName?: string;
  employeeCode?: string;
  employeeName?: string;
}

export interface WorkshopClosureTeam {
  team: TeamConfirmationTeam;
  state: TeamConfirmationState;
  revision: number;
  sourceHash: string;
  summary: TeamConfirmationSummary;
  blockers: TeamConfirmationIssue[];
  warnings: TeamConfirmationIssue[];
}

export interface WorkshopClosureHistory {
  id: string;
  revision: number;
  action: "CLOSE" | "RETURN";
  sourceHash: string;
  note: string;
  actor: TeamConfirmationActor;
  occurredAt: string;
  snapshot?: { summary?: TeamConfirmationSummary; [key: string]: unknown };
}

export interface WorkshopClosureReview {
  period: TeamConfirmationPeriod;
  workshop: TeamConfirmationTeam;
  sourceHash: string;
  revision: number;
  state: "WAITING" | "CLOSED" | "STALE" | "RETURNED";
  canClose: boolean;
  canReturn: boolean;
  summary: TeamConfirmationSummary;
  blockers: WorkshopClosureIssue[];
  warnings: WorkshopClosureIssue[];
  teams: WorkshopClosureTeam[];
  history: WorkshopClosureHistory[];
}

export interface WorkshopClosureScope {
  periodId: string;
  workshopOrgUnitId: string;
}
export interface WorkshopClosureInput extends WorkshopClosureScope {
  revision: number;
  sourceHash: string;
  reviewed: true;
  acknowledgeWarnings: boolean;
  note?: string;
}
export interface WorkshopReturnInput extends WorkshopClosureScope {
  revision: number;
  sourceHash: string;
  reason: string;
}

const base = "/api/attendance/workshop-closures";
export const workshopClosuresApi = {
  workshops: (periodId: string) => api<{ items: TeamConfirmationTeam[] }>(`${base}/workshops?${new URLSearchParams({ periodId })}`),
  review: (scope: WorkshopClosureScope) => api<WorkshopClosureReview>(`${base}/review?${new URLSearchParams({ periodId: scope.periodId, workshopOrgUnitId: scope.workshopOrgUnitId })}`),
  close: (input: WorkshopClosureInput) => api<WorkshopClosureHistory>(base, { method: "POST", body: JSON.stringify(input) }),
  return: (input: WorkshopReturnInput) => api<WorkshopClosureHistory>(`${base}/return`, { method: "POST", body: JSON.stringify(input) }),
};
