import { api } from "./client";

export type ShiftKind = "ADMINISTRATIVE" | "DAY" | "NIGHT";
export type PlanStatus = "DRAFT" | "PENDING" | "APPROVED" | "RETURNED" | "CANCELLED";
export interface Member { id: string; code: string; fullName: string }
export interface ShiftInput {
  orgUnitId: string; code: string; name: string; kind: ShiftKind;
  startTime: string; endTime: string; crossesMidnight: boolean;
  breakStartOffset: number; breakMinutes: number; paidBreak: boolean;
}
export interface Shift extends ShiftInput {
  id: string; active: boolean; revision: number; workMinutes: number; isNightShift: boolean; createdAt: string;
}
export interface PlanSlot { workDate: string; shiftId: string; employeeIds?: string[] }
export interface PlanInput { title: string; teamOrgUnitId: string; slots: PlanSlot[] }
export interface PlanSummary {
  id: string; title: string; teamOrgUnitId: string; teamOrgUnitCode: string;
  status: PlanStatus; revision: number; createdBy: { id: string; displayName: string };
  dateFrom: string; dateTo: string; entryCount: number;
}
export interface ScheduleEntry {
  id: string; employee: Member; workDate: string; shift: Shift;
  startAt: string; endAt: string; workMinutes: number;
}
export interface ShiftPlan {
  id: string; title: string; teamOrgUnitId: string; teamOrgUnitCode: string;
  status: PlanStatus; revision: number; createdBy: { id: string; displayName: string };
  createdAt: string; updatedAt: string; entries: ScheduleEntry[];
}
export interface PlanHistory {
  id: string; actor: { id: string; displayName: string }; action: string;
  fromStatus: PlanStatus | null; toStatus: PlanStatus; revision: number;
  reason: string | null; occurredAt: string; snapshot: ShiftPlan;
}
export interface PlanFilters { dateFrom: string; dateTo: string; teamOrgUnitId?: string; status?: PlanStatus }
export const shiftsApi = {
  definitions: (orgUnitId?: string) => api<{ items: Shift[] }>("/api/shifts/definitions" + (orgUnitId ? "?orgUnitId=" + encodeURIComponent(orgUnitId) : "")),
  createDefinition: (payload: ShiftInput) => api<{ shift: Shift }>("/api/shifts/definitions", { method: "POST", body: JSON.stringify(payload) }),
  updateDefinition: (id: string, payload: ShiftInput & { revision: number }) => api<{ shift: Shift }>("/api/shifts/definitions/" + id + "/update", { method: "POST", body: JSON.stringify(payload) }),
  active: (shift: Shift, active: boolean) => api<{ shift: Shift }>("/api/shifts/definitions/" + shift.id + "/active", { method: "POST", body: JSON.stringify({ revision: shift.revision, active }) }),
  members: (orgUnitId: string, workDate: string) => api<{ items: Member[] }>("/api/shifts/members?" + new URLSearchParams({ orgUnitId, workDate })),
  plans: (filters: PlanFilters) => api<{ items: PlanSummary[] }>("/api/shifts/plans?" + new URLSearchParams(Object.entries(filters).filter(([, value]) => Boolean(value)))),
  official: (filters: PlanFilters) => api<{ items: Array<ScheduleEntry & { planId: string; teamOrgUnitId: string }> }>("/api/shifts/official?" + new URLSearchParams(Object.entries(filters).filter(([, value]) => Boolean(value)))),
  plan: (id: string) => api<{ plan: ShiftPlan; history: PlanHistory[] }>("/api/shifts/plans/" + id),
  createPlan: (payload: PlanInput) => api<{ plan: ShiftPlan }>("/api/shifts/plans", { method: "POST", body: JSON.stringify(payload) }),
  updatePlan: (id: string, payload: PlanInput & { revision: number }) => api<{ plan: ShiftPlan }>("/api/shifts/plans/" + id + "/update", { method: "POST", body: JSON.stringify(payload) }),
  action: (id: string, action: "submit" | "approve" | "return" | "cancel", revision: number, reason?: string) => api<{ plan: ShiftPlan }>("/api/shifts/plans/" + id + "/" + action, { method: "POST", body: JSON.stringify({ revision, reason }) }),
};

export interface RotationPattern { id: string; code: string; siteOrgUnitId: string; siteCode: string; versions: Array<{ id: string; name: string; cycleDays: number; sequence: Array<string | null>; minRestMinutes: number; effectiveFrom: string; effectiveTo: string | null }> }
export interface ShiftSwap {
  id: string; scheduleId: string; teamCode: string; employee: Member; workDate: string; reason: string; status: "PENDING" | "APPROVED" | "RETURNED" | "REJECTED" | "CANCELLED"; revision: number;
  oldShift: { id: string; code: string; name: string; startTime: string; endTime: string }; newShift: { id: string; code: string; name: string; startTime: string; endTime: string };
  createdBy: { id: string; displayName: string }; decidedBy: string | null; decisionReason: string | null;
}
const post = <T>(path: string, body: unknown) => api<T>(path, { method: "POST", body: JSON.stringify(body) });
export const rotationApi = {
  patterns: () => api<{ items: RotationPattern[] }>("/api/shifts/rotation-patterns"),
  createPattern: (body: Record<string, unknown>) => post<{ pattern: RotationPattern }>("/api/shifts/rotation-patterns", body),
  generate: (planId: string, body: Record<string, unknown>) => post<{ plan: ShiftPlan; generated: number; skipped: unknown[] }>("/api/shifts/plans/" + planId + "/generate", body),
  bulkAssign: (planId: string, body: Record<string, unknown>) => post<{ plan: ShiftPlan; assigned: number }>("/api/shifts/plans/" + planId + "/bulk-assign", body),
  copyPrevious: (body: Record<string, unknown>) => post<{ plan: ShiftPlan; copied: number; skipped: Array<{ id: string; code: string; fullName: string; days: number }> }>("/api/shifts/plans/copy-previous", body),
  swaps: (status?: string) => api<{ items: ShiftSwap[] }>("/api/shifts/swaps" + (status ? "?status=" + status : "")),
  createSwap: (body: { scheduleId: string; newShiftId: string; reason: string }) => post<{ swap: ShiftSwap }>("/api/shifts/swaps", body),
  decide: (swap: ShiftSwap, action: "approve" | "return" | "reject", reason?: string) => post<{ swap: ShiftSwap }>("/api/shifts/swaps/" + swap.id + "/" + action, { revision: swap.revision, reason }),
};
