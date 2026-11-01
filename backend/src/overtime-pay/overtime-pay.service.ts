import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { AuditService } from "../audit/audit.service";
import { businessDate } from "../auth/business-date";
import type { AuthUser } from "../auth/auth.types";
import type { PayrollTimeSource } from "../attendance/period-lock.service";
import { PrismaService } from "../database/prisma.service";
import { holidayCalendar } from "../leave/holiday-calendar";
import { LeaveAccessService, type LeaveScope } from "../leave/leave-access.service";
import { SettingsService } from "../settings/settings.service";
import { buildWorkDay, RATE_PARAMETER_CODES, type DayCalendar, type PayBucket, type RateParameters, type WorkDayError } from "./overtime-pay-engine";
import type { CompTimeRequestDto, OvertimePayBucketQueryDto, RatePreviewDto } from "./overtime-pay.dto";

type Db = Prisma.TransactionClient;
type WorkDaySource = { employeeId: string; orgUnitId: string; workDate: string; overtime: Array<{ startAt: string; endAt: string; eligible: boolean }>; regular: Array<{ startAt: string; endAt: string }> };
const DAY = 86_400_000;
const key = (date: Date) => date.toISOString().slice(0, 10);
const date = (text: string) => {
  const value = new Date(text + "T00:00:00Z");
  if (!Number.isFinite(value.getTime()) || key(value) !== text) throw new BadRequestException("Ngày không hợp lệ.");
  return value;
};

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return "{" + Object.entries(value).filter(([, item]) => item !== undefined).sort(([left], [right]) => left.localeCompare(right)).map(([name, item]) => JSON.stringify(name) + ":" + canonical(item)).join(",") + "}";
}
function workDayKey(row: { employeeId: string; orgUnitId: string; workDate: string }) { return row.employeeId + ":" + row.orgUnitId + ":" + row.workDate; }

/** Groups frozen or live attendance pieces per work day; regular pieces only matter for night hours. */
function workDays(source: PayrollTimeSource): WorkDaySource[] {
  const days = new Map<string, WorkDaySource>();
  const ensure = (row: { employeeId: string; orgUnitId: string; workDate: string }) => {
    const existing = days.get(workDayKey(row));
    if (existing) return existing;
    const created = { employeeId: row.employeeId, orgUnitId: row.orgUnitId, workDate: row.workDate, overtime: [], regular: [] };
    days.set(workDayKey(row), created);
    return created;
  };
  for (const row of source.overtime) ensure(row).overtime.push(...row.segments);
  for (const row of source.regular) ensure(row).regular.push(...row.segments.filter(piece => piece.kind === "NIGHT"));
  return [...days.values()].filter(day => day.overtime.length || day.regular.length);
}

function bucketView(bucket: PayBucket, status: "DRAFT" | "LOCKED", sourceHash: string, employee?: { code: string; fullName: string }) {
  return { ...bucket, employee: employee ? { id: bucket.employeeId, ...employee } : { id: bucket.employeeId, code: "", fullName: "" }, sourceStatus: status, sourceHash };
}

@Injectable()
export class OvertimePayService {
  constructor(private readonly prisma: PrismaService, private readonly access: LeaveAccessService, private readonly settings: SettingsService, private readonly audit: AuditService) {}

  private assertReader(user: AuthUser) {
    if (!user.permissions.includes("overtime.read") || !user.roles.some(role => role === "KT" || role === "QD"))
      throw new ForbiddenException("Chỉ KT hoặc QĐ được xem giờ OT theo hệ số.");
  }

