import { BadRequestException, NotFoundException } from "@nestjs/common";
import Decimal from "decimal.js";
import { plainText } from "../../common/data-crypto";
import { effectiveAt } from "../../organization/scope.service";
import { DAY, hours, key, parseDay, type Column, type Db, type ReportContext, type ReportDefinition, type Row } from "../report-types";

type LockDay = { scheduleId: string; employee: { id: string; code: string; fullName: string }; workDate: string; shiftCode: string; status: string; workedMinutes: number; workUnits: string; flags?: string[]; leave?: { minutes?: number; symbols?: string[] }; correctionId?: string | null };
type LockSnapshot = { teams?: Array<{ team: { id: string }; days: LockDay[] }> };
/** One shape for both sources; the lock snapshot has no late/early minutes (only flags). */
type ReportDay = { scheduleId: string; employee: { id: string; code: string; fullName: string }; workDate: string; shiftCode: string; status: string; workedMinutes: number; workUnits: string; flags: string[];
  leave: { minutes?: number; symbols?: string[] }; orgUnitId: string; absent: boolean; lateMinutes: number | null; earlyMinutes: number | null; correctionId: string | null };

async function attendancePeriod(db: Db, periodId?: string) {
  if (!periodId) throw new BadRequestException({ code: "PERIOD_REQUIRED", message: "Chọn kỳ công." });
  const period = await db.businessPeriod.findUnique({ where: { id: periodId } });
  if (!period || period.periodType !== "ATTENDANCE") throw new NotFoundException({ code: "NOT_FOUND", message: "Không tìm thấy kỳ công." });
  return period;
}

/** Days of the period: the lock snapshot when LOCKED (never recomputed), live daily attendance otherwise. */
async function periodDays(ctx: ReportContext, periodId: string) {
  const period = await attendancePeriod(ctx.db, periodId);
  const visible = (unitId: string) => ctx.allowed.has(unitId) && (!ctx.params.orgUnitId || ctx.within(unitId, ctx.params.orgUnitId));
  const excluded = new Set((await ctx.db.employeeExclusion.findMany({ where: { userAccountId: ctx.user.id, ...effectiveAt(period.dateTo) }, select: { employeeId: true } })).map(row => row.employeeId));
  if (period.status === "LOCKED") {
    const event = await ctx.db.attendancePeriodLockEvent.findFirst({ where: { periodId, action: "LOCK" }, orderBy: { revision: "desc" } });
    if (!event) throw new NotFoundException({ code: "LOCK_SNAPSHOT_MISSING", message: "Kỳ đã khóa nhưng thiếu bản lưu khóa." });
    const snapshot = event.snapshot as LockSnapshot;
    const days: ReportDay[] = (snapshot.teams ?? []).flatMap(team => team.days.map(day => ({ ...day, flags: day.flags ?? [], leave: day.leave ?? {}, orgUnitId: team.team.id, absent: Number(day.workUnits) === 0 && !(day.leave?.minutes),
      lateMinutes: null, earlyMinutes: null, correctionId: day.correctionId ?? null }))).filter(day => visible(day.orgUnitId) && !excluded.has(day.employee.id));
    return { period, status: "OFFICIAL" as const, source: "Bản lưu khóa kỳ công " + period.code + " (revision " + event.revision + ")", sourceHash: event.sourceHash, days };
  }
  const rows = await ctx.db.dailyAttendance.findMany({ where: { periodId, schedule: { plan: { status: "APPROVED" } } }, include: { employee: { select: { id: true, code: true, fullName: true } }, schedule: { include: { shift: { select: { code: true } } } } } });
  const days: ReportDay[] = rows.filter(row => visible(row.orgUnitId) && !excluded.has(row.employeeId)).map(row => {
    const leave = row.leave as { minutes?: number; symbols?: string[] };
    const flags = [...(row.lateMinutes > 0 ? ["LATE"] : []), ...(row.earlyMinutes > 0 ? ["EARLY"] : []), ...(row.absent ? ["ABSENT"] : [])];
    return { scheduleId: row.scheduleId, employee: row.employee, workDate: key(row.workDate), shiftCode: row.schedule.shift.code, status: row.status, workedMinutes: Number(row.workedMinutes), workUnits: row.workUnits.toString(), flags, leave, orgUnitId: row.orgUnitId, absent: row.absent, lateMinutes: row.lateMinutes, earlyMinutes: row.earlyMinutes, correctionId: row.adjustmentId };
  });
  return { period, status: "DRAFT" as const, source: "Bảng công hiện hành kỳ " + period.code + " (" + period.status + ")", sourceHash: null, days };
}

