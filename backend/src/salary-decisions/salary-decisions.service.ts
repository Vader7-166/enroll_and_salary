import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, SalaryBasis } from "@prisma/client";
import Decimal from "decimal.js";
import { AuditService } from "../audit/audit.service";
import { businessDate } from "../auth/business-date";
import type { AuthUser } from "../auth/auth.types";
import { cipherText, plainText } from "../common/data-crypto";
import { PrismaService } from "../database/prisma.service";
import { PayrollSourceEvents } from "../payroll-events/payroll-source-events.service";
import { effectiveAt, ScopeService } from "../organization/scope.service";
import { crossRegionDecrease, key, salaryTimeline, unitSegments } from "./salary-timeline";
import type { CreateSalaryDecisionDto, RetroCandidateActionDto, RetroCandidateQueryDto } from "./salary-decisions.dto";

type Db = Prisma.TransactionClient;
const DAY = 86_400_000;
const MONEY = /^(?:0|[1-9]\d{0,14})(?:\.\d{1,2})?$/;

function date(value: string, label: string): Date {
  const parsed = new Date(value + "T00:00:00.000Z");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(parsed.getTime()) || key(parsed) !== value) throw new BadRequestException(label + " không hợp lệ.");
  return parsed;
}
function fail(kind: "conflict" | "bad", code: string, message: string, details?: Record<string, unknown>): never {
  const body = { code, message, ...(details ? { details } : {}) };
  throw kind === "conflict" ? new ConflictException(body) : new BadRequestException(body);
}

@Injectable()
export class SalaryDecisionsService {
  private readonly key: Buffer;
  constructor(private readonly prisma: PrismaService, private readonly scope: ScopeService, private readonly audit: AuditService, private readonly events: PayrollSourceEvents, config: ConfigService) {
    this.key = Buffer.from(config.getOrThrow<string>("HR_DATA_KEY"), "base64");
  }

  private async assertEmployee(user: AuthUser, permission: "contract.read" | "contract.manage", employeeId: string, db: Db = this.prisma, ip?: string) {
    if (!user.roles.includes("KT")) throw new ForbiddenException("Chỉ KT được xem hoặc lập quyết định lương.");
    const scope = await this.scope.load(user, permission, db);
    const today = businessDate();
    const employee = await db.employee.findFirst({ where: { id: employeeId, assignments: { some: { ...effectiveAt(today), orgUnitId: { in: [...scope.allowed] } } }, exclusions: { none: { userAccountId: user.id, ...effectiveAt(today) } } }, select: { id: true, code: true, fullName: true } });
    if (!employee) {
      await this.audit.record({ actorId: user.id, entityType: "salary_decision", entityId: employeeId, action: "ACCESS_DENIED", result: "DENIED", newValue: { permission }, ipAddress: ip });
      throw new ForbiddenException("Nhân viên nằm ngoài phạm vi được phân quyền.");
    }
    return employee;
  }

  /** Regional monthly minimum at a date (BR-06) for the employee's primary unit. */
  private async regionalMinimum(db: Db, employeeId: string, day: Date) {
    const assignment = await db.orgAssignment.findFirst({ where: { employeeId, isPrimary: true, ...effectiveAt(day) }, orderBy: { effectiveFrom: "desc" } });
    if (!assignment) fail("bad", "ASSIGNMENT_MISSING", "Nhân viên không có đơn vị chính tại ngày hiệu lực.");
    const version = await db.orgUnitVersion.findFirst({ where: { orgUnitId: assignment!.orgUnitId, ...effectiveAt(day) }, include: { site: true } });
    if (!version?.site) fail("bad", "REGION_UNKNOWN", "Không xác định được vùng lương tại ngày hiệu lực.");
    const scopes = ["SITE:" + version!.site!.id, "REGION:" + version!.site!.wageRegionCode, "GLOBAL"];
    const rows = await db.legalParameter.findMany({ where: { paramCode: "MIN_WAGE_MONTH_" + version!.site!.wageRegionCode, subjectType: "ALL", applicationBasis: "WORK_DATE", scopeKey: { in: scopes }, ...effectiveAt(day) } });
    const row = scopes.map(scope => rows.find(item => item.scopeKey === scope)).find(Boolean);
    return row ? { region: version!.site!.wageRegionCode, amount: new Decimal(String(row.value)) } : null;
  }

