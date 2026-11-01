import { api } from "./client";

const post = <T>(path: string, body: unknown) => api<T>(path, { method: "POST", body: JSON.stringify(body) });
export type AlertKind = "EXPIRING" | "OVERDUE" | "PROBATION_ENDING" | "FIXED_TERM_LIMIT";
export interface ContractAlert {
  kind: AlertKind; employee: { id: string; code: string; fullName: string; unitCode: string | null };
  contract: { id: string; number: string; type: string; startDate: string; endDate: string | null }; daysLeft: number | null; message: string;
}
export type TerminationReason = "RESIGNATION" | "JOB_LOSS" | "CONTRACT_EXPIRY" | "MUTUAL_AGREEMENT" | "OTHER";
export interface TerminationPreview {
  employee: { id: string; code: string; fullName: string; hireDate: string }; effectiveDate: string; reason: TerminationReason; allowanceKind: "SEVERANCE" | "JOB_LOSS" | "NONE";
  contract: { id: string; number: string; type: string; startDate: string; endDate: string | null };
  salary: { months: Array<{ month: string; amount: string }>; average: string; final: string };
  service: { workedMonths: number; unemploymentMonthsSystem: number; unemploymentMonthsExternal: number; externalEvidence: string | null; previouslyPaidMonths: number };
  allowance: { kind: string; monthsPerYear: string; averageSalary: string; countedMonths: number; years: string; computed: string; minimum: string | null; minimumApplied: boolean; amount: string } | null;
  unusedLeave: { year: number; days: string; dailyRate: string; amount: string; standardWorkdays: string };
  insuranceDecrease: { type: string; reason: string; effectiveDate: string; base: string | null } | null;
  payrollPeriod: { id: string; code: string; dateFrom: string; dateTo: string } | null;
}
export interface TerminationDecision {
  id: string; employeeId: string; decisionNumber: string; effectiveDate: string; reason: TerminationReason; allowanceKind: string; legalBasis: string; note: string | null;
  externalUnemploymentMonths: number; externalUnemploymentEvidence: string | null; status: "DRAFT" | "CONFIRMED" | "CANCELLED"; revision: number; previewHash: string;
  preview: TerminationPreview; createdBy: string; createdAt: string; confirmedBy: string | null; confirmedAt: string | null; cancelReason: string | null;
  employee?: { id: string; code: string; fullName: string };
}
export const terminationApi = {
  alerts: (days?: 30 | 60) => api<{ asOf: string; days: number; fixedTermMaxCount: number; items: ContractAlert[] }>("/api/personnel/contract-alerts" + (days ? "?days=" + days : "")),
  list: () => api<{ items: TerminationDecision[] }>("/api/personnel/terminations"),
  create: (body: Record<string, unknown>) => post<{ decision: TerminationDecision }>("/api/personnel/terminations", body),
  refresh: (decision: TerminationDecision) => post<{ decision: TerminationDecision }>(`/api/personnel/terminations/${decision.id}/refresh`, { revision: decision.revision }),
  confirm: (decision: TerminationDecision, reauthToken: string) => post<{ decision: TerminationDecision; items: Array<{ kind: string; label: string; amount: string }> }>(`/api/personnel/terminations/${decision.id}/confirm`, { revision: decision.revision, previewHash: decision.previewHash, reauthToken }),
  cancel: (decision: TerminationDecision, reason: string) => post<{ decision: TerminationDecision }>(`/api/personnel/terminations/${decision.id}/cancel`, { revision: decision.revision, reason }),
};
