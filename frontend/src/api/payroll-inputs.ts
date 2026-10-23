import { ApiError, api } from "./client";

export type PayrollPeriodStatus = "OPEN" | "LOCKED";
export type PayrollInputProvenance = "SIMULATION" | "BUSINESS_CONFIRMED";
export type PayrollInputStatus = "DRAFT" | "VALIDATED" | "CONFIRMED" | "RETURNED" | "SUPERSEDED";
export type PayrollInputType = "TIME" | "PRODUCT" | "PIECEWORK" | "COMMISSION" | "THREE_P" | "ALLOWANCE" | "BONUS" | "DEDUCTION" | "EMPLOYER_COST" | "ADJUSTMENT";
export type PayrollValueState = "PRESENT" | "MISSING" | "CONFIRMED_ZERO" | "NOT_APPLICABLE";
export type PayrollCalculationMode = "FORMULA" | "AMOUNT";

export interface PayrollInputUnit { id: string; code: string; name: string; type: string; parentId: string | null }
export interface PayrollPeriod {
  id: string;
  code: string;
  siteOrgUnitId: string;
  siteCode: string;
  siteName: string;
  dateFrom: string;
  dateTo: string;
  expectedPaymentDate: string | null;
  status: PayrollPeriodStatus;
}
export interface PayrollInputContext {
  asOf: string;
  units: PayrollInputUnit[];
  managementUnits: PayrollInputUnit[];
  inputTypes: PayrollInputType[];
}
export interface PayrollInputVariable { code: string; unit: string; value: string }
export interface PayrollInputLine {
  sourceLineId: string;
  employeeId: string;
  componentId: string;
  inputType: PayrollInputType;
  workFrom: string;
  workTo: string;
  valueState: PayrollValueState;
  calculationMode: PayrollCalculationMode;
  formulaCode?: string;
  inputs?: PayrollInputVariable[];
  amount?: string;
  unit?: string;
  amountBasis?: string;
  businessReference?: string;
  adjustmentOfLineId?: string;
  teamAllocationKey?: string;
  allocatedAmount?: string;
  supersedesLineId?: string;
}
export interface PayrollTeamAllocation {
  key: string;
  teamOrgUnitId: string;
  acceptedAmount: string;
  reference: string;
}
export interface PayrollBatchInput {
  payrollPeriodId: string;
  sourceSystem: string;
  sourceDocumentNo: string;
  sourceVersion: string;
  mappingVersion: string;
  provenance: PayrollInputProvenance;
  preparedBy: string;
  sourceApprovedBy?: string;
  sourceApprovedAt?: string;
  sourceApprovalReference?: string;
  reason: string;
  supersedesBatchId?: string;
  attendancePeriodIds?: string[];
  lines: PayrollInputLine[];
  teamAllocations?: PayrollTeamAllocation[];
}
export interface PayrollBatchSummary {
  id: string;
  code: string;
  revision: number;
  status: PayrollInputStatus;
  payrollPeriod: PayrollPeriod;
  sourceSystem: string;
  sourceDocumentNo: string;
  sourceVersion: string;
  provenance: PayrollInputProvenance;
  preparedBy: string;
  createdAt: string;
  createdBy: { id: string; displayName: string };
  lineCount: number;
  issueCount: number;
  canManage: boolean;
  supersedesBatchId: string | null;
}
export interface PayrollBatchLine extends PayrollInputLine {
  id: string;
  employeeCode: string;
  employeeName: string;
  componentCode: string;
  componentName: string;
  bindingSnapshot?: object;
}
export interface PayrollBatch extends PayrollBatchSummary {
  mappingVersion: string;
  sourceApprovedBy: string | null;
  sourceApprovedAt: string | null;
  sourceApprovalReference: string | null;
  reason: string;
  contentHash: string;
  fileName: string | null;
  fileHash: string | null;
  attendancePeriodIds: string[];
  lines: PayrollBatchLine[];
  teamAllocations: PayrollTeamAllocation[];
  validation: { issues: PayrollInputIssue[]; hash?: string };
  history: PayrollInputHistory[];
  evidence: PayrollEvidence[];
}
export interface PayrollInputIssue { code: string; message: string; sourceLineId?: string; employeeId?: string }
export interface PayrollInputHistory { id: string; action: string; fromStatus: string | null; toStatus: string; reason: string; createdAt: string; actor: { id: string; displayName: string }; revision: number }
export interface PayrollEvidence { id: string; fileName: string; contentType: string; size: number; sha256: string }
export interface PayrollBatchFilter { payrollPeriodId?: string; search?: string; status?: PayrollInputStatus; page?: number; pageSize?: number }

