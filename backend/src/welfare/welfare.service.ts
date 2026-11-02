import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, type BenefitTaxTreatment, type PolicyStatus } from "@prisma/client";
import Decimal from "decimal.js";
import ExcelJS from "exceljs";
import { AuditService } from "../audit/audit.service";
import { businessDate } from "../auth/business-date";
import type { AuthUser } from "../auth/auth.types";
import { cipherText, plainText } from "../common/data-crypto";
import { PrismaService } from "../database/prisma.service";
import { effectiveAt, ScopeService } from "../organization/scope.service";
import { PayrollSourceEvents } from "../payroll-events/payroll-source-events.service";
import { workedMonths } from "../personnel/termination-rules";
import { EligibilityError, evaluate, parseEligibility, type EligibilityRule, type EmployeeFacts } from "./eligibility";

type Db = Prisma.TransactionClient;
const DAY = 86400000;
const date = (value: string) => new Date(value + "T00:00:00.000Z");
const key = (value: Date) => value.toISOString().slice(0, 10);
function fail(kind: "conflict" | "bad" | "forbidden" | "missing", code: string, message: string, details?: Record<string, unknown>): never {
  const body = { code, message, ...(details ? { details } : {}) };
  throw kind === "conflict" ? new ConflictException(body) : kind === "forbidden" ? new ForbiddenException(body) : kind === "missing" ? new NotFoundException(body) : new BadRequestException(body);
}
function realDate(value: string, label: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || key(date(value)) !== value) fail("bad", "DATE_INVALID", label + " không hợp lệ.");
  return date(value);
}
export const CATEGORY_LABELS: Record<string, string> = {
  HEALTH_INSURANCE: "Bảo hiểm sức khỏe", HEALTH_CHECK: "Khám sức khỏe", MEAL: "Ăn ca", SHUTTLE: "Xe đưa đón", PHONE: "Điện thoại", UNIFORM: "Đồng phục",
  GIFT: "Quà lễ Tết/sinh nhật", FAMILY_EVENT: "Hiếu hỉ", TRAVEL: "Du lịch", TRAINING: "Đào tạo", HOUSING: "Hỗ trợ nhà ở", CHILDCARE: "Nuôi con nhỏ",
  SEVERANCE: "Trợ cấp thôi việc", JOB_LOSS: "Trợ cấp mất việc làm",
};

export interface VersionInput { name: string; amount: string; taxTreatment: BenefitTaxTreatment; exemptLimit?: string; payrollIncluded: boolean; eligibility: unknown; decisionReference: string; status: PolicyStatus; active?: boolean; effectiveFrom: string; effectiveTo?: string }

@Injectable()
export class WelfareService {
  private readonly key: Buffer;
  constructor(private readonly prisma: PrismaService, private readonly scope: ScopeService, private readonly audit: AuditService, private readonly events: PayrollSourceEvents, config: ConfigService) {
    this.key = Buffer.from(config.getOrThrow<string>("HR_DATA_KEY"), "base64");
  }

  private async access(user: AuthUser, permission: "welfare.read" | "welfare.manage", db: Db = this.prisma) {
    if (!user.roles.includes("KT") || !user.permissions.includes(permission)) fail("forbidden", "FORBIDDEN", "Chỉ KT được xem hoặc quản lý phúc lợi.");
    return this.scope.load(user, permission, db);
  }

  private version(dto: VersionInput) {
    if (!/^\d+$/.test(dto.amount)) fail("bad", "AMOUNT_INVALID", "Mức hưởng là số tiền nguyên không âm.");
    if ((dto.taxTreatment === "EXEMPT_UP_TO_LIMIT") !== (dto.exemptLimit !== undefined)) fail("bad", "EXEMPT_LIMIT_INVALID", "Định mức miễn thuế chỉ và bắt buộc khai báo với cách xử lý miễn theo định mức.");
    if (dto.exemptLimit !== undefined && !/^\d+$/.test(dto.exemptLimit)) fail("bad", "EXEMPT_LIMIT_INVALID", "Định mức miễn thuế là số tiền nguyên không âm.");
    let eligibility: EligibilityRule;
    try { eligibility = parseEligibility(dto.eligibility ?? {}); } catch (error) { if (error instanceof EligibilityError) fail("bad", "ELIGIBILITY_INVALID", error.message); throw error; }
    const from = realDate(dto.effectiveFrom, "Ngày hiệu lực"), to = dto.effectiveTo ? realDate(dto.effectiveTo, "Ngày hết hiệu lực") : null;
    if (to && to < from) fail("bad", "DATE_RANGE_INVALID", "Ngày hết hiệu lực phải từ ngày hiệu lực trở đi.");
    if (!dto.decisionReference.trim()) fail("bad", "DECISION_REQUIRED", "Phúc lợi cần quyết định/quy chế làm căn cứ.");
    return { name: dto.name.trim(), amount: new Prisma.Decimal(dto.amount), taxTreatment: dto.taxTreatment, exemptLimit: dto.exemptLimit !== undefined ? new Prisma.Decimal(dto.exemptLimit) : null,
      payrollIncluded: dto.payrollIncluded, eligibility: eligibility as Prisma.InputJsonValue, decisionReference: dto.decisionReference.trim(), status: dto.status, active: dto.active ?? true, effectiveFrom: from, effectiveTo: to };
  }

