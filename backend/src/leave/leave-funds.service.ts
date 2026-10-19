import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import Decimal from "decimal.js";
import { createHash } from "node:crypto";
import { AuditService, canonicalJson } from "../audit/audit.service";
import type { AuthUser } from "../auth/auth.types";
import { businessDate } from "../auth/business-date";
import { PrismaService } from "../database/prisma.service";
import { effectiveAt } from "../organization/scope.service";
import { LeaveAccessService, leaveDate, leaveDateText } from "./leave-access.service";
import { LeaveCatalogService } from "./leave-catalog.service";
import { carryExpiry, daysText, entitlementCalculation, fundTotals, spendableAnnual, type EntitlementMonth, type LeaveEntitlementCalculation } from "./leave-fund-engine";
import { AdjustLeaveDto, LeaveFundActionDto, LeaveFundQueryDto, RecalculateLeaveDto, TransferLeaveDto } from "./leave-funds.dto";

type Db = Prisma.TransactionClient;
const includeBalance = {
  entries: { include: { operation: { include: { actor: { select: { id: true, displayName: true } } } } }, orderBy: [{ operation: { sequence: "asc" as const } }, { id: "asc" as const }] },
} satisfies Prisma.LeaveBalanceInclude;
type Balance = Prisma.LeaveBalanceGetPayload<{ include: typeof includeBalance }>;
type Employee = Prisma.EmployeeGetPayload<{ include: { assignments: true; exclusions: true } }>;
type Calculation = LeaveEntitlementCalculation;
type QualificationRange = { from: Date; to: Date };
type EmployeeIdentity = Pick<Employee, "id" | "code" | "fullName" | "hireDate" | "terminationDate">;
const personSelect = { id: true, code: true, fullName: true, hireDate: true, terminationDate: true, status: true } as const;
function employeeView(employee: EmployeeIdentity) {
  return { id: employee.id, code: employee.code, fullName: employee.fullName, hireDate: leaveDateText(employee.hireDate), terminationDate: employee.terminationDate ? leaveDateText(employee.terminationDate) : null };
}
function fundYear(value: number) {
  if (!Number.isInteger(value) || value < 1900 || value > 2200) throw new BadRequestException("Năm quỹ phép phải từ 1900 đến 2200.");
  return value;
}
function referenceDate(employee: Pick<Employee, "hireDate" | "terminationDate">, year: number) {
  const start = new Date(Date.UTC(year, 0, 1)), end = new Date(Date.UTC(year, 11, 31)), today = businessDate();
  if (employee.hireDate > end || (employee.terminationDate && employee.terminationDate < start)) throw new BadRequestException("Nhân sự không có thời gian làm việc trong năm quỹ phép.");
  return new Date(Math.max(employee.hireDate.getTime(), start.getTime(), Math.min(today.getTime(), end.getTime(), employee.terminationDate?.getTime() ?? Infinity)));
}
function collectCalculationDates(value: Prisma.JsonValue, dates: Set<string>, ranges: Map<string, QualificationRange>) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  if (Array.isArray(value.accessDates)) for (const date of value.accessDates) if (typeof date === "string") dates.add(date);
  if (typeof value.year === "number" && typeof value.effectiveDate === "string" && typeof value.hireDate === "string" && Array.isArray(value.eligibleMonths)) {
    for (const month of value.eligibleMonths) {
      if (typeof month !== "number") continue;
      const from = new Date(Math.max(Date.UTC(value.year, month - 1, 1), leaveDate(value.hireDate).getTime()));
      const to = new Date(Math.min(Date.UTC(value.year, month, 0), leaveDate(value.effectiveDate).getTime(), typeof value.terminationDate === "string" ? leaveDate(value.terminationDate).getTime() : Infinity));
      ranges.set(`${leaveDateText(from)}/${leaveDateText(to)}`, { from, to });
    }
  }
  for (const key of ["calculation", "previousCalculation", "before", "targetBefore"]) if (value[key] !== undefined) collectCalculationDates(value[key]!, dates, ranges);
}
function calculationDates(balance: Balance | null) {
  const dates = new Set<string>(), ranges = new Map<string, QualificationRange>();
  collectCalculationDates(balance?.calculation ?? null, dates, ranges);
  for (const entry of balance?.entries ?? []) {
    dates.add(leaveDateText(entry.operation.effectiveDate));
    collectCalculationDates(entry.operation.snapshot, dates, ranges);
  }
  return { dates: [...dates].map(leaveDate), ranges: [...ranges.values()] };
}
function fundView(employee: EmployeeIdentity, year: number, balance: Balance | null, asOf: Date) {
  const entries = balance?.entries.filter(entry => entry.operation.effectiveDate <= asOf) ?? [];
  const calculated = entries.filter(entry => entry.kind === "ENTITLEMENT" || entry.kind === "RECALCULATION").at(-1);
  const snapshot = calculated?.operation.snapshot as { calculation?: Calculation } | undefined;
  return {
    id: balance?.id ?? null, employee: employeeView(employee), year, revision: balance?.revision ?? 0, asOf: leaveDateText(asOf),
    ...fundTotals(entries, year, asOf), calculation: snapshot?.calculation ?? null,
    entries: [...entries].reverse().map(entry => ({ id: entry.id, kind: entry.kind, bucket: entry.bucket, days: daysText(entry.days.toString()), expiresAt: entry.expiresAt ? leaveDateText(entry.expiresAt) : null,
      operation: { id: entry.operation.id, kind: entry.operation.kind, effectiveDate: leaveDateText(entry.operation.effectiveDate), reason: entry.operation.reason, reference: entry.operation.reference, createdAt: entry.operation.createdAt.toISOString(), actor: entry.operation.actor, snapshot: entry.operation.snapshot } })),
  };
}
function fundSnapshot(balance: Balance) {
  return { id: balance.id, employeeId: balance.employeeId, year: balance.year, revision: balance.revision, calculation: balance.calculation, ...fundTotals(balance.entries, balance.year, businessDate()) };
}

