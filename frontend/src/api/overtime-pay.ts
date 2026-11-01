import { api } from "./client";

export type OvertimeDayType = "THUONG" | "NGHI_TUAN" | "LE_TET";
export interface OvertimeRateBreakdown {
  dayType: OvertimeDayType;
  isNight: boolean;
  hasDayOt: boolean;
  dayRate: string;
  nightAllowance: string;
  addonRate: string;
  daytimeRate: string;
  formula: string;
  parameters: Array<{ id: string; paramCode: string; scopeKey: string; effectiveFrom: string; value: string }>;
}
export interface OvertimePayBucket {
  employeeId: string;
  employee: { id: string; code: string; fullName: string };
  orgUnitId: string;
  workDate: string;
  kind: "OT" | "NIGHT_REGULAR";
  dayType: OvertimeDayType;
  isNight: boolean;
  hasDayOt: boolean;
  minutes: string;
  rate: string;
  rateBreakdown: OvertimeRateBreakdown;
  sourceStatus: "DRAFT" | "LOCKED";
  sourceHash: string;
}
export interface OvertimePayError { code: string; message: string; paramCodes: string[]; employeeId: string; orgUnitId: string; workDate: string }
export interface OvertimePayBuckets {
  period: { id: string; code: string; status: string; dateFrom: string; dateTo: string };
  sourceStatus: "DRAFT" | "LOCKED";
  sourceHash: string;
  materialized: boolean;
  items: OvertimePayBucket[];
  errors: OvertimePayError[];
}

export const overtimePayApi = {
  buckets: (periodId: string, orgUnitId?: string) =>
    api<OvertimePayBuckets>("/api/overtime-pay/buckets?" + new URLSearchParams({ periodId, ...(orgUnitId ? { orgUnitId } : {}) }).toString()),
};
