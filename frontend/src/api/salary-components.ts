import { api } from "./client";

export type SalaryComponentType = "EARNING" | "DEDUCTION" | "EMPLOYER_COST";
export type SalaryTaxClassification = "TAXABLE" | "NON_TAXABLE" | "CONDITIONAL";
export interface SalaryComponentUnit { id: string; code: string; name: string; type: string; parentId: string | null }
export interface SalaryComponentInput {
  name: string;
  componentType: SalaryComponentType;
  active: boolean;
  isInsurable: boolean;
  taxClassification: SalaryTaxClassification;
  isOtBase: boolean;
  isProrated: boolean;
  displayOrder: number;
  status: "SIMULATION" | "BUSINESS_CONFIRMED";
  classificationBasis: string;
  decisionReference: string;
  reason: string;
  effectiveFrom: string;
  effectiveTo?: string;
}
export interface SalaryComponentVersion extends Omit<SalaryComponentInput, "effectiveTo"> {
  id: string;
  effectiveTo: string | null;
  createdAt: string;
  createdBy: { id: string; displayName: string };
}
export interface SalaryComponent {
  id: string;
  code: string;
  orgUnitId: string;
  orgUnitCode: string;
  orgUnitName: string;
  revision: number;
  canManage: boolean;
  activeVersion: SalaryComponentVersion | null;
  versions: SalaryComponentVersion[];
}
export interface SalaryComponentContext {
  asOf: string;
  minimumSuccessorDate: string;
  units: SalaryComponentUnit[];
  managementUnits: SalaryComponentUnit[];
}
export interface SalaryComponentFilter { orgUnitId?: string; asOf?: string; search?: string }
export interface CreateSalaryComponentInput extends SalaryComponentInput { orgUnitId: string; code: string }
export interface CreateSalaryComponentVersionInput extends SalaryComponentInput { revision: number }
function query(filter: SalaryComponentFilter) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filter)) if (value) params.set(key, value);
  return params.size ? "?" + params.toString() : "";
}
export const salaryComponentsApi = {
  context: () => api<SalaryComponentContext>("/api/salary-components/context"),
  list: (filter: SalaryComponentFilter) => api<{ asOf: string; items: SalaryComponent[] }>("/api/salary-components" + query(filter)),
  detail: (id: string, asOf?: string) => api<{ item: SalaryComponent }>("/api/salary-components/" + id + query({ asOf })),
  create: (input: CreateSalaryComponentInput) => api<{ item: SalaryComponent }>("/api/salary-components", { method: "POST", body: JSON.stringify(input) }),
  createVersion: (id: string, input: CreateSalaryComponentVersionInput) => api<{ item: SalaryComponent }>("/api/salary-components/" + id + "/versions", { method: "POST", body: JSON.stringify(input) }),
};