  private versionView(row: { id: string; name: string; amount: Prisma.Decimal; taxTreatment: string; exemptLimit: Prisma.Decimal | null; payrollIncluded: boolean; eligibility: Prisma.JsonValue; decisionReference: string; status: string; active: boolean; effectiveFrom: Date; effectiveTo: Date | null }) {
    return { id: row.id, name: row.name, amount: row.amount.toString(), taxTreatment: row.taxTreatment, exemptLimit: row.exemptLimit?.toString() ?? null, payrollIncluded: row.payrollIncluded, eligibility: row.eligibility,
      decisionReference: row.decisionReference, status: row.status, active: row.active, effectiveFrom: key(row.effectiveFrom), effectiveTo: row.effectiveTo ? key(row.effectiveTo) : null };
  }

  // ---- Catalog (FR-9.1.1, 9.1.3) ----

  async catalog(user: AuthUser, query: { asOf?: string }) {
    const scope = await this.access(user, "welfare.read");
    const asOf = query.asOf ? realDate(query.asOf, "Ngày xem") : businessDate();
    const rows = await this.prisma.benefitCatalog.findMany({ where: { orgUnitId: { in: await this.visibleCatalogUnits(scope) } }, include: { orgUnit: { select: { code: true } }, versions: { orderBy: { effectiveFrom: "desc" } } }, orderBy: { code: "asc" } });
    return { asOf: key(asOf), items: rows.map(row => {
      const current = row.versions.find(version => version.effectiveFrom <= asOf && (!version.effectiveTo || version.effectiveTo >= asOf));
      return { id: row.id, code: row.code, category: row.category, categoryLabel: CATEGORY_LABELS[row.category], orgUnitId: row.orgUnitId, orgUnitCode: row.orgUnit.code,
        current: current ? this.versionView(current) : null, versions: row.versions.map(version => this.versionView(version)) };
    }) };
  }

  /** Catalogs of the KT's units and every ancestor (a company catalog applies to every site). */
  private async visibleCatalogUnits(scope: Awaited<ReturnType<ScopeService["load"]>>) {
    const versions = await this.prisma.orgUnitVersion.findMany({ where: effectiveAt(scope.asOf), select: { orgUnitId: true, parentId: true } });
    const parent = new Map(versions.map(row => [row.orgUnitId, row.parentId]));
    const units = new Set<string>();
    for (const id of scope.allowed) for (let current: string | null | undefined = id; current && !units.has(current); current = parent.get(current)) units.add(current);
    return [...units];
  }

  async createCatalog(user: AuthUser, dto: { code: string; orgUnitId: string; category: string; version: VersionInput }, ip?: string) {
    if (!CATEGORY_LABELS[dto.category] || ["SEVERANCE", "JOB_LOSS"].includes(dto.category)) fail("bad", "CATEGORY_INVALID", "Loại phúc lợi không hợp lệ.");
    const data = this.version(dto.version);
    return this.prisma.$transaction(async db => {
      const scope = await this.access(user, "welfare.manage", db);
      if (!scope.allowed.has(dto.orgUnitId) || !scope.versions.some(version => version.orgUnitId === dto.orgUnitId && ["COMPANY", "SITE"].includes(version.type))) fail("forbidden", "OUT_OF_SCOPE", "Danh mục phúc lợi thuộc công ty hoặc cơ sở trong phạm vi được cấp.");
      const row = await db.benefitCatalog.create({ data: { code: dto.code.trim().toUpperCase(), orgUnitId: dto.orgUnitId, category: dto.category, versions: { create: { ...data, createdById: user.id } } }, include: { versions: true } });
      await this.audit.record({ actorId: user.id, entityType: "benefit_catalog", entityId: row.id, action: "CREATE", result: "SUCCESS", newValue: { code: row.code, category: row.category, version: this.versionView(row.versions[0]), orgUnitId: dto.orgUnitId }, ipAddress: ip }, db);
      return { id: row.id, code: row.code, version: this.versionView(row.versions[0]) };
    });
  }

