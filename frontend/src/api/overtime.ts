import { api } from "./client";

export type OvertimeStatus = "DRAFT" | "PENDING" | "APPROVED" | "RETURNED" | "REJECTED" | "CANCELLED";
export type OvertimeAction = "SUBMIT" | "APPROVE" | "RETURN" | "REJECT" | "CANCEL";

export interface OvertimeUnit {
  id: string;
  code: string;
  name: string;
  type: string;
}

export interface OvertimeMember {
  id: string;
  code: string;
  fullName: string;
}

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
  id: string;
  teamOrgUnitId: string;
  teamOrgUnitCode: string;
  title: string;
  workDate: string;
  startAt: string;
  endAt: string;
  requestedMinutes: number;
  reason: string;
  status: OvertimeStatus;
  revision: number;
  createdBy: { id: string; displayName: string };
  createdAt: string;
  updatedAt: string;
  members: Array<{
    employee: { id: string; code: string; fullName: string };
    consentReference: string;
  }>;
}

export interface OvertimeReview {
  approvable: boolean;
  blocking: string[];
  warnings: string[];
  employees: Array<{
    employeeId: string;
    code: string;
    dailyMinutes: number;
    dailyLimitMinutes: number;
    months: Array<{ month: string; minutes: number; limitMinutes: number }>;
    years: Array<{ year: string; minutes: number; limitMinutes: number }>;
  }>;
}

export interface OvertimeHistory {
  id: string;
  actor: { id: string; displayName: string };
  action: OvertimeAction | "CREATE" | "UPDATE";
  fromStatus: OvertimeStatus | null;
  toStatus: OvertimeStatus;
  revision: number;
  reason: string | null;
  occurredAt: string;
  snapshot: OvertimeSnapshot;
}

export interface OvertimeFilters {
  dateFrom: string;
  dateTo: string;
  teamOrgUnitId?: string;
  status?: OvertimeStatus;
}
function query(filters: object): string {
  const values = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (typeof value === "string" && value) values.set(key, value);
  });
  return values.toString();
}

export const overtimeApi = {
  context: () => api<{ units: OvertimeUnit[]; canPlan: boolean; canApprove: boolean }>("/api/overtime/context"),
  members: (teamOrgUnitId: string, workDate: string) =>
    api<{ items: OvertimeMember[] }>("/api/overtime/members?" + query({ teamOrgUnitId, workDate })),
  requests: (filters: OvertimeFilters) =>
    api<{ items: OvertimeSnapshot[] }>("/api/overtime/requests?" + query(filters)),
  request: (id: string) =>
    api<{ request: OvertimeSnapshot; history: OvertimeHistory[]; review: OvertimeReview }>("/api/overtime/requests/" + id),
  create: (payload: OvertimeInput) =>
    api<{ request: OvertimeSnapshot }>("/api/overtime/requests", { method: "POST", body: JSON.stringify(payload) }),
  update: (id: string, payload: OvertimeInput & { revision: number }) =>
    api<{ request: OvertimeSnapshot }>("/api/overtime/requests/" + id + "/update", { method: "POST", body: JSON.stringify(payload) }),
  action: (id: string, action: Lowercase<OvertimeAction>, revision: number, reason?: string) =>
    api<{ request: OvertimeSnapshot }>("/api/overtime/requests/" + id + "/" + action, {
      method: "POST",
      body: JSON.stringify({ revision, ...(reason ? { reason } : {}) }),
    }),
};
