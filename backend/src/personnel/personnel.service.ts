import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  BusinessPeriodStatus,
  EmploymentContractStatus,
  EmploymentContractType,
  Prisma,
  ProbationClass,
  SalaryBasis,
} from "@prisma/client";
import Decimal from "decimal.js";
import { cipherText, plainText } from "./contract-crypto";
import { AuditService } from "../audit/audit.service";
import { businessDate } from "../auth/business-date";
import type { AuthUser } from "../auth/auth.types";
import { PrismaService } from "../database/prisma.service";
import { effectiveAt, ScopeService } from "../organization/scope.service";
import {
  AssignmentQueryDto,
  CreateContractAnnexDto,
  CreateContractDto,
  CreateTransferDto,
} from "./personnel.dto";

type Db = Prisma.TransactionClient;
type PersonnelScope = {
  asOf: Date;
  allowed: Set<string>;
  versions: Array<Prisma.OrgUnitVersionGetPayload<{ include: { orgUnit: true; site: true } }>>;
};
type ContractLocation = { regionCode: string; siteId: string };
type ContractRow = Prisma.EmploymentContractGetPayload<{
  include: { annexes: { orderBy: { effectiveFrom: "asc" } } };
}>;
const MONEY = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;

function dateValue(value: string, field = "Ngày"): Date {
  const date = new Date(value + "T00:00:00.000Z");
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value)
    throw new BadRequestException(`${field} không hợp lệ.`);
  return date;
}

function dateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function previousDay(value: Date): Date {
  return new Date(value.getTime() - 86_400_000);
}

function inclusiveDays(start: Date, end: Date): number {
  return Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

function addMonths(date: Date, months: number): Date {
  const targetYear = date.getUTCFullYear();
  const targetMonth = date.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(targetYear, targetMonth, Math.min(date.getUTCDate(), lastDay)));
}

function termEnd(date: Date, months: number): Date {
  return previousDay(addMonths(date, months));
}

function positiveDecimal(value: string, field: string): Decimal {
  if (!MONEY.test(value)) throw new BadRequestException(`${field} phải là số tiền thập phân hợp lệ.`);
  const amount = new Decimal(value);
  if (!amount.isFinite() || !amount.gt(0))
    throw new BadRequestException(`${field} phải lớn hơn 0.`);
  return amount;
}

function requiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new BadRequestException(field + " không được để trống.");
  return normalized;
}

function jsonDecimal(value: unknown, code: string): Decimal {
  const raw = typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(raw))
    throw new InternalServerErrorException(`Tham số pháp lý ${code} có giá trị số dương không hợp lệ.`);
  const amount = new Decimal(raw);
  if (!amount.isFinite() || !amount.gt(0))
    throw new InternalServerErrorException(`Tham số pháp lý ${code} phải lớn hơn 0.`);
  return amount;
}


function visibleAt(user: AuthUser, scope: PersonnelScope, date: Date): Prisma.EmployeeWhereInput {
  return {
    assignments: {
      some: { ...effectiveAt(date), orgUnitId: { in: [...scope.allowed] } },
    },
    exclusions: {
      none: { userAccountId: user.id, ...effectiveAt(date) },
    },
  };
}

