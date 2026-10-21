import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { AuthUser } from "../auth/auth.types";
import { businessDate } from "../auth/business-date";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { effectiveAt } from "../organization/scope.service";
import { CreateSalaryComponentDto, CreateSalaryComponentVersionDto, SalaryComponentQueryDto, SalaryComponentVersionDto } from "./salary-components.dto";

type Db = Prisma.TransactionClient;
type Permission = "payroll.components.read" | "payroll.components.manage";
type UnitVersion = Prisma.OrgUnitVersionGetPayload<{ include: { orgUnit: true } }>;
interface ComponentScope { allowed: Set<string>; visible: Set<string>; versions: UnitVersion[] }
const include = { orgUnit: true, versions: { include: { createdBy: { select: { id: true, displayName: true } } }, orderBy: { effectiveFrom: "desc" as const } } } satisfies Prisma.SalaryComponentInclude;
type Component = Prisma.SalaryComponentGetPayload<{ include: typeof include }>;
const OPEN_ENDED = new Date("9999-12-31T00:00:00.000Z");
const DAY = 86_400_000;

function dateText(date: Date) { return date.toISOString().slice(0, 10); }
function parseDate(value: string): Date {
  const date = new Date(value + "T00:00:00.000Z");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || dateText(date) !== value || value < "1900-01-01")
    throw new BadRequestException("Ngày hiệu lực không hợp lệ hoặc trước năm 1900.");
  return date;
}
function versionView(version: Component["versions"][number]) {
  return { id: version.id, name: version.name, componentType: version.componentType, active: version.active, isInsurable: version.isInsurable, taxClassification: version.taxClassification, isOtBase: version.isOtBase, isProrated: version.isProrated, displayOrder: version.displayOrder, status: version.status, classificationBasis: version.classificationBasis, decisionReference: version.decisionReference, reason: version.reason, effectiveFrom: dateText(version.effectiveFrom), effectiveTo: version.effectiveTo ? dateText(version.effectiveTo) : null, createdAt: version.createdAt.toISOString(), createdBy: version.createdBy };
}
function unitView(version: UnitVersion) { return { id: version.orgUnitId, code: version.orgUnit.code, name: version.name, type: version.type, parentId: version.parentId }; }

