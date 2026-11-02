import { api } from "./client";
import type { ConfigurationUnit, ProvenanceStatus } from "./payroll-configuration";

export type PayMode = "MONTHLY" | "DAILY" | "HOURLY" | "PRODUCT" | "PIECEWORK" | "COMMISSION" | "THREE_P";
export type PayPlanLineRole = "BASE" | "ADDITIONAL" | "NOT_APPLICABLE";
export type PayPlanSourceType = "TIME" | "PRODUCT" | "PIECEWORK" | "COMMISSION" | "THREE_P" | "ALLOWANCE" | "BONUS" | "DEDUCTION" | "EMPLOYER_COST";
export type PayPlanAllocation = "INDIVIDUAL" | "CONFIRMED_TEAM_ALLOCATION";

export interface PayPlanEmployee {
  id: string;
  code: string;
  fullName: string;
  orgUnitId: string;
  orgUnitCode: string;
  orgUnitName: string;
}

export interface PlanLine {
  id?: string;
  componentId: string;
  role: PayPlanLineRole;
  sourceType: PayPlanSourceType;
  formulaCode?: string;
  sourceReference: string;
  separateDecisionReference?: string;
  allocation: PayPlanAllocation;
  allocationReference?: string;
}

export interface PlanVersionInput {
  name: string;
  payMode: PayMode;
  status: ProvenanceStatus;
  decisionReference: string;
  reason: string;
  effectiveFrom: string;
  effectiveTo?: string;
  lines: PlanLine[];
}

export interface PlanVersion extends Omit<PlanVersionInput, "effectiveTo"> {
  id: string;
  effectiveTo: string | null;
  createdAt: string;
  createdBy: { id: string; displayName: string };
}

export interface PayPlan {
  id: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  orgUnitId: string;
  orgUnitCode: string;
  orgUnitName: string;
  revision: number;
  canManage: boolean;
  activeVersion: PlanVersion | null;
  versions: PlanVersion[];
}

export interface PayPlanContext {
  asOf: string;
  minimumSuccessorDate: string;
  units: ConfigurationUnit[];
  managementUnits: ConfigurationUnit[];
}

export interface PayPlanFilter {
  asOf?: string;
  orgUnitId?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface EmployeePickerFilter extends PayPlanFilter {}

export interface PayPlanCatalogue {
  components: Array<{ id: string; code: string; name: string; componentType: "EARNING" | "DEDUCTION" | "EMPLOYER_COST" }>;
  formulae: Array<{ code: string; name: string; componentId: string }>;
}

function query(filter: object) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filter)) if (value !== undefined && value !== "") params.set(key, String(value));
  return params.size ? "?" + params.toString() : "";
}

export const employeePayPlansApi = {
  context: () => api<PayPlanContext>("/api/employee-pay-plans/context"),
  employees: (filter: EmployeePickerFilter) => api<{ items: PayPlanEmployee[]; total: number; page: number; pageSize: number }>("/api/employee-pay-plans/employees" + query(filter)),
  catalogue: (employeeId: string, asOf: string) => api<PayPlanCatalogue>("/api/employee-pay-plans/catalogue" + query({ employeeId, asOf })),
  list: (filter: PayPlanFilter) => api<{ asOf: string; items: PayPlan[]; total: number; page: number; pageSize: number }>("/api/employee-pay-plans" + query(filter)),
  detail: (id: string, asOf?: string) => api<{ item: PayPlan }>("/api/employee-pay-plans/" + id + query({ asOf })),
  create: (employeeId: string, input: PlanVersionInput) => api<{ item: PayPlan }>("/api/employee-pay-plans", { method: "POST", body: JSON.stringify({ employeeId, ...input }) }),
  createVersion: (id: string, revision: number, input: PlanVersionInput) => api<{ item: PayPlan }>("/api/employee-pay-plans/" + id + "/versions", { method: "POST", body: JSON.stringify({ revision, ...input }) }),
};