@Injectable()
export class PersonnelService {
  private readonly key: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
    config: ConfigService,
  ) {
    this.key = Buffer.from(config.getOrThrow<string>("HR_DATA_KEY"), "base64");
  }

  private async scoped(
    user: AuthUser,
    permission: string,
    ipAddress?: string,
    db?: Db,
    asOf?: Date,
  ): Promise<PersonnelScope> {
    try {
      return await this.scope.load(user, permission, db ?? this.prisma, asOf);
    } catch (error) {
      if (error instanceof ForbiddenException) {
        await this.audit.record({
          actorId: user.id,
          entityType: "personnel",
          entityId: permission,
          action: "ACCESS_DENIED",
          result: "DENIED",
          ipAddress,
        });
      }
      throw error;
    }
  }

  private async lockEmployee(db: Db, employeeId: string): Promise<void> {
    await db.$queryRaw`SELECT id FROM employee WHERE id = ${employeeId}::uuid FOR UPDATE`;
  }

  private async legalParameter(
    db: Db,
    code: string,
    date: Date,
    location: ContractLocation,
  ): Promise<Decimal> {
    const parameters = await db.legalParameter.findMany({
      where: {
        paramCode: code,
        scopeKey: { in: ["GLOBAL", "REGION:" + location.regionCode, "SITE:" + location.siteId] },
        subjectType: "ALL",
        applicationBasis: "WORK_DATE",
        ...effectiveAt(date),
      },
      orderBy: { effectiveFrom: "desc" },
      select: { scopeKey: true, value: true },
    });
    const parameter = [
      "SITE:" + location.siteId,
      "REGION:" + location.regionCode,
      "GLOBAL",
    ].map((scopeKey) => parameters.find((item) => item.scopeKey === scopeKey)).find(Boolean);
    if (!parameter)
      throw new BadRequestException("Thiếu tham số pháp lý " + code + " hiệu lực tại " + dateKey(date) + ".");
    return jsonDecimal(parameter.value, code);
  }

  private async employeeLocation(db: Db, employeeId: string, date: Date): Promise<ContractLocation> {
    const assignment = await db.orgAssignment.findFirst({
      where: { employeeId, isPrimary: true, ...effectiveAt(date) },
      orderBy: { effectiveFrom: "desc" },
      select: { orgUnitId: true },
    });
    if (!assignment)
      throw new BadRequestException("Không có đơn vị chính của nhân viên tại " + dateKey(date) + ".");
    const version = await db.orgUnitVersion.findFirst({
      where: { orgUnitId: assignment.orgUnitId, ...effectiveAt(date) },
      include: { site: { select: { id: true, wageRegionCode: true } } },
    });
    if (!version?.site)
      throw new BadRequestException("Không xác định được vùng lương của đơn vị tại " + dateKey(date) + ".");
    return { regionCode: version.site.wageRegionCode, siteId: version.site.id };
  }

  private async validateContract(
    db: Db,
    employeeId: string,
    input: {
      type: EmploymentContractType;
      startDate: Date;
      endDate: Date | null;
      salary: string;
      officialSalary: string | null;
      salaryBasis: SalaryBasis;
      probationClass: ProbationClass | null;
    },
  ): Promise<boolean> {
    const { type, startDate, endDate, salary, officialSalary, salaryBasis, probationClass } = input;
    if (endDate && endDate < startDate)
      throw new BadRequestException("Ngày kết thúc không được trước ngày bắt đầu.");
    if (type === EmploymentContractType.INDEFINITE && endDate)
      throw new BadRequestException("Hợp đồng không xác định thời hạn không có ngày kết thúc.");
    if (type !== EmploymentContractType.INDEFINITE && !endDate)
      throw new BadRequestException("Loại hợp đồng này phải có ngày kết thúc.");
    if (type === EmploymentContractType.PROBATION && (!probationClass || !officialSalary))
      throw new BadRequestException("Hợp đồng thử việc phải có probationClass và officialSalary.");
    if (type !== EmploymentContractType.PROBATION && probationClass)
      throw new BadRequestException("probationClass chỉ áp dụng cho hợp đồng thử việc.");

    const salaryValue = positiveDecimal(salary, "salary");
    const location = await this.employeeLocation(db, employeeId, startDate);
    const wageCode = "MIN_WAGE_" + (salaryBasis === SalaryBasis.MONTHLY ? "MONTH" : "HOUR") + "_" + location.regionCode;
    const regionalMinimum = await this.legalParameter(db, wageCode, startDate, location);
    if (salaryValue.lt(regionalMinimum))
      throw new BadRequestException("Lương hợp đồng thấp hơn mức tối thiểu vùng " + location.regionCode + " (" + regionalMinimum.toFixed() + ").");

    if (type === EmploymentContractType.PROBATION) {
      const maxDaysCode = probationClass === ProbationClass.TECHNICAL
        ? "PROBATION_MAX_DAYS_TECHNICAL"
        : "PROBATION_MAX_DAYS_WORKER";
      const [ratio, maxDays] = await Promise.all([
        this.legalParameter(db, "PROBATION_MIN_RATIO", startDate, location),
        this.legalParameter(db, maxDaysCode, startDate, location),
      ]);
      if (!endDate) throw new BadRequestException("Hợp đồng thử việc phải có ngày kết thúc.");
      if (inclusiveDays(startDate, endDate) > maxDays.toNumber())
        throw new BadRequestException("Thời hạn thử việc vượt quá " + maxDays.toFixed(0) + " ngày.");
      const official = positiveDecimal(officialSalary!, "officialSalary");
      if (salaryValue.lt(official.mul(ratio)))
        throw new BadRequestException("Lương thử việc phải đạt ít nhất " + ratio.mul(100).toFixed(0) + "% lương chính thức.");
    }

    if (type === EmploymentContractType.FIXED_TERM) {
      if (!endDate) throw new BadRequestException("Hợp đồng xác định thời hạn phải có ngày kết thúc.");
      const [minimumMonths, maximumMonths] = await Promise.all([
        this.legalParameter(db, "FIXED_TERM_MIN_MONTHS", startDate, location),
        this.legalParameter(db, "FIXED_TERM_MAX_MONTHS", startDate, location),
      ]);
      if (endDate < termEnd(startDate, minimumMonths.toNumber()) || endDate > termEnd(startDate, maximumMonths.toNumber()))
        throw new BadRequestException("Thời hạn hợp đồng xác định phải từ " + minimumMonths.toFixed(0) + " đến " + maximumMonths.toFixed(0) + " tháng.");
    }

    if (type === EmploymentContractType.UNDER_ONE_MONTH && endDate && endDate >= termEnd(startDate, 1))
      throw new BadRequestException("Hợp đồng dưới một tháng không được kéo dài từ một tháng trở lên.");

    const insuranceMonths = await this.legalParameter(db, "INSURANCE_MIN_CONTRACT_MONTHS", startDate, location);
    return type === EmploymentContractType.INDEFINITE ||
      (type === EmploymentContractType.FIXED_TERM && !!endDate && endDate >= termEnd(startDate, insuranceMonths.toNumber()));
  }

  private serializeContract(contract: ContractRow) {
    return {
      id: contract.id,
      employeeId: contract.employeeId,
      number: contract.number,
      type: contract.type,
      status: contract.status,
      startDate: dateKey(contract.startDate),
      endDate: contract.endDate ? dateKey(contract.endDate) : null,
      signedDate: dateKey(contract.signedDate),
      salary: plainText(this.key, contract.salaryCipher),
      officialSalary: contract.officialSalaryCipher ? plainText(this.key, contract.officialSalaryCipher) : null,
      salaryBasis: contract.salaryBasis,
      probationClass: contract.probationClass,
      insuranceEligible: contract.insuranceEligible,
      annexes: contract.annexes.map((annex) => ({
        id: annex.id,
        number: annex.number,
        effectiveFrom: dateKey(annex.effectiveFrom),
        signedDate: dateKey(annex.signedDate),
        content: plainText(this.key, annex.contentCipher),
      })),
    };
  }

  private warnings(contracts: ContractRow[], date: Date): string[] {
    return contracts.flatMap((contract) => {
      if (contract.status !== EmploymentContractStatus.ACTIVE || !contract.endDate) return [];
      const remaining = Math.floor((contract.endDate.getTime() - date.getTime()) / 86_400_000);
      if (contract.type === EmploymentContractType.PROBATION && remaining < 0)
        return [`Hợp đồng thử việc ${contract.number} đã hết hạn.`];
      if (remaining >= 0 && remaining <= 60)
        return [`Hợp đồng ${contract.number} sẽ hết hạn sau ${remaining} ngày.`];
      return [];
    });
  }

  async contracts(user: AuthUser, employeeId: string, ipAddress?: string) {
    const scope = await this.scoped(user, "contract.read", ipAddress);
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, ...visibleAt(user, scope, scope.asOf) },
      select: { id: true },
    });
    if (!employee) {
      await this.audit.record({ actorId: user.id, entityType: "employment_contract", entityId: employeeId, action: "VIEW_SENSITIVE", result: "EMPTY", ipAddress });
      const exclusion = await this.prisma.employeeExclusion.findFirst({
        where: { userAccountId: user.id, employeeId, ...effectiveAt(scope.asOf) },
        select: { id: true },
      });
      if (exclusion) return { items: [], warnings: [] };
      throw new ForbiddenException("Không được phép xem hợp đồng của nhân viên này.");
    }
    const rows = await this.prisma.employmentContract.findMany({
      where: { employeeId },
      include: { annexes: { orderBy: { effectiveFrom: "asc" } } },
      orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
    });
    await this.audit.record({ actorId: user.id, entityType: "employment_contract", entityId: employeeId, action: "VIEW_SENSITIVE", result: "ALLOWED", ipAddress });
    return { items: rows.map((row) => this.serializeContract(row)), warnings: this.warnings(rows, scope.asOf) };
  }

  async createContract(user: AuthUser, employeeId: string, dto: CreateContractDto, ipAddress?: string) {
    await this.scoped(user, "contract.manage", ipAddress);
    const startDate = dateValue(dto.startDate, "startDate");
    const endDate = dto.endDate ? dateValue(dto.endDate, "endDate") : null;
    const signedDate = dateValue(dto.signedDate, "signedDate");
    const number = requiredText(dto.number, "number");
    const salary = dto.salary.trim();
    const officialSalary = dto.officialSalary?.trim() || null;
    const result = await this.prisma.$transaction(async (tx) => {
      await this.lockEmployee(tx, employeeId);
      const scope = await this.scope.load(user, "contract.manage", tx);
      const employee = await tx.employee.findFirst({ where: { id: employeeId, ...visibleAt(user, scope, scope.asOf) }, select: { id: true } });
      if (!employee) return null;
      const insuranceEligible = await this.validateContract(tx, employeeId, {
        type: dto.type, startDate, endDate, salary, officialSalary, salaryBasis: dto.salaryBasis,
        probationClass: dto.probationClass ?? null,
      });
      const contract = await tx.employmentContract.create({
        data: {
          employeeId,
          number,
          type: dto.type,
          startDate,
          endDate,
          signedDate,
          salaryCipher: cipherText(this.key, salary),
          officialSalaryCipher: officialSalary ? cipherText(this.key, officialSalary) : null,
          salaryBasis: dto.salaryBasis,
          probationClass: dto.probationClass ?? null,
          insuranceEligible,
        },
        include: { annexes: { orderBy: { effectiveFrom: "asc" } } },
      });
      await this.audit.record({
        actorId: user.id, entityType: "employment_contract", entityId: contract.id, action: "CREATE", result: "ALLOWED",
        newValue: { employeeId, number: contract.number, type: contract.type, startDate: dateKey(startDate), endDate: endDate ? dateKey(endDate) : null }, ipAddress,
      }, tx);
      return contract;
    }, { isolationLevel: "Serializable" });
    if (!result) throw new ForbiddenException("Không được phép quản lý hợp đồng của nhân viên này.");
    return { contract: this.serializeContract(result) };
  }

  async activateContract(user: AuthUser, employeeId: string, contractId: string, ipAddress?: string) {
    await this.scoped(user, "contract.manage", ipAddress);
    const result = await this.prisma.$transaction(async (tx) => {
      await this.lockEmployee(tx, employeeId);
      const scope = await this.scope.load(user, "contract.manage", tx);
      const employee = await tx.employee.findFirst({ where: { id: employeeId, ...visibleAt(user, scope, scope.asOf) }, select: { id: true } });
      if (!employee) return null;
      const contract = await tx.employmentContract.findFirst({
        where: { id: contractId, employeeId }, include: { annexes: { orderBy: { effectiveFrom: "asc" } } },
      });
      if (!contract) throw new BadRequestException("Hợp đồng không tồn tại cho nhân viên này.");
      if (contract.status === EmploymentContractStatus.ACTIVE) return contract;
      await this.validateContract(tx, employeeId, {
        type: contract.type, startDate: contract.startDate, endDate: contract.endDate,
        salary: plainText(this.key, contract.salaryCipher),
        officialSalary: contract.officialSalaryCipher ? plainText(this.key, contract.officialSalaryCipher) : null,
        salaryBasis: contract.salaryBasis, probationClass: contract.probationClass,
      });
      const overlap = await tx.employmentContract.findFirst({
        where: {
          employeeId,
          status: EmploymentContractStatus.ACTIVE,
          id: { not: contractId },
          startDate: { lte: contract.endDate ?? new Date("9999-12-31T00:00:00.000Z") },
          OR: [{ endDate: null }, { endDate: { gte: contract.startDate } }],
        },
        select: { id: true },
      });
      if (overlap) throw new ConflictException("Hợp đồng ACTIVE bị chồng lấn thời hạn.");
      if (contract.type === EmploymentContractType.FIXED_TERM) {
        const location = await this.employeeLocation(tx, employeeId, contract.startDate);
        const maxCount = await this.legalParameter(tx, "FIXED_TERM_MAX_COUNT", contract.startDate, location);
        const count = await tx.employmentContract.count({
          where: { employeeId, type: EmploymentContractType.FIXED_TERM, status: EmploymentContractStatus.ACTIVE, id: { not: contractId } },
        });
        if (count >= maxCount.toNumber())
          throw new ConflictException("Đã đủ số lần hợp đồng xác định thời hạn; phải dùng hợp đồng không xác định thời hạn.");
      }
      const activated = await tx.employmentContract.update({
        where: { id: contractId }, data: { status: EmploymentContractStatus.ACTIVE },
        include: { annexes: { orderBy: { effectiveFrom: "asc" } } },
      });
      await this.audit.record({
        actorId: user.id, entityType: "employment_contract", entityId: contractId, action: "ACTIVATE", result: "ALLOWED",
        newValue: { employeeId, number: activated.number, startDate: dateKey(activated.startDate) }, ipAddress,
      }, tx);
      return activated;
    }, { isolationLevel: "Serializable" });
    if (!result) throw new ForbiddenException("Không được phép quản lý hợp đồng của nhân viên này.");
    return { contract: this.serializeContract(result) };
  }

  async createAnnex(user: AuthUser, employeeId: string, contractId: string, dto: CreateContractAnnexDto, ipAddress?: string) {
    await this.scoped(user, "contract.manage", ipAddress);
    const effectiveFrom = dateValue(dto.effectiveFrom, "effectiveFrom");
    const signedDate = dateValue(dto.signedDate, "signedDate");
    const number = requiredText(dto.number, "number");
    if (!dto.content.trim()) throw new BadRequestException("content không được để trống.");
    const result = await this.prisma.$transaction(async (tx) => {
      await this.lockEmployee(tx, employeeId);
      const scope = await this.scope.load(user, "contract.manage", tx);
      const employee = await tx.employee.findFirst({ where: { id: employeeId, ...visibleAt(user, scope, scope.asOf) }, select: { id: true } });
      if (!employee) return null;
      const contract = await tx.employmentContract.findFirst({ where: { id: contractId, employeeId }, select: { id: true } });
      if (!contract) throw new BadRequestException("Hợp đồng không tồn tại cho nhân viên này.");
      const annex = await tx.contractAnnex.create({
        data: { contractId, number, effectiveFrom, signedDate, contentCipher: cipherText(this.key, dto.content) },
      });
      await this.audit.record({
        actorId: user.id, entityType: "contract_annex", entityId: annex.id, action: "CREATE", result: "ALLOWED",
        newValue: { employeeId, contractId, number: annex.number, effectiveFrom: dateKey(effectiveFrom) }, ipAddress,
      }, tx);
      return annex;
    }, { isolationLevel: "Serializable" });
    if (!result) throw new ForbiddenException("Không được phép quản lý hợp đồng của nhân viên này.");
    return { annex: { id: result.id, number: result.number, effectiveFrom: dateKey(result.effectiveFrom), signedDate: dateKey(result.signedDate), content: plainText(this.key, result.contentCipher) } };
  }

  async assignments(user: AuthUser, employeeId: string, query: AssignmentQueryDto, ipAddress?: string) {
    const asOf = query.asOf ? dateValue(query.asOf, "asOf") : businessDate();
    const todayScope = await this.scoped(user, "employee.history", ipAddress);
    const datedScope = await this.scoped(user, "employee.history", ipAddress, undefined, asOf);
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, AND: [visibleAt(user, todayScope, todayScope.asOf), visibleAt(user, datedScope, asOf)] },
      select: { id: true },
    });
    if (!employee) {
      await this.audit.record({ actorId: user.id, entityType: "employee_history", entityId: employeeId, action: "READ", result: "EMPTY", ipAddress });
      const exclusion = await this.prisma.employeeExclusion.findFirst({
        where: { userAccountId: user.id, employeeId, OR: [effectiveAt(todayScope.asOf), effectiveAt(asOf)] },
        select: { id: true },
      });
      if (exclusion) return { asOf: dateKey(asOf), items: [], transfers: [], currentOrgUnitId: null };
      throw new ForbiddenException("Không được phép xem lịch sử phân công của nhân viên này.");
    }
    const assignments = await this.prisma.orgAssignment.findMany({
      where: { employeeId, ...effectiveAt(asOf), orgUnitId: { in: [...datedScope.allowed] } },
      orderBy: [{ isPrimary: "desc" }, { effectiveFrom: "asc" }, { id: "asc" }],
    });
    const versionByUnit = new Map(datedScope.versions.map((version) => [version.orgUnitId, version]));
    const currentPrimary = await this.prisma.orgAssignment.findFirst({
      where: { employeeId, isPrimary: true, ...effectiveAt(asOf), orgUnitId: { in: [...datedScope.allowed] } },
      orderBy: { effectiveFrom: "desc" }, select: { orgUnitId: true },
    });
    const transferRows = await this.prisma.personnelTransfer.findMany({
      where: { employeeId, effectiveFrom: { lte: asOf } }, orderBy: [{ effectiveFrom: "asc" }, { id: "asc" }],
    });
    const transfers = [] as Array<{ id: string; fromOrgUnitId: string; toOrgUnitId: string; effectiveFrom: string; decisionNumber: string; decisionDate: string; reason: string }>;
    for (const transfer of transferRows) {
      const transferScope = await this.scope.load(user, "employee.history", this.prisma, transfer.effectiveFrom);
      if (!transferScope.allowed.has(transfer.fromOrgUnitId) || !transferScope.allowed.has(transfer.toOrgUnitId)) continue;
      transfers.push({
        id: transfer.id, fromOrgUnitId: transfer.fromOrgUnitId, toOrgUnitId: transfer.toOrgUnitId,
        effectiveFrom: dateKey(transfer.effectiveFrom), decisionNumber: transfer.decisionNumber,
        decisionDate: dateKey(transfer.decisionDate), reason: transfer.reason,
      });
    }
    await this.audit.record({ actorId: user.id, entityType: "employee_history", entityId: employeeId, action: "READ", result: "ALLOWED", newValue: { asOf: dateKey(asOf) }, ipAddress });
    return {
      asOf: dateKey(asOf),
      items: assignments.flatMap((assignment) => {
        const version = versionByUnit.get(assignment.orgUnitId);
        return version ? [{ id: assignment.id, orgUnitId: assignment.orgUnitId, orgUnitCode: version.orgUnit.code, orgUnitName: version.name, effectiveFrom: dateKey(assignment.effectiveFrom), effectiveTo: assignment.effectiveTo ? dateKey(assignment.effectiveTo) : null, isPrimary: assignment.isPrimary, allocationRatio: assignment.allocationRatio.toFixed(2) }] : [];
      }),
      transfers,
      currentOrgUnitId: currentPrimary?.orgUnitId ?? null,
    };
  }

  async transfer(user: AuthUser, employeeId: string, dto: CreateTransferDto, ipAddress?: string) {
    await this.scoped(user, "employee.transfer", ipAddress);
    const effectiveFrom = dateValue(dto.effectiveFrom, "effectiveFrom");
    const decisionDate = dateValue(dto.decisionDate, "decisionDate");
    if (decisionDate > effectiveFrom)
      throw new BadRequestException("Ngày quyết định không được sau ngày hiệu lực điều chuyển.");
    const decisionNumber = requiredText(dto.decisionNumber, "decisionNumber");
    const reason = requiredText(dto.reason, "reason");
    const result = await this.prisma.$transaction(async (tx) => {
      await this.lockEmployee(tx, employeeId);
      const todayScope = await this.scope.load(user, "employee.transfer", tx);
      const datedScope = await this.scope.load(user, "employee.transfer", tx, effectiveFrom);
      const employee = await tx.employee.findFirst({
        where: { id: employeeId, AND: [visibleAt(user, todayScope, todayScope.asOf), visibleAt(user, datedScope, effectiveFrom)] },
        select: { id: true },
      });
      if (!employee) return null;
      const source = await tx.orgAssignment.findFirst({
        where: { employeeId, isPrimary: true, ...effectiveAt(effectiveFrom) },
        orderBy: { effectiveFrom: "desc" },
      });
      if (!source) throw new ConflictException("Không có phân công chính hiệu lực tại ngày điều chuyển.");
      if (!todayScope.allowed.has(source.orgUnitId) || !datedScope.allowed.has(source.orgUnitId) || !todayScope.allowed.has(dto.toOrgUnitId) || !datedScope.allowed.has(dto.toOrgUnitId))
        return null;
      if (source.orgUnitId === dto.toOrgUnitId)
        throw new ConflictException("Đơn vị đích trùng đơn vị chính hiện tại tại ngày hiệu lực.");
      if (await tx.personnelTransfer.findFirst({ where: { employeeId, effectiveFrom }, select: { id: true } }))
        throw new ConflictException("Đã có quyết định điều chuyển tại ngày hiệu lực này.");
      if (await tx.personnelTransfer.findFirst({ where: { employeeId, effectiveFrom: { gt: effectiveFrom } }, select: { id: true } }))
        throw new ConflictException("Không thể chèn điều chuyển trước quyết định tương lai đã ghi nhận.");
      if (await tx.shiftSchedule.findFirst({ where: { employeeId, workDate: { gte: effectiveFrom, ...(source.effectiveTo ? { lte: source.effectiveTo } : {}) }, plan: { status: { in: ["PENDING", "APPROVED"] } } }, select: { id: true } }))
        throw new ConflictException("Khoảng điều chuyển có lịch ca đã gửi duyệt/đã duyệt; xử lý lịch trước khi điều chuyển.");

      const frozenPeriods = await tx.businessPeriod.findMany({
        where: {
          periodType: "ATTENDANCE", status: { in: [BusinessPeriodStatus.CLOSED, BusinessPeriodStatus.LOCKED] },
          dateTo: { gte: effectiveFrom }, ...(source.effectiveTo ? { dateFrom: { lte: source.effectiveTo } } : {}),
        },
        select: { scopeOrgUnitId: true, dateFrom: true, dateTo: true },
      });
      if (frozenPeriods.length) {
        const lastFrozenDay = new Date(Math.max(...frozenPeriods.map((period) => period.dateTo.getTime())));
        const versions = await tx.orgUnitVersion.findMany({
          where: { effectiveFrom: { lte: lastFrozenDay }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveFrom } }] },
          select: { orgUnitId: true, parentId: true, effectiveFrom: true, effectiveTo: true },
        });
        for (const period of frozenPeriods) {
          const from = Math.max(effectiveFrom.getTime(), period.dateFrom.getTime());
          const to = Math.min(source.effectiveTo?.getTime() ?? period.dateTo.getTime(), period.dateTo.getTime());
          const checkpoints = new Set([from]);
          for (const version of versions) {
            const start = version.effectiveFrom.getTime();
            const afterEnd = version.effectiveTo ? version.effectiveTo.getTime() + 86_400_000 : null;
            if (start > from && start <= to) checkpoints.add(start);
            if (afterEnd !== null && afterEnd > from && afterEnd <= to) checkpoints.add(afterEnd);
          }
          for (const date of checkpoints) {
            const parentByUnit = new Map(versions.filter((version) => version.effectiveFrom.getTime() <= date && (version.effectiveTo === null || version.effectiveTo.getTime() >= date)).map((version) => [version.orgUnitId, version.parentId]));
            for (const unitId of [source.orgUnitId, dto.toOrgUnitId]) {
              const seen = new Set<string>();
              let cursor: string | null | undefined = unitId;
              while (cursor && !seen.has(cursor)) {
                if (cursor === period.scopeOrgUnitId)
                  throw new ConflictException("Khoảng điều chuyển ảnh hưởng kỳ đã CLOSED hoặc LOCKED.");
                seen.add(cursor); cursor = parentByUnit.get(cursor);
              }
            }
          }
        }
      }

      if (dateKey(source.effectiveFrom) === dateKey(effectiveFrom)) {
        await tx.orgAssignment.delete({ where: { id: source.id } });
      } else {
        await tx.orgAssignment.update({ where: { id: source.id }, data: { effectiveTo: previousDay(effectiveFrom) } });
      }
      await tx.orgAssignment.create({
        data: { employeeId, orgUnitId: dto.toOrgUnitId, isPrimary: true, allocationRatio: new Prisma.Decimal("100"), effectiveFrom, effectiveTo: source.effectiveTo },
      });
      const transfer = await tx.personnelTransfer.create({
        data: { employeeId, fromOrgUnitId: source.orgUnitId, toOrgUnitId: dto.toOrgUnitId, effectiveFrom, decisionNumber, decisionDate, reason },
      });
      await this.audit.record({
        actorId: user.id, entityType: "personnel_transfer", entityId: transfer.id, action: "CREATE", result: "ALLOWED",
        newValue: { employeeId, fromOrgUnitId: source.orgUnitId, toOrgUnitId: dto.toOrgUnitId, effectiveFrom: dateKey(effectiveFrom), decisionNumber: transfer.decisionNumber }, ipAddress,
      }, tx);
      return transfer;
    }, { isolationLevel: "Serializable" });
    if (!result) throw new ForbiddenException("Không được phép điều chuyển nhân viên giữa các đơn vị này.");
    return { transfer: { id: result.id, fromOrgUnitId: result.fromOrgUnitId, toOrgUnitId: result.toOrgUnitId, effectiveFrom: dateKey(result.effectiveFrom), decisionNumber: result.decisionNumber, decisionDate: dateKey(result.decisionDate), reason: result.reason } };
  }
}
