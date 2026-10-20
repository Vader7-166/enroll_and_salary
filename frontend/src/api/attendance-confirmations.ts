import { api } from "./client";

export type TeamConfirmationState = "WAITING" | "CONFIRMED" | "STALE";

export interface TeamConfirmationTeam {
  id: string;
  code: string;
  name: string;
  siteId: string;
}

export interface TeamConfirmationIssue {
  code: string;
  message: string;
  employeeId?: string;
  workDate?: string;
  sourceId?: string;
}

export interface TeamConfirmationActor {
  id: string;
  displayName: string;
}

export interface TeamConfirmationPeriod {
  id: string;
  code: string;
  status: string;
  revision: number;
  dateFrom: string;
  dateTo: string;
}

export interface TeamConfirmationDay {
  scheduleId: string;
  employee: { id: string; code: string; fullName: string };
  workDate: string;
  shiftCode: string;
  status: string;
  workedMinutes: number;
  workUnits: string;
  flags: string[];
  leave: {
    minutes: number;
    paidMinutes: number;
    countedUnits: number;
    symbols: string[];
    sources: { requestId: string; minutes?: number; paidMinutes?: number; countedUnits?: number; symbol?: string }[];
  };
  correctionId: string | null;
}

export interface TeamConfirmationOvertime {
  employeeId: string;
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
  adjustmentId: string | null;
  requestIds: string[];
}

export interface TeamConfirmationLeave {
  id: string;
  employeeId: string;
  status: string;
  revision: number;
}

export interface TeamConfirmationCorrection {
  id: string;
  status: string;
  revision: number;
  kind: string;
  reason: string;
  evidenceReference: string | null;
  incidentReference: string | null;
  appliedOrder?: number | null;
  items?: { id?: string; employeeId: string; orgUnitId: string; workDate: string; sourceDates?: string[] }[];
  evidence?: { id: string; sha256?: string }[];
}

export interface TeamConfirmationBatch {
  id: string;
  fileName: string;
  fileHash: string;
  status: string;
  totalRows: number;
}

export interface TeamConfirmationCollection {
  from: string;
  until: string;
  sourceHash: string;
  requiredBatchIds: string[];
  batches: TeamConfirmationBatch[];
}

export interface TeamConfirmationCoverage {
  id: string;
  revision: number;
  valid: boolean;
  sourceHash: string;
  coveredFrom: string;
  coveredUntil: string;
  reference: string;
  reason: string;
  batchIds: string[];
  actor: TeamConfirmationActor;
  createdAt: string;
}

export interface TeamConfirmationHistoryEntry {
  id: string;
  revision: number;
  sourceHash: string;
  note: string;
  actor: TeamConfirmationActor;
  confirmedAt: string;
}

export interface TeamConfirmationSnapshot {
  roster: { id: string; code: string; fullName: string }[];
  accessItems?: { employeeId: string; orgUnitId: string; workDate: string; sourceDates: string[] }[];
  [key: string]: unknown;
}

export interface TeamConfirmationSummary {
  employees: number;
  scheduledDays: number;
  processedDays: number;
  workedMinutes: number;
  workUnits: number;
  leaveMinutes: number;
  approvedLeaveRequests: number;
  overtimeApprovedMinutes: number;
  overtimeActualMinutes: number;
  overtimeEligibleMinutes: number;
  blockers: number;
  warnings: number;
}

export interface TeamConfirmationReview {
  period: TeamConfirmationPeriod;
  team: TeamConfirmationTeam;
  sourceHash: string;
  revision: number;
  state: TeamConfirmationState;
  canConfirm: boolean;
  summary: TeamConfirmationSummary;
  blockers: TeamConfirmationIssue[];
  warnings: TeamConfirmationIssue[];
  days: TeamConfirmationDay[];
  overtime: TeamConfirmationOvertime[];
  leaves: TeamConfirmationLeave[];
  corrections: TeamConfirmationCorrection[];
  collection: TeamConfirmationCollection;
  coverage: TeamConfirmationCoverage | null;
  history: TeamConfirmationHistoryEntry[];
  snapshot: TeamConfirmationSnapshot;
}

export interface TeamConfirmationReviewInput {
  periodId: string;
  teamOrgUnitId: string;
}

export interface SourceCoverageInput extends TeamConfirmationReviewInput {
  revision: number;
  sourceHash: string;
  coveredFrom: string;
  coveredUntil: string;
  reference: string;
  reason: string;
  batchIds: string[];
}

export interface TeamConfirmationInput extends TeamConfirmationReviewInput {
  revision: number;
  sourceHash: string;
  reviewed: true;
  acknowledgeWarnings: boolean;
  note?: string;
}
export interface SourceCoverageResult {
  id: string;
  revision: number;
}

export interface TeamConfirmationResult extends SourceCoverageResult {
  sourceHash: string;
  confirmedAt: string;
}

function query(values: Record<string, string>): string {
  const params = new URLSearchParams(values);
  return `?${params.toString()}`;
}

export const attendanceConfirmationsApi = {
  teams: (periodId: string) =>
    api<{ items: TeamConfirmationTeam[] }>(`/api/attendance/team-confirmations/teams${query({ periodId })}`),
  review: (input: TeamConfirmationReviewInput) =>
    api<TeamConfirmationReview>(`/api/attendance/team-confirmations/review${query({ periodId: input.periodId, teamOrgUnitId: input.teamOrgUnitId })}`),
  coverage: (input: SourceCoverageInput) =>
    api<SourceCoverageResult>("/api/attendance/team-confirmations/coverage", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  confirm: (input: TeamConfirmationInput) =>
    api<TeamConfirmationResult>("/api/attendance/team-confirmations", {
      method: "POST",
      body: JSON.stringify(input),
    }),
};
