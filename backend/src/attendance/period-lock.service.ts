import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { AuditService } from "../audit/audit.service";
import { businessDate } from "../auth/business-date";
import type { AuthUser } from "../auth/auth.types";
import { PrismaService } from "../database/prisma.service";
import { LeaveAccessService, type LeaveScope } from "../leave/leave-access.service";
import { TeamConfirmationService, type AccessItem } from "./team-confirmation.service";
import { WorkshopClosureService } from "./workshop-closure.service";
import type { AttendancePeriodLockDto, AttendancePeriodReturnDto } from "./period-lock.dto";

type Db = Prisma.TransactionClient;
type Issue = { code: string; message: string; workshopOrgUnitId?: string; workshopName?: string; teamOrgUnitId?: string; teamName?: string; employeeId?: string; employeeCode?: string; employeeName?: string; workDate?: string; sourceId?: string };
type LockedSnapshot = {
  schemaVersion: 1;
  period: { id: string; code: string; dateFrom: string; dateTo: string; scopeOrgUnitId: string; scopeName: string };
  summary: Record<string, number>;
  workshops: Array<Record<string, unknown>>;
  teams: Array<{ team: Record<string, unknown>; revision: number; sourceHash: string; confirmationId?: string; days: unknown[]; overtime: unknown[]; snapshot: { accessItems: AccessItem[] } & Record<string, unknown> }>;
  accessItems: AccessItem[];
  initialization: boolean;
  previousPeriod: { id: string; code: string; status: string; dateFrom: string; dateTo: string } | null;
};

type TeamSummary = { employees: number; scheduledDays: number; processedDays: number; workedMinutes: number; workUnits: number; leaveMinutes: number; approvedLeaveRequests: number; overtimeApprovedMinutes: number; overtimeActualMinutes: number; overtimeEligibleMinutes: number; blockers: number; warnings: number };
type LockTeam = { team: { id: string; code: string; name: string; siteId: string | null }; revision: number; sourceHash: string; confirmationId?: string; days: unknown[]; overtime: unknown[]; snapshot: { accessItems: AccessItem[] } & Record<string, unknown>; summary: TeamSummary };
type WorkshopEvidence = { workshop: { id: string; code: string; name: string; siteId: string }; state: string; revision: number; sourceHash: string; summary: TeamSummary; blockers: Issue[]; warnings: Issue[]; teams: Array<{ team: { id: string } }>; history: Array<{ id: string; action: string; sourceHash: string }> };

const DAY = 86_400_000;
const actor = { id: true, displayName: true } as const;
const key = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY);
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return "{" + Object.entries(value).filter(([, item]) => item !== undefined).sort(([left], [right]) => left.localeCompare(right)).map(([name, item]) => JSON.stringify(name) + ":" + canonical(item)).join(",") + "}";
}

function sourceHash(value: unknown) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

