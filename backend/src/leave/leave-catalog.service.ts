import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PolicyStatus, Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { businessDate } from "../auth/business-date";
import type { AuthUser } from "../auth/auth.types";
import { PrismaService } from "../database/prisma.service";
import { effectiveAt } from "../organization/scope.service";
import { LeaveAccessService, leaveDate, leaveDateText, type LeaveDb } from "./leave-access.service";
import { CreateLeavePolicyDto, CreateLeavePolicyVersionDto, CreateLeaveTypeDto, CreateLeaveTypeVersionDto, LeaveCatalogQueryDto, LeavePolicyVersionDto, LeaveTypeVersionDto } from "./leave-catalog.dto";

const typeInclude = { orgUnit: true, versions: { include: { createdBy: { select: { id: true, displayName: true } } }, orderBy: { effectiveFrom: "desc" as const } } } satisfies Prisma.LeaveTypeInclude;
const policyInclude = { orgUnit: true, versions: { include: { createdBy: { select: { id: true, displayName: true } } }, orderBy: { effectiveFrom: "desc" as const } } } satisfies Prisma.LeavePolicyInclude;
type TypeHeader = Prisma.LeaveTypeGetPayload<{ include: typeof typeInclude }>;
type PolicyHeader = Prisma.LeavePolicyGetPayload<{ include: typeof policyInclude }>;
const OPEN_ENDED = leaveDate("9999-12-31");

function previousDay(day: Date) { return new Date(day.getTime() - 86_400_000); }
function dateValue(value: string | undefined) { return value ? leaveDate(value) : undefined; }
function decimalText(value: Prisma.Decimal | null) { return value?.toFixed(2) ?? null; }
function typeVersionView(version: TypeHeader["versions"][number]) {
  return { id: version.id, name: version.name, active: version.active, isPaid: version.isPaid, countsAsWorkday: version.countsAsWorkday, deductsAnnualQuota: version.deductsAnnualQuota, siPaid: version.siPaid, requiresDocument: version.requiresDocument, maxDays: decimalText(version.maxDays), attendanceSymbol: version.attendanceSymbol, status: version.status, decisionReference: version.decisionReference, reason: version.reason, effectiveFrom: leaveDateText(version.effectiveFrom), effectiveTo: version.effectiveTo ? leaveDateText(version.effectiveTo) : null, createdAt: version.createdAt.toISOString(), createdBy: version.createdBy ? { id: version.createdBy.id, displayName: version.createdBy.displayName } : null };
}
function policyVersionView(version: PolicyHeader["versions"][number]) {
  return { id: version.id, name: version.name, normalDays: version.normalDays, hazardousDays: version.hazardousDays, extremeDays: version.extremeDays, carryLimitDays: decimalText(version.carryLimitDays), carryExpiryMonth: version.carryExpiryMonth, carryExpiryDay: version.carryExpiryDay, advanceLimitDays: decimalText(version.advanceLimitDays), status: version.status, decisionReference: version.decisionReference, reason: version.reason, effectiveFrom: leaveDateText(version.effectiveFrom), effectiveTo: version.effectiveTo ? leaveDateText(version.effectiveTo) : null, createdAt: version.createdAt.toISOString(), createdBy: version.createdBy ? { id: version.createdBy.id, displayName: version.createdBy.displayName } : null };
}
function typeView(header: TypeHeader, orgUnitName: string) {
  return { id: header.id, orgUnitId: header.orgUnitId, orgUnitCode: header.orgUnit.code, orgUnitName, code: header.code, revision: header.revision, versions: header.versions.map(typeVersionView) };
}
function policyView(header: PolicyHeader, orgUnitName: string) {
  return { id: header.id, orgUnitId: header.orgUnitId, orgUnitCode: header.orgUnit.code, orgUnitName, revision: header.revision, versions: header.versions.map(policyVersionView) };
}

@Injectable()
export class LeaveCatalogService {
  constructor(private readonly prisma: PrismaService, private readonly access: LeaveAccessService, private readonly audit: AuditService) {}

  private async transaction<T>(work: (db: LeaveDb) => Promise<T>) {
    return this.prisma.$transaction(async (db) => {
      await db.$queryRaw`SELECT pg_advisory_xact_lock(8210490)::text`;
      return work(db);
    }, { isolationLevel: "Serializable", timeout: 90_000 });
  }

  private validateRange(dto: { effectiveFrom: string; effectiveTo?: string }) {
    const from = leaveDate(dto.effectiveFrom), to = dateValue(dto.effectiveTo);
    if (to && to < from) throw new BadRequestException("Khoảng ngày hiệu lực không hợp lệ.");
    return { from, to };
  }