  /** A new version starts after the latest one; an open predecessor is closed the day before (no overlap, no rewrite). */
  async addVersion(user: AuthUser, catalogId: string, dto: VersionInput, ip?: string) {
    const data = this.version(dto);
    return this.prisma.$transaction(async db => {
      const scope = await this.access(user, "welfare.manage", db);
      await db.$queryRaw`SELECT id FROM benefit_catalog WHERE id = ${catalogId}::uuid FOR UPDATE`;
      const catalog = await db.benefitCatalog.findUnique({ where: { id: catalogId }, include: { versions: { orderBy: { effectiveFrom: "desc" } } } });
      if (!catalog) fail("missing", "NOT_FOUND", "Không tìm thấy phúc lợi.");
      if (!scope.allowed.has(catalog.orgUnitId)) fail("forbidden", "OUT_OF_SCOPE", "Phúc lợi nằm ngoài phạm vi được cấp.");
      const latest = catalog.versions[0];
      if (latest && data.effectiveFrom <= latest.effectiveFrom) fail("conflict", "VERSION_ORDER", "Phiên bản mới phải hiệu lực sau phiên bản " + key(latest.effectiveFrom) + ".");
      if (latest?.effectiveTo && latest.effectiveTo >= data.effectiveFrom) fail("conflict", "EFFECTIVE_OVERLAP", "Khoảng hiệu lực chồng với phiên bản trước.");
      if (latest && !latest.effectiveTo) await db.benefitCatalogVersion.update({ where: { id: latest.id }, data: { effectiveTo: new Date(data.effectiveFrom.getTime() - DAY) } });
      const row = await db.benefitCatalogVersion.create({ data: { ...data, catalogId, createdById: user.id } });
      await this.audit.record({ actorId: user.id, entityType: "benefit_catalog", entityId: catalogId, action: "CREATE_VERSION", result: "SUCCESS", oldValue: latest ? this.versionView(latest) : undefined, newValue: { ...this.versionView(row), orgUnitId: catalog.orgUnitId }, ipAddress: ip }, db);
      return { version: this.versionView(row) };
    });
  }

  // ---- Eligibility and draft batches (FR-9.2.1, 9.2.2) ----

  private async facts(db: Db, employeeIds: string[], at: Date): Promise<Map<string, EmployeeFacts & { orgUnitId: string | null; costCenterCode: string | null }>> {
    const [employees, versions] = await Promise.all([
      db.employee.findMany({ where: { id: { in: employeeIds } }, select: { id: true, hireDate: true, terminationDate: true, jobTitle: { select: { jobGrade: { select: { code: true } } } },
        assignments: { where: { isPrimary: true, ...effectiveAt(at) }, select: { orgUnitId: true } },
        contracts: { where: { status: "ACTIVE", startDate: { lte: at }, AND: [{ OR: [{ endDate: null }, { endDate: { gte: at } }] }, { OR: [{ terminatedOn: null }, { terminatedOn: { gte: at } }] }] }, orderBy: { startDate: "desc" }, select: { type: true } } } }),
      db.orgUnitVersion.findMany({ where: effectiveAt(at), select: { orgUnitId: true, parentId: true, costCenterCode: true } }),
    ]);
    const unit = new Map(versions.map(row => [row.orgUnitId, row]));
    const result = new Map<string, EmployeeFacts & { orgUnitId: string | null; costCenterCode: string | null }>();
    for (const employee of employees) {
      const orgUnitId = employee.assignments[0]?.orgUnitId ?? null;
      const unitPath: string[] = [];
      let costCenterCode: string | null = null;
      for (let current: string | null = orgUnitId; current && !unitPath.includes(current); current = unit.get(current)?.parentId ?? null) { unitPath.push(current); costCenterCode ??= unit.get(current)?.costCenterCode ?? null; }
      const employed = employee.hireDate <= at && (!employee.terminationDate || employee.terminationDate >= at);
      result.set(employee.id, { employed, serviceMonths: employed ? workedMonths(key(employee.hireDate), key(new Date(at.getTime() - DAY))) : 0, jobGradeCode: employee.jobTitle?.jobGrade.code ?? null,
        contractType: employee.contracts[0]?.type ?? null, unitPath, orgUnitId, costCenterCode });
    }
    return result;
  }

