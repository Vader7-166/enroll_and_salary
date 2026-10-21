import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { AuditService } from "../audit/audit.service";
import type { AuthUser } from "../auth/auth.types";
import { PrismaService } from "../database/prisma.service";
import { LeaveAccessService } from "../leave/leave-access.service";
import { TeamConfirmationService } from "./team-confirmation.service";
import type { WorkshopClosureDto, WorkshopReviewQuery, WorkshopReturnDto } from "./workshop-closure.dto";
import { workshopCrossChecks } from "./workshop-cross-checks";

type Db = Prisma.TransactionClient;
type TeamIssue = { code: string; message: string; employeeId?: string; workDate?: string; sourceId?: string };
type ClosureIssue = TeamIssue & { teamOrgUnitId?: string; teamName?: string; employeeCode?: string; employeeName?: string };

const DAY = 86_400_000;
const actor = { id: true, displayName: true } as const;
const key = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY);
const overlaps = (from: Date, to: Date) => ({ effectiveFrom: { lte: to }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }] });
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return "{" + Object.entries(value).filter(([, item]) => item !== undefined).sort(([left], [right]) => left.localeCompare(right)).map(([name, item]) => JSON.stringify(name) + ":" + canonical(item)).join(",") + "}";
}
const hash = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

@Injectable()
export class WorkshopClosureService {
  constructor(private readonly prisma: PrismaService, private readonly access: LeaveAccessService, private readonly confirmations: TeamConfirmationService, private readonly audit: AuditService) {}

