import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import ExcelJS from "exceljs";
import type { AuthUser } from "../auth/auth.types";
import { PrismaService } from "../database/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { ScopeService } from "../organization/scope.service";
import { AuditService, auditRecordHash } from "./audit.service";
import type { AuditQueryDto } from "./audit-search.dto";

const DAY = 86400000;
const DEFAULT_RANGE_DAYS = 7;
const MAX_RANGE_DAYS = 93;
const EXPORT_LIMIT = 20000;
const CHECK_BATCH = 2000;
export const AUDIT_PERMISSION = "audit.read";

// Salary-bearing keys are masked for AD (FR-1.1.4): AD audit the action, never the pay.
const SALARY_KEY = /amount|salary|wage|gross|^net$|netPay|^totals?$|bonus|allowance|deduction|income|cipher|price|insurableBase|^tax$|taxAmount/i;
const MASK = "***";

export function maskSalary(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskSalary);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SALARY_KEY.test(key) && item !== null ? MASK : maskSalary(item)]));
  return value;
}

function parseDay(value: string | undefined, label: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new BadRequestException(label + " không hợp lệ.");
  return date;
}

@Injectable()
export class AuditSearchService {
  private readonly logger = new Logger(AuditSearchService.name);
  constructor(private readonly prisma: PrismaService, private readonly scope: ScopeService, private readonly audit: AuditService, private readonly notifications: NotificationsService) {}

  /** AD sees records of units in their scope; only company-scope AD also see unscoped records (accounts, parameters). */
  private async visibility(user: AuthUser): Promise<Prisma.AuditLogWhereInput> {
    const scope = await this.scope.load(user, AUDIT_PERMISSION);
    if (scope.versions.some(version => version.type === "COMPANY")) return {};
    return { scopeOrgUnitId: { in: [...scope.allowed] } };
  }

