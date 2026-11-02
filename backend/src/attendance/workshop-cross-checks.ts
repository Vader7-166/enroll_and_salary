import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";

type Person = { id: string; code: string; fullName: string };
export interface WorkshopCrossCheckReview {
  team: { id: string; code: string; name: string; siteId: string };
  days: Array<{ employee: Person; workDate: string; status: string; workedMinutes: number; workUnits: string; leave: { minutes: number }; correctionId: string | null }>;
  overtime: Array<{ employeeId: string; workDate: string; approvedMinutes: number; actualMinutes: number }>;
  snapshot: {
    roster: Person[];
    processing: Array<{ id: string; workDate: string | null }>;
    schedules: Array<{ employeeId: string; workDate: string; planStatus: string }>;
    raw: Array<{ id: string; employeeId: string; punchedAt: Date }>;
  };
}
type Context = { employee: Person; workDate: string; team: WorkshopCrossCheckReview["team"] };
export interface WorkshopCrossCheckIssue {
  code: string;
  message: string;
  employeeId?: string;
  employeeCode?: string;
  employeeName?: string;
  workDate?: string;
  teamOrgUnitId?: string;
  teamName?: string;
}
const DAY = 86_400_000, VN = 7 * 3_600_000;
const key = (date: Date) => date.toISOString().slice(0, 10);
const localDay = (date: Date) => key(new Date(date.getTime() + VN));

const issue = (code: string, message: string, context: Context): WorkshopCrossCheckIssue => ({ code, message, employeeId: context.employee.id, employeeCode: context.employee.code, employeeName: context.employee.fullName, workDate: context.workDate, teamOrgUnitId: context.team.id, teamName: context.team.name });

