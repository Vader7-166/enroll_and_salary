import { Prisma } from "@prisma/client";

type Db = Prisma.TransactionClient;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const siteUnit = (siteColumn: Prisma.Sql) => Prisma.sql`SELECT org_unit_id::text AS id FROM org_unit_version WHERE site_id = ${siteColumn} AND unit_type = 'SITE' ORDER BY effective_from DESC LIMIT 1`;
const periodUnit = (periodColumn: Prisma.Sql) => Prisma.sql`SELECT site_org_unit_id::text AS id FROM payroll_period WHERE id = ${periodColumn}`;

/**
 * Where each audited entity lives in the organization tree (FR-1.6.4). A query returns one org unit id or an
 * employee id ("employee" kind) for the entity id `$id`. Entities absent here (accounts, legal parameters,
 * company-wide rule sets) stay unscoped and only company-scope AD see them.
 */
const RESOLVERS: Record<string, { kind: "unit" | "employee"; sql: (id: string) => Prisma.Sql }> = {
  employee: { kind: "employee", sql: id => Prisma.sql`SELECT ${id}::uuid AS employee_id` },
  employee_history: { kind: "employee", sql: id => Prisma.sql`SELECT ${id}::uuid AS employee_id` },
  personnel: { kind: "employee", sql: id => Prisma.sql`SELECT ${id}::uuid AS employee_id` },
  employment_contract: { kind: "employee", sql: id => Prisma.sql`SELECT employee_id FROM employment_contract WHERE id = ${id}::uuid` },
  contract_annex: { kind: "employee", sql: id => Prisma.sql`SELECT c.employee_id FROM contract_annex a JOIN employment_contract c ON c.id = a.contract_id WHERE a.id = ${id}::uuid` },
  personnel_transfer: { kind: "unit", sql: id => Prisma.sql`SELECT to_org_unit_id::text AS id FROM personnel_transfer WHERE id = ${id}::uuid` },
  leave_request: { kind: "employee", sql: id => Prisma.sql`SELECT employee_id FROM leave_request WHERE id = ${id}::uuid` },
  annual_leave_balance: { kind: "employee", sql: id => Prisma.sql`SELECT employee_id FROM annual_leave_balance WHERE id = ${id}::uuid` },
  employee_dependent: { kind: "employee", sql: id => Prisma.sql`SELECT employee_id FROM employee_dependent WHERE id = ${id}::uuid` },
  employee_bank_account: { kind: "employee", sql: id => Prisma.sql`SELECT employee_id FROM employee_bank_account WHERE id = ${id}::uuid` },
  tax_profile: { kind: "employee", sql: id => Prisma.sql`SELECT employee_id FROM tax_profile WHERE id = ${id}::uuid` },
  employee_special_status: { kind: "employee", sql: id => Prisma.sql`SELECT employee_id FROM employee_special_status WHERE id = ${id}::uuid` },
  salary_decision: { kind: "employee", sql: id => Prisma.sql`SELECT employee_id FROM salary_decision WHERE id = ${id}::uuid` },
  retro_calculation: { kind: "employee", sql: id => Prisma.sql`SELECT employee_id FROM retro_calculation WHERE id = ${id}::uuid` },
  retro_candidate: { kind: "employee", sql: id => Prisma.sql`SELECT employee_id FROM retro_candidate WHERE id = ${id}::uuid` },
  tax_withholding: { kind: "employee", sql: id => Prisma.sql`SELECT employee_id FROM tax_withholding WHERE id = ${id}::uuid` },
  payslip: { kind: "employee", sql: id => Prisma.sql`SELECT employee_id FROM payslip WHERE id = ${id}::uuid` },
  EmployeePayPlan: { kind: "employee", sql: id => Prisma.sql`SELECT employee_id FROM employee_pay_plan WHERE id = ${id}::uuid` },
  shift_definition: { kind: "unit", sql: id => Prisma.sql`SELECT org_unit_id::text AS id FROM shift_definition WHERE id = ${id}::uuid` },
  shift_plan: { kind: "unit", sql: id => Prisma.sql`SELECT team_org_unit_id::text AS id FROM shift_plan WHERE id = ${id}::uuid` },
  overtime_request: { kind: "unit", sql: id => Prisma.sql`SELECT team_org_unit_id::text AS id FROM overtime_request WHERE id = ${id}::uuid` },
  overtime_actual: { kind: "unit", sql: id => Prisma.sql`SELECT org_unit_id::text AS id FROM overtime_actual WHERE id = ${id}::uuid` },
  daily_attendance: { kind: "unit", sql: id => Prisma.sql`SELECT org_unit_id::text AS id FROM daily_attendance WHERE id = ${id}::uuid` },
  attendance_correction: { kind: "unit", sql: id => Prisma.sql`SELECT p.scope_org_unit_id::text AS id FROM attendance_correction c JOIN business_period p ON p.id = c.period_id WHERE c.id = ${id}::uuid` },
  attendance_period_lock: { kind: "unit", sql: id => Prisma.sql`SELECT p.scope_org_unit_id::text AS id FROM attendance_period_lock_event e JOIN business_period p ON p.id = e.period_id WHERE e.id = ${id}::uuid` },
  attendance_workshop_closure: { kind: "unit", sql: id => Prisma.sql`SELECT workshop_org_unit_id::text AS id FROM attendance_workshop_closure WHERE id = ${id}::uuid` },
  attendance_team_confirmation: { kind: "unit", sql: id => Prisma.sql`SELECT team_org_unit_id::text AS id FROM attendance_team_confirmation WHERE id = ${id}::uuid` },
  attendance_source_coverage: { kind: "unit", sql: id => Prisma.sql`SELECT team_org_unit_id::text AS id FROM attendance_source_coverage WHERE id = ${id}::uuid` },
  attendance_import: { kind: "unit", sql: id => siteUnit(Prisma.sql`(SELECT site_id FROM attendance_import WHERE id = ${id}::uuid)`) },
  attendance_import_profile: { kind: "unit", sql: id => siteUnit(Prisma.sql`(SELECT site_id FROM attendance_import_profile WHERE id = ${id}::uuid)`) },
  BusinessPeriod: { kind: "unit", sql: id => Prisma.sql`SELECT scope_org_unit_id::text AS id FROM business_period WHERE id = ${id}::uuid` },
  SitePolicy: { kind: "unit", sql: id => Prisma.sql`SELECT org_unit_id::text AS id FROM site_policy WHERE id = ${id}::uuid` },
  leave_type: { kind: "unit", sql: id => Prisma.sql`SELECT org_unit_id::text AS id FROM leave_type WHERE id = ${id}::uuid` },
  leave_policy: { kind: "unit", sql: id => Prisma.sql`SELECT org_unit_id::text AS id FROM leave_policy WHERE id = ${id}::uuid` },
  salary_component: { kind: "unit", sql: id => Prisma.sql`SELECT org_unit_id::text AS id FROM salary_component WHERE id = ${id}::uuid` },
  payroll_configuration: { kind: "unit", sql: id => Prisma.sql`SELECT org_unit_id::text AS id FROM payroll_configuration WHERE id = ${id}::uuid` },
  payroll_period: { kind: "unit", sql: id => periodUnit(Prisma.sql`${id}::uuid`) },
  payroll_run: { kind: "unit", sql: id => Prisma.sql`SELECT site_org_unit_id::text AS id FROM payroll_run WHERE id = ${id}::uuid` },
  payroll_sheet: { kind: "unit", sql: id => periodUnit(Prisma.sql`(SELECT payroll_period_id FROM payroll_sheet WHERE id = ${id}::uuid)`) },
  payroll_snapshot: { kind: "unit", sql: id => periodUnit(Prisma.sql`(SELECT s.payroll_period_id FROM payroll_snapshot n JOIN payroll_sheet s ON s.id = n.sheet_id WHERE n.id = ${id}::uuid)`) },
  payslip_export: { kind: "unit", sql: id => periodUnit(Prisma.sql`(SELECT s.payroll_period_id FROM payslip_export x JOIN payroll_sheet s ON s.id = x.sheet_id WHERE x.id = ${id}::uuid)`) },
  compliance_check_result: { kind: "unit", sql: id => periodUnit(Prisma.sql`(SELECT s.payroll_period_id FROM compliance_check_result c JOIN payroll_sheet s ON s.id = c.sheet_id WHERE c.id = ${id}::uuid)`) },
  payroll_input_batch: { kind: "unit", sql: id => periodUnit(Prisma.sql`(SELECT payroll_period_id FROM payroll_input_batch WHERE id = ${id}::uuid)`) },
  payroll_input_evidence: { kind: "unit", sql: id => periodUnit(Prisma.sql`(SELECT b.payroll_period_id FROM payroll_input_evidence v JOIN payroll_input_batch b ON b.id = v.batch_id WHERE v.id = ${id}::uuid)`) },
  bonus_plan: { kind: "unit", sql: id => periodUnit(Prisma.sql`(SELECT pay_payroll_period_id FROM bonus_plan WHERE id = ${id}::uuid)`) },
  insurance_change_list: { kind: "unit", sql: id => Prisma.sql`SELECT site_org_unit_id::text AS id FROM insurance_change_list WHERE id = ${id}::uuid` },
  c12_import: { kind: "unit", sql: id => Prisma.sql`SELECT site_org_unit_id::text AS id FROM c12_import WHERE id = ${id}::uuid` },
  termination_decision: { kind: "employee", sql: id => Prisma.sql`SELECT employee_id FROM termination_decision WHERE id = ${id}::uuid` },
  benefit_catalog: { kind: "unit", sql: id => Prisma.sql`SELECT org_unit_id::text AS id FROM benefit_catalog WHERE id = ${id}::uuid` },
  benefit_allocation_batch: { kind: "unit", sql: id => Prisma.sql`SELECT scope_org_unit_id::text AS id FROM benefit_allocation_batch WHERE id = ${id}::uuid` },
  annual_tax_finalization: { kind: "employee", sql: id => Prisma.sql`SELECT employee_id FROM annual_tax_finalization WHERE id = ${id}::uuid` },
  shift_rotation_pattern: { kind: "unit", sql: id => Prisma.sql`SELECT site_org_unit_id::text AS id FROM shift_rotation_pattern WHERE id = ${id}::uuid` },
  shift_swap_request: { kind: "unit", sql: id => Prisma.sql`SELECT team_org_unit_id::text AS id FROM shift_swap_request WHERE id = ${id}::uuid` },
  sickness_maternity_record: { kind: "employee", sql: id => Prisma.sql`SELECT employee_id FROM sickness_maternity_record WHERE id = ${id}::uuid` },
  salary_payment_batch: { kind: "unit", sql: id => Prisma.sql`SELECT site_org_unit_id::text AS id FROM salary_payment_item WHERE batch_id = ${id}::uuid ORDER BY site_org_unit_id LIMIT 1` },
};

