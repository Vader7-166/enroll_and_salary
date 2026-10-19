import { ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import Decimal from "decimal.js";
import { createHash, randomUUID } from "node:crypto";
import type { AuthUser } from "../auth/auth.types";
import { leaveDate } from "./leave-access.service";
import type { LeaveRequestPreview } from "./leave-requests.service";
type Db = Prisma.TransactionClient;
export async function applyLeaveUsage(db: Db, user: AuthUser, requestId: string, revision: number, preview: LeaveRequestPreview, refund: boolean, reason: string) {
  const operations: string[] = [];
  const write = async (balanceId: string, bucket: string, expiresAt: Date|null, days: Decimal, effectiveDate: Date, sourceEntryId?: string) => {
    const kind = refund ? "REFUND" : "USE";
    const operation = await db.leaveOperation.create({data:{requestId:randomUUID(),leaveRequestId:requestId,requestHash:createHash("sha256").update(requestId+":"+revision+":"+kind+":"+balanceId+":"+bucket+":"+effectiveDate.toISOString()+":"+(sourceEntryId??"")).digest("hex"),kind,effectiveDate,reason,reference:"Đơn nghỉ "+requestId,snapshot:{requestId,revision,sourceEntryId:sourceEntryId??null},actorId:user.id}});
    await db.leaveLedgerEntry.create({data:{balanceId,operationId:operation.id,kind,bucket,expiresAt,days:days.toFixed(2)}});
    await db.leaveBalance.update({where:{id:balanceId},data:{revision:{increment:1}}});
    operations.push(operation.id);
  };
  if (refund) {
    const entries = await db.leaveLedgerEntry.findMany({where:{kind:"USE",operation:{leaveRequestId:requestId}},include:{operation:true}});
    for (const entry of entries) await write(entry.balanceId,entry.bucket,entry.expiresAt,new Decimal(entry.days.toString()).negated(),entry.operation.effectiveDate,entry.id);
  } else {
    for (const line of preview.lines.filter(l=>l.deductsAnnualQuota&&!l.holiday)) {
      const date = leaveDate(line.workDate), year = date.getUTCFullYear();
      const balance = await db.leaveBalance.findUnique({where:{employeeId_year:{employeeId:preview.employee.id,year}},include:{entries:{include:{operation:true}}}});
      if (!balance) throw new ConflictException("Chưa có quỹ phép năm "+year+".");
      let remaining = new Decimal(line.days);
      const groups = new Map<string,{bucket:string;expiresAt:Date|null}>();
      for (const entry of balance.entries) groups.set(entry.bucket+":"+(entry.expiresAt?.toISOString()??""),{bucket:entry.bucket,expiresAt:entry.expiresAt});
      const candidates = [...groups.values()].filter(g=>!g.expiresAt||g.expiresAt>=date).sort((a,b)=>(a.expiresAt?.getTime()??Infinity)-(b.expiresAt?.getTime()??Infinity)||["CARRY","ADVANCE","ANNUAL"].indexOf(a.bucket)-["CARRY","ADVANCE","ANNUAL"].indexOf(b.bucket));
      for (const group of candidates) {
        const entries = balance.entries.filter(e=>e.bucket===group.bucket&&e.expiresAt?.getTime()===group.expiresAt?.getTime());
        // Protect all later debits/transfers, including already approved future leave.
        const boundaries = [date,...balance.entries.map(e=>e.operation.effectiveDate).filter(d=>d>=date&&(!group.expiresAt||d<=group.expiresAt))];
        const minimum = boundaries.reduce((value,at)=>Decimal.min(value,entries.filter(e=>e.operation.effectiveDate<=at).reduce((sum,e)=>sum.plus(e.days.toString()),new Decimal(0))),new Decimal(Infinity));
        const take = Decimal.min(remaining,Decimal.max(0,minimum));
        if (take.gt(0)) { await write(balance.id,group.bucket,group.expiresAt,take.negated(),date); remaining=remaining.minus(take); }
        if (remaining.isZero()) break;
      }
      if (remaining.gt(0)) throw new ConflictException("Quỹ phép không đủ tại "+line.workDate+" hoặc đã dùng cho đơn/chuyển phép về sau.");
    }
  }
  return {operations};
}