  /** Resolves the five rate parameters plus the day-type calendar for one work date and unit. */
  async rateContext(db: Db, orgUnitId: string, workDate: string): Promise<{ parameters: RateParameters; calendar: DayCalendar }> {
    const day = date(workDate);
    const parameters: RateParameters = {};
    for (const code of RATE_PARAMETER_CODES) {
      const row = await this.settings.resolveLegalParameter(code, "ALL", "WORK_DATE", orgUnitId, day, db);
      if (row && typeof row.value === "string") parameters[code] = { id: row.id, paramCode: row.paramCode, scopeKey: row.scopeKey, effectiveFrom: key(row.effectiveFrom), value: row.value, legalBasis: row.legalBasis };
    }
    const holidays = new Set<string>();
    let holidayStatus: string | undefined, holidayReference: string | undefined;
    // A work day can spill into the next calendar day (and year), whose calendar may be a different version.
    for (const asOf of [day, new Date(day.getTime() + DAY)]) {
      const row = await this.settings.resolveLegalParameter("HOLIDAY_CALENDAR", "ALL", "WORK_DATE", orgUnitId, asOf, db);
      if (!row) continue;
      const calendar = holidayCalendar(row.value);
      calendar.dates.forEach(item => holidays.add(item));
      holidayStatus ??= calendar.status; holidayReference ??= calendar.reference;
    }
    const rest = await this.settings.resolveLegalParameter("WEEKLY_REST_DAYS", "ALL", "WORK_DATE", orgUnitId, day, db);
    const restDays = (rest?.value as { days?: unknown } | null)?.days;
    const weeklyRestDays = Array.isArray(restDays) ? restDays.filter((item): item is number => Number.isInteger(item) && item >= 1 && item <= 7) : [];
    return { parameters, calendar: { holidays: [...holidays].sort(), weeklyRestDays, holidayStatus, holidayReference } };
  }

  private async compute(db: Db, source: PayrollTimeSource) {
    const contexts = new Map<string, Awaited<ReturnType<OvertimePayService["rateContext"]>>>();
    const buckets: PayBucket[] = [];
    const errors: WorkDayError[] = [];
    for (const day of workDays(source)) {
      const contextKey = day.orgUnitId + ":" + day.workDate;
      let context = contexts.get(contextKey);
      if (!context) { context = await this.rateContext(db, day.orgUnitId, day.workDate); contexts.set(contextKey, context); }
      const result = buildWorkDay({ ...day, parameters: context.parameters, calendar: context.calendar });
      if (result.error) errors.push(result.error);
      else buckets.push(...result.buckets);
    }
    return { buckets, errors };
  }

  private async liveSource(db: Db, periodId: string): Promise<PayrollTimeSource> {
    const [actuals, days] = await Promise.all([
      db.overtimeActual.findMany({ where: { periodId }, orderBy: [{ employeeId: "asc" }, { orgUnitId: "asc" }, { workDate: "asc" }] }),
      db.dailyAttendance.findMany({ where: { periodId }, orderBy: [{ employeeId: "asc" }, { orgUnitId: "asc" }, { workDate: "asc" }, { scheduleId: "asc" }] }),
    ]);
    type Piece = { startAt: string; endAt: string; kind?: string; eligible?: boolean };
    return {
      schemaVersion: 1,
      overtime: actuals.map(row => ({ employeeId: row.employeeId, orgUnitId: row.orgUnitId, workDate: key(row.workDate), segments: ((row.evidence as { segments?: Piece[] }).segments ?? []).map(piece => ({ startAt: piece.startAt, endAt: piece.endAt, eligible: piece.eligible === true })) })),
      regular: days.map(row => ({ employeeId: row.employeeId, orgUnitId: row.orgUnitId, workDate: key(row.workDate), segments: ((row.segments as Piece[] | null) ?? []).map(piece => ({ startAt: piece.startAt, endAt: piece.endAt, kind: piece.kind ?? "DAY" })) })),
    };
  }