const symbol = (day: { status: string; workUnits: string; leave?: { symbols?: string[] }; absent?: boolean }) =>
  day.leave?.symbols?.length ? day.leave.symbols.join("/") : day.status === "ERR" ? "!" : Number(day.workUnits) > 0 ? "X" : day.absent ? "V" : "";

async function siteParam(db: Db, code: string, unitId: string, at: Date) {
  const version = await db.orgUnitVersion.findFirst({ where: { orgUnitId: unitId, ...effectiveAt(at) }, include: { site: true } });
  const scopes = version?.site ? ["SITE:" + version.site.id, "REGION:" + version.site.wageRegionCode, "GLOBAL"] : ["GLOBAL"];
  const rows = await db.legalParameter.findMany({ where: { paramCode: code, subjectType: "ALL", applicationBasis: "WORK_DATE", scopeKey: { in: scopes }, ...effectiveAt(at) } });
  const row = scopes.map(scope => rows.find(item => item.scopeKey === scope)).find(Boolean);
  return row ? Number(row.value) : null;
}

const periodAsOf: ReportDefinition["asOf"] = async ctx => (await attendancePeriod(ctx.db, ctx.params.periodId)).dateTo;
const unitName = (ctx: ReportContext, id: string) => ctx.units.get(id)?.name ?? id;

