import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { AuditService } from "../audit/audit.service";
import { businessDate } from "../auth/business-date";
import type { AuthUser } from "../auth/auth.types";
import { PrismaService } from "../database/prisma.service";
import { LeaveAccessService, type LeaveScope } from "../leave/leave-access.service";
import { effectiveAt } from "../organization/scope.service";
import { AttendanceService } from "./attendance.service";
import { computeOvertimeAttendance } from "./overtime-actual-engine";
import { applyApprovedLeave, leavePairingSchedule, type ApprovedLeaveSource, type LeaveAttendance } from "./leave-attendance";
import type { ComputedDay, EngineSchedule, PairingRules, PunchDirection } from "./attendance.types";
import type { ComputedActual } from "./overtime-actual.types";
import type { SourceCoverageDto, TeamConfirmationDto, TeamReviewQuery } from "./team-confirmation.dto";
type Db = Prisma.TransactionClient;
const DAY=86400000, VN=7*3600000, MINUTE=60000;
const actor={id:true,displayName:true} as const;
const key=(d:Date)=>d.toISOString().slice(0,10);
const shift=(d:Date,n:number)=>new Date(d.getTime()+n*DAY);
const local=(d:Date)=>new Date(key(new Date(d.getTime()+VN))+"T00:00:00Z");
const active=(r:{effectiveFrom:Date;effectiveTo:Date|null},d:Date)=>r.effectiveFrom<=d&&(!r.effectiveTo||r.effectiveTo>=d);
function canonical(value:unknown):string {
  if(value===null||typeof value!=="object") return JSON.stringify(value);
  if(value instanceof Date) return JSON.stringify(value.toISOString());
  if(Array.isArray(value)) return "["+value.map(canonical).join(",")+"]";
  return "{"+Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+":"+canonical(v)).join(",")+"}";
}
const hash=(value:unknown)=>createHash("sha256").update(canonical(value)).digest("hex");
const json=(value:unknown)=>JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
// Compare work units at the persisted NUMERIC(10,6) precision, not engine division precision.
function dayValue(d:ComputedDay) {return {scheduleId:d.scheduleId,checkInId:d.checkInId,checkOutId:d.checkOutId,checkInAt:d.checkInAt,checkOutAt:d.checkOutAt,status:d.status,flags:[...d.flags].sort(),workedMinutes:Number(d.workedMinutes),dayMinutes:Number(d.dayMinutes),nightMinutes:Number(d.nightMinutes),lateMinutes:d.lateMinutes,earlyMinutes:d.earlyMinutes,absent:d.absent,workUnits:new Prisma.Decimal(d.workUnits).toDecimalPlaces(6).toNumber(),segments:d.segments,adjustmentId:d.adjustmentId??null};}
function leaveValue(l:Partial<LeaveAttendance>) {return {minutes:l.minutes??0,paidMinutes:l.paidMinutes??0,countedUnits:Number(l.countedUnits??0),symbols:[...(l.symbols??[])].sort(),sources:[...(l.sources??[])].sort((a,b)=>a.requestId.localeCompare(b.requestId))};}
function actualValue(a:Pick<ComputedActual,"requestedMinutes"|"approvedMinutes"|"actualMinutes"|"eligibleMinutes"|"dayMinutes"|"nightMinutes"|"unapprovedMinutes"|"unworkedApprovedMinutes"|"flags"|"adjustmentId">) {return {requestedMinutes:Number(a.requestedMinutes),approvedMinutes:Number(a.approvedMinutes),actualMinutes:Number(a.actualMinutes),eligibleMinutes:Number(a.eligibleMinutes),dayMinutes:Number(a.dayMinutes),nightMinutes:Number(a.nightMinutes),unapprovedMinutes:Number(a.unapprovedMinutes),unworkedApprovedMinutes:Number(a.unworkedApprovedMinutes),flags:[...a.flags].sort(),adjustmentId:a.adjustmentId??null};}
function actualEvidence(value:unknown) {
  const evidence=value as Partial<ComputedActual> & {rules?:unknown};
  const sorted=<T>(rows:T[])=>[...rows].sort((a,b)=>canonical(a).localeCompare(canonical(b)));
  return {...evidence,flags:[...(evidence.flags??[])].sort(),requests:sorted(evidence.requests??[]),punchIds:[...(evidence.punchIds??[])].sort(),pairs:sorted(evidence.pairs??[]),segments:sorted(evidence.segments??[])};
}
export interface Issue {code:string;message:string;employeeId?:string;workDate?:string;sourceId?:string;}
export interface AccessItem {employeeId:string;orgUnitId:string;workDate:string;sourceDates:string[];}
@Injectable()
export class TeamConfirmationService {
  constructor(private readonly prisma:PrismaService,private readonly access:LeaveAccessService,private readonly attendance:AttendanceService,private readonly audit:AuditService) {}
  private transaction<T>(fn:(db:Db)=>Promise<T>) {
    return this.prisma.$transaction(async db=>{
      await db.$queryRaw`SELECT pg_advisory_xact_lock(8210472)::text AS lock`;
      await db.$queryRaw`SELECT pg_advisory_xact_lock(8210473)::text AS lock`;
      return fn(db);
    },{isolationLevel:"Serializable",timeout:90000}).catch(error=>{
      if(error instanceof Prisma.PrismaClientKnownRequestError&&error.code==="P2034") throw new ConflictException("Nguồn công đã đổi trong lúc xử lý; tải lại trước khi xác nhận.");
      throw error;
    });
  }
  async teams(user:AuthUser,periodId:string) {
    const period=await this.prisma.businessPeriod.findUnique({where:{id:periodId}});
    if(!period||period.periodType!=="ATTENDANCE") throw new NotFoundException("Không tìm thấy kỳ công.");
    const current=await this.access.scoped(user,"attendance.read");
    const versions=await this.prisma.orgUnitVersion.findMany({where:{orgUnitId:{in:[...current.allowed]},type:"TEAM",effectiveFrom:{lte:period.dateTo},OR:[{effectiveTo:null},{effectiveTo:{gte:period.dateFrom}}]},include:{orgUnit:true},orderBy:[{orgUnitId:"asc"},{effectiveFrom:"desc"}]});
    const ids=new Set<string>();
    const items=[];
    for(const v of versions) {
      if(ids.has(v.orgUnitId)) continue;
      const parents=await this.prisma.orgUnitVersion.findMany({where:effectiveAt(v.effectiveFrom>period.dateFrom?v.effectiveFrom:period.dateFrom),select:{orgUnitId:true,parentId:true}});
      const chain=new Map(parents.map(p=>[p.orgUnitId,p.parentId])); let id:string|null|undefined=v.orgUnitId;
      const seen=new Set<string>(); while(id&&!seen.has(id)&&id!==period.scopeOrgUnitId){seen.add(id);id=chain.get(id);}
      if(id===period.scopeOrgUnitId){ids.add(v.orgUnitId);items.push({id:v.orgUnitId,code:v.orgUnit.code,name:v.name,siteId:v.siteId});}
    }
    return {items};
  }
  async review(user:AuthUser,q:TeamReviewQuery) {return this.prisma.$transaction(db=>this.build(db,user,q,"attendance.read"),{isolationLevel:"RepeatableRead",timeout:90000});}
  async build(db:Db,user:AuthUser,q:TeamReviewQuery,permission:string) { return this.buildEvidence(db,user,q,permission); }
  // Internal period transition check only; its evidence is never returned through a route.
  async buildPeriodEvidence(db:Db,q:TeamReviewQuery) { return this.buildEvidence(db,null,q,"attendance.read"); }
  private async buildEvidence(db:Db,user:AuthUser|null,q:TeamReviewQuery,permission:string) {
    const period=await db.businessPeriod.findUnique({where:{id:q.periodId}});
    if(!period||period.periodType!=="ATTENDANCE") throw new NotFoundException("Không tìm thấy kỳ công.");
    const from=period.dateFrom,to=period.dateTo;
    const scopes=new Map<string,LeaveScope>();
    const scoped=async(d:Date)=>{
      const k=key(d); const cached=scopes.get(k); if(cached)return cached;
      if(user){const result=await this.access.scoped(user,permission,db,d);scopes.set(k,result);return result;}
      const versions=await db.orgUnitVersion.findMany({where:effectiveAt(d),include:{orgUnit:true,site:true}});
      const allowed=new Set<string>(),pending=[period.scopeOrgUnitId];
      const children=new Map<string,string[]>();
      for(const version of versions)if(version.parentId){const list=children.get(version.parentId)??[];list.push(version.orgUnitId);children.set(version.parentId,list);}
      while(pending.length){const id=pending.pop()!;if(allowed.has(id))continue;allowed.add(id);pending.push(...(children.get(id)??[]));}
      const result={allowed,versions:versions.filter(v=>allowed.has(v.orgUnitId))};scopes.set(k,result);return result;
    };
    const current=await scoped(user?businessDate():to);
    const team=current.versions.find(v=>v.orgUnitId===q.teamOrgUnitId&&v.type==="TEAM");
    if(!team?.siteId) throw new NotFoundException("Không tìm thấy tổ trong phạm vi.");
    const overlaps={effectiveFrom:{lte:to},OR:[{effectiveTo:null},{effectiveTo:{gte:from}}]};
    const [people,schedules,overtime,days,actuals,leaves,corrections,history,coverages,tree,periods]=await Promise.all([
      db.employee.findMany({where:{assignments:{some:{orgUnitId:team.orgUnitId,isPrimary:true,...overlaps}}},include:{assignments:{where:{isPrimary:true},orderBy:{effectiveFrom:"asc"}},exclusions:{where:{userAccountId:{in:user?[user.id]:[]}}}},orderBy:{id:"asc"}}),
      db.shiftSchedule.findMany({where:{plan:{teamOrgUnitId:team.orgUnitId},workDate:{gte:shift(from,-1),lte:shift(to,1)}},include:{plan:true,shift:true},orderBy:[{workDate:"asc"},{id:"asc"}]}),
      db.overtimeRequest.findMany({where:{teamOrgUnitId:team.orgUnitId,workDate:{gte:shift(from,-1),lte:shift(to,1)}},include:{members:{orderBy:{employeeId:"asc"}}},orderBy:{id:"asc"}}),
      db.dailyAttendance.findMany({where:{orgUnitId:team.orgUnitId,workDate:{gte:from,lte:to}},include:{checkIn:true,checkOut:true},orderBy:{scheduleId:"asc"}}),
      db.overtimeActual.findMany({where:{orgUnitId:team.orgUnitId,workDate:{gte:from,lte:to}},orderBy:[{employeeId:"asc"},{workDate:"asc"}]}),
      db.leaveRequest.findMany({where:{dateFrom:{lte:shift(to,1)},dateTo:{gte:shift(from,-1)},employee:{assignments:{some:{orgUnitId:team.orgUnitId,isPrimary:true,...overlaps}}}},orderBy:{id:"asc"}}),
      db.attendanceCorrection.findMany({where:{items:{some:{orgUnitId:team.orgUnitId,workDate:{gte:shift(from,-1),lte:shift(to,1)}}}},include:{items:true,evidence:{select:{id:true,sha256:true}}},orderBy:{id:"asc"}}),
      db.attendanceTeamConfirmation.findMany({where:{periodId:q.periodId,teamOrgUnitId:q.teamOrgUnitId},include:{actor:{select:actor}},orderBy:{revision:"desc"}}),
      db.attendanceSourceCoverage.findMany({where:{periodId:q.periodId,teamOrgUnitId:q.teamOrgUnitId},include:{actor:{select:actor}},orderBy:{revision:"desc"}}),
      db.orgUnitVersion.findMany({where:{effectiveFrom:{lte:shift(to,2)},OR:[{effectiveTo:null},{effectiveTo:{gte:shift(from,-1)}}]},orderBy:{id:"asc"}}),
      db.businessPeriod.findMany({where:{periodType:"ATTENDANCE",dateFrom:{lte:shift(to,2)},dateTo:{gte:shift(from,-1)}}}),
    ]);
    const blockers:Issue[]=[],warnings:Issue[]=[];
    const block=(code:string,message:string,extra:Partial<Issue>={})=>blockers.push({code,message,...extra});
    const warn=(code:string,message:string,extra:Partial<Issue>={})=>warnings.push({code,message,...extra});
    const dayKeys:string[]=[];
    for(let d=from;d<=to;d=shift(d,1)) {
      const s=await scoped(d),v=s.versions.find(v=>v.orgUnitId===team.orgUnitId);
      if(!v||v.type!=="TEAM"||v.siteId!==team.siteId) throw new NotFoundException("Không đủ phạm vi tổ/cơ sở trong toàn kỳ.");
      const dated=tree.filter(v=>active(v,d)),parent=new Map(dated.map(v=>[v.orgUnitId,v.parentId]));
      const chain=new Set<string>();let id:string|null|undefined=team.orgUnitId;while(id&&!chain.has(id)){chain.add(id);id=parent.get(id);}
      if(!chain.has(period.scopeOrgUnitId)) throw new BadRequestException("Tổ không thuộc phạm vi kỳ tại mọi ngày công.");
      if(periods.some(p=>chain.has(p.scopeOrgUnitId)&&p.dateFrom<=d&&p.dateTo>=d&&["CLOSED","LOCKED"].includes(p.status))) block("PERIOD_FROZEN","Kỳ công hoặc kỳ cấp cha đã chốt/khóa.",{workDate:key(d)});
      dayKeys.push(key(d));
    }
    if(period.status!=="OPEN") block("PERIOD_NOT_OPEN","Chỉ xác nhận khi kỳ công đang OPEN.");
    const byPerson=new Map(people.map(e=>[e.id,e]));
    const accessItems:AccessItem[]=[];
    for(const person of people) for(const text of dayKeys) {
      const d=new Date(text+"T00:00:00Z");
      if(person.assignments.some(a=>a.orgUnitId===team.orgUnitId&&active(a,d))) accessItems.push({employeeId:person.id,orgUnitId:team.orgUnitId,workDate:text,sourceDates:[]});
    }
    const assertItems=async(items:AccessItem[])=>{
      for(const item of items) {
        let person=byPerson.get(item.employeeId);
        if(!person){
          const p=await db.employee.findUnique({where:{id:item.employeeId},include:{assignments:{where:{isPrimary:true},orderBy:{effectiveFrom:"asc"}},exclusions:{where:{userAccountId:{in:user?[user.id]:[]}}}}});
          if(!p)throw new NotFoundException("Không đủ phạm vi để rà soát toàn tổ.");
          person=p;byPerson.set(p.id,p);
        }
        const now=businessDate(),visibleDate=person.status==="TERMINATED"&&person.terminationDate?person.terminationDate:now;
        if(user&&(!person.assignments.some(a=>active(a,visibleDate)&&current.allowed.has(a.orgUnitId))||person.exclusions.some(x=>active(x,now)))) throw new NotFoundException("Không đủ phạm vi hiện tại để rà soát toàn tổ, không xác nhận phần dữ liệu bị lọc.");
        for(const text of [item.workDate,...item.sourceDates]) {
          const d=new Date(text+"T00:00:00Z"),s=await scoped(d);
          if(!s.allowed.has(item.orgUnitId)||!person.assignments.some(a=>a.orgUnitId===item.orgUnitId&&active(a,d))||person.exclusions.some(x=>active(x,d))) throw new NotFoundException("Không đủ phạm vi tại ngày công/ngày nguồn để rà soát toàn tổ.");
        }
      }
    };
    for(const row of [...history,...coverages]) {
      const snapshot=row.snapshot as unknown as {accessItems?:AccessItem[]};
      if(snapshot.accessItems) await assertItems(snapshot.accessItems);
    }
    await assertItems(accessItems);
    const relevantSchedules=schedules.filter(s=>s.plan.status==="APPROVED");
    const targetSchedules=relevantSchedules.filter(s=>s.workDate>=from&&s.workDate<=to);
    if(!people.length||!targetSchedules.length) block("NO_SCHEDULES","Tổ chưa có nhân sự/lịch ca đã duyệt để xác nhận công.");
    const personIds=[...new Set([...people.map(p=>p.id),...schedules.map(s=>s.employeeId),...actuals.map(a=>a.employeeId)])];
    const raw=await db.rawPunch.findMany({where:{employeeId:{in:personIds},siteId:team.siteId,punchedAt:{gte:new Date(shift(from,-1).getTime()-VN),lte:new Date(shift(to,3).getTime()-VN)}},include:{processing:true},orderBy:[{punchedAt:"asc"},{id:"asc"}]});
    const rules=new Map<string,Awaited<ReturnType<AttendanceService["rules"]>>>();
    for(const d of new Set([...relevantSchedules.map(s=>key(s.workDate)),...overtime.map(o=>key(o.workDate)),...raw.map(r=>key(local(r.punchedAt))),...actuals.map(a=>key(a.workDate))])) rules.set(d,await this.attendance.rules(db,team.orgUnitId,new Date(d+"T00:00:00Z")));
    const engineSchedules:EngineSchedule[]=relevantSchedules.map(s=>({id:s.id,employeeId:s.employeeId,orgUnitId:team.orgUnitId,workDate:key(s.workDate),startAt:s.startAt.toISOString(),endAt:s.endAt.toISOString(),workMinutes:s.workMinutes,breakStartOffset:s.shift.breakStartOffset,breakMinutes:s.shift.breakMinutes,paidBreak:s.shift.paidBreak}));
    const approvedLeaves=leaves.filter(l=>l.status==="APPROVED");
    const leaveBySchedule=new Map(engineSchedules.map(s=>[s.id,approvedLeaves.filter(l=>l.employeeId===s.employeeId).flatMap(l=>(l.snapshot as unknown as {lines:ApprovedLeaveSource[]}).lines.filter(x=>x.orgUnitId===team.orgUnitId&&x.workDate===s.workDate).map(x=>({...x,requestId:l.id,revision:l.revision})))]));
    const adjustments=(await this.attendance.approvedAdjustments(db,from,to,[])).filter(a=>a.orgUnitId===team.orgUnitId&&personIds.includes(a.employeeId));
    const sourceDates=(start:Date,end:Date)=>[...new Set([key(local(start)),key(local(new Date(end.getTime()-1)))])];
    const extraAccess:AccessItem[]=[
      ...schedules.map(s=>({employeeId:s.employeeId,orgUnitId:team.orgUnitId,workDate:key(s.workDate),sourceDates:sourceDates(s.startAt,s.endAt)})),
      ...actuals.map(a=>({employeeId:a.employeeId,orgUnitId:a.orgUnitId,workDate:key(a.workDate),sourceDates:a.sourceDates.map(key)})),
      ...overtime.flatMap(o=>o.members.map(m=>({employeeId:m.employeeId,orgUnitId:o.teamOrgUnitId,workDate:key(o.workDate),sourceDates:sourceDates(o.startAt,o.endAt)}))),
      ...leaves.flatMap(l=>(l.snapshot as unknown as {lines:ApprovedLeaveSource[]}).lines.map(i=>({employeeId:l.employeeId,orgUnitId:i.orgUnitId,workDate:i.workDate,sourceDates:sourceDates(new Date(i.startAt),new Date(i.endAt))}))),
      ...corrections.flatMap(c=>c.items.map(i=>({employeeId:i.employeeId,orgUnitId:i.orgUnitId,workDate:key(i.workDate),sourceDates:i.sourceDates.map(key)}))),
    ];
    await assertItems(extraAccess);accessItems.push(...extraAccess);
    const requests=overtime.flatMap(o=>o.members.map(m=>({id:o.id,employeeId:m.employeeId,orgUnitId:team.orgUnitId,workDate:key(o.workDate),title:o.title,status:o.status,revision:o.revision,startAt:o.startAt.toISOString(),endAt:o.endAt.toISOString(),requestedMinutes:o.requestedMinutes,consentReference:m.consentReference})));
    const assignments=new Map<string,{employeeId:string;orgUnitId:string;workDate:string}>();
    const add=(employeeId:string,workDate:string)=>assignments.set(employeeId+":"+workDate,{employeeId,orgUnitId:team.orgUnitId,workDate});
    for(const a of actuals)add(a.employeeId,key(a.workDate));
    for(const r of raw) {const d=local(r.punchedAt),p=byPerson.get(r.employeeId);if(p?.assignments.some(a=>a.orgUnitId===team.orgUnitId&&active(a,d)))add(r.employeeId,key(d));}
    const computed=computeOvertimeAttendance({schedules:engineSchedules.map(s=>leavePairingSchedule(s,leaveBySchedule.get(s.id)!)),requests,punches:raw.map(r=>({id:r.id,employeeId:r.employeeId,punchedAt:r.punchedAt.toISOString(),direction:r.direction as PunchDirection})),assignments:[...assignments.values()],rules:Object.fromEntries([...rules].map(([d,r])=>[team.orgUnitId+":"+d,r.values])),adjustments});
    const storedDays=new Map(days.map(d=>[d.scheduleId,d]));
    const rows=[];
    for(const s of targetSchedules) {
      const expected=computed.attendance.days.find(d=>d.scheduleId===s.id)!;
      const projected=applyApprovedLeave(expected,engineSchedules.find(e=>e.id===s.id)!,leaveBySchedule.get(s.id)!);
      const stored=storedDays.get(s.id),extra={employeeId:s.employeeId,workDate:key(s.workDate),sourceId:s.id};
      if(!stored) block("UNPROCESSED_DAY","Ca đã duyệt chưa có kết quả công; AD cần xử lý công.",extra);
      else {
        const saved=dayValue({...projected.day,...stored,workDate:key(stored.workDate),checkInAt:(stored.effectiveCheckInAt??stored.checkIn?.punchedAt)?.toISOString()??null,checkOutAt:(stored.effectiveCheckOutAt??stored.checkOut?.punchedAt)?.toISOString()??null,workedMinutes:Number(stored.workedMinutes),dayMinutes:Number(stored.dayMinutes),nightMinutes:Number(stored.nightMinutes),workUnits:String(stored.workUnits),segments:stored.segments as unknown as ComputedDay["segments"],adjustmentId:stored.adjustmentId??undefined,status:stored.status as "OK"|"ERR"});
        if(stored.periodId!==period.id||hash(saved)!==hash(dayValue(projected.day))||hash(leaveValue(stored.leave as Partial<LeaveAttendance>))!==hash(leaveValue(projected.leave))||hash(stored.rules)!==hash(rules.get(key(s.workDate)))) block("STALE_ATTENDANCE","Kết quả công không khớp nguồn hiện tại; cần xử lý lại.",extra);
        if(Number(stored.workUnits)<0||Number(stored.workUnits)>1) block("INVALID_WORK_UNITS","Công quy đổi âm hoặc vượt một công/ngày.",extra);
        if(stored.status==="ERR"&&!adjustments.some(a=>a.id===stored.adjustmentId)) block("UNEXPLAINED_ERROR","Ngày công ERR chưa có giải trình được duyệt.",extra);
        else if(stored.flags.length||stored.status==="ERR") warn("ATTENDANCE_EXCEPTION","Ngoại lệ công cần TT rà soát: "+stored.flags.join(", "),extra);
        const person=byPerson.get(s.employeeId);
        if(person&&(person.hireDate>s.workDate||(person.terminationDate?person.terminationDate<=s.workDate:person.status!=="ACTIVE")))block("EMPLOYMENT_INVALID","Phát sinh công ngoài thời gian làm việc của nhân sự.",extra);
      }
      rows.push({scheduleId:s.id,employee:{id:s.employeeId,code:byPerson.get(s.employeeId)?.code??"",fullName:byPerson.get(s.employeeId)?.fullName??""},workDate:key(s.workDate),shiftCode:s.shift.code,status:stored?.status??"UNPROCESSED",workedMinutes:stored?Number(stored.workedMinutes):0,workUnits:stored?String(stored.workUnits):"0",flags:stored?.flags??[],leave:stored?leaveValue(stored.leave as Partial<LeaveAttendance>):leaveValue({}),correctionId:stored?.adjustmentId??null});
    }
    for(const d of days)if(!targetSchedules.some(s=>s.id===d.scheduleId))block("ORPHAN_ATTENDANCE","Kết quả công không còn lịch ca đã duyệt.",{employeeId:d.employeeId,workDate:key(d.workDate),sourceId:d.id});
    const otRows=[];
    for(const expected of computed.actuals.filter(a=>a.workDate>=key(from)&&a.workDate<=key(to))) {
      const saved=actuals.find(a=>a.employeeId===expected.employeeId&&key(a.workDate)===expected.workDate);
      if(!saved&&!expected.punchIds.length&&!expected.requests.length)continue;
      const extra={employeeId:expected.employeeId,workDate:expected.workDate,sourceId:saved?.id};
      const {employeeId,orgUnitId,...expectedEvidence}=expected;
      if(!saved||saved.periodId!==period.id||hash(actualValue({...saved,...Object.fromEntries(["requestedMinutes","approvedMinutes","actualMinutes","eligibleMinutes","dayMinutes","nightMinutes","unapprovedMinutes","unworkedApprovedMinutes"].map(k=>[k,Number(saved[k as keyof typeof saved])]))} as unknown as ComputedActual))!==hash(actualValue(expected))||hash(actualEvidence(saved.evidence))!==hash(actualEvidence({...expectedEvidence,rules:rules.get(expected.workDate)}))) block("STALE_OVERTIME","OT thực tế chưa khớp đề nghị/quẹt/giải trình; cần xử lý lại công.",extra);
      if(expected.flags.some(f=>["MISSING_IN","MISSING_OUT","INVALID_PAIR","AMBIGUOUS","UNMATCHED_PUNCH","AWAITING_PUNCHES"].includes(f))&&!saved?.adjustmentId) block("OVERTIME_ERROR","OT còn thiếu/mơ hồ lượt quẹt chưa có giải trình được duyệt.",extra);
      else if(expected.flags.length)warn("OVERTIME_EXCEPTION","Ngoại lệ OT cần rà soát: "+expected.flags.join(", "),extra);
      otRows.push({employeeId:expected.employeeId,workDate:expected.workDate,...actualValue(expected),requestIds:expected.requests.map(r=>r.id)});
    }
    const inPeriod=(d:Date)=>d>=from&&d<=to;
    for(const l of leaves)if(["DRAFT","RETURNED","PENDING"].includes(l.status)&&(l.snapshot as unknown as {lines:ApprovedLeaveSource[]}).lines.some(x=>x.orgUnitId===team.orgUnitId&&x.workDate>=key(from)&&x.workDate<=key(to)))block("UNRESOLVED_LEAVE","Còn đơn nghỉ nháp/trả lại/chờ duyệt trong kỳ.",{employeeId:l.employeeId,sourceId:l.id});
    for(const o of overtime)if(inPeriod(o.workDate)&&["DRAFT","RETURNED","PENDING"].includes(o.status))block("UNRESOLVED_OVERTIME","Còn đề nghị OT nháp/trả lại/chờ duyệt trong kỳ.",{workDate:key(o.workDate),sourceId:o.id});
    for(const c of corrections)if(["DRAFT","RETURNED","PENDING"].includes(c.status)&&c.items.some(i=>i.orgUnitId===team.orgUnitId&&inPeriod(i.workDate)))block("UNRESOLVED_CORRECTION","Còn giải trình nháp/trả lại/chờ duyệt trong kỳ.",{sourceId:c.id});
    const bounds=targetSchedules.map(s=>({from:s.startAt.getTime()-rules.get(key(s.workDate))!.values.inBeforeMinutes*MINUTE,until:Math.max(s.endAt.getTime(),...overtime.filter(o=>o.status==="APPROVED"&&o.workDate.getTime()===s.workDate.getTime()&&o.members.some(m=>m.employeeId===s.employeeId)).map(o=>o.endAt.getTime()))+rules.get(key(s.workDate))!.values.outAfterMinutes*MINUTE}));
    for(const o of overtime)if(o.status==="APPROVED"&&inPeriod(o.workDate)){const r=rules.get(key(o.workDate))!.values;bounds.push({from:o.startAt.getTime()-r.inBeforeMinutes*MINUTE,until:o.endAt.getTime()+r.outAfterMinutes*MINUTE});}
    const collectionFrom=new Date(bounds.length?Math.min(...bounds.map(b=>b.from)):from.getTime()-VN);
    const collectionUntil=new Date(bounds.length?Math.max(...bounds.map(b=>b.until)):to.getTime()+DAY-VN);
    if(collectionUntil>new Date())block("COLLECTION_WINDOW_OPEN","Chưa qua cửa sổ Ra cuối cùng của ca/OT.");
    const relevantRaw=raw.filter(r=>r.punchedAt>=collectionFrom&&r.punchedAt<=collectionUntil&&(!r.processing?.workDate||inPeriod(r.processing.workDate)));
    for(const r of relevantRaw)if(!r.processing||["WAITING","UNMATCHED","AMBIGUOUS","LATE"].includes(r.processing.state))block("UNROUTED_PUNCH","Còn lượt quẹt chờ xử lý/phân tuyến hoặc không ghép được trong cửa sổ thu log.",{employeeId:r.employeeId,sourceId:r.id});
    const rawBatchIds=[...new Set(relevantRaw.map(r=>r.batchId))].sort();
    const batches=await db.attendanceImport.findMany({where:{siteId:team.siteId,OR:[{id:{in:rawBatchIds}},{referencePeriodId:period.id,status:{not:"REJECTED"}}]},select:{id:true,fileName:true,fileHash:true,status:true,totalRows:true},orderBy:{id:"asc"}});
    const roster=people.map(p=>({id:p.id,code:p.code,fullName:p.fullName,hireDate:key(p.hireDate),terminationDate:p.terminationDate?key(p.terminationDate):null,status:p.status,assignments:p.assignments}));
    const scheduleSources=schedules.map(s=>({id:s.id,employeeId:s.employeeId,workDate:key(s.workDate),startAt:s.startAt,endAt:s.endAt,workMinutes:s.workMinutes,planId:s.planId,planStatus:s.plan.status,planRevision:s.plan.revision,shift:s.shift}));
    const rawSources=relevantRaw.map(r=>({id:r.id,employeeId:r.employeeId,punchedAt:r.punchedAt,direction:r.direction,batchId:r.batchId,deviceCode:r.deviceCode,rowNumber:r.rowNumber}));
    const collectionSource={period:{id:period.id,dateFrom:key(from),dateTo:key(to)},teamOrgUnitId:team.orgUnitId,roster,schedules:scheduleSources.filter(s=>s.planStatus==="APPROVED"),overtime:requests.filter(r=>r.status==="APPROVED"),raw:rawSources,batches:batches.filter(b=>rawBatchIds.includes(b.id)),rules:[...rules],from:collectionFrom,until:collectionUntil};
    const collectionHash=hash(collectionSource),coverage=coverages[0];
    const coverageValid=Boolean(coverage&&coverage.sourceHash===collectionHash&&coverage.coveredFrom<=collectionFrom&&coverage.coveredUntil>=collectionUntil&&rawBatchIds.every(id=>coverage.batchIds.includes(id)));
    if(!coverageValid)block("SOURCE_COVERAGE_MISSING",coverage?"Căn cứ đủ nguồn của AD đã lỗi thời; cần xác nhận lại nguồn.":"AD chưa xác nhận đủ nguồn theo file/chứng từ và khoảng bao phủ.");
    const data={period:{id:period.id,code:period.code,status:period.status,revision:period.revision,dateFrom:key(from),dateTo:key(to)},team:{id:team.orgUnitId,code:team.orgUnit.code,name:team.name,siteId:team.siteId},roster,schedules:scheduleSources,raw:rawSources,processing:relevantRaw.map(r=>({id:r.id,state:r.processing?.state??"WAITING",scheduleId:r.processing?.scheduleId??null,workDate:r.processing?.workDate?key(r.processing.workDate):null,periodId:r.processing?.periodId??null,reason:r.processing?.reason??null})),days:rows,overtime:otRows,requests,leaves:leaves.map(l=>({id:l.id,employeeId:l.employeeId,status:l.status,revision:l.revision,snapshot:l.snapshot})),corrections:corrections.map(c=>({id:c.id,status:c.status,revision:c.revision,kind:c.kind,reason:c.reason,evidenceReference:c.evidenceReference,incidentReference:c.incidentReference,appliedOrder:c.appliedOrder?.toString()??null,items:c.items,evidence:c.evidence})),rules:[...rules],coverageId:coverage?.id??null,collectionHash};
    const sourceHash=hash({...data,period:{id:data.period.id,code:data.period.code,dateFrom:data.period.dateFrom,dateTo:data.period.dateTo}}),latest=history[0];
    const sourceBlockers=blockers.filter(blocker=>!["PERIOD_NOT_OPEN","PERIOD_FROZEN"].includes(blocker.code));
    const state=latest?(latest.sourceHash===sourceHash&&!sourceBlockers.length?"CONFIRMED":"STALE"):"WAITING";
    const summary={employees:people.length,scheduledDays:targetSchedules.length,processedDays:rows.filter(r=>r.status!=="UNPROCESSED").length,workedMinutes:rows.reduce((n,r)=>n+r.workedMinutes,0),workUnits:rows.reduce((n,r)=>n+Number(r.workUnits),0),leaveMinutes:rows.reduce((n,r)=>n+r.leave.minutes,0),approvedLeaveRequests:leaves.filter(l=>l.status==="APPROVED").length,overtimeApprovedMinutes:otRows.reduce((n,r)=>n+r.approvedMinutes,0),overtimeActualMinutes:otRows.reduce((n,r)=>n+r.actualMinutes,0),overtimeEligibleMinutes:otRows.reduce((n,r)=>n+r.eligibleMinutes,0),blockers:blockers.length,warnings:warnings.length};
    return { period: data.period, corrections: data.corrections, team:data.team,sourceHash,revision:latest?.revision??0,state,canConfirm:!blockers.length&&state!=="CONFIRMED",summary,blockers,warnings,days:rows,overtime:otRows,leaves:data.leaves.map(l=>({id:l.id,employeeId:l.employeeId,status:l.status,revision:l.revision})),collection:{from:collectionFrom.toISOString(),until:collectionUntil.toISOString(),sourceHash:collectionHash,requiredBatchIds:rawBatchIds,batches},coverage:coverage?{id:coverage.id,revision:coverage.revision,valid:coverageValid,sourceHash:coverage.sourceHash,coveredFrom:coverage.coveredFrom.toISOString(),coveredUntil:coverage.coveredUntil.toISOString(),reference:coverage.reference,reason:coverage.reason,batchIds:coverage.batchIds,actor:coverage.actor,createdAt:coverage.createdAt.toISOString()}:null,history:history.map(h=>({id:h.id,revision:h.revision,sourceHash:h.sourceHash,actor:h.actor,confirmedAt:h.confirmedAt.toISOString(),note:h.note,current:h.id===latest.id&&state==="CONFIRMED"})),snapshot:{...data,summary,accessItems} };
  }
  async coverage(user:AuthUser,d:SourceCoverageDto,ip?:string) {
    if(!user.roles.includes("AD"))throw new ForbiddenException("Chỉ AD xác nhận căn cứ đủ nguồn.");
    return this.transaction(async db=>{
      const review=await this.build(db,user,d,"attendance.import");
      if(review.period.status!=="OPEN"||review.blockers.some(b=>b.code==="PERIOD_FROZEN"))throw new ConflictException("Kỳ chưa mở hoặc đã chốt/khóa.");
      if((review.coverage?.revision??0)!==d.revision||review.collection.sourceHash!==d.sourceHash)throw new ConflictException("Nguồn hoặc căn cứ đã thay đổi; tải lại trước khi xác nhận đủ nguồn.");
      const from=new Date(d.coveredFrom),until=new Date(d.coveredUntil);
      if(from>new Date(review.collection.from)||until<new Date(review.collection.until)||until<from||until>new Date())throw new BadRequestException("Khoảng bao phủ phải đủ toàn bộ cửa sổ ca/OT và không ở tương lai.");
      if(!review.collection.requiredBatchIds.every(id=>d.batchIds.includes(id))||d.batchIds.some(id=>!review.collection.batches.some(b=>b.id===id&&b.status!=="REJECTED")))throw new BadRequestException("Chọn đầy đủ các lô nguồn liên quan, không dùng lô từ chối/ngoài cơ sở/kỳ.");
      const entry=await db.attendanceSourceCoverage.create({data:{periodId:d.periodId,teamOrgUnitId:d.teamOrgUnitId,revision:d.revision+1,sourceHash:d.sourceHash,coveredFrom:from,coveredUntil:until,reference:d.reference.trim(),reason:d.reason.trim(),batchIds:d.batchIds,snapshot:json({collection:review.collection,accessItems:review.snapshot.accessItems}),actorId:user.id}});
      await this.audit.record({actorId:user.id,entityType:"attendance_source_coverage",entityId:entry.id,action:"ATTEST",result:"SUCCESS",newValue:json({periodId:d.periodId,teamOrgUnitId:d.teamOrgUnitId,revision:entry.revision,reference:entry.reference,coveredFrom:from,coveredUntil:until,batchIds:d.batchIds,sourceHash:d.sourceHash}),ipAddress:ip},db);
      return {id:entry.id,revision:entry.revision};
    });
  }
  async confirm(user:AuthUser,d:TeamConfirmationDto,ip?:string) {
    if(!user.roles.includes("TT"))throw new ForbiddenException("Chỉ TT được xác nhận công tổ.");
    return this.transaction(async db=>{
      const review=await this.build(db,user,d,"attendance.confirm");
      if(review.revision!==d.revision||review.sourceHash!==d.sourceHash)throw new ConflictException("Nguồn công/phiên bản đã thay đổi; tải lại và rà soát lại trước khi xác nhận.");
      if(!review.canConfirm)throw new ConflictException(review.state==="CONFIRMED"?"Tổ đã xác nhận đúng phiên bản nguồn này.":"Chưa đủ căn cứ xác nhận công tổ: "+review.blockers.map(b=>b.message).slice(0,5).join(" "));
      if(review.warnings.length&&!d.acknowledgeWarnings)throw new BadRequestException("Phải xác nhận đã rà soát các cảnh báo trước khi xác nhận công tổ.");
      const entry=await db.attendanceTeamConfirmation.create({data:{periodId:d.periodId,teamOrgUnitId:d.teamOrgUnitId,revision:d.revision+1,sourceHash:d.sourceHash,snapshot:json({...review.snapshot,warnings:review.warnings,reviewed:true,acknowledgeWarnings:d.acknowledgeWarnings}),note:d.note?.trim()??"",actorId:user.id}});
      await this.audit.record({actorId:user.id,entityType:"attendance_team_confirmation",entityId:entry.id,action:"CONFIRM",result:"SUCCESS",newValue:json({periodId:d.periodId,teamOrgUnitId:d.teamOrgUnitId,revision:entry.revision,sourceHash:d.sourceHash,summary:review.summary,note:entry.note}),ipAddress:ip},db);
      return {id:entry.id,revision:entry.revision,sourceHash:entry.sourceHash,confirmedAt:entry.confirmedAt.toISOString()};
    });
  }
}