  private transaction<T>(work: (db: Db) => Promise<T>) {
    return this.prisma.$transaction(async db => {
      await db.$queryRaw`SELECT pg_advisory_xact_lock(8210472)::text AS lock`;
      await db.$queryRaw`SELECT pg_advisory_xact_lock(8210473)::text AS lock`;
      return work(db);
    }, { isolationLevel: "Serializable", timeout: 90_000 }).catch(error => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") throw new ConflictException("Nguồn công đã đổi trong lúc chốt; tải lại trước khi thực hiện.");
      throw error;
    });
  }

  private async period(db: Db, periodId: string) {
    const period = await db.businessPeriod.findUnique({ where: { id: periodId } });
    if (!period || period.periodType !== "ATTENDANCE") throw new NotFoundException("Không tìm thấy kỳ công.");
    return period;
  }

  private async workshop(db: Db, user: AuthUser | null, periodId: string, workshopOrgUnitId: string, permission: string) {
    const period = await this.period(db, periodId);
    const versions = user ? (await this.access.scoped(user, permission, db)).versions : await db.orgUnitVersion.findMany({where:{effectiveFrom:{lte:period.dateTo},OR:[{effectiveTo:null},{effectiveTo:{gte:period.dateTo}}]},include:{orgUnit:true,site:true}});
    const unit = versions.find(version => version.orgUnitId === workshopOrgUnitId && version.type === "DEPARTMENT");
    if (!unit?.siteId) throw new NotFoundException("Không tìm thấy phân xưởng trong phạm vi.");
    for (let day = period.dateFrom; day <= period.dateTo; day = addDays(day, 1)) {
      const datedVersions = user ? (await this.access.scoped(user, permission, db, day)).versions : await db.orgUnitVersion.findMany({where:{effectiveFrom:{lte:day},OR:[{effectiveTo:null},{effectiveTo:{gte:day}}]},include:{orgUnit:true,site:true}});
      const dated = datedVersions.find(version => version.orgUnitId === workshopOrgUnitId && version.type === "DEPARTMENT");
      if (!dated || dated.siteId !== unit.siteId) throw new NotFoundException("Không đủ phạm vi phân xưởng trong toàn kỳ.");
    }
    return { period, workshop: { id: unit.orgUnitId, code: unit.orgUnit.code, name: unit.name, siteId: unit.siteId } };
  }

  private async relevantTeamIds(db: Db, period: { dateFrom: Date; dateTo: Date }, workshopOrgUnitId: string) {
    const [versions, schedules, assignments, punches, overtime, leaveRequests, corrections, daily] = await Promise.all([
      db.orgUnitVersion.findMany({ where: overlaps(period.dateFrom, period.dateTo), select: { orgUnitId: true, parentId: true, type: true, effectiveFrom: true, effectiveTo: true } }),
      db.shiftSchedule.findMany({ where: { workDate: { gte: period.dateFrom, lte: period.dateTo } }, select: { workDate: true, plan: { select: { teamOrgUnitId: true, status: true } } } }),
      db.orgAssignment.findMany({ where: { isPrimary: true, ...overlaps(period.dateFrom, period.dateTo) }, select: { employeeId: true, orgUnitId: true, effectiveFrom: true, effectiveTo: true } }),
      db.rawPunch.findMany({where:{punchedAt:{gte:new Date(period.dateFrom.getTime()-7*3_600_000),lt:addDays(period.dateTo,2)}},select:{employeeId:true,punchedAt:true,processing:{select:{workDate:true}}}}),
      db.overtimeRequest.findMany({where:{workDate:{gte:period.dateFrom,lte:period.dateTo},status:{in:["DRAFT","RETURNED","PENDING","APPROVED"]}},select:{teamOrgUnitId:true,workDate:true}}),
      db.leaveRequest.findMany({where:{dateFrom:{lte:period.dateTo},dateTo:{gte:period.dateFrom},status:{in:["DRAFT","RETURNED","PENDING","APPROVED"]}},select:{snapshot:true}}),
      db.attendanceCorrectionItem.findMany({where:{workDate:{gte:period.dateFrom,lte:period.dateTo},correction:{status:{in:["DRAFT","RETURNED","PENDING","APPROVED"]}}},select:{orgUnitId:true,workDate:true}}),
      db.dailyAttendance.findMany({where:{workDate:{gte:period.dateFrom,lte:period.dateTo}},select:{orgUnitId:true,workDate:true}}),
    ]);
    const related = new Set<string>();
    const isUnderWorkshop = (teamId: string, day: Date) => {
      const parents = new Map(versions.filter(version => version.effectiveFrom <= day && (!version.effectiveTo || version.effectiveTo >= day)).map(version => [version.orgUnitId, version.parentId]));
      const types = new Map(versions.filter(version => version.effectiveFrom <= day && (!version.effectiveTo || version.effectiveTo >= day)).map(version => [version.orgUnitId, version.type]));
      let cursor: string | null | undefined = teamId;
      const seen = new Set<string>();
      while (cursor && !seen.has(cursor)) {
        if (cursor === workshopOrgUnitId) return types.get(teamId) === "TEAM";
        seen.add(cursor); cursor = parents.get(cursor);
      }
      return false;
    };
    for (const row of schedules) if (!["REJECTED","CANCELLED"].includes(row.plan.status) && isUnderWorkshop(row.plan.teamOrgUnitId, row.workDate)) related.add(row.plan.teamOrgUnitId);
    for (const row of [...overtime.map(row=>({orgUnitId:row.teamOrgUnitId,workDate:row.workDate})),...corrections,...daily]) if(isUnderWorkshop(row.orgUnitId,row.workDate))related.add(row.orgUnitId);
    for(const request of leaveRequests)for(const line of (request.snapshot as unknown as {lines:Array<{orgUnitId:string;workDate:string}>}).lines){const day=new Date(line.workDate+"T00:00:00Z");if(day>=period.dateFrom&&day<=period.dateTo&&isUnderWorkshop(line.orgUnitId,day))related.add(line.orgUnitId);}
    for(const punch of punches){
      const day=punch.processing?.workDate??new Date(key(new Date(punch.punchedAt.getTime()+7*3_600_000))+"T00:00:00Z");
      if(day<period.dateFrom||day>period.dateTo)continue;
      for(const assignment of assignments)if(assignment.employeeId===punch.employeeId&&assignment.effectiveFrom<=day&&(!assignment.effectiveTo||assignment.effectiveTo>=day)&&isUnderWorkshop(assignment.orgUnitId,day))related.add(assignment.orgUnitId);
    }
    return [...related].sort();
  }



  async relevantWorkshopIds(db: Db, period: { scopeOrgUnitId: string; dateFrom: Date; dateTo: Date }) {
    const versions = await db.orgUnitVersion.findMany({ where: overlaps(period.dateFrom, period.dateTo), select: { orgUnitId: true, parentId: true, type: true, effectiveFrom: true, effectiveTo: true } });
    const ids = new Set<string>();
    for (const candidate of new Set(versions.filter(version=>version.type==="DEPARTMENT").map(version => version.orgUnitId))) {
      let belongs = true;
      for (let day = period.dateFrom; day <= period.dateTo; day = addDays(day, 1)) {
        const parents = new Map(versions.filter(version => version.effectiveFrom <= day && (!version.effectiveTo || version.effectiveTo >= day)).map(version => [version.orgUnitId, version.parentId]));
        let cursor: string | null | undefined = candidate; const seen = new Set<string>();
        while (cursor && !seen.has(cursor) && cursor !== period.scopeOrgUnitId) { seen.add(cursor); cursor = parents.get(cursor); }
        if (cursor !== period.scopeOrgUnitId) { belongs = false; break; }
      }
      if (belongs && (await this.relevantTeamIds(db, period, candidate)).length) ids.add(candidate);
    }
    return [...ids].sort();
  }

  private async build(db: Db, user: AuthUser | null, query: WorkshopReviewQuery, permission = "attendance.read") {
    const { period, workshop } = await this.workshop(db, user, query.periodId, query.workshopOrgUnitId, permission);
    const teamIds = await this.relevantTeamIds(db, period, workshop.id);
    const reviews = [];
    for (const teamOrgUnitId of teamIds) reviews.push(user ? await this.confirmations.build(db, user, { periodId: period.id, teamOrgUnitId }, permission) : await this.confirmations.buildPeriodEvidence(db, { periodId: period.id, teamOrgUnitId }));
    const records = await db.attendanceWorkshopClosure.findMany({ where: { periodId: period.id, workshopOrgUnitId: workshop.id }, include: { actor: { select: actor } }, orderBy: { revision: "desc" } });
    const latest = records[0];
    const teams = reviews.map(review => ({ team: review.team, state: review.state === "CONFIRMED" ? "CONFIRMED" : review.state === "WAITING" ? "WAITING" : "STALE", revision: review.revision, sourceHash: review.sourceHash, summary: review.summary, blockers: review.blockers, warnings: review.warnings }));
    const people = new Map(reviews.flatMap(review => review.snapshot.roster.map(person => [person.id, person] as const)));
    const blockers: ClosureIssue[] = teams.flatMap(team => team.blockers.map(issue => ({ ...issue, employeeCode: issue.employeeId ? people.get(issue.employeeId)?.code : undefined, employeeName: issue.employeeId ? people.get(issue.employeeId)?.fullName : undefined, teamOrgUnitId: team.team.id, teamName: team.team.name })));
    const warnings: ClosureIssue[] = teams.flatMap(team => team.warnings.map(issue => ({ ...issue, employeeCode: issue.employeeId ? people.get(issue.employeeId)?.code : undefined, employeeName: issue.employeeId ? people.get(issue.employeeId)?.fullName : undefined, teamOrgUnitId: team.team.id, teamName: team.team.name })));
    for (const team of teams) {
      if (team.state === "WAITING") blockers.push({ code: "TEAM_NOT_CONFIRMED", message: "Tổ chưa xác nhận công.", teamOrgUnitId: team.team.id, teamName: team.team.name });
      if (team.state === "STALE") blockers.push({ code: "TEAM_CONFIRMATION_STALE", message: "Xác nhận tổ không còn khớp nguồn công hiện tại.", teamOrgUnitId: team.team.id, teamName: team.team.name });
    }
    const crossChecks = await workshopCrossChecks(db, period, workshop, reviews);
    blockers.push(...crossChecks.blockers); warnings.push(...crossChecks.warnings);
    if (!teams.length) blockers.push({ code: "NO_RELEVANT_TEAMS", message: "Phân xưởng chưa có tổ liên quan theo nhân sự đang hiệu lực hoặc lịch ca trong kỳ." });
    const sourceHash = hash({ period: { id: period.id, dateFrom: key(period.dateFrom), dateTo: key(period.dateTo) }, workshop, crossChecks: crossChecks.source, teams: teams.map(team => ({ id: team.team.id, revision: team.revision, sourceHash: team.sourceHash, state: team.state, summary: { employees: team.summary.employees, scheduledDays: team.summary.scheduledDays, processedDays: team.summary.processedDays, workedMinutes: team.summary.workedMinutes, workUnits: team.summary.workUnits, leaveMinutes: team.summary.leaveMinutes, approvedLeaveRequests: team.summary.approvedLeaveRequests, overtimeApprovedMinutes: team.summary.overtimeApprovedMinutes, overtimeActualMinutes: team.summary.overtimeActualMinutes, overtimeEligibleMinutes: team.summary.overtimeEligibleMinutes } })) });
    const materialBlockers = blockers.filter(blocker => !["PERIOD_NOT_OPEN", "PERIOD_FROZEN"].includes(blocker.code));
    const state = latest?.action === "CLOSE" ? latest.sourceHash === sourceHash && !materialBlockers.length ? "CLOSED" : "STALE" : latest?.action === "RETURN" ? "RETURNED" : "WAITING";
    const summary = { teams: teams.length, confirmedTeams: teams.filter(team => team.state === "CONFIRMED").length, employees: teams.reduce((total, team) => total + team.summary.employees, 0), scheduledDays: teams.reduce((total, team) => total + team.summary.scheduledDays, 0), processedDays: teams.reduce((total, team) => total + team.summary.processedDays, 0), workedMinutes: teams.reduce((total, team) => total + team.summary.workedMinutes, 0), workUnits: teams.reduce((total, team) => total + team.summary.workUnits, 0), leaveMinutes: teams.reduce((total, team) => total + (team.summary.leaveMinutes ?? 0), 0), approvedLeaveRequests: teams.reduce((total, team) => total + (team.summary.approvedLeaveRequests ?? 0), 0), overtimeApprovedMinutes: teams.reduce((total, team) => total + (team.summary.overtimeApprovedMinutes ?? 0), 0), overtimeActualMinutes: teams.reduce((total, team) => total + (team.summary.overtimeActualMinutes ?? 0), 0), overtimeEligibleMinutes: teams.reduce((total, team) => total + (team.summary.overtimeEligibleMinutes ?? 0), 0), blockers: blockers.length, warnings: warnings.length };
    const history = records.map(record => ({ id: record.id, revision: record.revision, action: record.action, sourceHash: record.sourceHash, note: record.note, actor: record.actor, occurredAt: record.occurredAt.toISOString(), snapshot: record.snapshot }));
    return { period: { id: period.id, code: period.code, status: period.status, revision: period.revision, dateFrom: key(period.dateFrom), dateTo: key(period.dateTo) }, workshop, sourceHash, revision: latest?.revision ?? 0, state, canClose: period.status === "OPEN" && !blockers.length && state !== "CLOSED", canReturn: period.status === "OPEN" && latest?.action === "CLOSE", summary, blockers, warnings, teams, history };
  }

  async buildPeriodEvidence(db: Db, query: WorkshopReviewQuery) {
    return this.build(db, null, query);
  }

  async workshops(user: AuthUser, periodId: string) {
    return this.prisma.$transaction(async db => {
      const period = await this.period(db, periodId);
      const scope = await this.access.scoped(user, "attendance.read", db);
      const relevant = new Set(await this.relevantWorkshopIds(db, period));
      const units = scope.versions.filter(version => version.type === "DEPARTMENT" && version.siteId && relevant.has(version.orgUnitId));
      const items = units.map(unit => ({ id: unit.orgUnitId, code: unit.orgUnit.code, name: unit.name, siteId: unit.siteId }));
      return { items: items.sort((left, right) => left.code.localeCompare(right.code)) };
    }, { isolationLevel: "RepeatableRead", timeout: 90_000 });
  }

  async review(user: AuthUser, query: WorkshopReviewQuery) {
    return this.prisma.$transaction(db => this.build(db, user, query), { isolationLevel: "RepeatableRead", timeout: 90_000 });
  }

  private assertQd(user: AuthUser) {
    if (!user.roles.includes("QD") || !user.permissions.includes("attendance.review")) throw new ForbiddenException("Chỉ QĐ có quyền rà soát công mới được chốt/trả phân xưởng.");
  }

  async close(user: AuthUser, dto: WorkshopClosureDto, ip?: string) {
    this.assertQd(user);
    return this.transaction(async db => {
      const review = await this.build(db, user, dto, "attendance.review");
      if (review.revision !== dto.revision || review.sourceHash !== dto.sourceHash) throw new ConflictException("Nguồn hoặc xác nhận tổ đã thay đổi; tải lại trước khi chốt.");
      if (!review.canClose) throw new ConflictException("Chưa đủ điều kiện chốt phân xưởng: " + review.blockers.map(blocker => blocker.message).slice(0, 5).join(" "));
      if (review.warnings.length && !dto.acknowledgeWarnings) throw new BadRequestException("Phải xác nhận đã rà soát các cảnh báo trước khi chốt.");
      const { history, ...snapshot } = review;
      const entry = await db.attendanceWorkshopClosure.create({ data: { periodId: dto.periodId, workshopOrgUnitId: dto.workshopOrgUnitId, revision: dto.revision + 1, action: "CLOSE", sourceHash: review.sourceHash, note: dto.note?.trim() ?? "", snapshot: json({ ...snapshot, summary: review.summary, reviewed: true, acknowledgeWarnings: dto.acknowledgeWarnings }), actorId: user.id } });
      const currentPeriod = await this.period(db, dto.periodId);
      const relevant = await this.relevantWorkshopIds(db, currentPeriod);
      const valid = new Map<string, boolean>();
      for (const workshopOrgUnitId of relevant) {
        const currentHistory = await db.attendanceWorkshopClosure.findFirst({ where: { periodId: dto.periodId, workshopOrgUnitId }, orderBy: { revision: "desc" } });
        if(currentHistory?.action!=="CLOSE"){valid.set(workshopOrgUnitId,false);continue;}
        const current = workshopOrgUnitId === dto.workshopOrgUnitId ? review : await this.build(db, null, { periodId: dto.periodId, workshopOrgUnitId });
        valid.set(workshopOrgUnitId, current.state === "CLOSED" || (current.sourceHash === currentHistory?.sourceHash && currentHistory?.action === "CLOSE" && !current.blockers.some(blocker => !["PERIOD_NOT_OPEN", "PERIOD_FROZEN"].includes(blocker.code))));
      }
      const periodClosed = relevant.length > 0 && relevant.every(workshopOrgUnitId => valid.get(workshopOrgUnitId));
      if (periodClosed) await db.businessPeriod.update({ where: { id: dto.periodId }, data: { status: "CLOSED", revision: { increment: 1 } } });
      await this.audit.record({ actorId: user.id, entityType: "attendance_workshop_closure", entityId: entry.id, action: "CLOSE", result: "SUCCESS", newValue: json({ periodId: dto.periodId, workshopOrgUnitId: dto.workshopOrgUnitId, revision: entry.revision, sourceHash: entry.sourceHash, summary: review.summary }), ipAddress: ip }, db);
      return { id: entry.id, revision: entry.revision, sourceHash: entry.sourceHash, closedAt: entry.occurredAt.toISOString(), periodClosed };
    });
  }

  async return(user: AuthUser, dto: WorkshopReturnDto, ip?: string) {
    this.assertQd(user);
    return this.transaction(async db => {
      const review = await this.build(db, user, dto, "attendance.review");
      if (review.period.status !== "OPEN") throw new ConflictException("Chỉ trả phân xưởng khi kỳ công đang OPEN.");
      if (!review.canReturn || review.revision !== dto.revision || review.sourceHash !== dto.sourceHash) throw new ConflictException("Nguồn hoặc phiên bản chốt không còn hiệu lực để trả lại.");
      const entry = await db.attendanceWorkshopClosure.create({ data: { periodId: dto.periodId, workshopOrgUnitId: dto.workshopOrgUnitId, revision: dto.revision + 1, action: "RETURN", sourceHash: review.sourceHash, note: dto.reason.trim(), snapshot: json({ prior: review.history[0], returned: true }), actorId: user.id } });
      await this.audit.record({ actorId: user.id, entityType: "attendance_workshop_closure", entityId: entry.id, action: "RETURN", result: "SUCCESS", newValue: json({ periodId: dto.periodId, workshopOrgUnitId: dto.workshopOrgUnitId, revision: entry.revision, reason: entry.note }), ipAddress: ip }, db);
      return { id: entry.id, revision: entry.revision, returnedAt: entry.occurredAt.toISOString() };
    });
  }
}
