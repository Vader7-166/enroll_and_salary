import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type LeaveRequest } from "@prisma/client";
import Decimal from "decimal.js";
import { AuditService } from "../audit/audit.service";
import type { AuthUser } from "../auth/auth.types";
import { PrismaService } from "../database/prisma.service";
import { effectiveAt } from "../organization/scope.service";
import { LeaveAccessService, leaveDate, leaveDateText, type LeaveDb } from "./leave-access.service";
import { fundTotals } from "./leave-fund-engine";
import { CreateLeaveRequestDto, LeaveRequestQueryDto, SubmitLeaveRequestDto, UpdateLeaveRequestDto } from "./leave-requests.dto";
const DAY = 86400000, MINUTE = 60000;
interface LeaveLine {
  workDate: string; scheduleId: string; orgUnitId: string; shiftCode: string;
  startAt: string; endAt: string; minutes: number; workMinutes: number; days: string;
  typeVersionId: string; deductsAnnualQuota: boolean; requiresDocument: boolean;
}
export interface LeaveRequestPreview {
  employee: { id: string; code: string; fullName: string };
  leaveType: { id: string; code: string; name: string };
  lines: LeaveLine[]; totalDays: string; totalMinutes: number;
  balances: Array<{ year: number; requestedDays: string; availableDays: string }>;
  warnings: string[];
}
function dates(from: Date, to: Date) {
  if (to < from || (to.getTime() - from.getTime()) / DAY > 365) throw new BadRequestException("Khoảng nghỉ phải từ 1 đến 366 ngày.");
  const result: Date[] = [];
  for (let at = from.getTime(); at <= to.getTime(); at += DAY) result.push(new Date(at));
  return result;
}
function input(row: LeaveRequest): CreateLeaveRequestDto {
  return { employeeId: row.employeeId, leaveTypeId: row.leaveTypeId, dateFrom: leaveDateText(row.dateFrom), dateTo: leaveDateText(row.dateTo), unit: row.unit as CreateLeaveRequestDto["unit"], half: row.half as CreateLeaveRequestDto["half"], startAt: row.startAt?.toISOString(), endAt: row.endAt?.toISOString(), reason: row.reason, documentReference: row.documentReference ?? undefined };
}
function view(row: LeaveRequest) { return { ...input(row), id: row.id, status: row.status, revision: row.revision, preview: row.snapshot as unknown as LeaveRequestPreview, createdById: row.createdById, submittedAt: row.submittedAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }; }
@Injectable()
export class LeaveRequestsService {
  constructor(private readonly prisma: PrismaService, private readonly access: LeaveAccessService, private readonly audit: AuditService) {}
  private async transaction<T>(work: (db: LeaveDb) => Promise<T>) {
    return this.prisma.$transaction(async db => {
      await db.$queryRaw`SELECT pg_advisory_xact_lock(8210472)::text`;
      await db.$queryRaw`SELECT pg_advisory_xact_lock(8210490)::text`;
      return work(db);
    }, { isolationLevel: "Serializable", timeout: 90000 });
  }
  private async authorized(db: LeaveDb, user: AuthUser, row: LeaveRequest, permission: string) {
    return this.access.assertEmployee(user, permission, row.employeeId, dates(row.dateFrom, row.dateTo), db);
  }
  private async calculate(db: LeaveDb, user: AuthUser, dto: CreateLeaveRequestDto, ignoreId?: string): Promise<LeaveRequestPreview> {
    const from = leaveDate(dto.dateFrom), to = leaveDate(dto.dateTo), days = dates(from, to);
    if ((dto.unit !== "DAY" && from.getTime() !== to.getTime()) || (dto.unit === "HALF" ? !dto.half : Boolean(dto.half)) || (dto.unit !== "HOUR" && (dto.startAt || dto.endAt))) throw new BadRequestException("Đơn vị và khoảng thời gian nghỉ không khớp.");
    const employee = await this.access.assertEmployee(user, "leave.request", dto.employeeId, days, db);
    if (days.some(day => employee.hireDate > day || (employee.terminationDate && employee.terminationDate < day))) throw new BadRequestException("Ngày nghỉ nằm ngoài thời gian làm việc của nhân sự.");
    const type = await db.leaveType.findUnique({ where: { id: dto.leaveTypeId }, include: { versions: true } });
    if (!type) throw new NotFoundException("Không tìm thấy loại nghỉ.");
    const schedules = await db.shiftSchedule.findMany({ where: { employeeId: dto.employeeId, workDate: { gte: from, lte: to }, plan: { status: "APPROVED" } }, include: { shift: true, plan: true }, orderBy: { workDate: "asc" } });
    const lines: LeaveLine[] = [], warnings: string[] = [];
    for (const day of days) {
      const assignment = employee.assignments.find(a => a.effectiveFrom <= day && (!a.effectiveTo || a.effectiveTo >= day))!;
      const versions = await db.orgUnitVersion.findMany({ where: effectiveAt(day), select: { orgUnitId: true, parentId: true } });
      const parents = new Set<string>(); let parent: string | null | undefined = assignment.orgUnitId;
      while (parent && !parents.has(parent)) { parents.add(parent); parent = versions.find(v => v.orgUnitId === parent)?.parentId; }
      if (!parents.has(type.orgUnitId)) throw new BadRequestException("Loại nghỉ không áp dụng cho đơn vị của nhân sự.");
      const version = type.versions.find(v => v.effectiveFrom <= day && (!v.effectiveTo || v.effectiveTo >= day));
      if (!version?.active) throw new ConflictException("Loại nghỉ chưa hiệu lực hoặc đã ngừng tại " + leaveDateText(day));
      if (await db.businessPeriod.findFirst({ where: { scopeOrgUnitId: { in: [...parents] }, status: { in: ["CLOSED", "LOCKED"] }, dateFrom: { lte: day }, dateTo: { gte: day } } })) throw new ConflictException("Ngày nghỉ thuộc kỳ công đã chốt/khóa.");
      const matches = schedules.filter(s => s.workDate.getTime() === day.getTime());
      if (!matches.length && dto.unit === "DAY") { warnings.push(leaveDateText(day) + ": không có ca đã duyệt, không tính thời lượng nghỉ."); continue; }
      if (matches.length !== 1) throw new ConflictException("Cần đúng một ca đã duyệt tại " + leaveDateText(day));
      const schedule = matches[0]!;
      let start = schedule.startAt.getTime(), end = schedule.endAt.getTime();
      const breakStart = start + schedule.shift.breakStartOffset * MINUTE, breakEnd = breakStart + schedule.shift.breakMinutes * MINUTE;
      const working = schedule.shift.paidBreak || !schedule.shift.breakMinutes ? [{ start, end }] : [{ start, end: breakStart }, { start: breakEnd, end }];
      if (dto.unit === "HOUR") {
        if (!dto.startAt || !dto.endAt || !/(Z|[+-]\d{2}:\d{2})$/.test(dto.startAt) || !/(Z|[+-]\d{2}:\d{2})$/.test(dto.endAt)) throw new BadRequestException("Giờ nghỉ phải có múi giờ.");
        start = Date.parse(dto.startAt); end = Date.parse(dto.endAt);
        if (!Number.isFinite(start + end) || start % MINUTE || end % MINUTE || start < schedule.startAt.getTime() || end > schedule.endAt.getTime() || end <= start) throw new BadRequestException("Giờ nghỉ phải tròn phút, nằm trong ca đã duyệt; ca đêm dùng ngày kết thúc thực tế.");
      } else if (dto.unit === "HALF") {
        let remaining = schedule.workMinutes / 2, boundary = start;
        for (const range of working) { const take = Math.min(remaining, (range.end - range.start) / MINUTE); boundary = range.start + take * MINUTE; remaining -= take; if (!remaining) break; }
        if (dto.half === "FIRST") end = boundary; else start = boundary;
      }
      const minutes = working.reduce((sum, range) => sum + Math.max(0, Math.min(end, range.end) - Math.max(start, range.start)) / MINUTE, 0);
      if (minutes <= 0 || schedule.workMinutes <= 0) throw new BadRequestException("Khoảng nghỉ không có phút làm việc.");
      lines.push({ workDate: leaveDateText(day), scheduleId: schedule.id, orgUnitId: schedule.plan.teamOrgUnitId, shiftCode: schedule.shift.code, startAt: new Date(start).toISOString(), endAt: new Date(end).toISOString(), minutes, workMinutes: schedule.workMinutes, days: new Decimal(minutes).div(schedule.workMinutes).toFixed(2), typeVersionId: version.id, deductsAnnualQuota: version.deductsAnnualQuota, requiresDocument: version.requiresDocument });
    }
    if (!lines.length) throw new ConflictException("Không có thời gian làm việc theo lịch đã duyệt trong khoảng nghỉ.");
    const total = lines.reduce((sum, line) => sum.plus(new Decimal(line.minutes).div(line.workMinutes)), new Decimal(0));
    for (const line of lines) { const v = type.versions.find(v => v.id === line.typeVersionId)!; if (v.maxDays && total.gt(v.maxDays.toString())) throw new ConflictException("Thời lượng vượt số ngày tối đa của loại nghỉ."); }
    const overlaps = await db.leaveRequest.findMany({ where: { employeeId: dto.employeeId, ...(ignoreId ? { id: { not: ignoreId } } : {}), dateFrom: { lte: to }, dateTo: { gte: from } } });
    for (const other of overlaps) {
      const snapshot = other.snapshot as unknown as LeaveRequestPreview;
      if (snapshot.lines.some(a => lines.some(b => Date.parse(a.startAt) < Date.parse(b.endAt) && Date.parse(a.endAt) > Date.parse(b.startAt)))) throw new ConflictException("Nhân sự đã có đơn nghỉ trùng thời gian.");
    }
    const balances: LeaveRequestPreview["balances"] = [];
    for (const year of new Set(lines.filter(l => l.deductsAnnualQuota).map(l => Number(l.workDate.slice(0, 4))))) {
      const relevant = lines.filter(l => l.deductsAnnualQuota && Number(l.workDate.slice(0,4)) === year);
      const balance = await db.leaveBalance.findUnique({ where: { employeeId_year: { employeeId: dto.employeeId, year } }, include: { entries: { include: { operation: true } } } });
      const requested = relevant.reduce((sum,l) => sum.plus(new Decimal(l.minutes).div(l.workMinutes)), new Decimal(0));
      const available = relevant.reduce((minimum,l) => Decimal.min(minimum, fundTotals(balance?.entries ?? [], year, leaveDate(l.workDate)).availableDays), new Decimal(Infinity));
      balances.push({ year, requestedDays: requested.toFixed(2), availableDays: available.toFixed(2) });
      if (requested.gt(available)) warnings.push("Quỹ phép " + year + " không đủ: cần " + requested.toFixed(2) + ", khả dụng " + available.toFixed(2) + ".");
    }
    if (lines.some(l => l.requiresDocument) && !dto.documentReference?.trim()) warnings.push("Loại nghỉ yêu cầu tham chiếu chứng từ trước khi gửi.");
    const version = type.versions.find(v => v.id === lines[0]!.typeVersionId)!;
    return { employee: { id: employee.id, code: employee.code, fullName: employee.fullName }, leaveType: { id: type.id, code: type.code, name: version.name }, lines, totalDays: total.toFixed(2), totalMinutes: lines.reduce((sum,l) => sum+l.minutes,0), balances, warnings };
  }
  async preview(user: AuthUser, dto: CreateLeaveRequestDto) { return { preview: await this.calculate(this.prisma, user, dto) }; }
  async list(user: AuthUser, query: LeaveRequestQueryDto) {
    await this.access.scoped(user, "leave.read");
    const rows = await this.prisma.leaveRequest.findMany({ where: { ...(query.status ? { status: query.status } : {}) }, orderBy: [{ updatedAt: "desc" }, { id: "asc" }] });
    const visible = [];
    for (const row of rows) {
      try { await this.authorized(this.prisma, user, row, "leave.read"); } catch (error) { if (error instanceof NotFoundException) continue; throw error; }
      const item = view(row);
      if (query.search && !(item.preview.employee.code + " " + item.preview.employee.fullName).toLocaleLowerCase().includes(query.search.trim().toLocaleLowerCase())) continue;
      visible.push(item);
    }
    return { items: visible.slice((query.page-1)*query.pageSize,query.page*query.pageSize), total: visible.length, page: query.page, pageSize: query.pageSize };
  }
  async detail(user: AuthUser, id: string) {
    const row = await this.prisma.leaveRequest.findUnique({ where: { id }, include: { history: { orderBy: { revision: "asc" } } } });
    if (!row) throw new NotFoundException("Không tìm thấy đơn nghỉ.");
    await this.authorized(this.prisma, user, row, "leave.read");
    const actors = await this.prisma.userAccount.findMany({ where: { id: { in: row.history.map(h=>h.actorId) } }, select: { id:true,displayName:true } });
    return { item: view(row), history: row.history.map(h=>({ ...h, occurredAt:h.occurredAt.toISOString(),actor:actors.find(a=>a.id===h.actorId) })) };
  }
  private async record(db: LeaveDb, user: AuthUser, row: LeaveRequest, action: string, ipAddress?: string) {
    const snapshot = JSON.parse(JSON.stringify(view(row))) as Prisma.InputJsonValue;
    await db.leaveRequestHistory.create({ data: { requestId: row.id, actorId: user.id, action, revision: row.revision, snapshot } });
    await this.audit.record({ actorId:user.id,entityType:"leave_request",entityId:row.id,action,result:"SUCCESS",newValue:snapshot,ipAddress },db);
    return { item:view(row) };
  }
  async create(user: AuthUser, dto: CreateLeaveRequestDto, ipAddress?:string) {
    return this.transaction(async db => {
      const preview = await this.calculate(db,user,dto);
      const row = await db.leaveRequest.create({ data: { ...dto, dateFrom:leaveDate(dto.dateFrom),dateTo:leaveDate(dto.dateTo),startAt:dto.startAt ? new Date(dto.startAt):null,endAt:dto.endAt ? new Date(dto.endAt):null,reason:dto.reason.trim(),documentReference:dto.documentReference?.trim() || null,createdById:user.id,snapshot:JSON.parse(JSON.stringify(preview)) } });
      return this.record(db,user,row,"CREATE",ipAddress);
    });
  }
  async update(user:AuthUser,id:string,dto:UpdateLeaveRequestDto,ipAddress?:string) {
    return this.transaction(async db=>{
      const row=await db.leaveRequest.findUnique({where:{id}});
      if(!row) throw new NotFoundException("Không tìm thấy đơn nghỉ.");
      await this.authorized(db,user,row,"leave.request");
      if(row.status!=="DRAFT" || row.revision!==dto.revision) throw new ConflictException("Đơn không còn là nháp hoặc phiên bản đã thay đổi; tải lại.");
      const preview=await this.calculate(db,user,dto,id);
      const saved=await db.leaveRequest.update({where:{id},data:{employeeId:dto.employeeId,leaveTypeId:dto.leaveTypeId,dateFrom:leaveDate(dto.dateFrom),dateTo:leaveDate(dto.dateTo),unit:dto.unit,half:dto.half??null,startAt:dto.startAt?new Date(dto.startAt):null,endAt:dto.endAt?new Date(dto.endAt):null,reason:dto.reason.trim(),documentReference:dto.documentReference?.trim()||null,revision:{increment:1},snapshot:JSON.parse(JSON.stringify(preview))}});
      return this.record(db,user,saved,"UPDATE",ipAddress);
    });
  }
  async submit(user:AuthUser,id:string,dto:SubmitLeaveRequestDto,ipAddress?:string) {
    return this.transaction(async db=>{
      const row=await db.leaveRequest.findUnique({where:{id}});
      if(!row) throw new NotFoundException("Không tìm thấy đơn nghỉ.");
      await this.authorized(db,user,row,"leave.request");
      if(row.status!=="DRAFT" || row.revision!==dto.revision) throw new ConflictException("Đơn không còn là nháp hoặc phiên bản đã thay đổi; tải lại.");
      const preview=await this.calculate(db,user,input(row),id);
      if(preview.balances.some(b=>new Decimal(b.requestedDays).gt(b.availableDays))) throw new ConflictException("Quỹ phép không đủ để gửi đơn.");
      if(preview.lines.some(l=>l.requiresDocument)&&!row.documentReference) throw new ConflictException("Cần tham chiếu chứng từ trước khi gửi đơn.");
      const saved=await db.leaveRequest.update({where:{id},data:{status:"PENDING",submittedAt:new Date(),revision:{increment:1},snapshot:JSON.parse(JSON.stringify(preview))}});
      return this.record(db,user,saved,"SUBMIT",ipAddress);
    });
  }
}
