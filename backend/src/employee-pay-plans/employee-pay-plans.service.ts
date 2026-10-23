import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { AuthUser } from "../auth/auth.types";
import { businessDate } from "../auth/business-date";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { effectiveAt } from "../organization/scope.service";
import { PayrollConfigurationService } from "../payroll-configuration/payroll-configuration.service";
import { CreateEmployeePayPlanDto, CreateEmployeePayPlanVersionDto, EmployeePayPlanCatalogueQueryDto, EmployeePayPlanDetailQueryDto, EmployeePayPlanEmployeeQueryDto, EmployeePayPlanQueryDto, PlanLineDto, PlanVersionInputDto } from "./employee-pay-plans.dto";

type Db = Prisma.TransactionClient;
type Permission = "payroll.components.read" | "payroll.components.manage";
type Scope = { unitIds: Set<string>; containerIds: Set<string> };
type Line = { componentId: string; role: PlanLineDto["role"]; sourceType: PlanLineDto["sourceType"]; formulaCode?: string; sourceReference: string; separateDecisionReference?: string; allocation: PlanLineDto["allocation"]; allocationReference?: string };
const DAY = 86_400_000;
const OPEN = new Date("9999-12-31T00:00:00.000Z");
const SOURCE_BY_MODE: Record<PlanVersionInputDto["payMode"], PlanLineDto["sourceType"]> = { MONTHLY: "TIME", DAILY: "TIME", HOURLY: "TIME", PRODUCT: "PRODUCT", PIECEWORK: "PIECEWORK", COMMISSION: "COMMISSION", THREE_P: "THREE_P" };
const INCLUDE = { employee: { select: { id: true, code: true, fullName: true } }, versions: { include: { createdBy: { select: { id: true, displayName: true } } }, orderBy: { effectiveFrom: "desc" as const } } } satisfies Prisma.EmployeePayPlanInclude;
type Plan = Prisma.EmployeePayPlanGetPayload<{ include: typeof INCLUDE }>;

function dateText(value: Date) { return value.toISOString().slice(0, 10); }
function parseDate(value: string) {
  const date = new Date(value + "T00:00:00.000Z");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || dateText(date) !== value || value < "1900-01-01") throw new BadRequestException("Ngày hiệu lực không hợp lệ hoặc trước năm 1900.");
  return date;
}
function nextDay(value: Date) { return new Date(value.getTime() + DAY); }
function previousDay(value: Date) { return new Date(value.getTime() - DAY); }
function text(value: string | undefined, label: string, max: number) {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.length > max) throw new BadRequestException(`${label} không hợp lệ.`);
  return trimmed;
}

