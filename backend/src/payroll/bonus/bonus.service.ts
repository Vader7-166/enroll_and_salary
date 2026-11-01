import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import Decimal from "decimal.js";
import { AuditService } from "../../audit/audit.service";
import type { AuthUser } from "../../auth/auth.types";
import { cipherText, plainText } from "../../common/data-crypto";
import { PrismaService } from "../../database/prisma.service";
import { effectiveAt, ScopeService } from "../../organization/scope.service";
import { PayrollSourceEvents } from "../../payroll-events/payroll-source-events.service";
import type { AllocationsDto, CancelBonusDto, CreateBonusDto, RevisionDto } from "../payroll-adjustments.dto";
import { BonusRuleError, computeBonus, p3Conflict, validatePlanRule, type BonusPlanRule, type BonusVariable } from "./bonus-rules";

type Db = Prisma.TransactionClient;
const key = (value: Date) => value.toISOString().slice(0, 10);
const date = (text: string) => new Date(text + "T00:00:00.000Z");
function fail(kind: "conflict" | "bad", code: string, message: string, details?: Record<string, unknown>): never {
  const body = { code, message, ...(details ? { details } : {}) };
  throw kind === "conflict" ? new ConflictException(body) : new BadRequestException(body);
}
const PLAN_INCLUDE = { payPayrollPeriod: { include: { payrollSheet: { select: { status: true } } } }, component: { select: { code: true } }, createdBy: { select: { displayName: true } }, confirmedBy: { select: { displayName: true } } } satisfies Prisma.BonusPlanInclude;
type Plan = Prisma.BonusPlanGetPayload<{ include: typeof PLAN_INCLUDE }>;

/** Bonus plans (FR-7.3.1): KT declares type, decision, earn and pay periods, targets and amount or formula; one allocation per employee. */
@Injectable()
export class BonusService {
  private readonly key: Buffer;
  constructor(private readonly prisma: PrismaService, private readonly scope: ScopeService, private readonly audit: AuditService, private readonly events: PayrollSourceEvents, config: ConfigService) {
    this.key = Buffer.from(config.getOrThrow<string>("HR_DATA_KEY"), "base64");
  }

  private assertRole(user: AuthUser) {
    if (!user.roles.includes("KT") || !user.permissions.includes("payroll.bonus")) throw new ForbiddenException("Chỉ KT được cấp quyền mới được quản lý đợt thưởng.");
  }
  private rule(plan: { calculationMode: string; amountCipher: string | null; formula: string | null; variables: unknown }): BonusPlanRule {
    return { calculationMode: plan.calculationMode as BonusPlanRule["calculationMode"], amount: plan.amountCipher ? plainText(this.key, plan.amountCipher, "thưởng") : null, formula: plan.formula, variables: plan.variables as BonusVariable[] };
  }
  private async plan(user: AuthUser, id: string, db: Db = this.prisma) {
    this.assertRole(user);
    const plan = await db.bonusPlan.findUnique({ where: { id }, include: PLAN_INCLUDE });
    if (!plan) throw new NotFoundException("Không tìm thấy đợt thưởng.");
    if (!(await this.scope.load(user, "payroll.bonus", db)).allowed.has(plan.payPayrollPeriod.siteOrgUnitId)) throw new ForbiddenException("Kỳ chi thưởng nằm ngoài phạm vi được phân quyền.");
    return plan;
  }
  private assertPayable(plan: { payPayrollPeriod: { code: string; status: string; payrollSheet: { status: string } | null } }) {
    if (plan.payPayrollPeriod.status !== "OPEN" || plan.payPayrollPeriod.payrollSheet?.status === "LOCKED") fail("conflict", "PAYROLL_PERIOD_LOCKED", `Kỳ chi ${plan.payPayrollPeriod.code} đã khóa; chọn kỳ lương đang mở.`);
  }
  private view(plan: Plan, extra: Record<string, unknown> = {}) {
    return { id: plan.id, code: plan.code, bonusType: plan.bonusType, name: plan.name, decisionReference: plan.decisionReference, independentDecisionRef: plan.independentDecisionRef, kpiSourceReference: plan.kpiSourceReference, earnFrom: key(plan.earnFrom), earnTo: key(plan.earnTo),
      payPeriod: { id: plan.payPayrollPeriod.id, code: plan.payPayrollPeriod.code, status: plan.payPayrollPeriod.status, expectedPaymentDate: plan.payPayrollPeriod.expectedPaymentDate ? key(plan.payPayrollPeriod.expectedPaymentDate) : null },
      componentCode: plan.component?.code ?? null, calculationMode: plan.calculationMode, amount: plan.amountCipher ? plainText(this.key, plan.amountCipher, "thưởng") : null, formula: plan.formula, variables: plan.variables, status: plan.status, revision: plan.revision, reason: plan.reason, cancelReason: plan.cancelReason,
      createdBy: plan.createdBy.displayName, createdAt: plan.createdAt.toISOString(), confirmedBy: plan.confirmedBy?.displayName ?? null, confirmedAt: plan.confirmedAt?.toISOString() ?? null, ...extra };
  }

