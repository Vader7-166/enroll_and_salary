import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Prisma } from "@prisma/client";
import type { AuthUser } from "../auth/auth.types";
import { businessDate } from "../auth/business-date";
import { plainText } from "../common/data-crypto";
import { PrismaService } from "../database/prisma.service";
import { effectiveAt, ScopeService } from "../organization/scope.service";
import type { SnapshotContent } from "./payslip-renderer";

type Db = Prisma.TransactionClient;
export type OutputPermission = "payroll.payslips" | "payroll.payment";

/** Shared gate for payroll outputs: KT with the permission, site in scope, and only a LOCKED sheet's snapshot as source. */
@Injectable()
export class PayrollOutputAccess {
  readonly key: Buffer;
  constructor(private readonly prisma: PrismaService, private readonly scope: ScopeService, config: ConfigService) {
    this.key = Buffer.from(config.getOrThrow<string>("HR_DATA_KEY"), "base64");
  }

  assertRole(user: AuthUser, permission: OutputPermission) {
    if (!user.roles.includes("KT") || !user.permissions.includes(permission)) throw new ForbiddenException("Chỉ KT được cấp quyền mới được xuất phiếu lương hoặc file chi lương.");
  }

  async lockedSheet(user: AuthUser, sheetId: string, permission: OutputPermission, db: Db = this.prisma) {
    this.assertRole(user, permission);
    const sheet = await db.payrollSheet.findUnique({ where: { id: sheetId }, include: { payrollPeriod: true, snapshot: true } });
    if (!sheet) throw new NotFoundException("Không tìm thấy bảng lương.");
    if (!(await this.scope.load(user, permission, db)).allowed.has(sheet.payrollPeriod.siteOrgUnitId)) throw new ForbiddenException("Kỳ lương nằm ngoài phạm vi được phân quyền.");
    if (sheet.status !== "LOCKED" || !sheet.snapshot) throw new ConflictException({ code: "PAYROLL_NOT_LOCKED", message: `Kỳ lương ${sheet.payrollPeriod.code} chưa khóa; chỉ xuất phiếu lương và file chi từ bảng lương đã khóa.` });
    const content = JSON.parse(plainText(this.key, sheet.snapshot.contentCipher, "snapshot bảng lương")) as SnapshotContent;
    return { sheet, snapshot: sheet.snapshot, content };
  }

  /** Employees the user is excluded from (FR-1.4) never appear in outputs. */
  async excludedEmployees(user: AuthUser, employeeIds: string[], db: Db = this.prisma) {
    const rows = await db.employeeExclusion.findMany({ where: { userAccountId: user.id, employeeId: { in: employeeIds }, ...effectiveAt(businessDate()) }, select: { employeeId: true } });
    return new Set(rows.map(row => row.employeeId));
  }

  async names(siteOrgUnitId: string, at: Date, db: Db = this.prisma) {
    const [site, company, unit] = await Promise.all([
      db.orgUnitVersion.findFirst({ where: { orgUnitId: siteOrgUnitId, effectiveFrom: { lte: at } }, orderBy: { effectiveFrom: "desc" } }),
      db.orgUnitVersion.findFirst({ where: { type: "COMPANY", effectiveFrom: { lte: at } }, orderBy: { effectiveFrom: "desc" } }),
      db.orgUnit.findUnique({ where: { id: siteOrgUnitId }, select: { code: true } }),
    ]);
    return { siteName: site?.name ?? "", siteCode: unit?.code ?? "", companyName: company?.name ?? "" };
  }

  /** Parameter by PAYMENT_DATE basis (late payment, payslip rule) effective at the given date. */
  async parameter(paramCode: string, at: Date, db: Db = this.prisma) {
    const row = await db.legalParameter.findFirst({ where: { paramCode, scopeKey: "GLOBAL", subjectType: "ALL", ...effectiveAt(at) }, orderBy: { effectiveFrom: "desc" } });
    return row ? { id: row.id, value: String(row.value), legalBasis: row.legalBasis } : null;
  }
}
