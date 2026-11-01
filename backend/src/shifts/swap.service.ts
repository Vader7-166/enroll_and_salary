import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type ShiftSwapStatus } from "@prisma/client";
import { AttendanceService } from "../attendance/attendance.service";
import { AuditService } from "../audit/audit.service";
import type { AuthUser } from "../auth/auth.types";
import { PrismaService } from "../database/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { effectiveAt, ScopeService } from "../organization/scope.service";
import { shiftWindow } from "./rotation";
import { ancestors, planInclude, ShiftsService } from "./shifts.service";

type Db = Prisma.TransactionClient;
const key = (value: Date) => value.toISOString().slice(0, 10);
function fail(kind: "conflict" | "bad" | "forbidden" | "missing", code: string, message: string, details?: Record<string, unknown>): never {
  const body = { code, message, ...(details ? { details } : {}) };
  throw kind === "conflict" ? new ConflictException(body) : kind === "forbidden" ? new ForbiddenException(body) : kind === "missing" ? new NotFoundException(body) : new BadRequestException(body);
}
const include = { employee: { select: { id: true, code: true, fullName: true } }, oldShift: true, newShift: true, teamOrgUnit: { select: { code: true } }, createdBy: { select: { id: true, displayName: true } },
  decidedBy: { select: { displayName: true } }, history: { orderBy: { occurredAt: "asc" as const }, include: { actor: { select: { displayName: true } } } } } satisfies Prisma.ShiftSwapRequestInclude;
type Swap = Prisma.ShiftSwapRequestGetPayload<{ include: typeof include }>;
export type SwapAction = "APPROVE" | "RETURN" | "REJECT";

/**
 * Post-approval shift swaps (FR-3.3.1, 3.4.2): the approved schedule stays in force (and drives attendance) until a QĐ
 * approves; approval rewrites that one schedule row with history and re-pairs the day while its period is open.
 */
@Injectable()
export class ShiftSwapService {
  constructor(private readonly prisma: PrismaService, private readonly scope: ScopeService, private readonly audit: AuditService, private readonly shifts: ShiftsService,
    private readonly attendance: AttendanceService, private readonly notifications: NotificationsService) {}

  private view(row: Swap) {
    const shift = (item: Swap["oldShift"]) => ({ id: item.id, code: item.code, name: item.name, startTime: item.startTime, endTime: item.endTime });
    return { id: row.id, scheduleId: row.scheduleId, planId: row.planId, teamOrgUnitId: row.teamOrgUnitId, teamCode: row.teamOrgUnit.code, employee: row.employee, workDate: key(row.workDate),
      oldShift: shift(row.oldShift), newShift: shift(row.newShift), reason: row.reason, status: row.status, revision: row.revision, createdBy: row.createdBy, createdAt: row.createdAt.toISOString(),
      decidedBy: row.decidedBy?.displayName ?? null, decidedAt: row.decidedAt?.toISOString() ?? null, decisionReason: row.decisionReason,
      history: row.history.map(item => ({ action: item.action, fromStatus: item.fromStatus, toStatus: item.toStatus, actor: item.actor.displayName, reason: item.reason, occurredAt: item.occurredAt.toISOString(), snapshot: item.snapshot })) };
  }

  private async newLine(db: Db, schedule: { employeeId: string; workDate: Date; planTeam: string }, newShiftId: string) {
    const shift = await db.shiftDefinition.findUnique({ where: { id: newShiftId } });
    const tree = await db.orgUnitVersion.findMany({ where: effectiveAt(schedule.workDate), select: { orgUnitId: true, parentId: true } });
    if (!shift || !shift.active || !ancestors(schedule.planTeam, tree).has(shift.orgUnitId)) fail("bad", "SHIFT_NOT_IN_SITE_POLICY", "Ca mới không thuộc chính sách ca của cơ sở hoặc đã ngừng dùng.");
    return { shift, line: { employeeId: schedule.employeeId, workDate: schedule.workDate, shiftId: shift.id, ...shiftWindow(key(schedule.workDate), shift), workMinutes: shift.workMinutes } };
  }

  /** Re-runs the plan checks for the new shift against every other row (rest, weekly cap, OT overlap, frozen period). */
  private async check(db: Db, user: AuthUser, teamOrgUnitId: string, line: Parameters<ShiftsService["validate"]>[3][number], scheduleId: string, permission: string) {
    try { await this.shifts.validate(db, user, teamOrgUnitId, [line], permission, undefined, [scheduleId]); }
    catch (error) {
      if (error instanceof ConflictException && /CLOSED hoặc LOCKED/.test(String((error.getResponse() as { message?: string }).message ?? error.message)))
        fail("conflict", "PERIOD_STATE_CONFLICT", "Ngày công thuộc kỳ đã chốt hoặc khóa; không đổi ca được.");
      if (error instanceof ConflictException) fail("conflict", "SHIFT_CONSTRAINT_VIOLATION", String((error.getResponse() as { message?: string }).message ?? error.message));
      throw error;
    }
  }

