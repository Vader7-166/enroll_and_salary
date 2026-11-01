import { api, ApiError } from "./client";

export type InsuranceType = "BHXH" | "BHYT" | "BHTN" | "KPCD";
export interface InsuranceRate {
  id: string; insuranceType: InsuranceType; regionCode: string | null; employeeRate: string; employerRate: string;
  floorRegionalMinimum: boolean; capReference: "BASE_SALARY" | "REGIONAL_MINIMUM" | "NONE"; capMultiplier: string | null;
  legalBasis: string; status: "SIMULATION" | "BUSINESS_CONFIRMED"; effectiveFrom: string; effectiveTo: string | null;
}
export interface InsurancePreview {
  employee: { id: string; code: string; fullName: string };
  eligibility: { eligible: Record<"BHXH" | "BHYT" | "BHTN", boolean>; reasonCode: string; reasons: string[] };
  unpaidLeaveDays: string; missing: string[]; cp07: { code: string; message: string } | null;
  salary: { raw: string; floor: string; perKind: Record<string, { beforeClamp: string; floorApplied: boolean; cap: string | null; capApplied: boolean; value: string }>; included: Array<{ code: string; amount: string }>; excluded: Array<{ code: string; amount: string }> } | null;
  contribution: { lines: Array<{ kind: string; base: string; employeeRate: string; employerRate: string; employee: string; employer: string }>; employeeTotal: string; employerTotal: string } | null;
}
export const socialInsuranceApi = {
  rates: () => api<{ items: InsuranceRate[] }>("/api/social-insurance/rates"),
  addRate: (body: Record<string, unknown>) => api<{ rate: InsuranceRate }>("/api/social-insurance/rates", { method: "POST", body: JSON.stringify(body) }),
  preview: (employeeId: string, month: string) => api<InsurancePreview>("/api/social-insurance/preview", { method: "POST", body: JSON.stringify({ employeeId, month }) }),
};

type Kinds<T> = Record<"BHXH" | "BHYT" | "BHTN", T>;
export interface InsuranceChangeItem {
  id: string; employee: { id: string; code: string; fullName: string }; changeType: "INCREASE" | "DECREASE" | "ADJUST"; reasonCode: string; reason: string;
  effectiveDate: string; late: boolean; originMonth: string | null;
  old: { eligible: Kinds<boolean>; base: Kinds<string> | null }; new: { eligible: Kinds<boolean>; base: Kinds<string> | null };
  arrears: Array<{ originMonth: string; direction: "ARREARS" | "REFUND"; total: string; perKind: Kinds<{ employee: string; employer: string }> }>; arrearsTotal: string; arrearsMonths: number;
}
export interface InsuranceChangeList {
  id: string; siteOrgUnitId: string; siteCode: string; month: string; status: "DRAFT" | "FINALIZED"; revision: number; contentHash: string | null; itemCount: number;
  generatedAt: string | null; generatedBy: string | null; finalizedAt: string | null; finalizedBy: string | null;
}
export interface C12Import { id: string; month: string; fileName: string; rowCount: number; summary: Record<string, number>; importedAt: string; importedBy: string }
export interface C12Difference { id: string; category: "MISSING_IN_C12" | "MISSING_IN_SYSTEM" | "AMOUNT_DIFF" | "SALARY_BASE_DIFF"; employeeId: string | null; rowNumber: number | null; [key: string]: unknown }

async function downloadFile(path: string): Promise<Blob> {
  const response = await fetch(path, { credentials: "same-origin", cache: "no-store" });
  if (!response.ok) {
    let body: { code?: string; message?: string } | undefined;
    try { body = await response.json() as { code?: string; message?: string }; } catch { /* no JSON body */ }
    throw new ApiError(response.status, body?.code ?? "DOWNLOAD_FAILED", body?.message ?? "Không tải được tệp.");
  }
  return response.blob();
}

export const insuranceChangesApi = {
  find: (siteOrgUnitId: string, month: string) => api<{ list: InsuranceChangeList | null; items?: InsuranceChangeItem[] }>(`/api/social-insurance/change-lists?siteOrgUnitId=${encodeURIComponent(siteOrgUnitId)}&month=${month}`),
  generate: (siteOrgUnitId: string, month: string) => api<{ list: InsuranceChangeList; items: InsuranceChangeItem[] }>("/api/social-insurance/change-lists/generate", { method: "POST", body: JSON.stringify({ siteOrgUnitId, month }) }),
  finalize: (list: InsuranceChangeList) => api<{ list: InsuranceChangeList; items: InsuranceChangeItem[] }>(`/api/social-insurance/change-lists/${list.id}/finalize`, { method: "POST", body: JSON.stringify({ revision: list.revision, contentHash: list.contentHash }) }),
  export: (id: string) => downloadFile(`/api/social-insurance/change-lists/${id}/export`),
  imports: (siteOrgUnitId: string, month: string) => api<{ items: C12Import[] }>(`/api/social-insurance/c12-imports?siteOrgUnitId=${encodeURIComponent(siteOrgUnitId)}&month=${month}`),
  importDetail: (id: string) => api<{ import: C12Import; differences: C12Difference[] }>(`/api/social-insurance/c12-imports/${id}`),
  importC12: (siteOrgUnitId: string, month: string, file: File) => {
    const form = new FormData(); form.set("siteOrgUnitId", siteOrgUnitId); form.set("month", month); form.set("file", file);
    return api<{ import: C12Import; differences: C12Difference[] }>("/api/social-insurance/c12-imports", { method: "POST", body: form });
  },
};
