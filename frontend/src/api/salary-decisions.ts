import { api } from "./client";

export interface SalarySegment { componentId: string | null; componentCode: string | null; componentName: string; from: string; to: string; amount: string; salaryBasis: "MONTHLY" | "HOURLY"; source: "CONTRACT" | "DECISION"; sourceId: string; reference: string }
export interface UnitSegment { orgUnitId: string; orgUnitCode: string; orgUnitName: string; wageRegionCode: string | null; costCenterCode: string | null; from: string; to: string; days: number }
export interface SalaryDecision {
  id: string; decisionNumber: string; decisionDate: string; effectiveFrom: string; reason: string; legalBasis: string;
  warnings: Array<{ code: string; fromRegion?: string; toRegion?: string; previousAmount?: string; newAmount?: string }>; warningAcknowledgement: string | null;
  createdBy: { id: string; displayName: string }; createdAt: string;
  lines: Array<{ componentId: string | null; componentCode: string | null; componentName: string; amount: string; salaryBasis: "MONTHLY" | "HOURLY"; effectiveFrom: string; effectiveTo: string | null }>;
  retroCandidates: Array<{ id: string; payrollPeriodCode: string; status: string }>;
}
export interface RetroCandidate {
  id: string; status: "PENDING" | "RESOLVED" | "DISMISSED"; note: string | null;
  employee: { id: string; code: string; fullName: string };
  decision: { id: string; decisionNumber: string; effectiveFrom: string };
  payrollPeriod: { id: string; code: string; dateFrom: string; dateTo: string };
  resolvedBy: { id: string; displayName: string } | null; resolvedAt: string | null; createdAt: string;
}
export interface SalaryDecisionInput {
  decisionNumber: string; decisionDate: string; effectiveFrom: string; reason: string; legalBasis: string;
  lines: Array<{ componentId?: string; amount: string; salaryBasis: "MONTHLY" | "HOURLY" }>; warningAcknowledgement?: string;
}

export const salaryDecisionApi = {
  list: (employeeId: string) => api<{ items: SalaryDecision[] }>("/api/employees/" + employeeId + "/salary-decisions"),
  create: (employeeId: string, body: SalaryDecisionInput) => api<{ decision: { id: string }; warnings: unknown[]; retroCandidates: Array<{ code: string }> }>("/api/employees/" + employeeId + "/salary-decisions", { method: "POST", body: JSON.stringify(body) }),
  timeline: (employeeId: string, from: string, to: string) => api<{ segments: SalarySegment[]; units: UnitSegment[] }>("/api/employees/" + employeeId + "/salary-timeline?" + new URLSearchParams({ from, to }).toString()),
  retroCandidates: (status?: string) => api<{ items: RetroCandidate[] }>("/api/salary-decisions/retro-candidates" + (status ? "?status=" + status : "")),
  dismiss: (id: string, note: string) => api<{ id: string }>("/api/salary-decisions/retro-candidates/" + id + "/dismiss", { method: "POST", body: JSON.stringify({ note }) }),
};
