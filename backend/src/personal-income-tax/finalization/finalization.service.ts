import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import Decimal from "decimal.js";
import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import { AuditService } from "../../audit/audit.service";
import type { AuthUser } from "../../auth/auth.types";
import { businessDate } from "../../auth/business-date";
import { cipherText, plainText } from "../../common/data-crypto";
import { PrismaService } from "../../database/prisma.service";
import { effectiveAt, ScopeService } from "../../organization/scope.service";
import { PayrollProfileService } from "../../payroll-profile/payroll-profile.service";
import type { WithholdingResult } from "../pit-engine";
import { PitService } from "../pit.service";
import { annualSettlement, type WithholdingFacts } from "./annual-tax";

/** Excel cells are IEEE doubles; amounts are whole đồng far below 2^53, so the conversion is exact at this boundary only. */
const cell = (value: Decimal.Value) => new Decimal(value).toNumber();

type Db = Prisma.TransactionClient;
type Issue = { code: string; blocking: boolean; message: string; withholdingIds?: string[] };
type Summary = ReturnType<typeof annualSettlement>;
const key = (value: Date) => value.toISOString().slice(0, 10);
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
// Payments of 01/01–30/06/2026 were filed under the transitional rules; they stay as filed (NĐ 253/2026 Điều 70 khoản 2).
const TRANSITION = { from: "2026-01-01", to: "2026-06-30" };
function fail(kind: "conflict" | "bad" | "forbidden" | "missing", code: string, message: string, details?: Record<string, unknown>): never {
  const body = { code, message, ...(details ? { details } : {}) };
  throw kind === "conflict" ? new ConflictException(body) : kind === "forbidden" ? new ForbiddenException(body) : kind === "missing" ? new NotFoundException(body) : new BadRequestException(body);
}
export const INELIGIBLE_LABELS: Record<string, string> = {
  NO_TAX_PROFILE: "Chưa có hồ sơ thuế hiệu lực trong năm", NOT_AUTHORIZED: "Không ủy quyền quyết toán cho tổ chức chi trả",
  NON_RESIDENT: "Cá nhân không cư trú", NON_PROGRESSIVE_INCOME: "Có thu nhập khấu trừ 10%/20% (không theo biểu lũy tiến)",
};

@Injectable()
export class TaxFinalizationService {
  private readonly key: Buffer;
  constructor(private readonly prisma: PrismaService, private readonly scope: ScopeService, private readonly audit: AuditService, private readonly pit: PitService, private readonly profiles: PayrollProfileService, config: ConfigService) {
    this.key = Buffer.from(config.getOrThrow<string>("HR_DATA_KEY"), "base64");
  }
  private encrypt(value: unknown) { return cipherText(this.key, JSON.stringify(value)); }
  private decrypt<T>(value: string): T { return JSON.parse(plainText(this.key, value, "thuế")); }

  private assertYear(year: number) { if (!Number.isInteger(year) || year < 2020 || year > 2100) fail("bad", "YEAR_INVALID", "Năm quyết toán không hợp lệ."); }

