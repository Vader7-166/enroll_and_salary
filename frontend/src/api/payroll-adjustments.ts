import { api } from "./client";

export type BonusType = "MONTHLY" | "QUARTERLY" | "ANNUAL" | "KPI" | "HOLIDAY" | "SENIORITY" | "AD_HOC";
export interface BonusPlan {
  id: string; code: string; bonusType: BonusType; name: string; decisionReference: string; independentDecisionRef: string | null; kpiSourceReference: string | null; earnFrom: string; earnTo: string;
  payPeriod: { id: string; code: string; status: string; expectedPaymentDate: string | null }; componentCode: string | null; calculationMode: "AMOUNT" | "FORMULA"; amount: string | null; formula: string | null; variables: Array<{ name: string; defaultValue?: string | null }>;
  status: "DRAFT" | "CONFIRMED" | "CANCELLED"; revision: number; reason: string; cancelReason: string | null; createdBy: string; createdAt: string; confirmedBy: string | null; confirmedAt: string | null;
  employees?: number; conflicts?: number; total?: string;
}
export interface BonusAllocation { id: string; employee: { id: string; code: string; fullName: string }; amount: string; inputs: Record<string, string>; conflictCode: string | null; conflictDetail: string | null }
export interface RetroCandidateRow { id: string; status: "PENDING" | "RESOLVED" | "DISMISSED"; note: string | null; employee: { id: string; code: string; fullName: string }; decision: { id: string; decisionNumber: string; effectiveFrom: string }; payrollPeriod: { id: string; code: string; dateFrom: string; dateTo: string }; calculation: { id: string; status: string } | null }
type Totals = Record<"gross" | "insuranceEmployee" | "unionFee" | "insuranceEmployer" | "tax" | "deductions" | "adjustments" | "net", string>;
export interface RetroPeriod { candidateId: string; periodId: string; code: string; dateFrom: string; dateTo: string; taxPeriod: string | null; snapshotHash: string; before: Totals; after: Totals; diff: Totals; lines: Array<{ key: string; lineType: string; label: string; before: string; after: string; diff: string }>; adjustment: { kind: "RETRO_PAY" | "RETRO_DEDUCT"; amount: string; taxableIncome: string; insuranceEmployee: string } }
export interface RetroCalculation {
  id: string; status: "CALCULATED" | "CONFIRMED" | "DISCARDED"; resultHash: string; createdBy: string; createdAt: string; decidedBy: string | null; decidedAt: string | null;
  decision: { id: string; decisionNumber: string; effectiveFrom: string }; employee: { id: string; code: string; fullName: string }; target: { id: string; code: string; dateFrom: string; dateTo: string; expectedPaymentDate: string | null };
  periods: RetroPeriod[]; total: { gross: string; insuranceEmployee: string; taxReference: string; adjustment: string };
}
export interface PayrollAdjustmentRow { id: string; kind: string; status: string; label: string; employee: { code: string; fullName: string }; amount: string; explanation: string; originPeriod: string; targetPeriod: string | null; appliedPeriod: string | null; createdAt: string }

const post = <T,>(path: string, body: unknown) => api<T>(path, { method: "POST", body: JSON.stringify(body) });
type PlanDetail = { plan: BonusPlan; allocations: BonusAllocation[] };
export const payrollAdjustmentsApi = {
  bonuses: () => api<{ items: BonusPlan[] }>("/api/payroll/bonuses"),
  bonus: (id: string) => api<PlanDetail>("/api/payroll/bonuses/" + id),
  createBonus: (input: Record<string, unknown>) => post<PlanDetail>("/api/payroll/bonuses", input),
  allocate: (id: string, input: { items?: Array<{ employeeId: string; inputs?: Record<string, string> }>; orgUnitId?: string; inputs?: Record<string, string> }) => post<PlanDetail>("/api/payroll/bonuses/" + id + "/allocations", input),
  removeAllocation: (id: string, allocationId: string) => api<PlanDetail>("/api/payroll/bonuses/" + id + "/allocations/" + allocationId, { method: "DELETE" }),
  confirmBonus: (id: string, revision: number) => post<PlanDetail>("/api/payroll/bonuses/" + id + "/confirm", { revision }),
  cancelBonus: (id: string, revision: number, reason: string) => post<PlanDetail>("/api/payroll/bonuses/" + id + "/cancel", { revision, reason }),
  candidates: (status?: string) => api<{ items: RetroCandidateRow[] }>("/api/payroll/retro-candidates" + (status ? "?status=" + status : "")),
  calculate: (candidateId: string) => post<{ calculation: RetroCalculation }>("/api/payroll/retro-candidates/" + candidateId + "/calculate", {}),
  calculation: (id: string) => api<{ calculation: RetroCalculation }>("/api/payroll/retro-calculations/" + id),
  confirmRetro: (id: string, reauthToken: string, resultHash: string) => post<{ calculation: RetroCalculation }>("/api/payroll/retro-calculations/" + id + "/confirm", { reauthToken, resultHash }),
  discardRetro: (id: string) => post<{ calculation: RetroCalculation }>("/api/payroll/retro-calculations/" + id + "/discard", {}),
  adjustments: (status?: string) => api<{ items: PayrollAdjustmentRow[] }>("/api/payroll/adjustments" + (status ? "?status=" + status : "")),
};
