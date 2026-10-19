import { api } from "./client";

export type CorrectionStatus = "DRAFT" | "PENDING" | "RETURNED" | "REJECTED" | "APPROVED";
export type CorrectionKind = "CORRECTION" | "EXPLANATION";

export interface CorrectionSnapshot {
  daily: Record<string, unknown> | null;
  actual: Record<string, unknown> | null;
}

export interface CorrectionInterval {
  startAt: string;
  endAt: string;
}

export interface CorrectionItem {
  id: string;
  employee: { id: string; code: string; fullName: string };
  orgUnitId: string;
  orgUnitCode: string;
  workDate: string;
  intervals: CorrectionInterval[] | null;
  excuseLateEarly: boolean;
  before: CorrectionSnapshot | null;
  after: CorrectionSnapshot | null;
}

export interface CorrectionEvidence {
  id: string;
  fileName: string;
  contentType: string;
  size: number;
  sha256: string;
  createdAt: string;
  uploadedBy: { id: string; displayName: string };
}

export interface CorrectionHistory {
  id: string;
  action: string;
  actor: { id: string; displayName: string };
  occurredAt: string;
  reason: string | null;
  oldValue: unknown;
  newValue: unknown;
}

export interface Correction {
  id: string;
  revision: number;
  status: CorrectionStatus;
  kind: CorrectionKind;
  periodId: string;
  reason: string;
  evidenceReference: string | null;
  incidentReference: string | null;
  createdBy: { id: string; displayName: string };
  createdAt: string;
  submittedAt: string | null;
  decidedBy: { id: string; displayName: string } | null;
  decidedAt: string | null;
  decisionReason: string | null;
  items: CorrectionItem[];
  evidence: CorrectionEvidence[];
  history: CorrectionHistory[];
  warnings: string[];
}

export interface CorrectionTarget {
  employee: { id: string; code: string; fullName: string };
  orgUnitId: string;
  orgUnitCode: string;
  workDate: string;
  daily: Record<string, unknown> | null;
  actual: Record<string, unknown> | null;
}

export interface CorrectionInputItem {
  employeeId: string;
  orgUnitId: string;
  workDate: string;
  intervals: CorrectionInterval[] | null;
  excuseLateEarly: boolean;
}

export interface CorrectionInput {
  periodId: string;
  kind: CorrectionKind;
  reason: string;
  evidenceReference?: string;
  incidentReference?: string;
  items: CorrectionInputItem[];
}

export interface CorrectionFilters {
  periodId: string;
  orgUnitId?: string;
  search?: string;
  status?: CorrectionStatus;
  page: number;
  pageSize: number;
}

function query(values: object): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if ((typeof value === "string" || typeof value === "number") && value !== "") params.set(key, String(value));
  }
  const result = params.toString();
  return result ? `?${result}` : "";
}

export const correctionsApi = {
  list: (filters: CorrectionFilters) =>
    api<{ items: Correction[]; total: number; page: number; pageSize: number }>(
      `/api/attendance/corrections${query(filters)}`,
    ),
  targets: (filters: {
    periodId: string;
    workDate: string;
    orgUnitId?: string;
    search?: string;
    page: number;
    pageSize: number;
  }) =>
    api<{ items: CorrectionTarget[]; total: number; page: number; pageSize: number }>(
      `/api/attendance/corrections/targets${query(filters)}`,
    ),
  create: (payload: CorrectionInput) =>
    api<{ correction: Correction }>("/api/attendance/corrections", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  update: (id: string, payload: CorrectionInput & { revision: number }) =>
    api<{ correction: Correction }>(`/api/attendance/corrections/${encodeURIComponent(id)}/update`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  submit: (id: string, revision: number) =>
    api<{ correction: Correction }>(`/api/attendance/corrections/${encodeURIComponent(id)}/submit`, {
      method: "POST",
      body: JSON.stringify({ revision }),
    }),
  review: (id: string, action: "approve" | "return" | "reject", revision: number, reason?: string) =>
    api<{ correction: Correction }>(`/api/attendance/corrections/${encodeURIComponent(id)}/${action}`, {
      method: "POST",
      body: JSON.stringify({ revision, ...(reason ? { reason } : {}) }),
    }),
  uploadEvidence: (id: string, file: File) => {
    const body = new FormData();
    body.set("file", file);
    return api<{ correction: Correction }>(`/api/attendance/corrections/${encodeURIComponent(id)}/evidence`, {
      method: "POST",
      body,
    });
  },
  evidenceHref: (correctionId: string, evidenceId: string) =>
    `/api/attendance/corrections/${encodeURIComponent(correctionId)}/evidence/${encodeURIComponent(evidenceId)}`,
};
