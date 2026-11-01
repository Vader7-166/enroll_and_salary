import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, TaxSubject } from "@prisma/client";
import Decimal from "decimal.js";
import { AuditService } from "../audit/audit.service";
import { businessDate } from "../auth/business-date";
import type { AuthUser } from "../auth/auth.types";
import { cipherText, plainText } from "../common/data-crypto";
import { PrismaService } from "../database/prisma.service";
import { PayrollSourceEvents } from "../payroll-events/payroll-source-events.service";
import { effectiveAt, ScopeService } from "../organization/scope.service";
import { PayrollProfileService } from "../payroll-profile/payroll-profile.service";
import { unitSegments } from "../salary-decisions/salary-timeline";
import { grossUp, netCalculator, PitError, selectTaxContext, withhold, type Deductions, type IncomeItem, type Ruleset, type WithholdingResult } from "./pit-engine";
import type { AdjustWithholdingDto, GrossUpDto, PitPreviewDto, SaveWithholdingDto, TaxRulesetDto, WithholdingQueryDto } from "./pit.dto";

type Db = Prisma.TransactionClient;
const DAY = 86_400_000;
const key = (date: Date) => date.toISOString().slice(0, 10);
const date = (text: string) => new Date(text + "T00:00:00.000Z");
function fail(kind: "conflict" | "bad", code: string, message: string, details?: Record<string, unknown>): never {
  const body = { code, message, ...(details ? { details } : {}) };
  throw kind === "conflict" ? new ConflictException(body) : new BadRequestException(body);
}
function engine<T>(work: () => T): T {
  try { return work(); } catch (error) {
    if (error instanceof PitError) fail(error.code === "TAX_RULESET_INVALID" || error.code === "GROSS_UP_NOT_CONVERGED" ? "conflict" : "bad", error.code, error.message, error.details);
    throw error;
  }
}
function addMonths(day: Date, months: number) { return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + months, day.getUTCDate())); }

export interface PitInput {
  employeeId?: string; subject?: TaxSubject; paymentDate: string; paymentDateStatus: "PROJECTED" | "ACTUAL";
  items: IncomeItem[]; deductions: Omit<Deductions, "dependents">; dependents?: number; commitment?: boolean; voluntaryRequest?: boolean;
}

@Injectable()
export class PitService {
  private readonly key: Buffer;
  constructor(private readonly prisma: PrismaService, private readonly scope: ScopeService, private readonly audit: AuditService, private readonly profiles: PayrollProfileService, private readonly events: PayrollSourceEvents, config: ConfigService) {
    this.key = Buffer.from(config.getOrThrow<string>("HR_DATA_KEY"), "base64");
  }

  private assertRole(user: AuthUser, permission: "tax.read" | "tax.manage") {
    if (!user.roles.includes("KT") || !user.permissions.includes(permission)) throw new ForbiddenException("Chỉ KT được xem hoặc quản lý thuế TNCN.");
  }

  private async assertEmployee(user: AuthUser, employeeId: string, permission: "tax.read" | "tax.manage") {
    const scope = await this.scope.load(user, permission);
    const today = businessDate();
    const employee = await this.prisma.employee.findFirst({ where: { id: employeeId, assignments: { some: { ...effectiveAt(today), orgUnitId: { in: [...scope.allowed] } } }, exclusions: { none: { userAccountId: user.id, ...effectiveAt(today) } } }, select: { id: true, code: true, fullName: true } });
    if (!employee) throw new ForbiddenException("Nhân viên nằm ngoài phạm vi được phân quyền.");
    return employee;
  }

  async loadRulesets(db: Db = this.prisma): Promise<Ruleset[]> {
    const rows = await db.taxRuleset.findMany({ include: { brackets: true }, orderBy: [{ subject: "asc" }, { effectiveFrom: "asc" }] });
    return rows.map(row => ({ id: row.id, code: row.code, subject: row.subject, exemptionMode: row.exemptionMode, effectiveFrom: key(row.effectiveFrom), effectiveTo: row.effectiveTo ? key(row.effectiveTo) : null,
      settings: row.settings as Ruleset["settings"], legalBasis: row.legalBasis, status: row.status,
      brackets: row.brackets.sort((left, right) => left.basis.localeCompare(right.basis) || left.bracketNo - right.bracketNo).map(item => ({ basis: item.basis, bracketNo: item.bracketNo, lower: item.lowerBound.toString(), upper: item.upperBound?.toString() ?? null, rate: item.rate.toString() })) }));
  }

