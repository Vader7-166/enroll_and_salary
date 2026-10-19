import { api } from "./client";

export type LeaveStatus = "SIMULATION" | "BUSINESS_CONFIRMED";
export type WorkingCondition = "NORMAL" | "HAZARDOUS" | "EXTREME";
export type LeaveLedgerKind = "ENTITLEMENT" | "RECALCULATION" | "ADJUSTMENT" | "CARRY_IN" | "CARRY_OUT" | "ADVANCE_IN" | "ADVANCE_OUT";
export type LeaveBucket = "ANNUAL" | "CARRY" | "ADVANCE";

export interface LeaveUnit {
  id: string;
  code: string;
  name: string;
  type: string;
  parentId: string | null;
}

export interface LeaveContext {
  units: LeaveUnit[];
  managementUnits: LeaveUnit[];
}

export interface LeaveVersionMeta {
  id: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: LeaveStatus;
  decisionReference: string;
  reason: string;
  createdAt: string;
  createdBy: { id: string; displayName: string } | null;
}

export interface LeaveTypeVersion extends LeaveVersionMeta {
  name: string;
  active: boolean;
  isPaid: boolean;
  countsAsWorkday: boolean;
  deductsAnnualQuota: boolean;
  siPaid: boolean;
  requiresDocument: boolean;
  maxDays: string | null;
  attendanceSymbol: string;
}

export interface LeavePolicyVersion extends LeaveVersionMeta {
  name: string;
  normalDays: number;
  hazardousDays: number;
  extremeDays: number;
  carryLimitDays: string;
  carryExpiryMonth: number;
  carryExpiryDay: number;
  advanceLimitDays: string;
}

export interface LeaveTypeHeader {
  id: string;
  orgUnitId: string;
  orgUnitCode: string;
  orgUnitName: string;
  code: string;
  revision: number;
  versions: LeaveTypeVersion[];
}

export interface LeavePolicyHeader {
  id: string;
  orgUnitId: string;
  orgUnitCode: string;
  orgUnitName: string;
  revision: number;
  versions: LeavePolicyVersion[];
}

export interface LeaveEmployee {
  id: string;
  code: string;
  fullName: string;
  hireDate: string;
  terminationDate: string | null;
  status: string;
  orgUnit: { id: string; code: string; name: string };
}

export interface LeaveLedgerEntry {
  id: string;
  kind: LeaveLedgerKind;
  bucket: LeaveBucket;
  days: string;
  expiresAt: string | null;
  operation: {
    id: string;
    kind: string;
    effectiveDate: string;
    reason: string;
    reference: string;
    createdAt: string;
    actor: { id: string; displayName: string };
    snapshot: Record<string, unknown>;
  };
}

export interface LeaveBalanceView {
  id: string | null;
  employee: Pick<LeaveEmployee, "id" | "code" | "fullName" | "hireDate" | "terminationDate">;
  year: number;
  revision: number;
  asOf: string;
  entitledDays: string;
  adjustmentDays: string;
  carriedDays: string;
  carriedOutDays: string;
  advanceDays: string;
  advancedToPreviousDays: string;
  usedDays: string;
  refundedDays: string;
  annualDays: string;
  availableDays: string;
  expiredCarryDays: string;
  reconciliationDays: string;
  calculation: Record<string, unknown> | null;
  entries: LeaveLedgerEntry[];
}

export interface LeaveBalanceAction {
  requestId: string;
  revision: number;
  effectiveDate: string;
  reason: string;
  reference: string;
}

export interface LeaveActionResponse {
  balance: LeaveBalanceView;
  targetBalance?: LeaveBalanceView;
  operationId: string | null;
  unchanged?: boolean;
  replayed?: boolean;
}

function params(values: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  const encoded = query.toString();
  return encoded ? `?${encoded}` : "";
}

