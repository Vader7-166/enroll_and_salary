import { api } from "./client";

export type ContractType =
  | "INDEFINITE"
  | "FIXED_TERM"
  | "PROBATION"
  | "UNDER_ONE_MONTH"
  | "PIECEWORK"
  | "COLLABORATOR";
export type SalaryBasis = "MONTHLY" | "HOURLY";
export type ContractStatus = "DRAFT" | "ACTIVE";

export interface ContractAnnex {
  id: string;
  number: string;
  effectiveFrom: string;
  signedDate: string;
  content: string;
}

export interface EmploymentContract {
  id: string;
  employeeId: string;
  number: string;
  type: ContractType;
  status: ContractStatus;
  startDate: string;
  endDate?: string | null;
  signedDate: string;
  salary: string;
  officialSalary?: string | null;
  salaryBasis: SalaryBasis;
  probationClass?: "TECHNICAL" | "WORKER" | null;
  insuranceEligible: boolean;
  annexes: ContractAnnex[];
}

export interface Assignment {
  id: string;
  orgUnitId: string;
  orgUnitCode: string;
  orgUnitName: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  isPrimary: boolean;
  allocationRatio: number | string;
}

export interface EmployeeTransfer {
  id: string;
  fromOrgUnitId: string;
  toOrgUnitId: string;
  effectiveFrom: string;
  decisionNumber: string;
  decisionDate: string;
  reason: string;
}

export interface LegalParameter {
  id: string;
  paramCode: string;
  scopeKey: string;
  subjectType: string;
  applicationBasis: "WORK_DATE" | "TAX_YEAR" | "PAYMENT_DATE";
  value: unknown;
  unit: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  documentEffectiveDate: string;
  legalBasis: string;
}

export interface CutoffPolicy {
  id: string;
  orgUnitId: string;
  policyKey: "CUTOFF_DAY";
  value: number;
  status: "SIMULATION" | "BUSINESS_CONFIRMED";
  decisionReference: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface AttendancePeriod {
  id: string;
  code: string;
  periodType: "ATTENDANCE";
  scopeOrgUnitId: string;
  scopeOrgUnitName: string;
  dateFrom: string;
  dateTo: string;
  cutoffDay: number;
  cutoffPolicyId: string;
  status: string;
  revision: number;
  openedAt: string | null;
}

export interface PeriodPreview {
  dateFrom: string;
  dateTo: string;
  cutoffDay: number;
  cutoffPolicyId: string;
  sourceOrgUnitId: string;
  status: "SIMULATION" | "BUSINESS_CONFIRMED";
  decisionReference: string;
}

function queryOf(values: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value) query.set(key, value);
  });
  return query.toString();
}

export const personnelApi = {
  contracts: (employeeId: string) =>
    api<{ items: EmploymentContract[]; warnings: string[] }>(
      "/api/employees/" + encodeURIComponent(employeeId) + "/contracts",
    ),
  createContract: (
    employeeId: string,
    payload: Omit<EmploymentContract, "id" | "employeeId" | "status" | "insuranceEligible" | "annexes">,
  ) =>
    api<{ contract: EmploymentContract }>(
      "/api/employees/" + encodeURIComponent(employeeId) + "/contracts",
      { method: "POST", body: JSON.stringify(payload) },
    ),
  activateContract: (employeeId: string, contractId: string) =>
    api<{ contract: EmploymentContract }>(
      "/api/employees/" +
        encodeURIComponent(employeeId) +
        "/contracts/" +
        encodeURIComponent(contractId) +
        "/activate",
      { method: "POST" },
    ),
  addAnnex: (
    employeeId: string,
    contractId: string,
    payload: Omit<ContractAnnex, "id">,
  ) =>
    api<{ annex: ContractAnnex }>(
      "/api/employees/" +
        encodeURIComponent(employeeId) +
        "/contracts/" +
        encodeURIComponent(contractId) +
        "/annexes",
      { method: "POST", body: JSON.stringify(payload) },
    ),
  assignments: (employeeId: string, asOf: string) =>
    api<{
      asOf: string;
      items: Assignment[];
      transfers: EmployeeTransfer[];
      currentOrgUnitId: string | null;
    }>(
      "/api/employees/" +
        encodeURIComponent(employeeId) +
        "/assignments?" +
        queryOf({ asOf }),
    ),
  transfer: (
    employeeId: string,
    payload: Omit<EmployeeTransfer, "id" | "fromOrgUnitId">,
  ) =>
    api<{ transfer: EmployeeTransfer }>(
      "/api/employees/" + encodeURIComponent(employeeId) + "/transfers",
      { method: "POST", body: JSON.stringify(payload) },
    ),
};

export const settingsApi = {
  parameters: (filters: { asOf?: string; paramCode?: string; scopeKey?: string } = {}) => {
    const query = queryOf(filters);
    return api<{ items: LegalParameter[] }>(
      "/api/settings/parameters" + (query ? "?" + query : ""),
    );
  },
  createParameter: (payload: Omit<LegalParameter, "id">) =>
    api<{ parameter: LegalParameter }>("/api/settings/parameters", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  policies: (filters: { orgUnitId?: string; asOf?: string } = {}) => {
    const query = queryOf(filters);
    return api<{ items: CutoffPolicy[] }>(
      "/api/settings/policies" + (query ? "?" + query : ""),
    );
  },
  createPolicy: (payload: Omit<CutoffPolicy, "id">) =>
    api<{ policy: CutoffPolicy }>("/api/settings/policies", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
};

export const periodApi = {
  list: () => api<{ items: AttendancePeriod[] }>("/api/periods"),
  preview: (scopeOrgUnitId: string, month: string) =>
    api<PeriodPreview>(
      "/api/periods/preview?" + queryOf({ scopeOrgUnitId, month }),
    ),
  create: (payload: {
    code: string;
    scopeOrgUnitId: string;
    month: string;
    dateFrom?: string;
    dateTo?: string;
  }) =>
    api<{ period: AttendancePeriod }>("/api/periods", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  open: (id: string, revision: number) =>
    api<{ period: AttendancePeriod }>(
      "/api/periods/" + encodeURIComponent(id) + "/open",
      { method: "POST", body: JSON.stringify({ revision }) },
    ),
};
