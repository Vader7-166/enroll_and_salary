import { Prisma, SalaryBasis } from "@prisma/client";
import Decimal from "decimal.js";
import { plainText } from "../common/data-crypto";
import { effectiveAt } from "../organization/scope.service";

type Db = Prisma.TransactionClient;
const DAY = 86_400_000;
const FAR = new Date("9999-12-31T00:00:00.000Z");
const REGION_RANK: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4 };
export const key = (date: Date) => date.toISOString().slice(0, 10);
const max = (left: Date, right: Date) => left > right ? left : right;
const min = (left: Date, right: Date) => left < right ? left : right;

export interface SalarySegment {
  componentId: string | null; componentCode: string | null; componentName: string;
  from: string; to: string; amount: string; salaryBasis: SalaryBasis;
  source: "CONTRACT" | "DECISION"; sourceId: string; reference: string;
}
export interface UnitSegment {
  orgUnitId: string; orgUnitCode: string; orgUnitName: string; siteId: string | null; siteOrgUnitId: string | null;
  wageRegionCode: string | null; costCenterCode: string | null; from: string; to: string; days: number;
}
type Candidate = Omit<SalarySegment, "from" | "to"> & { start: Date; end: Date; priority: number };

/**
 * Non-overlapping salary segments per component in [from, to]. The agreed salary (componentId null)
 * starts from active contracts; any decision or later contract covering a day overrides an earlier one.
 */
export async function salaryTimeline(db: Db, cryptoKey: Buffer, employeeId: string, from: Date, to: Date): Promise<SalarySegment[]> {
  const [contracts, rows] = await Promise.all([
    db.employmentContract.findMany({ where: { employeeId, status: "ACTIVE", startDate: { lte: to }, OR: [{ endDate: null }, { endDate: { gte: from } }] }, orderBy: { startDate: "asc" } }),
    db.employeeSalary.findMany({ where: { employeeId, effectiveFrom: { lte: to }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }] }, include: { decision: { select: { decisionNumber: true } } }, orderBy: { effectiveFrom: "asc" } }),
  ]);
  const componentIds = [...new Set(rows.map(row => row.componentId).filter((id): id is string => id !== null))];
  const components = await db.salaryComponent.findMany({ where: { id: { in: componentIds } }, include: { versions: { orderBy: { effectiveFrom: "desc" } } } });
  const componentById = new Map(components.map(component => [component.id, component]));
  const candidates: Candidate[] = [
    ...contracts.map(contract => ({ componentId: null, componentCode: null, componentName: "Lương thỏa thuận", amount: plainText(cryptoKey, contract.salaryCipher), salaryBasis: contract.salaryBasis,
      source: "CONTRACT" as const, sourceId: contract.id, reference: contract.number, start: contract.startDate, end: contract.endDate ?? FAR, priority: 0 })),
    ...rows.map(row => {
      const component = row.componentId ? componentById.get(row.componentId) : undefined;
      const version = component?.versions.find(item => item.effectiveFrom <= row.effectiveFrom) ?? component?.versions.at(-1);
      return { componentId: row.componentId, componentCode: component?.code ?? null, componentName: row.componentId ? version?.name ?? "Cấu phần" : "Lương thỏa thuận", amount: plainText(cryptoKey, row.amountCipher),
        salaryBasis: row.salaryBasis, source: "DECISION" as const, sourceId: row.decisionId, reference: row.decision.decisionNumber, start: row.effectiveFrom, end: row.effectiveTo ?? FAR, priority: 1 };
    }),
  ];
  const segments: SalarySegment[] = [];
  const groups = new Map<string, Candidate[]>();
  for (const candidate of candidates) groups.set(candidate.componentId ?? "", [...(groups.get(candidate.componentId ?? "") ?? []), candidate]);
  for (const group of groups.values()) {
    const bounds = new Set<number>([from.getTime(), to.getTime() + DAY]);
    for (const candidate of group) {
      if (candidate.start > from && candidate.start <= to) bounds.add(candidate.start.getTime());
      if (candidate.end >= from && candidate.end < to) bounds.add(candidate.end.getTime() + DAY);
    }
    const points = [...bounds].sort((left, right) => left - right);
    for (let index = 0; index + 1 < points.length; index += 1) {
      const start = new Date(points[index]), end = new Date(points[index + 1] - DAY);
      const winner = group.filter(item => item.start <= start && item.end >= start)
        .sort((left, right) => right.start.getTime() - left.start.getTime() || right.priority - left.priority)[0];
      if (!winner) continue;
      const { start: _start, end: _end, priority: _priority, ...value } = winner;
      const last = segments.at(-1);
      if (last && last.sourceId === value.sourceId && last.componentId === value.componentId && key(new Date(Date.parse(last.to) + DAY)) === key(start)) last.to = key(end);
      else segments.push({ ...value, from: key(max(start, from)), to: key(min(end, to)) });
    }
  }
  return segments.sort((left, right) => (left.componentCode ?? "").localeCompare(right.componentCode ?? "") || left.from.localeCompare(right.from));
}