  async list(user: AuthUser) {
    this.assertRole(user);
    const allowed = (await this.scope.load(user, "payroll.bonus")).allowed;
    const plans = await this.prisma.bonusPlan.findMany({ include: { ...PLAN_INCLUDE, allocations: { select: { amountCipher: true, conflictCode: true } } }, orderBy: { createdAt: "desc" }, take: 200 });
    return { items: plans.filter(plan => allowed.has(plan.payPayrollPeriod.siteOrgUnitId)).map(plan => this.view(plan, { employees: plan.allocations.length, conflicts: plan.allocations.filter(row => row.conflictCode).length, total: plan.allocations.reduce((sum, row) => sum.plus(plainText(this.key, row.amountCipher, "thưởng")), new Decimal(0)).toString() })) };
  }

  async get(user: AuthUser, id: string) {
    const plan = await this.plan(user, id);
    const allocations = await this.prisma.bonusAllocation.findMany({ where: { planId: id }, include: { employee: { select: { id: true, code: true, fullName: true } } }, orderBy: { employee: { code: "asc" } } });
    return { plan: this.view(plan), allocations: allocations.map(row => ({ id: row.id, employee: row.employee, amount: plainText(this.key, row.amountCipher, "thưởng"), inputs: JSON.parse(plainText(this.key, row.inputsCipher, "thưởng")) as Record<string, string>, conflictCode: row.conflictCode, conflictDetail: row.conflictDetail })) };
  }

