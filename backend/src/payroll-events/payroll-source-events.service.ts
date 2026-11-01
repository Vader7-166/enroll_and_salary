import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { NotificationsService } from "../notifications/notifications.service";

type Db = Prisma.TransactionClient;

/**
 * Source-change listener (FR-7.5.1, UAT-10): any change to a payroll source after approval moves the affected
 * APPROVED sheets of OPEN periods back to DRAFT inside the writer's own transaction. The lock-time source hash
 * check is the safety net for writers that do not call this.
 */
@Injectable()
export class PayrollSourceEvents {
  constructor(private readonly audit: AuditService, private readonly notifications: NotificationsService) {}

  async returnToDraft(db: Db, sheetId: string, actorId: string | null, reason: string, action = "RETURN_TO_DRAFT") {
    const sheet = await db.payrollSheet.findUniqueOrThrow({ where: { id: sheetId }, include: { payrollPeriod: { select: { code: true, siteOrgUnitId: true } } } });
    if (sheet.status !== "APPROVED") return false;
    const updated = await db.payrollSheet.update({ where: { id: sheetId }, data: { status: "DRAFT", approvedSourceHash: null, approvedAt: null, approvedById: null, revision: { increment: 1 }, updatedAt: new Date() } });
    await db.payrollSheetHistory.create({ data: { sheetId, action, fromStatus: "APPROVED", toStatus: "DRAFT", revision: updated.revision, sourceHash: sheet.sourceHash, reason: reason.slice(0, 2000), actorId } });
    await this.audit.record({ actorId: actorId ?? undefined, entityType: "payroll_sheet", entityId: sheetId, action, result: "SUCCESS", oldValue: { status: "APPROVED", revision: sheet.revision }, newValue: { status: "DRAFT", revision: updated.revision, reason } }, db);
    // Runs inside the caller's transaction: notify only once the DRAFT history row is visible, i.e. committed.
    this.notifications.emitWhenCommitted(
      async () => !!await this.notifications.committedPayrollDraft(sheetId, updated.revision),
      { type: "PAYROLL_SHEET_DRAFT", linkKey: "payroll", roles: ["KT"], permission: "payroll.read", scopeOrgUnitId: sheet.payrollPeriod.siteOrgUnitId, actorId: actorId ?? undefined,
        payload: { sheetId, payrollPeriodId: sheet.payrollPeriodId, revision: updated.revision }, title: "Bảng lương kỳ " + sheet.payrollPeriod.code + " đã về nháp: " + reason.slice(0, 200) });
    return true;
  }

  async changed(db: Db, input: { payrollPeriodIds?: string[]; employeeIds?: string[]; all?: boolean; source: string; reason: string; actorId: string | null }) {
    const sheets = await db.payrollSheet.findMany({
      where: {
        status: "APPROVED", payrollPeriod: { status: "OPEN" },
        ...(input.all ? {} : { OR: [
          ...(input.payrollPeriodIds?.length ? [{ payrollPeriodId: { in: input.payrollPeriodIds } }] : []),
          ...(input.employeeIds?.length ? [{ employees: { some: { employeeId: { in: input.employeeIds } } } }] : []),
        ] }),
      },
      select: { id: true },
    });
    if (!input.all && !input.payrollPeriodIds?.length && !input.employeeIds?.length) return [];
    for (const sheet of sheets) await this.returnToDraft(db, sheet.id, input.actorId, input.source + ": " + input.reason, "AUTO_DRAFT");
    return sheets.map(sheet => sheet.id);
  }
}