  private validateType(dto: LeaveTypeVersionDto) {
    const max = dto.maxDays === null || dto.maxDays === undefined ? null : new Prisma.Decimal(dto.maxDays);
    if (max?.lt(0)) throw new BadRequestException("Số ngày tối đa không hợp lệ.");
    if (dto.siPaid && dto.isPaid) throw new BadRequestException("Nghỉ hưởng bảo hiểm không được đồng thời là nghỉ hưởng lương công ty.");
    if (dto.deductsAnnualQuota && (!dto.isPaid || !dto.countsAsWorkday || dto.siPaid)) throw new BadRequestException("Loại nghỉ trừ phép năm phải hưởng lương công ty, tính ngày công và không hưởng bảo hiểm.");
    return max;
  }

  private validatePolicy(dto: LeavePolicyVersionDto) {
    if (!(dto.normalDays >= 12 && dto.hazardousDays >= 14 && dto.extremeDays >= 16 && dto.normalDays <= dto.hazardousDays && dto.hazardousDays <= dto.extremeDays))
      throw new BadRequestException("Định mức phép năm không đáp ứng mức sàn pháp luật.");
    const monthDays = dto.carryExpiryMonth === 2 ? 29 : [4, 6, 9, 11].includes(dto.carryExpiryMonth) ? 30 : 31;
    if (dto.carryExpiryDay > monthDays) throw new BadRequestException("Ngày hết hạn chuyển phép không hợp lệ.");
    const carry = new Prisma.Decimal(dto.carryLimitDays), advance = new Prisma.Decimal(dto.advanceLimitDays);
    if (carry.lt(0) || advance.lt(0)) throw new BadRequestException("Giới hạn ngày không hợp lệ.");
    return { carry, advance };
  }

  private async visibleUnits(user: AuthUser, db: LeaveDb, asOf: Date) {
    const [scope, versions] = await Promise.all([
      this.access.scoped(user, "leave.read", db, asOf),
      db.orgUnitVersion.findMany({ where: effectiveAt(asOf), include: { orgUnit: true } }),
    ]);
    const map = new Map(versions.map((version) => [version.orgUnitId, version]));
    const visible = new Set(scope.allowed);
    for (const unitId of scope.allowed) {
      let current = map.get(unitId);
      const seen = new Set<string>();
      while (current?.parentId && !seen.has(current.parentId)) {
        seen.add(current.parentId);
        current = map.get(current.parentId);
        if (current && ["COMPANY", "SITE"].includes(current.type)) visible.add(current.orgUnitId);
      }
    }
    return { scope, versions, visible };
  }

  async context(user: AuthUser) {
    const now = businessDate();
    const { versions, visible } = await this.visibleUnits(user, this.prisma, now);
    const configureScope = user.permissions.includes("leave.configure") ? await this.access.scoped(user, "leave.configure", this.prisma, now) : null;
    const units = versions.filter((version) => visible.has(version.orgUnitId)).map((version) => ({ id: version.orgUnitId, code: version.orgUnit.code, name: version.name, type: version.type, parentId: version.parentId }));
    const managementUnits = configureScope?.versions.filter((version) => ["COMPANY", "SITE"].includes(version.type)).map((version) => ({ id: version.orgUnitId, code: version.orgUnit.code, name: version.name, type: version.type, parentId: version.parentId })) ?? [];
    return { units, managementUnits };
  }