  private async batchRow(db: Db, user: AuthUser, id: string, permission: "welfare.read" | "welfare.manage") {
    const scope = await this.access(user, permission, db);
    const batch = await db.benefitAllocationBatch.findUnique({ where: { id }, include: { version: true, catalog: true } });
    if (!batch) fail("missing", "NOT_FOUND", "Không tìm thấy lô cấp phát.");
    if (!scope.allowed.has(batch.scopeOrgUnitId)) fail("forbidden", "OUT_OF_SCOPE", "Lô cấp phát nằm ngoài phạm vi được cấp.");
    return { batch, scope };
  }

  /** Employees of the batch scope (subtree) on the reference date, excluding those hidden from this KT. */
  private async scopeEmployees(db: Db, user: AuthUser, scopeOrgUnitId: string, allowed: Set<string>, at: Date) {
    const versions = await db.orgUnitVersion.findMany({ where: effectiveAt(at), select: { orgUnitId: true, parentId: true } });
    const children = new Map<string, string[]>();
    for (const row of versions) if (row.parentId) children.set(row.parentId, [...(children.get(row.parentId) ?? []), row.orgUnitId]);
    const units = new Set<string>(), pending = [scopeOrgUnitId];
    while (pending.length) { const id = pending.pop()!; if (units.has(id) || !allowed.has(id)) continue; units.add(id); pending.push(...(children.get(id) ?? [])); }
    return db.employee.findMany({ where: { assignments: { some: { isPrimary: true, orgUnitId: { in: [...units] }, ...effectiveAt(at) } }, exclusions: { none: { userAccountId: user.id, ...effectiveAt(businessDate()) } } }, select: { id: true }, orderBy: { code: "asc" } });
  }

  /** Re-evaluates every candidate (FR-9.2.2): eligibility can change between edits; manual keeps need a reason. */
  private async recheck(db: Db, batch: { id: string; referenceDate: Date; version: { eligibility: Prisma.JsonValue } }) {
    const rule = parseEligibility(batch.version.eligibility);
    const candidates = await db.benefitAllocationCandidate.findMany({ where: { batchId: batch.id } });
    const facts = await this.facts(db, candidates.map(row => row.employeeId), batch.referenceDate);
    const changed: string[] = [];
    for (const row of candidates) {
      const result = evaluate(rule, facts.get(row.employeeId)!);
      if (!result.eligible && !row.manualReason) { await db.benefitAllocationCandidate.delete({ where: { batchId_employeeId: { batchId: batch.id, employeeId: row.employeeId } } }); changed.push(row.employeeId); continue; }
      if (result.eligible !== row.eligible || JSON.stringify(result.failed) !== JSON.stringify(row.failedRules))
        await db.benefitAllocationCandidate.update({ where: { batchId_employeeId: { batchId: batch.id, employeeId: row.employeeId } }, data: { eligible: result.eligible, failedRules: result.failed as unknown as Prisma.InputJsonValue } });
    }
    return changed;
  }

