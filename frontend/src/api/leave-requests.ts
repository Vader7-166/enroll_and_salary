import { api } from "./client";
export interface LeaveRequestInput {
 employeeId:string; leaveTypeId:string; dateFrom:string; dateTo:string;
 unit:"DAY"|"HALF"|"HOUR"; half?:"FIRST"|"SECOND"; startAt?:string; endAt?:string;
 reason:string; documentReference?:string;
}
export interface LeaveRequestPreview {
 employee:{id:string;code:string;fullName:string}; leaveType:{id:string;code:string;name:string};
 lines:Array<{workDate:string;scheduleId:string;orgUnitId:string;shiftCode:string;startAt:string;endAt:string;minutes:number;workMinutes:number;days:string;typeVersionId:string;deductsAnnualQuota:boolean;requiresDocument:boolean}>;
 totalDays:string;totalMinutes:number;balances:Array<{year:number;requestedDays:string;availableDays:string}>;warnings:string[];
}
export interface LeaveRequestView extends LeaveRequestInput {
 id:string;status:"DRAFT"|"PENDING";revision:number;preview:LeaveRequestPreview;
 createdById:string;submittedAt:string|null;createdAt:string;updatedAt:string;
}
export interface LeaveRequestHistory {
 id:string;action:string;revision:number;occurredAt:string;actor:{id:string;displayName:string};snapshot:LeaveRequestView;
}
export const leaveRequestsApi = {
 list:(search:string,status:string,page:number)=>api<{items:LeaveRequestView[];total:number}>("/api/leave/requests?"+new URLSearchParams({search,...(status?{status}:{}),page:String(page),pageSize:"20"})),
 detail:(id:string)=>api<{item:LeaveRequestView;history:LeaveRequestHistory[]}>("/api/leave/requests/"+id),
 create:(input:LeaveRequestInput)=>api<{item:LeaveRequestView}>("/api/leave/requests",{method:"POST",body:JSON.stringify(input)}),
 update:(id:string,input:LeaveRequestInput & {revision:number})=>api<{item:LeaveRequestView}>("/api/leave/requests/"+id+"/update",{method:"POST",body:JSON.stringify(input)}),
 submit:(id:string,revision:number)=>api<{item:LeaveRequestView}>("/api/leave/requests/"+id+"/submit",{method:"POST",body:JSON.stringify({revision})}),
};
