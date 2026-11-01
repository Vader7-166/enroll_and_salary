import { api, ApiError } from "./client";

export type SiBenefitType = "SICK" | "CHILD_SICK" | "MATERNITY" | "PRENATAL" | "RECOVERY";
export interface SiBenefitRecord {
  id: string; employee: { id: string; code: string; fullName: string }; benefitType: SiBenefitType; benefitLabel: string; documentNumber: string; facility: string; dateFrom: string; dateTo: string;
  estimateStatus: "ESTIMATED" | "NOT_ELIGIBLE" | "INSUFFICIENT_DATA"; estimate: { label: string; days: number; base: string | null; daily: string | null; amount: string | null; reason: string | null; contributionMonths: number; baseMonths: string[] };
  paidAmount: string | null; paidDate: string | null; paidReference: string | null; difference: string | null; revision: number; evidence: { fileName: string; size: number };
}
export interface AbsenceBucket { planned: number; absent: string; rate: string; warning: boolean }
export interface AbsenceRate {
  workshop: { id: string; code: string; name: string }; threshold: string; total: AbsenceBucket;
  byTeam: Array<AbsenceBucket & { orgUnitId: string; code: string; name: string }>; byDay: Array<AbsenceBucket & { workDate: string }>;
  cells: Array<AbsenceBucket & { orgUnitId: string; workDate: string }>; byType: Array<{ code: string; name: string; days: string }>;
}
export const siBenefitApi = {
  list: (year?: number) => api<{ items: SiBenefitRecord[] }>("/api/leave/sickness-maternity" + (year ? "?year=" + year : "")),
  create: (form: FormData) => api<{ record: SiBenefitRecord }>("/api/leave/sickness-maternity", { method: "POST", body: form }),
  pay: (record: SiBenefitRecord, body: { amount: string; paidDate: string; reference: string }) => api<{ record: SiBenefitRecord }>("/api/leave/sickness-maternity/" + record.id + "/payment", { method: "POST", body: JSON.stringify({ revision: record.revision, ...body }) }),
  evidence: async (record: SiBenefitRecord) => {
    const response = await fetch("/api/leave/sickness-maternity/" + record.id + "/evidence", { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) throw new ApiError(response.status, "DOWNLOAD_FAILED", "Không tải được chứng từ.");
    return response.blob();
  },
  absence: (workshopOrgUnitId: string, dateFrom: string, dateTo: string) => api<AbsenceRate>("/api/leave/absence-rate?" + new URLSearchParams({ workshopOrgUnitId, dateFrom, dateTo })),
};