  async createBatch(user: AuthUser, dto: { catalogId: string; periodCode: string; referenceDate: string; scopeOrgUnitId: string; payrollPeriodId?: string; note?: string }, ip?: string) {
    const referenceDate = realDate(dto.referenceDate, "Ngày tham chiếu");
    if (!/^[A-Z0-9][A-Z0-9_-]{1,31}$/.test(dto.periodCode)) fail("bad", "PERIOD_CODE_INVALID", "Mã kỳ phúc lợi gồm 2–32 chữ in hoa, số, gạch (ví dụ 2026-10, TET-2027).");
    const id = await this.prisma.$transaction(async db => {
      const scope = await this.access(user, "welfare.manage", db);
      if (!scope.allowed.has(dto.scopeOrgUnitId)) fail("forbidden", "OUT_OF_SCOPE", "Đối tượng cấp phát nằm ngoài phạm vi được cấp.");
      const catalog = await db.benefitCatalog.findUnique({ where: { id: dto.catalogId }, include: { versions: { where: effectiveAt(referenceDate) } } });
      if (!catalog || !(await this.visibleCatalogUnits(scope)).includes(catalog.orgUnitId)) fail("missing", "NOT_FOUND", "Không tìm thấy phúc lợi trong phạm vi.");
      const version = catalog.versions[0];
      if (!version?.active) fail("conflict", "BENEFIT_NOT_EFFECTIVE", "Phúc lợi không có phiên bản đang áp dụng tại ngày tham chiếu.");
      if (version.payrollIncluded) {
        if (!dto.payrollPeriodId) fail("bad", "PAYROLL_PERIOD_REQUIRED", "Phúc lợi đưa vào lương cần chọn kỳ lương nhận khoản.");
        const period = await db.payrollPeriod.findUnique({ where: { id: dto.payrollPeriodId } });
        if (!period || period.status !== "OPEN" || !scope.allowed.has(period.siteOrgUnitId)) fail("conflict", "PAYROLL_PERIOD_INVALID", "Kỳ lương phải đang mở và thuộc phạm vi.");
      } else if (dto.payrollPeriodId) fail("bad", "PAYROLL_PERIOD_NOT_ALLOWED", "Phúc lợi không đưa vào lương thì không gắn kỳ lương.");
      const rule = parseEligibility(version.eligibility);
      const employees = await this.scopeEmployees(db, user, dto.scopeOrgUnitId, scope.allowed, referenceDate);
      const facts = await this.facts(db, employees.map(row => row.id), referenceDate);
      const batch = await db.benefitAllocationBatch.create({ data: { code: catalog.code + "-" + dto.periodCode + "-" + Date.now().toString(36).toUpperCase(), catalogId: catalog.id, versionId: version.id, periodCode: dto.periodCode,
        referenceDate, scopeOrgUnitId: dto.scopeOrgUnitId, payrollPeriodId: dto.payrollPeriodId ?? null, note: dto.note?.trim() || null, createdById: user.id } });
      const eligible = employees.filter(row => evaluate(rule, facts.get(row.id)!).eligible);
      if (eligible.length) await db.benefitAllocationCandidate.createMany({ data: eligible.map(row => ({ batchId: batch.id, employeeId: row.id, eligible: true })) });
      await this.audit.record({ actorId: user.id, entityType: "benefit_allocation_batch", entityId: batch.id, action: "CREATE_DRAFT", result: "SUCCESS", newValue: { catalog: catalog.code, periodCode: dto.periodCode, referenceDate: dto.referenceDate, candidates: eligible.length, scopeOrgUnitId: dto.scopeOrgUnitId }, ipAddress: ip }, db);
      return batch.id;
    });
    return this.detail(user, id);
  }

  async addCandidate(user: AuthUser, id: string, dto: { revision: number; employeeId: string; reason?: string }, ip?: string) {
    await this.prisma.$transaction(async db => {
      const { batch, scope } = await this.draft(db, user, id, dto.revision);
      const inScope = await this.scopeEmployees(db, user, batch.scopeOrgUnitId, scope.allowed, batch.referenceDate);
      if (!inScope.some(row => row.id === dto.employeeId)) fail("forbidden", "OUT_OF_SCOPE", "Nhân viên không thuộc đối tượng của lô tại ngày tham chiếu.");
      const result = evaluate(parseEligibility(batch.version.eligibility), (await this.facts(db, [dto.employeeId], batch.referenceDate)).get(dto.employeeId)!);
      const reason = dto.reason?.trim();
      if (!result.eligible && !reason) fail("bad", "BENEFIT_NOT_ELIGIBLE", "Nhân viên chưa đủ điều kiện hưởng; nhập lý do nếu vẫn giữ.", { failed: result.failed });
      await db.benefitAllocationCandidate.upsert({ where: { batchId_employeeId: { batchId: id, employeeId: dto.employeeId } },
        create: { batchId: id, employeeId: dto.employeeId, eligible: result.eligible, failedRules: result.failed as unknown as Prisma.InputJsonValue, manual: true, manualReason: reason || null },
        update: { eligible: result.eligible, failedRules: result.failed as unknown as Prisma.InputJsonValue, manual: true, manualReason: reason || null } });
      await this.recheck(db, batch);
      await db.benefitAllocationBatch.update({ where: { id }, data: { revision: { increment: 1 } } });
      await this.audit.record({ actorId: user.id, entityType: "benefit_allocation_batch", entityId: id, action: "ADD_CANDIDATE", result: "SUCCESS", newValue: { employeeId: dto.employeeId, eligible: result.eligible, failed: result.failed as unknown as Prisma.InputJsonValue, reason: reason ?? null, scopeOrgUnitId: batch.scopeOrgUnitId }, ipAddress: ip }, db);
    });
    return this.detail(user, id);
  }

