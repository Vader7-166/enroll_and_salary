import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  ApplicationBasis,
  BusinessPeriod,
  BusinessPeriodStatus,
  BusinessPeriodType,
  LegalParameter,
  Prisma,
  SitePolicy,
  SitePolicyKey,
} from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import type { AuthUser } from "../auth/auth.types";
 import { holidayCalendar } from "../leave/holiday-calendar";
 import { businessDate } from "../auth/business-date";
import { PrismaService } from "../database/prisma.service";
import { effectiveAt, ScopeService } from "../organization/scope.service";
import {
  CreateParameterDto,
  CreatePeriodDto,
  CreatePolicyDto,
  OpenPeriodDto,
  ParameterQueryDto,
  PeriodPreviewQueryDto,
  PolicyQueryDto,
  ResolvePolicyQueryDto,
} from "./settings.dto";

type Db = Prisma.TransactionClient;
type Scope = Awaited<ReturnType<ScopeService["load"]>>;

const SEEDED_NUMERIC_CODES = new Set([
  "MIN_WAGE_MONTH_I", "MIN_WAGE_MONTH_II", "MIN_WAGE_MONTH_III", "MIN_WAGE_MONTH_IV",
  "MIN_WAGE_HOUR_I", "MIN_WAGE_HOUR_II", "MIN_WAGE_HOUR_III", "MIN_WAGE_HOUR_IV",
  "PROBATION_MIN_RATIO", "PROBATION_MAX_DAYS_TECHNICAL", "PROBATION_MAX_DAYS_WORKER",
  "FIXED_TERM_MIN_MONTHS", "FIXED_TERM_MAX_MONTHS", "FIXED_TERM_MAX_COUNT",
  "INSURANCE_MIN_CONTRACT_MONTHS",
]);
const SEEDED_INTEGER_CODES = new Set([
  "PROBATION_MAX_DAYS_TECHNICAL", "PROBATION_MAX_DAYS_WORKER",
  "FIXED_TERM_MIN_MONTHS", "FIXED_TERM_MAX_MONTHS", "FIXED_TERM_MAX_COUNT",
  "INSURANCE_MIN_CONTRACT_MONTHS",
]);

