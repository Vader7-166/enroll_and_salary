import { ForbiddenException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { AuthUser } from "../auth/auth.types";
import { businessDate } from "../auth/business-date";
import { effectiveAt, ScopeService } from "../organization/scope.service";
const actor = { id: true, displayName: true } as const;
export const correctionInclude = {
  createdBy: { select: actor }, decidedBy: { select: actor },
  items: { include: { employee: { select: { id: true, code: true, fullName: true } }, orgUnit: { select: { code: true } } }, orderBy: [{ workDate: "asc" as const }, { employeeId: "asc" as const }] },
  evidence: { select: { id: true, fileName: true, contentType: true, size: true, sha256: true, createdAt: true, uploadedBy: { select: actor } }, orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }] },
  history: { include: { actor: { select: actor } }, orderBy: [{ occurredAt: "asc" as const }, { id: "asc" as const }] },
} satisfies Prisma.AttendanceCorrectionInclude;
export type CorrectionRecord = Prisma.AttendanceCorrectionGetPayload<{ include: typeof correctionInclude }>;
export const correctionKey = (d: Date) => d.toISOString().slice(0, 10);
export function correctionView(r: CorrectionRecord) {
  return { id: r.id, periodId: r.periodId, kind: r.kind, status: r.status, revision: r.revision, reason: r.reason,
    evidenceReference: r.evidenceReference, incidentReference: r.incidentReference, warnings: r.warnings,
    createdBy: r.createdBy, createdAt: r.createdAt.toISOString(), submittedAt: r.submittedAt?.toISOString() ?? null,
    decidedBy: r.decidedBy, decidedAt: r.decidedAt?.toISOString() ?? null, decisionReason: r.decisionReason,
    items: r.items.map(i => ({ id: i.id, employee: i.employee, orgUnitId: i.orgUnitId, orgUnitCode: i.orgUnit.code, workDate: correctionKey(i.workDate), intervals: i.intervals, excuseLateEarly: i.excuseLateEarly, before: i.beforeSnapshot, after: i.afterSnapshot })),
    evidence: r.evidence.map(e => ({ ...e, createdAt: e.createdAt.toISOString() })),
    history: r.history.map(h => ({ id: h.id, action: h.action, actor: h.actor, occurredAt: h.occurredAt.toISOString(), reason: h.reason, oldValue: h.oldValue, newValue: h.newValue })),
  };
}
export type CorrectionAccessItem = { employeeId: string; orgUnitId: string; workDate: Date; sourceDates: Date[] };
export async function correctionAccess(db: Prisma.TransactionClient, scope: ScopeService, user: AuthUser, items: CorrectionAccessItem[], permission = "attendance.read") {
  const current = await scope.load(user, permission, db);
  const employees = await db.employee.findMany({ where: { id: { in: [...new Set(items.map(i => i.employeeId))] } }, select: { id: true, assignments: { where: { isPrimary: true } }, exclusions: { where: { userAccountId: user.id } } } });
  const employeeMap = new Map(employees.map(e => [e.id, e]));
  const dated = new Map<string, Awaited<ReturnType<ScopeService["load"]>>>();
  const active = (r: { effectiveFrom: Date; effectiveTo: Date | null }, d: Date) => r.effectiveFrom <= d && (!r.effectiveTo || r.effectiveTo >= d);
  for (const item of items) {
    const e = employeeMap.get(item.employeeId), today = businessDate();
    if (!e || !current.allowed.has(item.orgUnitId) || !e.assignments.some(a => current.allowed.has(a.orgUnitId) && active(a, today)) || e.exclusions.some(x => active(x, today))) throw new ForbiddenException("Nhân sự ngoài phạm vi hiện tại hoặc thuộc danh sách loại trừ.");
    for (const day of [item.workDate, ...item.sourceDates]) {
      const k = correctionKey(day); let s = dated.get(k);
      if (!s) { s = await scope.load(user, permission, db, day); dated.set(k, s); }
      if (!s.allowed.has(item.orgUnitId) || !e.assignments.some(a => a.orgUnitId === item.orgUnitId && active(a, day)) || e.exclusions.some(x => active(x, day))) throw new ForbiddenException("Nhân sự hoặc đơn vị ngoài phạm vi tại ngày công/ngày nguồn.");
    }
  }
}
export async function visibleCorrectionViews(db: Prisma.TransactionClient, scope: ScopeService, user: AuthUser, employeeId: string, orgUnitId: string, workDate: Date) {
  const rows = await db.attendanceCorrection.findMany({ where: { items: { some: { employeeId, orgUnitId, workDate } } }, include: correctionInclude, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  const views = [];
  for (const row of rows) {
    try { await correctionAccess(db, scope, user, row.items); views.push(correctionView(row)); }
    catch (error) { if (!(error instanceof ForbiddenException)) throw error; }
  }
  return views;
}
