import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, InternalServerErrorException } from "@nestjs/common";
import { Prisma, ShiftPlanStatus } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { businessDate } from "../auth/business-date";
import type { AuthUser } from "../auth/auth.types";
import { PrismaService } from "../database/prisma.service";
import { effectiveAt, ScopeService } from "../organization/scope.service";
import { CreatePlanDto, CreateShiftDto, MembersQueryDto, PlanActionDto, PlanQueryDto, ShiftActiveDto, ShiftQueryDto, UpdatePlanDto, UpdateShiftDto } from "./shifts.dto";

type Db = Prisma.TransactionClient;
type Scope = { asOf: Date; allowed: Set<string>; versions: Array<Prisma.OrgUnitVersionGetPayload<{ include: { orgUnit: true; site: true } }>> };
type Member = { id: string; code: string; fullName: string };
export interface PlanSnapshot {
  id: string; teamOrgUnitId: string; teamOrgUnitCode: string; title: string; status: ShiftPlanStatus; revision: number;
  createdBy: { id: string; displayName: string }; createdAt: string; updatedAt: string;
  entries: Array<{ id: string; employee: Member; workDate: string; shift: Omit<Prisma.ShiftDefinitionGetPayload<object>, "createdAt"> & { createdAt: string }; startAt: string; endAt: string; workMinutes: number }>;
}
const DAY = 86400000;
const MINUTE = 60000;
const planInclude = { teamOrgUnit: true, createdBy: { select: { id: true, displayName: true } }, schedules: { orderBy: [{ workDate: "asc" as const }, { employeeId: "asc" as const }], include: { employee: { select: { id: true, code: true, fullName: true } }, shift: true } } } satisfies Prisma.ShiftPlanInclude;
type Plan = Prisma.ShiftPlanGetPayload<{ include: typeof planInclude }>;
type Line = { employeeId: string; workDate: Date; shiftId: string; startAt: Date; endAt: Date; workMinutes: number };
type PlanAccess = { teamOrgUnitId: string; schedules: Array<Pick<Line, "employeeId" | "workDate">> };
const parameterNames = { daily: "SHIFT_MAX_DAILY_MINUTES", weekly: "SHIFT_MAX_WEEKLY_MINUTES", rest: "SHIFT_MIN_REST_MINUTES", dayBreak: "SHIFT_MIN_DAY_BREAK_MINUTES", nightBreak: "SHIFT_MIN_NIGHT_BREAK_MINUTES" };
type Policy = Record<keyof typeof parameterNames, number>;
function key(date: Date) { return date.toISOString().slice(0, 10); }
function date(value: string) {
  const parsed = new Date(value + "T00:00:00Z");
  if (!Number.isFinite(parsed.getTime()) || key(parsed) !== value) throw new BadRequestException("Ngày phân ca không hợp lệ.");
  return parsed;
}
function minute(time: string) { const [h, m] = time.split(":").map(Number); return h * 60 + m; }
function ancestors(unitId: string, versions: Array<{ orgUnitId: string; parentId: string | null }>) {
  const parent = new Map(versions.map(v => [v.orgUnitId, v.parentId]));
  const result = new Set<string>();
  let id: string | null | undefined = unitId;
  while (id && !result.has(id)) { result.add(id); id = parent.get(id); }
  return result;
}
function serialized(plan: Plan): PlanSnapshot {
  return { id: plan.id, teamOrgUnitId: plan.teamOrgUnitId, teamOrgUnitCode: plan.teamOrgUnit.code, title: plan.title, status: plan.status, revision: plan.revision, createdBy: plan.createdBy, createdAt: plan.createdAt.toISOString(), updatedAt: plan.updatedAt.toISOString(),
    entries: plan.schedules.map(s => ({ id: s.id, employee: s.employee, workDate: key(s.workDate), shift: { ...s.shift, createdAt: s.shift.createdAt.toISOString() }, startAt: s.startAt.toISOString(), endAt: s.endAt.toISOString(), workMinutes: s.workMinutes })) };
}

@Injectable()
export class ShiftsService {
  constructor(private readonly prisma: PrismaService, private readonly scope: ScopeService, private readonly audit: AuditService) {}