  async removeCandidate(user: AuthUser, id: string, dto: { revision: number; employeeId: string }, ip?: string) {
    await this.prisma.$transaction(async db => {
      const { batch } = await this.draft(db, user, id, dto.revision);
      const removed = await db.benefitAllocationCandidate.deleteMany({ where: { batchId: id, employeeId: dto.employeeId } });
      if (!removed.count) fail("missing", "NOT_FOUND", "Nhân viên không có trong danh sách dự kiến.");
      await this.recheck(db, batch);
      await db.benefitAllocationBatch.update({ where: { id }, data: { revision: { increment: 1 } } });
      await this.audit.record({ actorId: user.id, entityType: "benefit_allocation_batch", entityId: id, action: "REMOVE_CANDIDATE", result: "SUCCESS", newValue: { employeeId: dto.employeeId, scopeOrgUnitId: batch.scopeOrgUnitId }, ipAddress: ip }, db);
    });
    return this.detail(user, id);
  }

  private async draft(db: Db, user: AuthUser, id: string, revision: number) {
    await db.$queryRaw`SELECT id FROM benefit_allocation_batch WHERE id = ${id}::uuid FOR UPDATE`;
    const found = await this.batchRow(db, user, id, "welfare.manage");
    if (found.batch.status !== "DRAFT") fail("conflict", "BENEFIT_BATCH_FINAL", "Lô đã xác nhận hoặc đã hủy.");
    if (found.batch.revision !== revision) fail("conflict", "STALE_REVISION", "Danh sách đã thay đổi; tải lại trước khi thao tác.");
    return found;
  }

  /**
   * Records each candidate once (FR-9.2.2, UAT-28): rows already allocated for (benefit, employee, period) anywhere are
   * left out and reported; payroll-included allocations are bound to the batch's payroll period.
   */
  async confirm(user: AuthUser, id: string, dto: { revision: number }, ip?: string) {
    const result = await this.prisma.$transaction(async db => {
      const { batch } = await this.draft(db, user, id, dto.revision);
      const dropped = await this.recheck(db, batch);
      const candidates = await db.benefitAllocationCandidate.findMany({ where: { batchId: id }, include: { employee: { select: { code: true, fullName: true } } }, orderBy: { employee: { code: "asc" } } });
      if (!candidates.length) fail("conflict", "BENEFIT_BATCH_EMPTY", "Danh sách dự kiến không có ai để xác nhận.");
      await db.$queryRaw`SELECT pg_advisory_xact_lock(8210495, hashtext(${batch.catalogId + "|" + batch.periodCode}))::text AS lock`;
      const existing = await db.benefitAllocation.findMany({ where: { catalogId: batch.catalogId, periodCode: batch.periodCode, employeeId: { in: candidates.map(row => row.employeeId) } }, include: { batch: { select: { code: true } } } });
      const taken = new Map(existing.map(row => [row.employeeId, row.batch.code]));
      const facts = await this.facts(db, candidates.map(row => row.employeeId), batch.referenceDate);
      const amount = batch.version.amount.toString();
      const recorded: string[] = [];
      for (const row of candidates) {
        if (taken.has(row.employeeId)) continue;
        const fact = facts.get(row.employeeId)!;
        await db.benefitAllocation.create({ data: { batchId: id, catalogId: batch.catalogId, versionId: batch.versionId, employeeId: row.employeeId, periodCode: batch.periodCode, amountCipher: cipherText(this.key, amount),
          taxTreatment: batch.version.taxTreatment, payrollPeriodId: batch.version.payrollIncluded ? batch.payrollPeriodId : null, orgUnitId: fact.orgUnitId ?? batch.scopeOrgUnitId, costCenterCode: fact.costCenterCode,
          costMonth: key(batch.referenceDate).slice(0, 7), manualReason: row.manualReason } });
        recorded.push(row.employeeId);
      }
      const duplicates = candidates.filter(row => taken.has(row.employeeId)).map(row => ({ employeeId: row.employeeId, code: row.employee.code, fullName: row.employee.fullName, existingBatch: taken.get(row.employeeId)! }));
      const summary = { recorded: recorded.length, duplicates, droppedNoLongerEligible: dropped, amount };
      await db.benefitAllocationBatch.update({ where: { id }, data: { status: "CONFIRMED", confirmedAt: new Date(), confirmedById: user.id, revision: { increment: 1 }, result: summary as unknown as Prisma.InputJsonValue } });
      if (batch.payrollPeriodId && batch.version.payrollIncluded && recorded.length) await this.events.changed(db, { payrollPeriodIds: [batch.payrollPeriodId], source: "WELFARE", reason: "Cấp phát " + batch.code, actorId: user.id });
      await this.audit.record({ actorId: user.id, entityType: "benefit_allocation_batch", entityId: id, action: "CONFIRM", result: duplicates.length ? "PARTIAL" : "SUCCESS", newValue: { recorded: recorded.length, duplicates: duplicates.map(row => row.employeeId), scopeOrgUnitId: batch.scopeOrgUnitId }, ipAddress: ip }, db);
      return summary;
    });
    return { ...(await this.detail(user, id)), confirmation: result };
  }

