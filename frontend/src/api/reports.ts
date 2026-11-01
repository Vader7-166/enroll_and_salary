import { api } from "./client";

export type ReportParamName = "periodId" | "payrollPeriodId" | "month" | "year" | "dateRange" | "orgUnitId";
export interface ReportParams { periodId?: string; payrollPeriodId?: string; month?: string; year?: string; dateFrom?: string; dateTo?: string; orgUnitId?: string }
export interface ReportCatalogItem { type: string; title: string; group: string; params: ReportParamName[]; sensitive: boolean }
export interface ReportColumn { key: string; title: string; type?: "text" | "number" | "money" | "date"; sensitive?: string }
export interface ReportPreview { type: string; title: string; status: "DRAFT" | "OFFICIAL"; statusLabel: string; source: string; sourceHash: string | null; periodLabel: string; columns: ReportColumn[]; rows: Array<Record<string, string | number | boolean | null>>; total: number; truncated: boolean; rowWarning: boolean; notes: string[] }
export interface ReportRun { id: string; type: string; title: string; format: "XLSX" | "PDF"; status: "RUNNING" | "COMPLETED" | "FAILED"; statusLabel: string | null; rowCount: number | null; rowWarning: boolean; fileName: string | null; failure: string | null; durationMs: number | null; requestedAt: string }

const query = (params: ReportParams) => new URLSearchParams(Object.entries(params).filter(([, value]) => Boolean(value)) as Array<[string, string]>).toString();
export const reportsApi = {
  catalog: () => api<{ items: ReportCatalogItem[] }>("/api/reports"),
  preview: (type: string, params: ReportParams) => api<ReportPreview>("/api/reports/" + type + "/preview?" + query(params)),
  export: (type: string, params: ReportParams, format: "XLSX" | "PDF") => api<{ run: ReportRun }>("/api/reports/" + type + "/export", { method: "POST", body: JSON.stringify({ params, format }) }),
  runs: () => api<{ items: ReportRun[] }>("/api/reports/runs"),
  downloadUrl: (id: string) => "/api/reports/runs/" + id + "/download",
};
