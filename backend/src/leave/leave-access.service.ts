import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { businessDate } from "../auth/business-date";
import type { AuthUser } from "../auth/auth.types";
import { PrismaService } from "../database/prisma.service";
import { effectiveAt, ScopeService } from "../organization/scope.service";

export type LeaveDb = Prisma.TransactionClient;
type EffectiveVersion = Prisma.OrgUnitVersionGetPayload<{ include: { orgUnit: true; site: true } }>;
export type LeaveScope = { allowed: Set<string>; versions: EffectiveVersion[] };

export function leaveDate(s: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new BadRequestException("Ngày không hợp lệ.");
  const value = new Date(s + "T00:00:00.000Z");
  if (!Number.isFinite(value.getTime()) || value.toISOString().slice(0, 10) !== s) throw new BadRequestException("Ngày không hợp lệ.");
  return value;
}

export function leaveDateText(d: Date): string {
  if (!Number.isFinite(d.getTime())) throw new BadRequestException("Ngày không hợp lệ.");
  return d.toISOString().slice(0, 10);
}

@Injectable()
export class LeaveAccessService {
  constructor(private readonly prisma: PrismaService, private readonly scopeService: ScopeService) {}

  async scoped(user: AuthUser, permission: string, db: LeaveDb = this.prisma, asOf: Date = businessDate()): Promise<LeaveScope> {
    if (!user.permissions.includes(permission)) throw new ForbiddenException("Bạn không có quyền thực hiện thao tác này.");
    const [versions, assignments] = await Promise.all([
      db.orgUnitVersion.findMany({ where: effectiveAt(asOf), include: { orgUnit: true, site: true } }),
      db.roleAssignment.findMany({ where: { userAccountId: user.id, ...effectiveAt(asOf), role: { permissions: { has: permission } } }, select: { scopeOrgUnitId: true } }),
    ]);
    const children = new Map<string, string[]>();
    const existing = new Set(versions.map((version) => version.orgUnitId));
    for (const version of versions) if (version.parentId) children.set(version.parentId, [...(children.get(version.parentId) ?? []), version.orgUnitId]);
    const allowed = new Set<string>();
    const pending = assignments.map((assignment) => assignment.scopeOrgUnitId);
    while (pending.length) {
      const unitId = pending.pop()!;
      if (allowed.has(unitId) || !existing.has(unitId)) continue;
      allowed.add(unitId);
      pending.push(...(children.get(unitId) ?? []));
    }
    return { allowed, versions: versions.filter((version) => allowed.has(version.orgUnitId)) };
  }

  async assertUnit(user: AuthUser, permission: string, unitId: string, dates: Date[], db: LeaveDb = this.prisma): Promise<void> {
    if (!dates.length) throw new BadRequestException("Phải có ngày hiệu lực.");
    const start = new Date(Math.min(...dates.map((date) => date.getTime())));
    const end = new Date(Math.max(...dates.map((date) => date.getTime())));
    const checkDates = new Map<string, Date>([...dates, businessDate()].map((date) => [leaveDateText(date), date]));
    if (permission === "leave.configure") {
      const overlaps = { effectiveFrom: { lte: end }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: start } }] };
      const [roleChanges, organizationChanges] = await Promise.all([
        db.roleAssignment.findMany({ where: { userAccountId: user.id, ...overlaps }, select: { effectiveFrom: true, effectiveTo: true } }),
        db.orgUnitVersion.findMany({ where: overlaps, select: { effectiveFrom: true, effectiveTo: true } }),
      ]);
      for (const row of [...roleChanges, ...organizationChanges]) {
        if (row.effectiveFrom >= start && row.effectiveFrom <= end) checkDates.set(leaveDateText(row.effectiveFrom), row.effectiveFrom);
        if (row.effectiveTo && row.effectiveTo >= start && row.effectiveTo < end) {
          const next = new Date(row.effectiveTo.getTime() + 86_400_000);
          checkDates.set(leaveDateText(next), next);
        }
      }
    }
    for (const date of checkDates.values()) {
      const scope = await this.scoped(user, permission, db, date);
      if (!scope.allowed.has(unitId)) throw new ForbiddenException("Bạn không có quyền thực hiện thao tác này.");
      if (permission === "leave.configure") {
        const version = scope.versions.find((row) => row.orgUnitId === unitId);
        if (!version || !["COMPANY", "SITE"].includes(version.type)) throw new BadRequestException("Chỉ được cấu hình tại công ty hoặc cơ sở.");
      }
    }
  }

  async assertEmployee(user: AuthUser, permission: string, employeeId: string, dates: Date[], db: LeaveDb = this.prisma) {
    if (!dates.length) throw new BadRequestException("Phải có ngày hiệu lực.");
    const employee = await db.employee.findUnique({
      where: { id: employeeId },
      include: {
        assignments: { where: { isPrimary: true }, orderBy: { effectiveFrom: "asc" } },
        exclusions: { where: { userAccountId: user.id } },
      },
    });
    if (!employee) throw new NotFoundException("Không tìm thấy dữ liệu.");
    const today = businessDate();
    const currentAssignment = employee.assignments.find((assignment) => assignment.effectiveFrom <= today && (!assignment.effectiveTo || assignment.effectiveTo >= today));
    const terminationAssignment = employee.terminationDate ? employee.assignments.find((assignment) => assignment.effectiveFrom <= employee.terminationDate! && (!assignment.effectiveTo || assignment.effectiveTo >= employee.terminationDate!)) : undefined;
    const currentScope = await this.scoped(user, permission, db, today);
    const visibleAssignment = employee.status === "TERMINATED" ? terminationAssignment : currentAssignment;
    if (!visibleAssignment || !currentScope.allowed.has(visibleAssignment.orgUnitId)) throw new NotFoundException("Không tìm thấy dữ liệu.");
    if (employee.exclusions.some((row) => row.effectiveFrom <= today && (!row.effectiveTo || row.effectiveTo >= today))) throw new NotFoundException("Không tìm thấy dữ liệu.");
    for (const date of new Map(dates.map((value) => [leaveDateText(value), value])).values()) {
      const assignment = employee.assignments.find((row) => row.effectiveFrom <= date && (!row.effectiveTo || row.effectiveTo >= date));
      const scope = await this.scoped(user, permission, db, date);
      if (!assignment || !scope.allowed.has(assignment.orgUnitId)) throw new NotFoundException("Không tìm thấy dữ liệu.");
      if (employee.exclusions.some((row) => row.effectiveFrom <= date && (!row.effectiveTo || row.effectiveTo >= date))) throw new NotFoundException("Không tìm thấy dữ liệu.");
    }
    return employee;
  }
}
