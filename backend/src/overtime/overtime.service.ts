import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { OvertimeStatus, Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { businessDate } from "../auth/business-date";
import type { AuthUser } from "../auth/auth.types";
import { PrismaService } from "../database/prisma.service";
import { effectiveAt, ScopeService } from "../organization/scope.service";
import { CreateOvertimeDto, OvertimeActionDto, OvertimeMembersQueryDto, OvertimeQueryDto, UpdateOvertimeDto } from "./overtime.dto";
import type { OvertimeAction, OvertimeReview, OvertimeSnapshot } from "./overtime.types";

type Db = Prisma.TransactionClient;
type Scope = { asOf: Date; allowed: Set<string>; versions: Array<Prisma.OrgUnitVersionGetPayload<{ include: { orgUnit: true; site: true } }>> };
interface OvertimePolicy { dailyRatio: number; monthly: number; yearly: number; normal: number }
const DAY = 86400000, MINUTE = 60000, VN = 7 * 3600000;
const include = { teamOrgUnit: true, createdBy: { select: { id: true, displayName: true } }, members: { orderBy: { employeeId: "asc" as const }, include: { employee: { select: { id: true, code: true, fullName: true } } } } } satisfies Prisma.OvertimeRequestInclude;
type Request = Prisma.OvertimeRequestGetPayload<{ include: typeof include }>;
type Access = { teamOrgUnitId: string; workDate: Date; startAt: Date; endAt: Date; members: Array<{ employeeId: string }> };
function key(day: Date) { return day.toISOString().slice(0, 10); }
function date(text: string) {
  const value = new Date(text + "T00:00:00Z");
  if (!Number.isFinite(value.getTime()) || key(value) !== text) throw new BadRequestException("Ngày công không hợp lệ.");
  return value;
}
function localDay(at: Date) { return new Date(key(new Date(at.getTime() + VN)) + "T00:00:00Z"); }
function days(row: Pick<Access, "workDate" | "startAt" | "endAt">) {
  return [...new Map([row.workDate, localDay(row.startAt), localDay(new Date(row.endAt.getTime() - 1))].map(d => [key(d), d])).values()];
}
function segments(startAt: Date, endAt: Date) {
  const result: Array<{ day: string; minutes: number }> = [];
  for (let start = startAt.getTime(); start < endAt.getTime();) {
    const day = key(new Date(start + VN));
    const end = Math.min(endAt.getTime(), date(day).getTime() + DAY - VN);
    result.push({ day, minutes: (end - start) / MINUTE });
    start = end;
  }
  return result;
}
function parents(unitId: string, versions: Array<{ orgUnitId: string; parentId: string | null }>) {
  const tree = new Map(versions.map(v => [v.orgUnitId, v.parentId]));
  const result = new Set<string>();
  let id: string | null | undefined = unitId;
  while (id && !result.has(id)) { result.add(id); id = tree.get(id); }
  return result;
}
function snapshot(row: Request): OvertimeSnapshot {
  return { id: row.id, teamOrgUnitId: row.teamOrgUnitId, teamOrgUnitCode: row.teamOrgUnit.code, title: row.title,
    workDate: key(row.workDate), startAt: row.startAt.toISOString(), endAt: row.endAt.toISOString(), requestedMinutes: row.requestedMinutes,
    reason: row.reason, status: row.status, revision: row.revision, createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    members: row.members.map(m => ({ employee: m.employee, consentReference: m.consentReference })) };
}
function historicalAccess(row: OvertimeSnapshot): Access {
  return { teamOrgUnitId: row.teamOrgUnitId, workDate: date(row.workDate), startAt: new Date(row.startAt), endAt: new Date(row.endAt), members: row.members.map(m => ({ employeeId: m.employee.id })) };
}

@Injectable()
export class OvertimeService {
  constructor(private readonly prisma: PrismaService, private readonly scope: ScopeService, private readonly audit: AuditService) {}

  private transaction<T>(fn: (db: Db) => Promise<T>) {
    // ReadCommitted obtains a fresh snapshot after waiting for the shared period/shift lock.
    return this.prisma.$transaction(async db => {
      await db.$queryRaw`SELECT pg_advisory_xact_lock(8210472)::text AS lock`;
      return fn(db);
    }, { isolationLevel: "ReadCommitted", timeout: 30000 });
  }

  private async scoped(db: Db, user: AuthUser, permission: string, unitId: string, dates: Date[]) {
    const current = await this.scope.load(user, permission, db);
    if (!current.allowed.has(unitId)) throw new ForbiddenException("Đơn vị ngoài phạm vi hiện tại.");
    for (const day of dates) {
      const dated = await this.scope.load(user, permission, db, day);
      if (!dated.allowed.has(unitId)) throw new ForbiddenException("Đơn vị ngoài phạm vi tại ngày OT.");
      const unit = dated.versions.find(v => v.orgUnitId === unitId);
      if (!unit || !["TEAM", "DEPARTMENT"].includes(unit.type)) throw new BadRequestException("Chỉ đăng ký OT cho tổ hoặc phòng/phân xưởng có nhân sự trực thuộc.");
    }
    return current;
  }

  private eligible(db: Db, user: AuthUser, unitId: string, day: Date, current: Scope) {
    return db.employee.findMany({ where: { hireDate: { lte: day }, OR: [{ terminationDate: null, status: "ACTIVE" }, { terminationDate: { gt: day } }],
      AND: [
        { assignments: { some: { orgUnitId: unitId, isPrimary: true, ...effectiveAt(day) } } },
        { assignments: { some: { orgUnitId: { in: [...current.allowed] }, isPrimary: true, ...effectiveAt(businessDate()) } } },
        { exclusions: { none: { userAccountId: user.id, OR: [effectiveAt(day), effectiveAt(businessDate())] } } },
      ] }, select: { id: true, code: true, fullName: true }, orderBy: { code: "asc" } });
  }

  private async visible(db: Db, user: AuthUser, row: Access, permission = "overtime.read") {
    const dates = days(row);
    const current = await this.scoped(db, user, permission, row.teamOrgUnitId, dates);
    for (const day of dates) {
      const members = new Set((await this.eligible(db, user, row.teamOrgUnitId, day, current)).map(e => e.id));
      if (row.members.some(m => !members.has(m.employeeId))) throw new ForbiddenException("Đề xuất có nhân sự ngoài phạm vi, bị loại trừ hoặc không còn phân công hợp lệ.");
    }
  }

  private async writable(db: Db, row: Access) {
    for (const day of days(row)) {
      const versions = await db.orgUnitVersion.findMany({ where: effectiveAt(day), select: { orgUnitId: true, parentId: true } });
      const ancestors = parents(row.teamOrgUnitId, versions);
      if (await db.businessPeriod.findFirst({ where: { periodType: "ATTENDANCE", status: { in: ["CLOSED", "LOCKED"] }, scopeOrgUnitId: { in: [...ancestors] }, dateFrom: { lte: day }, dateTo: { gte: day } } }))
        throw new ConflictException("OT liên quan kỳ công đã CLOSED hoặc LOCKED; không được thay đổi.");
    }
  }

  private input(dto: CreateOvertimeDto) {
    const workDate = date(dto.workDate), startAt = new Date(dto.startAt), endAt = new Date(dto.endAt);
    const requestedMinutes = (endAt.getTime() - startAt.getTime()) / MINUTE;
    const startDay = localDay(startAt).getTime();
    if (!Number.isSafeInteger(requestedMinutes) || requestedMinutes <= 0 || requestedMinutes > 720 || startAt.getTime() % MINUTE || endAt.getTime() % MINUTE || startDay < workDate.getTime() || startDay > workDate.getTime() + DAY)
      throw new BadRequestException("Khoảng OT phải dài hơn 0, tối đa 12 giờ, tròn phút; bắt đầu trong ngày công hoặc ngày kế tiếp (giờ Việt Nam).");
    return { teamOrgUnitId: dto.teamOrgUnitId, title: dto.title.trim(), workDate, startAt, endAt, requestedMinutes, reason: dto.reason.trim() };
  }

  private async validate(db: Db, user: AuthUser, row: Access, permission: string, ignoreId?: string) {
    await this.visible(db, user, row, permission);
    await this.writable(db, row);
    const employeeIds = row.members.map(m => m.employeeId).sort();
    // Transfers lock the same employee rows, so assignment changes cannot race approval.
    await db.$queryRaw(Prisma.sql`SELECT id FROM employee WHERE id IN (${Prisma.join(employeeIds.map(id => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR UPDATE`);
    const overlapping = await db.overtimeRequest.findFirst({ where: {
      ...(ignoreId ? { id: { not: ignoreId } } : {}), status: { in: ["DRAFT", "PENDING", "APPROVED"] },
      startAt: { lt: row.endAt }, endAt: { gt: row.startAt }, members: { some: { employeeId: { in: employeeIds } } },
    } });
    if (overlapping) throw new ConflictException("Nhân sự có đề xuất OT nháp/chờ duyệt/đã duyệt trùng thời gian.");
    if (await db.shiftSchedule.findFirst({ where: { employeeId: { in: employeeIds }, startAt: { lt: row.endAt }, endAt: { gt: row.startAt }, plan: { status: "APPROVED" } } }))
      throw new ConflictException("OT trùng giờ làm việc bình thường trong lịch đã duyệt.");
  }

  async context(user: AuthUser) {
    const scope = await this.scope.load(user, "overtime.read");
    return { units: scope.versions.filter(v => ["TEAM", "DEPARTMENT"].includes(v.type)).map(v => ({ id: v.orgUnitId, code: v.orgUnit.code, name: v.name, type: v.type })),
      canPlan: user.permissions.includes("overtime.plan"), canApprove: user.permissions.includes("overtime.approve") };
  }

  async members(user: AuthUser, query: OvertimeMembersQueryDto) {
    const day = date(query.workDate);
    const scope = await this.scoped(this.prisma, user, "overtime.read", query.teamOrgUnitId, [day]);
    return { items: await this.eligible(this.prisma, user, query.teamOrgUnitId, day, scope) };
  }

  private async policy(db: Db, unitId: string, day: Date) {
    const unit = await db.orgUnitVersion.findFirst({ where: { orgUnitId: unitId, ...effectiveAt(day) }, include: { site: true } });
    if (!unit?.site) throw new ConflictException("Không xác định được cơ sở hiệu lực để kiểm tra trần OT.");
    const scopes = ["SITE:" + unit.site.id, "REGION:" + unit.site.wageRegionCode, "GLOBAL"];
    const rows = await db.legalParameter.findMany({ where: { paramCode: { in: ["OT_DAILY_MAX_RATIO", "OT_MONTH_MAX_MINUTES", "OT_YEAR_MAX_MINUTES", "SHIFT_MAX_DAILY_MINUTES", "OT_300_NOTICE_REFERENCE", "OT_300_NOTICE_DATE"] }, scopeKey: { in: scopes }, subjectType: "ALL", applicationBasis: "WORK_DATE", ...effectiveAt(day) } });
    const resolve = (code: string) => scopes.map(scope => rows.find(r => r.scopeKey === scope && r.paramCode === code)).find(Boolean);
    const number = (code: string) => {
      const raw = resolve(code)?.value;
      const value = typeof raw === "string" || typeof raw === "number" ? Number(raw) : NaN;
      if (!Number.isFinite(value) || value <= 0) throw new ConflictException("Thiếu/sai tham số OT: " + code);
      return value;
    };
    const dailyRatio = number("OT_DAILY_MAX_RATIO"), monthly = number("OT_MONTH_MAX_MINUTES"), yearly = number("OT_YEAR_MAX_MINUTES"), normal = number("SHIFT_MAX_DAILY_MINUTES");
    if (dailyRatio > 0.5 || monthly > 2400 || yearly > 18000 || normal > 480 || ![monthly, yearly, normal].every(Number.isSafeInteger))
      throw new ConflictException("Tham số OT vượt giới hạn BR-27 hoặc không hợp lệ.");
    if (yearly > 12000) {
      const reference = rows.find(r => r.paramCode === "OT_300_NOTICE_REFERENCE" && r.scopeKey === scopes[0])?.value;
      const notified = rows.find(r => r.paramCode === "OT_300_NOTICE_DATE" && r.scopeKey === scopes[0])?.value;
      if (typeof reference !== "string" || !reference.trim() || typeof notified !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(notified) || date(notified) > day)
        throw new ConflictException("Trần trên 200 giờ cần căn cứ và ngày thông báo 300 giờ/năm tại cơ sở, có hiệu lực trước ngày OT.");
    }
    return { dailyRatio, monthly, yearly, normal };
  }

  private async review(db: Db, row: Request): Promise<OvertimeReview> {
    const ownSegments = segments(row.startAt, row.endAt);
    const firstYear = ownSegments[0].day.slice(0, 4), lastYear = ownSegments[ownSegments.length - 1].day.slice(0, 4);
    const ids = row.members.map(m => m.employeeId);
    const approved = await db.overtimeRequest.findMany({ where: { id: { not: row.id }, status: "APPROVED", members: { some: { employeeId: { in: ids } } },
      OR: [{ startAt: { lt: new Date((Number(lastYear) + 1) + "-01-01T00:00:00+07:00") }, endAt: { gt: new Date(firstYear + "-01-01T00:00:00+07:00") } }, { workDate: row.workDate }] }, include: { members: { select: { employeeId: true } } } });
    const schedules = await db.shiftSchedule.findMany({ where: { employeeId: { in: ids }, workDate: row.workDate, plan: { status: "APPROVED" } } });
    const policy = await this.policy(db, row.teamOrgUnitId, row.workDate);
    const policies = new Map<string, OvertimePolicy>();
    for (const s of ownSegments) policies.set(s.day, await this.policy(db, row.teamOrgUnitId, date(s.day)));
    const blocking = new Set<string>(), warnings = new Set<string>();
    const employees: OvertimeReview["employees"] = [];
    for (const member of row.members) {
      const existing = approved.filter(r => r.members.some(m => m.employeeId === member.employeeId));
      const dailyMinutes = row.requestedMinutes + existing.filter(r => key(r.workDate) === key(row.workDate)).reduce((sum, r) => sum + r.requestedMinutes, 0);
      const scheduleMinutes = schedules.filter(s => s.employeeId === member.employeeId).reduce((sum, s) => sum + s.workMinutes, 0);
      const dailyLimitMinutes = Math.floor((scheduleMinutes || policy.normal) * policy.dailyRatio);
      const months = new Map<string, { month: string; minutes: number; limitMinutes: number }>();
      const years = new Map<string, { year: string; minutes: number; limitMinutes: number }>();
      for (const s of ownSegments) {
        const p = policies.get(s.day)!;
        const month = s.day.slice(0, 7), year = s.day.slice(0, 4);
        const m = months.get(month) ?? { month, minutes: 0, limitMinutes: p.monthly };
        const y = years.get(year) ?? { year, minutes: 0, limitMinutes: p.yearly };
        m.minutes += s.minutes; m.limitMinutes = Math.min(m.limitMinutes, p.monthly);
        y.minutes += s.minutes; y.limitMinutes = Math.min(y.limitMinutes, p.yearly);
        months.set(month, m); years.set(year, y);
      }
      for (const old of existing) for (const s of segments(old.startAt, old.endAt)) {
        const m = months.get(s.day.slice(0, 7)), y = years.get(s.day.slice(0, 4));
        if (m) m.minutes += s.minutes;
        if (y) y.minutes += s.minutes;
      }
      const label = member.employee.code;
      if (dailyMinutes > dailyLimitMinutes) blocking.add(label + ": vượt trần OT ngày (" + dailyLimitMinutes / 60 + " giờ).");
      for (const m of months.values()) {
        if (m.minutes > m.limitMinutes) blocking.add(label + ": vượt trần tháng " + m.month + ".");
        else if (m.minutes >= m.limitMinutes * 0.9) warnings.add(label + ": đã đạt ít nhất 90% trần tháng " + m.month + "; còn " + (m.limitMinutes - m.minutes) / 60 + " giờ.");
      }
      for (const y of years.values()) if (y.minutes > y.limitMinutes) blocking.add(label + ": vượt trần năm " + y.year + ".");
      employees.push({ employeeId: member.employeeId, code: label, dailyMinutes, dailyLimitMinutes, months: [...months.values()], years: [...years.values()] });
    }
    if (row.startAt <= new Date()) blocking.add("Đã đến giờ bắt đầu OT; không được gửi hoặc duyệt hồi tố.");
    return { approvable: !blocking.size, blocking: [...blocking], warnings: [...warnings], employees };
  }

  private async record(db: Db, user: AuthUser, row: Request, action: string, fromStatus: OvertimeStatus | null, reason?: string, ipAddress?: string) {
    await db.overtimeHistory.create({ data: { requestId: row.id, actorId: user.id, action, fromStatus, toStatus: row.status, revision: row.revision, reason, snapshot: snapshot(row) as unknown as Prisma.InputJsonValue } });
    await this.audit.record({ actorId: user.id, entityType: "overtime_request", entityId: row.id, action, result: "SUCCESS", oldValue: { status: fromStatus }, newValue: { status: row.status, revision: row.revision, members: row.members.length }, ipAddress }, db);
  }

  async create(user: AuthUser, dto: CreateOvertimeDto, ipAddress?: string) {
    return this.transaction(async db => {
      const data = this.input(dto);
      await this.validate(db, user, { ...data, members: dto.members }, "overtime.plan");
      const row = await db.overtimeRequest.create({ data: { ...data, createdById: user.id, members: { create: dto.members.map(m => ({ employeeId: m.employeeId, consentReference: m.consentReference.trim() })) } }, include });
      await this.record(db, user, row, "CREATE", null, undefined, ipAddress);
      return { request: snapshot(row) };
    });
  }

  private async get(db: Db, id: string) {
    const row = await db.overtimeRequest.findUnique({ where: { id }, include });
    if (!row) throw new NotFoundException("Không tìm thấy đề xuất OT.");
    return row;
  }

  async update(user: AuthUser, id: string, dto: UpdateOvertimeDto, ipAddress?: string) {
    return this.transaction(async db => {
      const old = await this.get(db, id);
      await this.visible(db, user, old, "overtime.plan");
      if (old.createdById !== user.id) throw new ForbiddenException("Chỉ người lập được sửa đề xuất.");
      if (old.revision !== dto.revision || !["DRAFT", "RETURNED"].includes(old.status)) throw new ConflictException("Đề xuất đã thay đổi hoặc không còn được sửa; tải lại.");
      if (old.teamOrgUnitId !== dto.teamOrgUnitId) throw new BadRequestException("Không đổi đơn vị của đề xuất; hãy tạo đề xuất mới.");
      await this.writable(db, old);
      const data = this.input(dto);
      await this.validate(db, user, { ...data, members: dto.members }, "overtime.plan", id);
      await db.overtimeMember.deleteMany({ where: { requestId: id } });
      const row = await db.overtimeRequest.update({ where: { id }, data: { ...data, status: "DRAFT", revision: { increment: 1 }, members: { create: dto.members.map(m => ({ employeeId: m.employeeId, consentReference: m.consentReference.trim() })) } }, include });
      await this.record(db, user, row, "UPDATE", old.status, undefined, ipAddress);
      return { request: snapshot(row) };
    });
  }

  async transition(user: AuthUser, id: string, action: OvertimeAction, dto: OvertimeActionDto, ipAddress?: string) {
    return this.transaction(async db => {
      const old = await this.get(db, id);
      const decision = ["APPROVE", "RETURN", "REJECT"].includes(action);
      const permission = decision ? "overtime.approve" : "overtime.plan";
      await this.visible(db, user, old, permission);
      if (decision ? old.createdById === user.id : old.createdById !== user.id) throw new ForbiddenException(decision ? "Không được tự duyệt đề xuất của mình." : "Chỉ người lập được gửi/hủy đề xuất.");
      const allowed = action === "SUBMIT" ? ["DRAFT", "RETURNED"] : action === "CANCEL" ? ["DRAFT", "RETURNED", "PENDING"] : ["PENDING"];
      if (old.revision !== dto.revision || !allowed.includes(old.status)) throw new ConflictException("Đề xuất đã thay đổi hoặc chuyển trạng thái không hợp lệ; tải lại.");
      const reason = dto.reason?.trim();
      if (["RETURN", "REJECT", "CANCEL"].includes(action) && !reason) throw new BadRequestException("Phải nhập lý do trả lại/từ chối/hủy.");
      await this.writable(db, old);
      if (action === "SUBMIT" || action === "APPROVE") {
        await this.validate(db, user, old, permission, id);
        if (old.startAt <= new Date()) throw new ConflictException("Đã đến giờ bắt đầu OT; không được gửi hoặc duyệt hồi tố.");
        const review = await this.review(db, old);
        if (action === "APPROVE" && !review.approvable) throw new ConflictException(review.blocking.join(" "));
      }
      const statuses: Record<OvertimeAction, OvertimeStatus> = { SUBMIT: "PENDING", APPROVE: "APPROVED", RETURN: "RETURNED", REJECT: "REJECTED", CANCEL: "CANCELLED" };
      const row = await db.overtimeRequest.update({ where: { id }, data: { status: statuses[action], revision: { increment: 1 } }, include });
      await this.record(db, user, row, action, old.status, reason, ipAddress);
      return { request: snapshot(row) };
    });
  }

  async list(user: AuthUser, query: OvertimeQueryDto) {
    const from = date(query.dateFrom), to = date(query.dateTo);
    if (to < from || to.getTime() - from.getTime() > 92 * DAY) throw new BadRequestException("Khoảng tìm kiếm tối đa 93 ngày, ngày kết thúc không trước ngày bắt đầu.");
    const scope = await this.scope.load(user, "overtime.read");
    if (query.teamOrgUnitId && !scope.allowed.has(query.teamOrgUnitId)) throw new ForbiddenException("Đơn vị ngoài phạm vi.");
    const rows = await this.prisma.overtimeRequest.findMany({ where: { teamOrgUnitId: query.teamOrgUnitId ?? { in: [...scope.allowed] }, workDate: { gte: from, lte: to }, status: query.status }, include, orderBy: { createdAt: "desc" } });
    const items: OvertimeSnapshot[] = [];
    for (const row of rows) {
      try { await this.visible(this.prisma, user, row); }
      catch (error) { if (error instanceof ForbiddenException) continue; throw error; }
      items.push(snapshot(row));
    }
    return { items };
  }

  async detail(user: AuthUser, id: string) {
    const row = await this.get(this.prisma, id);
    await this.visible(this.prisma, user, row);
    const history = await this.prisma.overtimeHistory.findMany({ where: { requestId: id }, include: { actor: { select: { id: true, displayName: true } } }, orderBy: { revision: "asc" } });
    // Old snapshots can contain removed employees; apply the same access policy before disclosing them.
    for (const h of history) await this.visible(this.prisma, user, historicalAccess(h.snapshot as unknown as OvertimeSnapshot));
    return { request: snapshot(row), history: history.map(h => ({ id: h.id, actor: h.actor, action: h.action, fromStatus: h.fromStatus, toStatus: h.toStatus, revision: h.revision, reason: h.reason, occurredAt: h.occurredAt.toISOString(), snapshot: h.snapshot })), review: await this.review(this.prisma, row) };
  }
}
