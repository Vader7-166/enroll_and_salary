import { BadRequestException, ConflictException, ForbiddenException, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InsuranceRate, InsuranceType, Prisma } from "@prisma/client";
import Decimal from "decimal.js";
import { AuditService } from "../audit/audit.service";
import { businessDate } from "../auth/business-date";
import type { AuthUser } from "../auth/auth.types";
import { PrismaService } from "../database/prisma.service";
import { PayrollSourceEvents } from "../payroll-events/payroll-source-events.service";
import { effectiveAt, ScopeService } from "../organization/scope.service";
import { salaryTimeline, unitSegments } from "../salary-decisions/salary-timeline";
import { checkCp07, insurableSalary, insuranceContribution, insuranceEligibility, type ContractKind, type InsurableComponent, type InsuranceKind, type RateInput } from "./insurance-engine";
import type { InsurancePreviewDto, InsuranceRateDto, InsuranceRateQueryDto } from "./social-insurance.dto";

type Db = Prisma.TransactionClient;
const DAY = 86_400_000;
const key = (date: Date) => date.toISOString().slice(0, 10);
function fail(kind: "conflict" | "bad", code: string, message: string, details?: Record<string, unknown>): never {
  const body = { code, message, ...(details ? { details } : {}) };
  throw kind === "conflict" ? new ConflictException(body) : new BadRequestException(body);
}
export function monthRange(month: string) {
  const [year, value] = month.split("-").map(Number);
  return { from: new Date(Date.UTC(year, value - 1, 1)), to: new Date(Date.UTC(year, value, 0)) };
}
function rateView(row: InsuranceRate) {
  return { id: row.id, insuranceType: row.insuranceType, regionCode: row.regionCode, employeeRate: row.employeeRate.toString(), employerRate: row.employerRate.toString(), fundDetail: row.fundDetail,
    floorRegionalMinimum: row.floorRegionalMinimum, capReference: row.capReference, capMultiplier: row.capMultiplier?.toString() ?? null, legalBasis: row.legalBasis, status: row.status,
    effectiveFrom: key(row.effectiveFrom), effectiveTo: row.effectiveTo ? key(row.effectiveTo) : null };
}

@Injectable()
export class SocialInsuranceService {
  private readonly key: Buffer;
  constructor(private readonly prisma: PrismaService, private readonly scope: ScopeService, private readonly audit: AuditService, private readonly events: PayrollSourceEvents, config: ConfigService) {
    this.key = Buffer.from(config.getOrThrow<string>("HR_DATA_KEY"), "base64");
  }

  private assertRole(user: AuthUser, permission: "insurance.read" | "insurance.manage") {
    if (!user.roles.includes("KT") || !user.permissions.includes(permission)) throw new ForbiddenException("Chỉ KT được xem hoặc quản lý mức đóng BH.");
  }

  async rates(user: AuthUser, query: InsuranceRateQueryDto) {
    this.assertRole(user, "insurance.read");
    const rows = await this.prisma.insuranceRate.findMany({ where: query.asOf ? effectiveAt(new Date(query.asOf + "T00:00:00Z")) : {}, orderBy: [{ insuranceType: "asc" }, { regionCode: "asc" }, { effectiveFrom: "desc" }] });
    return { items: rows.map(rateView) };
  }

  async addRate(user: AuthUser, dto: InsuranceRateDto, ip?: string) {
    this.assertRole(user, "insurance.manage");
    const legalBasis = dto.legalBasis?.trim();
    if (!legalBasis) fail("bad", "INSURANCE_LEGAL_BASIS_REQUIRED", "Mức đóng BH phải có văn bản căn cứ.");
    if ((dto.capReference === "NONE") !== (dto.capMultiplier === undefined)) fail("bad", "INSURANCE_CAP_INVALID", "Trần cần cả mốc tham chiếu và hệ số, hoặc không có trần.");
    const from = new Date(dto.effectiveFrom + "T00:00:00Z");
    if (!Number.isFinite(from.getTime()) || key(from) !== dto.effectiveFrom) fail("bad", "DATE_INVALID", "Ngày hiệu lực không hợp lệ.");
    return this.prisma.$transaction(async db => {
      await db.$queryRaw`SELECT pg_advisory_xact_lock(8210480)::text AS lock`;
      const rows = await db.insuranceRate.findMany({ where: { insuranceType: dto.insuranceType, regionCode: dto.regionCode ?? null } });
      const latest = [...rows].sort((left, right) => right.effectiveFrom.getTime() - left.effectiveFrom.getTime())[0];
      const closable = latest && latest.effectiveTo === null && latest.effectiveFrom < from ? latest : null;
      const overlap = rows.find(row => row.id !== closable?.id && (row.effectiveTo === null || row.effectiveTo >= from));
      if (overlap) fail("conflict", "EFFECTIVE_OVERLAP", `Mức đóng ${dto.insuranceType} chồng với bản từ ${key(overlap.effectiveFrom)}.`, { overlappingId: overlap.id });
      if (closable) await db.insuranceRate.update({ where: { id: closable.id }, data: { effectiveTo: new Date(from.getTime() - DAY) } });
      const row = await db.insuranceRate.create({ data: { insuranceType: dto.insuranceType, regionCode: dto.regionCode ?? null, employeeRate: new Prisma.Decimal(dto.employeeRate), employerRate: new Prisma.Decimal(dto.employerRate), fundDetail: (dto.fundDetail ?? {}) as Prisma.InputJsonValue, floorRegionalMinimum: dto.floorRegionalMinimum, capReference: dto.capReference, capMultiplier: dto.capMultiplier ? new Prisma.Decimal(dto.capMultiplier) : null, legalBasis: legalBasis!, status: dto.status, effectiveFrom: from, createdById: user.id } });
      await this.events.changed(db, { all: true, source: "INSURANCE_RATE", reason: row.insuranceType + " từ " + dto.effectiveFrom, actorId: user.id });
      await this.audit.record({ actorId: user.id, entityType: "insurance_rate", entityId: row.id, action: "CREATE_VERSION", result: "SUCCESS", oldValue: closable ? rateView(closable) : undefined, newValue: rateView(row), ipAddress: ip }, db);
      return { rate: rateView(row), closedId: closable?.id ?? null };
    }, { isolationLevel: "Serializable" });
  }

