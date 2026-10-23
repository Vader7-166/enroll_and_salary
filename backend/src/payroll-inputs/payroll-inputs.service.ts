import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, type PayrollInputLine, type PayrollPeriod, type OrgUnitVersion, type RoleAssignment } from "@prisma/client";
import { plainToInstance } from "class-transformer";
import { validate as validateDto } from "class-validator";
import Decimal from "decimal.js";
import { createHash } from "node:crypto";
import { parse } from "csv-parse/sync";
import { AuditService, canonicalJson } from "../audit/audit.service";
import { businessDate } from "../auth/business-date";
import type { AuthUser } from "../auth/auth.types";
import { PrismaService } from "../database/prisma.service";
import { effectiveAt } from "../organization/scope.service";
import { cipherText, plainText } from "../personnel/contract-crypto";
import { PayrollConfigurationService } from "../payroll-configuration/payroll-configuration.service";
import type { PlanLineDto } from "../employee-pay-plans/employee-pay-plans.dto";
import { INPUT_TYPES, PayrollBatchDto, type PayrollActionDto, type PayrollInputLineDto, type PayrollListQueryDto, type PayrollPeriodDto } from "./payroll-inputs.dto";

type Db = Prisma.TransactionClient;
type Permission = "payroll.inputs.read" | "payroll.inputs.manage";
const DAY = 86_400_000;
const DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d{1,6})?$/;
const actor = { id: true, displayName: true } as const;
const INCLUDE = {
  payrollPeriod: { include: { siteOrgUnit: { include: { versions: true } } } },
  createdBy: { select: actor },
  lines: { include: { employee: { select: { code: true, fullName: true } }, component: { include: { versions: true } } }, orderBy: { sourceLineId: "asc" as const } },
  teamAllocations: true, evidence: { orderBy: { createdAt: "asc" as const } },
  history: { include: { actor: { select: actor } }, orderBy: [{ createdAt: "asc" as const }, { revision: "asc" as const }] },
} satisfies Prisma.PayrollInputBatchInclude;
type Batch = Prisma.PayrollInputBatchGetPayload<{ include: typeof INCLUDE }>;
type Employee = Prisma.EmployeeGetPayload<{ include: { assignments: true; exclusions: true } }>;
type Access = { versions: OrgUnitVersion[]; grants: RoleAssignment[]; employees: Map<string, Employee>; ownEmployeeId: string | null };
type Issue = { code: string; message: string; sourceLineId?: string; employeeId?: string };
type Bindings = Map<string, Record<string, unknown>>;
const dateText = (d: Date) => d.toISOString().slice(0, 10);
const hash = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");
const next = (d: Date) => new Date(d.getTime() + DAY);
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
function date(value: string, label = "Ngày") {
  const d = new Date(value + "T00:00:00.000Z");
  if (!/^\d{4}-\d\d-\d\d$/.test(value) || !Number.isFinite(d.getTime()) || dateText(d) !== value) throw new BadRequestException(`${label} không hợp lệ.`);
  return d;
}
function clean(value: string, label: string, max: number) {
  const result = value?.trim();
  if (!result || result.length > max) throw new BadRequestException(`${label} không hợp lệ.`);
  return result;
}
function decimal(value: string | undefined, label: string) {
  if (!value || !DECIMAL.test(value)) throw new BadRequestException(`${label} phải là số thập phân chính xác tối đa 26,6.`);
  const result = new Decimal(value);
  if (result.abs().gte("100000000000000000000")) throw new BadRequestException(`${label} vượt độ chính xác 26,6.`);
  return result;
}
function points(from: Date, to: Date, rows: Array<{ effectiveFrom: Date; effectiveTo: Date | null }>) {
  const all = new Map<number, Date>([[from.getTime(), from], [to.getTime(), to]]);
  for (const row of rows) {
    if (row.effectiveFrom >= from && row.effectiveFrom <= to) all.set(row.effectiveFrom.getTime(), row.effectiveFrom);
    if (row.effectiveTo && next(row.effectiveTo) >= from && next(row.effectiveTo) <= to) all.set(next(row.effectiveTo).getTime(), next(row.effectiveTo));
  }
  return [...all.values()].sort((a, b) => a.getTime() - b.getTime());
}
function issue(code: string, message: string, line?: PayrollInputLine): Issue {
  return { code, message, ...(line ? { sourceLineId: line.sourceLineId, employeeId: line.employeeId } : {}) };
}

