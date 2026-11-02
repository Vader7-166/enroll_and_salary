import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type OvertimeActual } from "@prisma/client";
import { createHash } from "node:crypto";
import { AuditService } from "../audit/audit.service";
import { businessDate } from "../auth/business-date";
import type { AuthUser } from "../auth/auth.types";
import { PrismaService } from "../database/prisma.service";
import { effectiveAt, ScopeService } from "../organization/scope.service";
import { SettingsService } from "../settings/settings.service";
import { AttendanceService } from "./attendance.service";
import { CorrectionActionDto, CorrectionQueryDto, CorrectionTargetQueryDto, CreateCorrectionDto, UpdateCorrectionDto } from "./correction.dto";
import { correctionAccess, correctionInclude, correctionKey as key, correctionView, type CorrectionAccessItem, type CorrectionRecord } from "./correction-view";
import type { ApprovedAttendanceAdjustment } from "./attendance.types";
type Db = Prisma.TransactionClient;
type Interval = { startAt: string; endAt: string };
const DAY = 86400000, VN = 7 * 3600000;
const employee = { id: true, code: true, fullName: true } as const;
function date(text: string) { const d = new Date(text + "T00:00:00Z"); if (!Number.isFinite(d.getTime()) || key(d) !== text) throw new BadRequestException("Ngày công không hợp lệ."); return d; }
function local(d: Date) { return date(key(new Date(d.getTime() + VN))); }
function json(value: unknown): Prisma.InputJsonValue { return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue; }
function uniqueDates(dates: Date[]) { return [...new Map(dates.map(d => [key(d), d])).values()].sort((a,b) => a.getTime()-b.getTime()); }
function dailyView(d: Prisma.DailyAttendanceGetPayload<{include:{checkIn:true,checkOut:true}}> | null) { return d ? { id: d.id, checkInAt: d.effectiveCheckInAt?.toISOString() ?? d.checkIn?.punchedAt.toISOString() ?? null, checkOutAt: d.effectiveCheckOutAt?.toISOString() ?? d.checkOut?.punchedAt.toISOString() ?? null, workedMinutes: Number(d.workedMinutes), dayMinutes: Number(d.dayMinutes), nightMinutes: Number(d.nightMinutes), lateMinutes: d.lateMinutes, earlyMinutes: d.earlyMinutes, absent: d.absent, workUnits: String(d.workUnits), flags: d.flags, adjustmentId: d.adjustmentId, segments: d.segments, rules: d.rules } : null; }
function actualView(a: OvertimeActual | null) { return a ? { id: a.id, requestedMinutes: Number(a.requestedMinutes), approvedMinutes: Number(a.approvedMinutes), actualMinutes: Number(a.actualMinutes), eligibleMinutes: Number(a.eligibleMinutes), dayMinutes: Number(a.dayMinutes), nightMinutes: Number(a.nightMinutes), unapprovedMinutes: Number(a.unapprovedMinutes), unworkedApprovedMinutes: Number(a.unworkedApprovedMinutes), flags: a.flags, adjustmentId: a.adjustmentId, evidence: a.evidence } : null; }