  async create(user: AuthUser, dto: { scheduleId: string; newShiftId: string; reason: string }, ip?: string) {
    if (!dto.reason.trim()) fail("bad", "REASON_REQUIRED", "Nhập lý do đổi ca.");
    const created = await this.shifts.transaction(async db => {
      const schedule = await db.shiftSchedule.findUnique({ where: { id: dto.scheduleId }, include: { plan: true } });
      if (!schedule) fail("missing", "NOT_FOUND", "Không tìm thấy lịch ca.");
      if (schedule.plan.status !== "APPROVED") fail("conflict", "PLAN_NOT_APPROVED", "Chỉ đề xuất đổi ca trên lịch đã duyệt; lịch nháp được sửa trực tiếp.");
      await this.shifts.visible(db, user, { teamOrgUnitId: schedule.plan.teamOrgUnitId, schedules: [schedule] }, "shift.plan");
      if (schedule.shiftId === dto.newShiftId) fail("bad", "SAME_SHIFT", "Ca mới trùng ca hiện tại.");
      if (await db.shiftSwapRequest.findFirst({ where: { scheduleId: schedule.id, status: "PENDING" }, select: { id: true } })) fail("conflict", "SWAP_PENDING", "Lịch ca này đã có đề xuất đổi đang chờ duyệt.");
      const { line } = await this.newLine(db, { employeeId: schedule.employeeId, workDate: schedule.workDate, planTeam: schedule.plan.teamOrgUnitId }, dto.newShiftId);
      await this.check(db, user, schedule.plan.teamOrgUnitId, line, schedule.id, "shift.plan");
      const row = await db.shiftSwapRequest.create({ data: { scheduleId: schedule.id, planId: schedule.planId, teamOrgUnitId: schedule.plan.teamOrgUnitId, employeeId: schedule.employeeId, workDate: schedule.workDate,
        oldShiftId: schedule.shiftId, newShiftId: dto.newShiftId, reason: dto.reason.trim(), createdById: user.id,
        history: { create: { action: "CREATE", fromStatus: null, toStatus: "PENDING", actorId: user.id, reason: dto.reason.trim(), snapshot: { oldShiftId: schedule.shiftId, newShiftId: dto.newShiftId, startAt: line.startAt.toISOString(), endAt: line.endAt.toISOString() } } } }, include });
      await this.audit.record({ actorId: user.id, entityType: "shift_swap_request", entityId: row.id, action: "CREATE", result: "SUCCESS", newValue: { scheduleId: schedule.id, workDate: key(schedule.workDate), oldShiftId: schedule.shiftId, newShiftId: dto.newShiftId, teamOrgUnitId: schedule.plan.teamOrgUnitId }, ipAddress: ip }, db);
      return this.view(row);
    });
    await this.notifications.emit({ type: "SHIFT_SWAP_PENDING", linkKey: "shifts", roles: ["QD"], permission: "shift.approve", scopeOrgUnitId: created.teamOrgUnitId, actorId: user.id,
      payload: { swapId: created.id, teamOrgUnitId: created.teamOrgUnitId }, title: "Đề xuất đổi ca " + created.employee.code + " ngày " + created.workDate + " (" + created.oldShift.code + " → " + created.newShift.code + ") chờ duyệt" });
    return { swap: created };
  }