  /**
   * KT employees with an in-scope assignment at any time from the start of the tax year until today (finalization
   * happens after year end), minus exclusions.
   */
  private async employees(user: AuthUser, permission: "tax.read" | "tax.manage", year: number, db: Db = this.prisma) {
    if (!user.roles.includes("KT") || !user.permissions.includes(permission)) fail("forbidden", "FORBIDDEN", "Chỉ KT được lập quyết toán thuế.");
    const scope = await this.scope.load(user, permission, db);
    const from = new Date(Date.UTC(year, 0, 1)), to = new Date(Date.UTC(year, 11, 31)), today = businessDate();
    return db.employee.findMany({
      where: { assignments: { some: { orgUnitId: { in: [...scope.allowed] }, effectiveFrom: { lte: today > to ? today : to }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }] } },
        exclusions: { none: { userAccountId: user.id, ...effectiveAt(businessDate()) } }, taxWithholdings: { some: { paymentDate: { gte: from, lte: to } } } },
      select: { id: true, code: true, fullName: true }, orderBy: { code: "asc" },
    });
  }

  /** Everything one employee's draft is computed from, plus the data checks (FR-8.5.2). */
  private async compute(db: Db, employeeId: string, year: number) {
    const from = new Date(Date.UTC(year, 0, 1)), to = new Date(Date.UTC(year, 11, 31));
    const profile = await db.taxProfile.findFirst({ where: { employeeId, effectiveFrom: { lte: to }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }] }, orderBy: { effectiveFrom: "desc" } });
    const all = await db.taxWithholding.findMany({ where: { employeeId, paymentDate: { gte: from, lte: to } }, include: { ruleset: { select: { code: true } } }, orderBy: [{ paymentDate: "asc" }, { createdAt: "asc" }] });
    // The latest record per payment (an adjustment supersedes the original it links to) is what was withheld.
    const latest = new Map<string, (typeof all)[number]>();
    for (const row of all) latest.set(row.paymentKey, row);
    const effective = [...latest.values()];
    let ineligible: string | null = null;
    if (!profile) ineligible = "NO_TAX_PROFILE";
    else if (profile.residency !== "RESIDENT") ineligible = "NON_RESIDENT";
    else if (!profile.finalizationAuthorized) ineligible = "NOT_AUTHORIZED";
    else if (effective.some(row => row.branch !== "PROGRESSIVE")) ineligible = "NON_PROGRESSIVE_INCOME";
    const issues: Issue[] = [];
    const projected = effective.filter(row => row.paymentDateStatus === "PROJECTED");
    if (projected.length) issues.push({ code: "PROJECTED_PAYMENT_IN_YEAR", blocking: true, message: projected.length + " lần chi trong năm chưa có ngày chi thực tế.", withholdingIds: projected.map(row => row.id) });
    const changed = effective.filter(row => row.contextFlag === "TAX_CONTEXT_CHANGED");
    if (changed.length) issues.push({ code: "TAX_CONTEXT_CHANGED", blocking: true, message: changed.length + " lần chi đổi ngữ cảnh thuế khi ghi ngày chi thực tế; lập điều chỉnh trước khi quyết toán.", withholdingIds: changed.map(row => row.id) });
    const exceptions = effective.filter(row => row.hasExceptions);
    if (exceptions.length) issues.push({ code: "TAX_EXCEPTION_UNRESOLVED", blocking: false, message: exceptions.length + " lần chi còn ngoại lệ miễn thuế chưa có căn cứ.", withholdingIds: exceptions.map(row => row.id) });
    const dependents = await db.employeeDependent.findMany({ where: { employeeId }, orderBy: [{ dependentKey: "asc" }, { version: "desc" }] });
    const latestDependent = new Map<string, (typeof dependents)[number]>();
    for (const row of dependents) if (!latestDependent.has(row.dependentKey)) latestDependent.set(row.dependentKey, row);
    const current = [...latestDependent.values()];
    const missing = current.filter(row => row.deductionFromMonth <= year + "-12" && (!row.deductionToMonth || row.deductionToMonth >= year + "-01") && !row.evidenceReference.trim());
    if (missing.length) issues.push({ code: "DEPENDENT_EVIDENCE_MISSING", blocking: false, message: missing.length + " người phụ thuộc thiếu chứng từ." });
    let dependentMonths = 0;
    for (let month = 1; month <= 12; month++) dependentMonths += await this.profiles.eligibleDependentCount(employeeId, year + "-" + String(month).padStart(2, "0"), db);
    const rulesets = await this.pit.loadRulesets(db);
    const ruleset = rulesets.find(row => row.subject === "RESIDENT_PROGRESSIVE" && row.effectiveFrom <= key(to) && (!row.effectiveTo || row.effectiveTo >= key(to)));
    if (!ruleset) fail("conflict", "TAX_RULESET_MISSING", "Không có bộ quy tắc lũy tiến hiệu lực cho năm " + year + ".");
    const selfMonths = Number((await db.legalParameter.findFirst({ where: { paramCode: "PIT_FINALIZATION_SELF_DEDUCTION_MONTHS", scopeKey: "GLOBAL", ...effectiveAt(to) }, orderBy: { effectiveFrom: "desc" } }))?.value ?? 12);
    const facts: Array<WithholdingFacts & { revision: number; original: boolean; status: string }> = effective.filter(row => row.paymentDateStatus === "ACTUAL").map(row => {
      const detail = this.decrypt<WithholdingResult>(row.detailCipher);
      const paymentDate = key(row.paymentDate);
      return { id: row.id, paymentKey: row.paymentKey, paymentDate, rulesetCode: row.ruleset.code, branch: row.branch, filingStatus: row.filingStatus, status: row.status, revision: row.revision,
        taxable: detail.exemptions.taxable, exempt: detail.exemptions.exempt, insurance: detail.deductions.insurance ?? "0", voluntaryPension: detail.deductions.voluntaryPension ?? "0", charity: detail.deductions.charity ?? "0",
        medicalEducation: detail.deductions.medicalEducation ?? "0", tax: detail.tax, original: paymentDate >= TRANSITION.from && paymentDate <= TRANSITION.to };
    });
    const summary = ineligible ? null : annualSettlement({ rows: facts, ruleset, selfMonths, dependentMonths });
    const sourceHash = createHash("sha256").update(JSON.stringify({ profile: profile?.id ?? null, ruleset: ruleset.id, rows: all.map(row => [row.id, row.revision, row.paymentDateStatus, key(row.paymentDate), row.contextFlag, row.filingStatus]),
      dependents: current.map(row => [row.id, row.version]), selfMonths, summary })).digest("hex");
    return { profile, ruleset, ineligible, issues, facts, summary, sourceHash };
  }

  async run(user: AuthUser, dto: { year: number }, ip?: string) {
    this.assertYear(dto.year);
    const employees = await this.employees(user, "tax.manage", dto.year);
    const created: string[] = [], unchanged: string[] = [], ineligible: Array<{ employee: (typeof employees)[number]; reason: string; label: string }> = [];
    for (const employee of employees) {
      await this.prisma.$transaction(async db => {
        await db.$queryRaw`SELECT pg_advisory_xact_lock(8210497, hashtext(${employee.id + dto.year}))::text AS lock`;
        const result = await this.compute(db, employee.id, dto.year);
        if (result.ineligible || !result.summary || !result.profile) { ineligible.push({ employee, reason: result.ineligible!, label: INELIGIBLE_LABELS[result.ineligible!] }); return; }
        const latest = await db.annualTaxFinalization.findFirst({ where: { taxYear: dto.year, employeeId: employee.id }, orderBy: { version: "desc" } });
        if (latest?.sourceHash === result.sourceHash) { unchanged.push(latest.id); return; }
        const row = await db.annualTaxFinalization.create({ data: {
          taxYear: dto.year, employeeId: employee.id, version: (latest?.version ?? 0) + 1, rulesetId: result.ruleset.id, taxProfileId: result.profile.id, summaryCipher: this.encrypt(result.summary),
          direction: result.summary.direction, issues: json(result.issues), sourceHash: result.sourceHash, createdById: user.id,
          lines: { create: [
            ...result.facts.map(fact => ({ kind: fact.original ? "WITHHELD_ORIGINAL" : "WITHHELD", withholdingId: fact.id, detailCipher: this.encrypt(fact) })),
            { kind: "SETTLEMENT", withholdingId: null, detailCipher: this.encrypt({ annualTax: result.summary.annualTax, withheld: result.summary.withheld, difference: result.summary.difference, direction: result.summary.direction }) },
          ] },
        } });
        await this.audit.record({ actorId: user.id, entityType: "annual_tax_finalization", entityId: row.id, action: "CREATE_VERSION", result: "SUCCESS",
          newValue: { year: dto.year, employeeId: employee.id, version: row.version, sourceHash: row.sourceHash, issues: result.issues.map(issue => issue.code) }, ipAddress: ip }, db);
        created.push(row.id);
      }, { timeout: 60_000 });
    }
    return { year: dto.year, created: created.length, unchanged: unchanged.length, ineligible, ...(await this.list(user, { year: dto.year })) };
  }

  private view(row: Prisma.AnnualTaxFinalizationGetPayload<{ include: { employee: { select: { id: true; code: true; fullName: true } }; ruleset: { select: { code: true } } } }>) {
    return { id: row.id, taxYear: row.taxYear, employee: row.employee, version: row.version, status: row.status, ruleset: row.ruleset.code, direction: row.direction, issues: row.issues as Issue[],
      sourceHash: row.sourceHash, summary: this.decrypt<Summary>(row.summaryCipher), createdAt: row.createdAt.toISOString(), completedAt: row.completedAt?.toISOString() ?? null };
  }

  /** Latest version per employee of the year. */
  async list(user: AuthUser, query: { year: number }) {
    this.assertYear(query.year);
    const employees = await this.employees(user, "tax.read", query.year);
    const rows = await this.prisma.annualTaxFinalization.findMany({ where: { taxYear: query.year, employeeId: { in: employees.map(row => row.id) } }, include: { employee: { select: { id: true, code: true, fullName: true } }, ruleset: { select: { code: true } } }, orderBy: [{ employee: { code: "asc" } }, { version: "desc" }] });
    const latest = new Map<string, (typeof rows)[number]>();
    for (const row of rows) if (!latest.has(row.employeeId)) latest.set(row.employeeId, row);
    return { items: [...latest.values()].map(row => this.view(row)) };
  }

  async detail(user: AuthUser, id: string) {
    const row = await this.prisma.annualTaxFinalization.findUnique({ where: { id }, include: { employee: { select: { id: true, code: true, fullName: true } }, ruleset: { select: { code: true } }, lines: true } });
    if (!row) fail("missing", "NOT_FOUND", "Không tìm thấy dự thảo quyết toán.");
    if (!(await this.employees(user, "tax.read", row.taxYear)).some(item => item.id === row.employeeId)) fail("forbidden", "OUT_OF_SCOPE", "Nhân viên nằm ngoài phạm vi.");
    return { finalization: this.view(row), lines: row.lines.map(line => ({ id: line.id, kind: line.kind, withholdingId: line.withholdingId, ...this.decrypt<Record<string, unknown>>(line.detailCipher) })) };
  }

  /** DONE only when nothing blocks and the sources still match the reviewed version (FR-8.5.2). */
  async complete(user: AuthUser, id: string, dto: { sourceHash: string }, ip?: string) {
    await this.prisma.$transaction(async db => {
      await db.$queryRaw`SELECT id FROM annual_tax_finalization WHERE id = ${id}::uuid FOR UPDATE`;
      const row = await db.annualTaxFinalization.findUnique({ where: { id } });
      if (!row) fail("missing", "NOT_FOUND", "Không tìm thấy dự thảo quyết toán.");
      if (!(await this.employees(user, "tax.manage", row.taxYear, db)).some(item => item.id === row.employeeId)) fail("forbidden", "OUT_OF_SCOPE", "Nhân viên nằm ngoài phạm vi.");
      if (row.status !== "DRAFT") fail("conflict", "TAX_FINALIZATION_DONE", "Dự thảo đã hoàn tất.");
      const latest = await db.annualTaxFinalization.findFirst({ where: { taxYear: row.taxYear, employeeId: row.employeeId }, orderBy: { version: "desc" }, select: { id: true } });
      if (latest?.id !== id) fail("conflict", "TAX_FINALIZATION_SUPERSEDED", "Đã có phiên bản dự thảo mới hơn.");
      if (row.sourceHash !== dto.sourceHash) fail("conflict", "STALE_REVISION", "Dự thảo đã thay đổi; tải lại.");
      const result = await this.compute(db, row.employeeId, row.taxYear);
      const blocking = result.issues.filter(issue => issue.blocking);
      if (blocking.length) fail("conflict", blocking[0].code, "Chưa hoàn tất được: " + blocking.map(issue => issue.message).join(" "), { issues: blocking });
      if (result.sourceHash !== row.sourceHash) fail("conflict", "FINALIZATION_SOURCE_CHANGED", "Dữ liệu khấu trừ đã đổi sau khi lập dự thảo; lập lại phiên bản mới.");
      await db.annualTaxFinalization.update({ where: { id }, data: { status: "DONE", completedAt: new Date(), completedById: user.id } });
      await this.audit.record({ actorId: user.id, entityType: "annual_tax_finalization", entityId: id, action: "COMPLETE", result: "SUCCESS", newValue: { year: row.taxYear, employeeId: row.employeeId, version: row.version, sourceHash: row.sourceHash }, ipAddress: ip }, db);
    });
    return this.detail(user, id);
  }

  /** Summary declaration + per-person appendix in the configured layout; no electronic filing (FR-8.5.2). */
  async export(user: AuthUser, query: { year: number }, ip?: string): Promise<Buffer> {
    const { items } = await this.list(user, query);
    const template = await this.prisma.taxFinalizationTemplate.findFirst({ where: { active: true }, orderBy: [{ code: "asc" }, { version: "desc" }] });
    if (!template) fail("conflict", "TEMPLATE_MISSING", "Chưa cấu hình mẫu xuất quyết toán.");
    const identities = await this.prisma.employeeIdentity.findMany({ where: { employeeId: { in: items.map(item => item.employee.id) } }, select: { employeeId: true, taxCodeCipher: true } });
    const taxCodes = new Map(identities.map(row => [row.employeeId, row.taxCodeCipher ? plainText(this.key, row.taxCodeCipher, "hồ sơ") : ""]));
    const total = (pick: (summary: Summary) => string) => items.reduce((sum, item) => sum.plus(pick(item.summary)), new Decimal(0)).toNumber();
    const draft = items.some(item => item.status !== "DONE");
    const book = new ExcelJS.Workbook();
    const summary = book.addWorksheet("To khai tong hop");
    summary.addRow([template.name + " — năm " + query.year + (draft ? " (DỰ THẢO, còn bản chưa hoàn tất)" : "")]);
    summary.addRow(["Chỉ tiêu", "Giá trị"]);
    for (const [label, value] of [
      ["Số cá nhân ủy quyền quyết toán", items.length], ["Tổng thu nhập", total(row => row.totalIncome)], ["Thu nhập miễn", total(row => row.exempt)], ["Thu nhập chịu thuế", total(row => row.taxableIncome)],
      ["Tổng giảm trừ", total(row => row.totalDeductions)], ["Thu nhập tính thuế", total(row => row.assessableIncome)], ["Thuế phải nộp năm", total(row => row.annualTax)], ["Thuế đã khấu trừ", total(row => row.withheld)],
      ["Thuế còn phải nộp", items.filter(item => item.direction === "PAYABLE").reduce((sum, item) => sum + Number(item.summary.difference), 0)],
      ["Thuế nộp thừa", -items.filter(item => item.direction === "REFUND").reduce((sum, item) => sum + Number(item.summary.difference), 0)],
    ] as const) summary.addRow([label, value]);
    const appendix = book.addWorksheet("Phu luc ca nhan");
    const columns = template.appendixColumns as Array<{ field: string; header: string }>;
    appendix.addRow(columns.map(column => column.header));
    for (const item of items) {
      const d = item.summary.deductions;
      const value: Record<string, string | number> = { employeeCode: item.employee.code, fullName: item.employee.fullName, taxCode: taxCodes.get(item.employee.id) ?? "",
        totalIncome: cell(item.summary.totalIncome), exempt: cell(item.summary.exempt), taxableIncome: cell(item.summary.taxableIncome), selfDeduction: cell(d.self),
        dependentMonths: item.summary.dependentMonths, dependentDeduction: cell(d.dependents), insurance: cell(d.insurance),
        otherDeductions: cell(new Decimal(d.voluntaryPension).add(d.charity).add(d.medicalEducation)),
        assessableIncome: cell(item.summary.assessableIncome), annualTax: cell(item.summary.annualTax), withheld: cell(item.summary.withheld), difference: cell(item.summary.difference) };
      appendix.addRow(columns.map(column => value[column.field] ?? ""));
    }
    await this.audit.record({ actorId: user.id, entityType: "annual_tax_finalization", entityId: "export:" + query.year, action: "EXPORT", result: "SUCCESS", newValue: { year: query.year, people: items.length, draft, template: template.code + "@" + template.version }, ipAddress: ip, scopeOrgUnitId: null });
    return Buffer.from(await book.xlsx.writeBuffer());
  }
}
