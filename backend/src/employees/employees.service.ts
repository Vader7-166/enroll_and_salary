import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { AuthUser } from "../auth/auth.types";
import { ScopeService, effectiveAt } from "../organization/scope.service";
import { CreateEmployeeDto, EmployeeQueryDto } from "./employee.dto";

type Scope = Awaited<ReturnType<ScopeService["load"]>>;
function selectEmployee(scope: Scope) {
  return {
    id: true,
    code: true,
    fullName: true,
    gender: true,
    dob: true,
    hireDate: true,
    status: true,
    nationality: true,
    email: true,
    phone: true,
    jobTitle: { select: { id: true, code: true, name: true } },
    assignments: {
      where: {
        ...effectiveAt(scope.asOf),
        orgUnitId: { in: [...scope.allowed] },
      },
      select: { orgUnitId: true, isPrimary: true },
    },
  } satisfies Prisma.EmployeeSelect;
}
type EmployeeRow = Prisma.EmployeeGetPayload<{
  select: ReturnType<typeof selectEmployee>;
}>;
function serialize(employee: EmployeeRow, scope: Scope) {
  const assignment =
    employee.assignments.find((a) => a.isPrimary) ?? employee.assignments[0];
  const unit = scope.versions.find(
    (v) => v.orgUnitId === assignment?.orgUnitId,
  )!;
  return {
    id: employee.id,
    code: employee.code,
    fullName: employee.fullName,
    gender: employee.gender,
    dob: employee.dob.toISOString().slice(0, 10),
    hireDate: employee.hireDate.toISOString().slice(0, 10),
    status: employee.status,
    nationality: employee.nationality,
    email: employee.email,
    phone: employee.phone,
    jobTitle: employee.jobTitle,
    orgUnit: {
      id: unit.orgUnitId,
      code: unit.orgUnit.code,
      name: unit.name,
      type: unit.type,
      site: unit.site
        ? { id: unit.site.id, code: unit.site.code, name: unit.site.name }
        : null,
    },
  };
}
function visibleWhere(user: AuthUser, scope: Scope): Prisma.EmployeeWhereInput {
  return {
    assignments: {
      some: {
        ...effectiveAt(scope.asOf),
        orgUnitId: { in: [...scope.allowed] },
      },
    },
    exclusions: {
      none: { userAccountId: user.id, ...effectiveAt(scope.asOf) },
    },
  };
}
function dateValue(value: string): Date {
  const date = new Date(value + "T00:00:00.000Z");
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  )
    throw new BadRequestException("Ngày không hợp lệ.");
  return date;
}

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
  ) {}

  private async scoped(
    user: AuthUser,
    permission: string,
    ipAddress?: string,
    tx?: Prisma.TransactionClient,
  ) {
    try {
      return await this.scope.load(user, permission, tx);
    } catch (error) {
      if (error instanceof ForbiddenException)
        await this.audit.record({
          actorId: user.id,
          entityType: "employee",
          entityId: "permission",
          action: "ACCESS_DENIED",
          result: "DENIED",
          ipAddress,
        });
      throw error;
    }
  }

  async list(user: AuthUser, query: EmployeeQueryDto, ipAddress?: string) {
    const scope = await this.scoped(user, "employee.read", ipAddress);
    const units = new Set(scope.allowed);
    if (query.orgUnitId) {
      units.clear();
      const pending = scope.allowed.has(query.orgUnitId)
        ? [query.orgUnitId]
        : [];
      while (pending.length) {
        const id = pending.pop()!;
        if (units.has(id)) continue;
        units.add(id);
        pending.push(
          ...scope.versions
            .filter((v) => v.parentId === id)
            .map((v) => v.orgUnitId),
        );
      }
    }
    const search = query.search?.trim();
    const where: Prisma.EmployeeWhereInput = {
      AND: [
        visibleWhere(user, scope),
        {
          assignments: {
            some: { ...effectiveAt(scope.asOf), orgUnitId: { in: [...units] } },
          },
        },
        ...(search
          ? [
              {
                OR: [
                  { code: { contains: search, mode: "insensitive" as const } },
                  {
                    fullName: {
                      contains: search,
                      mode: "insensitive" as const,
                    },
                  },
                ],
              },
            ]
          : []),
        ...(query.status ? [{ status: query.status }] : []),
      ],
    };
    const [total, employees] = await this.prisma.$transaction(
      [
        this.prisma.employee.count({ where }),
        this.prisma.employee.findMany({
          where,
          select: selectEmployee(scope),
          orderBy: [{ code: "asc" }, { id: "asc" }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
      ],
      { isolationLevel: "RepeatableRead" },
    );
    await this.audit.record({
      actorId: user.id,
      entityType: "employee",
      entityId: "list",
      action: "READ",
      result: "ALLOWED",
      newValue: { page: query.page, pageSize: query.pageSize },
      ipAddress,
    });
    return {
      items: employees.map((e) => serialize(e, scope)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async detail(user: AuthUser, id: string, ipAddress?: string) {
    const scope = await this.scoped(user, "employee.read", ipAddress);
    const employee = await this.prisma.employee.findFirst({
      where: { AND: [{ id }, visibleWhere(user, scope)] },
      select: selectEmployee(scope),
    });
    await this.audit.record({
      actorId: user.id,
      entityType: "employee",
      entityId: id,
      action: employee ? "READ" : "ACCESS_DENIED",
      result: employee ? "ALLOWED" : "EMPTY",
      ipAddress,
    });
    return { employee: employee ? serialize(employee, scope) : null };
  }

  async create(user: AuthUser, dto: CreateEmployeeDto, ipAddress?: string) {
    await this.scoped(user, "employee.create", ipAddress);
    const fullName = dto.fullName.trim();
    if (fullName.length < 2)
      throw new BadRequestException(
        "Họ tên phải có ít nhất 2 ký tự không phải khoảng trắng.",
      );
    const dob = dateValue(dto.dob),
      hireDate = dateValue(dto.hireDate);
    const outcome = await this.prisma.$transaction(async (tx) => {
      const scope = await this.scope.load(user, "employee.create", tx);
      if (dob >= hireDate || hireDate > scope.asOf)
        throw new BadRequestException(
          "Ngày sinh phải trước ngày vào làm; ngày vào làm không được ở tương lai.",
        );
      const target = scope.versions.find((v) => v.orgUnitId === dto.orgUnitId);
      if (!target || !["TEAM", "DEPARTMENT"].includes(target.type)) return null;
      if (
        hireDate < target.effectiveFrom ||
        (target.effectiveTo && hireDate > target.effectiveTo)
      )
        throw new BadRequestException(
          "Ngày vào làm nằm ngoài hiệu lực đơn vị được chọn.",
        );
      if (
        dto.jobTitleId &&
        !(await tx.jobTitle.findUnique({ where: { id: dto.jobTitleId } }))
      )
        throw new BadRequestException("Chức danh không hợp lệ.");
      const employee = await tx.employee.create({
        data: {
          code: dto.code,
          fullName,
          gender: dto.gender,
          dob,
          hireDate,
          nationality: dto.nationality?.trim() || "Việt Nam",
          email: dto.email?.trim() || null,
          phone: dto.phone?.trim() || null,
          jobTitleId: dto.jobTitleId ?? null,
          assignments: {
            create: {
              orgUnitId: target.orgUnitId,
              isPrimary: true,
              allocationRatio: new Prisma.Decimal("100"),
              effectiveFrom: hireDate,
            },
          },
        },
        select: selectEmployee(scope),
      });
      await this.audit.record(
        {
          actorId: user.id,
          entityType: "employee",
          entityId: employee.id,
          action: "CREATE",
          result: "ALLOWED",
          newValue: { code: employee.code, orgUnitId: target.orgUnitId },
          ipAddress,
        },
        tx,
      );
      return serialize(employee, scope);
    });
    if (!outcome) {
      await this.audit.record({
        actorId: user.id,
        entityType: "employee",
        entityId: "create",
        action: "ACCESS_DENIED",
        result: "DENIED",
        ipAddress,
      });
      throw new ForbiddenException(
        "Không được phép tạo nhân viên ở đơn vị này.",
      );
    }
    return { employee: outcome };
  }
}