/** Agreed (contract) salary in force on one day, or null when no contract or decision covers it. */
export async function agreedSalaryAt(db: Db, cryptoKey: Buffer, employeeId: string, day: Date) {
  return (await salaryTimeline(db, cryptoKey, employeeId, day, day)).find(segment => segment.componentId === null) ?? null;
}

async function costCenter(db: Db, orgUnitId: string, at: Date): Promise<string | null> {
  const seen = new Set<string>();
  for (let cursor: string | null = orgUnitId; cursor && !seen.has(cursor);) {
    seen.add(cursor);
    const version: { costCenterCode: string | null; parentId: string | null } | null = await db.orgUnitVersion.findFirst({ where: { orgUnitId: cursor, ...effectiveAt(at) }, select: { costCenterCode: true, parentId: true } });
    if (!version) return null;
    if (version.costCenterCode) return version.costCenterCode;
    cursor = version.parentId;
  }
  return null;
}

export async function siteOrgUnitIdOf(db: Db, siteId: string | null, at: Date): Promise<string | null> {
  if (!siteId) return null;
  return (await db.orgUnitVersion.findFirst({ where: { siteId, type: "SITE", ...effectiveAt(at) }, select: { orgUnitId: true } }))?.orgUnitId ?? null;
}

/** Primary-assignment unit segments with site, wage region and inherited cost center for cost allocation (FR-2.3.2). */
export async function unitSegments(db: Db, employeeId: string, from: Date, to: Date): Promise<UnitSegment[]> {
  const assignments = await db.orgAssignment.findMany({ where: { employeeId, isPrimary: true, effectiveFrom: { lte: to }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }] }, orderBy: { effectiveFrom: "asc" }, include: { orgUnit: true } });
  const result: UnitSegment[] = [];
  for (const assignment of assignments) {
    const start = max(assignment.effectiveFrom, from), end = min(assignment.effectiveTo ?? FAR, to);
    const version = await db.orgUnitVersion.findFirst({ where: { orgUnitId: assignment.orgUnitId, ...effectiveAt(start) }, include: { site: true } });
    result.push({
      orgUnitId: assignment.orgUnitId, orgUnitCode: assignment.orgUnit.code, orgUnitName: version?.name ?? assignment.orgUnit.code,
      siteId: version?.siteId ?? null, siteOrgUnitId: await siteOrgUnitIdOf(db, version?.siteId ?? null, start), wageRegionCode: version?.site?.wageRegionCode ?? null,
      costCenterCode: await costCenter(db, assignment.orgUnitId, start), from: key(start), to: key(end), days: Math.round((end.getTime() - start.getTime()) / DAY) + 1,
    });
  }
  return result;
}

async function regionOf(db: Db, orgUnitId: string, at: Date): Promise<string | null> {
  return (await db.orgUnitVersion.findFirst({ where: { orgUnitId, ...effectiveAt(at) }, include: { site: true } }))?.site?.wageRegionCode ?? null;
}

/**
 * BR-08: moving to a lower wage region together with a lower agreed salary on the same day needs an
 * explicit, reasoned confirmation. Returns the warning payload or null.
 */
export async function crossRegionDecrease(db: Db, cryptoKey: Buffer, input: { employeeId: string; day: Date; fromOrgUnitId: string; toOrgUnitId: string; newAgreedAmount?: string | null }) {
  const [fromRegion, toRegion] = await Promise.all([regionOf(db, input.fromOrgUnitId, new Date(input.day.getTime() - DAY)), regionOf(db, input.toOrgUnitId, input.day)]);
  if (!fromRegion || !toRegion || REGION_RANK[toRegion] <= REGION_RANK[fromRegion]) return null;
  const before = await agreedSalaryAt(db, cryptoKey, input.employeeId, new Date(input.day.getTime() - DAY));
  const after = input.newAgreedAmount ?? (await agreedSalaryAt(db, cryptoKey, input.employeeId, input.day))?.amount ?? null;
  if (!before || !after || !new Decimal(after).lt(before.amount)) return null;
  return { code: "CROSS_REGION_SALARY_DECREASE", fromRegion, toRegion, previousAmount: before.amount, newAmount: after, effectiveFrom: key(input.day) };
}