// Payload hints for entity types without a resolver row (or whose entity id is an employee id, e.g. access denials).
const HINT_KEYS = ["scopeOrgUnitId", "orgUnitId", "teamOrgUnitId", "workshopOrgUnitId", "siteOrgUnitId"] as const;

function hint(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  for (const key of HINT_KEYS) {
    const item = (value as Record<string, unknown>)[key];
    if (typeof item === "string" && UUID.test(item)) return item;
  }
  return null;
}

async function unitOfEmployee(db: Db, employeeId: string): Promise<string | null> {
  const rows = await db.$queryRaw<{ id: string }[]>`SELECT org_unit_id::text AS id FROM org_assignment WHERE employee_id = ${employeeId}::uuid AND is_primary ORDER BY effective_from DESC LIMIT 1`;
  return rows[0]?.id ?? null;
}

export const auditedEntityTypes = Object.keys(RESOLVERS);

/**
 * Resolves the org unit an audit record belongs to. Ids are validated as UUIDs before any cast so a lookup can
 * never raise inside (and abort) the caller's transaction; `audit-search.test.cjs` runs every resolver once.
 */
export async function resolveAuditScope(db: Db, event: { entityType: string; entityId: string; result: string; oldValue?: unknown; newValue?: unknown }): Promise<string | null> {
  const resolver = RESOLVERS[event.entityType];
  if (resolver && UUID.test(event.entityId)) {
    if (resolver.kind === "unit") {
      const rows = await db.$queryRaw<{ id: string | null }[]>(resolver.sql(event.entityId));
      if (rows[0]?.id) return rows[0].id;
    } else {
      const rows = await db.$queryRaw<{ employee_id: string | null }[]>(Prisma.sql`SELECT e.employee_id::text AS employee_id FROM (${resolver.sql(event.entityId)}) e`);
      const employeeId = rows[0]?.employee_id;
      if (employeeId) { const unit = await unitOfEmployee(db, employeeId); if (unit) return unit; }
    }
  }
  const hinted = hint(event.newValue) ?? hint(event.oldValue);
  if (hinted) return hinted;
  const employeeId = (event.newValue as Record<string, unknown> | undefined)?.employeeId;
  if (typeof employeeId === "string" && UUID.test(employeeId)) return unitOfEmployee(db, employeeId);
  // Access denials on employee-keyed resources carry the employee id as entity id.
  return event.result === "DENIED" && UUID.test(event.entityId) ? unitOfEmployee(db, event.entityId) : null;
}