@Injectable()
export class EmployeePayPlansService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly configurations: PayrollConfigurationService) {}

  private assertPermission(user: AuthUser, permission: Permission) {
    if (!user.roles.includes("KT") || !user.permissions.includes(permission)) throw new ForbiddenException("Chỉ kế toán được cấp quyền mới được xem hoặc quản lý phương án trả lương nhân viên.");
  }

  private async scope(user: AuthUser, permission: Permission, at: Date, db: Db): Promise<Scope> {
    if (permission === "payroll.components.manage" && !user.permissions.includes(permission)) return { unitIds: new Set(), containerIds: new Set() };
    this.assertPermission(user, permission);
    const [versions, grants] = await Promise.all([
      db.orgUnitVersion.findMany({ where: effectiveAt(at), include: { orgUnit: true } }),
      db.roleAssignment.findMany({ where: { userAccountId: user.id, roleCode: "KT", role: { permissions: { has: permission } }, ...effectiveAt(at) }, select: { scopeOrgUnitId: true } }),
    ]);
    const children = new Map<string, string[]>();
    for (const version of versions) if (version.parentId) children.set(version.parentId, [...(children.get(version.parentId) ?? []), version.orgUnitId]);
    const unitIds = new Set<string>();
    const pending = grants.map((grant) => grant.scopeOrgUnitId);
    while (pending.length) {
      const id = pending.pop()!;
      if (unitIds.has(id)) continue;
      unitIds.add(id);
      pending.push(...(children.get(id) ?? []));
    }
    return { unitIds, containerIds: new Set(versions.filter((version) => unitIds.has(version.orgUnitId) && (version.type === "COMPANY" || version.type === "SITE")).map((version) => version.orgUnitId)) };
  }

  private async canSeeEmployee(user: AuthUser, employeeId: string, at: Date, permission: Permission, db: Db) {
    const scope = await this.scope(user, permission, at, db);
    if (scope.unitIds.size === 0) return false;
    return !!(await db.employee.findFirst({ where: { id: employeeId, exclusions: { none: { userAccountId: user.id, ...effectiveAt(at) } }, assignments: { some: { isPrimary: true, orgUnitId: { in: [...scope.unitIds] }, ...effectiveAt(at) } } }, select: { id: true } }));
  }

  private async canSeeNowAndAt(user: AuthUser, employeeId: string, at: Date, permission: Permission, db: Db) {
    return (await this.canSeeEmployee(user, employeeId, businessDate(), permission, db)) && (await this.canSeeEmployee(user, employeeId, at, permission, db));
  }

  private dates(dto: PlanVersionInputDto) {
    const from = parseDate(dto.effectiveFrom);
    const to = dto.effectiveTo ? parseDate(dto.effectiveTo) : null;
    if (to && to < from) throw new BadRequestException("Ngày kết thúc phải từ ngày bắt đầu hiệu lực trở đi.");
    return { from, to };
  }

  private lines(dto: PlanVersionInputDto): Line[] {
    if (!dto.lines.length) throw new BadRequestException("Phương án phải có ít nhất một dòng cấu phần.");
    const components = new Set<string>();
    const formulas = new Set<string>();
    return dto.lines.map((raw) => {
      const line: Line = { ...raw, sourceReference: text(raw.sourceReference, "Nguồn chi trả", 1000), formulaCode: raw.formulaCode?.trim() || undefined, separateDecisionReference: raw.separateDecisionReference?.trim() || undefined, allocationReference: raw.allocationReference?.trim() || undefined };
      if (components.has(line.componentId)) throw new BadRequestException("Một cấu phần chỉ được xuất hiện một lần trong phương án.");
      components.add(line.componentId);
      if (line.role === "NOT_APPLICABLE") {
        if (line.formulaCode || line.allocation !== "INDIVIDUAL" || line.allocationReference) throw new BadRequestException("Dòng không áp dụng chỉ ghi lý do, không có công thức hay phân bổ.");
        return line;
      }
      if (!line.formulaCode || !/^[A-Z][A-Z0-9_]{0,79}$/.test(line.formulaCode)) throw new BadRequestException("Dòng áp dụng phải có mã công thức hợp lệ.");
      if (formulas.has(line.formulaCode)) throw new BadRequestException("Một công thức chi trả không được dùng hai lần.");
      formulas.add(line.formulaCode);
      const teamEligible = line.sourceType === "PRODUCT" || line.sourceType === "PIECEWORK";
      if (line.allocation === "CONFIRMED_TEAM_ALLOCATION" && (!teamEligible || !line.allocationReference)) throw new BadRequestException("Phân bổ tổ đã xác nhận chỉ áp dụng cho sản phẩm hoặc khoán và phải có căn cứ phân bổ.");
      if (line.allocation === "INDIVIDUAL" && line.allocationReference) throw new BadRequestException("Phân bổ cá nhân không có căn cứ phân bổ tổ.");
      return line;
    });
  }

  private async intervalAccess(user: AuthUser, employeeId: string, from: Date, to: Date, permission: Permission, db: Db, singleSite = true) {
    const [assignments, grants, exclusions] = await Promise.all([
      db.orgAssignment.findMany({ where: { employeeId, isPrimary: true, effectiveFrom: { lte: to }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }] } }),
      db.roleAssignment.findMany({ where: { userAccountId: user.id, roleCode: "KT", effectiveFrom: { lte: to }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }] }, select: { effectiveFrom: true, effectiveTo: true } }),
      db.employeeExclusion.findMany({ where: { userAccountId: user.id, employeeId, effectiveFrom: { lte: to }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }] }, select: { effectiveFrom: true, effectiveTo: true } }),
    ]);
    const versions = await db.orgUnitVersion.findMany({ where: { effectiveFrom: { lte: to }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }] } });
    const dates = new Map<string, Date>();
    const add = (value: Date) => { if (value >= from && value <= to) dates.set(dateText(value), value); };
    add(from); add(to);
    for (const row of [...assignments, ...grants, ...exclusions, ...versions]) { add(row.effectiveFrom); if (row.effectiveTo) add(nextDay(row.effectiveTo)); }
    let siteId: string | null = null;
    let siteOrgUnitId: string | null = null;
    for (const at of [...dates.values()].sort((a, b) => a.getTime() - b.getTime())) {
      if (!(await this.canSeeNowAndAt(user, employeeId, at, permission, db))) throw new NotFoundException("Không tìm thấy nhân viên trong phạm vi được phép.");
      const assignment = await db.orgAssignment.findFirst({ where: { employeeId, isPrimary: true, ...effectiveAt(at) }, orderBy: { effectiveFrom: "desc" } });
      if (!assignment) throw new BadRequestException("Nhân viên không có phân công chính trong toàn bộ khoảng hiệu lực.");
      const assignedUnit = await db.orgUnitVersion.findFirst({ where: { orgUnitId: assignment.orgUnitId, ...effectiveAt(at) }, select: { siteId: true } });
      if (!assignedUnit?.siteId) throw new BadRequestException("Phân công chính của nhân viên không xác định được cơ sở.");
      if (singleSite && siteId && siteId !== assignedUnit.siteId) throw new BadRequestException("Nhân viên chuyển cơ sở trong khoảng hiệu lực; phải tách phương án trả lương.");
      siteId = assignedUnit.siteId;
      if (at.getTime() === from.getTime()) {
        const site = await db.orgUnitVersion.findFirst({ where: { type: "SITE", siteId: assignedUnit.siteId, ...effectiveAt(at) }, select: { orgUnitId: true } });
        if (!site) throw new BadRequestException("Không tìm thấy đơn vị cơ sở hiệu lực.");
        siteOrgUnitId = site.orgUnitId;
      }
    }
    if (!siteOrgUnitId) throw new BadRequestException("Không xác định được cơ sở của nhân viên tại ngày bắt đầu.");
    return siteOrgUnitId;
  }

  private async validateComposition(db: Db, orgUnitId: string, dto: PlanVersionInputDto, from: Date, to: Date | null, lines: Line[]) {
    const applicable = lines.filter((line) => line.role !== "NOT_APPLICABLE");
    const base = applicable.filter((line) => line.role === "BASE");
    if (base.length !== 1) throw new BadRequestException("Phương án phải có đúng một cấu phần thu nhập cơ bản.");
    if (base[0].sourceType !== SOURCE_BY_MODE[dto.payMode]) throw new BadRequestException("Nguồn của cấu phần cơ bản không khớp chế độ trả lương.");
    const primarySources = applicable.filter((line) => line.role === "BASE" || (line.role === "ADDITIONAL" && ["TIME", "PRODUCT", "PIECEWORK", "THREE_P"].includes(line.sourceType)));
    if (primarySources.length > 1) throw new BadRequestException("Không được thêm nguồn chính thứ hai vào phương án.");
    const references = new Map<string, Line[]>();
    for (const line of applicable) references.set(line.sourceReference, [...(references.get(line.sourceReference) ?? []), line]);
    for (const group of references.values()) if (group.length > 1) {
      const decisions = new Set<string>();
      for (const line of group.filter((item) => item.role === "ADDITIONAL")) {
        if (!line.separateDecisionReference || decisions.has(line.separateDecisionReference)) throw new BadRequestException("Khoản bổ sung cùng nguồn phải có quyết định riêng khác nhau.");
        decisions.add(line.separateDecisionReference);
      }
    }
    const end = to ?? OPEN;
    const overlap = { effectiveFrom: { lte: end }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }] };
    const select = { effectiveFrom: true, effectiveTo: true };
    const groups = await Promise.all([
      db.salaryComponentVersion.findMany({ where: overlap, select }),
      db.payrollConfigurationVersion.findMany({ where: overlap, select }),
      db.legalParameter.findMany({ where: overlap, select }),
      db.orgUnitVersion.findMany({ where: overlap, select }),
    ]);
    const boundaries = new Map<string, Date>([[dateText(from), from], [dateText(end), end]]);
    for (const row of groups.flat()) {
      if (row.effectiveFrom >= from) boundaries.set(dateText(row.effectiveFrom), row.effectiveFrom);
      if (row.effectiveTo && row.effectiveTo < end) {
        const after = nextDay(row.effectiveTo);
        if (after >= from) boundaries.set(dateText(after), after);
      }
    }
    for (const at of boundaries.values()) {
      const componentVersions = await db.salaryComponentVersion.findMany({ where: { componentId: { in: lines.map((line) => line.componentId) }, ...effectiveAt(at) }, select: { componentId: true, componentType: true, active: true, status: true } });
      const components = new Map(componentVersions.map((component) => [component.componentId, component]));
      const closures = new Map<string, string[]>();
      for (const line of lines) {
        const component = components.get(line.componentId);
        if (!component?.active) throw new BadRequestException("Cấu phần lương không có hiệu lực tại mọi ngày biên của phương án.");
        if (dto.status === "BUSINESS_CONFIRMED" && component.status === "SIMULATION") throw new BadRequestException("Phương án đã xác nhận không được dùng cấu phần mô phỏng.");
        if (line.role === "BASE" && component.componentType !== "EARNING") throw new BadRequestException("Cấu phần cơ bản phải là khoản thu nhập.");
        if (line.role === "ADDITIONAL" && line.sourceType === "DEDUCTION" && component.componentType !== "DEDUCTION") throw new BadRequestException("Khoản khấu trừ phải dùng cấu phần khấu trừ.");
        if (line.role === "ADDITIONAL" && line.sourceType === "EMPLOYER_COST" && component.componentType !== "EMPLOYER_COST") throw new BadRequestException("Chi phí người sử dụng lao động phải dùng cấu phần tương ứng.");
        if (line.role === "ADDITIONAL" && !["DEDUCTION", "EMPLOYER_COST"].includes(line.sourceType) && component.componentType !== "EARNING") throw new BadRequestException("Khoản bổ sung phải dùng cấu phần thu nhập.");
        await this.configurations.assertComponentBinding(db, orgUnitId, at, line.componentId);
        if (line.role === "ADDITIONAL" && line.sourceType === "COMMISSION" && !line.separateDecisionReference) throw new BadRequestException("Hoa hồng bổ sung phải có quyết định độc lập.");
        if (line.role === "NOT_APPLICABLE") continue;
        const closure = await this.configurations.assertFormulaBinding(db, orgUnitId, at, line.formulaCode!, line.componentId, dto.status === "BUSINESS_CONFIRMED");
        closures.set(line.formulaCode!, closure);
      }
      for (const line of applicable) {
        if (line.role === "BASE" || line.separateDecisionReference) continue;
        const closure = closures.get(line.formulaCode!)!;
        if (applicable.some(other => other !== line && closure.includes(other.formulaCode!)))
          throw new BadRequestException("Khoản bổ sung dùng khoản chi trả khác làm căn cứ phải có quyết định riêng.");
      }
    }
  }

  private versionData(dto: PlanVersionInputDto, from: Date, to: Date | null, lines: Line[], userId: string): Prisma.EmployeePayPlanVersionUncheckedCreateWithoutPayPlanInput {
    const jsonLines: Prisma.InputJsonArray = lines.map((line) => ({ componentId: line.componentId, role: line.role, sourceType: line.sourceType, sourceReference: line.sourceReference, allocation: line.allocation, ...(line.formulaCode ? { formulaCode: line.formulaCode } : {}), ...(line.separateDecisionReference ? { separateDecisionReference: line.separateDecisionReference } : {}), ...(line.allocationReference ? { allocationReference: line.allocationReference } : {}) }));
    return { name: text(dto.name, "Tên phương án", 150), payMode: dto.payMode, status: dto.status, decisionReference: text(dto.decisionReference, "Số quyết định", 500), reason: text(dto.reason, "Lý do", 2000), effectiveFrom: from, effectiveTo: to, lines: jsonLines, createdById: userId };
  }

  private async unit(orgUnitId: string, at: Date, db: Db) {
    const version = await db.orgUnitVersion.findFirst({ where: { orgUnitId, ...effectiveAt(at) }, include: { orgUnit: true } });
    if (!version) throw new NotFoundException("Không tìm thấy đơn vị hiệu lực.");
    return { id: orgUnitId, code: version.orgUnit.code, name: version.name };
  }

  private async employeeUnit(employeeId: string, at: Date, db: Db) {
    const assignment = await db.orgAssignment.findFirst({ where: { employeeId, isPrimary: true, ...effectiveAt(at) }, orderBy: { effectiveFrom: "desc" } });
    if (!assignment) throw new NotFoundException("Không tìm thấy phân công chính hiệu lực của nhân viên.");
    const assigned = await db.orgUnitVersion.findFirst({ where: { orgUnitId: assignment.orgUnitId, ...effectiveAt(at) } });
    const site = assigned?.siteId && await db.orgUnitVersion.findFirst({ where: { type: "SITE", siteId: assigned.siteId, ...effectiveAt(at) } });
    if (!site) throw new NotFoundException("Không tìm thấy cơ sở hiệu lực của nhân viên.");
    return this.unit(site.orgUnitId, at, db);
  }

  private view(plan: Plan, at: Date, unit: { id: string; code: string; name: string }, canManage: boolean) {
    const mapVersion = (version: Plan["versions"][number]) => ({ id: version.id, name: version.name, payMode: version.payMode, status: version.status, decisionReference: version.decisionReference, reason: version.reason, effectiveFrom: dateText(version.effectiveFrom), effectiveTo: version.effectiveTo ? dateText(version.effectiveTo) : null, lines: version.lines, createdAt: version.createdAt.toISOString(), createdBy: version.createdBy });
    const active = plan.versions.find((version) => version.effectiveFrom <= at && (!version.effectiveTo || version.effectiveTo >= at));
    return { id: plan.id, employeeId: plan.employeeId, employeeCode: plan.employee.code, employeeName: plan.employee.fullName, orgUnitId: unit.id, orgUnitCode: unit.code, orgUnitName: unit.name, revision: plan.revision, canManage, activeVersion: active ? mapVersion(active) : null, versions: plan.versions.map(mapVersion) };
  }

  private read<T>(work: (db: Db) => Promise<T>) { return this.prisma.$transaction(work, { isolationLevel: "RepeatableRead", timeout: 30_000 }); }
  private async write<T>(work: (db: Db) => Promise<T>) {
    try {
      return await this.prisma.$transaction(async (db) => {
        await db.$queryRaw`SELECT pg_advisory_xact_lock(8210500)::text`;
        await db.$queryRaw`SELECT pg_advisory_xact_lock(8210522)::text`;
        await db.$queryRaw`SELECT pg_advisory_xact_lock(8210523)::text`;
        return work(db);
      }, { isolationLevel: "Serializable", timeout: 60_000 });
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code)) throw new ConflictException("Dữ liệu đã thay đổi đồng thời; vui lòng tải lại và thử lại.");
      if (error instanceof Error && /overlap|concurrent|serialize/i.test(error.message)) throw new ConflictException("Dữ liệu đã thay đổi đồng thời; vui lòng tải lại và thử lại.");
      throw error;
    }
  }

  async context(user: AuthUser) {
    const at = businessDate();
    return this.read(async (db) => {
      const [read, manage, versions] = await Promise.all([this.scope(user, "payroll.components.read", at, db), this.scope(user, "payroll.components.manage", at, db), db.orgUnitVersion.findMany({ where: effectiveAt(at), include: { orgUnit: true } })]);
      const show = (ids: Set<string>) => versions.filter((version) => ids.has(version.orgUnitId) && (version.type === "COMPANY" || version.type === "SITE")).map((version) => ({ id: version.orgUnitId, code: version.orgUnit.code, name: version.name, type: version.type, parentId: version.parentId }));
      return { asOf: dateText(at), minimumSuccessorDate: dateText(nextDay(at)), units: show(read.containerIds), managementUnits: show(manage.containerIds) };
    });
  }

  catalogue(user: AuthUser, query: EmployeePayPlanCatalogueQueryDto) {
    const at = query.asOf ? parseDate(query.asOf) : businessDate();
    return this.read(async db => {
      this.assertPermission(user, "payroll.components.read");
      if (!(await this.canSeeNowAndAt(user, query.employeeId, at, "payroll.components.read", db))) throw new NotFoundException("Không tìm thấy nhân viên trong phạm vi được cấp.");
      const unit = await this.employeeUnit(query.employeeId, at, db);
      return this.configurations.employeePlanCatalogue(db, unit.id, at);
    });
  }

  private async employeeFilter(user: AuthUser, at: Date, orgUnitId: string | undefined, db: Db): Promise<Prisma.EmployeeWhereInput> {
    const now = businessDate();
    const [current, dated] = await Promise.all([this.scope(user, "payroll.components.read", now, db), this.scope(user, "payroll.components.read", at, db)]);
    let units = dated.unitIds;
    if (orgUnitId) {
      if (!dated.containerIds.has(orgUnitId) || !current.containerIds.has(orgUnitId)) throw new NotFoundException("Không tìm thấy đơn vị trong phạm vi được cấp.");
      const versions = await db.orgUnitVersion.findMany({ where: effectiveAt(at), select: { orgUnitId: true, parentId: true } });
      const selected = new Set<string>(), pending = [orgUnitId];
      while (pending.length) {
        const id = pending.pop()!;
        if (selected.has(id)) continue;
        selected.add(id);
        for (const row of versions) if (row.parentId === id) pending.push(row.orgUnitId);
      }
      units = new Set([...dated.unitIds].filter(id => selected.has(id)));
    }
    return { AND: [
      { assignments: { some: { isPrimary: true, orgUnitId: { in: [...current.unitIds] }, ...effectiveAt(now) } } },
      { assignments: { some: { isPrimary: true, orgUnitId: { in: [...units] }, ...effectiveAt(at) } } },
      { exclusions: { none: { userAccountId: user.id, OR: [effectiveAt(now), effectiveAt(at)] } } },
    ] };
  }

  private async visibleHistory(user: AuthUser, plan: Plan, db: Db): Promise<Plan> {
    const versions: Plan["versions"] = [];
    for (const version of plan.versions) {
      try {
        await this.intervalAccess(user, plan.employeeId, version.effectiveFrom, version.effectiveTo ?? OPEN, "payroll.components.read", db, false);
        versions.push(version);
      } catch (error) {
        if (!(error instanceof NotFoundException)) throw error;
      }
    }
    return { ...plan, versions };
  }

  async employees(user: AuthUser, query: EmployeePayPlanEmployeeQueryDto) {
    const at = query.asOf ? parseDate(query.asOf) : businessDate();
    const page = query.page ?? 1, pageSize = query.pageSize ?? 25, search = query.search?.trim();
    return this.read(async (db) => {
      const scoped = await this.employeeFilter(user, at, query.orgUnitId, db);
      const where: Prisma.EmployeeWhereInput = { AND: [scoped, ...(search ? [{ OR: [{ code: { contains: search, mode: "insensitive" as const } }, { fullName: { contains: search, mode: "insensitive" as const } }] }] : [])] };
      const [total, employees] = await Promise.all([
        db.employee.count({ where }),
        db.employee.findMany({ where, orderBy: { code: "asc" }, skip: (page - 1) * pageSize, take: pageSize, select: { id: true, code: true, fullName: true } }),
      ]);
      const items = await Promise.all(employees.map(async employee => {
        const unit = await this.employeeUnit(employee.id, at, db);
        return { ...employee, orgUnitId: unit.id, orgUnitCode: unit.code, orgUnitName: unit.name };
      }));
      return { items, total, page, pageSize };
    });
  }

  async list(user: AuthUser, query: EmployeePayPlanQueryDto) {
    const at = query.asOf ? parseDate(query.asOf) : businessDate();
    const page = query.page ?? 1, pageSize = query.pageSize ?? 25, search = query.search?.trim();
    return this.read(async (db) => {
      const scoped = await this.employeeFilter(user, at, query.orgUnitId, db);
      const plans = await db.employeePayPlan.findMany({ where: { employee: scoped }, include: INCLUDE, orderBy: { employee: { code: "asc" } } });
      const visible = [];
      for (const plan of plans) {
        const authorized = await this.visibleHistory(user, plan, db);
        if (!authorized.versions.length) continue;
        if (search && ![plan.employee.code, plan.employee.fullName, ...authorized.versions.map(version => version.name)].some(value => value.toLocaleLowerCase().includes(search.toLocaleLowerCase()))) continue;
        const unit = await this.employeeUnit(plan.employeeId, at, db);
        visible.push(this.view(authorized, at, unit, await this.canSeeNowAndAt(user, plan.employeeId, at, "payroll.components.manage", db)));
      }
      return { asOf: dateText(at), items: visible.slice((page - 1) * pageSize, page * pageSize), total: visible.length, page, pageSize };
    });
  }

  async detail(user: AuthUser, id: string, query: EmployeePayPlanDetailQueryDto) {
    const at = query.asOf ? parseDate(query.asOf) : businessDate();
    return this.read(async (db) => {
      this.assertPermission(user, "payroll.components.read");
      const plan = await db.employeePayPlan.findUnique({ where: { id }, include: INCLUDE });
      if (!plan || !(await this.canSeeNowAndAt(user, plan.employeeId, at, "payroll.components.read", db))) throw new NotFoundException("Không tìm thấy phương án trả lương.");
      const authorized = await this.visibleHistory(user, plan, db);
      if (!authorized.versions.length) throw new NotFoundException("Không tìm thấy phương án trả lương trong phạm vi được cấp.");
      const unit = await this.employeeUnit(plan.employeeId, at, db);
      return { item: this.view(authorized, at, unit, await this.canSeeNowAndAt(user, plan.employeeId, at, "payroll.components.manage", db)) };
    });
  }

  async create(user: AuthUser, dto: CreateEmployeePayPlanDto, ipAddress?: string) {
    this.assertPermission(user, "payroll.components.manage");
    const { from, to } = this.dates(dto);
    return this.write(async (db) => {
      await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${dto.employeeId}, 8210523))::text`;
      const employee = await db.employee.findUnique({ where: { id: dto.employeeId }, select: { hireDate: true } });
      if (!employee) throw new NotFoundException("Không tìm thấy nhân viên.");
      if (from < employee.hireDate) throw new BadRequestException("Ngày bắt đầu không được trước ngày vào làm.");
      const orgUnitId = await this.intervalAccess(user, dto.employeeId, from, to ?? OPEN, "payroll.components.manage", db);
      const lines = this.lines(dto);
      await this.validateComposition(db, orgUnitId, dto, from, to, lines);
      const plan = await db.employeePayPlan.create({ data: { employeeId: dto.employeeId, versions: { create: this.versionData(dto, from, to, lines, user.id) } }, include: INCLUDE });
      await this.audit.record({ actorId: user.id, entityType: "EmployeePayPlan", entityId: plan.id, action: "CREATE", result: "SUCCESS", newValue: { employeeId: plan.employeeId, effectiveFrom: dateText(from) }, ipAddress }, db);
      return { item: this.view(plan, from, await this.employeeUnit(dto.employeeId, from, db), true) };
    });
  }

  async createVersion(user: AuthUser, id: string, dto: CreateEmployeePayPlanVersionDto, ipAddress?: string) {
    this.assertPermission(user, "payroll.components.manage");
    const { from, to } = this.dates(dto);
    if (from <= businessDate()) throw new BadRequestException("Phiên bản kế tiếp phải hiệu lực từ ngày mai trở đi.");
    return this.write(async (db) => {
      const plan = await db.employeePayPlan.findUnique({ where: { id }, include: INCLUDE });
      if (!plan) throw new NotFoundException("Không tìm thấy phương án trả lương.");
      await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${plan.employeeId}, 8210523))::text`;
      if (plan.revision !== dto.revision) throw new ConflictException("Bản ghi đã thay đổi; hãy tải lại trước khi thử lại.");
      const orgUnitId = await this.intervalAccess(user, plan.employeeId, from, to ?? OPEN, "payroll.components.manage", db);
      const lines = this.lines(dto);
      await this.validateComposition(db, orgUnitId, dto, from, to, lines);
      const previous = plan.versions[0];
      if (!previous || from <= previous.effectiveFrom) throw new ConflictException("Phiên bản kế tiếp phải sau phiên bản mới nhất.");
      if (!previous.effectiveTo || previous.effectiveTo >= from) {
        await this.intervalAccess(user, plan.employeeId, from, previous.effectiveTo ?? OPEN, "payroll.components.manage", db);
        await db.employeePayPlanVersion.update({ where: { id: previous.id }, data: { effectiveTo: previousDay(from) } });
      }
      await db.employeePayPlanVersion.create({ data: { payPlanId: id, ...this.versionData(dto, from, to, lines, user.id) } });
      const updated = await db.employeePayPlan.update({ where: { id }, data: { revision: { increment: 1 } }, include: INCLUDE });
      await this.audit.record({ actorId: user.id, entityType: "EmployeePayPlan", entityId: id, action: "CREATE_VERSION", result: "SUCCESS", oldValue: { revision: plan.revision }, newValue: { revision: updated.revision, effectiveFrom: dateText(from) }, ipAddress }, db);
      return { item: this.view(updated, from, await this.employeeUnit(updated.employeeId, from, db), true) };
    });
  }
}