@Injectable()
export class PayrollInputsService {
  private readonly key: Buffer;
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly configurations: PayrollConfigurationService, config: ConfigService) {
    this.key = Buffer.from(config.getOrThrow<string>("HR_DATA_KEY"), "base64");
  }
  private assert(user: AuthUser, permission: Permission) {
    if (!user.roles.includes("KT") || !user.permissions.includes(permission)) throw new ForbiddenException("Chỉ kế toán được cấp quyền đầu vào lương mới được truy cập.");
  }
  private conflict(message: string): never { throw new ConflictException({ code: "PAYROLL_INPUT_CONFLICT", message }); }
  private async tx<T>(work: (db: Db) => Promise<T>) {
    try {
      return await this.prisma.$transaction(async db => {
        for (const lock of [8210500, 8210473, 8210522, 8210523, 8210524]) await db.$queryRawUnsafe(`SELECT pg_advisory_xact_lock(${lock})::text AS lock`);
        return work(db);
      }, { isolationLevel: "Serializable", timeout: 90_000 });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && (["P2002", "P2034"].includes(e.code) || String(e.meta?.database_error ?? e.message).includes("payroll_period_no_overlap"))) this.conflict("Nguồn hoặc kỳ lương trùng/xung đột. Tải lại trước khi thao tác.");
      throw e;
    }
  }
  private async access(db: Db, user: AuthUser): Promise<Access> {
    const [versions, grants, account] = await Promise.all([
      db.orgUnitVersion.findMany(),
      db.roleAssignment.findMany({ where: { userAccountId: user.id, roleCode: "KT" } }),
      db.userAccount.findUniqueOrThrow({ where: { id: user.id }, select: { employeeId: true } }),
    ]);
    return { versions, grants, employees: new Map(), ownEmployeeId: account.employeeId };
  }
  private scope(user: AuthUser, permission: Permission, at: Date, access: Access) {
    this.assert(user, permission);
    const versions = access.versions.filter(v => v.effectiveFrom <= at && (!v.effectiveTo || v.effectiveTo >= at));
    const children = new Map<string, string[]>();
    for (const row of versions) if (row.parentId) children.set(row.parentId, [...(children.get(row.parentId) ?? []), row.orgUnitId]);
    const allowed = new Set<string>();
    const pending = access.grants.filter(g => g.effectiveFrom <= at && (!g.effectiveTo || g.effectiveTo >= at)).map(g => g.scopeOrgUnitId);
    while (pending.length) { const id = pending.pop()!; if (allowed.has(id)) continue; allowed.add(id); pending.push(...(children.get(id) ?? [])); }
    return { allowed, versions };
  }
  private requireSiteScope(user: AuthUser, siteId: string, from: Date, to: Date, permission: Permission, access: Access) {
    const dates = [...points(from, to, [...access.versions, ...access.grants]), businessDate()];
    for (const at of dates) if (!this.scope(user, permission, at, access).allowed.has(siteId)) throw new NotFoundException("Không tìm thấy kỳ lương trong phạm vi.");
  }
  private async employee(db: Db, id: string, access: Access) {
    let employee = access.employees.get(id);
    if (!employee) {
      employee = await db.employee.findUnique({ where: { id }, include: { assignments: true, exclusions: true } }) ?? undefined;
      if (!employee) throw new NotFoundException("Không tìm thấy dữ liệu đầu vào trong phạm vi.");
      access.employees.set(id, employee);
    }
    return employee;
  }
  private async requireEmployeeInterval(db: Db, user: AuthUser, id: string, from: Date, to: Date, siteId: string, permission: Permission, access: Access) {
    if (permission === "payroll.inputs.manage" && access.ownEmployeeId === id) throw new ForbiddenException("Kế toán không được sửa đầu vào lương của chính mình.");
    const employee = await this.employee(db, id, access);
    const dates = points(from, to, [...employee.assignments, ...employee.exclusions, ...access.versions, ...access.grants]);
    for (const at of [...dates, businessDate()]) {
      const scope = this.scope(user, permission, at, access);
      const assignments = employee.assignments.filter(r => r.isPrimary && r.effectiveFrom <= at && (!r.effectiveTo || r.effectiveTo >= at));
      if (assignments.length !== 1 || !scope.allowed.has(assignments[0].orgUnitId) || employee.exclusions.some(r => r.userAccountId === user.id && r.effectiveFrom <= at && (!r.effectiveTo || r.effectiveTo >= at))) throw new NotFoundException("Không tìm thấy dữ liệu đầu vào trong phạm vi.");
      if (at >= from && at <= to) {
        const unit = scope.versions.find(v => v.orgUnitId === assignments[0].orgUnitId);
        const site = scope.versions.find(v => v.orgUnitId === siteId && v.type === "SITE");
        if (!unit?.siteId || unit.siteId !== site?.siteId) throw new NotFoundException("Nhân sự không thuộc cơ sở của kỳ lương.");
      }
    }
    if (employee.hireDate > from || employee.terminationDate && employee.terminationDate < to) throw new BadRequestException("Khoảng nguồn nằm ngoài thời gian làm việc của nhân sự.");
    return employee;
  }
  private async authorizeBatch(db: Db, user: AuthUser, row: Pick<Batch, "payrollPeriod" | "lines">, permission: Permission, access: Access) {
    this.requireSiteScope(user, row.payrollPeriod.siteOrgUnitId, row.payrollPeriod.dateFrom, row.payrollPeriod.dateTo, permission, access);
    for (const line of row.lines) await this.requireEmployeeInterval(db, user, line.employeeId, line.workFrom, line.workTo, row.payrollPeriod.siteOrgUnitId, permission, access);
  }
  private async getBatch(db: Db, user: AuthUser, id: string, permission: Permission, access: Access) {
    this.assert(user, permission);
    const row = await db.payrollInputBatch.findUnique({ where: { id }, include: INCLUDE });
    if (!row) throw new NotFoundException("Không tìm thấy nguồn đầu vào lương.");
    await this.authorizeBatch(db, user, row, permission, access);
    return row;
  }
  private payload(line: PayrollInputLine): PayrollInputLineDto { return JSON.parse(plainText(this.key, line.payloadCipher)); }
  private groupAmount(group: Batch["teamAllocations"][number]) { return plainText(this.key, group.acceptedAmountCipher); }
  private lineView(line: Batch["lines"][number]) {
    const component = line.component.versions.find(v => v.effectiveFrom <= line.workFrom && (!v.effectiveTo || v.effectiveTo >= line.workFrom));
    return { ...this.payload(line), id: line.id, employeeCode: line.employee.code, employeeName: line.employee.fullName, componentCode: line.component.code, componentName: component?.name ?? line.component.code, ...(line.bindingSnapshotCipher ? { bindingSnapshot: JSON.parse(plainText(this.key, line.bindingSnapshotCipher)) } : {}) };
  }
  private periodView(row: Batch["payrollPeriod"]) {
    const site = row.siteOrgUnit.versions.find(v => v.effectiveFrom <= row.dateFrom && (!v.effectiveTo || v.effectiveTo >= row.dateFrom));
    return { id: row.id, code: row.code, siteOrgUnitId: row.siteOrgUnitId, siteCode: row.siteOrgUnit.code, siteName: site?.name ?? row.siteOrgUnit.code, dateFrom: dateText(row.dateFrom), dateTo: dateText(row.dateTo), expectedPaymentDate: row.expectedPaymentDate ? dateText(row.expectedPaymentDate) : null, status: row.status };
  }
  private view(row: Batch, detail = true, canManage = false) {
    const validation: { issues: Issue[]; hash?: string } = row.validationCipher ? JSON.parse(plainText(this.key, row.validationCipher)) : { issues: [] };
    const base = { id: row.id, code: `${row.sourceSystem}/${row.sourceDocumentNo}/${row.sourceVersion}`, revision: row.revision, status: row.status, payrollPeriod: this.periodView(row.payrollPeriod), sourceSystem: row.sourceSystem, sourceDocumentNo: row.sourceDocumentNo, sourceVersion: row.sourceVersion, provenance: row.provenance, preparedBy: row.preparedBy, createdAt: row.createdAt.toISOString(), createdBy: row.createdBy, lineCount: row.lines.length, issueCount: validation.issues.length, canManage, supersedesBatchId: row.supersedesBatchId };
    if (!detail) return base;
    return { ...base, mappingVersion: row.mappingVersion, sourceApprovedBy: row.sourceApprovedBy, sourceApprovedAt: row.sourceApprovedAt ? dateText(row.sourceApprovedAt) : null, sourceApprovalReference: row.sourceApprovalReference, reason: row.reason, contentHash: row.contentHash, fileName: row.fileName, fileHash: row.fileHash, attendancePeriodIds: row.attendancePeriodIds, lines: row.lines.map(line => this.lineView(line)), teamAllocations: row.teamAllocations.map(g => ({ key: g.allocationKey, teamOrgUnitId: g.teamOrgUnitId, acceptedAmount: this.groupAmount(g), reference: g.reference })), validation, history: row.history.map(h => ({ id: h.id, action: h.action, fromStatus: h.fromStatus, toStatus: h.toStatus, reason: h.reason, createdAt: h.createdAt.toISOString(), actor: h.actor, revision: h.revision })), evidence: row.evidence.map(e => ({ id: e.id, fileName: e.fileName, contentType: e.contentType, size: e.size, sha256: e.sha256 })) };
  }
  async context(user: AuthUser) {
    return this.prisma.$transaction(async db => {
      const at = businessDate(), access = await this.access(db, user);
      const read = this.scope(user, "payroll.inputs.read", at, access);
      const orgs = await db.orgUnit.findMany({ select: { id: true, code: true } });
      const codes = new Map(orgs.map(o => [o.id, o.code]));
      const shape = (ids: Set<string>) => read.versions.filter(v => ids.has(v.orgUnitId)).map(v => ({ id: v.orgUnitId, code: codes.get(v.orgUnitId)!, name: v.name, type: v.type, parentId: v.parentId }));
      const manage = user.permissions.includes("payroll.inputs.manage") ? this.scope(user, "payroll.inputs.manage", at, access).allowed : new Set<string>();
      return { asOf: dateText(at), units: shape(read.allowed), managementUnits: shape(manage), inputTypes: [...INPUT_TYPES] };
    });
  }
  async periods(user: AuthUser) {
    this.assert(user, "payroll.inputs.read");
    return this.prisma.$transaction(async db => {
      const access = await this.access(db, user), items = [];
      const rows = await db.payrollPeriod.findMany({ include: { siteOrgUnit: { include: { versions: true } } }, orderBy: [{ dateFrom: "desc" }, { code: "asc" }] });
      for (const row of rows) {
        try { this.requireSiteScope(user, row.siteOrgUnitId, row.dateFrom, row.dateTo, "payroll.inputs.read", access); items.push(this.periodView(row)); }
        catch (e) { if (!(e instanceof NotFoundException)) throw e; }
      }
      return { items };
    });
  }
  async createPeriod(user: AuthUser, dto: PayrollPeriodDto, ip?: string) {
    this.assert(user, "payroll.inputs.manage");
    return this.tx(async db => {
      const from = date(dto.dateFrom), to = date(dto.dateTo), payment = dto.expectedPaymentDate ? date(dto.expectedPaymentDate) : null;
      if (to < from) throw new BadRequestException("Ngày kết thúc kỳ phải không trước ngày bắt đầu.");
      const access = await this.access(db, user);
      this.requireSiteScope(user, dto.siteOrgUnitId, from, to, "payroll.inputs.manage", access);
      for (const at of points(from, to, access.versions)) if (!access.versions.some(v => v.orgUnitId === dto.siteOrgUnitId && v.type === "SITE" && v.effectiveFrom <= at && (!v.effectiveTo || v.effectiveTo >= at))) throw new BadRequestException("Kỳ đầu vào lương phải thuộc một cơ sở hiệu lực trên toàn khoảng.");
      if (await db.payrollPeriod.findFirst({ where: { siteOrgUnitId: dto.siteOrgUnitId, dateFrom: { lte: to }, dateTo: { gte: from } } })) this.conflict("Kỳ đầu vào lương chồng khoảng với kỳ đã có tại cơ sở.");
      const period = await db.payrollPeriod.create({ data: { code: clean(dto.code, "Mã kỳ", 64), siteOrgUnitId: dto.siteOrgUnitId, dateFrom: from, dateTo: to, expectedPaymentDate: payment }, include: { siteOrgUnit: { include: { versions: true } } } });
      await this.audit.record({ actorId: user.id, entityType: "payroll_period", entityId: period.id, action: "CREATE", result: "SUCCESS", newValue: json({ code: period.code, dateFrom: dto.dateFrom, dateTo: dto.dateTo }), ipAddress: ip }, db);
      return { period: this.periodView(period) };
    });
  }
  private async normalize(value: PayrollBatchDto) {
    const dto = plainToInstance(PayrollBatchDto, value);
    const errors = await validateDto(dto, { whitelist: true, forbidNonWhitelisted: true });
    if (errors.length) throw new BadRequestException("Dữ liệu đầu vào không đúng cấu trúc hoặc kiểu giá trị.");
    const result: PayrollBatchDto = JSON.parse(JSON.stringify(dto));
    for (const key of ["sourceSystem", "sourceDocumentNo", "sourceVersion", "mappingVersion", "preparedBy", "reason"] as const) result[key] = clean(result[key], key, key === "reason" ? 2000 : key === "preparedBy" ? 200 : key === "sourceDocumentNo" ? 160 : 80);
    for (const key of ["sourceApprovedBy", "sourceApprovalReference"] as const) result[key] = result[key]?.trim() || undefined;
    if (result.sourceApprovedAt) date(result.sourceApprovedAt);
    result.attendancePeriodIds = [...new Set(result.attendancePeriodIds ?? [])].sort();
    result.lines = result.lines.map(line => {
      const row = { ...line, sourceLineId: clean(line.sourceLineId, "Mã dòng nguồn", 160) };
      const from = date(row.workFrom), to = date(row.workTo);
      if (from > to) throw new BadRequestException("Khoảng làm việc không hợp lệ.");
      for (const key of ["businessReference", "teamAllocationKey", "amountBasis", "unit"] as const) row[key] = row[key]?.trim() || undefined;
      if (row.amount !== undefined) row.amount = decimal(row.amount, "Số tiền").toFixed();
      if (row.allocatedAmount !== undefined) row.allocatedAmount = decimal(row.allocatedAmount, "Phân bổ").toFixed();
      row.inputs = (row.inputs ?? []).map(v => ({ code: v.code.trim(), unit: v.unit.trim(), value: decimal(v.value, "Giá trị " + v.code).toFixed() })).sort((a, b) => a.code.localeCompare(b.code));
      if (new Set(row.inputs.map(v => v.code)).size !== row.inputs.length) throw new BadRequestException("Mã dữ liệu nhập không được trùng.");
      return row;
    }).sort((a, b) => a.sourceLineId.localeCompare(b.sourceLineId));
    if (!result.lines.length || new Set(result.lines.map(l => l.sourceLineId)).size !== result.lines.length) throw new BadRequestException("Nguồn cần 1..500 dòng có mã dòng duy nhất.");
    result.teamAllocations = (result.teamAllocations ?? []).map(g => ({ ...g, key: clean(g.key, "Mã nhóm", 160), acceptedAmount: decimal(g.acceptedAmount, "Tổng phân bổ").toFixed(), reference: clean(g.reference, "Căn cứ phân bổ", 500) })).sort((a, b) => a.key.localeCompare(b.key));
    if (new Set(result.teamAllocations.map(g => g.key)).size !== result.teamAllocations.length || result.teamAllocations.some(g => decimal(g.acceptedAmount, "Tổng phân bổ").isNegative())) throw new BadRequestException("Nhóm phân bổ phải duy nhất, tổng không âm.");
    return result;
  }
  async create(user: AuthUser, body: PayrollBatchDto, ip?: string, file?: { name: string; hash: string }) {
    this.assert(user, "payroll.inputs.manage");
    const dto = await this.normalize(body);
    return this.tx(async db => {
      const access = await this.access(db, user);
      const period = await db.payrollPeriod.findUnique({ where: { id: dto.payrollPeriodId } });
      if (!period) throw new NotFoundException("Không tìm thấy kỳ đầu vào lương.");
      this.requireSiteScope(user, period.siteOrgUnitId, period.dateFrom, period.dateTo, "payroll.inputs.manage", access);
      for (const line of dto.lines) {
        const from = date(line.workFrom), to = date(line.workTo);
        if (from < period.dateFrom || to > period.dateTo) throw new BadRequestException("Khoảng nguồn nằm ngoài kỳ nhận đầu vào lương.");
        await this.requireEmployeeInterval(db, user, line.employeeId, from, to, period.siteOrgUnitId, "payroll.inputs.manage", access);
      }
      const canonical = canonicalJson(dto), contentHash = hash(dto);
      const existing = await db.payrollInputBatch.findUnique({ where: { sourceSystem_sourceDocumentNo_sourceVersion: { sourceSystem: dto.sourceSystem, sourceDocumentNo: dto.sourceDocumentNo, sourceVersion: dto.sourceVersion } }, include: INCLUDE });
      if (existing) {
        await this.authorizeBatch(db, user, existing, "payroll.inputs.manage", access);
        if (existing.contentHash !== contentHash) this.conflict("Khóa nguồn đã tồn tại với nội dung khác; tạo phiên bản thay thế.");
        return { item: this.view(existing, true, true), duplicate: true };
      }
      if (period.status !== "OPEN") this.conflict("Kỳ đầu vào lương đã khóa.");
      if (dto.supersedesBatchId) {
        const previous = await this.getBatch(db, user, dto.supersedesBatchId, "payroll.inputs.manage", access);
        if (previous.payrollPeriod.status !== "OPEN" || previous.payrollPeriodId !== period.id) this.conflict("Không thay thế nguồn kỳ khóa/khác kỳ; lập điều chỉnh liên kết ở kỳ mở.");
        if (previous.sourceSystem !== dto.sourceSystem || previous.sourceDocumentNo !== dto.sourceDocumentNo || previous.sourceVersion === dto.sourceVersion || previous.status === "SUPERSEDED") this.conflict("Thay thế phải dùng cùng hệ thống/chứng từ, phiên bản mới và nguồn trước chưa được thay thế.");
        for (const old of previous.lines) {
          const replacement = dto.lines.find(l => l.sourceLineId === old.sourceLineId);
          if (!replacement || replacement.supersedesLineId !== old.id || replacement.employeeId !== old.employeeId || replacement.componentId !== old.componentId) throw new BadRequestException("Bản thay thế phải giữ và liên kết từng mã dòng cũ; bỏ khoản bằng dòng 0/không áp dụng có căn cứ.");
        }
        for (const line of dto.lines) if (line.supersedesLineId && !previous.lines.some(l => l.id === line.supersedesLineId && l.sourceLineId === line.sourceLineId)) throw new BadRequestException("Liên kết dòng thay thế không thuộc nguồn trước.");
      } else if (dto.lines.some(l => l.supersedesLineId)) throw new BadRequestException("Liên kết dòng thay thế cần nguồn trước.");
      const batch = await db.payrollInputBatch.create({ data: {
        payrollPeriodId: period.id, sourceSystem: dto.sourceSystem, sourceDocumentNo: dto.sourceDocumentNo, sourceVersion: dto.sourceVersion, mappingVersion: dto.mappingVersion,
        provenance: dto.provenance, preparedBy: dto.preparedBy, sourceApprovedBy: dto.sourceApprovedBy ?? null, sourceApprovedAt: dto.sourceApprovedAt ? date(dto.sourceApprovedAt) : null, sourceApprovalReference: dto.sourceApprovalReference ?? null,
        reason: dto.reason, attendancePeriodIds: dto.attendancePeriodIds!, contentHash, payloadCipher: cipherText(this.key, canonical), supersedesBatchId: dto.supersedesBatchId ?? null, createdById: user.id, fileName: file?.name, fileHash: file?.hash,
        lines: { create: dto.lines.map(line => ({ sourceLineId: line.sourceLineId, employeeId: line.employeeId, componentId: line.componentId, inputType: line.inputType, workFrom: date(line.workFrom), workTo: date(line.workTo), valueState: line.valueState, calculationMode: line.calculationMode, businessReference: line.businessReference ?? null, adjustmentOfLineId: line.adjustmentOfLineId ?? null, teamAllocationKey: line.teamAllocationKey ?? null, supersedesLineId: line.supersedesLineId ?? null, payloadCipher: cipherText(this.key, canonicalJson(line)), inputHash: hash(line) })) },
        teamAllocations: { create: dto.teamAllocations!.map(g => ({ allocationKey: g.key, teamOrgUnitId: g.teamOrgUnitId, acceptedAmountCipher: cipherText(this.key, g.acceptedAmount), reference: g.reference })) },
      }, include: INCLUDE });
      await this.record(db, user, batch, null, "CREATE", dto.reason, ip);
      return { item: this.view(await db.payrollInputBatch.findUniqueOrThrow({ where: { id: batch.id }, include: INCLUDE }), true, true), duplicate: false };
    });
  }
  private async record(db: Db, user: AuthUser, row: Batch, fromStatus: Batch["status"] | null, action: string, reason: string, ip?: string) {
    await db.payrollInputHistory.create({ data: { batchId: row.id, actorId: user.id, action, fromStatus, toStatus: row.status, reason, revision: row.revision } });
    await this.audit.record({ actorId: user.id, entityType: "payroll_input_batch", entityId: row.id, action, result: "SUCCESS", newValue: json({ status: row.status, revision: row.revision, contentHash: row.contentHash, reason }), ipAddress: ip }, db);
  }
  private async attendanceBinding(db: Db, batch: Batch, line: PayrollInputLine, access: Access) {
    const periods = await db.businessPeriod.findMany({ where: { id: { in: batch.attendancePeriodIds }, status: "LOCKED", periodType: "ATTENDANCE", dateFrom: { lte: line.workTo }, dateTo: { gte: line.workFrom } }, include: { periodLockEvents: { where: { action: "LOCK" }, orderBy: { revision: "desc" }, take: 1 } } });
    const covered = [];
    for (const period of periods) {
      const dates = points(line.workFrom, line.workTo, access.versions);
      const inScope = dates.every(at => {
        const byId = new Map(access.versions.filter(v => v.effectiveFrom <= at && (!v.effectiveTo || v.effectiveTo >= at)).map(v => [v.orgUnitId, v]));
        let current = byId.get(batch.payrollPeriod.siteOrgUnitId);
        const seen = new Set<string>();
        while (current && !seen.has(current.orgUnitId)) { if (current.orgUnitId === period.scopeOrgUnitId) return true; seen.add(current.orgUnitId); current = current.parentId ? byId.get(current.parentId) : undefined; }
        return false;
      });
      if (inScope && period.periodLockEvents.length) covered.push(period);
    }
    covered.sort((a, b) => a.dateFrom.getTime() - b.dateFrom.getTime());
    let cursor = line.workFrom;
    for (const period of covered) { if (period.dateFrom > cursor) break; if (period.dateTo >= cursor) cursor = next(period.dateTo); }
    if (cursor <= line.workTo) throw new BadRequestException("Nguồn thời gian cần kỳ công đã khóa và có hash khóa phủ toàn khoảng/cơ sở.");
    return covered.map(p => ({ periodId: p.id, revision: p.revision, lockId: p.periodLockEvents[0].id, sourceHash: p.periodLockEvents[0].sourceHash, dateFrom: dateText(p.dateFrom), dateTo: dateText(p.dateTo) }));
  }
  private async checkBusinessKeys(db: Db, batch: Batch) {
    const issues: Issue[] = [], seen = new Map<string, PayrollInputLine[]>();
    for (const line of batch.lines) {
      if (!line.businessReference) continue;
      const key = [line.employeeId, line.componentId, line.inputType, line.businessReference].join("|");
      const previous = seen.get(key) ?? [];
      if (previous.some(row => row.workFrom <= line.workTo && row.workTo >= line.workFrom)) issues.push(issue("PAYROLL_BUSINESS_DUPLICATE", "Trùng mốc nghiệp vụ trong cùng nguồn.", line));
      seen.set(key, [...previous, line]);
      const other = await db.payrollInputLine.findFirst({ where: { employeeId: line.employeeId, componentId: line.componentId, inputType: line.inputType, businessReference: line.businessReference, workFrom: { lte: line.workTo }, workTo: { gte: line.workFrom }, batch: { status: "CONFIRMED", id: { notIn: [batch.id, ...(batch.supersedesBatchId ? [batch.supersedesBatchId] : [])] } } } });
      if (other) issues.push(issue("PAYROLL_BUSINESS_DUPLICATE", "Mốc nghiệp vụ đã có nguồn xác nhận hoạt động; cần thay thế/điều chỉnh liên kết.", line));
    }
    return issues;
  }
  private async checkLines(db: Db, user: AuthUser, batch: Batch, access: Access) {
    const issues: Issue[] = [], bindings: Bindings = new Map();
    const configurationDates = await this.configurations.bindingBoundaries(db, batch.payrollPeriod.siteOrgUnitId, batch.payrollPeriod.dateFrom, batch.payrollPeriod.dateTo);
    for (const line of batch.lines) {
      const input = this.payload(line);
      try {
        await this.requireEmployeeInterval(db, user, line.employeeId, line.workFrom, line.workTo, batch.payrollPeriod.siteOrgUnitId, "payroll.inputs.manage", access);
        if (input.valueState === "MISSING") { issues.push(issue("PAYROLL_INPUT_MISSING", "Thiếu giá trị nguồn; không được coi là 0.", line)); continue; }
        const plan = await db.employeePayPlan.findUnique({ where: { employeeId: line.employeeId }, include: { versions: true } });
        if (!plan) throw new BadRequestException("Chưa có phương án lương theo nhân sự.");
        const dates = new Map(points(line.workFrom, line.workTo, [...plan.versions, ...access.versions]).map(d => [d.getTime(), d]));
        for (const at of configurationDates) if (at >= line.workFrom && at <= line.workTo) dates.set(at.getTime(), at);
        let first: Record<string, unknown> | undefined;
        for (const at of [...dates.values()].sort((a, b) => a.getTime() - b.getTime())) {
          const versions = plan.versions.filter(v => v.effectiveFrom <= at && (!v.effectiveTo || v.effectiveTo >= at));
          if (versions.length !== 1) throw new BadRequestException("Không có đúng một phương án lương hiệu lực trên toàn khoảng.");
          const version = versions[0], planLine = (version.lines as unknown as PlanLineDto[]).find(p => p.componentId === line.componentId);
          if (!planLine) throw new BadRequestException("Cấu phần không thuộc phương án lương.");
          const confirmed = batch.provenance === "BUSINESS_CONFIRMED";
          if (confirmed && version.status !== "BUSINESS_CONFIRMED") throw new BadRequestException("Nguồn nghiệp vụ không được nâng cấp phương án mô phỏng.");
          const component = await this.configurations.resolveInputComponent(db, batch.payrollPeriod.siteOrgUnitId, at, line.componentId, confirmed);
          let binding: Record<string, unknown> = { planVersionId: version.id, payMode: version.payMode, planStatus: version.status, planLine, component };
          if (input.valueState === "NOT_APPLICABLE") {
            if (planLine.role !== "NOT_APPLICABLE" || input.amount !== undefined || input.formulaCode || input.inputs?.length || input.allocatedAmount !== undefined || input.teamAllocationKey || input.adjustmentOfLineId) throw new BadRequestException("Không áp dụng cần đúng phương án NA và không có tiền/công thức/phân bổ.");
          } else {
            if (planLine.role === "NOT_APPLICABLE" || input.inputType !== "ADJUSTMENT" && planLine.sourceType !== input.inputType) throw new BadRequestException("Loại nguồn/cấu phần không khớp phương án.");
            const isTeam = planLine.allocation === "CONFIRMED_TEAM_ALLOCATION";
            if (isTeam && (!input.teamAllocationKey || input.allocatedAmount === undefined) || !isTeam && (input.teamAllocationKey || input.allocatedAmount !== undefined)) throw new BadRequestException("Phân bổ tổ phải khớp phương án, có nhóm và số tiền từng thành viên; không tự chia đều.");
            if (input.calculationMode === "FORMULA") {
              if (!input.formulaCode || input.formulaCode !== planLine.formulaCode || input.amount !== undefined || input.unit || input.amountBasis && input.inputType !== "ADJUSTMENT") throw new BadRequestException("Công thức phải khớp phương án, không đồng thời khai số tiền trực tiếp.");
              const resolved = await this.configurations.resolveInputBinding(db, batch.payrollPeriod.siteOrgUnitId, at, input.formulaCode, line.componentId, input.inputs ?? [], confirmed);
              const amount = resolved.results.find(r => r.code === input.formulaCode)?.value;
              if (typeof amount !== "string") throw new BadRequestException("Không giải được công thức nguồn.");
              const computedAmount = new Decimal(amount);
              if (computedAmount.isNegative() && input.inputType !== "ADJUSTMENT") throw new BadRequestException("Giá trị âm chỉ dành cho điều chỉnh liên kết.");
              // Zero describes the accepted source; KPI 0 must not erase fixed P1/P2.
              const explicitZero = computedAmount.isZero() || input.inputs?.some(value => value.value === "0");
              if (input.valueState === "CONFIRMED_ZERO" ? !explicitZero : computedAmount.isZero()) throw new BadRequestException("Nguồn bằng 0 cần xác nhận rõ giá trị 0; không được mặc định dữ liệu thiếu thành 0.");
              binding = { ...binding, ...resolved };
            } else {
              if (input.formulaCode || input.inputs?.length || input.amount === undefined || input.unit !== "VND" || !input.amountBasis?.trim()) throw new BadRequestException("Số tiền trực tiếp cần amount, VND, căn cứ và không có công thức/inputs.");
              const amount = decimal(input.amount, "Số tiền");
              if (amount.isNegative() && input.inputType !== "ADJUSTMENT") throw new BadRequestException("Số tiền âm chỉ dành cho điều chỉnh liên kết.");
              if (input.valueState === "CONFIRMED_ZERO" ? !amount.isZero() : amount.isZero()) throw new BadRequestException("Số tiền 0 phải được xác nhận bằng 0 rõ ràng.");
              binding = { ...binding, amount: amount.toFixed(), amountBasis: input.amountBasis, unit: "VND" };
            }
            if (["PRODUCT", "PIECEWORK", "COMMISSION", "BONUS", "THREE_P"].includes(input.inputType) && !input.businessReference?.trim()) throw new BadRequestException("Nguồn cần tham chiếu sản phẩm/công đoạn/mốc nghiệm thu/giao dịch/quyết định riêng.");
          }
          if (first && canonicalJson(first) !== canonicalJson(binding)) throw new BadRequestException("Phương án/giá/công thức/tham số/cấu phần thay đổi trong khoảng; tách dòng theo ngày hiệu lực.");
          first = binding;
        }
        if (input.inputType === "ADJUSTMENT") {
          if (!input.adjustmentOfLineId || !input.amountBasis?.trim()) throw new BadRequestException("Điều chỉnh cần nguồn gốc liên kết và căn cứ.");
          const original = await db.payrollInputLine.findUnique({ where: { id: input.adjustmentOfLineId }, include: { batch: true } });
          if (!original || !["CONFIRMED", "SUPERSEDED"].includes(original.batch.status) || original.employeeId !== line.employeeId || original.componentId !== line.componentId || original.inputType === "ADJUSTMENT") throw new BadRequestException("Điều chỉnh phải tham chiếu nguồn đã xác nhận cùng nhân sự/cấu phần.");
          await this.getBatch(db, user, original.batchId, "payroll.inputs.read", access);
          first = { ...first, adjustmentOfLineId: original.id, originalInputHash: original.inputHash };
        } else if (input.adjustmentOfLineId) throw new BadRequestException("Chỉ dòng điều chỉnh được liên kết nguồn gốc.");
        if (input.inputType === "TIME" && input.calculationMode === "FORMULA" && input.valueState !== "NOT_APPLICABLE") first = { ...first, attendance: await this.attendanceBinding(db, batch, line, access) };
        bindings.set(line.id, { ...first, inputHash: line.inputHash, sourceProvenance: batch.provenance });
      } catch (e) {
        if (e instanceof BadRequestException) issues.push(issue("PAYROLL_BINDING_INVALID", e.message, line));
        else throw e;
      }
    }
    return { issues, bindings };
  }
  private async checkTeams(db: Db, user: AuthUser, batch: Batch, access: Access) {
    const issues: Issue[] = [], groups = new Map(batch.teamAllocations.map(g => [g.allocationKey, g]));
    const members = new Map<string, Set<string>>(), totals = new Map<string, Decimal>();
    for (const line of batch.lines) {
      const input = this.payload(line);
      if (!input.teamAllocationKey) continue;
      const group = groups.get(input.teamAllocationKey);
      if (!group || !["PRODUCT", "PIECEWORK"].includes(input.inputType) || input.allocatedAmount === undefined) { issues.push(issue("PAYROLL_TEAM_ALLOCATION", "Thiếu nhóm sản phẩm/khoán hoặc số tiền phân bổ.", line)); continue; }
      const amount = decimal(input.allocatedAmount, "Phân bổ");
      if (amount.isNegative()) issues.push(issue("PAYROLL_TEAM_ALLOCATION", "Phân bổ thành viên không được âm.", line));
      const used = members.get(group.allocationKey) ?? new Set<string>();
      if (used.has(line.employeeId)) issues.push(issue("PAYROLL_TEAM_DUPLICATE_MEMBER", "Một nhân sự chỉ có một dòng trong nhóm phân bổ.", line));
      used.add(line.employeeId); members.set(group.allocationKey, used);
      totals.set(group.allocationKey, (totals.get(group.allocationKey) ?? new Decimal(0)).plus(amount));
      const employee = await this.employee(db, line.employeeId, access);
      for (const at of points(line.workFrom, line.workTo, [...employee.assignments, ...access.versions])) {
        const team = access.versions.find(v => v.orgUnitId === group.teamOrgUnitId && v.type === "TEAM" && v.effectiveFrom <= at && (!v.effectiveTo || v.effectiveTo >= at));
        const primary = employee.assignments.find(a => a.isPrimary && a.effectiveFrom <= at && (!a.effectiveTo || a.effectiveTo >= at));
        if (!team || primary?.orgUnitId !== team.orgUnitId || !this.scope(user, "payroll.inputs.manage", at, access).allowed.has(team.orgUnitId)) { issues.push(issue("PAYROLL_TEAM_MEMBERSHIP", "Nhân sự phải thuộc tổ chính trong toàn khoảng phân bổ.", line)); break; }
      }
    }
    for (const group of batch.teamAllocations) if (!members.has(group.allocationKey) || !(totals.get(group.allocationKey) ?? new Decimal(0)).eq(decimal(this.groupAmount(group), "Tổng tổ"))) issues.push(issue("PAYROLL_TEAM_UNBALANCED", `Tổng phân bổ nhóm ${group.allocationKey} không bằng số tiền được nghiệm thu.`));
    return issues;
  }
  private async transition(user: AuthUser, id: string, action: "VALIDATE" | "CONFIRM" | "RETURN", dto: PayrollActionDto, ip?: string) {
    this.assert(user, "payroll.inputs.manage");
    return this.tx(async db => {
      const access = await this.access(db, user), batch = await this.getBatch(db, user, id, "payroll.inputs.manage", access);
      if (batch.revision !== dto.revision) this.conflict("Nguồn đã thay đổi; giữ bản nhập và tải lại trước khi thao tác.");
      if (batch.payrollPeriod.status !== "OPEN") this.conflict("Kỳ đầu vào lương đã khóa.");
      const reason = clean(dto.reason ?? "", "Lý do thao tác", 2000);
      if (action === "RETURN") {
        if (!["DRAFT", "VALIDATED", "CONFIRMED"].includes(batch.status)) this.conflict("Nguồn không còn có thể trả lại.");
        await db.payrollInputBatch.update({ where: { id }, data: { status: "RETURNED", revision: { increment: 1 } } });
      } else {
        if (action === "VALIDATE" && !["DRAFT", "VALIDATED"].includes(batch.status) || action === "CONFIRM" && batch.status !== "VALIDATED") this.conflict("Chỉ nguồn nháp/đã kiểm tra được kiểm tra; chỉ nguồn đã kiểm tra được xác nhận. Nguồn trả lại cần phiên bản mới.");
        const { issues, bindings } = await this.checkLines(db, user, batch, access);
        issues.push(...await this.checkTeams(db, user, batch, access), ...await this.checkBusinessKeys(db, batch));
        if (!batch.sourceApprovedBy?.trim() || !batch.sourceApprovedAt || batch.sourceApprovedAt > businessDate() || !batch.sourceApprovalReference?.trim() && !batch.evidence.length) issues.push(issue("PAYROLL_EVIDENCE_REQUIRED", "Cần người xác nhận, ngày không ở tương lai và tham chiếu hoặc tệp chứng từ nguồn."));
        const validation = { issues, hash: hash({ contentHash: batch.contentHash, bindings: [...bindings].sort(([a], [b]) => a.localeCompare(b)), evidence: batch.evidence.map(e => ({ id: e.id, hash: e.sha256 })) }) };
        if (action === "CONFIRM") {
          const previous = batch.validationCipher ? JSON.parse(plainText(this.key, batch.validationCipher)) : null;
          if (issues.length || previous?.hash !== validation.hash) this.conflict("Nguồn hoặc phiên bản phụ thuộc đã đổi/có lỗi. Kiểm tra lại trước khi xác nhận.");
          if (batch.supersedesBatchId) {
            const previousBatch = await this.getBatch(db, user, batch.supersedesBatchId, "payroll.inputs.manage", access);
            if (previousBatch.status === "SUPERSEDED" || previousBatch.payrollPeriod.status !== "OPEN") this.conflict("Nguồn trước đã bị thay thế hoặc kỳ đã khóa.");
            const superseded = await db.payrollInputBatch.update({ where: { id: previousBatch.id }, data: { status: "SUPERSEDED", revision: { increment: 1 } }, include: INCLUDE });
            await this.record(db, user, superseded, previousBatch.status, "SUPERSEDE", reason, ip);
          }
          const active = await db.payrollInputBatch.findFirst({ where: { sourceSystem: batch.sourceSystem, sourceDocumentNo: batch.sourceDocumentNo, status: "CONFIRMED", id: { not: id } } });
          if (active) this.conflict("Chứng từ đã có phiên bản xác nhận hoạt động; phải thay thế rõ nguồn trước.");
        }
        for (const line of batch.lines) await db.payrollInputLine.update({ where: { id: line.id }, data: { bindingSnapshotCipher: bindings.has(line.id) ? cipherText(this.key, canonicalJson(bindings.get(line.id))) : null } });
        await db.payrollInputBatch.update({ where: { id }, data: { status: action === "CONFIRM" ? "CONFIRMED" : issues.length ? "DRAFT" : "VALIDATED", validationCipher: cipherText(this.key, canonicalJson(validation)), revision: { increment: 1 } } });
      }
      const saved = await db.payrollInputBatch.findUniqueOrThrow({ where: { id }, include: INCLUDE });
      await this.record(db, user, saved, batch.status, action, reason, ip);
      return { item: this.view(await db.payrollInputBatch.findUniqueOrThrow({ where: { id }, include: INCLUDE }), true, true) };
    });
  }
  validate(user: AuthUser, id: string, dto: PayrollActionDto, ip?: string) { return this.transition(user, id, "VALIDATE", dto, ip); }
  confirm(user: AuthUser, id: string, dto: PayrollActionDto, ip?: string) { return this.transition(user, id, "CONFIRM", dto, ip); }
  returned(user: AuthUser, id: string, dto: PayrollActionDto, ip?: string) { return this.transition(user, id, "RETURN", dto, ip); }
  async list(user: AuthUser, q: PayrollListQueryDto) {
    this.assert(user, "payroll.inputs.read");
    return this.prisma.$transaction(async db => {
      const access = await this.access(db, user), page = q.page ?? 1, pageSize = q.pageSize ?? 25;
      const rows = await db.payrollInputBatch.findMany({ where: { ...(q.payrollPeriodId ? { payrollPeriodId: q.payrollPeriodId } : {}), ...(q.status ? { status: q.status as Batch["status"] } : {}), ...(q.search?.trim() ? { OR: [{ sourceDocumentNo: { contains: q.search.trim(), mode: "insensitive" } }, { sourceSystem: { contains: q.search.trim(), mode: "insensitive" } }] } : {}) }, include: INCLUDE, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
      const visible = [];
      for (const row of rows) {
        try {
          await this.authorizeBatch(db, user, row, "payroll.inputs.read", access);
          let canManage = false;
          if (user.permissions.includes("payroll.inputs.manage")) try { await this.authorizeBatch(db, user, row, "payroll.inputs.manage", access); canManage = row.payrollPeriod.status === "OPEN"; } catch (e) { if (!(e instanceof NotFoundException || e instanceof ForbiddenException)) throw e; }
          visible.push({ row, canManage });
        } catch (e) { if (!(e instanceof NotFoundException)) throw e; }
      }
      return { items: visible.slice((page - 1) * pageSize, page * pageSize).map(v => this.view(v.row, false, v.canManage)), total: visible.length, page, pageSize };
    }, { timeout: 30_000 });
  }
  async detail(user: AuthUser, id: string) {
    return this.prisma.$transaction(async db => {
      const access = await this.access(db, user), row = await this.getBatch(db, user, id, "payroll.inputs.read", access);
      let canManage = false;
      if (user.permissions.includes("payroll.inputs.manage")) try { await this.authorizeBatch(db, user, row, "payroll.inputs.manage", access); canManage = row.payrollPeriod.status === "OPEN"; } catch (e) { if (!(e instanceof NotFoundException || e instanceof ForbiddenException)) throw e; }
      return { item: this.view(row, true, canManage) };
    });
  }
  async confirmed(user: AuthUser, periodId: string) {
    this.assert(user, "payroll.inputs.read");
    return this.prisma.$transaction(async db => {
      const access = await this.access(db, user), items = [];
      const period = await db.payrollPeriod.findUnique({ where: { id: periodId } });
      if (!period) throw new NotFoundException("Không tìm thấy kỳ đầu vào lương.");
      this.requireSiteScope(user, period.siteOrgUnitId, period.dateFrom, period.dateTo, "payroll.inputs.read", access);
      const rows = await db.payrollInputBatch.findMany({ where: { payrollPeriodId: periodId, status: "CONFIRMED" }, include: INCLUDE });
      for (const row of rows) {
        try { await this.authorizeBatch(db, user, row, "payroll.inputs.read", access); for (const line of row.lines) items.push({ ...this.lineView(line), batchId: row.id, sourceKey: { sourceSystem: row.sourceSystem, sourceDocumentNo: row.sourceDocumentNo, sourceVersion: row.sourceVersion, sourceLineId: line.sourceLineId }, contentHash: row.contentHash, provenance: row.provenance }); }
        catch (e) { if (!(e instanceof NotFoundException)) throw e; }
      }
      return { items };
    }, { timeout: 30_000 });
  }
  async upload(user: AuthUser, id: string, file: Express.Multer.File | undefined, ip?: string) {
    this.assert(user, "payroll.inputs.manage");
    return this.tx(async db => {
      const access = await this.access(db, user), row = await this.getBatch(db, user, id, "payroll.inputs.manage", access);
      if (!["DRAFT", "VALIDATED"].includes(row.status) || row.payrollPeriod.status !== "OPEN") this.conflict("Nguồn không còn cho phép bổ sung chứng từ.");
      if (!file?.buffer.length || file.size > 5_242_880 || row.evidence.length >= 10) throw new BadRequestException("Chứng từ không rỗng, tối đa 5 MB và 10 tệp.");
      const buffer = file.buffer;
      let contentType: string;
      if (buffer.subarray(0, 5).toString() === "%PDF-") contentType = "application/pdf";
      else if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) contentType = "image/png";
      else if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) contentType = "image/jpeg";
      else {
        try { new TextDecoder("utf-8", { fatal: true }).decode(buffer); } catch { throw new BadRequestException("Chỉ nhận PDF/PNG/JPEG/TXT UTF-8."); }
        if (!/\.txt$/i.test(file.originalname) || buffer.includes(0)) throw new BadRequestException("Chỉ nhận PDF/PNG/JPEG/TXT UTF-8.");
        contentType = "text/plain; charset=utf-8";
      }
      const fileName = (file.originalname.split(/[\\/]/).pop() ?? "chung-tu").replace(/[\x00-\x1f\x7f]/g, "").slice(0, 255);
      await db.payrollInputEvidence.create({ data: { batchId: id, fileName, contentType, size: buffer.length, sha256: createHash("sha256").update(buffer).digest("hex"), contentCipher: cipherText(this.key, buffer.toString("base64")), uploadedById: user.id } });
      const saved = await db.payrollInputBatch.update({ where: { id }, data: { status: "DRAFT", validationCipher: null, revision: { increment: 1 } }, include: INCLUDE });
      await this.record(db, user, saved, row.status, "ATTACH_EVIDENCE", "Bổ sung chứng từ nguồn", ip);
      return { item: this.view(await db.payrollInputBatch.findUniqueOrThrow({ where: { id }, include: INCLUDE }), true, true) };
    });
  }
  async evidence(user: AuthUser, id: string, evidenceId: string, ip?: string) {
    const evidence = await this.prisma.$transaction(async db => {
      const row = await this.getBatch(db, user, id, "payroll.inputs.read", await this.access(db, user));
      const evidence = row.evidence.find(e => e.id === evidenceId);
      if (!evidence) throw new NotFoundException("Không tìm thấy chứng từ.");
      return evidence;
    });
    await this.audit.record({ actorId: user.id, entityType: "payroll_input_evidence", entityId: evidence.id, action: "DOWNLOAD", result: "ALLOWED", ipAddress: ip });
    return { ...evidence, content: Buffer.from(plainText(this.key, evidence.contentCipher), "base64") };
  }
  template(user: AuthUser) {
    this.assert(user, "payroll.inputs.read");
    return Buffer.from("sourceLineId,employeeCode,componentCode,inputType,workFrom,workTo,valueState,calculationMode,formulaCode,inputCode,inputUnit,inputValue,amount,unit,amountBasis,businessReference,adjustmentOfLineId,teamAllocationKey,allocatedAmount\r\n", "utf8");
  }
  async importCsv(user: AuthUser, file: Express.Multer.File | undefined, metadataText: string, ip?: string) {
    this.assert(user, "payroll.inputs.manage");
    if (!file?.buffer.length || file.size > 5_242_880) throw new BadRequestException("CSV UTF-8 không rỗng, tối đa 5 MB.");
    let metadata: Omit<PayrollBatchDto, "lines">;
    try { metadata = JSON.parse(metadataText); } catch { throw new BadRequestException("Metadata CSV không hợp lệ."); }
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata) || "lines" in metadata) throw new BadRequestException("Metadata CSV không hợp lệ.");
    let rows: Record<string, string>[];
    try { const text = new TextDecoder("utf-8", { fatal: true }).decode(file.buffer); rows = parse(text, { columns: true, skip_empty_lines: true, relax_column_count: false, bom: true, max_record_size: 100_000 }); }
    catch { throw new BadRequestException("CSV phải đúng RFC4180 UTF-8."); }
    if (!rows.length || rows.length > 16_000) throw new BadRequestException("CSV rỗng hoặc quá số dòng dữ liệu cho phép.");
    const expected = this.template(user).toString().trim().split(",");
    if (Object.keys(rows[0]).length !== expected.length || expected.some(key => !Object.hasOwn(rows[0], key))) throw new BadRequestException("Cột CSV không đúng mẫu.");
    const employees = await this.prisma.employee.findMany({ where: { code: { in: [...new Set(rows.map(r => r.employeeCode))] } }, select: { id: true, code: true } });
    const em = new Map(employees.map(e => [e.code, e.id])), grouped = new Map<string, PayrollInputLineDto>();
    const period = await this.prisma.payrollPeriod.findUnique({ where: { id: metadata.payrollPeriodId } });
    if (!period) throw new NotFoundException("Không tìm thấy kỳ đầu vào lương.");
    for (const row of rows) {
      const employeeId = em.get(row.employeeCode);
      if (!row.sourceLineId || !employeeId) throw new BadRequestException("CSV có mã nhân sự/mã dòng không hợp lệ.");
      const at = date(row.workFrom);
      const plan = await this.prisma.employeePayPlan.findUnique({ where: { employeeId }, include: { versions: { where: effectiveAt(at) } } });
      const planLines = plan?.versions.flatMap(v => v.lines as unknown as PlanLineDto[]) ?? [];
      const components = await this.prisma.salaryComponent.findMany({ where: { code: row.componentCode, id: { in: planLines.map(l => l.componentId) } }, select: { id: true } });
      if (components.length !== 1) throw new BadRequestException("Mã cấu phần CSV không xác định duy nhất trong phương án hiệu lực của nhân sự.");
      const base = { sourceLineId: row.sourceLineId, employeeId, componentId: components[0].id, inputType: row.inputType, workFrom: row.workFrom, workTo: row.workTo, valueState: row.valueState, calculationMode: row.calculationMode, formulaCode: row.formulaCode || undefined, amount: row.amount || undefined, unit: row.unit || undefined, amountBasis: row.amountBasis || undefined, businessReference: row.businessReference || undefined, adjustmentOfLineId: row.adjustmentOfLineId || undefined, teamAllocationKey: row.teamAllocationKey || undefined, allocatedAmount: row.allocatedAmount || undefined } as PayrollInputLineDto;
      const prior = grouped.get(base.sourceLineId);
      if (prior && canonicalJson({ ...prior, inputs: undefined }) !== canonicalJson(base)) throw new BadRequestException("Các hàng cùng mã dòng nguồn phải có metadata giống nhau.");
      const line = prior ?? { ...base, inputs: [] };
      if (row.inputCode) {
        if (line.inputs!.some(v => v.code === row.inputCode)) throw new BadRequestException("Mã input trùng trong dòng nguồn.");
        line.inputs!.push({ code: row.inputCode, unit: row.inputUnit, value: row.inputValue });
      } else if (row.inputUnit || row.inputValue) throw new BadRequestException("Giá trị/đơn vị input cần mã input.");
      grouped.set(line.sourceLineId, line);
      if (grouped.size > 500) throw new BadRequestException("CSV tối đa 500 dòng nguồn sau nhóm.");
    }
    if (metadata.supersedesBatchId) {
      const previous = await this.prisma.$transaction(async db => this.getBatch(db, user, metadata.supersedesBatchId!, "payroll.inputs.manage", await this.access(db, user)));
      for (const line of grouped.values()) line.supersedesLineId = previous.lines.find(old => old.sourceLineId === line.sourceLineId)?.id;
    }
    return this.create(user, { ...metadata, lines: [...grouped.values()] }, ip, { name: (file.originalname.split(/[\\/]/).pop() ?? "nguon.csv").replace(/[\x00-\x1f\x7f]/g, "").slice(0, 255), hash: createHash("sha256").update(file.buffer).digest("hex") });
  }
}
