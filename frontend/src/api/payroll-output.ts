import { api, ApiError } from "./client";

export interface PayslipSection { title: string; rows: Array<{ label: string; detail: string | null; amount: string }>; total: string | null }
export interface PayslipView { period: { code: string; dateFrom: string; dateTo: string; expectedPaymentDate: string | null }; siteName: string; companyName: string; employee: { code: string; fullName: string }; units: Array<{ orgUnit: string; from: string; to: string; workUnits: string }>; sections: PayslipSection[]; net: string; snapshotHash: string }
export interface PayslipExport { id: string; status: "RUNNING" | "COMPLETED" | "FAILED" | "DOWNLOADED" | "EXPIRED"; progressTotal: number; progressDone: number; errorCount: number; failure: string | null; archiveBytes: number | null; expiresAt: string | null; downloadedAt: string | null; createdAt: string; finishedAt: string | null; createdBy: { displayName: string } }
export interface PayslipList { sheet: { id: string; periodCode: string; snapshotHash: string }; passwordRule: { value: string; legalBasis: string } | null; items: Array<{ employeeId: string; code: string; fullName: string; net: string; issuedCount: number; lastIssuedAt: string | null; failedCount: number }>; exports: PayslipExport[] }
export type BankField = "SEQ" | "EMPLOYEE_CODE" | "BENEFICIARY_NAME" | "ACCOUNT_NUMBER" | "BANK_CODE" | "BANK_NAME" | "BRANCH" | "AMOUNT" | "DESCRIPTION" | "SITE_CODE" | "PERIOD_CODE";
export interface BankColumn { field: BankField; header: string; format?: "TEXT" | "UPPER_ASCII" | "INTEGER" | "DECIMAL2" }
export interface BankTemplate { id: string; bankCode: string; bankName: string; version: number; name: string; fileType: "CSV" | "XLSX"; columns: BankColumn[]; splitBySite: boolean; includeHeader: boolean; active: boolean; current: boolean; status: string; reason: string; createdBy: string; createdAt: string }
export interface PaymentBatch { id: string; code: string; status: "EXPORTED" | "PAID" | "CANCELLED"; revision: number; itemCount: number; total: string; contentHash: string; dueDate: string; paidDate: string | null; lateDays: number | null; note: string | null; cancelReason: string | null; periods: string[]; template: { id: string; bankCode: string; bankName: string; version: number; name: string; fileType: string; splitBySite: boolean }; createdBy: string; createdAt: string; paidBy: string | null; paidAt: string | null }
export interface PaymentItem { id: string; employee: { id: string; code: string; fullName: string }; periodCode: string; siteCode: string; amount: string; active: boolean; bank: string; accountMasked: string; accountHolder: string; compensation: { amount: string; appliedPeriodId: string | null } | null }
export interface PaidResult { lateDays: number; graceDays: number; compensations: Array<{ employee: { code: string; fullName: string }; periodCode: string; lateDays: number; amount: string }>; warnings: unknown[]; taxContextChanged: string[]; taxAlreadyFiled: string[]; lateWarning: string | null }

const post = <T,>(path: string, body: unknown) => api<T>(path, { method: "POST", body: JSON.stringify(body) });
async function download(path: string, headers: Record<string, string> = {}) {
  let response: Response;
  try { response = await fetch(path, { credentials: "same-origin", cache: "no-store", headers }); } catch { throw new ApiError(0, "NETWORK_ERROR", "Không thể kết nối máy chủ. Vui lòng kiểm tra lại kết nối."); }
  if (!response.ok) { const body = await response.json().catch(() => undefined) as { code?: string; message?: string } | undefined; throw new ApiError(response.status, body?.code ?? "DOWNLOAD_FAILED", body?.message ?? "Không tải được tệp."); }
  const name = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1] ?? "tep-tai-ve";
  return { blob: await response.blob(), name };
}
export function saveFile({ blob, name }: { blob: Blob; name: string }) { const href = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = href; anchor.download = name; anchor.click(); URL.revokeObjectURL(href); }

export const payrollOutputApi = {
  payslips: (sheetId: string) => api<PayslipList>("/api/payroll/sheets/" + sheetId + "/payslips"),
  payslip: (sheetId: string, employeeId: string) => api<{ payslip: PayslipView }>("/api/payroll/sheets/" + sheetId + "/payslips/" + employeeId),
  payslipPdf: (sheetId: string, employeeId: string) => download("/api/payroll/sheets/" + sheetId + "/payslips/" + employeeId + "/pdf"),
  startExport: (sheetId: string) => post<{ export: PayslipExport }>("/api/payroll/sheets/" + sheetId + "/payslips/exports", {}),
  exportStatus: (id: string) => api<{ export: PayslipExport; errors: Array<{ employee: { code: string; fullName: string }; code: string | null; message: string | null }> }>("/api/payroll/payslip-exports/" + id),
  downloadExport: (id: string) => download("/api/payroll/payslip-exports/" + id + "/download"),
  templates: () => api<{ banks: Array<{ code: string; name: string; shortName: string }>; items: BankTemplate[] }>("/api/payroll/bank-templates"),
  createTemplate: (input: { bankCode: string; name: string; fileType: "CSV" | "XLSX"; columns: BankColumn[]; splitBySite: boolean; includeHeader: boolean; active: boolean; status: "SIMULATION" | "BUSINESS_CONFIRMED"; reason: string }) => post<{ id: string; version: number }>("/api/payroll/bank-templates", input),
  batches: () => api<{ items: PaymentBatch[] }>("/api/payroll/payment-batches"),
  batch: (id: string) => api<{ batch: PaymentBatch; items: PaymentItem[] }>("/api/payroll/payment-batches/" + id),
  createBatch: (input: { sheetIds: string[]; templateId: string; reauthToken: string; note?: string }) => post<{ batch: PaymentBatch; items: PaymentItem[] }>("/api/payroll/payment-batches", input),
  batchFile: (id: string, reauthToken: string) => download("/api/payroll/payment-batches/" + id + "/file", { "X-Reauth-Token": reauthToken }),
  markPaid: (id: string, input: { paidDate: string; revision: number; note?: string }) => post<{ batch: PaymentBatch; items: PaymentItem[]; result: PaidResult }>("/api/payroll/payment-batches/" + id + "/paid", input),
  cancel: (id: string, input: { revision: number; reason: string }) => post<{ batch: PaymentBatch }>("/api/payroll/payment-batches/" + id + "/cancel", input),
};
