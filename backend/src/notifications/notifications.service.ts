import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { Prisma, RoleCode } from "@prisma/client";
import type { AuthUser } from "../auth/auth.types";
import { businessDate } from "../auth/business-date";
import { PrismaService } from "../database/prisma.service";
import { effectiveAt } from "../organization/scope.service";

export type NotificationType =
  | "SHIFT_PLAN_PENDING" | "SHIFT_PLAN_RETURNED" | "SHIFT_SWAP_PENDING" | "SHIFT_SWAP_DECIDED"
  | "OVERTIME_PENDING" | "OVERTIME_DECIDED"
  | "WORKSHOP_CLOSED" | "ATTENDANCE_PERIOD_RETURNED" | "ATTENDANCE_PERIOD_LOCKED"
  | "PAYROLL_SHEET_DRAFT" | "PAYROLL_PAYMENT_DUE"
  | "PARAMETER_EXPIRING" | "AUDIT_INTEGRITY_BROKEN";

/** Frontend route a notification opens; the target screen re-checks the viewer's current permissions. */
export type NotificationLink = "shifts" | "overtime" | "attendance" | "payroll" | "settings" | "audit";

export interface NotificationEvent {
  type: NotificationType;
  title: string;
  linkKey: NotificationLink;
  payload?: Record<string, unknown>;
  /** Recipients' role assignment must cover this unit; null targets company-scope assignments only. */
  scopeOrgUnitId?: string | null;
  roles?: RoleCode[];
  permission?: string;
  /** Named recipients (e.g. the author of a returned request), still required to hold an active account. */
  userIds?: string[];
  /** The acting user never notifies themself. */
  actorId?: string;
  /** Recurring warnings (daily jobs) are emitted once per key. */
  dedupeKey?: string;
}

const RETENTION_DAYS = 90;
const COMMIT_PROBE_DELAYS_MS = [100, 500, 2000, 10000];

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  constructor(private readonly prisma: PrismaService) {}

  /** Ancestors-or-self of a unit on the business date, so an assignment on any of them covers it. */
  private async coveringUnits(unitId: string, asOf: Date): Promise<string[]> {
    const versions = await this.prisma.orgUnitVersion.findMany({ where: effectiveAt(asOf), select: { orgUnitId: true, parentId: true } });
    const parent = new Map(versions.map(version => [version.orgUnitId, version.parentId]));
    const chain: string[] = [];
    for (let current: string | null | undefined = unitId; current && !chain.includes(current); current = parent.get(current)) chain.push(current);
    return chain;
  }

  async recipients(event: NotificationEvent): Promise<string[]> {
    const asOf = businessDate();
    const users = new Set<string>();
    if (event.roles?.length) {
      const units = event.scopeOrgUnitId
        ? await this.coveringUnits(event.scopeOrgUnitId, asOf)
        : (await this.prisma.orgUnitVersion.findMany({ where: { type: "COMPANY", ...effectiveAt(asOf) }, select: { orgUnitId: true } })).map(row => row.orgUnitId);
      const assignments = await this.prisma.roleAssignment.findMany({
        where: { roleCode: { in: event.roles }, scopeOrgUnitId: { in: units }, ...effectiveAt(asOf), userAccount: { status: "ACTIVE" },
          ...(event.permission ? { role: { permissions: { has: event.permission } } } : {}) },
        select: { userAccountId: true },
      });
      for (const row of assignments) users.add(row.userAccountId);
    }
    if (event.userIds?.length) {
      const named = await this.prisma.userAccount.findMany({ where: { id: { in: event.userIds }, status: "ACTIVE" }, select: { id: true } });
      for (const row of named) users.add(row.id);
    }
    if (event.actorId) users.delete(event.actorId);
    return [...users];
  }

  /**
   * Called after the business transaction has committed. Never throws: a failed notification is logged and the
   * business result stands (FR-X.5). Returns the number of recipients notified.
   */
  async emit(event: NotificationEvent): Promise<number> {
    try {
      const recipients = await this.recipients(event);
      if (!recipients.length) return 0;
      return await this.prisma.$transaction(async db => {
        if (event.dedupeKey && await db.notification.findUnique({ where: { dedupeKey: event.dedupeKey }, select: { id: true } })) return 0;
        await db.notification.create({ data: {
          type: event.type, title: event.title.slice(0, 300), linkKey: event.linkKey, payload: (event.payload ?? {}) as Prisma.InputJsonValue,
          scopeOrgUnitId: event.scopeOrgUnitId ?? null, dedupeKey: event.dedupeKey ?? null,
          recipients: { create: recipients.map(userAccountId => ({ userAccountId })) },
        } });
        return recipients.length;
      });
    } catch (error) {
      this.logger.error("Notification " + event.type + " failed: " + (error instanceof Error ? error.message : String(error)));
      return 0;
    }
  }

  /**
   * For writers that run inside someone else's transaction (e.g. automatic return-to-draft): emits once `committed`
   * sees the change, and drops the event if it never becomes visible (the transaction rolled back).
   */
  emitWhenCommitted(committed: () => Promise<boolean>, event: NotificationEvent): void {
    const attempt = (index: number) => {
      setTimeout(async () => {
        try {
          if (await committed()) { await this.emit(event); return; }
        } catch (error) {
          this.logger.error("Notification probe " + event.type + " failed: " + (error instanceof Error ? error.message : String(error)));
        }
        if (index + 1 < COMMIT_PROBE_DELAYS_MS.length) attempt(index + 1);
      }, COMMIT_PROBE_DELAYS_MS[index]).unref();
    };
    attempt(0);
  }

  committedPayrollDraft(sheetId: string, revision: number) {
    return this.prisma.payrollSheetHistory.findFirst({ where: { sheetId, revision, toStatus: "DRAFT" }, select: { id: true } });
  }

  async list(user: AuthUser, query: { unreadOnly?: string; before?: string }) {
    const before = query.before ? new Date(query.before) : null;
    if (before && !Number.isFinite(before.getTime())) throw new BadRequestException("Mốc phân trang không hợp lệ.");
    const rows = await this.prisma.notificationRecipient.findMany({
      where: { userAccountId: user.id, ...(query.unreadOnly === "true" ? { readAt: null } : {}), ...(before ? { notification: { createdAt: { lt: before } } } : {}) },
      include: { notification: true }, orderBy: { notification: { createdAt: "desc" } }, take: 30,
    });
    return {
      items: rows.map(row => ({ id: row.notificationId, type: row.notification.type, title: row.notification.title, linkKey: row.notification.linkKey,
        payload: row.notification.payload, createdAt: row.notification.createdAt.toISOString(), readAt: row.readAt?.toISOString() ?? null })),
      unread: await this.unreadCount(user),
    };
  }

  async unreadCount(user: AuthUser) {
    return this.prisma.notificationRecipient.count({ where: { userAccountId: user.id, readAt: null } });
  }

  async markRead(user: AuthUser, ids: string[] | "ALL") {
    const updated = await this.prisma.notificationRecipient.updateMany({
      where: { userAccountId: user.id, readAt: null, ...(ids === "ALL" ? {} : { notificationId: { in: ids } }) },
      data: { readAt: new Date() },
    });
    return { updated: updated.count, unread: await this.unreadCount(user) };
  }

  /** Notifications are operational messages, not audit evidence; they are kept for 90 days. */
  async purge(now = new Date()) {
    const cutoff = new Date(now.getTime() - RETENTION_DAYS * 86400000);
    return (await this.prisma.notification.deleteMany({ where: { createdAt: { lt: cutoff } } })).count;
  }
}