  async create(user: AuthUser, dto: CreateBonusDto, ip?: string) {
    this.assertRole(user);
    const rule: BonusPlanRule = { calculationMode: dto.calculationMode, amount: dto.amount ?? null, formula: dto.formula?.trim() ?? null, variables: (dto.variables ?? []).map(variable => ({ name: variable.name.trim(), defaultValue: variable.defaultValue?.trim() || null })) };
    try { validatePlanRule(rule); } catch (error) { if (error instanceof BonusRuleError) fail("bad", error.code, error.message); throw error; }
    if (dto.earnFrom > dto.earnTo) fail("bad", "BONUS_EARN_RANGE_INVALID", "Kỳ hưởng: ngày bắt đầu không được sau ngày kết thúc.");
    const id = await this.prisma.$transaction(async db => {
      const period = await db.payrollPeriod.findUnique({ where: { id: dto.payPayrollPeriodId }, include: { payrollSheet: { select: { status: true } } } });
      if (!period) throw new NotFoundException("Không tìm thấy kỳ lương chi thưởng.");
      if (!(await this.scope.load(user, "payroll.bonus", db)).allowed.has(period.siteOrgUnitId)) throw new ForbiddenException("Kỳ chi thưởng nằm ngoài phạm vi được phân quyền.");
      this.assertPayable({ payPayrollPeriod: period });
      if (dto.componentId) {
        const component = await db.salaryComponent.findUnique({ where: { id: dto.componentId }, include: { versions: { where: effectiveAt(period.dateTo) } } });
        if (!component?.versions.some(version => version.active && version.componentType === "EARNING")) fail("bad", "BONUS_COMPONENT_INVALID", "Cấu phần thưởng phải là khoản thu nhập đang hiệu lực tại kỳ chi.");
      }
      const plan = await db.bonusPlan.create({ data: { code: dto.code.trim(), bonusType: dto.bonusType, name: dto.name.trim(), decisionReference: dto.decisionReference.trim(), independentDecisionRef: dto.independentDecisionRef?.trim() || null, kpiSourceReference: dto.kpiSourceReference?.trim() || null, earnFrom: date(dto.earnFrom), earnTo: date(dto.earnTo), payPayrollPeriodId: period.id, componentId: dto.componentId ?? null, calculationMode: rule.calculationMode, amountCipher: rule.amount ? cipherText(this.key, rule.amount) : null, formula: rule.calculationMode === "FORMULA" ? rule.formula : null, variables: rule.variables as unknown as Prisma.InputJsonValue, reason: dto.reason.trim(), createdById: user.id } });
      await this.audit.record({ actorId: user.id, entityType: "bonus_plan", entityId: plan.id, action: "CREATE", result: "SUCCESS", newValue: { code: plan.code, bonusType: plan.bonusType, payPayrollPeriodId: period.id, calculationMode: plan.calculationMode }, ipAddress: ip }, db);
      return plan.id;
    }).catch(error => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") fail("conflict", "BONUS_CODE_DUPLICATE", "Mã đợt thưởng đã tồn tại.");
      throw error;
    });
    return this.get(user, id);
  }

  /** Units below the target unit (inclusive) effective at the date. */
  private async unitTree(db: Db, rootId: string, at: Date) {
    const versions = await db.orgUnitVersion.findMany({ where: effectiveAt(at), select: { orgUnitId: true, parentId: true } });
    const ids = new Set([rootId]);
    for (let grew = true; grew;) { grew = false; for (const version of versions) if (version.parentId && ids.has(version.parentId) && !ids.has(version.orgUnitId)) { ids.add(version.orgUnitId); grew = true; } }
    return ids;
  }

  async addAllocations(user: AuthUser, id: string, dto: AllocationsDto, ip?: string) {
    await this.prisma.$transaction(async db => {
      const plan = await this.plan(user, id, db);
      await db.$queryRaw`SELECT id FROM bonus_plan WHERE id = ${id}::uuid FOR UPDATE`;
      if (plan.status !== "DRAFT") fail("conflict", "BONUS_PLAN_NOT_DRAFT", "Chỉ thêm người nhận khi đợt thưởng còn nháp.");
      this.assertPayable(plan);
      const allowed = (await this.scope.load(user, "payroll.bonus", db)).allowed;
      let items = dto.items ?? [];
      if (dto.orgUnitId) {
        if (!allowed.has(dto.orgUnitId)) throw new ForbiddenException("Đơn vị nằm ngoài phạm vi được phân quyền.");
        const tree = await this.unitTree(db, dto.orgUnitId, plan.earnTo);
        const assigned = await db.orgAssignment.findMany({ where: { isPrimary: true, orgUnitId: { in: [...tree] }, ...effectiveAt(plan.earnTo) }, select: { employeeId: true } });
        items = [...items, ...[...new Set(assigned.map(row => row.employeeId))].map(employeeId => ({ employeeId, inputs: dto.inputs }))];
      }
      if (!items.length) fail("bad", "BONUS_TARGET_EMPTY", "Chọn nhân viên hoặc đơn vị có nhân viên hiệu lực trong kỳ hưởng.");
      const ids = items.map(item => item.employeeId);
      const duplicate = ids.filter((value, index) => ids.indexOf(value) !== index);
      const existing = await db.bonusAllocation.findMany({ where: { planId: id, employeeId: { in: ids } }, include: { employee: { select: { code: true } } } });
      if (duplicate.length || existing.length) fail("conflict", "BONUS_DUPLICATE_EMPLOYEE", "Nhân viên đã có trong đợt thưởng; mỗi người chỉ nhận một lần.", { employees: [...existing.map(row => row.employee.code), ...duplicate] });
      const employees = await db.employee.findMany({ where: { id: { in: ids } }, include: { assignments: { where: { isPrimary: true, ...effectiveAt(plan.earnTo) } }, exclusions: { where: { userAccountId: user.id } } } });
      const outside = employees.filter(employee => employee.exclusions.length || !employee.assignments.some(assignment => allowed.has(assignment.orgUnitId)));
      if (outside.length || employees.length !== ids.length) throw new ForbiddenException("Có nhân viên ngoài phạm vi hoặc không còn hiệu lực trong kỳ hưởng.");
      const rule = this.rule(plan);
      const period = plan.payPayrollPeriod;
      const plans = await db.employeePayPlan.findMany({ where: { employeeId: { in: ids } }, include: { versions: { where: { effectiveFrom: { lte: period.dateTo }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: period.dateFrom } }] } } } });
      const p3Inputs = await db.payrollInputLine.findMany({ where: { employeeId: { in: ids }, inputType: "THREE_P", batch: { status: "CONFIRMED" } }, select: { employeeId: true, businessReference: true } });
      for (const item of items) {
        const inputs = Object.fromEntries(Object.entries(item.inputs ?? {}).map(([name, value]) => [name, String(value).trim()]));
        let amount;
        try { amount = computeBonus(rule, inputs); }
        catch (error) { if (error instanceof BonusRuleError) fail("bad", error.code, `${employees.find(row => row.id === item.employeeId)!.code}: ${error.message}`, error.details); throw error; }
        const conflict = p3Conflict(plan, { planLines: plans.filter(row => row.employeeId === item.employeeId).flatMap(row => row.versions.flatMap(version => version.lines as Array<{ sourceType: string; sourceReference?: string | null }>)), p3InputReferences: p3Inputs.filter(row => row.employeeId === item.employeeId).map(row => row.businessReference ?? "") });
        await db.bonusAllocation.create({ data: { planId: id, employeeId: item.employeeId, inputsCipher: cipherText(this.key, JSON.stringify({ ...amount.values, ...(amount.raw ? { RAW: amount.raw } : {}) })), amountCipher: cipherText(this.key, amount.amount), conflictCode: conflict?.code ?? null, conflictDetail: conflict?.detail ?? null, createdById: user.id } });
      }
      await db.bonusPlan.update({ where: { id }, data: { revision: { increment: 1 } } });
      await this.audit.record({ actorId: user.id, entityType: "bonus_plan", entityId: id, action: "ADD_ALLOCATIONS", result: "SUCCESS", newValue: { employees: items.length, orgUnitId: dto.orgUnitId ?? null }, ipAddress: ip }, db);
    }, { isolationLevel: "Serializable" }).catch(error => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") fail("conflict", "BONUS_DUPLICATE_EMPLOYEE", "Nhân viên đã có trong đợt thưởng; mỗi người chỉ nhận một lần.");
      throw error;
    });
    return this.get(user, id);
  }

  async removeAllocation(user: AuthUser, id: string, allocationId: string, ip?: string) {
    await this.prisma.$transaction(async db => {
      const plan = await this.plan(user, id, db);
      if (plan.status !== "DRAFT") fail("conflict", "BONUS_PLAN_NOT_DRAFT", "Chỉ bỏ người nhận khi đợt thưởng còn nháp.");
      const row = await db.bonusAllocation.findFirst({ where: { id: allocationId, planId: id } });
      if (!row) throw new NotFoundException("Không tìm thấy người nhận trong đợt thưởng.");
      await db.bonusAllocation.delete({ where: { id: allocationId } });
      await db.bonusPlan.update({ where: { id }, data: { revision: { increment: 1 } } });
      await this.audit.record({ actorId: user.id, entityType: "bonus_plan", entityId: id, action: "REMOVE_ALLOCATION", result: "SUCCESS", oldValue: { employeeId: row.employeeId }, ipAddress: ip }, db);
    });
    return this.get(user, id);
  }

  /** Confirmation makes the plan readable by the pay period's bonus stage; P3 double counting blocks it (TC-I07). */
  async confirm(user: AuthUser, id: string, dto: RevisionDto, ip?: string) {
    await this.prisma.$transaction(async db => {
      const plan = await this.plan(user, id, db);
      await db.$queryRaw`SELECT id FROM bonus_plan WHERE id = ${id}::uuid FOR UPDATE`;
      if (plan.status !== "DRAFT") fail("conflict", "BONUS_PLAN_NOT_DRAFT", "Đợt thưởng đã xác nhận hoặc đã hủy.");
      if (plan.revision !== dto.revision) fail("conflict", "STALE_REVISION", "Đợt thưởng đã thay đổi; tải lại.");
      this.assertPayable(plan);
      const allocations = await db.bonusAllocation.findMany({ where: { planId: id }, include: { employee: { select: { code: true, fullName: true } } } });
      if (!allocations.length) fail("conflict", "BONUS_TARGET_EMPTY", "Đợt thưởng chưa có người nhận.");
      const conflicts = allocations.filter(row => row.conflictCode);
      if (conflicts.length) fail("conflict", "BONUS_P3_DOUBLE_COUNT", `${conflicts.length} người nhận trùng nguồn KPI với P3; cần quyết định độc lập hoặc bỏ người nhận.`, { employees: conflicts.map(row => ({ ...row.employee, detail: row.conflictDetail })) });
      await db.bonusPlan.update({ where: { id }, data: { status: "CONFIRMED", confirmedById: user.id, confirmedAt: new Date(), revision: { increment: 1 } } });
      await this.events.changed(db, { payrollPeriodIds: [plan.payPayrollPeriodId], source: "BONUS", reason: "Xác nhận đợt thưởng " + plan.code, actorId: user.id });
      await this.audit.record({ actorId: user.id, entityType: "bonus_plan", entityId: id, action: "CONFIRM", result: "SUCCESS", newValue: { employees: allocations.length, payPayrollPeriodId: plan.payPayrollPeriodId }, ipAddress: ip }, db);
    }, { isolationLevel: "Serializable" });
    return this.get(user, id);
  }

  async cancel(user: AuthUser, id: string, dto: CancelBonusDto, ip?: string) {
    await this.prisma.$transaction(async db => {
      const plan = await this.plan(user, id, db);
      await db.$queryRaw`SELECT id FROM bonus_plan WHERE id = ${id}::uuid FOR UPDATE`;
      if (plan.status === "CANCELLED") fail("conflict", "BONUS_PLAN_CANCELLED", "Đợt thưởng đã hủy.");
      if (plan.revision !== dto.revision) fail("conflict", "STALE_REVISION", "Đợt thưởng đã thay đổi; tải lại.");
      if (plan.status === "CONFIRMED") this.assertPayable(plan);
      await db.bonusPlan.update({ where: { id }, data: { status: "CANCELLED", cancelReason: dto.reason.trim(), revision: { increment: 1 } } });
      if (plan.status === "CONFIRMED") await this.events.changed(db, { payrollPeriodIds: [plan.payPayrollPeriodId], source: "BONUS", reason: "Hủy đợt thưởng " + plan.code, actorId: user.id });
      await this.audit.record({ actorId: user.id, entityType: "bonus_plan", entityId: id, action: "CANCEL", result: "SUCCESS", newValue: { reason: dto.reason.trim(), wasConfirmed: plan.status === "CONFIRMED" }, ipAddress: ip }, db);
    }, { isolationLevel: "Serializable" });
    return this.get(user, id);
  }
}
