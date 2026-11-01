import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { businessDate } from "../auth/business-date";
import type { AuthUser } from "../auth/auth.types";
import { PrismaService } from "../database/prisma.service";
import { effectiveAt, ScopeService } from "../organization/scope.service";
import { copySourceDate, generateFromPattern, restViolations, shiftWindow } from "./rotation";
import { ancestors, date, type Line, planInclude, serialized, ShiftsService } from "./shifts.service";

type Db = Prisma.TransactionClient;
const DAY = 86400000;
const MAX_RANGE_DAYS = 62;
const key = (value: Date) => value.toISOString().slice(0, 10);
function fail(kind: "conflict" | "bad" | "forbidden" | "missing", code: string, message: string, details?: Record<string, unknown>): never {
  const body = { code, message, ...(details ? { details } : {}) };
  throw kind === "conflict" ? new ConflictException(body) : kind === "forbidden" ? new ForbiddenException(body) : kind === "missing" ? new NotFoundException(body) : new BadRequestException(body);
}
function range(from: string, to: string) {
  const start = date(from), end = date(to);
  if (end < start || (end.getTime() - start.getTime()) / DAY >= MAX_RANGE_DAYS) fail("bad", "RANGE_INVALID", "Khoảng ngày phải đúng thứ tự và tối đa " + MAX_RANGE_DAYS + " ngày.");
  return { start, end };
}
const dates = (from: Date, to: Date) => Array.from({ length: Math.round((to.getTime() - from.getTime()) / DAY) + 1 }, (_, index) => key(new Date(from.getTime() + index * DAY)));

export interface PatternInput { name: string; sequence: Array<string | null>; minRestMinutes: number; effectiveFrom: string; effectiveTo?: string }

@Injectable()
export class ShiftRotationService {
  constructor(private readonly prisma: PrismaService, private readonly scope: ScopeService, private readonly audit: AuditService, private readonly shifts: ShiftsService) {}

  // ---- Patterns (FR-3.1.3): AD per site, shifts of the site's own policy only ----