  async rulesets(user: AuthUser) {
    this.assertRole(user, "tax.read");
    return { items: await this.loadRulesets() };
  }

  async addRuleset(user: AuthUser, dto: TaxRulesetDto, ip?: string) {
    this.assertRole(user, "tax.manage");
    const legalBasis = dto.legalBasis?.trim();
    if (!legalBasis) fail("bad", "TAX_LEGAL_BASIS_REQUIRED", "Bộ quy tắc thuế phải có văn bản căn cứ.");
    const brackets = dto.brackets ?? [];
    if (dto.subject === "RESIDENT_PROGRESSIVE") {
      for (const basis of ["MONTH", "YEAR"] as const) {
        const rows = brackets.filter(item => item.basis === basis).sort((left, right) => left.bracketNo - right.bracketNo);
        if (!rows.length || rows[0].lower !== "0" || rows.some((row, index) => row.bracketNo !== index + 1 || (index > 0 && rows[index - 1].upper !== row.lower)) || rows.at(-1)!.upper !== undefined)
          fail("bad", "TAX_BRACKETS_INVALID", "Biểu " + basis + " phải liên tục từ 0, đánh số tăng dần và bậc cuối không có trần.");
      }
      if (typeof dto.settings.selfDeduction !== "string" || typeof dto.settings.dependentDeduction !== "string") fail("bad", "TAX_SETTINGS_INVALID", "Bộ lũy tiến cần selfDeduction và dependentDeduction.");
    } else if (typeof dto.settings.rate !== "string") fail("bad", "TAX_SETTINGS_INVALID", "Bộ khấu trừ cố định cần thuế suất rate.");
    const from = date(dto.effectiveFrom);
    return this.prisma.$transaction(async db => {
      await db.$queryRaw`SELECT pg_advisory_xact_lock(8210481)::text AS lock`;
      const rows = await db.taxRuleset.findMany({ where: { subject: dto.subject } });
      const latest = [...rows].sort((left, right) => right.effectiveFrom.getTime() - left.effectiveFrom.getTime())[0];
      const closable = latest && latest.effectiveTo === null && latest.effectiveFrom < from ? latest : null;
      const overlap = rows.find(row => row.id !== closable?.id && (row.effectiveTo === null || row.effectiveTo >= from));
      if (overlap) fail("conflict", "EFFECTIVE_OVERLAP", `Bộ quy tắc chồng với ${overlap.code}.`, { overlappingId: overlap.id, code: overlap.code });
      if (closable) await db.taxRuleset.update({ where: { id: closable.id }, data: { effectiveTo: new Date(from.getTime() - DAY) } });
      const row = await db.taxRuleset.create({ data: { code: dto.code, subject: dto.subject, exemptionMode: dto.exemptionMode, settings: dto.settings as Prisma.InputJsonValue, legalBasis: legalBasis!, status: dto.status, effectiveFrom: from, createdById: user.id,
        brackets: { create: brackets.map(item => ({ basis: item.basis, bracketNo: item.bracketNo, lowerBound: new Prisma.Decimal(item.lower), upperBound: item.upper ? new Prisma.Decimal(item.upper) : null, rate: new Prisma.Decimal(item.rate) })) } } });
      await this.events.changed(db, { all: true, source: "TAX_RULESET", reason: row.code, actorId: user.id });
      await this.audit.record({ actorId: user.id, entityType: "tax_ruleset", entityId: row.id, action: "CREATE_VERSION", result: "SUCCESS", newValue: { code: row.code, subject: row.subject, exemptionMode: row.exemptionMode, effectiveFrom: dto.effectiveFrom, closed: closable?.code ?? null }, ipAddress: ip }, db);
      return { id: row.id, code: row.code, closedCode: closable?.code ?? null };
    }, { isolationLevel: "Serializable" }).catch(error => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") fail("conflict", "TAX_RULESET_CODE_EXISTS", "Mã bộ quy tắc đã tồn tại.");
      throw error;
    });
  }

  /** Subject from the dated tax profile and contracts: residents need a ≥ 3-month contract for the progressive branch. */
  async subjectFor(db: Db, employeeId: string, paymentDate: Date) {
    const profile = await db.taxProfile.findFirst({ where: { employeeId, ...effectiveAt(paymentDate) } });
    if (!profile) fail("conflict", "TAX_PROFILE_MISSING", "Nhân viên chưa có hồ sơ cư trú thuế hiệu lực tại ngày chi trả.");
    if (profile!.residency === "NON_RESIDENT") return { subject: "NON_RESIDENT" as const, commitment: false, profileId: profile!.id };
    const contracts = await db.employmentContract.findMany({ where: { employeeId, status: "ACTIVE", startDate: { lte: paymentDate } } });
    const longEnough = contracts.some(contract => ["INDEFINITE", "FIXED_TERM", "PROBATION"].includes(contract.type) && (contract.endDate === null || contract.endDate >= new Date(addMonths(contract.startDate, 3).getTime() - DAY)));
    return { subject: longEnough ? "RESIDENT_PROGRESSIVE" as const : "RESIDENT_FLAT_10" as const, commitment: profile!.commitmentReference !== null, profileId: profile!.id };
  }

  async mealNorm(db: Db, paymentDate: Date) {
    const row = await db.legalParameter.findFirst({ where: { paramCode: "PIT_MEAL_EXEMPT_MONTH", scopeKey: "GLOBAL", subjectType: "ALL", applicationBasis: "PAYMENT_DATE", ...effectiveAt(paymentDate) } });
    return row ? { id: row.id, value: String(row.value) } : null;
  }

  /** Server-side calculation shared by preview, saved drafts and the payroll engine. */
  async calculate(db: Db, input: PitInput, rulesets?: Ruleset[]) {
    const paymentDate = date(input.paymentDate);
    let subject = input.subject ?? null, commitment = input.commitment ?? false, dependents = input.dependents;
    if (input.employeeId) {
      const derived = await this.subjectFor(db, input.employeeId, paymentDate);
      subject = input.subject ?? derived.subject;
      commitment = input.commitment ?? derived.commitment;
      dependents ??= await this.profiles.eligibleDependentCount(input.employeeId, input.paymentDate.slice(0, 7), db);
    }
    if (!subject) fail("bad", "TAX_SUBJECT_REQUIRED", "Cần nhân viên hoặc đối tượng thuế.");
    const context = engine(() => selectTaxContext({ rulesets: rulesets ?? [], subject: subject!, paymentDate: input.paymentDate, paymentDateStatus: input.paymentDateStatus }));
    const meal = await this.mealNorm(db, paymentDate);
    const result = engine(() => withhold(context, input.items, meal?.value ?? null, { ...input.deductions, dependents: dependents ?? 0 }, { commitment, voluntaryRequest: input.voluntaryRequest ?? false }));
    return { ...result, dependents: dependents ?? 0, mealNorm: meal };
  }

  async preview(user: AuthUser, dto: PitPreviewDto) {
    this.assertRole(user, "tax.read");
    if (dto.employeeId) await this.assertEmployee(user, dto.employeeId, "tax.read");
    return this.calculate(this.prisma, dto as PitInput, await this.loadRulesets());
  }

  async grossUpPreview(user: AuthUser, dto: GrossUpDto) {
    this.assertRole(user, "tax.read");
    const paymentDate = date(dto.paymentDate);
    let subject: TaxSubject = "RESIDENT_PROGRESSIVE", dependents = dto.dependents ?? 0, region = dto.regionCode ?? "I";
    if (dto.employeeId) {
      await this.assertEmployee(user, dto.employeeId, "tax.read");
      subject = (await this.subjectFor(this.prisma, dto.employeeId, paymentDate)).subject;
      dependents = dto.dependents ?? await this.profiles.eligibleDependentCount(dto.employeeId, dto.paymentDate.slice(0, 7));
      region = (await unitSegments(this.prisma, dto.employeeId, paymentDate, paymentDate))[0]?.wageRegionCode ?? region;
    }
    const rulesets = await this.loadRulesets();
    const taxContext = engine(() => selectTaxContext({ rulesets, subject, paymentDate: dto.paymentDate, paymentDateStatus: "PROJECTED" }));
    const parameter = async (code: string) => {
      const rows = await this.prisma.legalParameter.findMany({ where: { paramCode: code, subjectType: "ALL", applicationBasis: "WORK_DATE", scopeKey: { in: ["REGION:" + region, "GLOBAL"] }, ...effectiveAt(paymentDate) } });
      return rows.find(row => row.scopeKey !== "GLOBAL")?.value ?? rows[0]?.value ?? null;
    };
    const [minimum, baseSalary] = [await parameter("MIN_WAGE_MONTH_" + region), await parameter("BASE_SALARY_MONTH")];
    const rates = await this.prisma.insuranceRate.findMany({ where: { insuranceType: { in: ["BHXH", "BHYT", "BHTN"] }, AND: [{ OR: [{ regionCode: region }, { regionCode: null }] }, effectiveAt(paymentDate)] } });
    const insurance = (["BHXH", "BHYT", "BHTN"] as const).map(kind => rates.find(rate => rate.insuranceType === kind && rate.regionCode === region) ?? rates.find(rate => rate.insuranceType === kind && rate.regionCode === null)).filter(Boolean).map(rate => ({
      kind: rate!.insuranceType, employeeRate: rate!.employeeRate.toString(),
      cap: rate!.capReference === "NONE" ? null : new Decimal(String(rate!.capReference === "BASE_SALARY" ? baseSalary : minimum)).times(rate!.capMultiplier!.toString()).toString(),
    }));
    const net = netCalculator({ context: taxContext, dependents, insurance, insuranceFloor: minimum ? String(minimum) : null });
    const result = engine(() => grossUp(dto.net, net));
    return { ...result, subject, dependents, ruleset: taxContext.ruleset.code, insurance, insuranceFloor: minimum ? String(minimum) : null };
  }

  private detail(result: Awaited<ReturnType<PitService["calculate"]>>) {
    return cipherText(this.key, JSON.stringify(result));
  }

  /** One draft per payment key: recalculation updates the draft; locked or filed rows are never overwritten. */
  async saveDraft(db: Db, input: { employeeId: string; paymentKey: string; payrollPeriodId?: string | null; actorId: string; result: Awaited<ReturnType<PitService["calculate"]>> }) {
    const existing = await db.taxWithholding.findFirst({ where: { paymentKey: input.paymentKey, originalWithholdingId: null } });
    const data = { paymentDate: date(input.result.context.paymentDate), paymentDateStatus: input.result.context.paymentDateStatus, taxPeriod: input.result.context.taxPeriod, subject: input.result.context.subject, branch: input.result.branch, rulesetId: input.result.context.ruleset.id, hasExceptions: input.result.exemptions.exceptions.length > 0, detailCipher: this.detail(input.result), payrollPeriodId: input.payrollPeriodId ?? null };
    if (existing && existing.employeeId !== input.employeeId) fail("conflict", "WITHHOLDING_KEY_CONFLICT", "Mã lần chi đã thuộc nhân viên khác.");
    if (existing && (existing.status !== "DRAFT" || existing.filingStatus !== "NOT_FILED")) fail("conflict", "WITHHOLDING_LOCKED", "Lần chi đã khóa hoặc đã khai; lập bản ghi điều chỉnh thay vì ghi đè.", { withholdingId: existing.id });
    const row = existing
      ? await db.taxWithholding.update({ where: { id: existing.id }, data: { ...data, revision: existing.revision + 1, updatedAt: new Date() } })
      : await db.taxWithholding.create({ data: { ...data, employeeId: input.employeeId, paymentKey: input.paymentKey, createdById: input.actorId } });
    await db.taxExemptionLine.deleteMany({ where: { withholdingId: row.id } });
    await db.taxExemptionLine.createMany({ data: input.result.exemptions.lines.map(line => ({ withholdingId: row.id, sourceRef: line.sourceRef, kind: line.kind, rule: line.rule, exceptionCode: line.exception ?? null, amountsCipher: cipherText(this.key, JSON.stringify({ amountPaid: line.amountPaid, exempt: line.exempt, taxable: line.taxable })) })) });
    return row;
  }

  private view(row: Prisma.TaxWithholdingGetPayload<object>) {
    const detail = JSON.parse(plainText(this.key, row.detailCipher, "thuế")) as WithholdingResult;
    return { id: row.id, employeeId: row.employeeId, paymentKey: row.paymentKey, payrollPeriodId: row.payrollPeriodId, paymentDate: key(row.paymentDate), paymentDateStatus: row.paymentDateStatus, taxPeriod: row.taxPeriod, subject: row.subject, branch: row.branch,
      status: row.status, filingStatus: row.filingStatus, originalWithholdingId: row.originalWithholdingId, reason: row.reason, hasExceptions: row.hasExceptions, revision: row.revision, tax: detail.tax, taxableIncome: detail.taxableIncome, assessableIncome: detail.assessableIncome, detail };
  }

  async saveWithholding(user: AuthUser, dto: SaveWithholdingDto, ip?: string) {
    this.assertRole(user, "tax.manage");
    await this.assertEmployee(user, dto.employeeId, "tax.manage");
    const rulesets = await this.loadRulesets();
    return this.prisma.$transaction(async db => {
      const result = await this.calculate(db, dto as PitInput, rulesets);
      const row = await this.saveDraft(db, { employeeId: dto.employeeId, paymentKey: dto.paymentKey, payrollPeriodId: dto.payrollPeriodId, actorId: user.id, result });
      await this.audit.record({ actorId: user.id, entityType: "tax_withholding", entityId: row.id, action: row.revision === 1 ? "CREATE" : "RECALCULATE", result: "SUCCESS", newValue: { paymentKey: row.paymentKey, taxPeriod: row.taxPeriod, branch: row.branch, revision: row.revision }, ipAddress: ip }, db);
      return this.view(row);
    }, { isolationLevel: "Serializable" });
  }

  async withholdings(user: AuthUser, query: WithholdingQueryDto) {
    this.assertRole(user, "tax.read");
    if (query.employeeId) await this.assertEmployee(user, query.employeeId, "tax.read");
    else throw new BadRequestException("Chọn nhân viên để xem bản ghi khấu trừ.");
    const rows = await this.prisma.taxWithholding.findMany({ where: { employeeId: query.employeeId }, orderBy: [{ paymentDate: "desc" }, { createdAt: "asc" }] });
    return { items: rows.map(row => this.view(row)) };
  }

  async file(user: AuthUser, id: string, ip?: string) {
    this.assertRole(user, "tax.manage");
    return this.prisma.$transaction(async db => {
      const row = await db.taxWithholding.findUnique({ where: { id } });
      if (!row) throw new NotFoundException("Không tìm thấy bản ghi khấu trừ.");
      await this.assertEmployee(user, row.employeeId, "tax.manage");
      if (row.status !== "LOCKED" || row.filingStatus !== "NOT_FILED") fail("conflict", "WITHHOLDING_NOT_FILEABLE", "Chỉ khoản đã khóa và chưa khai mới được đánh dấu đã khai.");
      const updated = await db.taxWithholding.update({ where: { id }, data: { filingStatus: "FILED", updatedAt: new Date() } });
      await this.audit.record({ actorId: user.id, entityType: "tax_withholding", entityId: id, action: "FILE", result: "SUCCESS", newValue: { taxPeriod: row.taxPeriod }, ipAddress: ip }, db);
      return this.view(updated);
    });
  }

  /** Corrections never rewrite a locked/filed withholding: a new linked row carries the recalculated amount. */
  async adjust(user: AuthUser, id: string, dto: AdjustWithholdingDto, ip?: string) {
    this.assertRole(user, "tax.manage");
    const rulesets = await this.loadRulesets();
    return this.prisma.$transaction(async db => {
      const original = await db.taxWithholding.findUnique({ where: { id } });
      if (!original || original.originalWithholdingId) throw new NotFoundException("Không tìm thấy bản ghi khấu trừ gốc.");
      await this.assertEmployee(user, original.employeeId, "tax.manage");
      if (original.status === "DRAFT" && original.filingStatus === "NOT_FILED") fail("conflict", "WITHHOLDING_STILL_DRAFT", "Bản nháp được tính lại trực tiếp, không cần điều chỉnh.");
      const result = await this.calculate(db, { ...(dto as PitInput), employeeId: original.employeeId }, rulesets);
      const row = await db.taxWithholding.create({ data: { employeeId: original.employeeId, paymentKey: original.paymentKey, payrollPeriodId: original.payrollPeriodId, paymentDate: date(result.context.paymentDate), paymentDateStatus: result.context.paymentDateStatus, taxPeriod: result.context.taxPeriod, subject: result.context.subject, branch: result.branch, rulesetId: result.context.ruleset.id, originalWithholdingId: original.id, reason: dto.reason.trim(), hasExceptions: result.exemptions.exceptions.length > 0, detailCipher: this.detail(result), createdById: user.id } });
      await this.audit.record({ actorId: user.id, entityType: "tax_withholding", entityId: row.id, action: "ADJUST", result: "SUCCESS", newValue: { originalId: original.id, reason: row.reason, taxPeriod: row.taxPeriod }, ipAddress: ip }, db);
      return this.view(row);
    }, { isolationLevel: "Serializable" });
  }
}
