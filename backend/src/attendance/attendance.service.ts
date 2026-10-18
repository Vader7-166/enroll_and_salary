import { BadRequestException, ForbiddenException, Injectable, InternalServerErrorException, NotFoundException } from "@nestjs/common";
import { BusinessPeriod, Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { AuditService } from "../audit/audit.service";
import { businessDate } from "../auth/business-date";
import type { AuthUser } from "../auth/auth.types";
import { PrismaService } from "../database/prisma.service";
import { effectiveAt, ScopeService } from "../organization/scope.service";
import { SettingsService } from "../settings/settings.service";
import { AttendanceBoardQuery, AttendanceImportDto, AttendancePageQuery, AttendanceProcessDto, AttendanceProfileDto, AttendancePunchQuery } from "./attendance.dto";
import { computeAttendance } from "./attendance-engine";
import { parseAttendanceFile, validateMapping } from "./import-parser";
import { STANDARD_MAPPING } from "./attendance.types";
import type { EngineSchedule, ImportRowError, ImportSummary, PairingRules, ParsedImport, PunchDirection } from "./attendance.types";

type Db = Prisma.TransactionClient;
type Scope = { allowed: Set<string>; versions: Array<Prisma.OrgUnitVersionGetPayload<{ include: { orgUnit: true; site: true } }>> };
const DAY = 86400000;
const MINUTE = 60000;
const employeeSelect = { id: true, code: true, fullName: true } as const;
const rawInclude = { employee: { select: employeeSelect }, processing: true } satisfies Prisma.RawPunchInclude;
const batchInclude = { site: { select: { name: true } }, createdBy: { select: { id: true, displayName: true } } } satisfies Prisma.AttendanceImportInclude;
const dayInclude = { employee: { select: employeeSelect }, orgUnit: true, schedule: { include: { shift: true } }, checkIn: { select: { punchedAt: true } }, checkOut: { select: { punchedAt: true } } } satisfies Prisma.DailyAttendanceInclude;
type Batch = Prisma.AttendanceImportGetPayload<{ include: typeof batchInclude }>;
type Raw = Prisma.RawPunchGetPayload<{ include: typeof rawInclude }>;
type Daily = Prisma.DailyAttendanceGetPayload<{ include: typeof dayInclude }>;
const ruleCodes: Record<keyof PairingRules, string> = { inBeforeMinutes: "PUNCH_IN_BEFORE_MINUTES", inAfterMinutes: "PUNCH_IN_AFTER_MINUTES", outBeforeMinutes: "PUNCH_OUT_BEFORE_MINUTES", outAfterMinutes: "PUNCH_OUT_AFTER_MINUTES", duplicateWindowMinutes: "PUNCH_DUPLICATE_WINDOW_MINUTES" };
function key(d: Date): string { return d.toISOString().slice(0, 10); }
function localDate(d: Date): Date { return new Date(new Date(d.getTime() + 7 * 3600000).toISOString().slice(0, 10) + "T00:00:00Z"); }
function shifted(d: Date, days: number): Date { return new Date(d.getTime() + days * DAY); }
function json(value: unknown): Prisma.InputJsonValue { return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue; }
function emptySummary(): ImportSummary { return { inserted: 0, duplicates: 0, processed: 0, waiting: 0, late: 0, exceptionDays: 0, periods: [] }; }
function ancestors(id: string, versions: Array<{ orgUnitId: string; parentId: string | null }>): string[] {
  const parents = new Map(versions.map(v => [v.orgUnitId, v.parentId]));
  const result: string[] = [], seen = new Set<string>();
  let cursor: string | null | undefined = id;
  while (cursor && !seen.has(cursor)) { seen.add(cursor); result.push(cursor); cursor = parents.get(cursor); }
  return result;
}
function atDate<T extends { effectiveFrom: Date; effectiveTo: Date | null }>(rows: T[], date: Date): T[] { return rows.filter(r => r.effectiveFrom <= date && (!r.effectiveTo || r.effectiveTo >= date)); }
function batchView(b: Batch) { return { id: b.id, siteId: b.siteId, siteName: b.site.name, fileName: b.fileName, fileHash: b.fileHash, status: b.status, createdAt: b.createdAt.toISOString(), createdBy: b.createdBy, totalRows: b.totalRows, summary: b.summary, errors: b.errors }; }
function rawView(r: Raw) { return { id: r.id, employee: r.employee, punchedAt: r.punchedAt.toISOString(), direction: r.direction, deviceCode: r.deviceCode, batchId: r.batchId, rowNumber: r.rowNumber, source: r.source, state: r.processing?.state ?? "WAITING", reason: r.processing ? r.processing.reason : "NOT_PROCESSED", workDate: r.processing?.workDate ? key(r.processing.workDate) : null, periodId: r.processing?.periodId ?? null, scheduleId: r.processing?.scheduleId ?? null }; }
function dayView(d: Daily, name: string) { return { id: d.id, employee: d.employee, orgUnitId: d.orgUnitId, orgUnitCode: d.orgUnit.code, orgUnitName: name, workDate: key(d.workDate), periodId: d.periodId,
  shift: { code: d.schedule.shift.code, name: d.schedule.shift.name, startAt: d.schedule.startAt.toISOString(), endAt: d.schedule.endAt.toISOString(), workMinutes: d.schedule.workMinutes, paidBreak: d.schedule.shift.paidBreak, breakMinutes: d.schedule.shift.breakMinutes },
  checkInAt: d.checkIn?.punchedAt.toISOString() ?? null, checkOutAt: d.checkOut?.punchedAt.toISOString() ?? null, status: d.status, flags: d.flags, workedMinutes: d.workedMinutes.toNumber(), dayMinutes: d.dayMinutes.toNumber(), nightMinutes: d.nightMinutes.toNumber(), lateMinutes: d.lateMinutes, earlyMinutes: d.earlyMinutes, absent: d.absent, workUnits: d.workUnits.toString(), processedAt: d.processedAt.toISOString() }; }

@Injectable()
export class AttendanceService {
  constructor(private readonly prisma: PrismaService, private readonly scope: ScopeService, private readonly settings: SettingsService, private readonly audit: AuditService) {}

  private transaction<T>(fn: (db: Db) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async db => {
      // Same lock as period creation, scheduling and transfer; DB trigger also enforces OPEN.
      await db.$queryRaw`SELECT pg_advisory_xact_lock(8210472)::text AS lock`;
      return fn(db);
    }, { isolationLevel: "Serializable", timeout: 90000 });
  }

  private async siteAccess(user: AuthUser, siteId: string, permission: string, db: Db = this.prisma, date = businessDate()) {
    const scoped = await this.scope.load(user, permission, db, date);
    const root = scoped.versions.find(v => v.siteId === siteId && v.type === "SITE");
    if (!root) throw new ForbiddenException("Cơ sở nằm ngoài phạm vi hoặc không hiệu lực tại ngày dữ liệu.");
    return { scoped, root };
  }

  async context(user: AuthUser) {
    const current = await this.scope.load(user, "attendance.read");
    const siteIds = [...new Set(current.versions.flatMap(v => v.siteId ? [v.siteId] : []))];
    const [sites, versions, periods] = await Promise.all([
      this.prisma.site.findMany({ where: { id: { in: siteIds } }, orderBy: { code: "asc" } }),
      this.prisma.orgUnitVersion.findMany({ where: effectiveAt(businessDate()), select: { orgUnitId: true, parentId: true, siteId: true, type: true } }),
      this.settings.listPeriods(user),
    ]);
    const visibleSites = sites.flatMap(s => { const root = versions.find(v => v.siteId === s.id && v.type === "SITE"); return root ? [{ id: s.id, code: s.code, name: s.name, orgUnitId: root.orgUnitId, periodIds: periods.items.filter(p => ancestors(root.orgUnitId, versions).includes(p.scopeOrgUnitId)).map(p => p.id) }] : []; });
    const importSiteIds = visibleSites.filter(s => current.allowed.has(s.orgUnitId)).map(s => s.id);
    const profiles = user.permissions.includes("attendance.import") ? await this.prisma.attendanceImportProfile.findMany({ where: { siteId: { in: importSiteIds } }, orderBy: { name: "asc" } }) : [];
    return { sites: visibleSites, units: current.versions.filter(v => v.siteId).map(v => ({ id: v.orgUnitId, code: v.orgUnit.code, name: v.name, siteId: v.siteId! })), periods: periods.items, profiles: profiles.map(p => ({ id: p.id, siteId: p.siteId, name: p.name, mapping: p.mapping, revision: p.revision })) };
  }

  async createProfile(user: AuthUser, dto: AttendanceProfileDto, ipAddress?: string) {
    const mapping = validateMapping(dto.mapping);
    return this.transaction(async db => {
      await this.siteAccess(user, dto.siteId, "attendance.import", db);
      const profile = await db.attendanceImportProfile.create({ data: { siteId: dto.siteId, name: dto.name.trim(), mapping: json(mapping) } });
      await this.audit.record({ actorId: user.id, entityType: "attendance_import_profile", entityId: profile.id, action: "CREATE", result: "SUCCESS", newValue: { siteId: dto.siteId, name: profile.name }, ipAddress }, db);
      return { profile: { id: profile.id, siteId: profile.siteId, name: profile.name, mapping: profile.mapping, revision: profile.revision } };
    });
  }

  private async reference(user: AuthUser, siteId: string, periodId: string, db: Db) {
    const { root } = await this.siteAccess(user, siteId, "attendance.import", db);
    const reference = await db.businessPeriod.findUnique({ where: { id: periodId } });
    const versions = await db.orgUnitVersion.findMany({ where: effectiveAt(reference?.dateFrom ?? businessDate()), select: { orgUnitId: true, parentId: true } });
    if (!reference || !ancestors(root.orgUnitId, versions).includes(reference.scopeOrgUnitId)) throw new BadRequestException("Kỳ tham chiếu không thuộc cơ sở đã chọn.");
    await this.siteAccess(user, siteId, "attendance.import", db, reference.dateFrom);
    return reference;
  }

  async importFile(user: AuthUser, dto: AttendanceImportDto, file?: Express.Multer.File, ipAddress?: string) {
    await this.siteAccess(user, dto.siteId, "attendance.import");
    if (!file) throw new BadRequestException("Chọn tệp CSV, XLSX hoặc TXT cần nhập.");
    const profile = dto.profileId ? await this.prisma.attendanceImportProfile.findFirst({ where: { id: dto.profileId, siteId: dto.siteId } }) : null;
    if (dto.profileId && !profile) throw new BadRequestException("Ánh xạ không thuộc cơ sở đã chọn.");
    const mapping = profile ? validateMapping(profile.mapping) : STANDARD_MAPPING;
    const filename = file.originalname.split(/[\\/]/).pop()!.slice(0, 255);
    let parsed: ParsedImport;
    try { parsed = await parseAttendanceFile(file.buffer, filename, mapping); }
    catch (error) {
      if (!(error instanceof BadRequestException)) throw error;
      parsed = { rows: [], errors: [{ row: 0, code: "FILE_ERROR", message: error.message }], totalRows: 0 };
    }
    return this.transaction(async db => {
      const reference = await this.reference(user, dto.siteId, dto.referencePeriodId, db);
      const current = await this.scope.load(user, "attendance.import", db);
      const errors: ImportRowError[] = [...parsed.errors];
      const codes = [...new Set(parsed.rows.map(r => r.employeeCode))];
      const employees = await db.employee.findMany({ where: { code: { in: codes } }, select: { id: true, code: true, hireDate: true, terminationDate: true, status: true, assignments: { where: { isPrimary: true } }, exclusions: { where: { userAccountId: user.id } } } });
      const byCode = new Map(employees.map(e => [e.code, e]));
      const dated = new Map<string, Scope>();
      const allDates = [...new Set(parsed.rows.flatMap(r => { const date = localDate(new Date(r.punchedAt)); return [key(date), key(shifted(date, -1))]; }))];
      for (const date of allDates) dated.set(date, await this.scope.load(user, "attendance.import", db, new Date(date + "T00:00:00Z")));
      const candidateSchedules = parsed.rows.length ? await db.shiftSchedule.findMany({ where: { employeeId: { in: employees.map(e => e.id) }, plan: { status: "APPROVED" }, startAt: { gte: new Date(Math.min(...parsed.rows.map(r => Date.parse(r.punchedAt))) - 2 * DAY), lte: new Date(Math.max(...parsed.rows.map(r => Date.parse(r.punchedAt))) + DAY) } }, include: { shift: true, plan: true } }) : [];
      for (const row of parsed.rows) {
        const employee = byCode.get(row.employeeCode);
        const date = localDate(new Date(row.punchedAt));
        const previous = shifted(date, -1);
        const currentMember = employee?.assignments.some(a => current.allowed.has(a.orgUnitId) && atDate([a], businessDate()).length > 0);
        let valid = false;
        if (employee && currentMember) for (const day of [date, previous]) {
          const scope = dated.get(key(day))!;
          const assignment = atDate(employee.assignments, day).find(a => scope.allowed.has(a.orgUnitId) && current.allowed.has(a.orgUnitId) && scope.versions.some(v => v.orgUnitId === a.orgUnitId && v.siteId === dto.siteId));
          if (!assignment || employee.hireDate > day || (employee.terminationDate ? employee.terminationDate <= day : employee.status !== "ACTIVE")) continue;
          if (employee.exclusions.some(e => atDate([e], day).length || atDate([e], businessDate()).length)) continue;
          // A previous-day assignment is only valid for an actual approved overnight exit.
          if (day.getTime() === previous.getTime() && !candidateSchedules.some(s => s.employeeId === employee.id && s.workDate.getTime() === day.getTime() && s.endAt.getTime() >= Date.parse(row.punchedAt) - 6 * 3600000 && s.endAt.getTime() <= Date.parse(row.punchedAt) + 6 * 3600000)) continue;
          valid = true; break;
        }
        if (!valid) errors.push({ row: row.row, code: "EMPLOYEE_SCOPE", message: "Mã nhân viên không tồn tại, ngoài cơ sở/phạm vi hoặc không có phân công hiệu lực tại ngày dữ liệu." });
      }
      const summary = emptySummary();
      const batch = await db.attendanceImport.create({ data: { siteId: dto.siteId, referencePeriodId: reference.id, profileId: profile?.id, fileName: filename, fileHash: createHash("sha256").update(file.buffer).digest("hex"), mapping: json(mapping), status: errors.length ? "REJECTED" : "ACCEPTED", totalRows: parsed.totalRows, summary: json(summary), errors: json(errors), createdById: user.id }, include: batchInclude });
      if (!errors.length) {
        const data = parsed.rows.map(r => ({ id: randomUUID(), siteId: dto.siteId, employeeId: byCode.get(r.employeeCode)!.id, punchedAt: new Date(r.punchedAt), deviceCode: r.deviceCode, direction: r.direction, batchId: batch.id, rowNumber: r.row, source: r.source }));
        for (let offset = 0; offset < data.length; offset += 500) summary.inserted += (await db.rawPunch.createMany({ data: data.slice(offset, offset + 500), skipDuplicates: true })).count;
        summary.duplicates = parsed.totalRows - summary.inserted;
        if (summary.inserted) {
          const inserted = await db.rawPunch.findMany({ where: { batchId: batch.id }, select: { id: true } });
          const processing = await this.processRows(user, dto.siteId, reference, db, new Set(inserted.map(r => r.id)));
          Object.assign(summary, processing, { inserted: summary.inserted, duplicates: summary.duplicates });
        }
      }
      const status = errors.length ? "REJECTED" : summary.waiting || summary.late || summary.exceptionDays ? "ACCEPTED_WITH_EXCEPTIONS" : "ACCEPTED";
      const final = await db.attendanceImport.update({ where: { id: batch.id }, data: { summary: json(summary), status }, include: batchInclude });
      await this.audit.record({ actorId: user.id, entityType: "attendance_import", entityId: batch.id, action: "IMPORT", result: status, newValue: { siteId: dto.siteId, fileHash: batch.fileHash, totalRows: parsed.totalRows, errors: errors.length, summary: json(summary) }, ipAddress }, db);
      return { batch: batchView(final) };
    });
  }

  async process(user: AuthUser, dto: AttendanceProcessDto, ipAddress?: string) {
    return this.transaction(async db => {
      const reference = await this.reference(user, dto.siteId, dto.referencePeriodId, db);
      const summary = await this.processRows(user, dto.siteId, reference, db);
      await this.audit.record({ actorId: user.id, entityType: "attendance_processing", entityId: reference.id, action: "PROCESS", result: "SUCCESS", newValue: { siteId: dto.siteId, summary: json(summary) }, ipAddress }, db);
      return { summary };
    });
  }

  private async rules(db: Db, orgUnitId: string, date: Date): Promise<{ values: PairingRules; parameterIds: Record<string, string> }> {
    const values = {} as PairingRules, parameterIds: Record<string, string> = {};
    for (const name of Object.keys(ruleCodes) as Array<keyof PairingRules>) {
      const row = await this.settings.resolveLegalParameter(ruleCodes[name], "ALL", "WORK_DATE", orgUnitId, date, db);
      const number = row && (typeof row.value === "string" || typeof row.value === "number") ? Number(row.value) : NaN;
      if (!Number.isInteger(number) || number < 0 || number > 360 || (name === "duplicateWindowMinutes" && number === 0)) throw new InternalServerErrorException("Thiếu hoặc sai tham số ghép công: " + ruleCodes[name]);
      values[name] = number; parameterIds[name] = row!.id;
    }
    return { values, parameterIds };
  }

  private async processRows(user: AuthUser, siteId: string, reference: BusinessPeriod, db: Db, onlyIds?: Set<string>): Promise<ImportSummary> {
    const current = await this.scope.load(user, "attendance.import", db);
    const periods = await db.businessPeriod.findMany({ where: { scopeOrgUnitId: reference.scopeOrgUnitId, periodType: "ATTENDANCE" }, orderBy: { dateFrom: "asc" } });
    const index = periods.findIndex(p => p.id === reference.id);
    const adjacent = periods.slice(Math.max(0, index - 1), index + 2);
    const from = adjacent[0]?.dateFrom ?? reference.dateFrom, to = adjacent.at(-1)?.dateTo ?? reference.dateTo;
    const rangeFrom = new Date(key(shifted(from, -1)) + "T00:00:00+07:00"), rangeTo = new Date(key(shifted(to, 2)) + "T06:00:00+07:00");
    const [raw, candidates] = await Promise.all([
      db.rawPunch.findMany({ where: { siteId, OR: [{ punchedAt: { gte: rangeFrom, lte: rangeTo } }, ...(onlyIds ? [{ id: { in: [...onlyIds] } }] : [])] }, orderBy: [{ punchedAt: "asc" }, { id: "asc" }] }),
      db.shiftSchedule.findMany({ where: { plan: { status: "APPROVED" }, workDate: { gte: shifted(from, -1), lte: shifted(to, 1) } }, include: { plan: true, shift: true } }),
    ]);
    const scopes = new Map<string, Scope>();
    const getScope = async (day: Date) => { let scoped = scopes.get(key(day)); if (!scoped) { scoped = await this.scope.load(user, "attendance.import", db, day); scopes.set(key(day), scoped); } return scoped; };
    const employees = await db.employee.findMany({ where: { id: { in: [...new Set([...raw.map(r => r.employeeId), ...candidates.map(s => s.employeeId)])] } }, select: { id: true, assignments: { where: { isPrimary: true } }, exclusions: { where: { userAccountId: user.id } } } });
    const byEmployee = new Map(employees.map(e => [e.id, e]));
    const canRead = (employeeId: string, date: Date, scoped: Scope, orgUnitId?: string) => {
      const e = byEmployee.get(employeeId);
      return Boolean(e && e.assignments.some(a => current.allowed.has(a.orgUnitId) && atDate([a], businessDate()).length) && e.assignments.some(a => (!orgUnitId || a.orgUnitId === orgUnitId) && current.allowed.has(a.orgUnitId) && scoped.allowed.has(a.orgUnitId) && atDate([a], date).length) && !e.exclusions.some(x => atDate([x], businessDate()).length || atDate([x], date).length));
    };
    const schedules: EngineSchedule[] = [], schedulePeriods = new Map<string, BusinessPeriod | null>();
    const byRules = new Map<string, { values: PairingRules; parameterIds: Record<string, string> }>();
    const rulesBySchedule: Record<string, PairingRules> = {}, snapshots = new Map<string, object>();
    const allTargetPeriods = await db.businessPeriod.findMany({ where: { periodType: "ATTENDANCE", dateFrom: { lte: shifted(to, 1) }, dateTo: { gte: shifted(from, -1) } } });
    for (const s of candidates) {
      const scoped = await getScope(s.workDate);
      if (!scoped.versions.some(v => v.orgUnitId === s.plan.teamOrgUnitId && v.siteId === siteId) || !canRead(s.employeeId, s.workDate, scoped, s.plan.teamOrgUnitId)) continue;
      const cacheKey = s.plan.teamOrgUnitId + ":" + key(s.workDate);
      let rules = byRules.get(cacheKey);
      if (!rules) { rules = await this.rules(db, s.plan.teamOrgUnitId, s.workDate); byRules.set(cacheKey, rules); }
      schedules.push({ id: s.id, employeeId: s.employeeId, orgUnitId: s.plan.teamOrgUnitId, workDate: key(s.workDate), startAt: s.startAt.toISOString(), endAt: s.endAt.toISOString(), workMinutes: s.workMinutes, breakStartOffset: s.shift.breakStartOffset, breakMinutes: s.shift.breakMinutes, paidBreak: s.shift.paidBreak });
      rulesBySchedule[s.id] = rules.values; snapshots.set(s.id, rules);
      const parents = ancestors(s.plan.teamOrgUnitId, scoped.versions);
      const targets = allTargetPeriods.filter(p => p.dateFrom <= s.workDate && p.dateTo >= s.workDate && parents.includes(p.scopeOrgUnitId)).sort((a, b) => parents.indexOf(a.scopeOrgUnitId) - parents.indexOf(b.scopeOrgUnitId));
      const target = targets[0] ?? null;
      schedulePeriods.set(s.id, target && s.workDate >= from && s.workDate <= to ? target : null);
    }
    const selectedRaw = [] as typeof raw;
    for (const r of raw) {
      const date = localDate(r.punchedAt), scoped = await getScope(date);
      const previous = shifted(date, -1), priorScope = await getScope(previous);
      if (canRead(r.employeeId, date, scoped) || canRead(r.employeeId, previous, priorScope)) selectedRaw.push(r);
    }
    const result = computeAttendance(schedules, selectedRaw.map(r => ({ id: r.id, employeeId: r.employeeId, punchedAt: r.punchedAt.toISOString(), direction: r.direction as PunchDirection })), rulesBySchedule);
    const scheduleById = new Map(schedules.map(s => [s.id, s]));
    const now = new Date(), eligibleDays = result.days.filter(d => { const s = scheduleById.get(d.scheduleId)!; return d.checkInId || d.checkOutId || Date.parse(s.endAt) + rulesBySchedule[s.id].outAfterMinutes * MINUTE < now.getTime(); });
    const dayRecords = eligibleDays.flatMap(d => {
      const period = schedulePeriods.get(d.scheduleId);
      if (!period || period.status !== "OPEN") return [];
      return [{ id: randomUUID(), schedule_id: d.scheduleId, employee_id: d.employeeId, org_unit_id: d.orgUnitId, period_id: period.id, work_date: d.workDate, check_in_id: d.checkInId, check_out_id: d.checkOutId, status: d.status, flags: d.flags, worked_minutes: d.workedMinutes, day_minutes: d.dayMinutes, night_minutes: d.nightMinutes, late_minutes: d.lateMinutes, early_minutes: d.earlyMinutes, absent: d.absent, work_units: d.workUnits, segments: d.segments, rules: snapshots.get(d.scheduleId), processed_at: now.toISOString() }];
    });
    for (let offset = 0; offset < dayRecords.length; offset += 500) {
      const rows = JSON.stringify(dayRecords.slice(offset, offset + 500));
      await db.$executeRaw`INSERT INTO daily_attendance (id,schedule_id,employee_id,org_unit_id,period_id,work_date,check_in_id,check_out_id,status,flags,worked_minutes,day_minutes,night_minutes,late_minutes,early_minutes,absent,work_units,segments,rules,processed_at)
      SELECT id,schedule_id,employee_id,org_unit_id,period_id,work_date,check_in_id,check_out_id,status,flags,worked_minutes,day_minutes,night_minutes,late_minutes,early_minutes,absent,work_units,segments,rules,processed_at FROM jsonb_to_recordset(${rows}::jsonb) AS x(id uuid,schedule_id uuid,employee_id uuid,org_unit_id uuid,period_id uuid,work_date date,check_in_id uuid,check_out_id uuid,status text,flags text[],worked_minutes numeric,day_minutes numeric,night_minutes numeric,late_minutes int,early_minutes int,absent boolean,work_units numeric,segments jsonb,rules jsonb,processed_at timestamptz)
      ON CONFLICT (schedule_id) DO UPDATE SET period_id=EXCLUDED.period_id,check_in_id=EXCLUDED.check_in_id,check_out_id=EXCLUDED.check_out_id,status=EXCLUDED.status,flags=EXCLUDED.flags,worked_minutes=EXCLUDED.worked_minutes,day_minutes=EXCLUDED.day_minutes,night_minutes=EXCLUDED.night_minutes,late_minutes=EXCLUDED.late_minutes,early_minutes=EXCLUDED.early_minutes,absent=EXCLUDED.absent,work_units=EXCLUDED.work_units,segments=EXCLUDED.segments,rules=EXCLUDED.rules,processed_at=EXCLUDED.processed_at`;
    }
    const states = result.punches.map(p => {
      const s = p.scheduleId ? scheduleById.get(p.scheduleId) : null;
      const period = p.scheduleId ? schedulePeriods.get(p.scheduleId) : null;
      const state = !s ? p.status === "AMBIGUOUS" ? "AMBIGUOUS" : "UNMATCHED" : !period ? "WAITING" : period.status === "LOCKED" ? "LATE" : period.status !== "OPEN" ? "WAITING" : p.status === "MATCHED" ? "PROCESSED" : p.status;
      const reason = s && !period ? "MISSING_OR_OUTSIDE_REFERENCE_PERIOD" : period?.status === "LOCKED" ? "PERIOD_LOCKED" : period && period.status !== "OPEN" ? "PERIOD_" + period.status : p.reason;
      return { punch_id: p.punchId, schedule_id: s?.id ?? null, period_id: period?.id ?? null, work_date: s?.workDate ?? null, state, reason, processed_at: now.toISOString() };
    });
    for (let offset = 0; offset < states.length; offset += 500) {
      const rows = JSON.stringify(states.slice(offset, offset + 500));
      await db.$executeRaw`INSERT INTO punch_processing (punch_id,schedule_id,period_id,work_date,state,reason,processed_at) SELECT punch_id,schedule_id,period_id,work_date,state,reason,processed_at FROM jsonb_to_recordset(${rows}::jsonb) AS x(punch_id uuid,schedule_id uuid,period_id uuid,work_date date,state text,reason text,processed_at timestamptz)
      ON CONFLICT (punch_id) DO UPDATE SET schedule_id=EXCLUDED.schedule_id,period_id=EXCLUDED.period_id,work_date=EXCLUDED.work_date,state=EXCLUDED.state,reason=EXCLUDED.reason,processed_at=EXCLUDED.processed_at`;
    }
    const summary = emptySummary();
    summary.exceptionDays = dayRecords.filter(d => d.flags.length).length;
    const groups = new Map<string, ImportSummary["periods"][number]>();
    for (const state of states) {
      if (onlyIds && !onlyIds.has(state.punch_id)) continue;
      const field = state.state === "LATE" ? "late" : ["PROCESSED", "SUPPRESSED"].includes(state.state) ? "processed" : "waiting";
      summary[field]++;
      const id = state.period_id ?? "unrouted";
      let group = groups.get(id);
      if (!group) { group = { periodId: state.period_id, periodCode: allTargetPeriods.find(p => p.id === state.period_id)?.code ?? null, processed: 0, waiting: 0, late: 0 }; groups.set(id, group); }
      group[field]++;
    }
    summary.periods = [...groups.values()];
    return summary;
  }

  private async importSites(user: AuthUser, siteId?: string) {
    const current = await this.scope.load(user, "attendance.import");
    const ids = [...new Set(current.versions.filter(v => v.type === "SITE" && v.siteId).map(v => v.siteId!))];
    if (siteId && !ids.includes(siteId)) throw new ForbiddenException("Cơ sở ngoài phạm vi.");
    return siteId ? [siteId] : ids;
  }

  async imports(user: AuthUser, q: AttendancePageQuery) {
    const ids = await this.importSites(user, q.siteId);
    const where = { siteId: { in: ids } };
    const [items, total] = await Promise.all([this.prisma.attendanceImport.findMany({ where, include: batchInclude, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }), this.prisma.attendanceImport.count({ where })]);
    return { items: items.map(batchView), total, page: q.page, pageSize: q.pageSize };
  }

  async batch(user: AuthUser, id: string) {
    const ids = await this.importSites(user);
    const batch = await this.prisma.attendanceImport.findFirst({ where: { id, siteId: { in: ids } }, include: batchInclude });
    if (!batch) throw new NotFoundException("Không tìm thấy lô nhập trong phạm vi.");
    const punches = await this.prisma.rawPunch.findMany({ where: { batchId: id }, include: rawInclude, orderBy: { rowNumber: "asc" } });
    return { batch: batchView(batch), punches: punches.map(rawView) };
  }

  async punches(user: AuthUser, q: AttendancePunchQuery) {
    const ids = await this.importSites(user, q.siteId);
    const where: Prisma.RawPunchWhereInput = { siteId: { in: ids }, ...(q.state ? { processing: { is: { state: q.state } } } : {}) };
    const [rows, total] = await Promise.all([this.prisma.rawPunch.findMany({ where, include: rawInclude, orderBy: [{ punchedAt: "desc" }, { id: "asc" }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }), this.prisma.rawPunch.count({ where })]);
    return { items: rows.map(rawView), total, page: q.page, pageSize: q.pageSize };
  }

  private async dayVisibility(user: AuthUser, periodId: string, orgUnitId?: string): Promise<Prisma.DailyAttendanceWhereInput> {
    const current = await this.scope.load(user, "attendance.read");
    if (orgUnitId && !current.allowed.has(orgUnitId)) throw new ForbiddenException("Đơn vị ngoài phạm vi.");
    const dates = await this.prisma.dailyAttendance.findMany({ where: { periodId }, distinct: ["workDate"], select: { workDate: true } });
    const alternatives: Prisma.DailyAttendanceWhereInput[] = [];
    for (const { workDate } of dates) {
      const scoped = await this.scope.load(user, "attendance.read", this.prisma, workDate);
      const allowed = [...scoped.allowed].filter(id => current.allowed.has(id));
      let units = allowed;
      if (orgUnitId) units = allowed.filter(id => ancestors(id, scoped.versions).includes(orgUnitId));
      alternatives.push({ workDate, orgUnitId: { in: units }, employee: { AND: [
        { assignments: { some: { orgUnitId: { in: [...current.allowed] }, isPrimary: true, ...effectiveAt(businessDate()) } } },
        { assignments: { some: { orgUnitId: { in: units }, isPrimary: true, ...effectiveAt(workDate) } } },
        { exclusions: { none: { userAccountId: user.id, OR: [effectiveAt(businessDate()), effectiveAt(workDate)] } } },
      ] } });
    }
    return { periodId, OR: alternatives };
  }

  private async dayNames(rows: Daily[]) {
    if (!rows.length) return new Map<string, string>();
    const versions = await this.prisma.orgUnitVersion.findMany({ where: { orgUnitId: { in: [...new Set(rows.map(d => d.orgUnitId))] } }, select: { orgUnitId: true, name: true, effectiveFrom: true, effectiveTo: true } });
    return new Map(rows.map(d => [d.id, atDate(versions, d.workDate).find(v => v.orgUnitId === d.orgUnitId)?.name ?? d.orgUnit.code]));
  }

  async board(user: AuthUser, q: AttendanceBoardQuery) {
    const periods = await this.settings.listPeriods(user);
    const period = periods.items.find(p => p.id === q.periodId);
    if (!period) throw new NotFoundException("Không tìm thấy kỳ công trong phạm vi.");
    const visibility = await this.dayVisibility(user, period.id, q.orgUnitId);
    const conditions: Prisma.DailyAttendanceWhereInput[] = [visibility];
    if (q.search?.trim()) conditions.push({ employee: { OR: [{ code: { contains: q.search.trim(), mode: "insensitive" } }, { fullName: { contains: q.search.trim(), mode: "insensitive" } }] } });
    if (q.exceptionsOnly === "true") conditions.push({ NOT: { flags: { isEmpty: true } } });
    const where = { AND: conditions };
    const [rows, total, sums, exceptions] = await Promise.all([
      this.prisma.dailyAttendance.findMany({ where, include: dayInclude, orderBy: [{ workDate: "asc" }, { employee: { code: "asc" } }, { id: "asc" }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.dailyAttendance.count({ where }),
      this.prisma.dailyAttendance.aggregate({ where, _sum: { workedMinutes: true, nightMinutes: true } }),
      this.prisma.dailyAttendance.count({ where: { AND: [where, { NOT: { flags: { isEmpty: true } } }] } }),
    ]);
    const names = await this.dayNames(rows);
    return { items: rows.map(d => dayView(d, names.get(d.id)!)), total, page: q.page, pageSize: q.pageSize, period, summary: { days: total, exceptionDays: exceptions, workedMinutes: sums._sum.workedMinutes?.toNumber() ?? 0, nightMinutes: sums._sum.nightMinutes?.toNumber() ?? 0 } };
  }

  async day(user: AuthUser, id: string, ipAddress?: string) {
    const candidate = await this.prisma.dailyAttendance.findUnique({ where: { id }, select: { periodId: true } });
    if (!candidate) { await this.scope.load(user, "attendance.read"); throw new NotFoundException("Không tìm thấy ngày công."); }
    const visibility = await this.dayVisibility(user, candidate.periodId);
    const row = await this.prisma.dailyAttendance.findFirst({ where: { AND: [{ id }, visibility] }, include: dayInclude });
    if (!row) throw new NotFoundException("Không tìm thấy ngày công trong phạm vi.");
    const punches = await this.prisma.rawPunch.findMany({ where: { processing: { is: { scheduleId: row.scheduleId } } }, include: rawInclude, orderBy: [{ punchedAt: "asc" }, { id: "asc" }] });
    const names = await this.dayNames([row]);
    await this.audit.record({ actorId: user.id, entityType: "daily_attendance", entityId: id, action: "READ", result: "ALLOWED", ipAddress });
    return { day: dayView(row, names.get(id)!), punches: punches.map(rawView), segments: row.segments };
  }
}
