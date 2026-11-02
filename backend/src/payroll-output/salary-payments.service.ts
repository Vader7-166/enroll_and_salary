import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import Decimal from "decimal.js";
import JSZip from "jszip";
import { randomBytes } from "node:crypto";
import { AuditService } from "../audit/audit.service";
import type { AuthUser } from "../auth/auth.types";
import { businessDate } from "../auth/business-date";
import { reauthKey, verifyReauthToken } from "../auth/reauth";
import { cipherText, maskValue, plainText } from "../common/data-crypto";
import { PrismaService } from "../database/prisma.service";
import { ScopeService } from "../organization/scope.service";
import { PayrollSourceEvents } from "../payroll-events/payroll-source-events.service";
import { sha256 } from "../payroll/payroll-engine";
import { renderBankFile, tableFor, validateColumns, type BankColumn, type PaymentRow } from "./bank-file";
import { PayrollOutputAccess } from "./output-access";
import type { CancelBatchDto, CreateBatchDto, CreateTemplateDto, MarkPaidDto } from "./payroll-output.dto";

type Db = Prisma.TransactionClient;
const DAY = 86_400_000;
const key = (value: Date) => value.toISOString().slice(0, 10);
const date = (text: string) => new Date(text + "T00:00:00.000Z");
function fail(kind: "conflict" | "bad" | "forbidden", code: string, message: string, details?: Record<string, unknown>): never {
  const body = { code, message, ...(details ? { details } : {}) };
  throw kind === "conflict" ? new ConflictException(body) : kind === "forbidden" ? new ForbiddenException(body) : new BadRequestException(body);
}
const ITEM_INCLUDE = { employee: { select: { id: true, code: true, fullName: true } }, payrollPeriod: true, siteOrgUnit: { select: { code: true } }, bankAccount: { include: { bank: true } } } satisfies Prisma.SalaryPaymentItemInclude;
type Item = Prisma.SalaryPaymentItemGetPayload<{ include: typeof ITEM_INCLUDE }>;

/** Bank payment files, payment batches, actual payment date and late-payment compensation (FR-7.6.3, FR-7.5.4, BR-60, BR-61). */
@Injectable()
export class SalaryPaymentsService {
  private readonly reauthKey: Buffer;
  constructor(private readonly prisma: PrismaService, private readonly access: PayrollOutputAccess, private readonly scope: ScopeService, private readonly audit: AuditService, private readonly events: PayrollSourceEvents, config: ConfigService) {
    this.reauthKey = reauthKey(config.getOrThrow<string>("HR_DATA_KEY"));
  }

  private reauth(sessionId: string, token: string | undefined, action: string) {
    if (!verifyReauthToken(this.reauthKey, sessionId, token)) fail("forbidden", "REAUTH_REQUIRED", `Nhập lại mật khẩu để ${action}.`);
  }

  // ---- Templates (NFR-21): append-only versions per bank ----
  async templates(user: AuthUser) {
    this.access.assertRole(user, "payroll.payment");
    const [rows, banks] = await Promise.all([
      this.prisma.bankFileTemplate.findMany({ include: { bank: true, createdBy: { select: { displayName: true } } }, orderBy: [{ bankCode: "asc" }, { version: "desc" }] }),
      this.prisma.bank.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
    ]);
    const latest = new Map<string, string>();
    for (const row of rows) if (!latest.has(row.bankCode)) latest.set(row.bankCode, row.id);
    return {
      banks: banks.map(bank => ({ code: bank.code, name: bank.name, shortName: bank.shortName })),
      items: rows.map(row => ({ id: row.id, bankCode: row.bankCode, bankName: row.bank.shortName, version: row.version, name: row.name, fileType: row.fileType, columns: row.columns as unknown as BankColumn[], splitBySite: row.splitBySite, includeHeader: row.includeHeader, active: row.active, current: latest.get(row.bankCode) === row.id, status: row.status, reason: row.reason, createdBy: row.createdBy?.displayName ?? "Hệ thống", createdAt: row.createdAt.toISOString() })),
    };
  }