  /** Official buckets for a LOCKED period: materialized once from the lock snapshot, never from live attendance. */
  async lockedBuckets(db: Db, periodId: string) {
    const event = await db.attendancePeriodLockEvent.findFirst({ where: { periodId, action: "LOCK" }, orderBy: { revision: "desc" } });
    if (!event) throw new ConflictException("Kỳ LOCKED không có nguồn khóa bất biến.");
    const snapshot = event.snapshot as { payrollTime?: PayrollTimeSource };
    if (!snapshot.payrollTime) throw new ConflictException({ code: "OT_SEGMENTS_UNAVAILABLE", message: "Snapshot khóa kỳ công này chưa lưu đoạn giờ OT; không tính lại từ dữ liệu sống." });
    const stored = await db.overtimePayBucket.findMany({ where: { periodId, lockEventId: event.id }, orderBy: [{ employeeId: "asc" }, { workDate: "asc" }, { kind: "asc" }, { dayType: "asc" }, { isNight: "asc" }] });
    if (stored.length) return { sourceHash: event.sourceHash, lockEventId: event.id, materialized: true, errors: [] as WorkDayError[], buckets: stored.map(row => this.fromRow(row)) };
    const { buckets, errors } = await this.compute(db, snapshot.payrollTime);
    if (!errors.length && buckets.length) {
      await db.overtimePayBucket.createMany({ data: buckets.map(bucket => ({
        periodId, lockEventId: event.id, employeeId: bucket.employeeId, orgUnitId: bucket.orgUnitId, workDate: date(bucket.workDate),
        kind: bucket.kind, dayType: bucket.dayType, isNight: bucket.isNight, hasDayOt: bucket.hasDayOt,
        minutes: new Prisma.Decimal(bucket.minutes), rate: new Prisma.Decimal(bucket.rate), rateBreakdown: JSON.parse(JSON.stringify(bucket.rateBreakdown)) as Prisma.InputJsonValue,
        sourceStatus: "LOCKED" as const, sourceHash: event.sourceHash,
      })), skipDuplicates: true });
    }
    return { sourceHash: event.sourceHash, lockEventId: event.id, materialized: !errors.length && buckets.length > 0, errors, buckets };
  }

  private fromRow(row: Prisma.OvertimePayBucketGetPayload<object>): PayBucket {
    return { employeeId: row.employeeId, orgUnitId: row.orgUnitId, workDate: key(row.workDate), kind: row.kind, dayType: row.dayType, isNight: row.isNight, hasDayOt: row.hasDayOt,
      minutes: row.minutes.toString(), rate: row.rate.toString(), rateBreakdown: row.rateBreakdown as unknown as PayBucket["rateBreakdown"] };
  }

  /** Draft buckets from the current overtime_actual; labelled DRAFT and refused by official payroll. */
  async draftBuckets(db: Db, periodId: string) {
    const source = await this.liveSource(db, periodId);
    const { buckets, errors } = await this.compute(db, source);
    return { sourceHash: createHash("sha256").update(canonical(source)).digest("hex"), buckets, errors };
  }

  private async visibility(db: Db, user: AuthUser) {
    const today = businessDate();
    const scopes = new Map<string, LeaveScope>();
    const scoped = async (day: Date) => {
      const text = key(day);
      if (!scopes.has(text)) scopes.set(text, await this.access.scoped(user, "overtime.read", db, day));
      return scopes.get(text)!;
    };
    const current = await scoped(today);
    const exclusions = await db.employeeExclusion.findMany({ where: { userAccountId: user.id } });
    return async (row: { employeeId: string; orgUnitId: string; workDate: string }) => {
      const day = date(row.workDate);
      if (!current.allowed.has(row.orgUnitId) || !(await scoped(day)).allowed.has(row.orgUnitId)) return false;
      return !exclusions.some(item => item.employeeId === row.employeeId && [today, day].some(at => item.effectiveFrom <= at && (!item.effectiveTo || item.effectiveTo >= at)));
    };
  }

  async buckets(user: AuthUser, query: OvertimePayBucketQueryDto) {
    this.assertReader(user);
    return this.prisma.$transaction(async db => {
      const period = await db.businessPeriod.findUnique({ where: { id: query.periodId } });
      if (!period || period.periodType !== "ATTENDANCE") throw new NotFoundException("Không tìm thấy kỳ công.");
      const visible = await this.visibility(db, user);
      if (query.orgUnitId && !(await visible({ employeeId: "", orgUnitId: query.orgUnitId, workDate: key(period.dateFrom) }))) throw new ForbiddenException("Bạn không có quyền xem đơn vị này.");
      const status = period.status === "LOCKED" ? "LOCKED" as const : "DRAFT" as const;
      const result = status === "LOCKED" ? await this.lockedBuckets(db, period.id) : { ...(await this.draftBuckets(db, period.id)), materialized: false };
      const filtered: PayBucket[] = [];
      for (const bucket of result.buckets) {
        if (query.orgUnitId && bucket.orgUnitId !== query.orgUnitId) continue;
        if (query.employeeId && bucket.employeeId !== query.employeeId) continue;
        if (await visible(bucket)) filtered.push(bucket);
      }
      const errors = [];
      for (const error of result.errors) if ((!query.orgUnitId || error.orgUnitId === query.orgUnitId) && (!query.employeeId || error.employeeId === query.employeeId) && await visible(error)) errors.push(error);
      const people = await db.employee.findMany({ where: { id: { in: [...new Set(filtered.map(bucket => bucket.employeeId))] } }, select: { id: true, code: true, fullName: true } });
      const byId = new Map(people.map(person => [person.id, person]));
      return {
        period: { id: period.id, code: period.code, status: period.status, dateFrom: key(period.dateFrom), dateTo: key(period.dateTo) },
        sourceStatus: status, sourceHash: result.sourceHash, materialized: result.materialized,
        items: filtered.map(bucket => bucketView(bucket, status, result.sourceHash, byId.get(bucket.employeeId))),
        errors,
      };
    }, { timeout: 60_000 });
  }

