import type { Prisma, RoleCode } from "@prisma/client";
import type { AuthUser } from "../auth/auth.types";

export type Db = Prisma.TransactionClient;
export type ParamName = "periodId" | "payrollPeriodId" | "month" | "year" | "dateRange" | "orgUnitId";
export interface ReportParams { periodId?: string; payrollPeriodId?: string; month?: string; year?: string; dateFrom?: string; dateTo?: string; orgUnitId?: string }
/** `salary` columns need payroll.read, `personal` columns employee.sensitive.read; otherwise they render as ***. */
export interface Column { key: string; title: string; type?: "text" | "number" | "money" | "date"; sensitive?: "salary" | "personal"; width?: number }
export type Row = Record<string, string | number | boolean | null>;
export interface UnitInfo { id: string; code: string; name: string; type: string; parentId: string | null; costCenterCode: string | null; accountingAccount: string | null; siteId: string | null }

export interface ReportContext {
  user: AuthUser; db: Db; params: ReportParams;
  /** Units the user may see for this report's permission (current scope). */
  allowed: Set<string>;
  /** The organization as of the report's end date (names, parents, cost centers). */
  units: Map<string, UnitInfo>;
  asOf: Date;
  /** True when `unitId` is `rootId` or below it in the report-date tree. */
  within(unitId: string, rootId: string): boolean;
  /** Employees whose primary assignment on `at` is in scope (and under `orgUnitId` when given), minus exclusions. */
  employees(at: Date, extra?: Prisma.EmployeeWhereInput): Promise<Array<{ id: string; code: string; fullName: string; orgUnitId: string }>>;
  key: Buffer;
}
export interface ReportResult {
  /** DRAFT = live data of an open period; OFFICIAL = locked snapshot. */
  status: "DRAFT" | "OFFICIAL";
  source: string; sourceHash?: string | null; periodLabel: string;
  columns: Column[]; rows: Row[]; notes?: string[];
}
export interface ReportDefinition {
  type: string; title: string; group: "10.1" | "10.2" | "10.3" | "10.4" | "LABOR";
  roles: RoleCode[]; permission: string; params: ParamName[];
  /** Contains pay or personal data: every export is audited. */
  sensitive: boolean;
  asOf(ctx: Omit<ReportContext, "units" | "asOf" | "within" | "employees">): Promise<Date>;
  run(ctx: ReportContext): Promise<ReportResult>;
}

export const DAY = 86400000;
export const key = (value: Date) => value.toISOString().slice(0, 10);
export const parseDay = (value: string) => new Date(value + "T00:00:00.000Z");
export function monthBounds(month: string) {
  const [year, value] = month.split("-").map(Number);
  return { from: new Date(Date.UTC(year, value - 1, 1)), to: new Date(Date.UTC(year, value, 0)) };
}
export const hours = (minutes: number | string) => Math.round(Number(minutes) / 6) / 10;
