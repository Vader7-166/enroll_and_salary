import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type LeaveRequest } from "@prisma/client";
import Decimal from "decimal.js";
import { isDeepStrictEqual } from "node:util";
import { AuditService } from "../audit/audit.service";
import type { AuthUser } from "../auth/auth.types";
import { PrismaService } from "../database/prisma.service";
import { effectiveAt } from "../organization/scope.service";
import { LeaveAccessService, leaveDate, leaveDateText, type LeaveDb } from "./leave-access.service";
import { fundTotals } from "./leave-fund-engine";
import { SettingsService } from "../settings/settings.service";
import { AttendanceService } from "../attendance/attendance.service";
import { holidayCalendar } from "./holiday-calendar";
import { applyLeaveUsage } from "./leave-usage";
import { CreateLeaveRequestDto, LeaveRequestActionDto, LeaveRequestQueryDto, SubmitLeaveRequestDto, UpdateLeaveRequestDto } from "./leave-requests.dto";
const DAY = 86400000, MINUTE = 60000;
interface LeaveLine {
  workDate: string; scheduleId: string; orgUnitId: string; shiftCode: string;
  startAt: string; endAt: string; minutes: number; workMinutes: number; days: string;
  typeVersionId: string; deductsAnnualQuota: boolean; requiresDocument: boolean;
  attendanceSymbol: string; isPaid: boolean; countsAsWorkday: boolean; holiday: boolean; holidayParameterId: string;
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
function view(row: LeaveRequest) { return { ...input(row), id: row.id, status: row.status, revision: row.revision, preview: row.snapshot as unknown as LeaveRequestPreview, integration: row.integration, createdById: row.createdById, submittedAt: row.submittedAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }; }
@Injectable()
export class LeaveRequestsService {
  constructor(private readonly prisma: PrismaService, private readonly access: LeaveAccessService, private readonly audit: AuditService, private readonly settings: SettingsService, private readonly attendance: AttendanceService) {}
  private async transaction<T>(work: (db: LeaveDb) => Promise<T>) {
    return this.prisma.$transaction(async db => {
      await db.$queryRaw`SELECT pg_advisory_xact_lock(8210472)::text`;
      await db.$queryRaw`SELECT pg_advisory_xact_lock(8210490)::text`;
      await db.$queryRaw`SELECT pg_advisory_xact_lock(8210473)::text`;
      return work(db);
    }, { isolationLevel: "Serializable", timeout: 90000 }).catch(error => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") throw new ConflictException("Dữ liệu đã thay đổi đồng thời; tải lại đơn trước khi thao tác.");
      throw error;
    });
  }
  private async assertNotSelf(db: LeaveDb, user: AuthUser, employeeId: string) {
    if (await db.userAccount.findFirst({ where: { id: user.id, employeeId }, select: { id: true } })) throw new ForbiddenException("Không được xử lý đơn nghỉ của chính mình; cần tổ trưởng khác được cấp quyền cho tổ.");
  }
  private async authorized(db: LeaveDb, user: AuthUser, row: LeaveRequest, permission: string) {
    const employee = await this.access.assertEmployee(user, permission, row.employeeId, dates(row.dateFrom, row.dateTo), db);
    if (permission === "leave.request") await this.assertNotSelf(db, user, row.employeeId);
    return employee;
  }
  private async parents(db: LeaveDb, unitId: string, day: Date) {
    const versions = await db.orgUnitVersion.findMany({ where: effectiveAt(day), select: { orgUnitId: true, parentId: true } });
    const parents = new Set<string>();
    let parent: string | null | undefined = unitId;
    while (parent && !parents.has(parent)) { parents.add(parent); parent = versions.find(v => v.orgUnitId === parent)?.parentId; }
    return parents;
  }
  private async assertOpenPeriod(db: LeaveDb, day: Date, parents: Set<string>) {
    if (await db.businessPeriod.findFirst({ where: { scopeOrgUnitId: { in: [...parents] }, status: { in: ["CLOSED", "LOCKED"] }, dateFrom: { lte: day }, dateTo: { gte: day } } })) throw new ConflictException("Ngày nghỉ thuộc kỳ công đã chốt/khóa.");
  }
  private assertReady(preview: LeaveRequestPreview, documentReference: string | null) {
    if (preview.balances.some(b => new Decimal(b.requestedDays).gt(b.availableDays))) throw new ConflictException("Quỹ phép không đủ để gửi hoặc duyệt đơn.");
    if (preview.lines.some(l => l.requiresDocument) && !documentReference?.trim()) throw new ConflictException("Cần tham chiếu chứng từ trước khi gửi hoặc duyệt đơn.");
  }
  private async calculate(db: LeaveDb, user: AuthUser, dto: CreateLeaveRequestDto, ignoreId?: string): Promise<LeaveRequestPreview> {
    const from = leaveDate(dto.dateFrom), to = leaveDate(dto.dateTo), days = dates(from, to);
    if ((dto.unit !== "DAY" && from.getTime() !== to.getTime()) || (dto.unit === "HALF" ? !dto.half : Boolean(dto.half)) || (dto.unit !== "HOUR" && (dto.startAt || dto.endAt))) throw new BadRequestException("Đơn vị và khoảng thời gian nghỉ không khớp.");
    const employee = await this.access.assertEmployee(user, "leave.request", dto.employeeId, days, db);
    await this.assertNotSelf(db, user, dto.employeeId);
    if (days.some(day => employee.hireDate > day || (employee.terminationDate && employee.terminationDate < day))) throw new BadRequestException("Ngày nghỉ nằm ngoài thời gian làm việc của nhân sự.");
    const type = await db.leaveType.findUnique({ where: { id: dto.leaveTypeId }, include: { versions: true } });
    if (!type) throw new NotFoundException("Không tìm thấy loại nghỉ.");
    const schedules = await db.shiftSchedule.findMany({ where: { employeeId: dto.employeeId, workDate: { gte: from, lte: to }, plan: { status: "APPROVED" } }, include: { shift: true, plan: true }, orderBy: { workDate: "asc" } });
    const lines: LeaveLine[] = [], warnings: string[] = [];
    for (const day of days) {
      const assignment = employee.assignments.find(a => a.effectiveFrom <= day && (!a.effectiveTo || a.effectiveTo >= day))!;
      const parents = await this.parents(db, assignment.orgUnitId, day);
      if (!parents.has(type.orgUnitId)) throw new BadRequestException("Loại nghỉ không áp dụng cho đơn vị của nhân sự.");
      const version = type.versions.find(v => v.effectiveFrom <= day && (!v.effectiveTo || v.effectiveTo >= day));
      if (!version?.active) throw new ConflictException("Loại nghỉ chưa hiệu lực hoặc đã ngừng tại " + leaveDateText(day));
      await this.assertOpenPeriod(db, day, parents);
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
      const calendarParameter = await this.settings.resolveLegalParameter("HOLIDAY_CALENDAR", "ALL", "WORK_DATE", assignment.orgUnitId, day, db);
      if (!calendarParameter) throw new ConflictException("Chưa cấu hình HOLIDAY_CALENDAR tại " + leaveDateText(day));
      const calendar = holidayCalendar(calendarParameter.value), holiday = calendar.dates.includes(leaveDateText(day));
      if (holiday) warnings.push(leaveDateText(day) + ": ngày lễ L, không trừ quỹ phép năm.");
      lines.push({ workDate: leaveDateText(day), scheduleId: schedule.id, orgUnitId: schedule.plan.teamOrgUnitId, shiftCode: schedule.shift.code, startAt: new Date(start).toISOString(), endAt: new Date(end).toISOString(), minutes, workMinutes: schedule.workMinutes, days: new Decimal(minutes).div(schedule.workMinutes).toFixed(2), typeVersionId: version.id, deductsAnnualQuota: version.deductsAnnualQuota && !holiday, requiresDocument: version.requiresDocument, attendanceSymbol: holiday ? "L" : version.attendanceSymbol, isPaid: holiday || version.isPaid, countsAsWorkday: holiday || version.countsAsWorkday, holiday, holidayParameterId: calendarParameter.id });
    }
    if (!lines.length) throw new ConflictException("Không có thời gian làm việc theo lịch đã duyệt trong khoảng nghỉ.");
    const total = lines.reduce((sum, line) => sum.plus(new Decimal(line.minutes).div(line.workMinutes)), new Decimal(0));
    for (const line of lines) { const v = type.versions.find(v => v.id === line.typeVersionId)!; if (v.maxDays && total.gt(v.maxDays.toString())) throw new ConflictException("Thời lượng vượt số ngày tối đa của loại nghỉ."); }
    const overlaps = await db.leaveRequest.findMany({ where: { employeeId: dto.employeeId, status: { in: ["DRAFT", "RETURNED", "PENDING", "APPROVED"] }, ...(ignoreId ? { id: { not: ignoreId } } : {}), dateFrom: { lte: to }, dateTo: { gte: from } } });
    for (const other of overlaps) {
      const snapshot = other.snapshot as unknown as LeaveRequestPreview;
      if (snapshot.lines.some(a => lines.some(b => Date.parse(a.startAt) < Date.parse(b.endAt) && Date.parse(a.endAt) > Date.parse(b.startAt)))) throw new ConflictException("Nhân sự đã có đơn nghỉ trùng thời gian.");
    }
    const balances: LeaveRequestPreview["balances"] = [];
    for (const year of new Set(lines.filter(l => l.deductsAnnualQuota).map(l => Number(l.workDate.slice(0, 4))))) {
      const relevant = lines.filter(l => l.deductsAnnualQuota && Number(l.workDate.slice(0,4)) === year);
      const balance = await db.leaveBalance.findUnique({ where: { employeeId_year: { employeeId: dto.employeeId, year } }, include: { entries: { include: { operation: true } } } });
      const requested = relevant.reduce((sum,l) => sum.plus(l.days), new Decimal(0));
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
    for (const entry of row.history) {
      const snapshot = entry.snapshot as unknown as ReturnType<typeof view>;
      await this.access.assertEmployee(user, "leave.read", snapshot.employeeId, dates(leaveDate(snapshot.dateFrom), leaveDate(snapshot.dateTo)), this.prisma);
    }
    const actors = await this.prisma.userAccount.findMany({ where: { id: { in: row.history.map(h=>h.actorId) } }, select: { id:true,displayName:true } });
    const item = view(row);
    const integration = item.integration as {status?:string;attendance?:Array<{workDate:string;scheduleId:string;dayId:string|null;state:string}>};
    if (integration.attendance) {
      const days = await this.prisma.dailyAttendance.findMany({where:{employeeId:row.employeeId,scheduleId:{in:integration.attendance.map(a=>a.scheduleId)}},select:{id:true,scheduleId:true,leave:true}});
      item.integration = {...integration,attendance:integration.attendance.map(entry=>{
        const day=days.find(d=>d.scheduleId===entry.scheduleId);
        const sources=day ? (day.leave as unknown as {sources?:Array<{requestId:string}>}).sources??[] : [];
        const matches=Boolean(day)&&(sources.some(s=>s.requestId===id)===(integration.status==="APPLIED"));
        return {...entry,dayId:day?.id??null,state:matches?"UPDATED":day?"WAITING_PROCESS":"WAITING_PERIOD"};
      })};
    }
    return { item, history: row.history.map(h=>({ ...h, occurredAt:h.occurredAt.toISOString(),actor:actors.find(a=>a.id===h.actorId) })) };
  }
  private async record(db: LeaveDb, user: AuthUser, row: LeaveRequest, action: string, ipAddress?: string, fromStatus?: string, reason?: string) {
    const snapshot = JSON.parse(JSON.stringify(view(row))) as Prisma.InputJsonValue;
    await db.leaveRequestHistory.create({ data: { requestId: row.id, actorId: user.id, action, revision: row.revision, snapshot, fromStatus, reason } });
    await this.audit.record({ actorId:user.id,entityType:"leave_request",entityId:row.id,action,result:"SUCCESS",oldValue:fromStatus?{status:fromStatus}:undefined,newValue:{item:snapshot,reason:reason??null},ipAddress },db);
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
      const employee = await this.authorized(db,user,row,"leave.request");
      if(!["DRAFT", "RETURNED"].includes(row.status) || row.revision!==dto.revision) throw new ConflictException("Đơn không còn được sửa hoặc phiên bản đã thay đổi; tải lại.");
      for (const day of dates(row.dateFrom, row.dateTo)) {
        const assignment = employee.assignments.find(a => a.effectiveFrom <= day && (!a.effectiveTo || a.effectiveTo >= day))!;
        await this.assertOpenPeriod(db, day, await this.parents(db, assignment.orgUnitId, day));
      }
      const preview=await this.calculate(db,user,dto,id);
      const saved=await db.leaveRequest.update({where:{id},data:{employeeId:dto.employeeId,leaveTypeId:dto.leaveTypeId,dateFrom:leaveDate(dto.dateFrom),dateTo:leaveDate(dto.dateTo),unit:dto.unit,half:dto.half??null,startAt:dto.startAt?new Date(dto.startAt):null,endAt:dto.endAt?new Date(dto.endAt):null,reason:dto.reason.trim(),documentReference:dto.documentReference?.trim()||null,status:"DRAFT",submittedAt:null,revision:{increment:1},snapshot:JSON.parse(JSON.stringify(preview))}});
      return this.record(db,user,saved,"UPDATE",ipAddress,row.status);
    });
  }
  async submit(user:AuthUser,id:string,dto:SubmitLeaveRequestDto,ipAddress?:string) {
    return this.transaction(async db=>{
      const row=await db.leaveRequest.findUnique({where:{id}});
      if(!row) throw new NotFoundException("Không tìm thấy đơn nghỉ.");
      await this.authorized(db,user,row,"leave.request");
      if(!["DRAFT", "RETURNED"].includes(row.status) || row.revision!==dto.revision) throw new ConflictException("Đơn không còn được gửi hoặc phiên bản đã thay đổi; tải lại.");
      const preview=await this.calculate(db,user,input(row),id);
      this.assertReady(preview,row.documentReference);
      const saved=await db.leaveRequest.update({where:{id},data:{status:"PENDING",submittedAt:new Date(),revision:{increment:1},snapshot:JSON.parse(JSON.stringify(preview))}});
      return this.record(db,user,saved,"SUBMIT",ipAddress,row.status);
    });
  }
  async transition(user: AuthUser, id: string, action: "APPROVE" | "RETURN" | "REJECT" | "CANCEL", dto: LeaveRequestActionDto, ipAddress?: string) {
    return this.transaction(async db => {
      const row = await db.leaveRequest.findUnique({ where: { id } });
      if (!row) throw new NotFoundException("Không tìm thấy đơn nghỉ.");
      // TT is the sole approver and may have recorded the worker's request; self means the employee, not the creator.
      const employee = await this.authorized(db, user, row, "leave.request");
      const allowed = action === "CANCEL" ? ["DRAFT", "RETURNED", "PENDING", "APPROVED"] : ["PENDING"];
      if (row.revision !== dto.revision || !allowed.includes(row.status)) throw new ConflictException("Đơn đã thay đổi hoặc chuyển trạng thái không hợp lệ; tải lại.");
      const reason = dto.reason?.trim();
      if (action !== "APPROVE" && !reason) throw new BadRequestException("Phải nhập lý do trả lại/từ chối/hủy.");
      for (const day of dates(row.dateFrom, row.dateTo)) {
        const assignment = employee.assignments.find(a => a.effectiveFrom <= day && (!a.effectiveTo || a.effectiveTo >= day))!;
        await this.assertOpenPeriod(db, day, await this.parents(db, assignment.orgUnitId, day));
      }
      let snapshot: Prisma.InputJsonValue | undefined;
      if (action === "APPROVE") {
        const preview = await this.calculate(db, user, input(row), id);
        this.assertReady(preview, row.documentReference);
        if (!isDeepStrictEqual(preview.lines, (row.snapshot as unknown as LeaveRequestPreview).lines)) throw new ConflictException("Lịch ca hoặc loại nghỉ đã thay đổi từ lúc gửi; trả lại để kiểm tra và gửi lại.");
        snapshot = JSON.parse(JSON.stringify(preview));
      }
      const statuses = { APPROVE: "APPROVED", RETURN: "RETURNED", REJECT: "REJECTED", CANCEL: "CANCELLED" };
      let saved = await db.leaveRequest.update({ where: { id }, data: { status: statuses[action], revision: { increment: 1 }, ...(snapshot ? { snapshot } : {}) } });
      if (action === "APPROVE" || (action === "CANCEL" && row.status === "APPROVED")) {
        const preview = saved.snapshot as unknown as LeaveRequestPreview;
        const usage = await applyLeaveUsage(db,user,id,saved.revision,preview,action === "CANCEL",reason ?? "Duyệt đơn nghỉ");
         const attendance = await this.attendance.reconcileLeaves(user,db,saved.employeeId,preview.lines,id,action === "APPROVE");
        const previous = row.integration as Record<string, Prisma.JsonValue>;
        saved = await db.leaveRequest.update({where:{id},data:{integration:{...previous,status:action === "APPROVE" ? "APPLIED" : "REVERSED",[action === "APPROVE" ? "useOperationIds" : "refundOperationIds"]:usage.operations,attendance,updatedAt:new Date().toISOString()}}});
      }
      return this.record(db, user, saved, action, ipAddress, row.status, reason);
    });
  }
}