@Injectable()
export class LeaveFundsService {
  constructor(private readonly prisma: PrismaService, private readonly access: LeaveAccessService, private readonly catalog: LeaveCatalogService, private readonly audit: AuditService) {}

  private async load(db: Db, employeeId: string, year: number) {
    return db.leaveBalance.findUnique({ where: { employeeId_year: { employeeId, year } }, include: includeBalance });
  }
  private async authorized(db: Db, user: AuthUser, permission: string, employeeId: string, year: number, balance: Balance | null, extraDates: Date[] = []) {
    const employee = await db.employee.findUnique({ where: { id: employeeId }, select: { ...personSelect, assignments: { where: { isPrimary: true } }, exclusions: { where: { userAccountId: user.id } } } });
    if (!employee) throw new ForbiddenException("Nhân sự không tồn tại hoặc ngoài phạm vi quỹ phép.");
    const saved = calculationDates(balance);
    await this.qualificationAccessDates(db, user, permission, employee, saved.ranges, [referenceDate(employee, year), ...saved.dates, ...extraDates]);
    return employee;
  }
  private async qualificationAccessDates(db: Db, user: AuthUser, permission: string, employee: Pick<Employee, "id" | "assignments" | "exclusions">, ranges: QualificationRange[], dates: Date[]) {
    const points = new Map<string, Date>([...dates, ...ranges.flatMap(range => [range.from, range.to])].map(date => [leaveDateText(date), date]));
    if (ranges.length) {
      const start = new Date(Math.min(...ranges.map(range => range.from.getTime()))), end = new Date(Math.max(...ranges.map(range => range.to.getTime())));
      const [organizationDates, roleDates] = await Promise.all([
        db.orgUnitVersion.findMany({ where: { effectiveFrom: { lte: end }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: start } }] }, select: { effectiveFrom: true, effectiveTo: true } }),
        db.roleAssignment.findMany({ where: { userAccountId: user.id, effectiveFrom: { lte: end }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: start } }] }, select: { effectiveFrom: true, effectiveTo: true } }),
      ]);
      for (const boundary of [...organizationDates, ...roleDates, ...employee.assignments, ...employee.exclusions]) {
        for (const point of [boundary.effectiveFrom, ...(boundary.effectiveTo ? [new Date(boundary.effectiveTo.getTime() + 86400000)] : [])]) {
          if (ranges.some(range => point >= range.from && point <= range.to)) points.set(leaveDateText(point), point);
        }
      }
    }
    await this.access.assertEmployee(user, permission, employee.id, [...points.values()], db);
    return [...points.keys()].sort();
  }
  private mutationDate(dto: LeaveFundActionDto, year: number) {
    const date = leaveDate(dto.effectiveDate);
    if (date > businessDate() || date.getUTCFullYear() !== year) throw new BadRequestException("Ngày hiệu lực phải thuộc năm thao tác và không ở tương lai.");
    return date;
  }
  private async writableBalance(db: Db, employeeId: string, year: number, revision: number) {
    const existing = await this.load(db, employeeId, year);
    if ((existing?.revision ?? 0) !== revision) throw new ConflictException("Quỹ phép đã thay đổi. Tải lại cả năm nguồn và năm đích trước khi thao tác.");
    return existing ?? db.leaveBalance.create({ data: { employeeId, year }, include: includeBalance });
  }
  private async write<T>(user: AuthUser, employeeId: string, year: number, kind: string, dto: LeaveFundActionDto, callback: (db: Db, hash: string) => Promise<T>) {
    fundYear(year);
    const hash = createHash("sha256").update(canonicalJson({ actorId: user.id, employeeId, year, kind, ...dto })).digest("hex");
    return this.prisma.$transaction(async db => {
      // Shared with catalog writes so calculation cannot race effective policy changes.
      await db.$queryRaw`SELECT pg_advisory_xact_lock(8210490)::text AS lock`;
      const existing = await db.leaveOperation.findUnique({ where: { requestId: dto.requestId }, include: { entries: { include: { balance: true } } } });
      const balance = await this.load(db, employeeId, year);
      const employee = await this.authorized(db, user, "leave.balance.manage", employeeId, year, balance);
      if (existing) {
        if (existing.requestHash !== hash) throw new ConflictException("Mã thao tác đã dùng cho nội dung khác; tạo thao tác mới.");
        const target = existing.entries.find(entry => entry.balance.year !== year)?.balance;
        let targetBalance;
        if (target) {
          const row = await this.load(db, employeeId, target.year);
          await this.authorized(db, user, "leave.balance.manage", employeeId, target.year, row);
          targetBalance = fundView(employee, target.year, row, businessDate());
        }
        const unchanged = existing.snapshot && typeof existing.snapshot === "object" && !Array.isArray(existing.snapshot) && existing.snapshot.unchanged === true;
        return { balance: fundView(employee, year, balance, businessDate()), ...(targetBalance ? { targetBalance } : {}), ...(unchanged ? { unchanged: true } : {}), operationId: existing.id, replayed: true };
      }
      return callback(db, hash);
    }, { timeout: 30000 });
  }
  private async operation(db: Db, user: AuthUser, kind: string, dto: LeaveFundActionDto, hash: string, snapshot: Prisma.InputJsonValue) {
    return db.leaveOperation.create({ data: { requestId: dto.requestId, requestHash: hash, actorId: user.id, kind, effectiveDate: leaveDate(dto.effectiveDate), reason: dto.reason.trim(), reference: dto.reference.trim(), snapshot } });
  }
  private async record(db: Db, user: AuthUser, balanceId: string, kind: string, before: Prisma.InputJsonValue, after: Prisma.InputJsonValue, dto: LeaveFundActionDto, operationId: string, ipAddress?: string) {
    await this.audit.record({ actorId: user.id, entityType: "annual_leave_balance", entityId: balanceId, action: kind, result: "SUCCESS", oldValue: before, newValue: { operationId, reason: dto.reason.trim(), reference: dto.reference.trim(), result: after }, ipAddress }, db);
  }
  private async policyFor(db: Db, employee: { assignments: Employee["assignments"] }, date: Date) {
    const assignment = employee.assignments.find(row => row.effectiveFrom <= date && (!row.effectiveTo || row.effectiveTo >= date));
    if (!assignment) throw new ConflictException("Thiếu phân công chính tại ngày tính quỹ; kiểm tra hồ sơ điều chuyển.");
    return this.catalog.resolvePolicy(db, assignment.orgUnitId, date);
  }

  async employees(user: AuthUser, query: LeaveFundQueryDto) {
    fundYear(query.year);
    const current = await this.access.scoped(user, "leave.balance.read");
    const allowed = new Set(current.allowed);
    if (query.orgUnitId) {
      allowed.clear();
      const pending = current.allowed.has(query.orgUnitId) ? [query.orgUnitId] : [];
      while (pending.length) { const id = pending.pop()!; if (allowed.has(id)) continue; allowed.add(id); pending.push(...current.versions.filter(row => row.parentId === id).map(row => row.orgUnitId)); }
    }
    const today = businessDate(), start = new Date(Date.UTC(query.year, 0, 1)), end = new Date(Date.UTC(query.year, 11, 31));
    const where: Prisma.EmployeeWhereInput = {
      AND: [
        { hireDate: { lte: end }, OR: [{ terminationDate: null }, { terminationDate: { gte: start } }] },
        { exclusions: { none: { userAccountId: user.id, ...effectiveAt(today) } } },
        { OR: [
          { assignments: { some: { isPrimary: true, orgUnitId: { in: [...allowed] }, ...effectiveAt(today) } } },
          { status: "TERMINATED", assignments: { some: { isPrimary: true, orgUnitId: { in: [...allowed] }, effectiveFrom: { lte: today }, effectiveTo: { gte: start } } } },
        ] },
        ...(query.search?.trim() ? [{ OR: [{ code: { contains: query.search.trim(), mode: "insensitive" as const } }, { fullName: { contains: query.search.trim(), mode: "insensitive" as const } }] }] : []),
      ],
    };
    const rows = await this.prisma.employee.findMany({ where, select: { ...personSelect, assignments: { where: { isPrimary: true }, orderBy: { effectiveFrom: "desc" }, select: { orgUnitId: true, effectiveFrom: true, effectiveTo: true } }, exclusions: { where: { userAccountId: user.id }, select: { effectiveFrom: true, effectiveTo: true } } }, orderBy: [{ code: "asc" }, { id: "asc" }] });
    const items = [];
    for (const employee of rows) {
      const date = employee.terminationDate && employee.terminationDate < today ? employee.terminationDate : today;
      const assignment = employee.assignments.find(row => row.effectiveFrom <= date && (!row.effectiveTo || row.effectiveTo >= date));
      if (!assignment || !allowed.has(assignment.orgUnitId) || employee.exclusions.some(row => row.effectiveFrom <= date && (!row.effectiveTo || row.effectiveTo >= date))) continue;
      const unit = current.versions.find(row => row.orgUnitId === assignment.orgUnitId)!;
      items.push({ ...employeeView(employee), status: employee.status, orgUnit: { id: unit.orgUnitId, code: unit.orgUnit.code, name: unit.name } });
    }
    return { items: items.slice((query.page - 1) * query.pageSize, query.page * query.pageSize), total: items.length, page: query.page, pageSize: query.pageSize };
  }
  async list(user: AuthUser, query: LeaveFundQueryDto) {
    fundYear(query.year);
    const current = await this.access.scoped(user, "leave.balance.read");
    const filterUnits = new Set<string>();
    if (query.orgUnitId && current.allowed.has(query.orgUnitId)) {
      filterUnits.add(query.orgUnitId);
      for (let count = -1; count !== filterUnits.size;) { count = filterUnits.size; for (const unit of current.versions) if (unit.parentId && filterUnits.has(unit.parentId)) filterUnits.add(unit.orgUnitId); }
    }
    const asOf = query.asOf ? leaveDate(query.asOf) : businessDate();
    const rows = await this.prisma.leaveBalance.findMany({ where: { year: query.year, ...(query.search?.trim() ? { employee: { OR: [{ code: { contains: query.search.trim(), mode: "insensitive" } }, { fullName: { contains: query.search.trim(), mode: "insensitive" } }] } } : {}) }, include: includeBalance, orderBy: { employee: { code: "asc" } } });
    const visible = [];
    for (const row of rows) {
      try {
        const employee = await this.authorized(this.prisma, user, "leave.balance.read", row.employeeId, query.year, row);
        if (query.orgUnitId) {
          const reference = employee.terminationDate && employee.terminationDate < businessDate() ? employee.terminationDate : businessDate();
          if (!employee.assignments.some(assignment => filterUnits.has(assignment.orgUnitId) && assignment.effectiveFrom <= reference && (!assignment.effectiveTo || assignment.effectiveTo >= reference))) continue;
        }
        visible.push(fundView(employee, query.year, row, asOf));
      } catch (error) { if (!(error instanceof ForbiddenException) && !(error instanceof NotFoundException)) throw error; }
    }
    return { items: visible.slice((query.page - 1) * query.pageSize, query.page * query.pageSize), total: visible.length, page: query.page, pageSize: query.pageSize };
  }
  async detail(user: AuthUser, employeeId: string, year: number, asOf?: string) {
    fundYear(year);
    const balance = await this.load(this.prisma, employeeId, year);
    const employee = await this.authorized(this.prisma, user, "leave.balance.read", employeeId, year, balance);
    return { balance: fundView(employee, year, balance, asOf ? leaveDate(asOf) : businessDate()) };
  }

  async recalculate(user: AuthUser, employeeId: string, year: number, dto: RecalculateLeaveDto, ipAddress?: string) {
    const effectiveDate = this.mutationDate(dto, fundYear(year));
    return this.write(user, employeeId, year, "RECALCULATE", dto, async (db, hash) => {
      const balance = await this.writableBalance(db, employeeId, year, dto.revision);
      const employee = await this.authorized(db, user, "leave.balance.manage", employeeId, year, balance, [effectiveDate]);
      if (effectiveDate < employee.hireDate) throw new BadRequestException("Ngày tính quỹ không được trước ngày vào làm.");
      const monthDates: Date[] = [];
      const ranges: Array<{ from: Date; to: Date }> = [];
      for (const month of [...dto.eligibleMonths].sort((a, b) => a - b)) {
        const from = new Date(Date.UTC(year, month - 1, 1)), to = new Date(Date.UTC(year, month, 0));
        if (from > effectiveDate || to < employee.hireDate || (employee.terminationDate && from > employee.terminationDate)) throw new BadRequestException("Tháng xác nhận phải giao thời gian làm việc và không sau ngày tính quỹ.");
        const end = new Date(Math.min(to.getTime(), effectiveDate.getTime(), employee.terminationDate?.getTime() ?? Infinity));
        monthDates.push(end);
        ranges.push({ from: new Date(Math.max(from.getTime(), employee.hireDate.getTime())), to: end });
      }
      const accessDates = await this.qualificationAccessDates(db, user, "leave.balance.manage", employee, ranges, [effectiveDate]);
      const months: EntitlementMonth[] = [];
      for (const date of monthDates) {
        const policy = await this.policyFor(db, employee, date);
        months.push({ month: date.getUTCMonth() + 1, policyVersionId: policy.id, policyOrgUnitId: policy.policy.orgUnitId, status: policy.status, decisionReference: policy.decisionReference, normalDays: policy.normalDays, hazardousDays: policy.hazardousDays, extremeDays: policy.extremeDays });
      }
      const calculation = entitlementCalculation({ year, hireDate: employee.hireDate, terminationDate: employee.terminationDate, effectiveDate, workingCondition: dto.workingCondition, months, accessDates });
      const before = fundView(employee, year, balance, businessDate());
      if (canonicalJson(balance.calculation) === canonicalJson(calculation)) {
        const unchanged = await this.operation(db, user, "RECALCULATION", dto, hash, { employeeId, year, calculation, unchanged: true });
        return { balance: before, operationId: unchanged.id, unchanged: true };
      }
      const delta = new Decimal(calculation.entitledDays).minus(before.entitledDays);
      if (delta.isNegative() && spendableAnnual(balance.entries, year, effectiveDate, businessDate()).lt(delta.negated())) throw new ConflictException("Tính lại làm giảm phần phép đã chuyển/đã sử dụng hoặc đã ứng từ năm này; cần đối soát trước.");
      const kind = balance.calculation ? "RECALCULATION" : "ENTITLEMENT";
      const operation = await this.operation(db, user, kind, dto, hash, { employeeId, year, calculation, previousCalculation: balance.calculation ?? null });
      await db.leaveLedgerEntry.create({ data: { balanceId: balance.id, operationId: operation.id, kind, bucket: "ANNUAL", days: daysText(delta) } });
      await db.leaveBalance.update({ where: { id: balance.id }, data: { revision: { increment: 1 }, calculation } });
      const afterRow = (await this.load(db, employeeId, year))!;
      const after = fundView(employee, year, afterRow, businessDate());
      await this.record(db, user, balance.id, "RECALCULATE", fundSnapshot(balance), fundSnapshot(afterRow), dto, operation.id, ipAddress);
      return { balance: after, operationId: operation.id, unchanged: false };
    });
  }
  async adjust(user: AuthUser, employeeId: string, year: number, dto: AdjustLeaveDto, ipAddress?: string) {
    const effectiveDate = this.mutationDate(dto, fundYear(year));
    const days = new Decimal(dto.days);
    if (days.isZero()) throw new BadRequestException("Số ngày điều chỉnh phải khác 0.");
    return this.write(user, employeeId, year, "ADJUST", dto, async (db, hash) => {
      const balance = await this.writableBalance(db, employeeId, year, dto.revision);
      const employee = await this.authorized(db, user, "leave.balance.manage", employeeId, year, balance, [effectiveDate]);
      if (days.isNegative() && spendableAnnual(balance.entries, year, effectiveDate, businessDate()).lt(days.negated())) throw new ConflictException("Điều chỉnh giảm vượt phần quỹ năm có thể sử dụng tại ngày hiệu lực hoặc sau đó.");
      const before = fundSnapshot(balance);
      const operation = await this.operation(db, user, "ADJUSTMENT", dto, hash, { employeeId, year, days: daysText(days), before });
      await db.leaveLedgerEntry.create({ data: { balanceId: balance.id, operationId: operation.id, kind: "ADJUSTMENT", bucket: "ANNUAL", days: daysText(days) } });
      await db.leaveBalance.update({ where: { id: balance.id }, data: { revision: { increment: 1 } } });
      const afterRow = (await this.load(db, employeeId, year))!;
      const after = fundView(employee, year, afterRow, businessDate());
      await this.record(db, user, balance.id, "ADJUST", before, fundSnapshot(afterRow), dto, operation.id, ipAddress);
      return { balance: after, operationId: operation.id };
    });
  }
  async transfer(user: AuthUser, employeeId: string, year: number, kind: "CARRY" | "ADVANCE", dto: TransferLeaveDto, ipAddress?: string) {
    fundYear(year); fundYear(year + 1);
    const days = new Decimal(dto.days), effectiveDate = this.mutationDate(dto, kind === "CARRY" ? year + 1 : year);
    if (!days.isPositive()) throw new BadRequestException("Số ngày chuyển/ứng phải lớn hơn 0.");
    return this.write(user, employeeId, year, kind, dto, async (db, hash) => {
      const source = await this.writableBalance(db, employeeId, year, dto.revision);
      const target = await this.writableBalance(db, employeeId, year + 1, dto.targetRevision);
      const employee = await this.authorized(db, user, "leave.balance.manage", employeeId, year, source, [effectiveDate]);
      await this.authorized(db, user, "leave.balance.manage", employeeId, year + 1, target, [effectiveDate]);
      const policy = await this.policyFor(db, employee, effectiveDate);
      const expiry = carryExpiry(year + 1, policy.carryExpiryMonth, policy.carryExpiryDay);
      const before = fundSnapshot(source), targetBefore = fundSnapshot(target);
      if (kind === "CARRY") {
        if (effectiveDate > expiry || businessDate() > expiry) throw new ConflictException("Đã quá hạn dùng phép chuyển; giữ số dư cũ để đối soát, không tự xóa quyền lợi.");
        if (spendableAnnual(source.entries, year, effectiveDate, businessDate()).lt(days)) throw new ConflictException("Chỉ chuyển phần phép năm còn lại; không chuyển tiếp phép cũ hoặc phép ứng.");
        const carried = target.entries.filter(entry => entry.kind === "CARRY_IN").reduce((total, entry) => total.plus(entry.days.toString()), new Decimal(0));
        if (carried.plus(days).gt(policy.carryLimitDays.toString())) throw new ConflictException("Tổng phép chuyển vượt trần chính sách năm nhận; phần còn lại giữ đối soát.");
      } else {
        if (employee.terminationDate && employee.terminationDate < new Date(Date.UTC(year + 1, 0, 1))) throw new ConflictException("Không ứng phép năm sau khi đã có ngày nghỉ việc trước năm đó.");
        const advanced = source.entries.filter(entry => entry.kind === "ADVANCE_IN").reduce((total, entry) => total.plus(entry.days.toString()), new Decimal(0));
        if (advanced.plus(days).gt(policy.advanceLimitDays.toString())) throw new ConflictException("Tổng phép ứng vượt trần chính sách.");
      }
      const operation = await this.operation(db, user, kind, dto, hash, { employeeId, sourceYear: year, targetYear: year + 1, days: daysText(days), policyVersionId: policy.id, policyStatus: policy.status, policyReference: policy.decisionReference, carryLimitDays: policy.carryLimitDays.toString(), advanceLimitDays: policy.advanceLimitDays.toString(), expiry: leaveDateText(expiry), before, targetBefore });
      const sourceEntry = kind === "CARRY" ? { kind: "CARRY_OUT", bucket: "ANNUAL", days: daysText(days.negated()) } : { kind: "ADVANCE_IN", bucket: "ADVANCE", days: daysText(days) };
      const targetEntry = kind === "CARRY" ? { kind: "CARRY_IN", bucket: "CARRY", days: daysText(days), expiresAt: expiry } : { kind: "ADVANCE_OUT", bucket: "ANNUAL", days: daysText(days.negated()) };
      await db.leaveLedgerEntry.createMany({ data: [{ balanceId: source.id, operationId: operation.id, ...sourceEntry }, { balanceId: target.id, operationId: operation.id, ...targetEntry }] });
      await db.leaveBalance.updateMany({ where: { id: { in: [source.id, target.id] } }, data: { revision: { increment: 1 } } });
      const afterRow = (await this.load(db, employeeId, year))!, targetRow = (await this.load(db, employeeId, year + 1))!;
      const after = fundView(employee, year, afterRow, businessDate()), targetAfter = fundView(employee, year + 1, targetRow, businessDate());
      await this.record(db, user, source.id, kind, { source: before, target: targetBefore }, { source: fundSnapshot(afterRow), target: fundSnapshot(targetRow) }, dto, operation.id, ipAddress);
      return { balance: after, targetBalance: targetAfter, operationId: operation.id };
    });
  }
}