@Injectable()
export class CorrectionsService {
  constructor(private readonly prisma: PrismaService, private readonly scope: ScopeService, private readonly audit: AuditService, private readonly attendance: AttendanceService, private readonly settings: SettingsService) {}
  private transaction<T>(fn: (db: Db) => Promise<T>) { return this.prisma.$transaction(async db => { await db.$queryRaw`SELECT pg_advisory_xact_lock(8210472)::text AS lock`; return fn(db); }, { isolationLevel: "ReadCommitted", timeout: 90000 }); }
  private async read(db: Db, user: AuthUser, id: string, permission = "attendance.read") {
    await this.scope.load(user, permission, db);
    const row = await db.attendanceCorrection.findUnique({ where: { id }, include: correctionInclude });
    if (!row) throw new NotFoundException("Không tìm thấy giải trình trong phạm vi.");
    try { await correctionAccess(db, this.scope, user, row.items, permission); }
    catch (e) { if (e instanceof ForbiddenException) throw new NotFoundException("Không tìm thấy giải trình trong phạm vi."); throw e; }
    return row;
  }
  private async writable(db: Db, periodId: string, items: CorrectionAccessItem[]) {
    const period = await db.businessPeriod.findUnique({ where: { id: periodId } });
    if (!period || period.status !== "OPEN") throw new ConflictException("Kỳ công chưa mở hoặc đã CLOSED/LOCKED; không được sửa giải trình.");
    for (const item of items) {
      if (item.workDate < period.dateFrom || item.workDate > period.dateTo) throw new BadRequestException("Ngày công ngoài kỳ đã chọn.");
      for (const day of uniqueDates([item.workDate, ...item.sourceDates])) {
        const versions = await db.orgUnitVersion.findMany({ where: effectiveAt(day), select: { orgUnitId: true, parentId: true } });
        const parents = new Map(versions.map(v => [v.orgUnitId, v.parentId])); const ids: string[] = [];
        let cursor: string | null | undefined = item.orgUnitId;
        while (cursor && !ids.includes(cursor)) { ids.push(cursor); cursor = parents.get(cursor); }
        if (day.getTime() === item.workDate.getTime() && !ids.includes(period.scopeOrgUnitId)) throw new BadRequestException("Kỳ công không thuộc đơn vị của giải trình.");
        if (await db.businessPeriod.findFirst({ where: { scopeOrgUnitId: { in: ids }, periodType: "ATTENDANCE", status: { in: ["CLOSED", "LOCKED"] }, dateFrom: { lte: day }, dateTo: { gte: day } } })) throw new ConflictException("Ngày công hoặc ngày nguồn liên quan kỳ CLOSED/LOCKED; không thể thay đổi.");
      }
    }
  }
  private async snapshot(db: Db, item: Pick<CorrectionAccessItem, "employeeId" | "orgUnitId" | "workDate">) {
    const selector = { employeeId: item.employeeId, orgUnitId: item.orgUnitId, workDate: item.workDate };
    const [daily, actual, raw, schedules, overtime] = await Promise.all([
      db.dailyAttendance.findFirst({ where: selector, include: { checkIn: true, checkOut: true } }),
      db.overtimeActual.findUnique({ where: { employeeId_orgUnitId_workDate: selector } }),
      db.rawPunch.findMany({ where: { employeeId: item.employeeId, punchedAt: { gte: new Date(item.workDate.getTime()-DAY-VN), lt: new Date(item.workDate.getTime()+3*DAY-VN) } }, orderBy: [{ punchedAt: "asc" }, { id: "asc" }], select: { id: true, siteId: true, punchedAt: true, direction: true, batchId: true, rowNumber: true } }),
      db.shiftSchedule.findMany({ where: { employeeId: item.employeeId, workDate: item.workDate }, include: { shift: true, plan: { select: { id: true, status: true, revision: true } } }, orderBy: { id: "asc" } }),
      db.overtimeRequest.findMany({ where: { workDate: item.workDate, members: { some: { employeeId: item.employeeId } } }, orderBy: { id: "asc" }, select: { id: true, revision: true, status: true, startAt: true, endAt: true, requestedMinutes: true, teamOrgUnitId: true } }),
    ]);
    const snapshot = { daily: dailyView(daily), actual: actualView(actual) };
    const sourceHash = createHash("sha256").update(JSON.stringify({ snapshot, raw, schedules, overtime })).digest("hex");
    const dates = uniqueDates([item.workDate, ...(actual?.sourceDates ?? []), ...[daily?.effectiveCheckInAt, daily?.effectiveCheckOutAt, daily?.checkIn?.punchedAt, daily?.checkOut?.punchedAt].flatMap(t => t ? [local(t)] : [])]);
    return { snapshot, sourceHash, dates, daily, actual };
  }
  private normalize(dto: CreateCorrectionDto) {
    const seen = new Set<string>();
    const items = dto.items.map(i => {
      const workDate = date(i.workDate);
      if (workDate > businessDate()) throw new BadRequestException("Không giải trình công thực tế cho ngày tương lai.");
      const k = i.employeeId + ":" + i.orgUnitId + ":" + i.workDate;
      if (seen.has(k)) throw new BadRequestException("Một nhân sự/ngày công chỉ xuất hiện một lần trong chứng từ."); seen.add(k);
      if (dto.kind === "CORRECTION" && !Array.isArray(i.intervals)) throw new BadRequestException("Điều chỉnh phải khai báo rõ các khoảng có mặt; mảng rỗng nghĩa là không có mặt.");
      if (dto.kind === "EXPLANATION" && i.intervals != null) throw new BadRequestException("Giải trình không thay giờ thực tế; chọn Điều chỉnh để khai báo khoảng có mặt.");
      const intervals = i.intervals == null ? null : i.intervals.map(r => {
        date(r.startAt.slice(0,10)); date(r.endAt.slice(0,10));
        const a = new Date(r.startAt), b = new Date(r.endAt);
        if (!Number.isFinite(a.getTime()) || !Number.isFinite(b.getTime()) || a.getTime()%60000 || b.getTime()%60000 || b<=a || b.getTime()-a.getTime()>DAY || b.getTime()>Date.now() || local(a)<workDate || local(a).getTime()>workDate.getTime()+DAY || local(b).getTime()>workDate.getTime()+2*DAY) throw new BadRequestException("Khoảng có mặt phải tròn phút, tăng dần, tối đa 24 giờ, không ở tương lai; bắt đầu ngày công hoặc ngày kế tiếp theo giờ Việt Nam.");
        return { startAt: a.toISOString(), endAt: b.toISOString() };
      }).sort((a,b) => a.startAt.localeCompare(b.startAt));
      if (intervals && (intervals.some((r,n) => n>0 && r.startAt<intervals[n-1].endAt) || (intervals.length && Date.parse(intervals.at(-1)!.endAt)-Date.parse(intervals[0].startAt)>DAY))) throw new BadRequestException("Các khoảng có mặt không được chồng lấn hoặc trải dài quá 24 giờ.");
      return { employeeId: i.employeeId, orgUnitId: i.orgUnitId, workDate, intervals, excuseLateEarly: i.excuseLateEarly };
    });
    if (items.length>1 && (!dto.incidentReference?.trim() || items.some(i => i.orgUnitId!==items[0].orgUnitId || i.workDate.getTime()!==items[0].workDate.getTime()))) throw new BadRequestException("Điều chỉnh hàng loạt cần cùng tổ/ngày và biên bản sự cố.");
    return items;
  }
  private async prepare(db: Db, user: AuthUser, dto: CreateCorrectionDto) {
    const items = this.normalize(dto), result = [];
    for (const item of items) {
      await correctionAccess(db, this.scope, user, [{ ...item, sourceDates: [item.workDate] }], "attendance.explain");
      const source = await this.snapshot(db, item);
      if ((!source.daily && !source.actual) || (source.daily && source.daily.periodId!==dto.periodId) || (source.actual && source.actual.periodId!==dto.periodId)) throw new BadRequestException("Chọn ngày công/OT đã được xử lý trong kỳ này.");
      if (item.excuseLateEarly) {
        const d = source.snapshot.daily;
        if (!d || d.absent || !d.checkInAt || !d.checkOutAt || d.lateMinutes>=15 || d.earlyMinutes>=15 || d.lateMinutes+d.earlyMinutes<=0 || item.intervals!==null) throw new BadRequestException("BR-21 chỉ miễn muộn/về sớm dưới 15 phút có đủ vào/ra; không đồng thời thay giờ thực tế.");
      }
      const sourceDates = uniqueDates([...source.dates, ...(item.intervals ?? []).flatMap(r => [local(new Date(r.startAt)), local(new Date(r.endAt))])]);
      await correctionAccess(db, this.scope, user, [{ ...item, sourceDates }], "attendance.explain");
      await this.writable(db, dto.periodId, [{ ...item, sourceDates }]);
      result.push({ ...item, intervals: item.intervals===null ? Prisma.DbNull : json(item.intervals), sourceDates, periodId: dto.periodId, sourceHash: source.sourceHash, beforeSnapshot: json(source.snapshot) });
    }
    return result;
  }
  private async history(db: Db, user: AuthUser, id: string, action: string, old: unknown, reason: string | undefined, ipAddress?: string) {
    const row = await db.attendanceCorrection.findUniqueOrThrow({ where: { id }, include: correctionInclude });
    const current = correctionView(row); current.history = [];
    await db.attendanceCorrectionHistory.create({ data: { correctionId: id, actorId: user.id, action, reason, oldValue: old == null ? Prisma.DbNull : json(old), newValue: json(current) } });
    await this.audit.record({ actorId: user.id, entityType: "attendance_correction", entityId: id, action, result: "SUCCESS", oldValue: old == null ? undefined : json(old), newValue: json({ ...current, actionReason: reason }), ipAddress }, db);
    return { correction: correctionView(await db.attendanceCorrection.findUniqueOrThrow({ where: { id }, include: correctionInclude })) };
  }
  async create(user: AuthUser, dto: CreateCorrectionDto, ip?: string) {
    return this.transaction(async db => {
      const items = await this.prepare(db, user, dto);
      const row = await db.attendanceCorrection.create({ data: { periodId: dto.periodId, kind: dto.kind, reason: dto.reason.trim(), evidenceReference: dto.evidenceReference?.trim() || null, incidentReference: dto.incidentReference?.trim() || null, warnings: [], createdById: user.id, items: { create: items } } });
      return this.history(db, user, row.id, "CREATE", null, dto.reason.trim(), ip);
    });
  }
  private editable(row: CorrectionRecord, user: AuthUser, revision: number) {
    if (row.revision!==revision) throw new ConflictException("Giải trình đã thay đổi. Tải lại trước khi thao tác.");
    if (row.createdById!==user.id) throw new ForbiddenException("Chỉ người lập được sửa/gửi giải trình.");
    if (!["DRAFT","RETURNED"].includes(row.status)) throw new ConflictException("Chỉ sửa/gửi bản nháp hoặc giải trình đã trả lại.");
  }
  async update(user: AuthUser, id: string, dto: UpdateCorrectionDto, ip?: string) {
    return this.transaction(async db => {
      const row = await this.read(db,user,id,"attendance.explain"); this.editable(row,user,dto.revision);
      await this.writable(db,row.periodId,row.items);
      if (dto.periodId!==row.periodId) throw new BadRequestException("Không đổi kỳ của giải trình; lập chứng từ mới cho kỳ khác.");
      const items = await this.prepare(db,user,dto);
      await db.attendanceCorrectionItem.deleteMany({ where: { correctionId: id } });
      await db.attendanceCorrection.update({ where: { id }, data: { kind: dto.kind, reason: dto.reason.trim(), evidenceReference: dto.evidenceReference?.trim() || null, incidentReference: dto.incidentReference?.trim() || null, revision: { increment: 1 }, items: { create: items } } });
      return this.history(db,user,id,"UPDATE",correctionView(row),dto.reason.trim(),ip);
    });
  }
  async action(user: AuthUser, id: string, action: "submit"|"approve"|"return"|"reject", dto: CorrectionActionDto, ip?: string) {
    return this.transaction(async db => {
      const row = await this.read(db,user,id,action==="submit"?"attendance.explain":"attendance.review");
      if (row.revision!==dto.revision) throw new ConflictException("Giải trình đã thay đổi. Tải lại trước khi thao tác.");
      await this.writable(db,row.periodId,row.items);
      if (action==="submit") {
        this.editable(row,user,dto.revision);
        if (!row.evidenceReference?.trim() && !row.evidence.length) throw new BadRequestException("Cần chứng cứ tham chiếu hoặc tệp chứng từ trước khi gửi.");
        for (const item of row.items) {
          const source = await this.snapshot(db,item);
          const sourceDates = uniqueDates([...item.sourceDates,...source.dates]);
          await correctionAccess(db,this.scope,user,[{ ...item,sourceDates }],"attendance.explain"); await this.writable(db,row.periodId,[{ ...item,sourceDates }]);
          await db.attendanceCorrectionItem.update({ where: { id: item.id }, data: { sourceHash: source.sourceHash, beforeSnapshot: json(source.snapshot), sourceDates } });
        }
        await db.attendanceCorrection.update({ where: { id }, data: { status: "PENDING", revision: { increment: 1 }, submittedAt: new Date(), decidedById: null, decidedAt: null, decisionReason: null } });
      } else {
        if (row.status!=="PENDING") throw new ConflictException("Chỉ duyệt/trả lại/từ chối giải trình đang chờ duyệt.");
        if (row.createdById===user.id) throw new ForbiddenException("Người lập không được tự duyệt giải trình.");
        if (action!=="approve" && !dto.reason?.trim()) throw new BadRequestException("Nhập lý do trả lại/từ chối.");
        let warnings: string[] = [], appliedOrder: bigint | null = null;
        if (action==="approve") {
          for (const item of row.items) {
            const source = await this.snapshot(db,item);
            if (source.sourceHash!==item.sourceHash) throw new ConflictException("Nguồn công/OT đã thay đổi sau khi gửi. QĐ cần trả lại để TT cập nhật và gửi lại giải trình.");
            await this.checkOverlap(db,item);
          }
          const adjustments: ApprovedAttendanceAdjustment[] = row.items.map(i => ({ id:i.id,employeeId:i.employeeId,orgUnitId:i.orgUnitId,workDate:key(i.workDate),intervals:i.intervals as Interval[]|null,excuseLateEarly:i.excuseLateEarly }));
          await this.attendance.reconcileCorrections(user,row.periodId,db,adjustments);
          for (const item of row.items) {
            const after = await this.snapshot(db,item);
            if (after.daily?.adjustmentId!==item.id && after.actual?.adjustmentId!==item.id) throw new ConflictException("Không áp dụng được điều chỉnh vào nguồn công hiện hành; kiểm tra kỳ và dữ liệu nguồn.");
            await db.attendanceCorrectionItem.update({ where: { id:item.id },data:{ afterSnapshot:json(after.snapshot) } });
            warnings.push(...await this.warnings(db,item));
          }
          const [sequence] = await db.$queryRaw<Array<{value:bigint}>>`SELECT nextval('attendance_correction_approval_order') AS value`;
          appliedOrder = sequence.value;
        }
        await db.attendanceCorrection.update({ where: { id }, data: { status: action==="approve"?"APPROVED":action==="return"?"RETURNED":"REJECTED", revision:{ increment:1 },decidedById:user.id,decidedAt:new Date(),decisionReason:dto.reason?.trim() || null,warnings:[...new Set(warnings)],appliedOrder } });
      }
      return this.history(db,user,id,action.toUpperCase(),correctionView(row),dto.reason?.trim(),ip);
    });
  }
  private async checkOverlap(db: Db, item: CorrectionRecord["items"][number]) {
    const intervals = item.intervals as Interval[]|null; if (!intervals?.length) return;
    const rows = await db.dailyAttendance.findMany({ where: { employeeId:item.employeeId, NOT:{orgUnitId:item.orgUnitId,workDate:item.workDate}, workDate:{gte:new Date(item.workDate.getTime()-2*DAY),lte:new Date(item.workDate.getTime()+2*DAY)} },include:{checkIn:true,checkOut:true} });
    const actuals = await db.overtimeActual.findMany({where:{employeeId:item.employeeId,NOT:{orgUnitId:item.orgUnitId,workDate:item.workDate},workDate:{gte:new Date(item.workDate.getTime()-2*DAY),lte:new Date(item.workDate.getTime()+2*DAY)}}});
    const others = [...rows.flatMap(r => { const a=r.effectiveCheckInAt??r.checkIn?.punchedAt,b=r.effectiveCheckOutAt??r.checkOut?.punchedAt; return a&&b?[{startAt:a.toISOString(),endAt:b.toISOString()}]:[]; }),...actuals.flatMap(r => ((r.evidence as any)?.pairs??[]).filter((p:any)=>p.checkInAt&&p.checkOutAt).map((p:any)=>({startAt:p.checkInAt,endAt:p.checkOutAt})))];
    if(intervals.some(r=>others.some(o=>Date.parse(r.startAt)<Date.parse(o.endAt)&&Date.parse(r.endAt)>Date.parse(o.startAt)))) throw new ConflictException("Khoảng điều chỉnh chồng với dữ liệu ngày/đơn vị khác của cùng nhân sự; có nguy cơ công trùng hoặc hiện diện ở hai cơ sở.");
  }
  private async warnings(db: Db, item: CorrectionAccessItem) {
    const rows = await db.overtimeActual.findMany({where:{employeeId:item.employeeId,workDate:{gte:date(key(item.workDate).slice(0,4)+"-01-01"),lte:date(key(item.workDate).slice(0,4)+"-12-31")}}});
    const month=key(item.workDate).slice(0,7),year=key(item.workDate).slice(0,4); let monthly=0,yearly=0,daily=0;
    for(const row of rows) for(const segment of ((row.evidence as any)?.segments??[])) { if(segment.calendarDate.startsWith(year))yearly+=segment.minutes; if(segment.calendarDate.startsWith(month))monthly+=segment.minutes; if(key(row.workDate)===key(item.workDate))daily+=segment.minutes; }
    const limit=async(code:string,fallback:number)=>{const p=await this.settings.resolveLegalParameter(code,"ALL","WORK_DATE",item.orgUnitId,item.workDate,db);return p?Number(p.value):fallback;};
    const result=[];
    if(daily>await limit("SHIFT_MAX_DAILY_MINUTES",480)*await limit("OT_DAILY_MAX_RATIO",0.5))result.push("OT thực tế vượt ngưỡng ngày; cần đối chiếu giới hạn pháp luật, không tự tăng giờ đủ điều kiện.");
    if(monthly>await limit("OT_MONTH_MAX_MINUTES",2400))result.push("OT thực tế lũy kế tháng vượt trần cấu hình.");
    if(yearly>await limit("OT_YEAR_MAX_MINUTES",12000))result.push("OT thực tế lũy kế năm vượt trần cấu hình.");
    return result;
  }
  async detail(user:AuthUser,id:string) {return {correction:correctionView(await this.read(this.prisma,user,id))};}
  async list(user:AuthUser,q:CorrectionQueryDto) {
    const current=await this.scope.load(user,"attendance.read");
    if(q.orgUnitId&&!current.allowed.has(q.orgUnitId))throw new ForbiddenException("Đơn vị ngoài phạm vi.");
    if(!(await this.settings.listPeriods(user)).items.some(p=>p.id===q.periodId))throw new NotFoundException("Không tìm thấy kỳ công trong phạm vi.");
    const rows=await this.prisma.attendanceCorrection.findMany({where:{periodId:q.periodId,...(q.status?{status:q.status}:{}),items:{some:{orgUnitId:{in:q.orgUnitId?current.versions.filter(v=>v.orgUnitId===q.orgUnitId||this.descends(v.orgUnitId,q.orgUnitId!,current.versions)).map(v=>v.orgUnitId):[...current.allowed]},...(q.search?.trim()?{employee:{OR:[{code:{contains:q.search.trim(),mode:"insensitive" as const}},{fullName:{contains:q.search.trim(),mode:"insensitive" as const}}]}}:{})}}},include:correctionInclude,orderBy:[{createdAt:"desc"},{id:"desc"}]});
    const visible=[];
    for(const row of rows){try{await correctionAccess(this.prisma,this.scope,user,row.items);visible.push(correctionView(row));}catch(e){if(!(e instanceof ForbiddenException))throw e;}}
    return {items:visible.slice((q.page-1)*q.pageSize,q.page*q.pageSize),total:visible.length,page:q.page,pageSize:q.pageSize};
  }
  private descends(id:string,parent:string,versions:Array<{orgUnitId:string,parentId:string|null}>) {const seen=new Set<string>();let cursor:string|null|undefined=id;while(cursor&&!seen.has(cursor)){if(cursor===parent)return true;seen.add(cursor);cursor=versions.find(v=>v.orgUnitId===cursor)?.parentId;}return false;}
  async targets(user:AuthUser,q:CorrectionTargetQueryDto) {
    const day=date(q.workDate),current=await this.scope.load(user,"attendance.read");
    if(q.orgUnitId&&!current.allowed.has(q.orgUnitId))throw new ForbiddenException("Đơn vị ngoài phạm vi.");
    if(!(await this.settings.listPeriods(user)).items.some(p=>p.id===q.periodId))throw new NotFoundException("Không tìm thấy kỳ công trong phạm vi.");
    const unitIds=q.orgUnitId?current.versions.filter(v=>this.descends(v.orgUnitId,q.orgUnitId!,current.versions)).map(v=>v.orgUnitId):[...current.allowed];
    const where={periodId:q.periodId,workDate:day,orgUnitId:{in:unitIds},...(q.search?.trim()?{employee:{OR:[{code:{contains:q.search.trim(),mode:"insensitive" as const}},{fullName:{contains:q.search.trim(),mode:"insensitive" as const}}]}}:{})};
    const [days,actuals]=await Promise.all([this.prisma.dailyAttendance.findMany({where,include:{employee:{select:employee},orgUnit:true,checkIn:true,checkOut:true}}),this.prisma.overtimeActual.findMany({where,include:{employee:{select:employee},orgUnit:true}})]);
    const grouped=new Map<string,{employee:{id:string,code:string,fullName:string},orgUnitId:string,orgUnitCode:string,workDate:string,daily:ReturnType<typeof dailyView>,actual:ReturnType<typeof actualView>,sourceDates:Date[]}>();
    for(const row of [...days,...actuals]){const k=row.employeeId+":"+row.orgUnitId;let t=grouped.get(k);if(!t){t={employee:row.employee,orgUnitId:row.orgUnitId,orgUnitCode:row.orgUnit.code,workDate:key(day),daily:null,actual:null,sourceDates:[day]};grouped.set(k,t);}if("workedMinutes" in row){t.daily=dailyView(row);for(const at of [row.effectiveCheckInAt,row.effectiveCheckOutAt,row.checkIn?.punchedAt,row.checkOut?.punchedAt])if(at)t.sourceDates.push(local(at));}else{t.actual=actualView(row);t.sourceDates.push(...row.sourceDates);}}
    const visible=[];
    for(const target of grouped.values()){try{await correctionAccess(this.prisma,this.scope,user,[{employeeId:target.employee.id,orgUnitId:target.orgUnitId,workDate:day,sourceDates:uniqueDates(target.sourceDates)}]);const {sourceDates,...view}=target;visible.push(view);}catch(e){if(!(e instanceof ForbiddenException))throw e;}}
    visible.sort((a,b)=>a.employee.code.localeCompare(b.employee.code));return {items:visible.slice((q.page-1)*q.pageSize,q.page*q.pageSize),total:visible.length,page:q.page,pageSize:q.pageSize};
  }
  async upload(user:AuthUser,id:string,file:Express.Multer.File|undefined,ip?:string) {
    return this.transaction(async db=>{
      const row=await this.read(db,user,id,"attendance.explain");this.editable(row,user,row.revision);await this.writable(db,row.periodId,row.items);
      if(!file?.buffer.length||file.size>5242880)throw new BadRequestException("Chọn chứng từ PDF/PNG/JPEG/TXT không rỗng, tối đa 5 MB.");
      if(row.evidence.length>=10)throw new BadRequestException("Mỗi giải trình tối đa 10 tệp chứng từ.");
      const b=file.buffer;let contentType:string;
      if(b.subarray(0,5).toString()==="%PDF-")contentType="application/pdf";
      else if(b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))contentType="image/png";
      else if(b[0]===255&&b[1]===216&&b[2]===255)contentType="image/jpeg";
      else {try{new TextDecoder("utf-8",{fatal:true}).decode(b);}catch{throw new BadRequestException("Tệp chứng từ không đúng định dạng được phép.");}if(!/\.txt$/i.test(file.originalname)||b.includes(0))throw new BadRequestException("Chỉ nhận PDF/PNG/JPEG hoặc văn bản UTF-8 .txt.");contentType="text/plain; charset=utf-8";}
      const fileName=file.originalname.split(/[\\/]/).pop()!.replace(/[\x00-\x1f\x7f]/g,"").slice(0,255)||"chung-tu";
      await db.attendanceCorrectionEvidence.create({data:{correctionId:id,fileName,contentType,size:b.length,sha256:createHash("sha256").update(b).digest("hex"),content:new Uint8Array(b),uploadedById:user.id}});
      await db.attendanceCorrection.update({where:{id},data:{revision:{increment:1}}});return this.history(db,user,id,"ADD_EVIDENCE",correctionView(row),"Đính kèm chứng từ",ip);
    });
  }
  async evidence(user:AuthUser,id:string,evidenceId:string,ip?:string){await this.read(this.prisma,user,id);const file=await this.prisma.attendanceCorrectionEvidence.findFirst({where:{id:evidenceId,correctionId:id}});if(!file)throw new NotFoundException("Không tìm thấy chứng từ.");await this.audit.record({actorId:user.id,entityType:"attendance_correction_evidence",entityId:file.id,action:"DOWNLOAD",result:"ALLOWED",ipAddress:ip});return file;}
}