  async cancel(user: AuthUser, id: string, dto: { revision: number; reason: string }, ip?: string) {
    if (!dto.reason.trim()) fail("bad", "REASON_REQUIRED", "Nhập lý do hủy lô.");
    await this.prisma.$transaction(async db => {
      const { batch } = await this.draft(db, user, id, dto.revision);
      await db.benefitAllocationCandidate.deleteMany({ where: { batchId: id } });
      await db.benefitAllocationBatch.update({ where: { id }, data: { status: "CANCELLED", cancelReason: dto.reason.trim(), revision: { increment: 1 } } });
      await this.audit.record({ actorId: user.id, entityType: "benefit_allocation_batch", entityId: id, action: "CANCEL", result: "SUCCESS", newValue: { reason: dto.reason.trim(), scopeOrgUnitId: batch.scopeOrgUnitId }, ipAddress: ip }, db);
    });
    return this.detail(user, id);
  }

  async batches(user: AuthUser) {
    const scope = await this.access(user, "welfare.read");
    const rows = await this.prisma.benefitAllocationBatch.findMany({ where: { scopeOrgUnitId: { in: [...scope.allowed] } }, include: { catalog: { select: { code: true, category: true } }, version: { select: { name: true } }, scopeOrgUnit: { select: { code: true } }, _count: { select: { candidates: true, allocations: true } } }, orderBy: { createdAt: "desc" }, take: 100 });
    return { items: rows.map(row => ({ id: row.id, code: row.code, catalogCode: row.catalog.code, name: row.version.name, category: row.catalog.category, periodCode: row.periodCode, referenceDate: key(row.referenceDate),
      scopeCode: row.scopeOrgUnit.code, status: row.status, revision: row.revision, candidates: row._count.candidates, allocations: row._count.allocations, createdAt: row.createdAt.toISOString() })) };
  }

  async detail(user: AuthUser, id: string) {
    const { batch } = await this.batchRow(this.prisma, user, id, "welfare.read");
    const [candidates, allocations, period] = await Promise.all([
      this.prisma.benefitAllocationCandidate.findMany({ where: { batchId: id }, include: { employee: { select: { id: true, code: true, fullName: true } } }, orderBy: { employee: { code: "asc" } } }),
      this.prisma.benefitAllocation.findMany({ where: { batchId: id }, include: { employee: { select: { id: true, code: true, fullName: true } } }, orderBy: { employee: { code: "asc" } } }),
      batch.payrollPeriodId ? this.prisma.payrollPeriod.findUnique({ where: { id: batch.payrollPeriodId }, select: { code: true } }) : null,
    ]);
    return {
      batch: { id: batch.id, code: batch.code, catalogId: batch.catalogId, catalogCode: batch.catalog.code, category: batch.catalog.category, version: this.versionView(batch.version), periodCode: batch.periodCode, referenceDate: key(batch.referenceDate),
        scopeOrgUnitId: batch.scopeOrgUnitId, payrollPeriodId: batch.payrollPeriodId, payrollPeriodCode: period?.code ?? null, status: batch.status, revision: batch.revision, note: batch.note, result: batch.result,
        confirmedAt: batch.confirmedAt?.toISOString() ?? null, cancelReason: batch.cancelReason },
      candidates: candidates.map(row => ({ employee: row.employee, eligible: row.eligible, failedRules: row.failedRules, manual: row.manual, manualReason: row.manualReason })),
      allocations: allocations.map(row => ({ id: row.id, employee: row.employee, amount: plainText(this.key, row.amountCipher, "phúc lợi"), taxTreatment: row.taxTreatment, payrollPeriodId: row.payrollPeriodId, costCenterCode: row.costCenterCode })),
    };
  }