  async createTemplate(user: AuthUser, dto: CreateTemplateDto, ip?: string) {
    this.access.assertRole(user, "payroll.payment");
    const problems = validateColumns(dto.columns);
    if (problems.length) fail("bad", "BANK_TEMPLATE_INVALID", problems.join(" "), { problems });
    return this.prisma.$transaction(async db => {
      if (!(await db.bank.findUnique({ where: { code: dto.bankCode } }))) fail("bad", "BANK_NOT_FOUND", "Ngân hàng không có trong danh mục.");
      const previous = await db.bankFileTemplate.findFirst({ where: { bankCode: dto.bankCode }, orderBy: { version: "desc" } });
      const row = await db.bankFileTemplate.create({ data: { bankCode: dto.bankCode, version: (previous?.version ?? 0) + 1, name: dto.name.trim(), fileType: dto.fileType, columns: dto.columns.map(column => ({ field: column.field, header: column.header.trim(), ...(column.format ? { format: column.format } : {}) })) as Prisma.InputJsonValue, splitBySite: dto.splitBySite, includeHeader: dto.includeHeader ?? true, active: dto.active ?? true, status: dto.status, reason: dto.reason.trim(), createdById: user.id } });
      await this.audit.record({ actorId: user.id, entityType: "bank_file_template", entityId: row.id, action: "CREATE_VERSION", result: "SUCCESS", newValue: { bankCode: row.bankCode, version: row.version, fileType: row.fileType, columns: dto.columns.length }, ipAddress: ip }, db);
      return { id: row.id, version: row.version };
    }, { isolationLevel: "Serializable" }).catch(error => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") fail("conflict", "STALE_REVISION", "Mẫu của ngân hàng vừa có phiên bản mới; tải lại.");
      throw error;
    });
  }

  // ---- Batches ----
  private async assertSites(user: AuthUser, siteIds: string[], db: Db = this.prisma) {
    const allowed = (await this.scope.load(user, "payroll.payment", db)).allowed;
    if (siteIds.some(id => !allowed.has(id))) throw new ForbiddenException("Lô chi có nhân viên ngoài phạm vi được phân quyền.");
  }

  private rows(items: Item[]): PaymentRow[] {
    return items.map(item => ({ employeeCode: item.employee.code, beneficiaryName: item.bankAccount.accountHolder, accountNumber: plainText(this.access.key, item.bankAccount.accountNumberCipher, "tài khoản ngân hàng"), bankCode: item.bankAccount.bankCode, bankName: item.bankAccount.bank.shortName, branch: item.bankAccount.branch, amount: plainText(this.access.key, item.amountCipher, "lô chi lương"), description: `Luong ${item.payrollPeriod.code} ${item.employee.code}`, siteCode: item.siteOrgUnit.code, periodCode: item.payrollPeriod.code }));
  }

  private batchView(batch: Prisma.SalaryPaymentBatchGetPayload<{ include: { template: { include: { bank: true } }; createdBy: { select: { displayName: true } }; paidBy: { select: { displayName: true } } } }>, extra: Record<string, unknown> = {}) {
    return { id: batch.id, code: batch.code, status: batch.status, revision: batch.revision, itemCount: batch.itemCount, total: plainText(this.access.key, batch.totalCipher, "lô chi lương"), contentHash: batch.fileHash, dueDate: key(batch.dueDate), paidDate: batch.paidDate ? key(batch.paidDate) : null, lateDays: batch.lateDays, note: batch.note, cancelReason: batch.cancelReason,
      template: { id: batch.template.id, bankCode: batch.template.bankCode, bankName: batch.template.bank.shortName, version: batch.template.version, name: batch.template.name, fileType: batch.template.fileType, splitBySite: batch.template.splitBySite },
      createdBy: batch.createdBy.displayName, createdAt: batch.createdAt.toISOString(), paidBy: batch.paidBy?.displayName ?? null, paidAt: batch.paidAt?.toISOString() ?? null, ...extra };
  }
  private readonly batchInclude = { template: { include: { bank: true } }, createdBy: { select: { displayName: true } }, paidBy: { select: { displayName: true } } } as const;

  async batches(user: AuthUser) {
    this.access.assertRole(user, "payroll.payment");
    const allowed = (await this.scope.load(user, "payroll.payment")).allowed;
    const rows = await this.prisma.salaryPaymentBatch.findMany({ include: { ...this.batchInclude, items: { select: { siteOrgUnitId: true, payrollPeriod: { select: { code: true } } } } }, orderBy: { createdAt: "desc" }, take: 100 });
    return { items: rows.filter(row => row.items.every(item => allowed.has(item.siteOrgUnitId))).map(row => this.batchView(row, { periods: [...new Set(row.items.map(item => item.payrollPeriod.code))] })) };
  }

  async batch(user: AuthUser, id: string) {
    this.access.assertRole(user, "payroll.payment");
    const batch = await this.prisma.salaryPaymentBatch.findUnique({ where: { id }, include: { ...this.batchInclude, items: { include: ITEM_INCLUDE, orderBy: { employee: { code: "asc" } } } } });
    if (!batch) throw new NotFoundException("Không tìm thấy lô chi lương.");
    await this.assertSites(user, batch.items.map(item => item.siteOrgUnitId));
    const adjustments = await this.prisma.payrollAdjustment.findMany({ where: { sourceType: "SALARY_PAYMENT_ITEM", sourceId: { in: batch.items.map(item => item.id) } } });
    return { batch: this.batchView(batch, { periods: [...new Set(batch.items.map(item => item.payrollPeriod.code))] }), items: batch.items.map(item => {
      const compensation = adjustments.find(row => row.sourceId === item.id);
      return { id: item.id, employee: item.employee, periodCode: item.payrollPeriod.code, siteCode: item.siteOrgUnit.code, amount: plainText(this.access.key, item.amountCipher, "lô chi lương"), active: item.active, bank: item.bankAccount.bank.shortName, accountMasked: maskValue(plainText(this.access.key, item.bankAccount.accountNumberCipher, "tài khoản ngân hàng")), accountHolder: item.bankAccount.accountHolder,
        compensation: compensation ? { amount: plainText(this.access.key, compensation.amountCipher, "điều chỉnh lương"), appliedPeriodId: compensation.appliedPayrollPeriodId } : null };
    }) };
  }

  /** One stable order for the file and its content hash: site, then employee code. */
  private ordered<T extends { siteCode: string; employeeCode: string }>(rows: T[]) {
    return [...rows].sort((left, right) => left.siteCode.localeCompare(right.siteCode) || left.employeeCode.localeCompare(right.employeeCode));
  }

  /** Creates the batch from locked snapshots after re-authentication; exporting never means paid (FR-7.6.3). */
  async createBatch(user: AuthUser, sessionId: string, dto: CreateBatchDto, ip?: string) {
    this.reauth(sessionId, dto.reauthToken, "xuất file chi lương");
    const id = await this.prisma.$transaction(async db => {
      const template = await db.bankFileTemplate.findUnique({ where: { id: dto.templateId } });
      if (!template) throw new NotFoundException("Không tìm thấy mẫu file chi.");
      const latest = await db.bankFileTemplate.findFirst({ where: { bankCode: template.bankCode }, orderBy: { version: "desc" } });
      if (!template.active || latest!.id !== template.id) fail("conflict", "BANK_TEMPLATE_NOT_CURRENT", "Chỉ dùng phiên bản mẫu hiện hành và đang hoạt động của ngân hàng.");
      const sheets = [];
      for (const sheetId of [...new Set(dto.sheetIds)]) sheets.push(await this.access.lockedSheet(user, sheetId, "payroll.payment", db));
      const wanted = sheets.flatMap(({ sheet, content }) => content.employees.filter(row => row.status === "OK" && new Decimal(row.totals.net).gt(0)).map(row => ({ sheet, row })));
      const excluded = await this.access.excludedEmployees(user, wanted.map(item => item.row.employeeId), db);
      if (excluded.size) fail("forbidden", "PAYMENT_EMPLOYEE_EXCLUDED", "Lô chi có nhân viên bạn bị loại trừ; giao KT khác xuất file.", { employees: wanted.filter(item => excluded.has(item.row.employeeId)).map(item => item.row.code) });
      const active = await db.salaryPaymentItem.findMany({ where: { active: true, payrollPeriodId: { in: sheets.map(item => item.sheet.payrollPeriodId) } }, select: { payrollPeriodId: true, employeeId: true } });
      const taken = new Set(active.map(item => item.payrollPeriodId + ":" + item.employeeId));
      const pending = wanted.filter(item => !taken.has(item.sheet.payrollPeriodId + ":" + item.row.employeeId));
      if (!pending.length) fail("conflict", "PAYMENT_NOTHING_TO_EXPORT", "Mọi nhân viên có thực lĩnh của kỳ đã thuộc một lô chi hiệu lực; hủy lô cũ nếu cần xuất lại.");
      const accounts = await db.employeeBankAccount.findMany({ where: { employeeId: { in: pending.map(item => item.row.employeeId) } }, include: { bank: true }, orderBy: { effectiveFrom: "desc" } });
      const accountFor = (employeeId: string, due: Date) => accounts.find(row => row.employeeId === employeeId && row.effectiveFrom <= due && (!row.effectiveTo || row.effectiveTo >= due));
      const missing = pending.filter(item => !accountFor(item.row.employeeId, item.sheet.payrollPeriod.expectedPaymentDate!));
      if (missing.length) fail("conflict", "BANK_ACCOUNT_MISSING", `${missing.length} nhân viên chưa có tài khoản nhận lương hiệu lực tại ngày chi dự kiến.`, { employees: missing.map(item => ({ code: item.row.code, fullName: item.row.fullName ?? item.row.code })) });
      const payrollEmployees = await db.payrollEmployee.findMany({ where: { sheetId: { in: sheets.map(item => item.sheet.id) }, employeeId: { in: pending.map(item => item.row.employeeId) } }, select: { id: true, sheetId: true, employeeId: true } });
      const siteCodes = new Map((await db.orgUnit.findMany({ where: { id: { in: sheets.map(item => item.sheet.payrollPeriod.siteOrgUnitId) } }, select: { id: true, code: true } })).map(row => [row.id, row.code]));
      const lines = this.ordered(pending.map(item => {
        const account = accountFor(item.row.employeeId, item.sheet.payrollPeriod.expectedPaymentDate!)!;
        const row: PaymentRow = { employeeCode: item.row.code, beneficiaryName: account.accountHolder, accountNumber: plainText(this.access.key, account.accountNumberCipher, "tài khoản ngân hàng"), bankCode: account.bankCode, bankName: account.bank.shortName, branch: account.branch, amount: item.row.totals.net, description: `Luong ${item.sheet.payrollPeriod.code} ${item.row.code}`, siteCode: siteCodes.get(item.sheet.payrollPeriod.siteOrgUnitId) ?? "", periodCode: item.sheet.payrollPeriod.code };
        return { ...row, item, account };
      }));
      const total = lines.reduce((sum, line) => sum.plus(line.amount), new Decimal(0));
      const dueDate = lines.map(line => line.item.sheet.payrollPeriod.expectedPaymentDate!).reduce((min, value) => value < min ? value : min);
      const contentHash = sha256(tableFor(template.columns as unknown as BankColumn[], lines));
      const code = "CL-" + key(businessDate()).replace(/-/g, "") + "-" + randomBytes(3).toString("hex").toUpperCase();
      const batch = await db.salaryPaymentBatch.create({ data: { code, templateId: template.id, itemCount: lines.length, totalCipher: cipherText(this.access.key, total.toString()), fileHash: contentHash, dueDate, note: dto.note?.trim() || null, createdById: user.id } });
      await db.salaryPaymentItem.createMany({ data: lines.map(line => ({ batchId: batch.id, sheetId: line.item.sheet.id, payrollPeriodId: line.item.sheet.payrollPeriodId, payrollEmployeeId: payrollEmployees.find(row => row.sheetId === line.item.sheet.id && row.employeeId === line.item.row.employeeId)!.id, employeeId: line.item.row.employeeId, siteOrgUnitId: line.item.sheet.payrollPeriod.siteOrgUnitId, bankAccountId: line.account.id, amountCipher: cipherText(this.access.key, line.amount) })) });
      await this.audit.record({ actorId: user.id, entityType: "salary_payment_batch", entityId: batch.id, action: "EXPORT", result: "SUCCESS", newValue: { code, templateId: template.id, items: lines.length, contentHash, sheets: sheets.map(item => item.sheet.id), skippedAlreadyBatched: wanted.length - pending.length }, ipAddress: ip }, db);
      return batch.id;
    }, { isolationLevel: "Serializable", timeout: 60_000 }).catch(error => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2034")) fail("conflict", "PAYMENT_ALREADY_BATCHED", "Nhân viên vừa được đưa vào một lô chi khác; tải lại.");
      throw error;
    });
    return this.batch(user, id);
  }

  /** File is regenerated from the immutable items and checked against the stored content hash; never written to disk. */
  async file(user: AuthUser, sessionId: string, id: string, reauthToken: string | undefined, ip?: string) {
    this.reauth(sessionId, reauthToken, "tải file chi lương");
    this.access.assertRole(user, "payroll.payment");
    const batch = await this.prisma.salaryPaymentBatch.findUnique({ where: { id }, include: { template: true, items: { include: ITEM_INCLUDE } } });
    if (!batch) throw new NotFoundException("Không tìm thấy lô chi lương.");
    await this.assertSites(user, batch.items.map(item => item.siteOrgUnitId));
    if (batch.status === "CANCELLED") fail("conflict", "PAYMENT_BATCH_CANCELLED", "Lô chi đã hủy; không tải lại file.");
    const columns = batch.template.columns as unknown as BankColumn[];
    const rows = this.ordered(this.rows(batch.items));
    if (sha256(tableFor(columns, rows)) !== batch.fileHash) fail("conflict", "PAYMENT_FILE_MISMATCH", "Nội dung lô chi không khớp mã băm lúc xuất.");
    const extension = batch.template.fileType === "CSV" ? "csv" : "xlsx";
    const groups = batch.template.splitBySite ? [...new Set(rows.map(row => row.siteCode))] : [null];
    const files = await Promise.all(groups.map(async site => ({ name: `${batch.code}${site ? "-" + site : ""}.${extension}`, data: await renderBankFile(batch.template.fileType, columns, batch.template.includeHeader, rows.filter(row => !site || row.siteCode === site), site ?? batch.code) })));
    await this.audit.record({ actorId: user.id, entityType: "salary_payment_batch", entityId: id, action: "DOWNLOAD_FILE", result: "SUCCESS", newValue: { files: files.map(file => file.name), contentHash: batch.fileHash }, ipAddress: ip });
    if (files.length === 1) return { file: files[0].data, name: files[0].name, type: extension === "csv" ? "text/csv; charset=utf-8" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
    const zip = new JSZip();
    for (const file of files) zip.file(file.name, file.data);
    return { file: await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }), name: batch.code + ".zip", type: "application/zip" };
  }

  /**
   * Actual payment date (FR-7.6.3): marks the batch PAID, moves locked withholdings to ACTUAL (flagging a tax-year change),
   * and above the grace period creates late-payment compensation for the next open period (FR-7.5.4, BR-61).
   */
  async markPaid(user: AuthUser, id: string, dto: MarkPaidDto, ip?: string) {
    this.access.assertRole(user, "payroll.payment");
    const paid = date(dto.paidDate);
    if (paid > businessDate()) fail("bad", "PAID_DATE_IN_FUTURE", "Ngày chi thực tế không được sau hôm nay.");
    const result = await this.prisma.$transaction(async db => {
      await db.$queryRaw`SELECT id FROM salary_payment_batch WHERE id = ${id}::uuid FOR UPDATE`;
      const batch = await db.salaryPaymentBatch.findUnique({ where: { id }, include: { items: { where: { active: true }, include: ITEM_INCLUDE } } });
      if (!batch) throw new NotFoundException("Không tìm thấy lô chi lương.");
      await this.assertSites(user, batch.items.map(item => item.siteOrgUnitId), db);
      if (batch.status !== "EXPORTED") fail("conflict", "PAYMENT_BATCH_NOT_EXPORTED", "Chỉ lô đã xuất, chưa ghi nhận chi hoặc hủy mới được ghi ngày chi.");
      if (batch.revision !== dto.revision) fail("conflict", "STALE_REVISION", "Lô chi đã thay đổi; tải lại.");
      const grace = Number((await this.access.parameter("LATE_PAYMENT_GRACE_DAYS", paid, db))?.value ?? 15);
      const rate = await this.access.parameter("LATE_PAYMENT_RATE", paid, db);
      let maxLate = 0;
      const compensations: Array<{ employee: { code: string; fullName: string }; periodCode: string; lateDays: number; amount: string }> = [];
      const taxChanged: string[] = [], taxFiled: string[] = [], warnings: Array<{ employeeCode: string; periodCode: string; lateDays: number }> = [];
      for (const item of batch.items) {
        const due = item.payrollPeriod.expectedPaymentDate!;
        const lateDays = Math.round((paid.getTime() - due.getTime()) / DAY);
        maxLate = Math.max(maxLate, lateDays);
        const withholding = await db.taxWithholding.findFirst({ where: { paymentKey: `payroll:${item.payrollPeriodId}:${item.employeeId}`, originalWithholdingId: null } });
        if (withholding?.filingStatus === "FILED") taxFiled.push(item.employee.code);
        else if (withholding && withholding.status === "LOCKED" && withholding.paymentDateStatus === "PROJECTED") {
          const changed = withholding.paymentDate.getUTCFullYear() !== paid.getUTCFullYear();
          if (changed) taxChanged.push(item.employee.code);
          await db.taxWithholding.update({ where: { id: withholding.id }, data: { paymentDate: paid, paymentDateStatus: "ACTUAL", contextFlag: changed ? "TAX_CONTEXT_CHANGED" : null, updatedAt: new Date() } });
        }
        if (lateDays > grace) {
          if (!rate) fail("conflict", "LATE_PAYMENT_RATE_MISSING", "Thiếu tham số lãi suất đền bù chậm trả LATE_PAYMENT_RATE tại ngày chi.");
          const amount = plainText(this.access.key, item.amountCipher, "lô chi lương");
          const compensation = new Decimal(amount).times(lateDays).times(rate!.value).div(365).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
          if (compensation.gt(0)) {
            const explanation = `${new Decimal(amount).toFixed()} đ × ${lateDays} ngày chậm × ${rate!.value}/năm ÷ 365 (hạn chi ${key(due)}, chi thực tế ${dto.paidDate}, lô ${batch.code})`;
            await db.payrollAdjustment.create({ data: { employeeId: item.employeeId, kind: "LATE_PAYMENT_COMPENSATION", status: "CONFIRMED", label: `Đền bù chậm trả lương kỳ ${item.payrollPeriod.code}`, originPayrollPeriodId: item.payrollPeriodId, amountCipher: cipherText(this.access.key, compensation.toString()), detailCipher: cipherText(this.access.key, JSON.stringify({ explanation, amount, lateDays, rate: rate!.value, rateParameterId: rate!.id, graceDays: grace, dueDate: key(due), paidDate: dto.paidDate, batchCode: batch.code })), sourceType: "SALARY_PAYMENT_ITEM", sourceId: item.id, createdById: user.id, confirmedById: user.id, confirmedAt: new Date() } });
            compensations.push({ employee: { code: item.employee.code, fullName: item.employee.fullName }, periodCode: item.payrollPeriod.code, lateDays, amount: compensation.toString() });
          }
        } else if (lateDays > 0) warnings.push({ employeeCode: item.employee.code, periodCode: item.payrollPeriod.code, lateDays });
      }
      await db.salaryPaymentBatch.update({ where: { id }, data: { status: "PAID", paidDate: paid, lateDays: maxLate, paidById: user.id, paidAt: new Date(), revision: { increment: 1 }, note: dto.note?.trim() || batch.note } });
      if (compensations.length) await this.events.changed(db, { employeeIds: batch.items.filter(item => compensations.some(row => row.employee.code === item.employee.code)).map(item => item.employeeId), source: "LATE_PAYMENT", reason: "Đền bù chậm trả lô " + batch.code, actorId: user.id });
      await this.audit.record({ actorId: user.id, entityType: "salary_payment_batch", entityId: id, action: "RECORD_PAYMENT", result: "SUCCESS", newValue: { paidDate: dto.paidDate, lateDays: maxLate, graceDays: grace, compensations: compensations.length, taxContextChanged: taxChanged.length, taxAlreadyFiled: taxFiled.length }, ipAddress: ip }, db);
      return { lateDays: maxLate, graceDays: grace, compensations, warnings, taxContextChanged: taxChanged, taxAlreadyFiled: taxFiled };
    }, { isolationLevel: "Serializable", timeout: 60_000 });
    return { ...(await this.batch(user, id)), result: { ...result, lateWarning: result.lateDays > 0 && !result.compensations.length ? `Chi chậm ${result.lateDays} ngày (≤ ${result.graceDays} ngày): không phát sinh đền bù nhưng cần lưu ý.` : null } };
  }

  async cancel(user: AuthUser, id: string, dto: CancelBatchDto, ip?: string) {
    this.access.assertRole(user, "payroll.payment");
    await this.prisma.$transaction(async db => {
      await db.$queryRaw`SELECT id FROM salary_payment_batch WHERE id = ${id}::uuid FOR UPDATE`;
      const batch = await db.salaryPaymentBatch.findUnique({ where: { id }, include: { items: { select: { siteOrgUnitId: true } } } });
      if (!batch) throw new NotFoundException("Không tìm thấy lô chi lương.");
      await this.assertSites(user, batch.items.map(item => item.siteOrgUnitId), db);
      if (batch.status !== "EXPORTED") fail("conflict", "PAYMENT_BATCH_NOT_EXPORTED", "Chỉ hủy được lô đã xuất và chưa ghi nhận chi.");
      if (batch.revision !== dto.revision) fail("conflict", "STALE_REVISION", "Lô chi đã thay đổi; tải lại.");
      await db.salaryPaymentItem.updateMany({ where: { batchId: id, active: true }, data: { active: false } });
      await db.salaryPaymentBatch.update({ where: { id }, data: { status: "CANCELLED", cancelReason: dto.reason.trim(), cancelledById: user.id, cancelledAt: new Date(), revision: { increment: 1 } } });
      await this.audit.record({ actorId: user.id, entityType: "salary_payment_batch", entityId: id, action: "CANCEL", result: "SUCCESS", newValue: { reason: dto.reason.trim() }, ipAddress: ip }, db);
    }, { isolationLevel: "Serializable" });
    return this.batch(user, id);
  }
}