  private async transaction<T>(fn: (db: Db) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async db => {
      // Shares the period-write lock so scheduling cannot race period closure.
      await db.$queryRaw`SELECT pg_advisory_xact_lock(8210472)::text AS lock`;
      return fn(db);
    }, { isolationLevel: "Serializable", timeout: 30000 });
  }

  private async unitScope(user: AuthUser, permission: string, unitId: string, workDates: Date[], db: Db) {
    const current = await this.scope.load(user, permission, db);
    if (!current.allowed.has(unitId)) throw new ForbiddenException("Đơn vị nằm ngoài phạm vi hiện tại của bạn.");
    const dated = new Map<string, Scope>();
    for (const workDate of workDates) {
      if (dated.has(key(workDate))) continue;
      const atDate = await this.scope.load(user, permission, db, workDate);
      if (!atDate.allowed.has(unitId)) throw new ForbiddenException("Không có quyền hoặc đơn vị không hiệu lực tại ngày phân ca.");
      dated.set(key(workDate), atDate);
    }
    return { current, dated };
  }

  private async policy(db: Db, unitId: string, workDate: Date, scope: Pick<Scope, "versions">): Promise<Policy> {
    const version = scope.versions.find(v => v.orgUnitId === unitId);
    if (!version) throw new ForbiddenException("Không có đơn vị hiệu lực.");
    const scopes = version.site ? ["SITE:" + version.site.id, "REGION:" + version.site.wageRegionCode, "GLOBAL"] : ["GLOBAL"];
    const rows = await db.legalParameter.findMany({ where: { paramCode: { in: Object.values(parameterNames) }, scopeKey: { in: scopes }, subjectType: "ALL", applicationBasis: "WORK_DATE", ...effectiveAt(workDate) } });
    const result = {} as Policy;
    for (const name of Object.keys(parameterNames) as Array<keyof Policy>) {
      const row = scopes.map(s => rows.find(r => r.scopeKey === s && r.paramCode === parameterNames[name])).find(Boolean);
      const raw = row?.value;
      const value = typeof raw === "number" || typeof raw === "string" ? Number(raw) : NaN;
      if (!Number.isSafeInteger(value) || value <= 0) throw new InternalServerErrorException("Thiếu hoặc sai tham số thời giờ: " + parameterNames[name]);
      result[name] = value;
    }
    if (result.daily > 480 || result.weekly > 2880 || result.rest < 720 || result.dayBreak < 30 || result.nightBreak < 45)
      throw new ConflictException("Tham số thời giờ làm việc không được nới lỏng giới hạn pháp luật/BR-11.");
    return result;
  }

  private definitionData(dto: CreateShiftDto, policy: Policy) {
    const start = minute(dto.startTime), end = minute(dto.endTime) + (dto.crossesMidnight ? 1440 : 0);
    const duration = end - start;
    if (duration <= 0 || duration > 1440 || dto.crossesMidnight !== (minute(dto.endTime) <= start))
      throw new BadRequestException("Giờ kết thúc và cờ qua ngày không khớp; ca phải dài hơn 0 và không quá 24 giờ.");
    if (dto.breakStartOffset + dto.breakMinutes > duration || (dto.breakMinutes > 0 && (dto.breakStartOffset === 0 || dto.breakStartOffset + dto.breakMinutes >= duration)))
      throw new BadRequestException("Nghỉ giữa ca phải nằm bên trong khung giờ ca.");
    const workMinutes = duration - (dto.paidBreak ? 0 : dto.breakMinutes);
    if (workMinutes <= 0 || workMinutes > policy.daily) throw new BadRequestException("Ca vượt giới hạn giờ làm việc bình thường trong ngày.");
    const isNightShift = start < 360 || end > 1320;
    if (dto.kind === "NIGHT" && !isNightShift) throw new BadRequestException("Ca đêm phải có thời gian trong khung 22:00–06:00.");
    if (workMinutes >= 360 && dto.breakMinutes < (isNightShift ? policy.nightBreak : policy.dayBreak))
      throw new BadRequestException(isNightShift ? "Ca có giờ đêm từ 6 giờ phải nghỉ giữa ca ít nhất 45 phút." : "Ca từ 6 giờ phải nghỉ giữa ca ít nhất 30 phút.");
    return { orgUnitId: dto.orgUnitId, code: dto.code, name: dto.name.trim(), kind: dto.kind, startTime: dto.startTime, endTime: dto.endTime, crossesMidnight: dto.crossesMidnight, breakStartOffset: dto.breakStartOffset, breakMinutes: dto.breakMinutes, paidBreak: dto.paidBreak, workMinutes, isNightShift };
  }

  async definitions(user: AuthUser, query: ShiftQueryDto) {
    const scoped = await this.scope.load(user, "shift.read");
    const versions = await this.prisma.orgUnitVersion.findMany({ where: effectiveAt(businessDate()), select: { orgUnitId: true, parentId: true } });
    if (query.orgUnitId && !scoped.allowed.has(query.orgUnitId)) throw new ForbiddenException("Đơn vị ngoài phạm vi.");
    const visible = new Set<string>();
    for (const id of query.orgUnitId ? [query.orgUnitId] : scoped.allowed) for (const parent of ancestors(id, versions)) visible.add(parent);
    return { items: await this.prisma.shiftDefinition.findMany({ where: { orgUnitId: { in: [...visible] } }, orderBy: [{ code: "asc" }, { orgUnitId: "asc" }] }) };
  }

  async createDefinition(user: AuthUser, dto: CreateShiftDto, ipAddress?: string) {
    return this.transaction(async db => {
      const access = await this.unitScope(user, "shift.manage", dto.orgUnitId, [businessDate()], db);
      const shift = await db.shiftDefinition.create({ data: this.definitionData(dto, await this.policy(db, dto.orgUnitId, businessDate(), access.current)) });
      await this.audit.record({ actorId: user.id, entityType: "shift_definition", entityId: shift.id, action: "CREATE", result: "SUCCESS", newValue: { code: shift.code, orgUnitId: shift.orgUnitId }, ipAddress }, db);
      return { shift };
    });
  }

  async updateDefinition(user: AuthUser, id: string, dto: UpdateShiftDto, ipAddress?: string) {
    return this.transaction(async db => {
      const old = await db.shiftDefinition.findUnique({ where: { id } });
      if (!old) throw new NotFoundException("Không tìm thấy ca.");
      const access = await this.unitScope(user, "shift.manage", old.orgUnitId, [businessDate()], db);
      if (dto.orgUnitId !== old.orgUnitId) throw new BadRequestException("Không đổi đơn vị của ca; hãy tạo mã ca mới.");
      if (old.revision !== dto.revision) throw new ConflictException("Ca đã thay đổi; tải lại.");
      if (await db.shiftSchedule.count({ where: { shiftId: id } })) throw new ConflictException("Ca đã dùng trong lịch; tạo mã ca mới để không sửa lịch sử.");
      const shift = await db.shiftDefinition.update({ where: { id }, data: { ...this.definitionData(dto, await this.policy(db, old.orgUnitId, businessDate(), access.current)), revision: { increment: 1 } } });
      await this.audit.record({ actorId: user.id, entityType: "shift_definition", entityId: id, action: "UPDATE", result: "SUCCESS", oldValue: { revision: old.revision }, newValue: { revision: shift.revision }, ipAddress }, db);
      return { shift };
    });
  }

  async setActive(user: AuthUser, id: string, dto: ShiftActiveDto, ipAddress?: string) {
    return this.transaction(async db => {
      const old = await db.shiftDefinition.findUnique({ where: { id } });
      if (!old) throw new NotFoundException("Không tìm thấy ca.");
      await this.unitScope(user, "shift.manage", old.orgUnitId, [], db);
      if (old.revision !== dto.revision) throw new ConflictException("Ca đã thay đổi; tải lại.");
      const shift = await db.shiftDefinition.update({ where: { id }, data: { active: dto.active, revision: { increment: 1 } } });
      await this.audit.record({ actorId: user.id, entityType: "shift_definition", entityId: id, action: "SET_ACTIVE", result: "SUCCESS", oldValue: { active: old.active }, newValue: { active: shift.active }, ipAddress }, db);
      return { shift };
    });
  }

  private async eligibleMembers(db: Db, user: AuthUser, unitId: string, workDate: Date, current: Scope) {
    const today = businessDate();
    return db.employee.findMany({ where: { hireDate: { lte: workDate }, OR: [{ terminationDate: null, status: "ACTIVE" }, { terminationDate: { gt: workDate } }],
      AND: [
        { assignments: { some: { orgUnitId: unitId, isPrimary: true, ...effectiveAt(workDate) } } },
        { assignments: { some: { orgUnitId: { in: [...current.allowed] }, isPrimary: true, ...effectiveAt(today) } } },
        { exclusions: { none: { userAccountId: user.id, OR: [effectiveAt(workDate), effectiveAt(today)] } } },
      ] }, select: { id: true, code: true, fullName: true }, orderBy: { code: "asc" } });
  }

  async members(user: AuthUser, query: MembersQueryDto) {
    const workDate = date(query.workDate);
    const { current } = await this.unitScope(user, "shift.read", query.orgUnitId, [workDate], this.prisma);
    return { items: await this.eligibleMembers(this.prisma, user, query.orgUnitId, workDate, current) };
  }

  private async expand(db: Db, user: AuthUser, dto: CreatePlanDto): Promise<Line[]> {
    const dates = dto.slots.map(s => date(s.workDate));
    const { current, dated } = await this.unitScope(user, "shift.plan", dto.teamOrgUnitId, dates, db);
    const definitions = await db.shiftDefinition.findMany({ where: { id: { in: dto.slots.map(s => s.shiftId) } } });
    const versions = await db.orgUnitVersion.findMany({ where: { effectiveFrom: { lte: new Date(Math.max(...dates.map(d => d.getTime()))) } }, select: { orgUnitId: true, parentId: true, effectiveFrom: true, effectiveTo: true } });
    const result: Line[] = [];
    const seen = new Set<string>();
    const members = new Map<string, Member[]>();
    for (const slot of dto.slots) {
      const day = date(slot.workDate);
      const version = dated.get(slot.workDate)!.versions.find(v => v.orgUnitId === dto.teamOrgUnitId)!;
      if (!["TEAM", "DEPARTMENT"].includes(version.type)) throw new BadRequestException("Chỉ phân ca cho tổ hoặc phòng/phân xưởng có nhân sự trực thuộc.");
      const shift = definitions.find(s => s.id === slot.shiftId);
      const atDate = versions.filter(v => v.effectiveFrom <= day && (!v.effectiveTo || v.effectiveTo >= day));
      if (!shift || !ancestors(dto.teamOrgUnitId, atDate).has(shift.orgUnitId)) throw new ForbiddenException("Ca không thuộc đơn vị/cơ sở của lịch.");
      if (!shift.active) throw new ConflictException("Ca đã ngừng sử dụng.");
      let available = members.get(slot.workDate);
      if (!available) { available = await this.eligibleMembers(db, user, dto.teamOrgUnitId, day, current); members.set(slot.workDate, available); }
      const ids = slot.employeeIds ?? available.map(e => e.id);
      if (!ids.length) throw new BadRequestException("Không có nhân sự hợp lệ tại ngày " + slot.workDate);
      const allowed = new Set(available.map(e => e.id));
      for (const employeeId of ids) {
        if (!allowed.has(employeeId)) throw new ForbiddenException("Nhân sự không thuộc đơn vị, ngoài phạm vi hoặc chưa/không còn làm việc tại ngày phân ca.");
        const identity = employeeId + ":" + slot.workDate;
        if (seen.has(identity)) throw new ConflictException("Một nhân sự chỉ có một ca bình thường trong mỗi ngày công.");
        seen.add(identity);
        const startAt = new Date(slot.workDate + "T" + shift.startTime + ":00+07:00");
        const endAt = new Date(new Date(slot.workDate + "T" + shift.endTime + ":00+07:00").getTime() + (shift.crossesMidnight ? DAY : 0));
        result.push({ employeeId, workDate: day, shiftId: shift.id, startAt, endAt, workMinutes: shift.workMinutes });
      }
    }
    if (result.length > 5000) throw new BadRequestException("Mỗi lịch tối đa 5.000 lượt phân ca; tách theo tổ hoặc tuần.");
    return result;
  }

  private async assertOpenDates(db: Db, unitId: string, dates: Date[]) {
    const from = new Date(Math.min(...dates.map(d => d.getTime())));
    const to = new Date(Math.max(...dates.map(d => d.getTime())));
    const frozen = await db.businessPeriod.findMany({ where: { periodType: "ATTENDANCE", status: { in: ["CLOSED", "LOCKED"] }, dateFrom: { lte: to }, dateTo: { gte: from } } });
    const tree = await db.orgUnitVersion.findMany({ where: { effectiveFrom: { lte: to }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }] }, select: { orgUnitId: true, parentId: true, effectiveFrom: true, effectiveTo: true } });
    for (const workDate of dates) {
      const parents = ancestors(unitId, tree.filter(v => v.effectiveFrom <= workDate && (!v.effectiveTo || v.effectiveTo >= workDate)));
      if (frozen.some(p => p.dateFrom <= workDate && p.dateTo >= workDate && parents.has(p.scopeOrgUnitId))) throw new ConflictException("Ngày phân ca thuộc kỳ công đã CLOSED hoặc LOCKED.");
    }
  }

  private async validate(db: Db, user: AuthUser, unitId: string, lines: Line[], permission: string, ignorePlanId?: string) {
    await this.assertOpenDates(db, unitId, lines.map(l => l.workDate));
    const { current, dated } = await this.unitScope(user, permission, unitId, lines.map(l => l.workDate), db);
    const ids = [...new Set(lines.map(l => l.employeeId))].sort();
    // Transfers lock the same rows; stable order avoids multi-person deadlocks.
    await db.$queryRaw(Prisma.sql`SELECT id FROM employee WHERE id IN (${Prisma.join(ids.map(id => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR UPDATE`);
    const from = new Date(Math.min(...lines.map(l => l.workDate.getTime())) - 7 * DAY);
    const to = new Date(Math.max(...lines.map(l => l.workDate.getTime())) + 7 * DAY);
    const others = await db.shiftSchedule.findMany({ where: { employeeId: { in: ids }, workDate: { gte: from, lte: to }, plan: { status: { in: ["DRAFT", "PENDING", "APPROVED"] }, ...(ignorePlanId ? { id: { not: ignorePlanId } } : {}) } }, include: { plan: { select: { teamOrgUnitId: true } } } });
    const definitions = await db.shiftDefinition.findMany({ where: { id: { in: [...new Set(lines.map(l => l.shiftId))] } } });

    const tree = await db.orgUnitVersion.findMany({ where: { effectiveFrom: { lte: to }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }] }, include: { orgUnit: true, site: true } });
    const policyByDay = new Map<string, Policy>();
    for (const [day, scope] of dated) {
      const workDate = date(day);
      const members = await this.eligibleMembers(db, user, unitId, workDate, current);
      const eligible = new Set(members.map(e => e.id));
      const atDate = tree.filter(v => v.effectiveFrom <= workDate && (!v.effectiveTo || v.effectiveTo >= workDate));
      const parents = ancestors(unitId, atDate);


      const policy = await this.policy(db, unitId, workDate, scope);
      policyByDay.set(day, policy);
      for (const line of lines.filter(l => key(l.workDate) === day)) {
        if (!eligible.has(line.employeeId)) throw new ForbiddenException("Nhân sự không còn thuộc phạm vi/đơn vị tại ngày phân ca.");
        const shift = definitions.find(s => s.id === line.shiftId);
        if (!shift || !shift.active || !parents.has(shift.orgUnitId)) throw new ConflictException("Ca không còn hiệu lực hoặc không thuộc cơ sở của lịch.");
        if (line.workMinutes > policy.daily || (line.workMinutes >= 360 && shift.breakMinutes < (shift.isNightShift ? policy.nightBreak : policy.dayBreak))) throw new ConflictException("Ca không đáp ứng giờ làm/nghỉ giữa ca tại ngày phân công.");
      }
    }
    const otherPolicies = new Map<string, Policy>();
    for (const line of others) {
      const policyKey = line.plan.teamOrgUnitId + ":" + key(line.workDate);
      if (!otherPolicies.has(policyKey)) otherPolicies.set(policyKey, await this.policy(db, line.plan.teamOrgUnitId, line.workDate, { versions: tree.filter(v => v.effectiveFrom <= line.workDate && (!v.effectiveTo || v.effectiveTo >= line.workDate)) }));
    }
    const byEmployee = new Map<string, Array<Line & { own: boolean; policy: Policy }>>();
    for (const line of others) { const rows = byEmployee.get(line.employeeId) ?? []; rows.push({ ...line, own: false, policy: otherPolicies.get(line.plan.teamOrgUnitId + ":" + key(line.workDate))! }); byEmployee.set(line.employeeId, rows); }
    for (const line of lines) { const rows = byEmployee.get(line.employeeId) ?? []; rows.push({ ...line, own: true, policy: policyByDay.get(key(line.workDate))! }); byEmployee.set(line.employeeId, rows); }
    for (const rows of byEmployee.values()) {
      rows.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
      const weeks = new Map<string, { minutes: number; limit: number; own: boolean }>();
      for (let i = 0; i < rows.length; i++) {
        const line = rows[i], previous = rows[i - 1];
        if (previous && (line.own || previous.own)) {
          const gap = (line.startAt.getTime() - previous.endAt.getTime()) / MINUTE;
          if (gap < 0 || key(line.workDate) === key(previous.workDate)) throw new ConflictException("Lịch chồng lấn hoặc nhân sự đã có ca trong ngày công.");
          const rest = Math.max(line.policy.rest, previous.policy.rest);
          if (gap < rest) throw new ConflictException("Không đủ thời gian nghỉ chuyển ca (ít nhất " + rest / 60 + " giờ).");
        }
        const monday = new Date(line.workDate.getTime() - ((line.workDate.getUTCDay() + 6) % 7) * DAY);
        const week = key(monday), bucket = weeks.get(week) ?? { minutes: 0, limit: 2880, own: false };
        bucket.minutes += line.workMinutes; bucket.own ||= line.own;
        bucket.limit = Math.min(bucket.limit, line.policy.weekly);
        weeks.set(week, bucket);
      }
      for (const week of weeks.values()) if (week.own && week.minutes > week.limit) throw new ConflictException("Vượt giới hạn giờ làm bình thường trong tuần (tối đa " + week.limit / 60 + " giờ).");
    }
  }

  private async visible(db: Db, user: AuthUser, plan: PlanAccess, permission = "shift.read") {
    const { current } = await this.unitScope(user, permission, plan.teamOrgUnitId, plan.schedules.map(l => l.workDate), db);
    const ids = [...new Set(plan.schedules.map(l => l.employeeId))];
    const excluded = await db.employeeExclusion.findFirst({ where: { employeeId: { in: ids }, userAccountId: user.id, OR: [effectiveAt(businessDate()), ...plan.schedules.map(l => ({ employeeId: l.employeeId, ...effectiveAt(l.workDate) }))] } });
    if (excluded) throw new ForbiddenException("Lịch có nhân sự ngoài phạm vi được phép xem.");
    const currentMembers = await db.orgAssignment.findMany({ where: { employeeId: { in: ids }, orgUnitId: { in: [...current.allowed] }, isPrimary: true, ...effectiveAt(businessDate()) }, select: { employeeId: true } });
    if (new Set(currentMembers.map(m => m.employeeId)).size !== ids.length) throw new ForbiddenException("Lịch có nhân sự ngoài phạm vi hiện tại.");
  }

  private async record(db: Db, user: AuthUser, plan: Plan, action: string, fromStatus: ShiftPlanStatus | null, reason?: string, ipAddress?: string) {
    const snapshot = serialized(plan);
    await db.shiftPlanHistory.create({ data: { planId: plan.id, actorId: user.id, action, fromStatus, toStatus: plan.status, revision: plan.revision, reason, snapshot: snapshot as unknown as Prisma.InputJsonValue } });
    await this.audit.record({ actorId: user.id, entityType: "shift_plan", entityId: plan.id, action, result: "SUCCESS", oldValue: { status: fromStatus }, newValue: { status: plan.status, revision: plan.revision, entries: plan.schedules.length }, ipAddress }, db);
  }

  async createPlan(user: AuthUser, dto: CreatePlanDto, ipAddress?: string) {
    return this.transaction(async db => {
      const lines = await this.expand(db, user, dto);
      await this.validate(db, user, dto.teamOrgUnitId, lines, "shift.plan");
      const plan = await db.shiftPlan.create({ data: { title: dto.title.trim(), teamOrgUnitId: dto.teamOrgUnitId, createdById: user.id, schedules: { create: lines } }, include: planInclude });
      await this.record(db, user, plan, "CREATE", null, undefined, ipAddress);
      return { plan: serialized(plan) };
    });
  }

  async updatePlan(user: AuthUser, id: string, dto: UpdatePlanDto, ipAddress?: string) {
    return this.transaction(async db => {
      const old = await db.shiftPlan.findUnique({ where: { id }, include: planInclude });
      if (!old) throw new NotFoundException("Không tìm thấy lịch.");
      await this.visible(db, user, old, "shift.plan");
      if (old.createdById !== user.id) throw new ForbiddenException("Chỉ người lập được sửa lịch nháp/trả lại.");
      if (dto.teamOrgUnitId !== old.teamOrgUnitId) throw new BadRequestException("Không đổi đơn vị của lịch.");
      if (old.revision !== dto.revision || !["DRAFT", "RETURNED"].includes(old.status)) throw new ConflictException("Lịch đã thay đổi hoặc không được sửa tại trạng thái hiện tại.");
      await this.assertOpenDates(db, old.teamOrgUnitId, old.schedules.map(l => l.workDate));
      const lines = await this.expand(db, user, dto);
      await this.validate(db, user, dto.teamOrgUnitId, lines, "shift.plan", id);
      const plan = await db.shiftPlan.update({ where: { id }, data: { title: dto.title.trim(), status: "DRAFT", revision: { increment: 1 } }, include: planInclude });
      await db.shiftSchedule.deleteMany({ where: { planId: id } });
      await db.shiftSchedule.createMany({ data: lines.map(l => ({ ...l, planId: id })) });
      const updated = await db.shiftPlan.findUniqueOrThrow({ where: { id: plan.id }, include: planInclude });
      await this.record(db, user, updated, "UPDATE", old.status, undefined, ipAddress);
      return { plan: serialized(updated) };
    });
  }

  async transition(user: AuthUser, id: string, action: "SUBMIT" | "APPROVE" | "RETURN" | "CANCEL", dto: PlanActionDto, ipAddress?: string) {
    const permission = action === "APPROVE" || action === "RETURN" ? "shift.approve" : "shift.plan";
    return this.transaction(async db => {
      const old = await db.shiftPlan.findUnique({ where: { id }, include: planInclude });
      if (!old) throw new NotFoundException("Không tìm thấy lịch.");
      await this.visible(db, user, old, permission);
      if (permission === "shift.plan" && old.createdById !== user.id) throw new ForbiddenException("Chỉ người lập được gửi/hủy lịch.");
      if (permission === "shift.approve" && old.createdById === user.id) throw new ForbiddenException("Người lập không được tự duyệt/trả lại lịch.");
      const allowed = action === "SUBMIT" ? ["DRAFT", "RETURNED"] : action === "CANCEL" ? ["DRAFT", "RETURNED", "PENDING"] : ["PENDING"];
      if (old.revision !== dto.revision || !allowed.includes(old.status)) throw new ConflictException("Lịch đã thay đổi hoặc chuyển trạng thái không hợp lệ; tải lại.");
      const reason = dto.reason?.trim();
      if ((action === "RETURN" || action === "CANCEL") && !reason) throw new BadRequestException("Phải nhập lý do trả lại/hủy lịch.");
      if (action === "SUBMIT" || action === "APPROVE") await this.validate(db, user, old.teamOrgUnitId, old.schedules, permission, id);
      else await this.assertOpenDates(db, old.teamOrgUnitId, old.schedules.map(l => l.workDate));
      const status: ShiftPlanStatus = action === "SUBMIT" ? "PENDING" : action === "APPROVE" ? "APPROVED" : action === "RETURN" ? "RETURNED" : "CANCELLED";
      const plan = await db.shiftPlan.update({ where: { id }, data: { status, revision: { increment: 1 } }, include: planInclude });
      await this.record(db, user, plan, action, old.status, reason, ipAddress);
      return { plan: serialized(plan) };
    });
  }

  private range(query: PlanQueryDto) {
    const from = date(query.dateFrom), to = date(query.dateTo);
    if (to < from || to.getTime() - from.getTime() > 92 * DAY) throw new BadRequestException("Khoảng tra cứu phải đúng thứ tự và tối đa 93 ngày.");
    return { from, to };
  }

  async plans(user: AuthUser, query: PlanQueryDto) {
    const { from, to } = this.range(query);
    const current = await this.scope.load(user, "shift.read");
    if (query.teamOrgUnitId && !current.allowed.has(query.teamOrgUnitId)) throw new ForbiddenException("Đơn vị ngoài phạm vi.");
    const rows = await this.prisma.shiftPlan.findMany({ where: { teamOrgUnitId: query.teamOrgUnitId ?? { in: [...current.allowed] }, status: query.status, schedules: { some: { workDate: { gte: from, lte: to } } } }, include: planInclude, orderBy: { createdAt: "desc" } });
    const items = [];
    for (const row of rows) {
      try { await this.visible(this.prisma, user, row); }
      catch (error) { if (error instanceof ForbiddenException) continue; throw error; }
      const plan = serialized(row);
      items.push({ id: plan.id, title: plan.title, teamOrgUnitId: plan.teamOrgUnitId, teamOrgUnitCode: plan.teamOrgUnitCode, status: plan.status, revision: plan.revision, createdBy: plan.createdBy, dateFrom: key(row.schedules[0].workDate), dateTo: key(row.schedules[row.schedules.length - 1].workDate), entryCount: row.schedules.length });
    }
    return { items };
  }

  async plan(user: AuthUser, id: string) {
    const plan = await this.prisma.shiftPlan.findUnique({ where: { id }, include: planInclude });
    if (!plan) throw new NotFoundException("Không tìm thấy lịch.");
    await this.visible(this.prisma, user, plan);
    const history = await this.prisma.shiftPlanHistory.findMany({ where: { planId: id }, include: { actor: { select: { id: true, displayName: true } } }, orderBy: { revision: "asc" } });
    // Removed employees remain in past revisions; preserve current and dated visibility.
    for (const entry of history) { const snapshot = entry.snapshot as unknown as PlanSnapshot; await this.visible(this.prisma, user, { teamOrgUnitId: snapshot.teamOrgUnitId, schedules: snapshot.entries.map(e => ({ employeeId: e.employee.id, workDate: date(e.workDate) })) }); }
    return { plan: serialized(plan), history: history.map(h => ({ id: h.id, actor: h.actor, action: h.action, fromStatus: h.fromStatus, toStatus: h.toStatus, revision: h.revision, reason: h.reason, occurredAt: h.occurredAt.toISOString(), snapshot: h.snapshot })) };
  }

  async official(user: AuthUser, query: PlanQueryDto) {
    const { from, to } = this.range(query);
    const plans = await this.plans(user, { ...query, status: "APPROVED" });
    const rows = await this.prisma.shiftPlan.findMany({ where: { id: { in: plans.items.map(p => p.id) }, status: "APPROVED" }, include: planInclude });
    return { items: rows.flatMap(p => serialized(p).entries.filter(e => date(e.workDate) >= from && date(e.workDate) <= to).map(e => ({ ...e, planId: p.id, teamOrgUnitId: p.teamOrgUnitId }))) };
  }
}