  async types(user: AuthUser, query: LeaveCatalogQueryDto) {
    const asOf = query.asOf ? leaveDate(query.asOf) : businessDate();
    const { visible } = await this.visibleUnits(user, this.prisma, asOf);
    const unitIds = query.orgUnitId ? (visible.has(query.orgUnitId) ? [query.orgUnitId] : []) : [...visible];
    const items = await this.prisma.leaveType.findMany({
      where: { orgUnitId: { in: unitIds }, ...(query.search ? { OR: [{ code: { contains: query.search, mode: "insensitive" } }, { versions: { some: { name: { contains: query.search, mode: "insensitive" } } } }] } : {}), ...(query.asOf ? { versions: { some: { effectiveFrom: { lte: asOf }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOf } }] } } } : {}) },
      include: { ...typeInclude, orgUnit: { include: { versions: { where: effectiveAt(asOf), take: 1 } } } },
      orderBy: [{ orgUnit: { code: "asc" } }, { code: "asc" }],
    });
    return { items: items.map((header) => typeView(header, header.orgUnit.versions[0]?.name ?? header.orgUnit.code)) };
  }

  async policies(user: AuthUser, query: LeaveCatalogQueryDto) {
    const asOf = query.asOf ? leaveDate(query.asOf) : businessDate();
    const { visible } = await this.visibleUnits(user, this.prisma, asOf);
    const unitIds = query.orgUnitId ? (visible.has(query.orgUnitId) ? [query.orgUnitId] : []) : [...visible];
    const items = await this.prisma.leavePolicy.findMany({
      where: { orgUnitId: { in: unitIds }, ...(query.search ? { versions: { some: { name: { contains: query.search, mode: "insensitive" } } } } : {}), ...(query.asOf ? { versions: { some: { effectiveFrom: { lte: asOf }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOf } }] } } } : {}) },
      include: { ...policyInclude, orgUnit: { include: { versions: { where: effectiveAt(asOf), take: 1 } } } },
      orderBy: { orgUnit: { code: "asc" } },
    });
    return { items: items.map((header) => policyView(header, header.orgUnit.versions[0]?.name ?? header.orgUnit.code)) };
  }

  async createType(user: AuthUser, dto: CreateLeaveTypeDto, ipAddress?: string) {
    const { from, to } = this.validateRange(dto); const maxDays = this.validateType(dto);
    await this.access.assertUnit(user, "leave.configure", dto.orgUnitId, [from, to ?? OPEN_ENDED]);
    return this.transaction(async (db) => {
      const exists = await db.leaveType.findUnique({ where: { orgUnitId_code: { orgUnitId: dto.orgUnitId, code: dto.code } } });
      if (exists) throw new ConflictException("Mã loại nghỉ đã tồn tại.");
      const header = await db.leaveType.create({ data: { orgUnitId: dto.orgUnitId, code: dto.code, revision: 1, versions: { create: this.typeData(dto, from, to, maxDays, user.id) } }, include: typeInclude });
      const item = typeView(header, header.orgUnit.code);
      await this.audit.record({ actorId: user.id, entityType: "leave_type", entityId: header.id, action: "CREATE", result: "SUCCESS", newValue: { item, reason: dto.reason.trim(), reference: dto.decisionReference.trim() }, ipAddress }, db);
      return { item };
    });
  }
  async createTypeVersion(user: AuthUser, id: string, dto: CreateLeaveTypeVersionDto, ipAddress?: string) {
    const { from, to } = this.validateRange(dto); const maxDays = this.validateType(dto);
    if (from < businessDate()) throw new BadRequestException("Phiên bản mới không được hiệu lực trong quá khứ.");
    return this.transaction(async (db) => {
      const header = await db.leaveType.findUnique({ where: { id }, include: typeInclude });
      if (!header) throw new NotFoundException("Không tìm thấy cấu hình.");
      if (header.revision !== dto.revision) throw new ConflictException("Cấu hình đã thay đổi. Tải lại trước khi thao tác.");
      const latest = header.versions.reduce((current, version) => !current || version.effectiveFrom > current.effectiveFrom ? version : current, undefined as typeof header.versions[number] | undefined);
      if (latest && from <= latest.effectiveFrom) throw new BadRequestException("Ngày hiệu lực phải sau phiên bản mới nhất.");
      await this.access.assertUnit(user, "leave.configure", header.orgUnitId, [from, to ?? OPEN_ENDED], db);
      if (latest && (!latest.effectiveTo || latest.effectiveTo >= from)) await db.leaveTypeVersion.update({ where: { id: latest.id }, data: { effectiveTo: previousDay(from) } });
      const item = await db.leaveType.update({ where: { id }, data: { revision: { increment: 1 }, versions: { create: this.typeData(dto, from, to, maxDays, user.id) } }, include: typeInclude });
      const next = typeView(item, item.orgUnit.code);
      await this.audit.record({ actorId: user.id, entityType: "leave_type", entityId: item.id, action: "CREATE_VERSION", result: "SUCCESS", oldValue: typeView(header, header.orgUnit.code), newValue: { item: next, reason: dto.reason.trim(), reference: dto.decisionReference.trim() }, ipAddress }, db);
      return { item: next };
    });
  }

  async createPolicy(user: AuthUser, dto: CreateLeavePolicyDto, ipAddress?: string) {
    const { from, to } = this.validateRange(dto); const { carry, advance } = this.validatePolicy(dto);
    await this.access.assertUnit(user, "leave.configure", dto.orgUnitId, [from, to ?? OPEN_ENDED]);
    return this.transaction(async (db) => {
      const exists = await db.leavePolicy.findUnique({ where: { orgUnitId: dto.orgUnitId } });
      if (exists) throw new ConflictException("Chính sách phép năm đã tồn tại.");
      const item = await db.leavePolicy.create({ data: { orgUnitId: dto.orgUnitId, revision: 1, versions: { create: this.policyData(dto, from, to, carry, advance, user.id) } }, include: policyInclude });
      const next = policyView(item, item.orgUnit.code);
      await this.audit.record({ actorId: user.id, entityType: "leave_policy", entityId: item.id, action: "CREATE", result: "SUCCESS", newValue: { item: next, reason: dto.reason.trim(), reference: dto.decisionReference.trim() }, ipAddress }, db);
      return { item: next };
    });
  }
  async createPolicyVersion(user: AuthUser, id: string, dto: CreateLeavePolicyVersionDto, ipAddress?: string) {
    const { from, to } = this.validateRange(dto); const { carry, advance } = this.validatePolicy(dto);
    if (from < businessDate()) throw new BadRequestException("Phiên bản mới không được hiệu lực trong quá khứ.");
    return this.transaction(async (db) => {
      const header = await db.leavePolicy.findUnique({ where: { id }, include: policyInclude });
      if (!header) throw new NotFoundException("Không tìm thấy cấu hình.");
      if (header.revision !== dto.revision) throw new ConflictException("Cấu hình đã thay đổi. Tải lại trước khi thao tác.");
      const latest = header.versions.reduce((current, version) => !current || version.effectiveFrom > current.effectiveFrom ? version : current, undefined as typeof header.versions[number] | undefined);
      if (latest && from <= latest.effectiveFrom) throw new BadRequestException("Ngày hiệu lực phải sau phiên bản mới nhất.");
      await this.access.assertUnit(user, "leave.configure", header.orgUnitId, [from, to ?? OPEN_ENDED], db);
      if (latest && (!latest.effectiveTo || latest.effectiveTo >= from)) await db.leavePolicyVersion.update({ where: { id: latest.id }, data: { effectiveTo: previousDay(from) } });
      const item = await db.leavePolicy.update({ where: { id }, data: { revision: { increment: 1 }, versions: { create: this.policyData(dto, from, to, carry, advance, user.id) } }, include: policyInclude });
      const next = policyView(item, item.orgUnit.code);
      await this.audit.record({ actorId: user.id, entityType: "leave_policy", entityId: item.id, action: "CREATE_VERSION", result: "SUCCESS", oldValue: policyView(header, header.orgUnit.code), newValue: { item: next, reason: dto.reason.trim(), reference: dto.decisionReference.trim() }, ipAddress }, db);
      return { item: next };
    });
  }

  async resolvePolicy(db: LeaveDb, orgUnitId: string, date: Date): Promise<Prisma.LeavePolicyVersionGetPayload<{ include: { policy: { include: { orgUnit: true } } } }>> {
    const versions = await db.orgUnitVersion.findMany({ where: effectiveAt(date) });
    const parents = new Map(versions.map((version) => [version.orgUnitId, version.parentId]));
    const visited = new Set<string>(); let current: string | null | undefined = orgUnitId;
    while (current && !visited.has(current)) {
      visited.add(current);
      const version = await db.leavePolicyVersion.findFirst({ where: { policy: { orgUnitId: current }, effectiveFrom: { lte: date }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }] }, include: { policy: { include: { orgUnit: true } } } });
      if (version) return version;
      current = parents.get(current);
    }
    throw new ConflictException("Chưa có chính sách phép năm hiệu lực.");
  }

  private typeData(dto: LeaveTypeVersionDto, from: Date, to: Date | undefined, maxDays: Prisma.Decimal | null, userId: string) {
    return { name: dto.name.trim(), active: dto.active, isPaid: dto.isPaid, countsAsWorkday: dto.countsAsWorkday, deductsAnnualQuota: dto.deductsAnnualQuota, siPaid: dto.siPaid, requiresDocument: dto.requiresDocument, maxDays, attendanceSymbol: dto.attendanceSymbol.trim(), status: dto.status, decisionReference: dto.decisionReference.trim(), reason: dto.reason.trim(), effectiveFrom: from, effectiveTo: to ?? null, createdById: userId };
  }

  private policyData(dto: LeavePolicyVersionDto, from: Date, to: Date | undefined, carry: Prisma.Decimal, advance: Prisma.Decimal, userId: string) {
    return { name: dto.name.trim(), normalDays: dto.normalDays, hazardousDays: dto.hazardousDays, extremeDays: dto.extremeDays, carryLimitDays: carry, carryExpiryMonth: dto.carryExpiryMonth, carryExpiryDay: dto.carryExpiryDay, advanceLimitDays: advance, status: dto.status as PolicyStatus, decisionReference: dto.decisionReference.trim(), reason: dto.reason.trim(), effectiveFrom: from, effectiveTo: to ?? null, createdById: userId };
  }
}