@Injectable()
export class AttendancePeriodLockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: LeaveAccessService,
    private readonly confirmations: TeamConfirmationService,
    private readonly closures: WorkshopClosureService,
    private readonly audit: AuditService,
  ) {}

  private transaction<T>(work: (db: Db) => Promise<T>) {
    return this.prisma.$transaction(async db => {
      await db.$queryRaw`SELECT pg_advisory_xact_lock(8210472)::text AS lock`;
      await db.$queryRaw`SELECT pg_advisory_xact_lock(8210473)::text AS lock`;
      return work(db);
    }, { isolationLevel: "Serializable", timeout: 90_000 }).catch(error => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") throw new ConflictException("Nguồn công đã đổi trong lúc khóa; tải lại trước khi thực hiện.");
      throw error;
    });
  }

  private assertReader(user: AuthUser) {
    if (!user.roles.includes("KT") || !user.permissions.includes("attendance.read")) throw new ForbiddenException("Chỉ KT có quyền rà soát kỳ công.");
  }

  private assertLocker(user: AuthUser) {
    this.assertReader(user);
    if (!user.permissions.includes("attendance.lock")) throw new ForbiddenException("KT chưa được cấp quyền khóa hoặc trả lại kỳ công.");
  }

  private async period(db: Db, periodId: string) {
    const period = await db.businessPeriod.findUnique({ where: { id: periodId } });
    if (!period || period.periodType !== "ATTENDANCE") throw new NotFoundException("Không tìm thấy kỳ công.");
    return period;
  }

  private async periodView(db: Db, period: { id: string; code: string; status: string; revision: number; dateFrom: Date; dateTo: Date; scopeOrgUnitId: string }) {
    const scope = await db.orgUnitVersion.findFirst({ where: { orgUnitId: period.scopeOrgUnitId, effectiveFrom: { lte: period.dateTo }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: period.dateTo } }] }, orderBy: { effectiveFrom: "desc" } });
    if (!scope) throw new NotFoundException("Không tìm thấy phạm vi kỳ công.");
    return { id: period.id, code: period.code, status: period.status, revision: period.revision, dateFrom: key(period.dateFrom), dateTo: key(period.dateTo), scopeOrgUnitId: period.scopeOrgUnitId, scopeName: scope.name };
  }

  private async assertAccessItems(db: Db, user: AuthUser, items: AccessItem[], scopeOrgUnitId: string, dateFrom: Date, dateTo: Date) {
    const scopes = new Map<string, LeaveScope>();
    const scoped = async (day: Date) => {
      const text = key(day);
      const cached = scopes.get(text);
      if (cached) return cached;
      const result = await this.access.scoped(user, "attendance.read", db, day);
      scopes.set(text, result);
      return result;
    };
    const current = await scoped(businessDate());
    if (!current.allowed.has(scopeOrgUnitId)) throw new NotFoundException("Không đủ phạm vi hiện tại để rà soát toàn kỳ công.");
    for (let day = dateFrom; day <= dateTo; day = addDays(day, 1)) {
      const dated = await scoped(day);
      if (!dated.allowed.has(scopeOrgUnitId)) throw new NotFoundException("Không đủ phạm vi trong toàn kỳ công.");
    }
    const people = await db.employee.findMany({ where: { id: { in: [...new Set(items.map(item => item.employeeId))] } }, include: { assignments: { where: { isPrimary: true } }, exclusions: { where: { userAccountId: user.id } } } });
    const byId = new Map(people.map(person => [person.id, person]));
    for (const item of items) {
      const person = byId.get(item.employeeId);
      if (!person) throw new NotFoundException("Không đủ phạm vi để rà soát toàn bộ nguồn công.");
      const visibleDate = person.status === "TERMINATED" && person.terminationDate ? person.terminationDate : businessDate();
      if (!person.assignments.some(assignment => assignment.effectiveFrom <= visibleDate && (!assignment.effectiveTo || assignment.effectiveTo >= visibleDate) && current.allowed.has(assignment.orgUnitId)) || person.exclusions.some(exclusion => exclusion.effectiveFrom <= businessDate() && (!exclusion.effectiveTo || exclusion.effectiveTo >= businessDate()))) throw new NotFoundException("Không đủ phạm vi hiện tại để rà soát toàn bộ nguồn công.");
      for (const dateText of [item.workDate, ...item.sourceDates]) {
        const day = new Date(dateText + "T00:00:00Z");
        const dated = await scoped(day);
        if (!dated.allowed.has(item.orgUnitId) || !person.assignments.some(assignment => assignment.orgUnitId === item.orgUnitId && assignment.effectiveFrom <= day && (!assignment.effectiveTo || assignment.effectiveTo >= day)) || person.exclusions.some(exclusion => exclusion.effectiveFrom <= day && (!exclusion.effectiveTo || exclusion.effectiveTo >= day))) throw new NotFoundException("Không đủ phạm vi tại ngày công hoặc ngày nguồn.");
      }
    }
  }

  private summary(teams: Array<{ summary: TeamSummary }>, workshopCount: number, closedWorkshopCount: number, blockerCount: number, warningCount: number) {
    return {
      workshops: workshopCount,
      closedWorkshops: closedWorkshopCount,
      employees: teams.reduce((total, team) => total + team.summary.employees, 0),
      scheduledDays: teams.reduce((total, team) => total + team.summary.scheduledDays, 0),
      processedDays: teams.reduce((total, team) => total + team.summary.processedDays, 0),
      workedMinutes: teams.reduce((total, team) => total + team.summary.workedMinutes, 0),
      workUnits: teams.reduce((total, team) => total + team.summary.workUnits, 0),
      leaveMinutes: teams.reduce((total, team) => total + team.summary.leaveMinutes, 0),
      approvedLeaveRequests: teams.reduce((total, team) => total + team.summary.approvedLeaveRequests, 0),
      overtimeApprovedMinutes: teams.reduce((total, team) => total + team.summary.overtimeApprovedMinutes, 0),
      overtimeActualMinutes: teams.reduce((total, team) => total + team.summary.overtimeActualMinutes, 0),
      overtimeEligibleMinutes: teams.reduce((total, team) => total + team.summary.overtimeEligibleMinutes, 0),
      blockers: blockerCount,
      warnings: warningCount,
    };
  }

  private async previousPeriod(db: Db, period: { scopeOrgUnitId: string; dateFrom: Date; periodType: string }) {
    const previous = await db.businessPeriod.findFirst({ where: { periodType: period.periodType as "ATTENDANCE", scopeOrgUnitId: period.scopeOrgUnitId, dateTo: { lt: period.dateFrom } }, orderBy: [{ dateTo: "desc" }, { dateFrom: "desc" }] });
    return previous ? { id: previous.id, code: previous.code, status: previous.status, dateFrom: key(previous.dateFrom), dateTo: key(previous.dateTo) } : null;
  }

  private async live(db: Db, user: AuthUser, periodId: string) {
    const period = await this.period(db, periodId);
    const periodView = await this.periodView(db, period);
    const workshopIds = await this.closures.relevantWorkshopIds(db, period);
    const workshopEvidence: WorkshopEvidence[] = [];
    const teams: LockTeam[] = [];
    for (const workshopOrgUnitId of workshopIds) {
      const workshop = await this.closures.buildPeriodEvidence(db, { periodId, workshopOrgUnitId });
      workshopEvidence.push(workshop);
      for (const team of workshop.teams) {
        const review = await this.confirmations.build(db, user, { periodId, teamOrgUnitId: team.team.id }, "attendance.read");
        const confirmation = review.history.find(entry => entry.sourceHash === review.sourceHash && entry.current);
        teams.push({ team: review.team, revision: review.revision, sourceHash: review.sourceHash, confirmationId: confirmation?.id, days: review.days, overtime: review.overtime, snapshot: review.snapshot, summary: review.summary });
      }
    }
    const accessItems = teams.flatMap(team => team.snapshot.accessItems);
    await this.assertAccessItems(db, user, accessItems, period.scopeOrgUnitId, period.dateFrom, period.dateTo);
    const workshops = workshopEvidence.map(review => {
      const close = review.history.find(entry => entry.action === "CLOSE" && entry.sourceHash === review.sourceHash);
      return { workshop: review.workshop, state: review.state, revision: review.revision, sourceHash: review.sourceHash, closureId: close?.id ?? null, summary: review.summary, blockers: review.blockers, warnings: review.warnings };
    });
    const blockers = workshopEvidence.flatMap(review => review.blockers).filter(blocker => !["PERIOD_NOT_OPEN", "PERIOD_FROZEN"].includes(blocker.code)) as Issue[];
    const warnings = workshopEvidence.flatMap(review => review.warnings) as Issue[];
    if (period.status !== "CLOSED") blockers.push({ code: "PERIOD_NOT_CLOSED", message: "Kỳ công phải ở trạng thái Đã chốt trước khi khóa." });
    for (const workshop of workshops) {
      if (workshop.state !== "CLOSED") blockers.push({ code: "WORKSHOP_NOT_FRESH", message: "Phân xưởng chưa được chốt bằng nguồn hiện tại.", workshopOrgUnitId: workshop.workshop.id, workshopName: workshop.workshop.name });
    }
    if (!workshops.length) blockers.push({ code: "NO_RELEVANT_WORKSHOPS", message: "Không có phân xưởng liên quan trong phạm vi kỳ công." });
    const previousPeriod = await this.previousPeriod(db, period);
    if (previousPeriod && previousPeriod.status !== "LOCKED") blockers.push({ code: "PREV_PERIOD_NOT_LOCKED", message: "Kỳ công trước cùng phạm vi chưa được khóa." });
    const summary = this.summary(teams, workshops.length, workshops.filter(workshop => workshop.state === "CLOSED").length, blockers.length, warnings.length);
    const source = json({
      schemaVersion: 1,
      period: { id: periodView.id, code: periodView.code, dateFrom: periodView.dateFrom, dateTo: periodView.dateTo, scopeOrgUnitId: periodView.scopeOrgUnitId, scopeName: periodView.scopeName },
      summary,
      workshops,
      teams: teams.map(({ summary: _summary, ...team }) => team),
      accessItems,
      initialization: previousPeriod === null,
      previousPeriod,
    }) as unknown as LockedSnapshot;
    return { period, periodView, source, sourceHash: sourceHash(source), summary, workshops, blockers, warnings, initialization: previousPeriod === null, previousPeriod };
  }

  private history(events: Array<{ id: string; revision: number; action: string; sourceHash: string; note: string; actor: { id: string; displayName: string }; occurredAt: Date; snapshot: Prisma.JsonValue }>) {
    return events.map(event => ({ id: event.id, revision: event.revision, action: event.action, sourceHash: event.sourceHash, note: event.note, actor: event.actor, occurredAt: event.occurredAt.toISOString(), snapshot: event.snapshot }));
  }

  private async locked(db: Db, user: AuthUser, periodId: string) {
    const period = await this.period(db, periodId);
    const event = await db.attendancePeriodLockEvent.findFirst({ where: { periodId, action: "LOCK" }, include: { actor: { select: actor } }, orderBy: { revision: "desc" } });
    if (!event) throw new ConflictException("Kỳ LOCKED không có nguồn khóa bất biến.");
    const snapshot = event.snapshot as unknown as LockedSnapshot;
    await this.assertAccessItems(db, user, snapshot.accessItems, snapshot.period.scopeOrgUnitId, new Date(snapshot.period.dateFrom + "T00:00:00Z"), new Date(snapshot.period.dateTo + "T00:00:00Z"));
    const events = await db.attendancePeriodLockEvent.findMany({ where: { periodId }, include: { actor: { select: actor } }, orderBy: { revision: "desc" } });
    return {
      period: { ...snapshot.period, status: period.status, revision: period.revision },
      sourceHash: event.sourceHash,
      revision: period.revision,
      canLock: false,
      canReturn: false,
      initialization: snapshot.initialization,
      previousPeriod: snapshot.previousPeriod,
      summary: snapshot.summary,
      blockers: [] as Issue[],
      warnings: [] as Issue[],
      workshops: snapshot.workshops,
      history: this.history(events),
      lockedSource: { id: event.id, sourceHash: event.sourceHash, actor: event.actor, occurredAt: event.occurredAt.toISOString(), snapshot: event.snapshot },
    };
  }

  async review(user: AuthUser, periodId: string) {
    this.assertReader(user);
    return this.prisma.$transaction(async db => {
      const period = await this.period(db, periodId);
      if (period.status === "LOCKED") return this.locked(db, user, periodId);
      const live = await this.live(db, user, periodId);
      const events = await db.attendancePeriodLockEvent.findMany({ where: { periodId }, include: { actor: { select: actor } }, orderBy: { revision: "desc" } });
      return {
        period: live.periodView,
        sourceHash: live.sourceHash,
        revision: live.period.revision,
        canLock: live.period.status === "CLOSED" && !live.blockers.length,
        canReturn: live.period.status === "CLOSED",
        initialization: live.initialization,
        previousPeriod: live.previousPeriod,
        summary: live.summary,
        blockers: live.blockers,
        warnings: live.warnings,
        workshops: live.workshops,
        history: this.history(events),
        lockedSource: null,
      };
    }, { isolationLevel: "RepeatableRead", timeout: 90_000 });
  }

  async lock(user: AuthUser, dto: AttendancePeriodLockDto, ip?: string) {
    this.assertLocker(user);
    return this.transaction(async db => {
      const period = await this.period(db, dto.periodId);
      if (period.status === "LOCKED") throw new ConflictException("Kỳ công đã khóa và không thể khóa lại.");
      const live = await this.live(db, user, dto.periodId);
      if (period.revision !== dto.revision || live.sourceHash !== dto.sourceHash) throw new ConflictException("Nguồn hoặc phiên bản kỳ công đã thay đổi; tải lại trước khi khóa.");
      if (period.status !== "CLOSED" || live.blockers.length) throw new ConflictException("Chưa đủ điều kiện khóa kỳ công: " + live.blockers.map(blocker => blocker.message).slice(0, 5).join(" "));
      if (live.warnings.length && !dto.acknowledgeWarnings) throw new BadRequestException("Phải xác nhận đã rà soát các cảnh báo trước khi khóa.");
      const updated = await db.businessPeriod.update({ where: { id: dto.periodId }, data: { status: "LOCKED", revision: { increment: 1 } } });
      const entry = await db.attendancePeriodLockEvent.create({ data: { periodId: dto.periodId, revision: updated.revision, action: "LOCK", sourceHash: live.sourceHash, note: dto.note?.trim() ?? "", snapshot: json(live.source), actorId: user.id } });
      await this.audit.record({ actorId: user.id, entityType: "attendance_period_lock", entityId: entry.id, action: "LOCK", result: "SUCCESS", newValue: json({ periodId: dto.periodId, revision: entry.revision, sourceHash: entry.sourceHash, summary: live.summary, initialization: live.initialization }), ipAddress: ip }, db);
      return { id: entry.id, revision: entry.revision, sourceHash: entry.sourceHash, occurredAt: entry.occurredAt.toISOString() };
    });
  }

  async return(user: AuthUser, dto: AttendancePeriodReturnDto, ip?: string) {
    this.assertLocker(user);
    return this.transaction(async db => {
      const period = await this.period(db, dto.periodId);
      if (period.status === "LOCKED") throw new ConflictException("Kỳ công đã khóa, không có đường trả lại hay mở khóa.");
      const live = await this.live(db, user, dto.periodId);
      if (period.revision !== dto.revision || live.sourceHash !== dto.sourceHash) throw new ConflictException("Nguồn hoặc phiên bản kỳ công đã thay đổi; tải lại trước khi trả lại.");
      if (period.status !== "CLOSED") throw new ConflictException("Chỉ kỳ công đã chốt mới được trả lại.");
      const nextRevision = period.revision + 1;
      const entry = await db.attendancePeriodLockEvent.create({ data: { periodId: dto.periodId, revision: nextRevision, action: "RETURN", sourceHash: live.sourceHash, note: dto.reason.trim(), snapshot: json({ period: live.periodView, summary: live.summary, sourceHash: live.sourceHash, returned: true }), actorId: user.id } });
      await db.businessPeriod.update({ where: { id: dto.periodId }, data: { status: "OPEN", revision: nextRevision } });
      await this.audit.record({ actorId: user.id, entityType: "attendance_period_lock", entityId: entry.id, action: "RETURN", result: "SUCCESS", newValue: json({ periodId: dto.periodId, revision: entry.revision, sourceHash: entry.sourceHash, reason: entry.note }), ipAddress: ip }, db);
      return { id: entry.id, revision: entry.revision, sourceHash: entry.sourceHash, occurredAt: entry.occurredAt.toISOString() };
    });
  }
}