function query(filter: object): string {
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(filter)) if (value !== undefined && value !== "") parameters.set(key, String(value));
  return parameters.size ? `?${parameters.toString()}` : "";
}

async function download(path: string): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: "same-origin", cache: "no-store" });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "Không thể kết nối máy chủ. Vui lòng kiểm tra lại kết nối.");
  }
  if (!response.ok) {
    let body: { code?: string; message?: string } | undefined;
    try { body = await response.json() as { code?: string; message?: string }; } catch { /* response has no JSON error body */ }
    throw new ApiError(response.status, body?.code ?? "DOWNLOAD_FAILED", body?.message ?? "Không tải được tệp.");
  }
  return response.blob();
}

export const payrollInputsApi = {
  context: () => api<PayrollInputContext>("/api/payroll-inputs/context"),
  periods: () => api<{ items: PayrollPeriod[] }>("/api/payroll-inputs/periods"),
  createPeriod: (input: { code: string; siteOrgUnitId: string; dateFrom: string; dateTo: string; expectedPaymentDate?: string }) => api<{ period: PayrollPeriod }>("/api/payroll-inputs/periods", { method: "POST", body: JSON.stringify(input) }),
  list: (filter: PayrollBatchFilter) => api<{ items: PayrollBatchSummary[]; total: number; page: number; pageSize: number }>("/api/payroll-inputs" + query(filter)),
  detail: (id: string) => api<{ item: PayrollBatch }>(`/api/payroll-inputs/${encodeURIComponent(id)}`),
  create: (input: PayrollBatchInput) => api<{ item: PayrollBatch; duplicate: boolean }>("/api/payroll-inputs", { method: "POST", body: JSON.stringify(input) }),
  validate: (id: string, revision: number, reason: string) => api<{ item: PayrollBatch }>(`/api/payroll-inputs/${encodeURIComponent(id)}/validate`, { method: "POST", body: JSON.stringify({ revision, reason }) }),
  confirm: (id: string, revision: number, reason: string) => api<{ item: PayrollBatch }>(`/api/payroll-inputs/${encodeURIComponent(id)}/confirm`, { method: "POST", body: JSON.stringify({ revision, reason }) }),
  returnBatch: (id: string, revision: number, reason: string) => api<{ item: PayrollBatch }>(`/api/payroll-inputs/${encodeURIComponent(id)}/return`, { method: "POST", body: JSON.stringify({ revision, reason }) }),
  uploadEvidence: (id: string, file: File) => {
    const body = new FormData();
    body.set("file", file);
    return api<{ item: PayrollBatch }>(`/api/payroll-inputs/${encodeURIComponent(id)}/evidence`, { method: "POST", body });
  },
  evidenceDownload: (id: string, evidenceId: string) => download(`/api/payroll-inputs/${encodeURIComponent(id)}/evidence/${encodeURIComponent(evidenceId)}`),
  template: () => download("/api/payroll-inputs/template"),
  importCsv: (file: File, metadata: Omit<PayrollBatchInput, "lines">) => {
    const body = new FormData();
    body.set("file", file);
    body.set("metadata", JSON.stringify(metadata));
    return api<{ item: PayrollBatch; duplicate: boolean }>("/api/payroll-inputs/import", { method: "POST", body });
  },
  confirmed: (payrollPeriodId: string) => api<{ items: Array<PayrollBatchLine & { batchId: string; sourceKey: { sourceSystem: string; sourceDocumentNo: string; sourceVersion: string }; contentHash: string; provenance: PayrollInputProvenance }> }>("/api/payroll-inputs/confirmed" + query({ payrollPeriodId })),
};