  private async parameter(db: Db, paramCode: string, siteId: string | null, regionCode: string | null, at: Date) {
    const scopes = [...(siteId ? ["SITE:" + siteId] : []), ...(regionCode ? ["REGION:" + regionCode] : []), "GLOBAL"];
    const rows = await db.legalParameter.findMany({ where: { paramCode, subjectType: "ALL", applicationBasis: "WORK_DATE", scopeKey: { in: scopes }, ...effectiveAt(at) } });
    const row = scopes.map(scope => rows.find(item => item.scopeKey === scope)).find(Boolean);
    return row ? { id: row.id, value: String(row.value) } : null;
  }

  private async rateFor(db: Db, kind: InsuranceType, regionCode: string | null, at: Date): Promise<(RateInput & { row: InsuranceRate }) | null> {
    const rows = await db.insuranceRate.findMany({ where: { insuranceType: kind, AND: [{ OR: [{ regionCode }, { regionCode: null }] }, effectiveAt(at)] } });
    const row = rows.find(item => item.regionCode === regionCode) ?? rows.find(item => item.regionCode === null);
    return row ? { id: row.id, employeeRate: row.employeeRate.toString(), employerRate: row.employerRate.toString(), row } : null;
  }

  /**
   * Full monthly insurance computation for one employee. `extra` adds insurable components that only the
   * payroll engine knows (pay-plan allowances); the salary timeline supplies agreed and decision lines.
   */
  async compute(db: Db, employeeId: string, month: string, extra: InsurableComponent[] = []) {
    const { from, to } = monthRange(month);
    const [contracts, statuses, leaves, units] = await Promise.all([
      db.employmentContract.findMany({ where: { employeeId, status: "ACTIVE", startDate: { lte: to }, OR: [{ endDate: null }, { endDate: { gte: from } }] } }),
      db.employeeSpecialStatus.findMany({ where: { employeeId, effectiveFrom: { lte: to }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }] } }),
      db.leaveRequest.findMany({ where: { employeeId, status: "APPROVED", dateFrom: { lte: to }, dateTo: { gte: from } }, select: { snapshot: true } }),
      unitSegments(db, employeeId, from, to),
    ]);
    const unit = units.at(-1) ?? null;
    const threshold = await this.parameter(db, "UNPAID_LEAVE_INSURANCE_EXEMPT_DAYS", unit?.siteId ?? null, unit?.wageRegionCode ?? null, to);
    let unpaidLeaveDays = new Decimal(0);
    for (const leave of leaves) for (const line of ((leave.snapshot as { lines?: Array<{ workDate: string; isPaid: boolean; holiday?: boolean; days?: string }> }).lines ?? []))
      if (!line.isPaid && !line.holiday && line.workDate >= key(from) && line.workDate <= key(to)) unpaidLeaveDays = unpaidLeaveDays.plus(line.days ?? "1");
    const eligibility = insuranceEligibility({ month, contracts: contracts.map(contract => ({ type: contract.type as ContractKind, insuranceEligible: contract.insuranceEligible })), statuses: statuses.map(status => status.statusType), unpaidLeaveDays: unpaidLeaveDays.toNumber(), unpaidLeaveThreshold: Number(threshold?.value ?? 14) });
    const missing: string[] = [];
    if (!unit?.wageRegionCode) missing.push("WORK_LOCATION");
    const regionalMinimum = unit?.wageRegionCode ? await this.parameter(db, "MIN_WAGE_MONTH_" + unit.wageRegionCode, unit.siteId, unit.wageRegionCode, to) : null;
    if (!regionalMinimum) missing.push("MIN_WAGE_MONTH");
    // Insurable salary uses the amounts in force on the month's last covered day (raise mid-month counts for the month).
    const asOf = unit ? new Date(Date.parse(unit.to + "T00:00:00Z")) : to;
    const segments = (await salaryTimeline(db, this.key, employeeId, from, to)).filter(segment => segment.from <= key(asOf) && segment.to >= key(asOf));
    const componentIds = segments.map(segment => segment.componentId).filter((id): id is string => !!id);
    const versions = await db.salaryComponentVersion.findMany({ where: { componentId: { in: componentIds }, ...effectiveAt(asOf) } });
    const components: InsurableComponent[] = [
      ...segments.filter(segment => segment.salaryBasis === "MONTHLY").map(segment => ({ code: segment.componentCode ?? "AGREED", name: segment.componentName, amount: segment.amount, insurable: segment.componentId === null || versions.some(version => version.componentId === segment.componentId && version.isInsurable) })),
      ...extra,
    ];
    if (segments.some(segment => segment.componentId === null && segment.salaryBasis === "HOURLY")) missing.push("HOURLY_AGREED_SALARY");
    const trained = statuses.some(status => status.statusType === "VOCATIONAL_TRAINED" && status.effectiveFrom <= asOf && (!status.effectiveTo || status.effectiveTo >= asOf));
    const addon = trained ? await this.parameter(db, "INSURANCE_TRAINED_FLOOR_ADDON", unit?.siteId ?? null, unit?.wageRegionCode ?? null, asOf) : null;
    const baseSalary = await this.parameter(db, "BASE_SALARY_MONTH", unit?.siteId ?? null, unit?.wageRegionCode ?? null, asOf);
    const rates = {} as Record<InsuranceKind | "KPCD", (RateInput & { row: InsuranceRate }) | null>;
    for (const kind of ["BHXH", "BHYT", "BHTN", "KPCD"] as const) rates[kind] = await this.rateFor(db, kind, unit?.wageRegionCode ?? null, asOf);
    const caps = {} as Record<InsuranceKind, string | null>;
    for (const kind of ["BHXH", "BHYT", "BHTN"] as const) {
      const rate = rates[kind]?.row;
      if (!rate) { missing.push("RATE_" + kind); caps[kind] = null; continue; }
      const reference = rate.capReference === "BASE_SALARY" ? baseSalary?.value : rate.capReference === "REGIONAL_MINIMUM" ? regionalMinimum?.value : null;
      if (rate.capReference !== "NONE" && !reference) missing.push("CAP_REFERENCE_" + kind);
      caps[kind] = rate.capReference === "NONE" || !reference ? null : new Decimal(reference).times(rate.capMultiplier!.toString()).toString();
    }
    const salary = regionalMinimum ? insurableSalary({ components, regionalMinimum: regionalMinimum.value, trainedAddon: addon?.value ?? null, caps }) : null;
    const [unionRate, unionCap] = await Promise.all([this.parameter(db, "UNION_FEE_RATE", unit?.siteId ?? null, unit?.wageRegionCode ?? null, asOf), this.parameter(db, "UNION_FEE_CAP", unit?.siteId ?? null, unit?.wageRegionCode ?? null, asOf)]);
    const cp07 = checkCp07(eligibility, salary && new Decimal(salary.raw).gt(0) && !missing.length ? salary : null);
    const contribution = salary && !cp07 ? insuranceContribution({ eligibility, salary, rates: { BHXH: rates.BHXH, BHYT: rates.BHYT, BHTN: rates.BHTN, KPCD: rates.KPCD }, unionFee: unionRate && unionCap ? { rate: unionRate.value, cap: unionCap.value, parameterIds: [unionRate.id, unionCap.id] } : null, rounding: { scale: 0 } }) : null;
    return {
      employeeId, month, eligibility, unit, unpaidLeaveDays: unpaidLeaveDays.toString(), trained, missing, cp07, salary, contribution,
      parameters: { regionalMinimum, baseSalary, trainedAddon: addon, unionRate, unionCap, threshold },
      rates: Object.fromEntries(Object.entries(rates).map(([kind, rate]) => [kind, rate ? rateView(rate.row) : null])),
    };
  }

  async preview(user: AuthUser, dto: InsurancePreviewDto) {
    this.assertRole(user, "insurance.read");
    const scope = await this.scope.load(user, "insurance.read");
    const today = businessDate();
    const employee = await this.prisma.employee.findFirst({ where: { id: dto.employeeId, assignments: { some: { ...effectiveAt(today), orgUnitId: { in: [...scope.allowed] } } }, exclusions: { none: { userAccountId: user.id, ...effectiveAt(today) } } }, select: { id: true, code: true, fullName: true } });
    if (!employee) throw new ForbiddenException("Nhân viên nằm ngoài phạm vi được phân quyền.");
    return { employee, ...(await this.compute(this.prisma, dto.employeeId, dto.month)) };
  }
}
