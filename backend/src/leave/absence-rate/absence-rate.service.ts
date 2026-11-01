import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import Decimal from "decimal.js";
import type { AuthUser } from "../../auth/auth.types";
import { PrismaService } from "../../database/prisma.service";
import { effectiveAt, ScopeService } from "../../organization/scope.service";
import type { LeaveAttendance } from "../../attendance/leave-attendance";

const DAY = 86400000;
const key = (value: Date) => value.toISOString().slice(0, 10);
const UNEXCUSED = "UNEXCUSED";

/**
 * Workshop absence rate (FR-6.5.1, UAT-25): absent units ÷ planned shifts of approved schedules, per team, day and leave
 * type. A day counts its approved non-holiday leave minutes over the shift's work minutes, plus any remainder of a day
 * marked absent without leave. Read-only: QĐ never approves leave here (BR-33).
 */
@Injectable()
export class AbsenceRateService {
  constructor(private readonly prisma: PrismaService, private readonly scope: ScopeService) {}

  async rate(user: AuthUser, query: { workshopOrgUnitId: string; dateFrom: string; dateTo: string }) {
    const from = new Date(query.dateFrom + "T00:00:00Z"), to = new Date(query.dateTo + "T00:00:00Z");
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to < from || (to.getTime() - from.getTime()) / DAY > 92) throw new BadRequestException({ code: "RANGE_INVALID", message: "Khoảng ngày phải đúng thứ tự và tối đa 93 ngày." });
    const scope = await this.scope.load(user, "attendance.read");
    const workshop = scope.versions.find(version => version.orgUnitId === query.workshopOrgUnitId);
    if (!workshop || !["DEPARTMENT", "TEAM"].includes(workshop.type)) throw new ForbiddenException({ code: "OUT_OF_SCOPE", message: "Phân xưởng/tổ nằm ngoài phạm vi được phân quyền." });
    // Organization as of each work date: a team belongs to the workshop if the workshop is its ancestor on that day.
    const versions = await this.prisma.orgUnitVersion.findMany({ where: { effectiveFrom: { lte: to }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }] }, include: { orgUnit: { select: { code: true } } } });
    const inWorkshop = (unitId: string, day: Date) => {
      const atDay = versions.filter(version => version.effectiveFrom <= day && (!version.effectiveTo || version.effectiveTo >= day));
      const parent = new Map(atDay.map(version => [version.orgUnitId, version.parentId]));
      for (let current: string | null | undefined = unitId, guard = 0; current && guard < 20; current = parent.get(current), guard++) if (current === query.workshopOrgUnitId) return true;
      return false;
    };
    const rows = await this.prisma.dailyAttendance.findMany({ where: { workDate: { gte: from, lte: to }, orgUnitId: { in: [...scope.allowed] }, schedule: { plan: { status: "APPROVED" } }, employee: { exclusions: { none: { userAccountId: user.id } } } },
      select: { workDate: true, orgUnitId: true, absent: true, leave: true, schedule: { select: { workMinutes: true } } } });
    const days = rows.filter(row => inWorkshop(row.orgUnitId, row.workDate));
    const typeVersions = await this.prisma.leaveTypeVersion.findMany({ where: { id: { in: [...new Set(days.flatMap(row => ((row.leave as unknown as Partial<LeaveAttendance>).sources ?? []).map(source => source.typeVersionId)))] } }, include: { leaveType: { select: { code: true } } } });
    const typeOf = new Map(typeVersions.map(version => [version.id, { code: version.leaveType.code, name: version.name }]));
    const threshold = await this.prisma.legalParameter.findFirst({ where: { paramCode: "ABSENCE_RATE_WARNING_THRESHOLD", scopeKey: "GLOBAL", ...effectiveAt(to) }, orderBy: { effectiveFrom: "desc" } });
    const limit = new Decimal(String(threshold?.value ?? "0.1"));
    const zero = () => ({ planned: 0, absent: new Decimal(0) });
    const byTeam = new Map<string, ReturnType<typeof zero>>(), byDay = new Map<string, ReturnType<typeof zero>>(), cells = new Map<string, ReturnType<typeof zero>>();
    const byType = new Map<string, { code: string; name: string; units: Decimal }>();
    const total = zero();
    for (const row of days) {
      const leave = row.leave as unknown as Partial<LeaveAttendance>;
      const sources = (leave.sources ?? []).filter(source => !source.holiday);
      const work = Math.max(1, row.schedule.workMinutes);
      let leaveUnits = new Decimal(0);
      for (const source of sources) {
        const units = Decimal.min(1, new Decimal(source.minutes).div(work));
        leaveUnits = leaveUnits.plus(units);
        const type = typeOf.get(source.typeVersionId) ?? { code: "OTHER", name: "Loại nghỉ khác" };
        const entry = byType.get(type.code) ?? { ...type, units: new Decimal(0) };
        entry.units = entry.units.plus(units); byType.set(type.code, entry);
      }
      leaveUnits = Decimal.min(1, leaveUnits);
      const unexcused = row.absent ? Decimal.max(0, new Decimal(1).minus(leaveUnits)) : new Decimal(0);
      if (unexcused.gt(0)) { const entry = byType.get(UNEXCUSED) ?? { code: UNEXCUSED, name: "Vắng không có đơn", units: new Decimal(0) }; entry.units = entry.units.plus(unexcused); byType.set(UNEXCUSED, entry); }
      const absent = leaveUnits.plus(unexcused);
      for (const [map, id] of [[byTeam, row.orgUnitId], [byDay, key(row.workDate)], [cells, row.orgUnitId + "|" + key(row.workDate)]] as const) {
        const bucket = map.get(id) ?? zero(); bucket.planned++; bucket.absent = bucket.absent.plus(absent); map.set(id, bucket);
      }
      total.planned++; total.absent = total.absent.plus(absent);
    }
    const ratio = (bucket: ReturnType<typeof zero>) => bucket.planned ? bucket.absent.div(bucket.planned) : new Decimal(0);
    const view = (bucket: ReturnType<typeof zero>) => { const rate = ratio(bucket); return { planned: bucket.planned, absent: bucket.absent.toDecimalPlaces(2).toString(), rate: rate.toDecimalPlaces(4).toString(), warning: rate.gt(limit) }; };
    const code = (id: string) => versions.find(version => version.orgUnitId === id)?.orgUnit.code ?? id;
    const name = (id: string) => versions.find(version => version.orgUnitId === id)?.name ?? id;
    return {
      workshop: { id: workshop.orgUnitId, code: workshop.orgUnit.code, name: workshop.name }, dateFrom: query.dateFrom, dateTo: query.dateTo, threshold: limit.toString(), total: view(total),
      byTeam: [...byTeam].map(([id, bucket]) => ({ orgUnitId: id, code: code(id), name: name(id), ...view(bucket) })).sort((left, right) => left.code.localeCompare(right.code)),
      byDay: [...byDay].map(([workDate, bucket]) => ({ workDate, ...view(bucket) })).sort((left, right) => left.workDate.localeCompare(right.workDate)),
      cells: [...cells].map(([id, bucket]) => { const [orgUnitId, workDate] = id.split("|"); return { orgUnitId, workDate, ...view(bucket) }; }),
      byType: [...byType.values()].map(entry => ({ code: entry.code, name: entry.name, days: entry.units.toDecimalPlaces(2).toString() })).sort((left, right) => left.code.localeCompare(right.code)),
    };
  }
}