  private async where(user: AuthUser, query: AuditQueryDto): Promise<Prisma.AuditLogWhereInput> {
    const to = parseDay(query.to, "Thời điểm kết thúc") ?? new Date();
    const from = parseDay(query.from, "Thời điểm bắt đầu") ?? new Date(to.getTime() - DEFAULT_RANGE_DAYS * DAY);
    if (from > to) throw new BadRequestException("Khoảng thời gian phải đúng thứ tự.");
    if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * DAY) throw new BadRequestException("Khoảng tra cứu tối đa " + MAX_RANGE_DAYS + " ngày.");
    const actor = query.actor?.trim();
    return {
      AND: [
        await this.visibility(user),
        { occurredAt: { gte: from, lte: to } },
        ...(actor ? [{ actor: { is: { OR: [{ username: { contains: actor, mode: "insensitive" as const } }, { displayName: { contains: actor, mode: "insensitive" as const } }] } } }] : []),
        ...(query.action ? [{ action: query.action }] : []),
        ...(query.entityType ? [{ entityType: query.entityType }] : []),
        ...(query.entityId ? [{ entityId: query.entityId.trim() }] : []),
        ...(query.result ? [{ result: query.result }] : []),
      ],
    };
  }

  private serialize(row: Prisma.AuditLogGetPayload<{ include: { actor: { select: { username: true; displayName: true } } } }>) {
    return {
      id: row.id.toString(), occurredAt: row.occurredAt.toISOString(), actor: row.actor ? { id: row.actorId, username: row.actor.username, displayName: row.actor.displayName } : null,
      entityType: row.entityType, entityId: row.entityId, action: row.action, result: row.result, ipAddress: row.ipAddress,
      scopeOrgUnitId: row.scopeOrgUnitId, oldValue: maskSalary(row.oldValue), newValue: maskSalary(row.newValue),
    };
  }

  /** Cursor pagination on the id: `cursor` is the smallest id of the previous page. */
  async search(user: AuthUser, query: AuditQueryDto) {
    const pageSize = Math.min(Number(query.pageSize ?? 50), 200);
    if (query.cursor && !/^\d+$/.test(query.cursor)) throw new BadRequestException("Con trỏ phân trang không hợp lệ.");
    const where = await this.where(user, query);
    const rows = await this.prisma.auditLog.findMany({
      where: query.cursor ? { AND: [where, { id: { lt: BigInt(query.cursor) } }] } : where,
      include: { actor: { select: { username: true, displayName: true } } }, orderBy: { id: "desc" }, take: pageSize + 1,
    });
    const page = rows.slice(0, pageSize);
    return { items: page.map(row => this.serialize(row)), nextCursor: rows.length > pageSize ? page[page.length - 1].id.toString() : null };
  }

  async facets(user: AuthUser) {
    await this.scope.load(user, AUDIT_PERMISSION);
    const [actions, entityTypes, results] = await Promise.all([
      this.prisma.auditLog.findMany({ distinct: ["action"], select: { action: true }, orderBy: { action: "asc" } }),
      this.prisma.auditLog.findMany({ distinct: ["entityType"], select: { entityType: true }, orderBy: { entityType: "asc" } }),
      this.prisma.auditLog.findMany({ distinct: ["result"], select: { result: true }, orderBy: { result: "asc" } }),
    ]);
    return { actions: actions.map(row => row.action), entityTypes: entityTypes.map(row => row.entityType), results: results.map(row => row.result) };
  }

  async export(user: AuthUser, query: AuditQueryDto, ip?: string): Promise<Buffer> {
    const where = await this.where(user, query);
    const total = await this.prisma.auditLog.count({ where });
    if (total > EXPORT_LIMIT) throw new BadRequestException("Kết quả vượt " + EXPORT_LIMIT + " bản ghi; thu hẹp điều kiện trước khi xuất.");
    const rows = await this.prisma.auditLog.findMany({ where, include: { actor: { select: { username: true, displayName: true } } }, orderBy: { id: "desc" } });
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet("Nhật ký kiểm toán");
    sheet.addRow(["Nhật ký kiểm toán — xuất bởi " + user.username + " lúc " + new Date().toISOString() + "; giá trị lương đã che"]);
    sheet.addRow(["Mã", "Thời điểm", "Người thực hiện", "Hành động", "Loại đối tượng", "Mã đối tượng", "Kết quả", "IP", "Giá trị cũ", "Giá trị mới"]);
    for (const row of rows.map(item => this.serialize(item)))
      sheet.addRow([row.id, row.occurredAt, row.actor?.username ?? "hệ thống", row.action, row.entityType, row.entityId, row.result, row.ipAddress ?? "",
        row.oldValue == null ? "" : JSON.stringify(row.oldValue), row.newValue == null ? "" : JSON.stringify(row.newValue)]);
    await this.audit.record({ actorId: user.id, entityType: "audit_log", entityId: "export", action: "EXPORT", result: "SUCCESS",
      newValue: { filters: { ...query, cursor: undefined, pageSize: undefined }, rows: rows.length }, ipAddress: ip, scopeOrgUnitId: null });
    return Buffer.from(await book.xlsx.writeBuffer());
  }

  /**
   * Recomputes every record hash in id order against the previous record (FR-1.6.1, NFR-26). A row edited or
   * deleted outside the application (trigger disabled by a DBA) breaks either its own hash or the next prev_hash.
   */
  async verifyChain(trigger: "SCHEDULED" | "MANUAL", userId?: string) {
    const startedAt = new Date();
    let expectedPrev = "0".repeat(64), cursor: bigint | null = null, fromId: bigint | null = null, toId: bigint | null = null, checked = 0;
    let broken: { id: bigint; reason: string } | null = null;
    while (!broken) {
      const batch: Awaited<ReturnType<typeof this.prisma.auditLog.findMany>> = await this.prisma.auditLog.findMany({ where: cursor === null ? {} : { id: { gt: cursor } }, orderBy: { id: "asc" }, take: CHECK_BATCH });
      if (!batch.length) break;
      for (const row of batch) {
        fromId ??= row.id; toId = row.id; checked++;
        if (row.prevHash !== expectedPrev) { broken = { id: row.id, reason: "CHAIN_BROKEN" }; break; }
        if (auditRecordHash(row) !== row.recordHash) { broken = { id: row.id, reason: "HASH_MISMATCH" }; break; }
        expectedPrev = row.recordHash;
      }
      cursor = batch[batch.length - 1].id;
    }
    const check = await this.prisma.auditIntegrityCheck.create({ data: {
      trigger, status: broken ? "BROKEN" : "VALID", fromId, toId, checkedCount: checked, firstBrokenId: broken?.id ?? null, failureReason: broken?.reason ?? null,
      startedAt, finishedAt: new Date(), triggeredById: userId ?? null,
    } });
    if (broken) {
      this.logger.error("Audit chain broken at record " + broken.id + " (" + broken.reason + ")");
      await this.notifications.emit({ type: "AUDIT_INTEGRITY_BROKEN", title: "Nhật ký kiểm toán bị can thiệp tại bản ghi #" + broken.id + " (" + broken.reason + ")",
        linkKey: "audit", roles: ["AD"], permission: AUDIT_PERMISSION, scopeOrgUnitId: null, payload: { checkId: check.id, firstBrokenId: broken.id.toString(), reason: broken.reason } });
    }
    return this.serializeCheck(check);
  }

  async runCheck(user: AuthUser, ip?: string) {
    const scope = await this.scope.load(user, AUDIT_PERMISSION);
    if (!scope.versions.some(version => version.type === "COMPANY")) throw new BadRequestException("Chỉ AD phạm vi công ty được chạy kiểm tra toàn chuỗi.");
    const result = await this.verifyChain("MANUAL", user.id);
    await this.audit.record({ actorId: user.id, entityType: "audit_integrity_check", entityId: result.id, action: "RUN", result: result.status, newValue: result, ipAddress: ip, scopeOrgUnitId: null });
    return result;
  }

  async checks(user: AuthUser) {
    await this.scope.load(user, AUDIT_PERMISSION);
    const rows = await this.prisma.auditIntegrityCheck.findMany({ orderBy: { startedAt: "desc" }, take: 30, include: { triggeredBy: { select: { username: true } } } });
    return { items: rows.map(row => ({ ...this.serializeCheck(row), triggeredBy: row.triggeredBy?.username ?? null })) };
  }

  private serializeCheck(row: { id: string; trigger: string; status: string; fromId: bigint | null; toId: bigint | null; checkedCount: number; firstBrokenId: bigint | null; failureReason: string | null; startedAt: Date; finishedAt: Date }) {
    return { id: row.id, trigger: row.trigger, status: row.status, fromId: row.fromId?.toString() ?? null, toId: row.toId?.toString() ?? null, checkedCount: row.checkedCount,
      firstBrokenId: row.firstBrokenId?.toString() ?? null, failureReason: row.failureReason, startedAt: row.startedAt.toISOString(), finishedAt: row.finishedAt.toISOString() };
  }
}