  private async checkPattern(db: Db, siteOrgUnitId: string, input: PatternInput) {
    const from = date(input.effectiveFrom);
    const to = input.effectiveTo ? date(input.effectiveTo) : null;
    if (to && to < from) fail("bad", "RANGE_INVALID", "Ngày hết hiệu lực phải từ ngày hiệu lực trở đi.");
    if (!input.sequence.length || input.sequence.length > 62) fail("bad", "PATTERN_INVALID", "Chu kỳ gồm 1–62 ngày.");
    if (input.sequence.some(entry => entry !== null && !(typeof entry === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entry)))) fail("bad", "PATTERN_INVALID", "Mỗi ngày trong chu kỳ là một ca hoặc ngày nghỉ (null).");
    const ids = [...new Set(input.sequence.filter((id): id is string => !!id))];
    if (!ids.length) fail("bad", "PATTERN_INVALID", "Chu kỳ phải có ít nhất một ngày làm ca.");
    const tree = await db.orgUnitVersion.findMany({ where: effectiveAt(from), select: { orgUnitId: true, parentId: true } });
    const policyUnits = ancestors(siteOrgUnitId, tree);
    const shifts = await db.shiftDefinition.findMany({ where: { id: { in: ids } } });
    const outside = ids.filter(id => { const shift = shifts.find(row => row.id === id); return !shift || !shift.active || !policyUnits.has(shift.orgUnitId); });
    if (outside.length) fail("bad", "SHIFT_NOT_IN_SITE_POLICY", "Ca không thuộc chính sách ca của cơ sở (hoặc đã ngừng dùng).", { shiftIds: outside });
    const versions = await db.orgUnitVersion.findMany({ where: { orgUnitId: siteOrgUnitId, ...effectiveAt(from) }, include: { orgUnit: true, site: true } });
    const legal = await this.shifts.policy(db, siteOrgUnitId, from, { versions });
    if (input.minRestMinutes < legal.rest) fail("bad", "MIN_REST_TOO_LOW", "Nghỉ tối thiểu giữa hai ca không được thấp hơn " + legal.rest / 60 + " giờ theo tham số pháp lý.");
    return { from, to };
  }

  private patternView(row: Prisma.ShiftRotationPatternGetPayload<{ include: { versions: true; siteOrgUnit: { select: { code: true } } } }>) {
    return { id: row.id, code: row.code, siteOrgUnitId: row.siteOrgUnitId, siteCode: row.siteOrgUnit.code, versions: row.versions.map(version => ({ id: version.id, name: version.name, cycleDays: version.cycleDays, sequence: version.sequence as Array<string | null>,
      minRestMinutes: version.minRestMinutes, effectiveFrom: key(version.effectiveFrom), effectiveTo: version.effectiveTo ? key(version.effectiveTo) : null })) };
  }

  async patterns(user: AuthUser, query: { siteOrgUnitId?: string }) {
    const scope = await this.scope.load(user, "shift.read");
    const tree = await this.prisma.orgUnitVersion.findMany({ where: effectiveAt(businessDate()), select: { orgUnitId: true, parentId: true } });
    const sites = new Set<string>();
    for (const id of scope.allowed) for (const parent of ancestors(id, tree)) sites.add(parent);
    const rows = await this.prisma.shiftRotationPattern.findMany({ where: { siteOrgUnitId: query.siteOrgUnitId ? query.siteOrgUnitId : { in: [...sites, ...scope.allowed] } }, include: { versions: { orderBy: { effectiveFrom: "desc" } }, siteOrgUnit: { select: { code: true } } }, orderBy: { code: "asc" } });
    return { items: rows.filter(row => sites.has(row.siteOrgUnitId) || scope.allowed.has(row.siteOrgUnitId)).map(row => this.patternView(row)) };
  }

  async createPattern(user: AuthUser, dto: PatternInput & { siteOrgUnitId: string; code: string }, ip?: string) {
    return this.shifts.transaction(async db => {
      const { current } = await this.shifts.unitScope(user, "shift.manage", dto.siteOrgUnitId, [], db);
      if (!current.versions.some(version => version.orgUnitId === dto.siteOrgUnitId && version.type === "SITE")) fail("bad", "SITE_REQUIRED", "Mẫu xoay ca khai báo theo cơ sở.");
      const { from, to } = await this.checkPattern(db, dto.siteOrgUnitId, dto);
      const row = await db.shiftRotationPattern.create({ data: { siteOrgUnitId: dto.siteOrgUnitId, code: dto.code.trim().toUpperCase(), versions: { create: { name: dto.name.trim(), cycleDays: dto.sequence.length, sequence: dto.sequence, minRestMinutes: dto.minRestMinutes, effectiveFrom: from, effectiveTo: to, createdById: user.id } } },
        include: { versions: true, siteOrgUnit: { select: { code: true } } } });
      await this.audit.record({ actorId: user.id, entityType: "shift_rotation_pattern", entityId: row.id, action: "CREATE", result: "SUCCESS", newValue: { code: row.code, sequence: dto.sequence, minRestMinutes: dto.minRestMinutes, scopeOrgUnitId: dto.siteOrgUnitId }, ipAddress: ip }, db);
      return { pattern: this.patternView(row) };
    });
  }

  async addVersion(user: AuthUser, id: string, dto: PatternInput, ip?: string) {
    return this.shifts.transaction(async db => {
      const pattern = await db.shiftRotationPattern.findUnique({ where: { id }, include: { versions: { orderBy: { effectiveFrom: "desc" } } } });
      if (!pattern) fail("missing", "NOT_FOUND", "Không tìm thấy mẫu xoay ca.");
      await this.shifts.unitScope(user, "shift.manage", pattern.siteOrgUnitId, [], db);
      const { from, to } = await this.checkPattern(db, pattern.siteOrgUnitId, dto);
      const latest = pattern.versions[0];
      if (latest && from <= latest.effectiveFrom) fail("conflict", "VERSION_ORDER", "Phiên bản mới phải hiệu lực sau " + key(latest.effectiveFrom) + ".");
      if (latest?.effectiveTo && latest.effectiveTo >= from) fail("conflict", "EFFECTIVE_OVERLAP", "Khoảng hiệu lực chồng với phiên bản trước.");
      if (latest && !latest.effectiveTo) await db.shiftRotationPatternVersion.update({ where: { id: latest.id }, data: { effectiveTo: new Date(from.getTime() - DAY) } });
      await db.shiftRotationPatternVersion.create({ data: { patternId: id, name: dto.name.trim(), cycleDays: dto.sequence.length, sequence: dto.sequence, minRestMinutes: dto.minRestMinutes, effectiveFrom: from, effectiveTo: to, createdById: user.id } });
      await this.audit.record({ actorId: user.id, entityType: "shift_rotation_pattern", entityId: id, action: "CREATE_VERSION", result: "SUCCESS", newValue: { sequence: dto.sequence, effectiveFrom: dto.effectiveFrom, scopeOrgUnitId: pattern.siteOrgUnitId }, ipAddress: ip }, db);
      return { pattern: this.patternView(await db.shiftRotationPattern.findUniqueOrThrow({ where: { id }, include: { versions: { orderBy: { effectiveFrom: "desc" } }, siteOrgUnit: { select: { code: true } } } })) };
    });
  }

  // ---- Generation into DRAFT plans (FR-3.2.1) ----

  private async lines(db: Db, rows: Array<{ employeeId: string; workDate: string; shiftId: string }>): Promise<Line[]> {
    const shifts = await db.shiftDefinition.findMany({ where: { id: { in: [...new Set(rows.map(row => row.shiftId))] } } });
    return rows.map(row => {
      const shift = shifts.find(item => item.id === row.shiftId);
      if (!shift) fail("bad", "SHIFT_NOT_FOUND", "Không tìm thấy ca.");
      return { employeeId: row.employeeId, workDate: date(row.workDate), shiftId: shift.id, ...shiftWindow(row.workDate, shift), workMinutes: shift.workMinutes };
    });
  }

  /** Every generated row must belong to an eligible member and a shift of the team's site (same checks as manual entry). */
  private async eligibility(db: Db, user: AuthUser, teamOrgUnitId: string, lines: Line[]) {
    const { current } = await this.shifts.unitScope(user, "shift.plan", teamOrgUnitId, [...new Map(lines.map(line => [key(line.workDate), line.workDate])).values()], db);
    const skipped: Array<{ employeeId: string; workDate: string; reason: string }> = [];
    const eligibleByDay = new Map<string, Set<string>>();
    const kept: Line[] = [];
    for (const line of lines) {
      const day = key(line.workDate);
      if (!eligibleByDay.has(day)) eligibleByDay.set(day, new Set((await this.shifts.eligibleMembers(db, user, teamOrgUnitId, line.workDate, current)).map(row => row.id)));
      if (eligibleByDay.get(day)!.has(line.employeeId)) kept.push(line);
      else skipped.push({ employeeId: line.employeeId, workDate: day, reason: "NOT_A_MEMBER_ON_DATE" });
    }
    return { kept, skipped };
  }

  /** Rest gaps are reported per row first (all of them, not just the first) so TT can fix them before saving. */
  private async assertRest(db: Db, teamOrgUnitId: string, lines: Line[], patternRest: number) {
    if (!lines.length) return;
    const first = new Date(Math.min(...lines.map(line => line.workDate.getTime())));
    const versions = await db.orgUnitVersion.findMany({ where: effectiveAt(first), include: { orgUnit: true, site: true } });
    const legal = await this.shifts.policy(db, teamOrgUnitId, first, { versions });
    const violations = restViolations(lines.map(line => ({ ...line, workDate: key(line.workDate) })), Math.max(patternRest, legal.rest));
    if (violations.length) fail("conflict", "SHIFT_REST_VIOLATION", violations.length + " lượt phân ca không đủ thời gian nghỉ giữa hai ca; sửa trước khi lưu và gửi duyệt.", { violations });
  }

  private async draftPlan(db: Db, user: AuthUser, id: string, revision: number) {
    const plan = await db.shiftPlan.findUnique({ where: { id }, include: planInclude });
    if (!plan) fail("missing", "NOT_FOUND", "Không tìm thấy lịch.");
    await this.shifts.visible(db, user, plan, "shift.plan");
    if (plan.createdById !== user.id) fail("forbidden", "FORBIDDEN", "Chỉ người lập được sửa lịch.");
    if (plan.revision !== revision || !["DRAFT", "RETURNED"].includes(plan.status)) fail("conflict", "STALE_REVISION", "Lịch đã thay đổi hoặc không được sửa tại trạng thái hiện tại.");
    return plan;
  }

  /** Replaces the plan's rows in place: full validation, a new revision and a history snapshot, like a manual edit. */
  private async replace(db: Db, user: AuthUser, plan: Awaited<ReturnType<ShiftRotationService["draftPlan"]>>, lines: Line[], action: string, ip?: string) {
    if (!lines.length) fail("bad", "PLAN_EMPTY", "Lịch không còn lượt phân ca nào.");
    if (lines.length > 5000) fail("bad", "PLAN_TOO_LARGE", "Mỗi lịch tối đa 5.000 lượt phân ca.");
    await this.shifts.validate(db, user, plan.teamOrgUnitId, lines, "shift.plan", plan.id);
    await db.shiftPlan.update({ where: { id: plan.id }, data: { status: "DRAFT", revision: { increment: 1 } } });
    await db.shiftSchedule.deleteMany({ where: { planId: plan.id } });
    await db.shiftSchedule.createMany({ data: lines.map(line => ({ ...line, planId: plan.id })) });
    const updated = await db.shiftPlan.findUniqueOrThrow({ where: { id: plan.id }, include: planInclude });
    await this.shifts.record(db, user, updated, action, plan.status, undefined, ip);
    return serialized(updated);
  }

  private existing(plan: Awaited<ReturnType<ShiftRotationService["draftPlan"]>>, keep: (row: { employeeId: string; workDate: string }) => boolean): Line[] {
    return plan.schedules.filter(row => keep({ employeeId: row.employeeId, workDate: key(row.workDate) }))
      .map(row => ({ employeeId: row.employeeId, workDate: row.workDate, shiftId: row.shiftId, startAt: row.startAt, endAt: row.endAt, workMinutes: row.workMinutes }));
  }

  async generate(user: AuthUser, planId: string, dto: { revision: number; patternId: string; dateFrom: string; dateTo: string; members: Array<{ employeeId: string; cycleOffset: number }> }, ip?: string) {
    const { start, end } = range(dto.dateFrom, dto.dateTo);
    return this.shifts.transaction(async db => {
      const plan = await this.draftPlan(db, user, planId, dto.revision);
      const pattern = await db.shiftRotationPattern.findUnique({ where: { id: dto.patternId }, include: { versions: { where: effectiveAt(start) } } });
      const version = pattern?.versions[0];
      if (!pattern || !version) fail("missing", "PATTERN_NOT_EFFECTIVE", "Mẫu xoay ca không có phiên bản hiệu lực tại ngày bắt đầu.");
      const tree = await db.orgUnitVersion.findMany({ where: effectiveAt(start), select: { orgUnitId: true, parentId: true } });
      if (!ancestors(plan.teamOrgUnitId, tree).has(pattern.siteOrgUnitId)) fail("forbidden", "PATTERN_OTHER_SITE", "Mẫu xoay ca thuộc cơ sở khác.");
      const generated = await this.lines(db, generateFromPattern(version.sequence as Array<string | null>, dto.members, dto.dateFrom, dto.dateTo));
      const { kept, skipped } = await this.eligibility(db, user, plan.teamOrgUnitId, generated);
      const members = new Set(dto.members.map(member => member.employeeId));
      const lines = [...this.existing(plan, row => !(members.has(row.employeeId) && row.workDate >= key(start) && row.workDate <= key(end))), ...kept];
      await this.assertRest(db, plan.teamOrgUnitId, lines, version.minRestMinutes);
      return { plan: await this.replace(db, user, plan, lines, "GENERATE", ip), generated: kept.length, skipped };
    });
  }

  async bulkAssign(user: AuthUser, planId: string, dto: { revision: number; shiftId: string; employeeIds: string[]; dates: string[] }, ip?: string) {
    return this.shifts.transaction(async db => {
      const plan = await this.draftPlan(db, user, planId, dto.revision);
      const cells = new Set(dto.employeeIds.flatMap(employeeId => dto.dates.map(day => employeeId + "|" + date(day).toISOString().slice(0, 10))));
      const assigned = await this.lines(db, [...cells].map(cell => { const [employeeId, workDate] = cell.split("|"); return { employeeId, workDate, shiftId: dto.shiftId }; }));
      const { kept, skipped } = await this.eligibility(db, user, plan.teamOrgUnitId, assigned);
      if (skipped.length) fail("forbidden", "NOT_A_MEMBER_ON_DATE", "Có nhân sự không thuộc đơn vị/phạm vi tại ngày phân ca.", { skipped });
      const lines = [...this.existing(plan, row => !cells.has(row.employeeId + "|" + row.workDate)), ...kept];
      await this.assertRest(db, plan.teamOrgUnitId, lines, 0);
      return { plan: await this.replace(db, user, plan, lines, "BULK_ASSIGN", ip), assigned: kept.length };
    });
  }

  /** New DRAFT plan from last period's APPROVED schedules; people no longer members are skipped and listed. */
  async copyPrevious(user: AuthUser, dto: { teamOrgUnitId: string; title: string; sourceFrom: string; sourceTo: string; targetFrom: string; targetTo: string; mode: "WEEKDAY" | "CYCLE"; cycleDays?: number }, ip?: string) {
    const source = range(dto.sourceFrom, dto.sourceTo), target = range(dto.targetFrom, dto.targetTo);
    if (target.start <= source.end) fail("bad", "RANGE_INVALID", "Kỳ đích phải sau kỳ nguồn.");
    if (dto.mode === "CYCLE" && !dto.cycleDays) fail("bad", "CYCLE_DAYS_REQUIRED", "Sao chép theo chu kỳ cần số ngày chu kỳ.");
    return this.shifts.transaction(async db => {
      await this.shifts.unitScope(user, "shift.plan", dto.teamOrgUnitId, [source.start, target.start], db);
      const rows = await db.shiftSchedule.findMany({ where: { workDate: { gte: source.start, lte: source.end }, plan: { status: "APPROVED", teamOrgUnitId: dto.teamOrgUnitId } }, orderBy: [{ workDate: "asc" }, { employeeId: "asc" }] });
      if (!rows.length) fail("conflict", "SOURCE_EMPTY", "Kỳ nguồn không có lịch đã duyệt của đơn vị.");
      const byDate = new Map<string, typeof rows>();
      for (const row of rows) byDate.set(key(row.workDate), [...(byDate.get(key(row.workDate)) ?? []), row]);
      const copied: Array<{ employeeId: string; workDate: string; shiftId: string }> = [];
      for (const day of dates(target.start, target.end)) {
        const from = copySourceDate(dto.mode, dto.sourceFrom, dto.sourceTo, day, dto.cycleDays);
        for (const row of from ? byDate.get(from) ?? [] : []) copied.push({ employeeId: row.employeeId, workDate: day, shiftId: row.shiftId });
      }
      const { kept, skipped } = await this.eligibility(db, user, dto.teamOrgUnitId, await this.lines(db, copied));
      if (!kept.length) fail("conflict", "NOTHING_TO_COPY", "Không còn nhân sự hợp lệ để sao chép.", { skipped });
      await this.assertRest(db, dto.teamOrgUnitId, kept, 0);
      await this.shifts.validate(db, user, dto.teamOrgUnitId, kept, "shift.plan");
      const plan = await db.shiftPlan.create({ data: { title: dto.title.trim(), teamOrgUnitId: dto.teamOrgUnitId, createdById: user.id, schedules: { create: kept } }, include: planInclude });
      await this.shifts.record(db, user, plan, "COPY_PREVIOUS", null, undefined, ip);
      const people = await db.employee.findMany({ where: { id: { in: [...new Set(skipped.map(row => row.employeeId))] } }, select: { id: true, code: true, fullName: true } });
      return { plan: serialized(plan), copied: kept.length, skipped: people.map(person => ({ ...person, days: skipped.filter(row => row.employeeId === person.id).length })) };
    });
  }
}
