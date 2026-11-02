import { api } from "./client";

export type PayrollConfigurationKind = "PRICE" | "FORMULA";
export type PriceType = "MONTHLY" | "DAILY" | "HOURLY" | "PRODUCT" | "PIECEWORK" | "COMMISSION" | "P1" | "P2" | "P3";
export type FormulaVariableSource = "INPUT" | "PARAMETER" | "PRICE" | "FORMULA";
export type FormulaRoundingMode = "NONE" | "HALF_UP" | "HALF_EVEN" | "DOWN" | "UP" | "FLOOR" | "CEIL";
export type ProvenanceStatus = "SIMULATION" | "BUSINESS_CONFIRMED";

export interface ConfigurationUnit { id: string; code: string; name: string; type: string; parentId: string | null }
export interface PayrollConfigurationContext { asOf: string; minimumSuccessorDate: string; units: ConfigurationUnit[]; managementUnits: ConfigurationUnit[] }
export interface FormulaVariable { symbol: string; source: FormulaVariableSource; reference: string; unit: string; min?: string; max?: string }
export interface CommonConfigurationInput { name: string; unit: string; active: boolean; status: ProvenanceStatus; decisionReference: string; reason: string; effectiveFrom: string; effectiveTo?: string }
export interface PriceConfigurationInput extends CommonConfigurationInput { priceType: PriceType; amount: string; productCode?: string; operationCode?: string }
export interface FormulaConfigurationInput extends CommonConfigurationInput { componentId: string; expression: string; variables: FormulaVariable[]; roundingMode: FormulaRoundingMode; roundingScale: number }
export type PayrollConfigurationInput = PriceConfigurationInput | FormulaConfigurationInput;
export type PayrollConfigurationVersion = PayrollConfigurationInput & { id: string; effectiveTo: string | null; createdAt: string; createdBy: { id: string; displayName: string } };
export interface PayrollConfiguration { id: string; kind: PayrollConfigurationKind; code: string; orgUnitId: string; orgUnitCode: string; orgUnitName: string; revision: number; canManage: boolean; activeVersion: PayrollConfigurationVersion | null; versions: PayrollConfigurationVersion[] }
export interface PayrollConfigurationFilter { kind: PayrollConfigurationKind; orgUnitId?: string; asOf?: string; search?: string }
export type CreatePayrollConfigurationInput = PayrollConfigurationInput & { kind: PayrollConfigurationKind; code: string; orgUnitId: string };
export type CreatePayrollConfigurationVersionInput = PayrollConfigurationInput & { revision: number };
export interface PreviewContextInput { code: string; unit: string; min?: string; max?: string }
export interface PreviewContext { asOf: string; orgUnitId: string; formulaCode: string; inputs: PreviewContextInput[]; order: string[] }
export interface PreviewResult { code: string; name: string; unit: string; value: string; rawValue: string; expression: string; versionId: string; roundingMode: FormulaRoundingMode; roundingScale: number; variables: Array<FormulaVariable & { value: string; versionId?: string }> }
export interface PreviewRequest { orgUnitId: string; asOf: string; formulaCode: string; inputs: Array<{ code: string; unit: string; value: string }> }

function query(filter: object) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filter)) if (value) params.set(key, String(value));
  return params.size ? "?" + params.toString() : "";
}

export const payrollConfigurationApi = {
  context: () => api<PayrollConfigurationContext>("/api/payroll-configuration/context"),
  list: (filter: PayrollConfigurationFilter) => api<{ asOf: string; items: PayrollConfiguration[] }>("/api/payroll-configuration" + query(filter)),
  detail: (id: string, asOf?: string) => api<{ item: PayrollConfiguration }>("/api/payroll-configuration/" + id + query({ asOf })),
  create: (input: CreatePayrollConfigurationInput) => api<{ item: PayrollConfiguration }>("/api/payroll-configuration", { method: "POST", body: JSON.stringify(input) }),
  createVersion: (id: string, input: CreatePayrollConfigurationVersionInput) => api<{ item: PayrollConfiguration }>("/api/payroll-configuration/" + id + "/versions", { method: "POST", body: JSON.stringify(input) }),
  previewContext: (orgUnitId: string, asOf: string, formulaCode: string) => api<PreviewContext>("/api/payroll-configuration/preview-context" + query({ orgUnitId, asOf, formulaCode })),
  preview: (input: PreviewRequest) => api<{ simulation: true; asOf: string; orgUnitId: string; order: string[]; results: PreviewResult[] }>("/api/payroll-configuration/preview", { method: "POST", body: JSON.stringify(input) }),
};