export const leaveApi = {
  context: () => api<LeaveContext>("/api/leave/context"),
  types: (filters: { orgUnitId?: string; asOf?: string; search?: string }) =>
    api<{ items: LeaveTypeHeader[] }>("/api/leave/types" + params(filters)),
  policies: (filters: { orgUnitId?: string; asOf?: string; search?: string }) =>
    api<{ items: LeavePolicyHeader[] }>("/api/leave/policies" + params(filters)),
  createType: (payload: { orgUnitId: string; code: string } & Omit<LeaveTypeVersion, keyof LeaveVersionMeta | "id" | "createdAt" | "createdBy"> & Pick<LeaveVersionMeta, "status" | "decisionReference" | "reason" | "effectiveFrom" | "effectiveTo">) =>
    api<{ item: LeaveTypeHeader }>("/api/leave/types", { method: "POST", body: JSON.stringify(payload) }),
  createTypeVersion: (id: string, payload: { revision: number } & Omit<LeaveTypeVersion, keyof LeaveVersionMeta | "id" | "createdAt" | "createdBy"> & Pick<LeaveVersionMeta, "status" | "decisionReference" | "reason" | "effectiveFrom" | "effectiveTo">) =>
    api<{ item: LeaveTypeHeader }>(`/api/leave/types/${encodeURIComponent(id)}/versions`, { method: "POST", body: JSON.stringify(payload) }),
  createPolicy: (payload: { orgUnitId: string } & Omit<LeavePolicyVersion, keyof LeaveVersionMeta | "id" | "createdAt" | "createdBy"> & Pick<LeaveVersionMeta, "status" | "decisionReference" | "reason" | "effectiveFrom" | "effectiveTo">) =>
    api<{ item: LeavePolicyHeader }>("/api/leave/policies", { method: "POST", body: JSON.stringify(payload) }),
  createPolicyVersion: (id: string, payload: { revision: number } & Omit<LeavePolicyVersion, keyof LeaveVersionMeta | "id" | "createdAt" | "createdBy"> & Pick<LeaveVersionMeta, "status" | "decisionReference" | "reason" | "effectiveFrom" | "effectiveTo">) =>
    api<{ item: LeavePolicyHeader }>(`/api/leave/policies/${encodeURIComponent(id)}/versions`, { method: "POST", body: JSON.stringify(payload) }),
  employees: (filters: { year: number; search?: string; orgUnitId?: string; page?: number; pageSize?: number }) =>
    api<{ items: LeaveEmployee[]; total: number; page: number; pageSize: number }>("/api/leave/employees" + params(filters)),
  balances: (filters: { year: number; search?: string; orgUnitId?: string; asOf?: string; page?: number; pageSize?: number }) =>
    api<{ items: LeaveBalanceView[]; total: number; page: number; pageSize: number }>("/api/leave/balances" + params(filters)),
  balance: (employeeId: string, year: number, asOf?: string) =>
    api<{ balance: LeaveBalanceView }>(`/api/leave/balances/${encodeURIComponent(employeeId)}/${year}` + params({ asOf })),
  recalculate: (employeeId: string, year: number, payload: LeaveBalanceAction & { workingCondition: WorkingCondition; eligibleMonths: number[] }) =>
    api<LeaveActionResponse>(`/api/leave/balances/${encodeURIComponent(employeeId)}/${year}/recalculate`, { method: "POST", body: JSON.stringify(payload) }),
  adjust: (employeeId: string, year: number, payload: LeaveBalanceAction & { days: string }) =>
    api<LeaveActionResponse>(`/api/leave/balances/${encodeURIComponent(employeeId)}/${year}/adjust`, { method: "POST", body: JSON.stringify(payload) }),
  carry: (employeeId: string, year: number, payload: LeaveBalanceAction & { targetRevision: number; days: string }) =>
    api<LeaveActionResponse>(`/api/leave/balances/${encodeURIComponent(employeeId)}/${year}/carry`, { method: "POST", body: JSON.stringify(payload) }),
  advance: (employeeId: string, year: number, payload: LeaveBalanceAction & { targetRevision: number; days: string }) =>
    api<LeaveActionResponse>(`/api/leave/balances/${encodeURIComponent(employeeId)}/${year}/advance`, { method: "POST", body: JSON.stringify(payload) }),
};