function parseDate(value: string, label = "Ngày"): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException(`${label} không hợp lệ.`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value)
    throw new BadRequestException(`${label} không hợp lệ.`);
  return date;
}
function dateText(value: Date): string { return value.toISOString().slice(0, 10); }
function previousDay(value: Date): Date { const result = new Date(value); result.setUTCDate(result.getUTCDate() - 1); return result; }
function isJsonValue(value: unknown): value is Prisma.InputJsonValue {
  if (value === null) return false;
  if (typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return typeof value === "object" && Object.values(value as Record<string, unknown>).every(isJsonValue);
}
function numericString(value: unknown): boolean {
  return typeof value === "string" && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) && Number(value) > 0;
}
function assertParameterValue(paramCode: string, value: unknown): asserts value is Prisma.InputJsonValue {
   if (!isJsonValue(value)) throw new BadRequestException("Giá trị tham số phải là JSON hợp lệ, không rỗng.");
   if (paramCode === "HOLIDAY_CALENDAR") holidayCalendar(value);
  if (SEEDED_NUMERIC_CODES.has(paramCode) && !numericString(value))
    throw new BadRequestException("Giá trị tham số đã seed phải là chuỗi số dương.");
  if (SEEDED_INTEGER_CODES.has(paramCode) && !(typeof value === "string" && /^[1-9]\d*$/.test(value)))
    throw new BadRequestException("Giá trị tham số ngày, tháng hoặc số lần phải là số nguyên dương.");
  if (paramCode === "PROBATION_MIN_RATIO" && typeof value === "string" && Number(value) > 1)
    throw new BadRequestException("Tỷ lệ lương thử việc không được vượt quá 1.");
}
function assertValidScopeKey(value: string): void {
  if (!/^(GLOBAL|REGION:(I|II|III|IV)|SITE:[0-9a-fA-F-]{36})$/.test(value))
    throw new BadRequestException("Phạm vi tham số không hợp lệ.");
}
function parseMonth(value: string): Date {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new BadRequestException("Tháng không hợp lệ.");
  return new Date(`${value}-01T00:00:00.000Z`);
}
function endOfMonth(monthStart: Date): Date { return new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0)); }
function cutoffDate(monthStart: Date, cutoffDay: number): Date {
  return new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), Math.min(cutoffDay, endOfMonth(monthStart).getUTCDate())));
}
function coversPeriodScope(versions: Array<{ orgUnitId: string; parentId: string | null }>, allowed: Set<string>, targetOrgUnitId: string): boolean {
  const parentByUnit = new Map(versions.map((version) => [version.orgUnitId, version.parentId]));
  for (const allowedUnitId of allowed) {
    const seen = new Set<string>();
    let cursor: string | null | undefined = allowedUnitId;
    while (cursor && !seen.has(cursor)) {
      if (cursor === targetOrgUnitId) return true;
      seen.add(cursor);
      cursor = parentByUnit.get(cursor);
    }
  }
  return false;
}
function serializeParameter(parameter: LegalParameter) {
  return { id: parameter.id, paramCode: parameter.paramCode, scopeKey: parameter.scopeKey, subjectType: parameter.subjectType,
    applicationBasis: parameter.applicationBasis, value: parameter.value, unit: parameter.unit,
    effectiveFrom: dateText(parameter.effectiveFrom), effectiveTo: parameter.effectiveTo ? dateText(parameter.effectiveTo) : null,
    documentEffectiveDate: dateText(parameter.documentEffectiveDate), legalBasis: parameter.legalBasis };
}
function serializePolicy(policy: SitePolicy) {
  return { id: policy.id, orgUnitId: policy.orgUnitId, policyKey: policy.policyKey, value: policy.value, status: policy.status,
    decisionReference: policy.decisionReference, effectiveFrom: dateText(policy.effectiveFrom), effectiveTo: policy.effectiveTo ? dateText(policy.effectiveTo) : null };
}
function serializePeriod(period: BusinessPeriod, scopeOrgUnitName: string) {
  return { id: period.id, code: period.code, periodType: period.periodType, scopeOrgUnitId: period.scopeOrgUnitId, scopeOrgUnitName,
    dateFrom: dateText(period.dateFrom), dateTo: dateText(period.dateTo), cutoffDay: period.cutoffDay, cutoffPolicyId: period.cutoffPolicyId,
    status: period.status, revision: period.revision, openedAt: period.openedAt?.toISOString() ?? null };
}

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService, private readonly scope: ScopeService, private readonly audit: AuditService) {}

  private managementScope(user: AuthUser, db: Db = this.prisma) { return this.scope.load(user, "settings.manage", db); }
  private async settingsScope(user: AuthUser, asOf: Date, db: Db = this.prisma) {
    const [current, dated] = await Promise.all([this.scope.load(user, "settings.manage", db), this.scope.load(user, "settings.manage", db, asOf)]);
    return { current, dated };
  }
  private visibleParameterScope(scope: { current: Scope; dated: Scope }, scopeKey: string): boolean {
    if (!scopeKey.startsWith("SITE:")) return true;
    const siteId = scopeKey.slice(5);
    return scope.current.versions.some((version) => version.siteId === siteId) && scope.dated.versions.some((version) => version.siteId === siteId);
  }
  private writableParameterScope(scope: { current: Scope; dated: Scope }, scopeKey: string): boolean {
    if (scopeKey.startsWith("SITE:")) return this.visibleParameterScope(scope, scopeKey);
    return scope.current.versions.some((version) => version.type === "COMPANY") && scope.dated.versions.some((version) => version.type === "COMPANY");
  }
  private async periodScope(user: AuthUser, permission: "period.read" | "period.manage", asOf: Date, db: Db = this.prisma) {
    const [current, dated] = await Promise.all([this.scope.load(user, permission, db), this.scope.load(user, permission, db, asOf)]);
    return { current, dated };
  }
  private assertVisibleInBoth(scope: { current: Scope; dated: Scope }, orgUnitId: string) {
    if (!scope.current.allowed.has(orgUnitId) || !scope.dated.allowed.has(orgUnitId))
      throw new ForbiddenException("Bạn không có quyền truy cập đơn vị ở ngày yêu cầu.");
  }
  private async assertScopeKeyExists(scopeKey: string, db: Db): Promise<void> {
    assertValidScopeKey(scopeKey);
    if (!scopeKey.startsWith("SITE:")) return;
    const site = await db.site.findUnique({ where: { id: scopeKey.slice(5) }, select: { id: true } });
    if (!site) throw new BadRequestException("Cơ sở trong phạm vi tham số không tồn tại.");
  }

  async listParameters(user: AuthUser, query: ParameterQueryDto) {
    const asOf = query.asOf ? parseDate(query.asOf) : businessDate();
    const scope = await this.settingsScope(user, asOf);
    if (query.scopeKey) assertValidScopeKey(query.scopeKey);
    const items = await this.prisma.legalParameter.findMany({
      where: { ...(query.paramCode ? { paramCode: query.paramCode } : {}), ...(query.scopeKey ? { scopeKey: query.scopeKey } : {}), ...effectiveAt(asOf) },
      orderBy: [{ paramCode: "asc" }, { scopeKey: "asc" }, { subjectType: "asc" }, { applicationBasis: "asc" }, { effectiveFrom: "desc" }],
    });
    return { items: items.filter((item) => this.visibleParameterScope(scope, item.scopeKey)).map(serializeParameter) };
  }

  async createParameter(user: AuthUser, dto: CreateParameterDto, ipAddress?: string) {
    const effectiveFrom = parseDate(dto.effectiveFrom, "Ngày hiệu lực");
    const effectiveTo = dto.effectiveTo ? parseDate(dto.effectiveTo, "Ngày hết hiệu lực") : null;
    const documentEffectiveDate = parseDate(dto.documentEffectiveDate, "Ngày hiệu lực văn bản");
    if (effectiveTo && effectiveTo < effectiveFrom) throw new BadRequestException("Ngày hết hiệu lực phải từ ngày hiệu lực trở đi.");
    assertParameterValue(dto.paramCode, dto.value);
    const value: Prisma.InputJsonValue = dto.value;
    return this.prisma.$transaction(async (db) => {
      await db.$queryRaw`SELECT pg_advisory_xact_lock(8210473)::text AS lock`;
      await this.managementScope(user, db);
      await this.assertScopeKeyExists(dto.scopeKey, db);
      const scope = await this.settingsScope(user, effectiveFrom, db);
      if (!this.writableParameterScope(scope, dto.scopeKey))
        throw new ForbiddenException("Bạn không có quyền thay đổi phạm vi tham số ở ngày yêu cầu.");
      const key = { paramCode: dto.paramCode, scopeKey: dto.scopeKey, subjectType: dto.subjectType, applicationBasis: dto.applicationBasis };
      const versions = await db.legalParameter.findMany({ where: key, orderBy: { effectiveFrom: "desc" } });
      const latest = versions[0];
      if (latest && effectiveFrom <= latest.effectiveFrom) throw new ConflictException("Phiên bản mới phải có ngày hiệu lực sau phiên bản hiện có.");
      if (versions.some((version) => !(version.id === latest?.id && latest?.effectiveTo === null) && version.effectiveFrom <= (effectiveTo ?? new Date("9999-12-31T00:00:00.000Z")) && (version.effectiveTo === null || version.effectiveTo >= effectiveFrom)))
        throw new ConflictException("Khoảng hiệu lực tham số bị chồng lấn.");
      // Closing an open predecessor also changes its tail beyond a bounded new version.
      const affectedTo = latest?.effectiveTo === null ? null : effectiveTo;
      const frozenPeriods = await db.businessPeriod.findMany({
        where: {
          periodType: BusinessPeriodType.ATTENDANCE,
          status: { in: [BusinessPeriodStatus.CLOSED, BusinessPeriodStatus.LOCKED] },
          dateTo: { gte: effectiveFrom }, ...(affectedTo ? { dateFrom: { lte: affectedTo } } : {}),
        },
        select: { scopeOrgUnitId: true, dateFrom: true, dateTo: true },
      });
      for (const period of frozenPeriods) {
        const from = new Date(Math.max(effectiveFrom.getTime(), period.dateFrom.getTime()));
        const to = new Date(Math.min(affectedTo?.getTime() ?? period.dateTo.getTime(), period.dateTo.getTime()));
        const matchingUnit = dto.scopeKey === "GLOBAL" || await db.orgUnitVersion.findFirst({
          where: {
            orgUnitId: period.scopeOrgUnitId, effectiveFrom: { lte: to },
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }],
            ...(dto.scopeKey.startsWith("SITE:") ? { siteId: dto.scopeKey.slice(5) } : { site: { is: { wageRegionCode: dto.scopeKey.slice(7) } } }),
          },
          select: { id: true },
        });
        if (matchingUnit) throw new ConflictException("Không thể thay đổi tham số ảnh hưởng kỳ đã chốt hoặc khóa.");
      }
      if (latest?.effectiveTo === null) await db.legalParameter.update({ where: { id: latest.id }, data: { effectiveTo: previousDay(effectiveFrom) } });
      const parameter = await db.legalParameter.create({ data: { ...key, value, unit: dto.unit, effectiveFrom, effectiveTo, documentEffectiveDate, legalBasis: dto.legalBasis } });
      await this.audit.record({ actorId: user.id, entityType: "LegalParameter", entityId: parameter.id, action: "CREATE_VERSION", result: "SUCCESS", newValue: serializeParameter(parameter), ipAddress }, db);
      return { parameter: serializeParameter(parameter) };
    });
  }

  async listPolicies(user: AuthUser, query: PolicyQueryDto) {
    const asOf = query.asOf ? parseDate(query.asOf) : businessDate();
    const scope = await this.settingsScope(user, asOf);
    const allowed = [...scope.current.allowed].filter((id) => scope.dated.allowed.has(id));
    if (query.orgUnitId && !allowed.includes(query.orgUnitId)) throw new ForbiddenException("Bạn không có quyền truy cập đơn vị ở ngày yêu cầu.");
    const items = await this.prisma.sitePolicy.findMany({ where: { orgUnitId: query.orgUnitId ?? { in: allowed }, ...effectiveAt(asOf) }, orderBy: [{ orgUnitId: "asc" }, { policyKey: "asc" }, { effectiveFrom: "desc" }] });
    return { items: items.map(serializePolicy) };
  }

  private async resolvePolicy(db: Db, orgUnitId: string, asOf: Date, policyKey: SitePolicyKey) {
    const versions = await db.orgUnitVersion.findMany({ where: effectiveAt(asOf), select: { orgUnitId: true, parentId: true } });
    const byId = new Map(versions.map((version) => [version.orgUnitId, version]));
    const chain: string[] = [], seen = new Set<string>();
    let cursor = orgUnitId;
    while (cursor) {
      if (seen.has(cursor)) throw new BadRequestException("Cây đơn vị không hợp lệ.");
      seen.add(cursor);
      const version = byId.get(cursor);
      if (!version) throw new NotFoundException("Đơn vị không tồn tại ở ngày yêu cầu.");
      chain.push(cursor); cursor = version.parentId ?? "";
    }
    const policies = await db.sitePolicy.findMany({ where: { orgUnitId: { in: chain }, policyKey, ...effectiveAt(asOf) } });
    const policyByUnit = new Map(policies.map((policy) => [policy.orgUnitId, policy]));
    for (const unitId of chain) { const policy = policyByUnit.get(unitId); if (policy) return policy; }
    throw new NotFoundException("Không tìm thấy chính sách hiệu lực cho đơn vị.");
  }

  async resolvePolicyForUser(user: AuthUser, query: ResolvePolicyQueryDto) {
    const asOf = parseDate(query.asOf);
    const scope = await this.settingsScope(user, asOf);
    this.assertVisibleInBoth(scope, query.orgUnitId);
    const policy = await this.resolvePolicy(this.prisma, query.orgUnitId, asOf, query.policyKey);
    return { value: policy.value, sourceOrgUnitId: policy.orgUnitId, sourcePolicyId: policy.id, status: policy.status, decisionReference: policy.decisionReference };
  }

  async createPolicy(user: AuthUser, dto: CreatePolicyDto, ipAddress?: string) {
    const effectiveFrom = parseDate(dto.effectiveFrom, "Ngày hiệu lực");
    const effectiveTo = dto.effectiveTo ? parseDate(dto.effectiveTo, "Ngày hết hiệu lực") : null;
    if (effectiveTo && effectiveTo < effectiveFrom) throw new BadRequestException("Ngày hết hiệu lực phải từ ngày hiệu lực trở đi.");
    return this.prisma.$transaction(async (db) => {
      await db.$queryRaw`SELECT pg_advisory_xact_lock(8210474)::text AS lock`;
      await this.managementScope(user, db);
      const scope = await this.periodScope(user, "period.manage", effectiveFrom, db);
      this.assertVisibleInBoth(scope, dto.orgUnitId);
      const unit = scope.dated.versions.find((version) => version.orgUnitId === dto.orgUnitId);
      if (!unit || unit.type === "COMPANY" || !unit.siteId) throw new BadRequestException("Chính sách chỉ áp dụng đơn vị không phải công ty có cơ sở.");
      const versions = await db.sitePolicy.findMany({ where: { orgUnitId: dto.orgUnitId, policyKey: dto.policyKey }, orderBy: { effectiveFrom: "desc" } });
      const latest = versions[0];
      if (latest && effectiveFrom <= latest.effectiveFrom) throw new ConflictException("Phiên bản mới phải có ngày hiệu lực sau phiên bản hiện có.");
      if (versions.some((version) => !(version.id === latest?.id && latest?.effectiveTo === null) && version.effectiveFrom <= (effectiveTo ?? new Date("9999-12-31T00:00:00.000Z")) && (version.effectiveTo === null || version.effectiveTo >= effectiveFrom)))
        throw new ConflictException("Khoảng hiệu lực chính sách bị chồng lấn.");
      if (latest?.effectiveTo === null) await db.sitePolicy.update({ where: { id: latest.id }, data: { effectiveTo: previousDay(effectiveFrom) } });
      const policy = await db.sitePolicy.create({ data: { orgUnitId: dto.orgUnitId, policyKey: dto.policyKey, value: dto.value, status: dto.status, decisionReference: dto.decisionReference, effectiveFrom, effectiveTo } });
      await this.audit.record({ actorId: user.id, entityType: "SitePolicy", entityId: policy.id, action: "CREATE_VERSION", result: "SUCCESS", newValue: serializePolicy(policy), ipAddress }, db);
      return { policy: serializePolicy(policy) };
    });
  }

  private async assertPeriodTarget(user: AuthUser, permission: "period.read" | "period.manage", orgUnitId: string, asOf: Date, db: Db) {
    const scope = await this.periodScope(user, permission, asOf, db);
    this.assertVisibleInBoth(scope, orgUnitId);
    const version = scope.dated.versions.find((item) => item.orgUnitId === orgUnitId);
    if (!version || version.type === "COMPANY" || !version.siteId) throw new BadRequestException("Kỳ công chỉ áp dụng đơn vị không phải công ty có cơ sở.");
    return version;
  }

  private async assertPeriodRange(user: AuthUser, orgUnitId: string, dateFrom: Date, dateTo: Date, db: Db) {
    const start = await this.assertPeriodTarget(user, "period.manage", orgUnitId, dateFrom, db);
    const versions = await db.orgUnitVersion.findMany({
      where: { effectiveFrom: { lte: dateTo }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: dateFrom } }] },
      select: { effectiveFrom: true, effectiveTo: true },
    });
    // Scope can change inside the period, even if both endpoints are valid.
    const checkpoints = new Set([dateTo.getTime()]);
    for (const version of versions) {
      const from = version.effectiveFrom.getTime();
      const afterEnd = version.effectiveTo ? version.effectiveTo.getTime() + 86_400_000 : null;
      if (from > dateFrom.getTime() && from <= dateTo.getTime()) checkpoints.add(from);
      if (afterEnd !== null && afterEnd > dateFrom.getTime() && afterEnd <= dateTo.getTime()) checkpoints.add(afterEnd);
    }
    for (const date of checkpoints) {
      if (date !== dateFrom.getTime()) await this.assertPeriodTarget(user, "period.manage", orgUnitId, new Date(date), db);
    }
    return start;
  }
  private async assertReadablePeriodTarget(user: AuthUser, orgUnitId: string, asOf: Date, db: Db) {
    const today = businessDate();
    const [scope, currentVersions, datedVersions] = await Promise.all([
      this.periodScope(user, "period.read", asOf, db),
      db.orgUnitVersion.findMany({ where: effectiveAt(today), select: { orgUnitId: true, parentId: true } }),
      db.orgUnitVersion.findMany({ where: effectiveAt(asOf), select: { orgUnitId: true, parentId: true, type: true, siteId: true } }),
    ]);
    const target = datedVersions.find((version) => version.orgUnitId === orgUnitId);
    if (!target || target.type === "COMPANY" || !target.siteId)
      throw new BadRequestException("Kỳ công chỉ áp dụng đơn vị không phải công ty có cơ sở.");
    if (!coversPeriodScope(currentVersions, scope.current.allowed, orgUnitId) || !coversPeriodScope(datedVersions, scope.dated.allowed, orgUnitId))
      throw new ForbiddenException("Bạn không có quyền truy cập đơn vị ở ngày yêu cầu.");
    return target;
  }
  private async periodPreview(db: Db, orgUnitId: string, month: Date) {
    const cutoffPolicy = await this.resolvePolicy(db, orgUnitId, month, SitePolicyKey.CUTOFF_DAY);
    const currentCutoff = cutoffDate(month, cutoffPolicy.value);
    const priorMonth = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() - 1, 1));
    const previousCutoff = cutoffDate(priorMonth, cutoffPolicy.value);
    return { dateFrom: new Date(previousCutoff.getTime() + 86_400_000), dateTo: currentCutoff, cutoffDay: cutoffPolicy.value,
      cutoffPolicyId: cutoffPolicy.id, sourceOrgUnitId: cutoffPolicy.orgUnitId, status: cutoffPolicy.status, decisionReference: cutoffPolicy.decisionReference };
  }
  async previewPeriod(user: AuthUser, query: PeriodPreviewQueryDto) {
    const month = parseMonth(query.month);
    await this.assertReadablePeriodTarget(user, query.scopeOrgUnitId, month, this.prisma);
    const preview = await this.periodPreview(this.prisma, query.scopeOrgUnitId, month);
    return { dateFrom: dateText(preview.dateFrom), dateTo: dateText(preview.dateTo), cutoffDay: preview.cutoffDay,
      cutoffPolicyId: preview.cutoffPolicyId, sourceOrgUnitId: preview.sourceOrgUnitId, status: preview.status, decisionReference: preview.decisionReference };
  }
  async createPeriod(user: AuthUser, dto: CreatePeriodDto, ipAddress?: string) {
    const month = parseMonth(dto.month);
    return this.prisma.$transaction(async (db) => {
      await db.$queryRaw`SELECT pg_advisory_xact_lock(8210472)::text AS lock`;
      await this.assertPeriodTarget(user, "period.manage", dto.scopeOrgUnitId, month, db);
      const preview = await this.periodPreview(db, dto.scopeOrgUnitId, month);
      if ((dto.dateFrom === undefined) !== (dto.dateTo === undefined)) throw new BadRequestException("Phải gửi đồng thời ngày bắt đầu và ngày kết thúc.");
      const dateFrom = dto.dateFrom ? parseDate(dto.dateFrom, "Ngày bắt đầu") : preview.dateFrom;
      const dateTo = dto.dateTo ? parseDate(dto.dateTo!, "Ngày kết thúc") : preview.dateTo;
      if (dateTo < dateFrom) throw new BadRequestException("Ngày kết thúc phải từ ngày bắt đầu trở đi.");
      const unit = await this.assertPeriodRange(user, dto.scopeOrgUnitId, dateFrom, dateTo, db);
      if (await db.businessPeriod.findFirst({ where: { code: dto.code }, select: { id: true } })) throw new ConflictException("Mã kỳ đã tồn tại.");
      const overlap = await db.businessPeriod.findFirst({ where: { periodType: BusinessPeriodType.ATTENDANCE, scopeOrgUnitId: dto.scopeOrgUnitId, dateFrom: { lte: dateTo }, dateTo: { gte: dateFrom } }, select: { id: true } });
      if (overlap) throw new ConflictException("Kỳ công cùng phạm vi bị chồng lấn ngày công.");
      const period = await db.businessPeriod.create({ data: { code: dto.code, periodType: BusinessPeriodType.ATTENDANCE, scopeOrgUnitId: dto.scopeOrgUnitId,
        dateFrom, dateTo, cutoffDay: preview.cutoffDay, cutoffPolicyId: preview.cutoffPolicyId, status: BusinessPeriodStatus.PLANNED } });
      await this.audit.record({ actorId: user.id, entityType: "BusinessPeriod", entityId: period.id, action: "CREATE", result: "SUCCESS", newValue: serializePeriod(period, unit.name), ipAddress }, db);
      return { period: serializePeriod(period, unit.name) };
    });
  }

  async listPeriods(user: AuthUser) {
    const today = businessDate();
    const [current, candidates, currentVersions] = await Promise.all([
      this.scope.load(user, "period.read"),
      this.prisma.businessPeriod.findMany({ orderBy: [{ dateFrom: "desc" }, { code: "asc" }] }),
      this.prisma.orgUnitVersion.findMany({ where: effectiveAt(today), select: { orgUnitId: true, parentId: true } }),
    ]);
    const dates = [...new Set(candidates.map((period) => dateText(period.dateFrom)))];
    const datedEntries = await Promise.all(dates.map(async (date) => {
      const asOf = parseDate(date);
      const [scope, versions] = await Promise.all([
        this.scope.load(user, "period.read", this.prisma, asOf),
        this.prisma.orgUnitVersion.findMany({ where: effectiveAt(asOf), select: { orgUnitId: true, parentId: true, name: true } }),
      ]);
      return [date, { scope, versions }] as const;
    }));
    const dated = new Map(datedEntries);
    return {
      items: candidates.filter((period) => {
        const atDate = dated.get(dateText(period.dateFrom));
        return Boolean(atDate) && coversPeriodScope(currentVersions, current.allowed, period.scopeOrgUnitId) && coversPeriodScope(atDate!.versions, atDate!.scope.allowed, period.scopeOrgUnitId);
      }).map((period) => serializePeriod(period, dated.get(dateText(period.dateFrom))!.versions.find((unit) => unit.orgUnitId === period.scopeOrgUnitId)!.name)),
    };
  }

  async openPeriod(user: AuthUser, id: string, dto: OpenPeriodDto, ipAddress?: string) {
    return this.prisma.$transaction(async (db) => {
      const existing = await db.businessPeriod.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException("Không tìm thấy kỳ công.");
      const unit = await this.assertPeriodRange(user, existing.scopeOrgUnitId, existing.dateFrom, existing.dateTo, db);
      const openedAt = new Date();
      const updated = await db.businessPeriod.updateMany({ where: { id, status: BusinessPeriodStatus.PLANNED, revision: dto.revision }, data: { status: BusinessPeriodStatus.OPEN, revision: { increment: 1 }, openedAt } });
      if (updated.count !== 1) throw new ConflictException("Kỳ công đã thay đổi hoặc không ở trạng thái lập kế hoạch.");
      const period = await db.businessPeriod.findUniqueOrThrow({ where: { id } });
      await this.audit.record({ actorId: user.id, entityType: "BusinessPeriod", entityId: period.id, action: "OPEN", result: "SUCCESS",
        oldValue: { status: existing.status, revision: existing.revision }, newValue: { status: period.status, revision: period.revision, openedAt: period.openedAt?.toISOString() }, ipAddress }, db);
      return { period: serializePeriod(period, unit.name) };
    });
  }

  async resolveLegalParameter(paramCode: string, subjectType: string, applicationBasis: ApplicationBasis, orgUnitId: string, asOf: Date, db: Db = this.prisma) {
    const version = await db.orgUnitVersion.findFirst({ where: { orgUnitId, ...effectiveAt(asOf) }, select: { siteId: true } });
    if (!version) throw new NotFoundException("Đơn vị không tồn tại ở ngày yêu cầu.");
    const scopes = ["GLOBAL"];
    if (version.siteId) {
      const site = await db.site.findUnique({ where: { id: version.siteId }, select: { wageRegionCode: true } });
      if (site) scopes.unshift(`SITE:${version.siteId}`, `REGION:${site.wageRegionCode}`);
    }
    const parameters = await db.legalParameter.findMany({ where: { paramCode, subjectType, applicationBasis, scopeKey: { in: scopes }, ...effectiveAt(asOf) } });
    for (const scopeKey of scopes) { const parameter = parameters.find((item) => item.scopeKey === scopeKey); if (parameter) return parameter; }
    return null;
  }
}