  // ---- Costs (FR-9.4.1): confirmed allocations + severance/job-loss allowances ----

  async costs(user: AuthUser, query: { from: string; to: string }) {
    const scope = await this.access(user, "welfare.read");
    if (!/^\d{4}-\d{2}$/.test(query.from) || !/^\d{4}-\d{2}$/.test(query.to) || query.from > query.to) fail("bad", "MONTH_RANGE_INVALID", "Khoảng tháng phải có dạng YYYY-MM và đúng thứ tự.");
    const allocations = await this.prisma.benefitAllocation.findMany({ where: { costMonth: { gte: query.from, lte: query.to }, orgUnitId: { in: [...scope.allowed] } }, include: { catalog: { select: { category: true, code: true } } } });
    const rows = new Map<string, { month: string; costCenterCode: string | null; category: string; count: number; amount: Decimal }>();
    const add = (month: string, costCenterCode: string | null, category: string, amount: string) => {
      const id = [month, costCenterCode ?? "", category].join("|");
      const row = rows.get(id) ?? { month, costCenterCode, category, count: 0, amount: new Decimal(0) };
      row.count++; row.amount = row.amount.plus(amount); rows.set(id, row);
    };
    for (const row of allocations) add(row.costMonth, row.costCenterCode, row.catalog.category, plainText(this.key, row.amountCipher, "phúc lợi"));
    const from = date(query.from + "-01"), to = new Date(Date.UTC(Number(query.to.slice(0, 4)), Number(query.to.slice(5, 7)), 0));
    const severance = await this.prisma.severanceAllowance.findMany({ where: { decision: { status: "CONFIRMED", effectiveDate: { gte: from, lte: to } } }, include: { decision: { select: { effectiveDate: true } } } });
    // Cost center of the employee's unit on the termination date.
    const byDate = new Map<string, Awaited<ReturnType<WelfareService["facts"]>>>();
    for (const row of severance) {
      const at = key(row.decision.effectiveDate);
      if (!byDate.has(at)) byDate.set(at, await this.facts(this.prisma, severance.filter(item => key(item.decision.effectiveDate) === at).map(item => item.employeeId), row.decision.effectiveDate));
      const fact = byDate.get(at)!.get(row.employeeId);
      if (!fact?.orgUnitId || !scope.allowed.has(fact.orgUnitId)) continue;
      add(at.slice(0, 7), fact.costCenterCode, row.allowanceKind, plainText(this.key, row.amountCipher, "trợ cấp"));
    }
    const items = [...rows.values()].sort((left, right) => left.month.localeCompare(right.month) || (left.costCenterCode ?? "").localeCompare(right.costCenterCode ?? "") || left.category.localeCompare(right.category))
      .map(row => ({ ...row, categoryLabel: CATEGORY_LABELS[row.category] ?? row.category, amount: row.amount.toString() }));
    return { from: query.from, to: query.to, items, total: items.reduce((total, row) => total.plus(row.amount), new Decimal(0)).toString() };
  }

  async exportCosts(user: AuthUser, query: { from: string; to: string }, ip?: string) {
    const report = await this.costs(user, query);
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet("Chi phi phuc loi");
    sheet.addRow(["Chi phí phúc lợi " + report.from + " → " + report.to + " — xuất bởi " + user.username + " lúc " + new Date().toISOString()]);
    sheet.addRow(["Tháng", "Cost center", "Loại", "Số lượt", "Số tiền"]);
    // compliance-lint-ignore money-float: Excel cell boundary; whole đồng amounts are exact as doubles
    for (const row of report.items) sheet.addRow([row.month, row.costCenterCode ?? "", row.categoryLabel, row.count, Number(row.amount)]);
    sheet.addRow(["Tổng", "", "", "", Number(report.total)]); // compliance-lint-ignore money-float: Excel cell boundary
    await this.audit.record({ actorId: user.id, entityType: "welfare_costs", entityId: report.from + ".." + report.to, action: "EXPORT", result: "SUCCESS", newValue: { rows: report.items.length }, ipAddress: ip, scopeOrgUnitId: null });
    return Buffer.from(await book.xlsx.writeBuffer());
  }
}