  async decide(user: AuthUser, id: string, action: SwapAction, dto: { revision: number; reason?: string }, ip?: string) {
    const reason = dto.reason?.trim();
    if (action !== "APPROVE" && !reason) fail("bad", "REASON_REQUIRED", "Nhập lý do trả lại/từ chối.");
    const result = await this.shifts.transaction(async db => {
      const swap = await db.shiftSwapRequest.findUnique({ where: { id }, include: { schedule: true } });
      if (!swap) fail("missing", "NOT_FOUND", "Không tìm thấy đề xuất đổi ca.");
      await this.shifts.visible(db, user, { teamOrgUnitId: swap.teamOrgUnitId, schedules: [swap.schedule] }, "shift.approve");
      if (swap.createdById === user.id) fail("forbidden", "SELF_APPROVAL", "Không được tự duyệt đề xuất của mình.");
      if (swap.status !== "PENDING" || swap.revision !== dto.revision) fail("conflict", "STALE_REVISION", "Đề xuất đã thay đổi hoặc đã được xử lý; tải lại.");
      const status: ShiftSwapStatus = action === "APPROVE" ? "APPROVED" : action === "RETURN" ? "RETURNED" : "REJECTED";
      let snapshot: Prisma.InputJsonValue = { decision: action };
      let attendance: { state: string; dayId: string | null } | null = null;
      if (action === "APPROVE") {
        if (swap.schedule.shiftId !== swap.oldShiftId) fail("conflict", "SCHEDULE_CHANGED", "Lịch ca đã thay đổi sau khi lập đề xuất.");
        const { line } = await this.newLine(db, { employeeId: swap.employeeId, workDate: swap.workDate, planTeam: swap.teamOrgUnitId }, swap.newShiftId);
        await this.check(db, user, swap.teamOrgUnitId, line, swap.scheduleId, "shift.approve");
        const before = { shiftId: swap.schedule.shiftId, startAt: swap.schedule.startAt.toISOString(), endAt: swap.schedule.endAt.toISOString(), workMinutes: swap.schedule.workMinutes };
        await db.shiftSchedule.update({ where: { id: swap.scheduleId }, data: { shiftId: line.shiftId, startAt: line.startAt, endAt: line.endAt, workMinutes: line.workMinutes } });
        const plan = await db.shiftPlan.update({ where: { id: swap.planId }, data: { revision: { increment: 1 } }, include: planInclude });
        await this.shifts.record(db, user, plan, "SWAP", "APPROVED", "Đổi ca " + key(swap.workDate) + ": " + swap.reason, ip);
        const team = await db.orgAssignment.findFirst({ where: { employeeId: swap.employeeId, isPrimary: true, ...effectiveAt(swap.workDate) }, select: { orgUnitId: true } });
        attendance = await this.attendance.reprocessScheduleDay(user, db, { employeeId: swap.employeeId, workDate: key(swap.workDate), orgUnitId: team?.orgUnitId ?? swap.teamOrgUnitId, scheduleId: swap.scheduleId }, "shift.approve");
        snapshot = { decision: action, before, after: { shiftId: line.shiftId, startAt: line.startAt.toISOString(), endAt: line.endAt.toISOString(), workMinutes: line.workMinutes }, planRevision: plan.revision, attendance };
      }
      const row = await db.shiftSwapRequest.update({ where: { id }, data: { status, revision: { increment: 1 }, decidedById: user.id, decidedAt: new Date(), decisionReason: reason ?? null,
        history: { create: { action, fromStatus: "PENDING", toStatus: status, actorId: user.id, reason: reason ?? null, snapshot } } }, include });
      await this.audit.record({ actorId: user.id, entityType: "shift_swap_request", entityId: id, action, result: "SUCCESS", oldValue: { status: "PENDING" }, newValue: { status, reason: reason ?? null, attendance, teamOrgUnitId: swap.teamOrgUnitId }, ipAddress: ip }, db);
      return { swap: this.view(row), attendance };
    });
    const labels: Record<SwapAction, string> = { APPROVE: "đã được duyệt", RETURN: "bị trả lại", REJECT: "bị từ chối" };
    await this.notifications.emit({ type: "SHIFT_SWAP_DECIDED", linkKey: "shifts", userIds: [result.swap.createdBy.id], actorId: user.id, payload: { swapId: id, status: result.swap.status },
      title: "Đề xuất đổi ca " + result.swap.employee.code + " ngày " + result.swap.workDate + " " + labels[action] });
    return result;
  }

  async cancel(user: AuthUser, id: string, dto: { revision: number; reason: string }, ip?: string) {
    if (!dto.reason.trim()) fail("bad", "REASON_REQUIRED", "Nhập lý do hủy.");
    return this.shifts.transaction(async db => {
      const swap = await db.shiftSwapRequest.findUnique({ where: { id } });
      if (!swap) fail("missing", "NOT_FOUND", "Không tìm thấy đề xuất đổi ca.");
      if (swap.createdById !== user.id) fail("forbidden", "FORBIDDEN", "Chỉ người lập được hủy đề xuất.");
      if (swap.status !== "PENDING" || swap.revision !== dto.revision) fail("conflict", "STALE_REVISION", "Đề xuất đã thay đổi hoặc đã được xử lý.");
      const row = await db.shiftSwapRequest.update({ where: { id }, data: { status: "CANCELLED", revision: { increment: 1 }, history: { create: { action: "CANCEL", fromStatus: "PENDING", toStatus: "CANCELLED", actorId: user.id, reason: dto.reason.trim(), snapshot: {} } } }, include });
      await this.audit.record({ actorId: user.id, entityType: "shift_swap_request", entityId: id, action: "CANCEL", result: "SUCCESS", newValue: { reason: dto.reason.trim(), teamOrgUnitId: swap.teamOrgUnitId }, ipAddress: ip }, db);
      return { swap: this.view(row) };
    });
  }

  async list(user: AuthUser, query: { status?: string }) {
    const scope = await this.scope.load(user, "shift.read");
    const rows = await this.prisma.shiftSwapRequest.findMany({ where: { teamOrgUnitId: { in: [...scope.allowed] }, ...(query.status ? { status: query.status as ShiftSwapStatus } : {}) }, include, orderBy: [{ status: "asc" }, { workDate: "asc" }], take: 200 });
    return { items: rows.map(row => this.view(row)) };
  }
}
