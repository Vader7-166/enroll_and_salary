import { ForbiddenException, Injectable } from "@nestjs/common";
import type { Prisma, RoleCode } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import type { AuthUser } from "../auth/auth.types";
import { businessDate } from "../auth/business-date";

export function effectiveAt(date: Date) {
  return {
    effectiveFrom: { lte: date },
    OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }],
  };
}

@Injectable()
export class ScopeService {
  constructor(private readonly prisma: PrismaService) {}

  async load(
    user: AuthUser,
    permission: string,
    db: Prisma.TransactionClient = this.prisma,
    asOf: Date = businessDate(),
  ) {
    if (!user.permissions.includes(permission))
      throw new ForbiddenException(
        "Bạn không có quyền thực hiện thao tác này.",
      );
    const [versions, roles] = await Promise.all([
      db.orgUnitVersion.findMany({
        where: effectiveAt(asOf),
        include: { orgUnit: true, site: true },
      }),
      db.role.findMany({
        where: {
          code: { in: user.assignments.map((a) => a.roleCode as RoleCode) },
        },
      }),
    ]);
    const rolePermissions = new Map(
      roles.map((role) => [role.code as string, role.permissions]),
    );
    const allowed = new Set<string>();
    const children = new Map<string, string[]>();
    for (const version of versions) {
      if (version.parentId)
        children.set(version.parentId, [
          ...(children.get(version.parentId) ?? []),
          version.orgUnitId,
        ]);
    }
    const activeIds = new Set(versions.map((v) => v.orgUnitId));
    const pending = user.assignments
      .filter((a) => rolePermissions.get(a.roleCode)?.includes(permission))
      .map((a) => a.scopeOrgUnitId);
    while (pending.length) {
      const id = pending.pop()!;
      if (allowed.has(id) || !activeIds.has(id)) continue;
      allowed.add(id);
      pending.push(...(children.get(id) ?? []));
    }
    return {
      asOf,
      allowed,
      versions: versions.filter((v) => allowed.has(v.orgUnitId)),
    };
  }
}
