import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EmployeeSpecialStatusType, Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { AuditService } from "../audit/audit.service";
import { businessDate } from "../auth/business-date";
import type { AuthUser } from "../auth/auth.types";
import { blindIndex, cipherText, maskValue, plainText } from "../common/data-crypto";
import { PrismaService } from "../database/prisma.service";
import { effectiveAt, ScopeService } from "../organization/scope.service";
import type { BankAccountDto, DependentDto, DependentVersionDto, IdentityDto, SpecialStatusDto, TaxProfileDto } from "./payroll-profile.dto";

type Db = Prisma.TransactionClient;
type Dated = { id: string; effectiveFrom: Date; effectiveTo: Date | null };
const DAY = 86_400_000;
const key = (date: Date) => date.toISOString().slice(0, 10);

function date(value: string, label = "Ngày"): Date {
  const parsed = new Date(value + "T00:00:00.000Z");
  if (!Number.isFinite(parsed.getTime()) || key(parsed) !== value) throw new BadRequestException(label + " không hợp lệ.");
  return parsed;
}
function optionalText(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
function fail(status: "conflict" | "bad", code: string, message: string, details?: Record<string, unknown>): never {
  const body = { code, message, ...(details ? { details } : {}) };
  throw status === "conflict" ? new ConflictException(body) : new BadRequestException(body);
}

/** Canonical forms used both for storage and blind indexes, so formatting never defeats duplicate checks. */
export const normalize = {
  idNumber(type: "CCCD" | "PASSPORT", value: string): string {
    const compact = value.replace(/\s+/g, "").toUpperCase();
    if (type === "CCCD" ? !/^\d{12}$/.test(compact) : !/^[A-Z0-9]{6,12}$/.test(compact)) fail("bad", "IDENTITY_NUMBER_INVALID", type === "CCCD" ? "Số CCCD phải gồm 12 chữ số." : "Số hộ chiếu gồm 6–12 chữ hoặc số.");
    return compact;
  },
  taxCode(value: string): string {
    const compact = value.replace(/[\s.]/g, "");
    if (!/^\d{10}(-\d{3})?$/.test(compact)) fail("bad", "TAX_CODE_INVALID", "Mã số thuế gồm 10 chữ số hoặc 10 chữ số kèm -xxx.");
    return compact;
  },
  siBook(value: string): string {
    const compact = value.replace(/\s+/g, "");
    if (!/^\d{10}$/.test(compact)) fail("bad", "SI_BOOK_INVALID", "Số sổ BHXH (mã số BHXH) gồm 10 chữ số.");
    return compact;
  },
  account(value: string): string {
    const compact = value.replace(/[\s.-]/g, "");
    if (!/^\d{6,20}$/.test(compact)) fail("bad", "BANK_ACCOUNT_INVALID", "Số tài khoản gồm 6–20 chữ số.");
    return compact;
  },
};

export interface PayrollProfileSnapshot {
  employeeId: string;
  asOf: string;
  identity: { documentType: string; idNumber: string; taxCode: string | null; siBookNumber: string | null; dataStatus: string } | null;
  bankAccount: { id: string; bankCode: string; bankName: string; accountNumber: string; accountHolder: string; effectiveFrom: string; dataStatus: string } | null;
  taxProfile: { id: string; residency: string; commitmentReference: string | null; commitmentTemplateVersion: string | null; finalizationAuthorized: boolean; effectiveFrom: string; dataStatus: string } | null;
  specialStatuses: Array<{ id: string; statusType: EmployeeSpecialStatusType; workPermitNumber: string | null; permitExpiry: string | null; effectiveFrom: string }>;
}

@Injectable()
export class PayrollProfileService {
  private readonly key: Buffer;

  constructor(private readonly prisma: PrismaService, private readonly scope: ScopeService, private readonly audit: AuditService, config: ConfigService) {
    this.key = Buffer.from(config.getOrThrow<string>("HR_DATA_KEY"), "base64");
  }

  private hash(kind: string, value: string) { return blindIndex(this.key, kind, value); }
  private decrypt(value: string) { return plainText(this.key, value, "hồ sơ lương"); }

  /** Scope + exclusion check at the business date; denials are audited before being raised. */
  private async assertEmployee(user: AuthUser, permission: "payroll.profile.read" | "payroll.profile.manage", employeeId: string, ip?: string, db: Db = this.prisma) {
    const deny = async (message: string) => {
      await this.audit.record({ actorId: user.id, entityType: "employee_payroll_profile", entityId: employeeId, action: "ACCESS_DENIED", result: "DENIED", newValue: { permission }, ipAddress: ip });
      throw new ForbiddenException(message);
    };
    if (!user.permissions.includes(permission)) await deny("Bạn không có quyền thực hiện thao tác này.");
    const scope = await this.scope.load(user, permission, db);
    const today = businessDate();
    const employee = await db.employee.findFirst({
      where: { id: employeeId, assignments: { some: { ...effectiveAt(today), orgUnitId: { in: [...scope.allowed] } } }, exclusions: { none: { userAccountId: user.id, ...effectiveAt(today) } } },
      select: { id: true, code: true, fullName: true },
    });
    if (!employee) {
      if (!(await db.employee.findUnique({ where: { id: employeeId }, select: { id: true } }))) throw new NotFoundException("Không tìm thấy nhân viên.");
      await deny("Nhân viên nằm ngoài phạm vi được phân quyền.");
    }
    return employee!;
  }

  private canSeeSensitive(user: AuthUser) { return user.permissions.includes("employee.sensitive.read") && !user.roles.includes("AD"); }

  private transaction<T>(employeeId: string, work: (db: Db) => Promise<T>) {
    return this.prisma.$transaction(async db => {
      await db.$queryRaw`SELECT id FROM employee WHERE id = ${employeeId}::uuid FOR UPDATE`;
      return work(db);
    }, { isolationLevel: "Serializable" }).catch(error => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const target = String(error.meta?.target ?? "");
        if (target.includes("tax_code_hash")) fail("conflict", "DUPLICATE_TAX_CODE", "Mã số thuế đã thuộc nhân viên khác.");
        if (target.includes("si_book_hash")) fail("conflict", "DUPLICATE_SI_BOOK", "Số sổ BHXH đã thuộc nhân viên khác.");
        if (target.includes("id_number_hash")) fail("conflict", "DUPLICATE_ID_NUMBER", "Số CCCD/hộ chiếu đã thuộc nhân viên khác.");
      }
      if (error instanceof Prisma.PrismaClientUnknownRequestError && /no_overlap|exclusion/.test(error.message)) fail("conflict", "EFFECTIVE_OVERLAP", "Khoảng hiệu lực bị chồng với bản ghi khác.");
      throw error;
    });
  }

  async banks() {
    return { items: await this.prisma.bank.findMany({ where: { active: true }, orderBy: { shortName: "asc" } }) };
  }

  async profile(user: AuthUser, employeeId: string, ip?: string) {
    const employee = await this.assertEmployee(user, "payroll.profile.read", employeeId, ip);
    const full = this.canSeeSensitive(user);
    const [identity, bankAccounts, dependents, taxProfiles, specialStatuses, history] = await Promise.all([
      this.prisma.employeeIdentity.findUnique({ where: { employeeId } }),
      this.prisma.employeeBankAccount.findMany({ where: { employeeId }, include: { bank: true }, orderBy: { effectiveFrom: "desc" } }),
      this.prisma.employeeDependent.findMany({ where: { employeeId }, orderBy: [{ dependentKey: "asc" }, { version: "desc" }] }),
      this.prisma.taxProfile.findMany({ where: { employeeId }, orderBy: { effectiveFrom: "desc" } }),
      this.prisma.employeeSpecialStatus.findMany({ where: { employeeId }, orderBy: [{ statusType: "asc" }, { effectiveFrom: "desc" }] }),
      this.prisma.employeeIdentityHistory.findMany({ where: { employeeId }, orderBy: { revision: "desc" }, include: { actor: { select: { id: true, displayName: true } } } }),
    ]);
    const reveal = (cipher: string | null) => cipher === null ? null : full ? this.decrypt(cipher) : maskValue(this.decrypt(cipher));
    await this.audit.record({ actorId: user.id, entityType: "employee_payroll_profile", entityId: employeeId, action: "VIEW_SENSITIVE", result: full ? "ALLOWED" : "MASKED", ipAddress: ip });
    const latestDependents = new Map<string, typeof dependents[number]>();
    for (const row of dependents) if (!latestDependents.has(row.dependentKey)) latestDependents.set(row.dependentKey, row);
    return {
      employee, masked: !full,
      identity: identity && {
        revision: identity.revision, documentType: identity.documentType, idNumber: reveal(identity.idNumberCipher), idIssueDate: identity.idIssueDate ? key(identity.idIssueDate) : null, idIssuePlace: identity.idIssuePlace,
        taxCode: reveal(identity.taxCodeCipher), siBookNumber: reveal(identity.siBookCipher),
        emergencyContact: { name: identity.emergencyContactName, phone: identity.emergencyContactPhone, relation: identity.emergencyContactRelation },
        documentReference: identity.documentReference, dataStatus: identity.dataStatus, updatedAt: identity.updatedAt.toISOString(),
      },
      identityHistory: history.map(row => ({ revision: row.revision, reason: row.reason, actor: row.actor, createdAt: row.createdAt.toISOString() })),
      bankAccounts: bankAccounts.map(row => ({ id: row.id, bankCode: row.bankCode, bankName: row.bank.shortName, accountNumber: reveal(row.accountNumberCipher), accountHolder: row.accountHolder, branch: row.branch, effectiveFrom: key(row.effectiveFrom), effectiveTo: row.effectiveTo ? key(row.effectiveTo) : null, reason: row.reason, dataStatus: row.dataStatus })),
      dependents: [...latestDependents.values()].map(row => ({
        dependentKey: row.dependentKey, version: row.version, fullName: row.fullName, relationship: row.relationship, taxCode: reveal(row.taxCodeCipher),
        birthDate: row.birthDate ? key(row.birthDate) : null, deductionFromMonth: row.deductionFromMonth, deductionToMonth: row.deductionToMonth, evidenceReference: row.evidenceReference, reason: row.reason, dataStatus: row.dataStatus,
        history: dependents.filter(item => item.dependentKey === row.dependentKey).map(item => ({ version: item.version, deductionFromMonth: item.deductionFromMonth, deductionToMonth: item.deductionToMonth, reason: item.reason, createdAt: item.createdAt.toISOString() })),
      })),
      taxProfiles: taxProfiles.map(row => ({ id: row.id, residency: row.residency, commitmentReference: row.commitmentReference, commitmentTemplateVersion: row.commitmentTemplateVersion, finalizationAuthorized: row.finalizationAuthorized, effectiveFrom: key(row.effectiveFrom), effectiveTo: row.effectiveTo ? key(row.effectiveTo) : null, reason: row.reason, dataStatus: row.dataStatus })),
      specialStatuses: specialStatuses.map(row => ({ id: row.id, statusType: row.statusType, workPermitNumber: row.workPermitNumber, permitExpiry: row.permitExpiry ? key(row.permitExpiry) : null, reference: row.reference, effectiveFrom: key(row.effectiveFrom), effectiveTo: row.effectiveTo ? key(row.effectiveTo) : null, reason: row.reason, dataStatus: row.dataStatus })),
    };
  }

  async saveIdentity(user: AuthUser, employeeId: string, dto: IdentityDto, ip?: string) {
    await this.assertEmployee(user, "payroll.profile.manage", employeeId, ip);
    const idNumber = normalize.idNumber(dto.documentType, dto.idNumber);
    const taxCode = optionalText(dto.taxCode) ? normalize.taxCode(dto.taxCode!) : null;
    const siBook = optionalText(dto.siBookNumber) ? normalize.siBook(dto.siBookNumber!) : null;
    const data = {
      documentType: dto.documentType, idNumberCipher: cipherText(this.key, idNumber), idNumberHash: this.hash("ID_NUMBER", idNumber),
      idIssueDate: dto.idIssueDate ? date(dto.idIssueDate, "Ngày cấp") : null, idIssuePlace: optionalText(dto.idIssuePlace),
      taxCodeCipher: taxCode ? cipherText(this.key, taxCode) : null, taxCodeHash: taxCode ? this.hash("TAX_CODE", taxCode) : null,
      siBookCipher: siBook ? cipherText(this.key, siBook) : null, siBookHash: siBook ? this.hash("SI_BOOK", siBook) : null,
      emergencyContactName: optionalText(dto.emergencyContactName), emergencyContactPhone: optionalText(dto.emergencyContactPhone), emergencyContactRelation: optionalText(dto.emergencyContactRelation),
      documentReference: optionalText(dto.documentReference), dataStatus: dto.dataStatus, updatedById: user.id, updatedAt: new Date(),
    };
    return this.transaction(employeeId, async db => {
      await this.assertEmployee(user, "payroll.profile.manage", employeeId, ip, db);
      // Explicit checks give a stable business code even before the unique index fires.
      const clash = await db.employeeIdentity.findFirst({ where: { employeeId: { not: employeeId }, OR: [{ idNumberHash: data.idNumberHash }, ...(data.taxCodeHash ? [{ taxCodeHash: data.taxCodeHash }] : []), ...(data.siBookHash ? [{ siBookHash: data.siBookHash }] : [])] } });
      if (clash?.taxCodeHash && clash.taxCodeHash === data.taxCodeHash) fail("conflict", "DUPLICATE_TAX_CODE", "Mã số thuế đã thuộc nhân viên khác.");
      if (clash?.siBookHash && clash.siBookHash === data.siBookHash) fail("conflict", "DUPLICATE_SI_BOOK", "Số sổ BHXH đã thuộc nhân viên khác.");
      if (clash) fail("conflict", "DUPLICATE_ID_NUMBER", "Số CCCD/hộ chiếu đã thuộc nhân viên khác.");
      const existing = await db.employeeIdentity.findUnique({ where: { employeeId } });
      if ((existing?.revision ?? 0) !== dto.revision) fail("conflict", "STALE_REVISION", "Hồ sơ định danh đã thay đổi; tải lại trước khi lưu.");
      const saved = existing
        ? await db.employeeIdentity.update({ where: { employeeId }, data: { ...data, revision: existing.revision + 1 } })
        : await db.employeeIdentity.create({ data: { ...data, employeeId } });
      // History keeps only ciphertext and indexes; audit keeps hashes, never clear identifiers.
      const snapshot = { documentType: saved.documentType, idNumberCipher: saved.idNumberCipher, idNumberHash: saved.idNumberHash, taxCodeCipher: saved.taxCodeCipher, taxCodeHash: saved.taxCodeHash, siBookCipher: saved.siBookCipher, siBookHash: saved.siBookHash, idIssueDate: dto.idIssueDate ?? null, idIssuePlace: saved.idIssuePlace, emergencyContactName: saved.emergencyContactName, emergencyContactPhone: saved.emergencyContactPhone, emergencyContactRelation: saved.emergencyContactRelation, documentReference: saved.documentReference, dataStatus: saved.dataStatus };
      await db.employeeIdentityHistory.create({ data: { employeeId, revision: saved.revision, snapshot, reason: dto.reason.trim(), actorId: user.id } });
      await this.audit.record({ actorId: user.id, entityType: "employee_identity", entityId: employeeId, action: existing ? "UPDATE" : "CREATE", result: "SUCCESS", oldValue: existing ? { revision: existing.revision, idNumberHash: existing.idNumberHash, taxCodeHash: existing.taxCodeHash, siBookHash: existing.siBookHash } : undefined, newValue: { revision: saved.revision, idNumberHash: saved.idNumberHash, taxCodeHash: saved.taxCodeHash, siBookHash: saved.siBookHash, reason: dto.reason.trim() }, ipAddress: ip }, db);
      return { revision: saved.revision };
    });
  }

  /** Opens a dated row: an open predecessor is closed the day before; any other overlap is refused with its id. */
  private async placeDated(rows: Dated[], from: Date, to: Date | null, close: (id: string, effectiveTo: Date) => Promise<unknown>) {
    if (to && to < from) fail("bad", "EFFECTIVE_RANGE_INVALID", "Ngày kết thúc hiệu lực phải từ ngày bắt đầu trở đi.");
    const latest = [...rows].sort((left, right) => right.effectiveFrom.getTime() - left.effectiveFrom.getTime())[0];
    const closable = latest && latest.effectiveTo === null && latest.effectiveFrom < from ? latest : null;
    const end = to ?? new Date("9999-12-31T00:00:00Z");
    const overlap = rows.find(row => row.id !== closable?.id && row.effectiveFrom <= end && (row.effectiveTo === null || row.effectiveTo >= from));
    if (overlap) fail("conflict", "EFFECTIVE_OVERLAP", `Khoảng hiệu lực chồng với bản ghi từ ${key(overlap.effectiveFrom)}${overlap.effectiveTo ? " đến " + key(overlap.effectiveTo) : ""}.`, { overlappingId: overlap.id, effectiveFrom: key(overlap.effectiveFrom), effectiveTo: overlap.effectiveTo ? key(overlap.effectiveTo) : null });
    if (closable) await close(closable.id, new Date(from.getTime() - DAY));
    return closable?.id ?? null;
  }

  async addBankAccount(user: AuthUser, employeeId: string, dto: BankAccountDto, ip?: string) {
    await this.assertEmployee(user, "payroll.profile.manage", employeeId, ip);
    const account = normalize.account(dto.accountNumber);
    const from = date(dto.effectiveFrom, "Ngày hiệu lực");
    return this.transaction(employeeId, async db => {
      await this.assertEmployee(user, "payroll.profile.manage", employeeId, ip, db);
      if (!(await db.bank.findFirst({ where: { code: dto.bankCode, active: true } }))) fail("bad", "BANK_UNKNOWN", "Ngân hàng không có trong danh mục.");
      const rows = await db.employeeBankAccount.findMany({ where: { employeeId } });
      const closed = await this.placeDated(rows, from, null, (id, effectiveTo) => db.employeeBankAccount.update({ where: { id }, data: { effectiveTo } }));
      const row = await db.employeeBankAccount.create({ data: { employeeId, bankCode: dto.bankCode, accountNumberCipher: cipherText(this.key, account), accountNumberHash: this.hash("BANK_ACCOUNT", dto.bankCode + ":" + account), accountHolder: dto.accountHolder.trim(), branch: optionalText(dto.branch), reason: dto.reason.trim(), dataStatus: dto.dataStatus, effectiveFrom: from, createdById: user.id } });
      await this.audit.record({ actorId: user.id, entityType: "employee_bank_account", entityId: row.id, action: "CREATE_VERSION", result: "SUCCESS", newValue: { employeeId, bankCode: row.bankCode, accountNumberHash: row.accountNumberHash, effectiveFrom: dto.effectiveFrom, closedId: closed, reason: row.reason }, ipAddress: ip }, db);
      return { id: row.id, closedId: closed };
    });
  }

  async addTaxProfile(user: AuthUser, employeeId: string, dto: TaxProfileDto, ip?: string) {
    await this.assertEmployee(user, "payroll.profile.manage", employeeId, ip);
    const from = date(dto.effectiveFrom, "Ngày hiệu lực"), to = dto.effectiveTo ? date(dto.effectiveTo, "Ngày hết hiệu lực") : null;
    const commitmentReference = optionalText(dto.commitmentReference), commitmentTemplateVersion = optionalText(dto.commitmentTemplateVersion);
    if ((commitmentReference === null) !== (commitmentTemplateVersion === null)) fail("bad", "COMMITMENT_INCOMPLETE", "Cam kết tạm không khấu trừ cần cả tham chiếu và phiên bản mẫu.");
    return this.transaction(employeeId, async db => {
      await this.assertEmployee(user, "payroll.profile.manage", employeeId, ip, db);
      const rows = await db.taxProfile.findMany({ where: { employeeId } });
      const closed = await this.placeDated(rows, from, to, (id, effectiveTo) => db.taxProfile.update({ where: { id }, data: { effectiveTo } }));
      const row = await db.taxProfile.create({ data: { employeeId, residency: dto.residency, commitmentReference, commitmentTemplateVersion, finalizationAuthorized: dto.finalizationAuthorized, reason: dto.reason.trim(), dataStatus: dto.dataStatus, effectiveFrom: from, effectiveTo: to, createdById: user.id } });
      await this.audit.record({ actorId: user.id, entityType: "tax_profile", entityId: row.id, action: "CREATE_VERSION", result: "SUCCESS", newValue: { employeeId, residency: row.residency, commitmentReference, commitmentTemplateVersion, finalizationAuthorized: row.finalizationAuthorized, effectiveFrom: dto.effectiveFrom, effectiveTo: dto.effectiveTo ?? null, closedId: closed, reason: row.reason }, ipAddress: ip }, db);
      return { id: row.id, closedId: closed };
    });
  }

  async addSpecialStatus(user: AuthUser, employeeId: string, dto: SpecialStatusDto, ip?: string) {
    await this.assertEmployee(user, "payroll.profile.manage", employeeId, ip);
    const from = date(dto.effectiveFrom, "Ngày hiệu lực"), to = dto.effectiveTo ? date(dto.effectiveTo, "Ngày hết hiệu lực") : null;
    const permit = optionalText(dto.workPermitNumber);
    if (dto.statusType === "FOREIGN_WORKER" && (!permit || !dto.permitExpiry)) fail("bad", "WORK_PERMIT_REQUIRED", "Người nước ngoài cần số giấy phép lao động và thời hạn.");
    return this.transaction(employeeId, async db => {
      await this.assertEmployee(user, "payroll.profile.manage", employeeId, ip, db);
      const rows = await db.employeeSpecialStatus.findMany({ where: { employeeId, statusType: dto.statusType } });
      const closed = await this.placeDated(rows, from, to, (id, effectiveTo) => db.employeeSpecialStatus.update({ where: { id }, data: { effectiveTo } }));
      const row = await db.employeeSpecialStatus.create({ data: { employeeId, statusType: dto.statusType, workPermitNumber: permit, permitExpiry: dto.permitExpiry ? date(dto.permitExpiry, "Thời hạn giấy phép") : null, reference: dto.reference.trim(), reason: dto.reason.trim(), dataStatus: dto.dataStatus, effectiveFrom: from, effectiveTo: to, createdById: user.id } });
      await this.audit.record({ actorId: user.id, entityType: "employee_special_status", entityId: row.id, action: "CREATE_VERSION", result: "SUCCESS", newValue: { employeeId, statusType: row.statusType, effectiveFrom: dto.effectiveFrom, effectiveTo: dto.effectiveTo ?? null, closedId: closed, reason: row.reason }, ipAddress: ip }, db);
      return { id: row.id, closedId: closed };
    });
  }

  private dependentData(dto: DependentDto) {
    if (!optionalText(dto.evidenceReference)) fail("bad", "DEPENDENT_EVIDENCE_REQUIRED", "Người phụ thuộc cần chứng từ chứng minh trước khi được giảm trừ.");
    if (dto.deductionToMonth && dto.deductionToMonth < dto.deductionFromMonth) fail("bad", "DEPENDENT_MONTHS_INVALID", "Tháng kết thúc giảm trừ không được trước tháng bắt đầu.");
    const taxCode = optionalText(dto.taxCode) ? normalize.taxCode(dto.taxCode!) : null;
    return { fullName: dto.fullName.trim(), relationship: dto.relationship.trim(), taxCodeCipher: taxCode ? cipherText(this.key, taxCode) : null, birthDate: dto.birthDate ? date(dto.birthDate, "Ngày sinh") : null,
      deductionFromMonth: dto.deductionFromMonth, deductionToMonth: dto.deductionToMonth ?? null, evidenceReference: dto.evidenceReference!.trim(), reason: dto.reason.trim(), dataStatus: dto.dataStatus };
  }

  async addDependent(user: AuthUser, employeeId: string, dto: DependentDto, ip?: string) {
    await this.assertEmployee(user, "payroll.profile.manage", employeeId, ip);
    const data = this.dependentData(dto);
    return this.transaction(employeeId, async db => {
      await this.assertEmployee(user, "payroll.profile.manage", employeeId, ip, db);
      const row = await db.employeeDependent.create({ data: { ...data, employeeId, dependentKey: randomUUID(), version: 1, createdById: user.id } });
      await this.audit.record({ actorId: user.id, entityType: "employee_dependent", entityId: row.dependentKey, action: "CREATE", result: "SUCCESS", newValue: { employeeId, version: 1, deductionFromMonth: row.deductionFromMonth, deductionToMonth: row.deductionToMonth, reason: row.reason }, ipAddress: ip }, db);
      return { dependentKey: row.dependentKey, version: row.version };
    });
  }

  /** Edits never rewrite a used row: every change is a new version with its own reason. */
  async addDependentVersion(user: AuthUser, employeeId: string, dependentKey: string, dto: DependentVersionDto, ip?: string) {
    await this.assertEmployee(user, "payroll.profile.manage", employeeId, ip);
    const data = this.dependentData(dto);
    return this.transaction(employeeId, async db => {
      await this.assertEmployee(user, "payroll.profile.manage", employeeId, ip, db);
      const latest = await db.employeeDependent.findFirst({ where: { employeeId, dependentKey }, orderBy: { version: "desc" } });
      if (!latest) throw new NotFoundException("Không tìm thấy người phụ thuộc.");
      if (latest.version !== dto.expectedVersion) fail("conflict", "STALE_REVISION", "Người phụ thuộc đã có phiên bản mới; tải lại trước khi sửa.");
      const row = await db.employeeDependent.create({ data: { ...data, employeeId, dependentKey, version: latest.version + 1, createdById: user.id } });
      await this.audit.record({ actorId: user.id, entityType: "employee_dependent", entityId: dependentKey, action: "CREATE_VERSION", result: "SUCCESS", oldValue: { version: latest.version, deductionFromMonth: latest.deductionFromMonth, deductionToMonth: latest.deductionToMonth }, newValue: { version: row.version, deductionFromMonth: row.deductionFromMonth, deductionToMonth: row.deductionToMonth, reason: row.reason }, ipAddress: ip }, db);
      return { dependentKey, version: row.version };
    });
  }

  /** Dependents eligible for the PIT family deduction in a tax month (latest version of each dependent). */
  async eligibleDependentCount(employeeId: string, month: string, db: Db = this.prisma): Promise<number> {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new BadRequestException("Tháng không hợp lệ.");
    const rows = await db.employeeDependent.findMany({ where: { employeeId }, orderBy: [{ dependentKey: "asc" }, { version: "desc" }] });
    const latest = new Map<string, typeof rows[number]>();
    for (const row of rows) if (!latest.has(row.dependentKey)) latest.set(row.dependentKey, row);
    return [...latest.values()].filter(row => row.deductionFromMonth <= month && (row.deductionToMonth === null || row.deductionToMonth >= month)).length;
  }

  async dependentCount(user: AuthUser, employeeId: string, month: string, ip?: string) {
    await this.assertEmployee(user, "payroll.profile.read", employeeId, ip);
    return { month, count: await this.eligibleDependentCount(employeeId, month) };
  }

  /** Dated profile for insurance, tax and payment modules; identifiers are decrypted for server-side use only. */
  async profileAt(employeeId: string, asOf: Date, db: Db = this.prisma): Promise<PayrollProfileSnapshot> {
    const [identity, bank, tax, statuses] = await Promise.all([
      db.employeeIdentity.findUnique({ where: { employeeId } }),
      db.employeeBankAccount.findFirst({ where: { employeeId, ...effectiveAt(asOf) }, include: { bank: true } }),
      db.taxProfile.findFirst({ where: { employeeId, ...effectiveAt(asOf) } }),
      db.employeeSpecialStatus.findMany({ where: { employeeId, ...effectiveAt(asOf) }, orderBy: { statusType: "asc" } }),
    ]);
    return {
      employeeId, asOf: key(asOf),
      identity: identity && { documentType: identity.documentType, idNumber: this.decrypt(identity.idNumberCipher), taxCode: identity.taxCodeCipher ? this.decrypt(identity.taxCodeCipher) : null, siBookNumber: identity.siBookCipher ? this.decrypt(identity.siBookCipher) : null, dataStatus: identity.dataStatus },
      bankAccount: bank && { id: bank.id, bankCode: bank.bankCode, bankName: bank.bank.name, accountNumber: this.decrypt(bank.accountNumberCipher), accountHolder: bank.accountHolder, effectiveFrom: key(bank.effectiveFrom), dataStatus: bank.dataStatus },
      taxProfile: tax && { id: tax.id, residency: tax.residency, commitmentReference: tax.commitmentReference, commitmentTemplateVersion: tax.commitmentTemplateVersion, finalizationAuthorized: tax.finalizationAuthorized, effectiveFrom: key(tax.effectiveFrom), dataStatus: tax.dataStatus },
      specialStatuses: statuses.map(row => ({ id: row.id, statusType: row.statusType, workPermitNumber: row.workPermitNumber, permitExpiry: row.permitExpiry ? key(row.permitExpiry) : null, effectiveFrom: key(row.effectiveFrom) })),
    };
  }

  async statusesAt(user: AuthUser, employeeId: string, asOf: string, ip?: string) {
    await this.assertEmployee(user, "payroll.profile.read", employeeId, ip);
    const snapshot = await this.profileAt(employeeId, date(asOf));
    return { asOf, specialStatuses: snapshot.specialStatuses, taxProfile: snapshot.taxProfile };
  }
}