@Injectable()
export class SalaryComponentsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  private assertPermission(user: AuthUser, permission: Permission) {
    if (!user.roles.includes("KT") || !user.permissions.includes(permission)) throw new ForbiddenException("Chỉ kế toán được cấp quyền mới được quản lý hoặc xem cấu phần lương.");
  }

  private async scope(user: AuthUser, permission: Permission, date: Date, db: Db): Promise<ComponentScope> {
    this.assertPermission(user, permission);
    const [versions, grants] = await Promise.all([
      db.orgUnitVersion.findMany({ where: effectiveAt(date), include: { orgUnit: true } }),
      db.roleAssignment.findMany({ where: { userAccountId: user.id, roleCode: "KT", role: { permissions: { has: permission } }, ...effectiveAt(date) }, select: { scopeOrgUnitId: true } }),
    ]);
    const byId = new Map(versions.map(version => [version.orgUnitId, version]));
    const children = new Map<string, string[]>();
    for (const version of versions) if (version.parentId) {
      const entries = children.get(version.parentId) ?? [];
      entries.push(version.orgUnitId); children.set(version.parentId, entries);
    }
    const allowed = new Set<string>(), pending = grants.map(grant => grant.scopeOrgUnitId);
    while (pending.length) {
      const id = pending.pop()!;
      if (allowed.has(id) || !byId.has(id)) continue;
      allowed.add(id); pending.push(...(children.get(id) ?? []));
    }
    const visible = new Set(allowed);
    if (permission === "payroll.components.read") for (const id of allowed) {
      let version = byId.get(id);
      const visited = new Set<string>();
      while (version?.parentId && !visited.has(version.parentId)) {
        visited.add(version.parentId); version = byId.get(version.parentId);
        if (version && ["COMPANY", "SITE"].includes(version.type)) visible.add(version.orgUnitId);
      }
    }
    return { allowed, visible, versions };
  }

  private async readScopes(user: AuthUser, asOf: Date, db: Db) {
    const current = await this.scope(user, "payroll.components.read", businessDate(), db);
    const dated = dateText(asOf) === dateText(businessDate()) ? current : await this.scope(user, "payroll.components.read", asOf, db);
    const visible = new Set([...current.visible].filter(id => dated.visible.has(id)));
    const management = user.permissions.includes("payroll.components.manage") ? await this.scope(user, "payroll.components.manage", businessDate(), db) : null;
    return { current, dated, visible, management };
  }

  private async assertWritable(user: AuthUser, id: string, from: Date, to: Date, db: Db) {
    const overlap = { effectiveFrom: { lte: to }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }] };
    const [roleChanges, orgChanges] = await Promise.all([
      db.roleAssignment.findMany({ where: { userAccountId: user.id, ...overlap }, select: { effectiveFrom: true, effectiveTo: true } }),
      db.orgUnitVersion.findMany({ where: overlap, select: { effectiveFrom: true, effectiveTo: true } }),
    ]);
    const checks = new Map([from, to, businessDate()].map(date => [dateText(date), date]));
    for (const row of [...roleChanges, ...orgChanges]) {
      if (row.effectiveFrom >= from && row.effectiveFrom <= to) checks.set(dateText(row.effectiveFrom), row.effectiveFrom);
      if (row.effectiveTo && row.effectiveTo >= from && row.effectiveTo < to) {
        const next = new Date(row.effectiveTo.getTime() + DAY); checks.set(dateText(next), next);
      }
    }
    for (const date of checks.values()) {
      const scope = await this.scope(user, "payroll.components.manage", date, db);
      if (!scope.allowed.has(id)) throw new NotFoundException("Không tìm thấy cấu hình trong phạm vi được cấp cho toàn khoảng hiệu lực.");
      if (!scope.versions.some(version => version.orgUnitId === id && ["COMPANY", "SITE"].includes(version.type)))
        throw new BadRequestException("Chỉ được cấu hình cấu phần tại công ty hoặc cơ sở.");
    }
  }

  private range(dto: SalaryComponentVersionDto) {
    const from = parseDate(dto.effectiveFrom), to = dto.effectiveTo ? parseDate(dto.effectiveTo) : null;
    if (to && to < from) throw new BadRequestException("Ngày kết thúc phải từ ngày bắt đầu hiệu lực trở đi.");
    return { from, to };
  }

  private data(dto: SalaryComponentVersionDto, from: Date, to: Date | null, userId: string) {
    return { name: dto.name.trim(), componentType: dto.componentType, active: dto.active, isInsurable: dto.isInsurable, taxClassification: dto.taxClassification, isOtBase: dto.isOtBase, isProrated: dto.isProrated, displayOrder: dto.displayOrder, status: dto.status, classificationBasis: dto.classificationBasis.trim(), decisionReference: dto.decisionReference.trim(), reason: dto.reason.trim(), effectiveFrom: from, effectiveTo: to, createdById: userId };
  }

  private view(header: Component, asOf: Date, name: string, canManage: boolean) {
    const active = header.versions.find(version => version.effectiveFrom <= asOf && (!version.effectiveTo || version.effectiveTo >= asOf));
    return { id: header.id, orgUnitId: header.orgUnitId, orgUnitCode: header.orgUnit.code, orgUnitName: name, code: header.code, revision: header.revision, canManage, activeVersion: active ? versionView(active) : null, versions: header.versions.map(versionView) };
  }

  private read<T>(work: (db: Db) => Promise<T>) { return this.prisma.$transaction(work, { isolationLevel: "RepeatableRead", timeout: 30_000 }); }
  private write<T>(work: (db: Db) => Promise<T>) {
    return this.prisma.$transaction(async db => {
      await db.$queryRaw`SELECT pg_advisory_xact_lock(8210500)::text`;
      await db.$queryRaw`SELECT pg_advisory_xact_lock(8210473)::text`;
      return work(db);
    }, { isolationLevel: "Serializable", timeout: 60_000 });
  }

  context(user: AuthUser) {
    return this.read(async db => {
      const asOf = businessDate(), scopes = await this.readScopes(user, asOf, db);
      return { asOf: dateText(asOf), minimumSuccessorDate: dateText(new Date(asOf.getTime() + DAY)), units: scopes.current.versions.filter(version => scopes.visible.has(version.orgUnitId) && ["COMPANY", "SITE"].includes(version.type)).map(unitView), managementUnits: scopes.management?.versions.filter(version => scopes.management!.allowed.has(version.orgUnitId) && ["COMPANY", "SITE"].includes(version.type)).map(unitView) ?? [] };
    });
  }

  list(user: AuthUser, query: SalaryComponentQueryDto) {
    const asOf = query.asOf ? parseDate(query.asOf) : businessDate();
    return this.read(async db => {
      const scopes = await this.readScopes(user, asOf, db);
      if (query.orgUnitId && !scopes.visible.has(query.orgUnitId)) throw new NotFoundException("Không tìm thấy đơn vị trong phạm vi được cấp.");
      const search = query.search?.trim();
      const headers = await db.salaryComponent.findMany({ where: { orgUnitId: { in: query.orgUnitId ? [query.orgUnitId] : [...scopes.visible] }, ...(search ? { OR: [{ code: { contains: search, mode: "insensitive" } }, { versions: { some: { name: { contains: search, mode: "insensitive" } } } }] } : {}) }, include, orderBy: [{ orgUnit: { code: "asc" } }, { code: "asc" }] });
      const names = new Map(scopes.dated.versions.map(version => [version.orgUnitId, version.name]));
      const items = headers.map(header => this.view(header, asOf, names.get(header.orgUnitId) ?? header.orgUnit.code, scopes.management?.allowed.has(header.orgUnitId) ?? false));
      items.sort((a, b) => (a.activeVersion?.displayOrder ?? 10000) - (b.activeVersion?.displayOrder ?? 10000) || a.orgUnitCode.localeCompare(b.orgUnitCode) || a.code.localeCompare(b.code));
      return { asOf: dateText(asOf), items };
    });
  }

  detail(user: AuthUser, id: string, query: SalaryComponentQueryDto) {
    const asOf = query.asOf ? parseDate(query.asOf) : businessDate();
    return this.read(async db => {
      const scopes = await this.readScopes(user, asOf, db), header = await db.salaryComponent.findUnique({ where: { id }, include });
      if (!header || !scopes.visible.has(header.orgUnitId)) throw new NotFoundException("Không tìm thấy cấu phần lương.");
      return { item: this.view(header, asOf, scopes.dated.versions.find(version => version.orgUnitId === header.orgUnitId)?.name ?? header.orgUnit.code, scopes.management?.allowed.has(header.orgUnitId) ?? false) };
    });
  }

  create(user: AuthUser, dto: CreateSalaryComponentDto, ipAddress?: string) {
    this.assertPermission(user, "payroll.components.manage");
    const { from, to } = this.range(dto);
    return this.write(async db => {
      await this.assertWritable(user, dto.orgUnitId, from, to ?? OPEN_ENDED, db);
      if (await db.salaryComponent.findUnique({ where: { orgUnitId_code: { orgUnitId: dto.orgUnitId, code: dto.code } } })) throw new ConflictException("Mã cấu phần đã tồn tại tại đơn vị này.");
      const header = await db.salaryComponent.create({ data: { orgUnitId: dto.orgUnitId, code: dto.code, versions: { create: this.data(dto, from, to, user.id) } }, include });
      const item = this.view(header, businessDate(), header.orgUnit.code, true);
      await this.audit.record({ actorId: user.id, entityType: "salary_component", entityId: header.id, action: "CREATE", result: "SUCCESS", newValue: { item }, ipAddress }, db);
      return { item };
    });
  }

  createVersion(user: AuthUser, id: string, dto: CreateSalaryComponentVersionDto, ipAddress?: string) {
    this.assertPermission(user, "payroll.components.manage");
    const { from, to } = this.range(dto);
    if (from <= businessDate()) throw new BadRequestException("Phiên bản kế tiếp phải hiệu lực từ ngày mai trở đi; không thay đổi phân loại của ngày hiện tại hoặc quá khứ.");
    return this.write(async db => {
      const header = await db.salaryComponent.findUnique({ where: { id }, include });
      if (!header) throw new NotFoundException("Không tìm thấy cấu phần lương.");
      await this.assertWritable(user, header.orgUnitId, from, to ?? OPEN_ENDED, db);
      if (header.revision !== dto.revision) throw new ConflictException("Cấu phần đã có phiên bản mới. Tải lại trước khi thực hiện.");
      const latest = header.versions[0];
      if (latest && from <= latest.effectiveFrom) throw new BadRequestException("Ngày hiệu lực phải sau phiên bản mới nhất.");
      if (latest && (!latest.effectiveTo || latest.effectiveTo >= from)) {
        await this.assertWritable(user, header.orgUnitId, from, latest.effectiveTo ?? OPEN_ENDED, db);
        await db.salaryComponentVersion.update({ where: { id: latest.id }, data: { effectiveTo: new Date(from.getTime() - DAY) } });
      }
      const changed = await db.salaryComponent.update({ where: { id }, data: { revision: { increment: 1 }, versions: { create: this.data(dto, from, to, user.id) } }, include });
      const item = this.view(changed, businessDate(), changed.orgUnit.code, true);
      await this.audit.record({ actorId: user.id, entityType: "salary_component", entityId: header.id, action: "CREATE_VERSION", result: "SUCCESS", oldValue: this.view(header, businessDate(), header.orgUnit.code, true), newValue: { item }, ipAddress }, db);
      return { item };
    });
  }
}
