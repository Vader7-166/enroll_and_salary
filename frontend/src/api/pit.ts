import { api, ApiError } from "./client";

export interface TaxRuleset {
  id: string; code: string; subject: "RESIDENT_PROGRESSIVE" | "RESIDENT_FLAT_10" | "NON_RESIDENT"; exemptionMode: "PREMIUM_ONLY" | "ELIGIBLE_PAYMENT";
  effectiveFrom: string; effectiveTo: string | null; settings: Record<string, string | boolean | null>; legalBasis: string; status: string;
  brackets: Array<{ basis: "MONTH" | "YEAR"; bracketNo: number; lower: string; upper: string | null; rate: string }>;
}
export interface PitResult {
  branch: string; tax: string; rawTax: string; taxableIncome: string; assessableIncome: string; dependents: number; notes: string[];
  deductions: Record<string, string>; context: { taxPeriod: string; ruleset: { code: string }; paymentDateStatus: string };
  exemptions: { exempt: string; taxable: string; exceptions: Array<{ code: string; sourceRef: string; message: string }>; lines: Array<{ sourceRef: string; kind: string; amountPaid: string; exempt: string; taxable: string; rule: string }> };
  brackets: Array<{ bracketNo: number; rate: string; portion: string; tax: string }>;
}
const post = <T,>(path: string, body: unknown) => api<T>(path, { method: "POST", body: JSON.stringify(body) });
export const pitApi = {
  rulesets: () => api<{ items: TaxRuleset[] }>("/api/pit/rulesets"),
  preview: (body: Record<string, unknown>) => post<PitResult>("/api/pit/preview", body),
  grossUp: (body: Record<string, unknown>) => post<{ gross: string; net: string; iterations: number; difference: string; ruleset: string }>("/api/pit/gross-up-preview", body),
};

export interface FinalizationIssue { code: string; blocking: boolean; message: string; withholdingIds?: string[] }
export interface TaxFinalization {
  id: string; taxYear: number; employee: { id: string; code: string; fullName: string }; version: number; status: "DRAFT" | "DONE"; ruleset: string; direction: "PAYABLE" | "REFUND" | "NONE";
  issues: FinalizationIssue[]; sourceHash: string; createdAt: string; completedAt: string | null;
  summary: { payments: number; totalIncome: string; exempt: string; taxableIncome: string; selfMonths: number; dependentMonths: number; deductions: Record<string, string>; totalDeductions: string; assessableIncome: string; annualTax: string; withheld: string; difference: string; brackets: Array<{ bracketNo: number; portion: string; rate: string; tax: string }> };
}
export interface FinalizationRun { year: number; created: number; unchanged: number; ineligible: Array<{ employee: { id: string; code: string; fullName: string }; reason: string; label: string }>; items: TaxFinalization[] }
export const finalizationApi = {
  list: (year: number) => api<{ items: TaxFinalization[] }>("/api/pit/finalizations?year=" + year),
  run: (year: number) => api<FinalizationRun>("/api/pit/finalizations/run", { method: "POST", body: JSON.stringify({ year }) }),
  complete: (row: TaxFinalization) => api<{ finalization: TaxFinalization }>("/api/pit/finalizations/" + row.id + "/complete", { method: "POST", body: JSON.stringify({ sourceHash: row.sourceHash }) }),
  export: async (year: number) => {
    const response = await fetch("/api/pit/finalizations/export?year=" + year, { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) { const body = await response.json().catch(() => undefined) as { code?: string; message?: string } | undefined; throw new ApiError(response.status, body?.code ?? "DOWNLOAD_FAILED", body?.message ?? "Không xuất được tệp."); }
    return response.blob();
  },
};
