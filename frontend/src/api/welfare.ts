import { api, ApiError } from "./client";

const post = <T>(path: string, body: unknown) => api<T>(path, { method: "POST", body: JSON.stringify(body) });
export type BenefitTaxTreatment = "TAXABLE" | "NON_TAXABLE" | "EXEMPT_UP_TO_LIMIT";
export interface BenefitVersion { id: string; name: string; amount: string; taxTreatment: BenefitTaxTreatment; exemptLimit: string | null; payrollIncluded: boolean; eligibility: Record<string, unknown>; decisionReference: string; status: string; active: boolean; effectiveFrom: string; effectiveTo: string | null }
export interface BenefitCatalogItem { id: string; code: string; category: string; categoryLabel: string; orgUnitId: string; orgUnitCode: string; current: BenefitVersion | null; versions: BenefitVersion[] }
export interface BenefitBatchSummary { id: string; code: string; catalogCode: string; name: string; category: string; periodCode: string; referenceDate: string; scopeCode: string; status: "DRAFT" | "CONFIRMED" | "CANCELLED"; revision: number; candidates: number; allocations: number; createdAt: string }
export interface BenefitBatchDetail {
  batch: { id: string; code: string; catalogCode: string; version: BenefitVersion; periodCode: string; referenceDate: string; payrollPeriodCode: string | null; status: BenefitBatchSummary["status"]; revision: number; note: string | null; result: { recorded: number; duplicates: Array<{ employeeId: string; code: string; fullName: string; existingBatch: string }> } | null; cancelReason: string | null };
  candidates: Array<{ employee: { id: string; code: string; fullName: string }; eligible: boolean; failedRules: Array<{ rule: string; expected: unknown; actual: unknown }>; manual: boolean; manualReason: string | null }>;
  allocations: Array<{ id: string; employee: { id: string; code: string; fullName: string }; amount: string; taxTreatment: BenefitTaxTreatment; payrollPeriodId: string | null; costCenterCode: string | null }>;
}
export interface WelfareCostRow { month: string; costCenterCode: string | null; category: string; categoryLabel: string; count: number; amount: string }

export const welfareApi = {
  catalog: (asOf?: string) => api<{ asOf: string; items: BenefitCatalogItem[] }>("/api/welfare/catalog" + (asOf ? "?asOf=" + asOf : "")),
  createCatalog: (body: Record<string, unknown>) => post<{ id: string }>("/api/welfare/catalog", body),
  addVersion: (id: string, body: Record<string, unknown>) => post<{ version: BenefitVersion }>(`/api/welfare/catalog/${id}/versions`, body),
  batches: () => api<{ items: BenefitBatchSummary[] }>("/api/welfare/allocations"),
  createBatch: (body: Record<string, unknown>) => post<BenefitBatchDetail>("/api/welfare/allocations", body),
  batch: (id: string) => api<BenefitBatchDetail>(`/api/welfare/allocations/${id}`),
  addCandidate: (id: string, revision: number, employeeId: string, reason?: string) => post<BenefitBatchDetail>(`/api/welfare/allocations/${id}/candidates`, { revision, employeeId, reason }),
  removeCandidate: (id: string, revision: number, employeeId: string) => post<BenefitBatchDetail>(`/api/welfare/allocations/${id}/candidates/remove`, { revision, employeeId }),
  confirm: (id: string, revision: number) => post<BenefitBatchDetail & { confirmation: { recorded: number; duplicates: Array<{ code: string; fullName: string; existingBatch: string }> } }>(`/api/welfare/allocations/${id}/confirm`, { revision }),
  cancel: (id: string, revision: number, reason: string) => post<BenefitBatchDetail>(`/api/welfare/allocations/${id}/cancel`, { revision, reason }),
  costs: (from: string, to: string) => api<{ items: WelfareCostRow[]; total: string }>(`/api/welfare/costs?from=${from}&to=${to}`),
  exportCosts: async (from: string, to: string) => {
    const response = await fetch(`/api/welfare/costs/export?from=${from}&to=${to}`, { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) { const body = await response.json().catch(() => undefined) as { code?: string; message?: string } | undefined; throw new ApiError(response.status, body?.code ?? "DOWNLOAD_FAILED", body?.message ?? "Không xuất được tệp."); }
    return response.blob();
  },
};