  /** Payroll periods already LOCKED at any site the employee belonged to from the effective date on. */
  private async lockedPeriodsFrom(db: Db, employeeId: string, effectiveFrom: Date) {
    const periods = await db.payrollPeriod.findMany({ where: { status: "LOCKED", dateTo: { gte: effectiveFrom } }, orderBy: { dateFrom: "asc" } });
    if (!periods.length) return [];
    const last = new Date(Math.max(...periods.map(period => period.dateTo.getTime())));
    const sites = new Set((await unitSegments(db, employeeId, effectiveFrom, last)).map(segment => segment.siteOrgUnitId).filter(Boolean));
    return periods.filter(period => sites.has(period.siteOrgUnitId));
  }

  async create(user: AuthUser, employeeId: string, dto: CreateSalaryDecisionDto, ip?: string) {
    await this.assertEmployee(user, "contract.manage", employeeId, this.prisma, ip);
    const effectiveFrom = date(dto.effectiveFrom, "Ngày hiệu lực"), decisionDate = date(dto.decisionDate, "Ngày quyết định");
    if (!dto.lines.length) fail("bad", "SALARY_LINES_REQUIRED", "Quyết định phải có ít nhất một mức lương.");
    const seen = new Set<string>();
    for (const line of dto.lines) {
      const component = line.componentId ?? "";
      if (seen.has(component)) fail("bad", "SALARY_LINE_DUPLICATE", "Mỗi cấu phần chỉ có một mức trong quyết định.");
      seen.add(component);
      if (!MONEY.test(line.amount) || !new Decimal(line.amount).gt(0)) fail("bad", "SALARY_AMOUNT_INVALID", "Số tiền phải là số dương, tối đa 2 chữ số thập phân.");
    }
    return this.prisma.$transaction(async db => {
      await db.$queryRaw`SELECT id FROM employee WHERE id = ${employeeId}::uuid FOR UPDATE`;
      await this.assertEmployee(user, "contract.manage", employeeId, db, ip);
      const agreed = dto.lines.find(line => !line.componentId);
      if (agreed && agreed.salaryBasis === SalaryBasis.MONTHLY) {
        const minimum = await this.regionalMinimum(db, employeeId, effectiveFrom);
        if (minimum && new Decimal(agreed.amount).lt(minimum.amount)) fail("bad", "BELOW_REGIONAL_MINIMUM", `Lương thỏa thuận thấp hơn mức tối thiểu vùng ${minimum.region} (${minimum.amount.toFixed()}).`);
      }
      for (const line of dto.lines) {
        if (!line.componentId) continue;
        const component = await db.salaryComponent.findUnique({ where: { id: line.componentId }, include: { versions: { where: effectiveAt(effectiveFrom) } } });
        if (!component || !component.versions.some(version => version.active && version.componentType === "EARNING")) fail("bad", "SALARY_COMPONENT_INVALID", "Cấu phần phải là khoản thu nhập đang hoạt động tại ngày hiệu lực.");
      }
      const existing = await db.employeeSalary.findMany({ where: { employeeId }, include: { decision: { select: { decisionNumber: true } } } });
      for (const line of dto.lines) {
        const same = existing.filter(row => row.componentId === (line.componentId ?? null));
        const duplicate = same.find(row => key(row.effectiveFrom) === key(effectiveFrom));
        if (duplicate) fail("conflict", "SALARY_DECISION_DUPLICATE_DATE", `Đã có quyết định ${duplicate.decision.decisionNumber} cho cấu phần này cùng ngày hiệu lực.`, { decisionId: duplicate.decisionId, decisionNumber: duplicate.decision.decisionNumber });
        const later = same.find(row => row.effectiveFrom > effectiveFrom);
        if (later) fail("conflict", "SALARY_DECISION_OUT_OF_ORDER", `Đã có quyết định ${later.decision.decisionNumber} hiệu lực sau ngày này; lập quyết định mới sau ngày ${key(later.effectiveFrom)}.`, { decisionId: later.decisionId });
      }
      // BR-08: a same-day cross-region transfer combined with a lower agreed salary needs an explicit reason.
      const warnings: Array<Record<string, unknown>> = [];
      const transfer = await db.personnelTransfer.findFirst({ where: { employeeId, effectiveFrom } });
      if (transfer && agreed) {
        const warning = await crossRegionDecrease(db, this.key, { employeeId, day: effectiveFrom, fromOrgUnitId: transfer.fromOrgUnitId, toOrgUnitId: transfer.toOrgUnitId, newAgreedAmount: agreed.amount });
        if (warning) warnings.push(warning);
      }
      const acknowledgement = dto.warningAcknowledgement?.trim() || null;
      if (warnings.length && !acknowledgement) fail("conflict", "CROSS_REGION_SALARY_DECREASE", "Điều chuyển sang vùng lương thấp hơn kèm giảm lương thỏa thuận (BR-08); nhập lý do xác nhận để lưu.", { warnings });
      const decision = await db.salaryDecision.create({ data: { employeeId, decisionNumber: dto.decisionNumber.trim(), decisionDate, effectiveFrom, reason: dto.reason.trim(), legalBasis: dto.legalBasis.trim(), warnings: warnings as Prisma.InputJsonValue, warningAcknowledgement: warnings.length ? acknowledgement : null, createdById: user.id } });
      for (const line of dto.lines) {
        const open = existing.find(row => row.componentId === (line.componentId ?? null) && row.effectiveTo === null && row.effectiveFrom < effectiveFrom);
        if (open) await db.employeeSalary.update({ where: { id: open.id }, data: { effectiveTo: new Date(effectiveFrom.getTime() - DAY) } });
        await db.employeeSalary.create({ data: { employeeId, decisionId: decision.id, componentId: line.componentId ?? null, amountCipher: cipherText(this.key, new Decimal(line.amount).toFixed(2)), salaryBasis: line.salaryBasis, effectiveFrom } });
      }
      await this.events.changed(db, { employeeIds: [employeeId], source: "SALARY_DECISION", reason: "Quyết định " + decision.decisionNumber, actorId: user.id });
      const locked = await this.lockedPeriodsFrom(db, employeeId, effectiveFrom);
      if (locked.length) await db.retroCandidate.createMany({ data: locked.map(period => ({ decisionId: decision.id, employeeId, payrollPeriodId: period.id })) });
      await this.audit.record({ actorId: user.id, entityType: "salary_decision", entityId: decision.id, action: "CREATE", result: "SUCCESS", newValue: { employeeId, decisionNumber: decision.decisionNumber, effectiveFrom: dto.effectiveFrom, components: dto.lines.map(line => line.componentId ?? "AGREED"), warnings: warnings.map(item => item.code as string), acknowledgement: warnings.length ? acknowledgement : null, retroPeriods: locked.map(period => period.code) }, ipAddress: ip }, db);
      return { decision: { id: decision.id, decisionNumber: decision.decisionNumber, effectiveFrom: dto.effectiveFrom }, warnings, retroCandidates: locked.map(period => ({ payrollPeriodId: period.id, code: period.code, dateFrom: key(period.dateFrom), dateTo: key(period.dateTo) })) };
    }, { isolationLevel: "Serializable" }).catch(error => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") fail("conflict", "SALARY_DECISION_NUMBER_EXISTS", "Số quyết định đã tồn tại cho nhân viên này.");
      throw error;
    });
  }

  async list(user: AuthUser, employeeId: string) {
    const employee = await this.assertEmployee(user, "contract.read", employeeId);
    const decisions = await this.prisma.salaryDecision.findMany({ where: { employeeId }, include: { lines: true, createdBy: { select: { id: true, displayName: true } }, retroCandidates: { include: { payrollPeriod: { select: { code: true } } } } }, orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }] });
    const components = await this.prisma.salaryComponent.findMany({ where: { id: { in: decisions.flatMap(item => item.lines.map(line => line.componentId)).filter((id): id is string => !!id) } }, include: { versions: { orderBy: { effectiveFrom: "desc" }, take: 1 } } });
    const names = new Map(components.map(component => [component.id, { code: component.code, name: component.versions[0]?.name ?? component.code }]));
    return {
      employee,
      items: decisions.map(decision => ({
        id: decision.id, decisionNumber: decision.decisionNumber, decisionDate: key(decision.decisionDate), effectiveFrom: key(decision.effectiveFrom), reason: decision.reason, legalBasis: decision.legalBasis,
        warnings: decision.warnings, warningAcknowledgement: decision.warningAcknowledgement, createdBy: decision.createdBy, createdAt: decision.createdAt.toISOString(),
        lines: decision.lines.map(line => ({ componentId: line.componentId, componentCode: line.componentId ? names.get(line.componentId)?.code ?? null : null, componentName: line.componentId ? names.get(line.componentId)?.name ?? "Cấu phần" : "Lương thỏa thuận", amount: plainText(this.key, line.amountCipher, "lương"), salaryBasis: line.salaryBasis, effectiveFrom: key(line.effectiveFrom), effectiveTo: line.effectiveTo ? key(line.effectiveTo) : null })),
        retroCandidates: decision.retroCandidates.map(item => ({ id: item.id, payrollPeriodCode: item.payrollPeriod.code, status: item.status })),
      })),
    };
  }

  async timeline(user: AuthUser, employeeId: string, fromText: string, toText: string) {
    await this.assertEmployee(user, "contract.read", employeeId);
    const from = date(fromText, "Từ ngày"), to = date(toText, "Đến ngày");
    if (to < from || to.getTime() - from.getTime() > 3 * 366 * DAY) fail("bad", "RANGE_INVALID", "Khoảng ngày phải hợp lệ và không quá 3 năm.");
    return { from: fromText, to: toText, segments: await salaryTimeline(this.prisma, this.key, employeeId, from, to), units: await unitSegments(this.prisma, employeeId, from, to) };
  }

  /** Timeline for server-side consumers (payroll engine); scope is checked by the caller. */
  timelineFor(db: Db, employeeId: string, from: Date, to: Date) { return salaryTimeline(db, this.key, employeeId, from, to); }
  unitsFor(db: Db, employeeId: string, from: Date, to: Date) { return unitSegments(db, employeeId, from, to); }

  async retroCandidates(user: AuthUser, query: RetroCandidateQueryDto) {
    if (!user.roles.includes("KT")) throw new ForbiddenException("Chỉ KT được xem ứng viên hồi tố.");
    const scope = await this.scope.load(user, "contract.read");
    const today = businessDate();
    const rows = await this.prisma.retroCandidate.findMany({
      where: { ...(query.status ? { status: query.status } : {}), employee: { assignments: { some: { ...effectiveAt(today), orgUnitId: { in: [...scope.allowed] } } }, exclusions: { none: { userAccountId: user.id, ...effectiveAt(today) } } } },
      include: { employee: { select: { id: true, code: true, fullName: true } }, decision: { select: { id: true, decisionNumber: true, effectiveFrom: true } }, payrollPeriod: { select: { id: true, code: true, dateFrom: true, dateTo: true } }, resolvedBy: { select: { id: true, displayName: true } } },
      orderBy: [{ createdAt: "desc" }],
    });
    return { items: rows.map(row => ({ id: row.id, status: row.status, note: row.note, employee: row.employee, decision: { ...row.decision, effectiveFrom: key(row.decision.effectiveFrom) }, payrollPeriod: { ...row.payrollPeriod, dateFrom: key(row.payrollPeriod.dateFrom), dateTo: key(row.payrollPeriod.dateTo) }, resolvedBy: row.resolvedBy, resolvedAt: row.resolvedAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString() })) };
  }

  async dismissRetroCandidate(user: AuthUser, id: string, dto: RetroCandidateActionDto, ip?: string) {
    return this.prisma.$transaction(async db => {
      const row = await db.retroCandidate.findUnique({ where: { id } });
      if (!row) throw new NotFoundException("Không tìm thấy ứng viên hồi tố.");
      await this.assertEmployee(user, "contract.manage", row.employeeId, db, ip);
      if (row.status !== "PENDING") fail("conflict", "RETRO_ALREADY_HANDLED", "Ứng viên hồi tố đã được xử lý.");
      const updated = await db.retroCandidate.update({ where: { id }, data: { status: "DISMISSED", note: dto.note.trim(), resolvedById: user.id, resolvedAt: new Date() } });
      await this.audit.record({ actorId: user.id, entityType: "retro_candidate", entityId: id, action: "DISMISS", result: "SUCCESS", newValue: { note: updated.note }, ipAddress: ip }, db);
      return { id, status: updated.status };
    });
  }
}
