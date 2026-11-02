import { api } from "./client";

export type RoleCode = "TT" | "QD" | "KT" | "AD";

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  roles: RoleCode[];
  permissions: string[];
  assignments: {
    roleCode: RoleCode;
    scopeOrgUnitId: string;
    scopeName: string;
  }[];
  expiresAt: string;
  requiresPasswordChange: boolean;
  passwordExpiresAt: string | null;
}

export interface OrgUnit {
  id: string;
  code: string;
  name: string;
  type: string;
  parentId: string | null;
  siteId: string | null;
  level: number;
  pathLabel: string;
}
export interface JobTitle {
  id: string;
  code: string;
  name: string;
}
export interface OrganizationContext {
  asOf: string;
  units: OrgUnit[];
  jobTitles: JobTitle[];
}
export interface Employee {
  id: string;
  code: string;
  fullName: string;
  gender: "MALE" | "FEMALE" | "OTHER";
  dob: string;
  hireDate: string;
  status: "ACTIVE" | "TERMINATED";
  nationality: string;
  email: string | null;
  phone: string | null;
  orgUnit: {
    id: string;
    code: string;
    name: string;
    type: string;
    site: { id: string; code: string; name: string } | null;
  };
  jobTitle: { id: string; code: string; name: string } | null;
}
export interface EmployeePage {
  items: Employee[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PasswordPolicy {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumber: boolean;
  requireSymbol: boolean;
  historyCount: number;
  maxAgeDays: number;
}
export interface AccountAssignment {
  id: string;
  roleCode: RoleCode;
  scopeOrgUnitId: string;
  scopeName: string;
  scopeCode: string;
  scopeType: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}
export interface AccountExclusion {
  id: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}
export interface Account {
  id: string;
  username: string;
  displayName: string;
  status: "ACTIVE" | "DISABLED";
  roles: RoleCode[];
  sessionCount: number;
  lockedUntil: string | null;
  revision: number;
  employeeId: string | null;
  requiresPasswordChange: boolean;
  passwordChangedAt: string;
  passwordExpiresAt: string | null;
  assignments: AccountAssignment[];
  exclusions: AccountExclusion[];
}
export interface AccountContext {
  asOf: string;
  units: OrgUnit[];
  roles: { code: RoleCode; name: string }[];
  employees: { id: string; code: string; fullName: string }[];
  policy: PasswordPolicy;
}
export interface AssignmentInput {
  roleCode: RoleCode;
  scopeOrgUnitId: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
}
export interface ExclusionInput {
  employeeId: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
}

export const authApi = {
  login: (username: string, password: string) =>
    api<{ user: AuthUser }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  me: () => api<{ user: AuthUser }>("/api/auth/me"),
  logout: () => api<{ ok: true }>("/api/auth/logout", { method: "POST" }),
  passwordPolicy: () => api<{ policy: PasswordPolicy }>("/api/auth/password-policy"),
  changePassword: (payload: { currentPassword: string; newPassword: string }) =>
    api<{ ok: true }>("/api/auth/change-password", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  accountsContext: () => api<AccountContext>("/api/auth/accounts/context"),
  accounts: () => api<{ items: Account[] }>("/api/auth/accounts"),
  createAccount: (payload: {
    username: string;
    displayName: string;
    employeeId?: string | null;
    password: string;
    assignments: AssignmentInput[];
    exclusions: ExclusionInput[];
    reason: string;
  }) => api<{ account: Account }>("/api/auth/accounts", { method: "POST", body: JSON.stringify(payload) }),
  updateAccount: (id: string, payload: {
    revision: number;
    displayName: string;
    employeeId: string | null;
    assignments: AssignmentInput[];
    exclusions: ExclusionInput[];
    reason: string;
  }) => api<{ account: Account }>("/api/auth/accounts/" + encodeURIComponent(id) + "/update", { method: "POST", body: JSON.stringify(payload) }),
  setAccountStatus: (id: string, payload: { revision: number; status: Account["status"]; reason: string }) =>
    api<{ account: Account }>("/api/auth/accounts/" + encodeURIComponent(id) + "/status", { method: "POST", body: JSON.stringify(payload) }),
  resetAccountPassword: (id: string, payload: { revision: number; password: string; reason: string }) =>
    api<{ account: Account }>("/api/auth/accounts/" + encodeURIComponent(id) + "/password", { method: "POST", body: JSON.stringify(payload) }),
  revoke: (id: string) =>
    api<{ ok: true }>("/api/auth/accounts/" + encodeURIComponent(id) + "/revoke", { method: "POST" }),
};

export const organizationApi = {
  context: () => api<OrganizationContext>("/api/organization/context"),
};

export const employeeApi = {
  list: (args: {
    page: number;
    pageSize: number;
    search: string;
    orgUnitId?: string;
    status?: "ACTIVE" | "TERMINATED";
  }) => {
    const query = new URLSearchParams({
      page: String(args.page),
      pageSize: String(args.pageSize),
    });
    if (args.search) query.set("search", args.search);
    if (args.orgUnitId) query.set("orgUnitId", args.orgUnitId);
    if (args.status) query.set("status", args.status);
    return api<EmployeePage>("/api/employees?" + query.toString());
  },
  get: (id: string) =>
    api<{ employee: Employee | null }>(
      "/api/employees/" + encodeURIComponent(id),
    ),
  create: (payload: {
    code: string;
    fullName: string;
    gender: Employee["gender"];
    dob: string;
    hireDate: string;
    nationality?: string;
    email?: string;
    phone?: string;
    orgUnitId: string;
    jobTitleId?: string;
  }) =>
    api<{ employee: Employee }>("/api/employees", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
};
