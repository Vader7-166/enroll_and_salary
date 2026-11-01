import { api } from "./client";

export type DataStatus = "SIMULATION" | "BUSINESS_CONFIRMED";
export type SpecialStatusType = "FOREIGN_WORKER" | "PENSIONER" | "MINOR" | "FEMALE" | "VOCATIONAL_TRAINED";
export interface PayrollProfile {
  employee: { id: string; code: string; fullName: string };
  masked: boolean;
  identity: null | {
    revision: number; documentType: "CCCD" | "PASSPORT"; idNumber: string; idIssueDate: string | null; idIssuePlace: string | null;
    taxCode: string | null; siBookNumber: string | null; emergencyContact: { name: string | null; phone: string | null; relation: string | null };
    documentReference: string | null; dataStatus: DataStatus; updatedAt: string;
  };
  identityHistory: Array<{ revision: number; reason: string; actor: { id: string; displayName: string } | null; createdAt: string }>;
  bankAccounts: Array<{ id: string; bankCode: string; bankName: string; accountNumber: string; accountHolder: string; branch: string | null; effectiveFrom: string; effectiveTo: string | null; reason: string; dataStatus: DataStatus }>;
  dependents: Array<{ dependentKey: string; version: number; fullName: string; relationship: string; taxCode: string | null; birthDate: string | null; deductionFromMonth: string; deductionToMonth: string | null; evidenceReference: string; reason: string; dataStatus: DataStatus; history: Array<{ version: number; deductionFromMonth: string; deductionToMonth: string | null; reason: string; createdAt: string }> }>;
  taxProfiles: Array<{ id: string; residency: "RESIDENT" | "NON_RESIDENT"; commitmentReference: string | null; commitmentTemplateVersion: string | null; finalizationAuthorized: boolean; effectiveFrom: string; effectiveTo: string | null; reason: string; dataStatus: DataStatus }>;
  specialStatuses: Array<{ id: string; statusType: SpecialStatusType; workPermitNumber: string | null; permitExpiry: string | null; reference: string; effectiveFrom: string; effectiveTo: string | null; reason: string; dataStatus: DataStatus }>;
}
export interface Bank { code: string; name: string; shortName: string }

const post = <T,>(path: string, body: unknown) => api<T>(path, { method: "POST", body: JSON.stringify(body) });
const base = (employeeId: string) => "/api/employees/" + employeeId + "/payroll-profile";
export const payrollProfileApi = {
  banks: () => api<{ items: Bank[] }>("/api/payroll-profile/banks"),
  get: (employeeId: string) => api<PayrollProfile>(base(employeeId)),
  saveIdentity: (employeeId: string, body: Record<string, unknown>) => post<{ revision: number }>(base(employeeId) + "/identity", body),
  addBankAccount: (employeeId: string, body: Record<string, unknown>) => post<{ id: string }>(base(employeeId) + "/bank-accounts", body),
  addTaxProfile: (employeeId: string, body: Record<string, unknown>) => post<{ id: string }>(base(employeeId) + "/tax-profiles", body),
  addSpecialStatus: (employeeId: string, body: Record<string, unknown>) => post<{ id: string }>(base(employeeId) + "/special-statuses", body),
  addDependent: (employeeId: string, body: Record<string, unknown>) => post<{ dependentKey: string }>(base(employeeId) + "/dependents", body),
  addDependentVersion: (employeeId: string, key: string, body: Record<string, unknown>) => post<{ version: number }>(base(employeeId) + "/dependents/" + key + "/versions", body),
};
