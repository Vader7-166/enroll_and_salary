import { api, ApiError } from "./client";

export interface DueWarning { daysLeft: number; overdue: boolean; threshold: number }
export interface PayrollPeriodItem { id: string; code: string; siteOrgUnitId: string; siteName: string; dateFrom: string; dateTo: string; expectedPaymentDate: string | null; status: string; isInitial: boolean; dueWarning: DueWarning | null; sheet: { id: string; status: string; calcCount: number; sourceHash: string | null } | null }
export interface PayrollRunView { id: string; status: "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED"; progressTotal: number; progressDone: number; errorCount: number; sourceHash: string | null; failure: string | null; startedAt: string; finishedAt: string | null; startedBy: { displayName: string } }
export interface Totals { gross: string; insuranceEmployee: string; unionFee: string; insuranceEmployer: string; tax: string; deductions: string; adjustments: string; net: string; employerCost: string }
export interface Violation { code: string; severity: "BLOCKING" | "WARNING"; message: string; details?: Record<string, unknown> }
export interface SheetEmployee { id: string; employee: { id: string; code: string; fullName: string }; status: "OK" | "ERROR"; errors: Array<{ code: string; message: string }>; totals: Totals; violations: Violation[]; hourlyRate: { numerator: string; denominatorHours: string; rate: string } | null }
export interface SheetView { sheet: { id: string; status: "DRAFT" | "APPROVED" | "LOCKED"; calcCount: number; revision: number; sourceHash: string | null; payrollPeriod: { code: string; dateFrom: string; dateTo: string } }; totals: { employees: number; errors: number; gross: string; insuranceEmployee: string; insuranceEmployer: string; tax: string; net: string }; items: SheetEmployee[] }
export interface ComplianceItem { code: string; severity: "BLOCKING" | "WARNING"; violationCount: number; pending: number; details: Array<Violation & { employeeId: string }>; acknowledgements: Array<{ employeeId: string; byName?: string; at: string; reason: string }> }
export interface PayrollLineView { id: string; lineNo: number; lineType: string; label: string; componentCode: string | null; paramCode: string | null; amount: string }
export interface ApprovalBlocker { code: string; message: string; employees?: Array<{ id: string; code: string; fullName: string }> }
export interface SheetHistoryItem { id: string; action: string; fromStatus: string; toStatus: string; revision: number; sourceHash: string | null; reason: string | null; actor: { id: string; displayName: string } | null; createdAt: string; totals: { employees: number; gross: string; net: string } | null }
export interface SheetHistory { status: "DRAFT" | "APPROVED" | "LOCKED"; revision: number; approvedSourceHash: string | null; blockers: ApprovalBlocker[]; snapshot: { id: string; contentHash: string; lockedAt: string; lockedBy: { displayName: string }; compliance: Array<{ code: string; violationCount: number; acknowledged: number }> } | null; items: SheetHistoryItem[] }
export interface TraceView { line: PayrollLineView; trace: Record<string, unknown>; sources: Array<{ sourceType: string; sourceId: string; versionId: string | null; sourceHash: string | null }>; attendance: Array<{ workDate: string; days: Array<{ checkInAt: string | null; checkOutAt: string | null; workedMinutes: number }>; punches: Array<{ punchedAt: string; direction: string; deviceCode: string }> }> }

const post = <T,>(path: string, body: unknown) => api<T>(path, { method: "POST", body: JSON.stringify(body) });
export const payrollApi = {
  periods: () => api<{ items: PayrollPeriodItem[] }>("/api/payroll/periods"),
  runs: (payrollPeriodId: string) => api<{ items: PayrollRunView[] }>("/api/payroll/runs?payrollPeriodId=" + payrollPeriodId),
  run: (id: string) => api<{ run: PayrollRunView; errors: Array<{ code: string; message: string; employee: { code: string; fullName: string } | null }> }>("/api/payroll/runs/" + id),
  start: (payrollPeriodId: string) => post<{ run: PayrollRunView }>("/api/payroll/runs", { payrollPeriodId }),
  cancel: (id: string) => post<{ run: PayrollRunView }>("/api/payroll/runs/" + id + "/cancel", {}),
  sheet: (payrollPeriodId: string) => api<SheetView | { sheet: null }>("/api/payroll/sheets?payrollPeriodId=" + payrollPeriodId),
  employee: (sheetId: string, employeeId: string) => api<{ employee: { code: string; fullName: string }; totals: Totals; lines: PayrollLineView[] }>("/api/payroll/sheets/" + sheetId + "/employees/" + employeeId),
  compliance: (sheetId: string) => api<{ runId: string | null; items: ComplianceItem[] }>("/api/payroll/sheets/" + sheetId + "/compliance"),
  acknowledge: (sheetId: string, employeeId: string, reason: string) => post<{ pending: number }>("/api/payroll/sheets/" + sheetId + "/compliance/acknowledge", { code: "CP-08", employeeId, reason }),
  trace: (lineId: string) => api<TraceView>("/api/payroll/lines/" + lineId + "/trace"),
  history: (sheetId: string) => api<SheetHistory>("/api/payroll/sheets/" + sheetId + "/history"),
  approve: (sheetId: string, revision: number, note?: string) => post<{ status: string; revision: number }>("/api/payroll/sheets/" + sheetId + "/approve", { revision, note }),
  returnToDraft: (sheetId: string, revision: number, reason: string) => post<{ status: string; revision: number }>("/api/payroll/sheets/" + sheetId + "/return-to-draft", { revision, reason }),
  reauthenticate: (password: string) => post<{ token: string; expiresAt: string }>("/api/auth/reauthenticate", { password }),
  lock: (sheetId: string, revision: number, reauthToken: string, note?: string) => post<{ snapshot: { id: string; contentHash: string; lockedAt: string }; revision: number }>("/api/payroll/sheets/" + sheetId + "/lock", { revision, reauthToken, note }),
  complianceReport: async (sheetId: string) => {
    let response: Response;
    try { response = await fetch("/api/payroll/sheets/" + sheetId + "/compliance-report.pdf", { credentials: "same-origin", cache: "no-store" }); } catch { throw new ApiError(0, "NETWORK_ERROR", "Không thể kết nối máy chủ. Vui lòng kiểm tra lại kết nối."); }
    if (!response.ok) { const body = await response.json().catch(() => undefined) as { code?: string; message?: string } | undefined; throw new ApiError(response.status, body?.code ?? "DOWNLOAD_FAILED", body?.message ?? "Không tải được báo cáo."); }
    return response.blob();
  },
};