  async ratePreview(user: AuthUser, dto: RatePreviewDto) {
    if (!user.roles.includes("KT") || !user.permissions.includes("overtime.read")) throw new ForbiddenException("Chỉ KT được chạy thử hệ số OT.");
    const day = date(dto.workDate);
    await this.access.assertUnit(user, "overtime.read", dto.orgUnitId, [day]);
    const context = await this.rateContext(this.prisma, dto.orgUnitId, dto.workDate);
    const parameters: RateParameters = { ...context.parameters };
    for (const [code, value] of Object.entries(dto.overrides ?? {})) {
      if (!(RATE_PARAMETER_CODES as readonly string[]).includes(code) || typeof value !== "string" || !/^\d+(?:\.\d{1,6})?$/.test(value)) throw new BadRequestException("Giá trị chạy thử không hợp lệ: " + code);
      parameters[code as keyof RateParameters] = { id: "preview", paramCode: code, scopeKey: "PREVIEW", effectiveFrom: dto.workDate, value };
    }
    for (const interval of dto.intervals) if (Date.parse(interval.endAt) <= Date.parse(interval.startAt) || Date.parse(interval.endAt) - Date.parse(interval.startAt) > DAY) throw new BadRequestException("Khoảng OT chạy thử phải dương và không quá 24 giờ.");
    const result = buildWorkDay({ employeeId: "preview", orgUnitId: dto.orgUnitId, workDate: dto.workDate, overtime: dto.intervals.map(interval => ({ ...interval, eligible: true })), regular: [], parameters, calendar: context.calendar });
    if (result.error) throw new ConflictException({ code: result.error.code, message: result.error.message });
    return { workDate: dto.workDate, hasDayOt: result.hasDayOt, segments: result.segments.overtime, buckets: result.buckets, calendar: context.calendar };
  }

  /** DEC-01: OT-to-comp-time conversion is not enabled; every request is refused and audited, nothing is created. */
  async compTimeRequest(user: AuthUser, dto: CompTimeRequestDto, ip?: string) {
    if (!user.permissions.includes("overtime.read")) throw new ForbiddenException("Bạn không có quyền thực hiện thao tác này.");
    const day = date(dto.workDate);
    await this.access.assertEmployee(user, "overtime.read", dto.employeeId, [day]);
    const assignment = await this.prisma.orgAssignment.findFirst({ where: { employeeId: dto.employeeId, isPrimary: true, effectiveFrom: { lte: day }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: day } }] } });
    const flag = assignment ? await this.settings.resolveLegalParameter("COMP_TIME_ENABLED", "ALL", "WORK_DATE", assignment.orgUnitId, day) : null;
    const configured = flag !== null;
    await this.audit.record({ actorId: user.id, entityType: "overtime_comp_time_request", entityId: dto.employeeId, action: "REQUEST", result: "REJECTED",
      newValue: { workDate: dto.workDate, hours: dto.hours, code: "COMP_TIME_DISABLED", configured, parameterId: flag?.id ?? null, warning: configured ? null : "COMP_TIME_ENABLED chưa cấu hình; mặc định coi là false" }, ipAddress: ip });
    throw new ConflictException({ code: "COMP_TIME_DISABLED", message: "Quy đổi OT sang nghỉ bù chưa được kích hoạt (DEC-01). Giờ OT thực tế và tiền OT được giữ nguyên; không sinh quỹ nghỉ.",
      details: { conversionRatio: null, expiresAt: null, reducesOtPayment: false, reducesActualHours: false } });
  }
}