export async function workshopCrossChecks(db: Prisma.TransactionClient, period: { dateFrom: Date; dateTo: Date }, workshop: { siteId: string }, reviews: WorkshopCrossCheckReview[]) {
  const from = key(period.dateFrom), to = key(period.dateTo);
  const people = new Map<string, Person>();
  const contexts = new Map<string, Context>();
  const rawDays = new Set<string>();
  const warnings: WorkshopCrossCheckIssue[] = [], blockers: WorkshopCrossCheckIssue[] = [];
  const units = new Map<string, Prisma.Decimal>();
  const normalMinutes = new Map<string, number>(), overtimeMinutes = new Map<string, number>();
  for (const review of reviews) {
    for (const person of review.snapshot.roster) people.set(person.id, person);
    for (const day of review.days) {
      people.set(day.employee.id, day.employee);
      const id = day.employee.id + ":" + day.workDate;
      contexts.set(id, { employee: day.employee, workDate: day.workDate, team: review.team });
      const value = new Prisma.Decimal(day.workUnits);
      if (!value.isFinite() || value.lt(0)) blockers.push(issue("XC-06", "Công quy đổi âm hoặc không hợp lệ.", contexts.get(id)!));
      units.set(day.employee.id, (units.get(day.employee.id) ?? new Prisma.Decimal(0)).add(value));
      normalMinutes.set(id, (normalMinutes.get(id) ?? 0) + day.workedMinutes);
      if (day.status === "ERR" && !day.correctionId) blockers.push(issue("XC-09", "Ngày công lỗi chưa có giải trình được duyệt.", contexts.get(id)!));
    }
    const routing = new Map(review.snapshot.processing.map(row => [row.id, row]));
    const schedules = new Set(review.snapshot.schedules.filter(row => row.planStatus === "APPROVED").map(row => row.employeeId + ":" + row.workDate));
    for (const raw of review.snapshot.raw) {
      const workDate = routing.get(raw.id)?.workDate ?? localDay(raw.punchedAt);
      if (workDate < from || workDate > to) continue;
      const person = people.get(raw.employeeId);
      if (!person) continue;
      const id = raw.employeeId + ":" + workDate;
      const context = { employee: person, workDate, team: review.team };
      contexts.set(id, context); rawDays.add(id);
      if (!schedules.has(id) && !warnings.some(row => row.code === "XC-03" && row.employeeId === person.id && row.workDate === workDate)) warnings.push(issue("XC-03", "Có dữ liệu chấm công nhưng không có lịch phân ca đã duyệt.", context));
    }
    for (const day of review.days) if (day.leave.minutes > 0 && (day.workedMinutes > 0 || rawDays.has(day.employee.id + ":" + day.workDate))) warnings.push(issue("XC-01", "Có đơn nghỉ đã duyệt nhưng vẫn có dữ liệu chấm công.", { employee: day.employee, workDate: day.workDate, team: review.team }));
    for (const overtime of review.overtime) {
      const person = people.get(overtime.employeeId);
      if (!person) continue;
      const id = overtime.employeeId + ":" + overtime.workDate;
      const context = { employee: person, workDate: overtime.workDate, team: review.team };
      contexts.set(id, context);
      overtimeMinutes.set(id, (overtimeMinutes.get(id) ?? 0) + overtime.actualMinutes);
      if (overtime.approvedMinutes > 0 && overtime.actualMinutes === 0) warnings.push(issue("XC-02", "OT đã duyệt nhưng không có dữ liệu ra vào tương ứng.", context));
    }
  }
  const periodDays = Math.round((period.dateTo.getTime() - period.dateFrom.getTime()) / DAY) + 1;
  for (const [employeeId, total] of units) if (total.gt(periodDays)) {
    const context = [...contexts.values()].find(row => row.employee.id === employeeId)!;
    blockers.push(issue("XC-06", "Tổng công quy đổi của nhân sự vượt số ngày trong kỳ.", context));
  }
  const employeeIds = [...people.keys()].sort();
  const [employees, contracts, site, crossSitePunches, overtimeRows] = await Promise.all([
    db.employee.findMany({ where: { id: { in: employeeIds } }, select: { id: true, status: true, terminationDate: true }, orderBy: { id: "asc" } }),
    db.employmentContract.findMany({ where: { employeeId: { in: employeeIds } }, select: { id: true, employeeId: true, status: true, startDate: true, endDate: true }, orderBy: { id: "asc" } }),
    db.site.findUnique({ where: { id: workshop.siteId }, select: { wageRegionCode: true } }),
    db.rawPunch.findMany({ where: { employeeId: { in: employeeIds }, punchedAt: { gte: new Date(period.dateFrom.getTime() - VN), lt: new Date(period.dateTo.getTime() + DAY - VN) } }, select: { id: true, employeeId: true, siteId: true, punchedAt: true }, orderBy: { id: "asc" } }),
    db.overtimeActual.findMany({ where: { employeeId: { in: employeeIds }, workDate: { gte: new Date(Date.UTC(period.dateFrom.getUTCFullYear(), 0, 1)), lte: period.dateTo } }, select: { id: true, employeeId: true, workDate: true, actualMinutes: true }, orderBy: { id: "asc" } }),
  ]);
  const employeeById = new Map(employees.map(row => [row.id, row]));
  for (const context of contexts.values()) {
    const day = new Date(context.workDate + "T00:00:00Z"), employee = employeeById.get(context.employee.id);
    if (employee?.terminationDate && employee.terminationDate <= day) blockers.push(issue("XC-07", "Nhân sự đã nghỉ việc nhưng vẫn phát sinh dữ liệu công.", context));
    if (!contracts.some(row => row.employeeId === context.employee.id && row.status === "ACTIVE" && row.startDate <= day && (!row.endDate || row.endDate >= day))) warnings.push(issue("XC-08", "Chưa có hợp đồng có hiệu lực tại ngày công hoặc hợp đồng đã hết hạn.", context));
  }
  const sitesByPersonDay = new Map<string, Set<string>>();
  for (const raw of crossSitePunches) {
    const id = raw.employeeId + ":" + localDay(raw.punchedAt);
    const sites = sitesByPersonDay.get(id) ?? new Set<string>();
    sites.add(raw.siteId); sitesByPersonDay.set(id, sites);
  }
  for (const [id, sites] of sitesByPersonDay) if (sites.size > 1 && contexts.has(id)) warnings.push(issue("XC-05", "Có chấm công tại nhiều cơ sở trong cùng ngày; cần đối chiếu thời gian di chuyển.", contexts.get(id)!));
  const scopes = ["SITE:" + workshop.siteId, "REGION:" + site?.wageRegionCode, "GLOBAL"];
  const parameters = await db.legalParameter.findMany({ where: { paramCode: { in: ["SHIFT_MAX_DAILY_MINUTES", "OT_DAILY_MAX_RATIO", "OT_MONTH_MAX_MINUTES", "OT_YEAR_MAX_MINUTES"] }, scopeKey: { in: scopes }, subjectType: "ALL", applicationBasis: "WORK_DATE", effectiveFrom: { lte: period.dateTo }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: period.dateFrom } }] }, select: { id: true, paramCode: true, scopeKey: true, value: true, effectiveFrom: true, effectiveTo: true }, orderBy: { id: "asc" } });
  const limit = (code: string, day: Date) => {
    const row = scopes.map(scope => parameters.find(parameter => parameter.scopeKey === scope && parameter.paramCode === code && parameter.effectiveFrom <= day && (!parameter.effectiveTo || parameter.effectiveTo >= day))).find(Boolean);
    const value = typeof row?.value === "string" && /^\d+(?:\.\d+)?$/.test(row.value) ? Number(row.value) : row?.value;
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
  };
  const months = new Map<string, number>(), years = new Map<string, number>();
  for (const row of overtimeRows) {
    const workDate = key(row.workDate), month = row.employeeId + ":" + workDate.slice(0, 7), year = row.employeeId + ":" + workDate.slice(0, 4);
    months.set(month, (months.get(month) ?? 0) + Number(row.actualMinutes));
    years.set(year, (years.get(year) ?? 0) + Number(row.actualMinutes));
  }
  for (const [id, context] of contexts) {
    const day = new Date(context.workDate + "T00:00:00Z"), normal = limit("SHIFT_MAX_DAILY_MINUTES", day), ratio = limit("OT_DAILY_MAX_RATIO", day), monthly = limit("OT_MONTH_MAX_MINUTES", day), yearly = limit("OT_YEAR_MAX_MINUTES", day);
    if (normal === null || ratio === null || monthly === null || yearly === null) {
      if (!blockers.some(row => row.code === "LEGAL_PARAMETERS_INVALID" && row.workDate === context.workDate)) blockers.push({ code: "LEGAL_PARAMETERS_INVALID", message: "Thiếu tham số pháp lý có hiệu lực để đối soát giới hạn công/OT.", workDate: context.workDate });
      continue;
    }
    const worked = normalMinutes.get(id) ?? 0, actualOt = overtimeMinutes.get(id) ?? 0;
    if (worked > normal || worked + actualOt > normal * (1 + ratio)) warnings.push(issue("XC-04", "Giờ công thường hoặc tổng giờ công và OT vượt trần ngày có hiệu lực.", context));
    if ((months.get(context.employee.id + ":" + context.workDate.slice(0, 7)) ?? 0) >= monthly || (years.get(context.employee.id + ":" + context.workDate.slice(0, 4)) ?? 0) >= yearly) warnings.push(issue("XC-10", "OT thực tế lũy kế tháng hoặc năm chạm/vượt trần có hiệu lực.", context));
  }
  const effectiveParameters = parameters.map(parameter=>({...parameter,effectiveFrom:parameter.effectiveFrom<period.dateFrom?period.dateFrom:parameter.effectiveFrom,effectiveTo:!parameter.effectiveTo||parameter.effectiveTo>period.dateTo?period.dateTo:parameter.effectiveTo}));
  return { blockers, warnings, source: { employees, contracts, parameters:effectiveParameters, overtimeRows, crossSiteSourceHash: createHash("sha256").update(JSON.stringify(crossSitePunches)).digest("hex") } };
}