export const attendanceReports: ReportDefinition[] = [
  {
    type: "ATTENDANCE_MONTHLY", title: "Bảng chấm công tháng", group: "10.1", roles: ["TT", "QD", "KT", "AD"], permission: "attendance.read", params: ["periodId", "orgUnitId"], sensitive: false, asOf: periodAsOf,
    async run(ctx) {
      const data = await periodDays(ctx, ctx.params.periodId!);
      const dates: string[] = [];
      for (let time = data.period.dateFrom.getTime(); time <= data.period.dateTo.getTime(); time += DAY) dates.push(key(new Date(time)));
      const buckets = await ctx.db.overtimePayBucket.findMany({ where: { periodId: data.period.id, kind: "OT" } });
      const actuals = data.status === "DRAFT" ? await ctx.db.overtimeActual.findMany({ where: { periodId: data.period.id } }) : [];
      const people = new Map<string, Row>();
      for (const day of data.days) {
        const row = people.get(day.employee.id) ?? { code: day.employee.code, fullName: day.employee.fullName, unit: unitName(ctx, day.orgUnitId), workUnits: 0, workedHours: 0, leaveHours: 0, errors: 0, otWeekday: 0, otWeeklyRest: 0, otHoliday: 0, otNight: 0 };
        row["d" + day.workDate] = symbol(day);
        row.workUnits = Number(new Decimal(row.workUnits as number).plus(day.workUnits));
        row.workedHours = (row.workedHours as number) + hours(day.workedMinutes);
        row.leaveHours = (row.leaveHours as number) + hours(day.leave?.minutes ?? 0);
        if (day.status === "ERR") row.errors = (row.errors as number) + 1;
        people.set(day.employee.id, row);
      }
      for (const bucket of buckets) {
        const row = people.get(bucket.employeeId); if (!row) continue;
        const field = bucket.isNight ? "otNight" : bucket.dayType === "NGHI_TUAN" ? "otWeeklyRest" : bucket.dayType === "LE_TET" ? "otHoliday" : "otWeekday";
        row[field] = (row[field] as number) + hours(bucket.minutes.toString());
      }
      for (const actual of actuals) {
        const row = people.get(actual.employeeId); if (!row || buckets.length) continue;
        row.otWeekday = (row.otWeekday as number) + hours(actual.dayMinutes.toString()); row.otNight = (row.otNight as number) + hours(actual.nightMinutes.toString());
      }
      const columns: Column[] = [{ key: "code", title: "Mã NV" }, { key: "fullName", title: "Họ và tên", width: 24 }, { key: "unit", title: "Tổ" },
        ...dates.map(day => ({ key: "d" + day, title: day.slice(8), width: 4 })),
        { key: "workUnits", title: "Tổng công", type: "number" as const }, { key: "workedHours", title: "Giờ làm", type: "number" as const }, { key: "leaveHours", title: "Giờ nghỉ có đơn", type: "number" as const },
        { key: "otWeekday", title: "OT ngày thường (h)", type: "number" as const }, { key: "otWeeklyRest", title: "OT nghỉ tuần (h)", type: "number" as const }, { key: "otHoliday", title: "OT lễ (h)", type: "number" as const }, { key: "otNight", title: "OT đêm (h)", type: "number" as const },
        { key: "errors", title: "Ngày lỗi", type: "number" as const }];
      return { status: data.status, source: data.source, sourceHash: data.sourceHash, periodLabel: data.period.code + " (" + key(data.period.dateFrom) + " → " + key(data.period.dateTo) + ")", columns,
        rows: [...people.values()].sort((left, right) => String(left.unit).localeCompare(String(right.unit)) || String(left.code).localeCompare(String(right.code))),
        notes: ["Ký hiệu: X đi làm, V vắng, ! ngày lỗi chưa xử lý, mã nghỉ theo danh mục (P, OM, TS…).", data.status === "OFFICIAL" ? "Số liệu từ bản lưu khóa, mã băm " + data.sourceHash : "Kỳ chưa khóa: số liệu có thể thay đổi.",
          ...(buckets.length || !actuals.length ? [] : ["OT kỳ chưa khóa chưa tách theo loại ngày; cột OT ngày thường là toàn bộ OT ban ngày."])] };
    },
  },
  {
    type: "OVERTIME_SUMMARY", title: "OT theo tổ/xưởng so trần và lũy kế năm", group: "10.1", roles: ["TT", "QD", "KT"], permission: "attendance.read", params: ["periodId", "orgUnitId"], sensitive: false, asOf: periodAsOf,
    async run(ctx) {
      const data = await periodDays(ctx, ctx.params.periodId!);
      const people = [...new Map(data.days.map(day => [day.employee.id, { ...day.employee, orgUnitId: day.orgUnitId }])).values()];
      const yearStart = new Date(Date.UTC(data.period.dateTo.getUTCFullYear(), 0, 1));
      const actuals = await ctx.db.overtimeActual.findMany({ where: { employeeId: { in: people.map(person => person.id) }, workDate: { gte: yearStart, lte: data.period.dateTo } }, select: { employeeId: true, workDate: true, eligibleMinutes: true } });
      const rows: Row[] = [];
      for (const person of people) {
        const mine = actuals.filter(row => row.employeeId === person.id);
        const period = mine.filter(row => row.workDate >= data.period.dateFrom).reduce((total, row) => total + Number(row.eligibleMinutes), 0);
        const year = mine.reduce((total, row) => total + Number(row.eligibleMinutes), 0);
        const monthCap = await siteParam(ctx.db, "OT_MONTH_MAX_MINUTES", person.orgUnitId, data.period.dateTo), yearCap = await siteParam(ctx.db, "OT_YEAR_MAX_MINUTES", person.orgUnitId, data.period.dateTo);
        rows.push({ code: person.code, fullName: person.fullName, unit: unitName(ctx, person.orgUnitId), periodHours: hours(period), monthCap: monthCap === null ? null : hours(monthCap), yearHours: hours(year), yearCap: yearCap === null ? null : hours(yearCap),
          remaining: yearCap === null ? null : Math.max(0, hours(yearCap - year)), warning: (monthCap !== null && period > monthCap) || (yearCap !== null && year > yearCap) ? "Vượt trần" : "" });
      }
      return { status: data.status, source: data.source + "; OT đủ điều kiện từ đối chiếu OT thực tế", sourceHash: data.sourceHash, periodLabel: data.period.code, rows,
        columns: [{ key: "code", title: "Mã NV" }, { key: "fullName", title: "Họ và tên" }, { key: "unit", title: "Tổ" }, { key: "periodHours", title: "OT kỳ (h)", type: "number" }, { key: "monthCap", title: "Trần tháng (h)", type: "number" },
          { key: "yearHours", title: "Lũy kế năm (h)", type: "number" }, { key: "yearCap", title: "Trần năm (h)", type: "number" }, { key: "remaining", title: "Còn huy động (h)", type: "number" }, { key: "warning", title: "Cảnh báo" }] };
    },
  },
  {
    type: "LATE_EARLY", title: "Đi muộn, về sớm", group: "10.1", roles: ["TT", "QD", "KT"], permission: "attendance.read", params: ["periodId", "orgUnitId"], sensitive: false, asOf: periodAsOf,
    async run(ctx) {
      const data = await periodDays(ctx, ctx.params.periodId!);
      const rows = data.days.filter(day => (day.lateMinutes ?? 0) > 0 || (day.earlyMinutes ?? 0) > 0 || day.flags.some(flag => /LATE|EARLY/.test(flag)))
        .map(day => ({ workDate: day.workDate, code: day.employee.code, fullName: day.employee.fullName, unit: unitName(ctx, day.orgUnitId), shift: day.shiftCode, late: day.lateMinutes, early: day.earlyMinutes, flags: day.flags.join(", ") }));
      return { status: data.status, source: data.source, sourceHash: data.sourceHash, periodLabel: data.period.code, rows,
        columns: [{ key: "workDate", title: "Ngày", type: "date" }, { key: "code", title: "Mã NV" }, { key: "fullName", title: "Họ và tên" }, { key: "unit", title: "Tổ" }, { key: "shift", title: "Ca" }, { key: "late", title: "Muộn (phút)", type: "number" }, { key: "early", title: "Sớm (phút)", type: "number" }, { key: "flags", title: "Ghi nhận" }],
        notes: ["Báo cáo theo dõi kỷ luật lao động; KHÔNG dùng để trừ lương."] };
    },
  },
  {
    type: "ATTENDANCE_EXCEPTIONS", title: "Ngoại lệ công chưa xử lý", group: "10.1", roles: ["TT", "QD", "KT"], permission: "attendance.read", params: ["periodId", "orgUnitId"], sensitive: false, asOf: periodAsOf,
    async run(ctx) {
      const data = await periodDays(ctx, ctx.params.periodId!);
      const pending = await ctx.db.attendanceCorrection.findMany({ where: { periodId: data.period.id, status: { in: ["DRAFT", "PENDING", "RETURNED"] } }, include: { items: { select: { employeeId: true, workDate: true } } } });
      const pendingKeys = new Set(pending.flatMap(row => row.items.map(item => item.employeeId + "|" + key(item.workDate))));
      const rows = data.days.filter(day => day.status === "ERR" || day.flags.some(flag => !/LATE|EARLY/.test(flag))).map(day => ({ workDate: day.workDate, code: day.employee.code, fullName: day.employee.fullName, unit: unitName(ctx, day.orgUnitId),
        shift: day.shiftCode, status: day.status, flags: day.flags.join(", "), correction: pendingKeys.has(day.employee.id + "|" + day.workDate) ? "Đang giải trình" : day.correctionId ? "Đã điều chỉnh" : "Chưa giải trình" }));
      return { status: data.status, source: data.source, sourceHash: data.sourceHash, periodLabel: data.period.code, rows,
        columns: [{ key: "workDate", title: "Ngày", type: "date" }, { key: "code", title: "Mã NV" }, { key: "fullName", title: "Họ và tên" }, { key: "unit", title: "Tổ" }, { key: "shift", title: "Ca" }, { key: "status", title: "Trạng thái" }, { key: "flags", title: "Ngoại lệ" }, { key: "correction", title: "Giải trình" }] };
    },
  },
  {
    type: "WEEKLY_HOURS", title: "Giờ làm theo tuần", group: "10.1", roles: ["TT", "QD", "KT"], permission: "attendance.read", params: ["dateRange", "orgUnitId"], sensitive: false,
    asOf: async ctx => parseDay(ctx.params.dateTo!),
    async run(ctx) {
      const from = parseDay(ctx.params.dateFrom!), to = parseDay(ctx.params.dateTo!);
      const days = await ctx.db.dailyAttendance.findMany({ where: { workDate: { gte: from, lte: to }, schedule: { plan: { status: "APPROVED" } } }, include: { employee: { select: { id: true, code: true, fullName: true } } } });
      const excluded = new Set((await ctx.db.employeeExclusion.findMany({ where: { userAccountId: ctx.user.id, ...effectiveAt(to) }, select: { employeeId: true } })).map(row => row.employeeId));
      const visible = days.filter(day => ctx.allowed.has(day.orgUnitId) && (!ctx.params.orgUnitId || ctx.within(day.orgUnitId, ctx.params.orgUnitId)) && !excluded.has(day.employeeId));
      const ot = await ctx.db.overtimeActual.findMany({ where: { workDate: { gte: from, lte: to }, employeeId: { in: [...new Set(visible.map(day => day.employeeId))] } } });
      const weekOf = (value: Date) => key(new Date(value.getTime() - ((value.getUTCDay() + 6) % 7) * DAY));
      const rows = new Map<string, Row>();
      for (const day of visible) {
        const id = day.employeeId + "|" + weekOf(day.workDate);
        const row = rows.get(id) ?? { week: weekOf(day.workDate), code: day.employee.code, fullName: day.employee.fullName, unit: unitName(ctx, day.orgUnitId), regular: 0, overtime: 0, total: 0 };
        row.regular = (row.regular as number) + hours(day.workedMinutes.toString()); rows.set(id, row);
      }
      for (const item of ot) { const row = rows.get(item.employeeId + "|" + weekOf(item.workDate)); if (row) row.overtime = (row.overtime as number) + hours(item.eligibleMinutes.toString()); }
      for (const row of rows.values()) row.total = Math.round(((row.regular as number) + (row.overtime as number)) * 10) / 10;
      return { status: "DRAFT", source: "Bảng công và OT thực tế " + ctx.params.dateFrom + " → " + ctx.params.dateTo, periodLabel: ctx.params.dateFrom + " → " + ctx.params.dateTo,
        rows: [...rows.values()].sort((left, right) => String(left.week).localeCompare(String(right.week)) || String(left.code).localeCompare(String(right.code))),
        columns: [{ key: "week", title: "Tuần (thứ Hai)", type: "date" }, { key: "code", title: "Mã NV" }, { key: "fullName", title: "Họ và tên" }, { key: "unit", title: "Tổ" }, { key: "regular", title: "Giờ bình thường", type: "number" }, { key: "overtime", title: "Giờ OT", type: "number" }, { key: "total", title: "Tổng giờ", type: "number" }],
        notes: ["Số liệu giờ làm nội bộ; KHÔNG đồng nghĩa chứng nhận SMETA/BSCI/RBA."] };
    },
  },
  {
    type: "WORKFORCE_CHANGES", title: "Biến động nhân sự và tỷ lệ nghỉ việc", group: "10.2", roles: ["QD", "KT"], permission: "employee.read", params: ["dateRange", "orgUnitId"], sensitive: false,
    asOf: async ctx => parseDay(ctx.params.dateTo!),
    async run(ctx) {
      if (!ctx.params.orgUnitId) throw new BadRequestException({ code: "UNIT_REQUIRED", message: "Chọn phân xưởng/đơn vị." });
      const root = ctx.params.orgUnitId, from = parseDay(ctx.params.dateFrom!), to = parseDay(ctx.params.dateTo!);
      const unitAt = async (employeeId: string, at: Date) => (await ctx.db.orgAssignment.findFirst({ where: { employeeId, isPrimary: true, ...effectiveAt(at) }, select: { orgUnitId: true } }))?.orgUnitId ?? null;
      const rows: Row[] = [];
      const hires = await ctx.db.employee.findMany({ where: { hireDate: { gte: from, lte: to } }, select: { id: true, code: true, fullName: true, hireDate: true } });
      for (const person of hires) { const unit = await unitAt(person.id, person.hireDate); if (unit && ctx.within(unit, root)) rows.push({ section: "Vào làm", code: person.code, fullName: person.fullName, unit: unitName(ctx, unit), date: key(person.hireDate), detail: "" }); }
      const leavers = await ctx.db.employee.findMany({ where: { terminationDate: { gte: from, lte: to } }, select: { id: true, code: true, fullName: true, hireDate: true, terminationDate: true, terminationDecisions: { where: { status: "CONFIRMED" }, select: { reason: true } }, contracts: { orderBy: { startDate: "desc" }, take: 1, select: { type: true } } } });
      const leaverRows: Array<{ unit: string; seniority: string; contract: string }> = [];
      for (const person of leavers) {
        const unit = await unitAt(person.id, person.terminationDate!); if (!unit || !ctx.within(unit, root)) continue;
        const years = (person.terminationDate!.getTime() - person.hireDate.getTime()) / (365.25 * DAY);
        const seniority = years < 1 ? "< 1 năm" : years < 3 ? "1–3 năm" : years < 5 ? "3–5 năm" : "≥ 5 năm";
        leaverRows.push({ unit: unitName(ctx, unit), seniority, contract: person.contracts[0]?.type ?? "—" });
        rows.push({ section: "Nghỉ việc", code: person.code, fullName: person.fullName, unit: unitName(ctx, unit), date: key(person.terminationDate!), detail: (person.terminationDecisions[0]?.reason ?? "") + " · " + seniority + " · " + (person.contracts[0]?.type ?? "") });
      }
      const transfers = await ctx.db.personnelTransfer.findMany({ where: { effectiveFrom: { gte: from, lte: to } }, include: { employee: { select: { code: true, fullName: true } } } });
      for (const move of transfers) {
        const into = ctx.within(move.toOrgUnitId, root), outOf = ctx.within(move.fromOrgUnitId, root);
        if (into === outOf) { if (into) rows.push({ section: "Điều chuyển trong xưởng", code: move.employee.code, fullName: move.employee.fullName, unit: unitName(ctx, move.toOrgUnitId), date: key(move.effectiveFrom), detail: unitName(ctx, move.fromOrgUnitId) + " → " + unitName(ctx, move.toOrgUnitId) }); continue; }
        rows.push({ section: into ? "Điều chuyển đến" : "Điều chuyển ra", code: move.employee.code, fullName: move.employee.fullName, unit: unitName(ctx, into ? move.toOrgUnitId : move.fromOrgUnitId), date: key(move.effectiveFrom), detail: unitName(ctx, move.fromOrgUnitId) + " → " + unitName(ctx, move.toOrgUnitId) + " (" + move.decisionNumber + ")" });
      }
      const headcount = async (at: Date) => (await ctx.employees(at)).filter(person => ctx.within(person.orgUnitId, root)).length;
      const average = ((await headcount(from)) + (await headcount(to))) / 2;
      const group = (field: keyof (typeof leaverRows)[number]) => [...new Set(leaverRows.map(row => row[field]))].map(value => value + ": " + leaverRows.filter(row => row[field] === value).length);
      return { status: "DRAFT", source: "Hồ sơ nhân sự, quyết định chấm dứt và điều chuyển", periodLabel: ctx.params.dateFrom + " → " + ctx.params.dateTo, rows,
        columns: [{ key: "section", title: "Mục" }, { key: "code", title: "Mã NV" }, { key: "fullName", title: "Họ và tên" }, { key: "unit", title: "Đơn vị" }, { key: "date", title: "Ngày", type: "date" }, { key: "detail", title: "Chi tiết" }],
        notes: ["Tỷ lệ nghỉ việc: " + leaverRows.length + " / bình quân " + average + " người = " + (average ? (leaverRows.length / average * 100).toFixed(1) : "0") + "%.",
          "Theo bộ phận: " + (group("unit").join("; ") || "—"), "Theo thâm niên: " + (group("seniority").join("; ") || "—"), "Theo loại HĐ: " + (group("contract").join("; ") || "—")] };
    },
  },
  {
    type: "LABOR_REGISTER", title: "Sổ quản lý lao động (NĐ 145/2020)", group: "LABOR", roles: ["KT"], permission: "employee.read", params: ["year", "orgUnitId"], sensitive: true,
    asOf: async ctx => { const end = new Date(Date.UTC(Number(ctx.params.year), 11, 31)); const today = new Date(); return end < today ? end : parseDay(key(today)); },
    async run(ctx) {
      const year = Number(ctx.params.year), start = new Date(Date.UTC(year, 0, 1)), end = new Date(Date.UTC(year, 11, 31));
      const people = (await ctx.employees(ctx.asOf, { hireDate: { lte: end } })).filter(person => !ctx.params.orgUnitId || ctx.within(person.orgUnitId, ctx.params.orgUnitId));
      const rows: Row[] = [];
      for (const person of people) {
        const employee = await ctx.db.employee.findUniqueOrThrow({ where: { id: person.id }, include: { identity: true, jobTitle: { include: { jobGrade: true } }, contracts: { where: { status: "ACTIVE" }, orderBy: { startDate: "desc" } },
          salaryDecisions: { orderBy: { effectiveFrom: "desc" }, take: 1 }, terminationDecisions: { where: { status: "CONFIRMED" }, take: 1 } } });
        const leaves = await ctx.db.leaveRequest.findMany({ where: { employeeId: person.id, status: "APPROVED", dateFrom: { lte: end }, dateTo: { gte: start } }, include: { leaveType: { select: { code: true } } } });
        const leaveDays = new Map<string, number>();
        for (const leave of leaves) leaveDays.set(leave.leaveType.code, (leaveDays.get(leave.leaveType.code) ?? 0) + Math.round((Math.min(leave.dateTo.getTime(), end.getTime()) - Math.max(leave.dateFrom.getTime(), start.getTime())) / DAY) + 1);
        const ot = await ctx.db.overtimeActual.aggregate({ where: { employeeId: person.id, workDate: { gte: start, lte: end } }, _sum: { eligibleMinutes: true } });
        const otMinutes = Number(ot._sum.eligibleMinutes ?? 0);
        const yearCap = await siteParam(ctx.db, "OT_YEAR_MAX_MINUTES", person.orgUnitId, ctx.asOf);
        const contract = employee.contracts[0];
        const insured = await ctx.db.insuranceContribution.findFirst({ where: { employeeId: person.id, contributionMonth: { gte: year + "-01", lte: year + "-12" } }, select: { eligible: true } });
        rows.push({
          fullName: employee.fullName, gender: employee.gender === "MALE" ? "Nam" : employee.gender === "FEMALE" ? "Nữ" : "Khác", dob: key(employee.dob), nationality: employee.nationality, address: null,
          idNumber: employee.identity ? plainText(ctx.key, employee.identity.idNumberCipher, "giấy tờ") : null, qualification: null, skillLevel: employee.jobTitle?.jobGrade.name ?? null, position: employee.jobTitle?.name ?? null,
          contractType: contract?.type ?? null, startDate: key(employee.hireDate), socialInsurance: insured ? ((insured.eligible as Record<string, boolean>).BHXH ? "Có" : "Không") : employee.identity?.siBookHash ? "Có sổ" : null,
          salary: contract ? plainText(ctx.key, contract.salaryCipher, "hợp đồng") : null, salaryChange: employee.salaryDecisions[0] ? key(employee.salaryDecisions[0].effectiveFrom) + " " + employee.salaryDecisions[0].decisionNumber : null,
          leaveDays: [...leaveDays].map(([code, days]) => code + ": " + days).join("; ") || null, overtimeHours: hours(otMinutes), training: null, discipline: null, accident: null,
          termination: employee.terminationDate ? key(employee.terminationDate) + (employee.terminationDecisions[0] ? " · " + employee.terminationDecisions[0].reason : "") : null,
          otWarning: yearCap !== null && otMinutes > yearCap ? "Vượt trần " + hours(yearCap) + " giờ/năm" : otMinutes > 12000 ? "Vượt 200 giờ/năm" : "",
        });
      }
      return { status: "DRAFT", source: "Hồ sơ nhân sự, hợp đồng, quyết định lương, đơn nghỉ, OT thực tế, đóng BHXH năm " + year, periodLabel: "Năm " + year, rows,
        columns: [{ key: "fullName", title: "1. Họ và tên" }, { key: "gender", title: "2. Giới tính" }, { key: "dob", title: "3. Ngày sinh", type: "date" }, { key: "nationality", title: "4. Quốc tịch" }, { key: "address", title: "5. Nơi cư trú" },
          { key: "idNumber", title: "6. Số CCCD/hộ chiếu", sensitive: "personal" }, { key: "qualification", title: "7. Trình độ CMKT" }, { key: "skillLevel", title: "8. Bậc kỹ năng nghề" }, { key: "position", title: "9. Vị trí việc làm" },
          { key: "contractType", title: "10. Loại HĐ" }, { key: "startDate", title: "11. Thời điểm bắt đầu", type: "date" }, { key: "socialInsurance", title: "12. Tham gia BHXH" }, { key: "salary", title: "13. Tiền lương", type: "money", sensitive: "salary" },
          { key: "salaryChange", title: "14. Nâng bậc/nâng lương" }, { key: "leaveDays", title: "15. Ngày nghỉ trong năm" }, { key: "overtimeHours", title: "16. Giờ làm thêm", type: "number" }, { key: "training", title: "17. Học nghề, đào tạo" },
          { key: "discipline", title: "18. Kỷ luật, TN vật chất" }, { key: "accident", title: "19. TNLĐ, BNN" }, { key: "termination", title: "20. Chấm dứt HĐ, lý do" }, { key: "otWarning", title: "Cảnh báo OT" }],
        notes: ["Tiêu chí 5, 7, 17, 18, 19 chưa có nguồn dữ liệu trong hệ thống: để trống, cần bổ sung từ hồ sơ giấy; hệ thống không tự điền."] };
    },
  },
];
