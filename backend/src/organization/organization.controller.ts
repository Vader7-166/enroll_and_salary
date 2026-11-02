import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { SessionGuard } from "../auth/session.guard";
import type { AuthRequest } from "../auth/auth.types";
import { PrismaService } from "../database/prisma.service";
import { ScopeService } from "./scope.service";

@Controller("organization")
@UseGuards(SessionGuard)
export class OrganizationController {
  constructor(
    private readonly scope: ScopeService,
    private readonly prisma: PrismaService,
  ) {}

  @Get("context")
  async context(@Req() req: AuthRequest) {
    const permission = req.user.permissions.includes("organization.read")
      ? "organization.read"
      : "employee.read";
    const scope = await this.scope.load(req.user, permission);
    const byId = new Map(scope.versions.map((v) => [v.orgUnitId, v]));
    const path = (id: string): string => {
      const unit = byId.get(id)!;
      return unit.parentId && byId.has(unit.parentId)
        ? path(unit.parentId) + " / " + unit.name
        : unit.name;
    };
    return {
      asOf: scope.asOf.toISOString().slice(0, 10),
      units: scope.versions
        .map((v) => ({
          id: v.orgUnitId,
          code: v.orgUnit.code,
          name: v.name,
          type: v.type,
          parentId: byId.has(v.parentId ?? "") ? v.parentId : null,
          siteId: v.siteId,
          level: v.level,
          pathLabel: path(v.orgUnitId),
        }))
        .sort((a, b) => a.pathLabel.localeCompare(b.pathLabel, "vi")),
      jobTitles: await this.prisma.jobTitle.findMany({
        select: { id: true, code: true, name: true },
        orderBy: { code: "asc" },
      }),
    };
  }
}
