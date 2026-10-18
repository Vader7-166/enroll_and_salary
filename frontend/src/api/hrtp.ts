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
export interface Account {
  id: string;
  username: string;
  displayName: string;
  status: string;
  roles: RoleCode[];
  sessionCount: number;
  lockedUntil: string | null;
}

export const authApi = {
  login: (username: string, password: string) =>
    api<{ user: AuthUser }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  me: () => api<{ user: AuthUser }>("/api/auth/me"),
  logout: () => api<{ ok: true }>("/api/auth/logout", { method: "POST" }),
  accounts: () => api<{ items: Account[] }>("/api/auth/accounts"),
  revoke: (id: string) =>
    api<{ ok: true }>(
      "/api/auth/accounts/" + encodeURIComponent(id) + "/revoke",
      { method: "POST" },
    ),
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
