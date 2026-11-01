import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import JSZip from "jszip";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuditService } from "../audit/audit.service";
import type { AuthUser } from "../auth/auth.types";
import { businessDate } from "../auth/business-date";
import { openBuffer, plainText, sealBuffer } from "../common/data-crypto";
import { PrismaService } from "../database/prisma.service";
import { PayrollOutputAccess } from "./output-access";
import { parsePasswordRule, PayslipError, payslipPassword, payslipView, renderPayslipPdf, type SnapshotContent, type SnapshotEmployee } from "./payslip-renderer";

type Db = Prisma.TransactionClient;
const CHUNK = 50;
const ARCHIVE_TTL_MS = 24 * 3_600_000;
const EXPORT_DIR = join(tmpdir(), "hrtp-payslip-exports");
const sha = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const day = (value: Date) => value.toISOString().slice(0, 10);
const fileName = (period: string, code: string) => `phieu-luong-${period}-${code}.pdf`.replace(/[^\w.-]+/g, "_");

/** Payslips (FR-7.6.1, BR-62, UAT-01): only from a locked snapshot, one password-protected PDF per person, every issue audited. */
@Injectable()
export class PayslipsService {
  private readonly logger = new Logger(PayslipsService.name);
  constructor(private readonly prisma: PrismaService, private readonly access: PayrollOutputAccess, private readonly audit: AuditService) {}

  private async rule(db: Db = this.prisma) {
    const row = await this.access.parameter("PAYSLIP_PASSWORD_RULE", businessDate(), db);
    if (!row) throw new ConflictException({ code: "PAYSLIP_PASSWORD_RULE_MISSING", message: "Chưa cấu hình quy tắc mật khẩu phiếu lương PAYSLIP_PASSWORD_RULE." });
    try { return { tokens: parsePasswordRule(row.value), text: row.value }; } catch (error) { throw new ConflictException({ code: (error as PayslipError).code, message: (error as Error).message }); }
  }

  /** Password inputs are read at issue time and never persisted. */
  private async passwordData(employeeIds: string[], db: Db = this.prisma) {
    const [employees, identities] = await Promise.all([
      db.employee.findMany({ where: { id: { in: employeeIds } }, select: { id: true, code: true, dob: true } }),
      db.employeeIdentity.findMany({ where: { employeeId: { in: employeeIds } }, select: { employeeId: true, idNumberCipher: true } }),
    ]);
    const ids = new Map(identities.map(row => [row.employeeId, plainText(this.access.key, row.idNumberCipher, "giấy tờ tùy thân")]));
    return new Map(employees.map(row => [row.id, { employeeCode: row.code, idNumber: ids.get(row.id) ?? null, dob: row.dob ? day(row.dob) : null }]));
  }

  private employeeOf(content: SnapshotContent, employeeId: string) {
    const employee = content.employees.find(row => row.employeeId === employeeId && row.status === "OK");
    if (!employee) throw new NotFoundException("Nhân viên không có dòng lương hợp lệ trong bảng lương đã khóa.");
    return employee;
  }

  private async issued(db: Db, rows: Prisma.PayslipCreateManyInput[]) { if (rows.length) await db.payslip.createMany({ data: rows }); }

  async list(user: AuthUser, sheetId: string) {
    const { sheet, snapshot, content } = await this.access.lockedSheet(user, sheetId, "payroll.payslips");
    const excluded = await this.access.excludedEmployees(user, content.employees.map(row => row.employeeId));
    const issued = await this.prisma.payslip.groupBy({ by: ["employeeId", "status"], where: { sheetId }, _count: { _all: true }, _max: { issuedAt: true } });
    const exports = await this.prisma.payslipExport.findMany({ where: { sheetId }, orderBy: { createdAt: "desc" }, take: 10, include: { createdBy: { select: { displayName: true } } } });
    const rule = await this.access.parameter("PAYSLIP_PASSWORD_RULE", businessDate());
    return {
      sheet: { id: sheet.id, periodCode: sheet.payrollPeriod.code, snapshotHash: snapshot.contentHash },
      passwordRule: rule ? { value: rule.value, legalBasis: rule.legalBasis } : null,
      items: content.employees.filter(row => row.status === "OK" && !excluded.has(row.employeeId)).map(row => {
        const done = issued.find(item => item.employeeId === row.employeeId && item.status === "ISSUED");
        const failed = issued.find(item => item.employeeId === row.employeeId && item.status === "FAILED");
        return { employeeId: row.employeeId, code: row.code, fullName: row.fullName ?? row.code, net: row.totals.net, issuedCount: done?._count._all ?? 0, lastIssuedAt: done?._max.issuedAt?.toISOString() ?? null, failedCount: failed?._count._all ?? 0 };
      }),
      exports: exports.map(row => this.exportView(row)),
    };
  }

  private async single(user: AuthUser, sheetId: string, employeeId: string) {
    const loaded = await this.access.lockedSheet(user, sheetId, "payroll.payslips");
    if ((await this.access.excludedEmployees(user, [employeeId])).has(employeeId)) throw new ForbiddenException("Bạn bị loại trừ khỏi hồ sơ nhân viên này.");
    const employee = this.employeeOf(loaded.content, employeeId);
    const payrollEmployee = await this.prisma.payrollEmployee.findUniqueOrThrow({ where: { sheetId_employeeId: { sheetId, employeeId } }, select: { id: true } });
    const names = await this.access.names(loaded.sheet.payrollPeriod.siteOrgUnitId, loaded.sheet.payrollPeriod.dateTo);
    return { ...loaded, employee, payrollEmployeeId: payrollEmployee.id, view: payslipView(loaded.content, employee, { ...names, snapshotHash: loaded.snapshot.contentHash }) };
  }

  /** Print version (FR-7.6.1 "bản in từng người"): rendered by the browser from the snapshot, no file leaves the server. */
  async view(user: AuthUser, sheetId: string, employeeId: string, ip?: string) {
    const { view, payrollEmployeeId, snapshot } = await this.single(user, sheetId, employeeId);
    await this.prisma.$transaction(async db => {
      await this.issued(db, [{ sheetId, payrollEmployeeId, employeeId, status: "ISSUED", channel: "PRINT", snapshotHash: snapshot.contentHash, issuedById: user.id }]);
      await this.audit.record({ actorId: user.id, entityType: "payslip", entityId: payrollEmployeeId, action: "PRINT_PAYSLIP", result: "SUCCESS", newValue: { sheetId, employeeId, snapshotHash: snapshot.contentHash }, ipAddress: ip }, db);
    });
    return { payslip: view };
  }

  async pdf(user: AuthUser, sheetId: string, employeeId: string, ip?: string) {
    const { view, payrollEmployeeId, snapshot, sheet, employee } = await this.single(user, sheetId, employeeId);
    const rule = await this.rule();
    const name = fileName(sheet.payrollPeriod.code, employee.code);
    try {
      const password = payslipPassword(rule.tokens, (await this.passwordData([employeeId])).get(employeeId) ?? { employeeCode: employee.code, idNumber: null, dob: null });
      const file = await renderPayslipPdf(view, password);
      await this.prisma.$transaction(async db => {
        await this.issued(db, [{ sheetId, payrollEmployeeId, employeeId, status: "ISSUED", channel: "SINGLE", fileName: name, fileHash: sha(file), snapshotHash: snapshot.contentHash, issuedById: user.id }]);
        await this.audit.record({ actorId: user.id, entityType: "payslip", entityId: payrollEmployeeId, action: "EXPORT_PAYSLIP", result: "SUCCESS", newValue: { sheetId, employeeId, fileHash: sha(file), snapshotHash: snapshot.contentHash, encryption: "AES-256" }, ipAddress: ip }, db);
      });
      return { file, name };
    } catch (error) {
      if (!(error instanceof PayslipError)) throw error;
      await this.prisma.$transaction(async db => {
        await this.issued(db, [{ sheetId, payrollEmployeeId, employeeId, status: "FAILED", channel: "SINGLE", fileName: name, snapshotHash: snapshot.contentHash, errorCode: error.code, errorMessage: error.message, issuedById: user.id }]);
        await this.audit.record({ actorId: user.id, entityType: "payslip", entityId: payrollEmployeeId, action: "EXPORT_PAYSLIP", result: "FAILED", newValue: { sheetId, employeeId, code: error.code }, ipAddress: ip }, db);
      });
      throw new ConflictException({ code: error.code, message: error.message });
    }
  }

  private exportView(row: Prisma.PayslipExportGetPayload<{ include: { createdBy: { select: { displayName: true } } } }>) {
    return { id: row.id, status: row.status, progressTotal: row.progressTotal, progressDone: row.progressDone, errorCount: row.errorCount, failure: row.failure, archiveBytes: row.archiveBytes, expiresAt: row.expiresAt?.toISOString() ?? null, downloadedAt: row.downloadedAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString(), finishedAt: row.finishedAt?.toISOString() ?? null, createdBy: row.createdBy };
  }

  /** Bulk export for a whole site (FR-7.6.2, NFR-10): background job, progress, per-file errors, encrypted archive downloaded once. */
  async startExport(user: AuthUser, sheetId: string, ip?: string) {
    const { content } = await this.access.lockedSheet(user, sheetId, "payroll.payslips");
    await this.rule();
    const excluded = await this.access.excludedEmployees(user, content.employees.map(row => row.employeeId));
    const employeeIds = content.employees.filter(row => row.status === "OK" && !excluded.has(row.employeeId)).map(row => row.employeeId);
    const job = await this.prisma.$transaction(async db => {
      if (await db.payslipExport.findFirst({ where: { sheetId, status: "RUNNING" } })) throw new ConflictException({ code: "PAYSLIP_EXPORT_IN_PROGRESS", message: "Đang có lần xuất phiếu lương của kỳ này." });
      const created = await db.payslipExport.create({ data: { sheetId, progressTotal: employeeIds.length, createdById: user.id }, include: { createdBy: { select: { displayName: true } } } });
      await this.audit.record({ actorId: user.id, entityType: "payslip_export", entityId: created.id, action: "START", result: "SUCCESS", newValue: { sheetId, employees: employeeIds.length, excluded: excluded.size }, ipAddress: ip }, db);
      return created;
    });
    setImmediate(() => void this.runExport(job.id, user.id, employeeIds).catch(error => this.logger.error("Payslip export failed: " + (error instanceof Error ? error.message : String(error)))));
    return { export: this.exportView(job) };
  }

  async runExport(exportId: string, actorId: string, employeeIds: string[]) {
    try {
      const job = await this.prisma.payslipExport.findUniqueOrThrow({ where: { id: exportId }, include: { sheet: { include: { payrollPeriod: true, snapshot: true } } } });
      const { sheet } = job;
      const content = JSON.parse(plainText(this.access.key, sheet.snapshot!.contentCipher, "snapshot bảng lương")) as SnapshotContent;
      const snapshotHash = sheet.snapshot!.contentHash;
      const names = await this.access.names(sheet.payrollPeriod.siteOrgUnitId, sheet.payrollPeriod.dateTo);
      const rule = await this.rule();
      const passwords = await this.passwordData(employeeIds);
      const payrollEmployees = new Map((await this.prisma.payrollEmployee.findMany({ where: { sheetId: sheet.id, employeeId: { in: employeeIds } }, select: { id: true, employeeId: true } })).map(row => [row.employeeId, row.id]));
      const wanted = new Set(employeeIds);
      const employees = content.employees.filter(row => wanted.has(row.employeeId));
      const zip = new JSZip();
      const failures: Array<{ code: string; error: string; message: string }> = [];
      for (let start = 0; start < employees.length; start += CHUNK) {
        const rows: Prisma.PayslipCreateManyInput[] = [];
        for (const employee of employees.slice(start, start + CHUNK)) rows.push(await this.bulkOne(zip, { exportId, sheetId: sheet.id, periodCode: sheet.payrollPeriod.code, payrollEmployeeId: payrollEmployees.get(employee.employeeId)!, snapshotHash, actorId }, content, employee, names, rule.tokens, passwords, failures));
        await this.prisma.$transaction(async db => {
          await this.issued(db, rows);
          await db.payslipExport.update({ where: { id: exportId }, data: { progressDone: Math.min(employees.length, start + CHUNK), errorCount: failures.length } });
        });
      }
      if (failures.length) zip.file("DANH_SACH_LOI.csv", "﻿Ma NV,Ma loi,Noi dung\r\n" + failures.map(row => [row.code, row.error, '"' + row.message.replace(/"/g, '""') + '"'].join(",")).join("\r\n") + "\r\n");
      const archive = await zip.generateAsync({ type: "nodebuffer", compression: "STORE" });
      await mkdir(EXPORT_DIR, { recursive: true, mode: 0o700 });
      const path = join(EXPORT_DIR, exportId + ".bin");
      await writeFile(path, this.seal(archive), { mode: 0o600 });
      await this.prisma.$transaction(async db => {
        await db.payslipExport.update({ where: { id: exportId }, data: { status: "COMPLETED", archivePath: path, archiveHash: sha(archive), archiveBytes: archive.length, expiresAt: new Date(Date.now() + ARCHIVE_TTL_MS), finishedAt: new Date(), errorCount: failures.length, progressDone: employees.length } });
        await this.audit.record({ actorId, entityType: "payslip_export", entityId: exportId, action: "EXPORT_PAYSLIPS_BULK", result: "SUCCESS", newValue: { sheetId: sheet.id, issued: employees.length - failures.length, failed: failures.length, archiveHash: sha(archive), snapshotHash, encryption: "AES-256" } }, db);
      });
    } catch (error) {
      await this.prisma.payslipExport.update({ where: { id: exportId }, data: { status: "FAILED", failure: (error instanceof Error ? error.message : String(error)).slice(0, 2000), finishedAt: new Date() } });
      throw error;
    }
  }

  private async bulkOne(zip: JSZip, job: { exportId: string; sheetId: string; periodCode: string; payrollEmployeeId: string; snapshotHash: string; actorId: string }, content: SnapshotContent, employee: SnapshotEmployee, names: { siteName: string; companyName: string }, tokens: ReturnType<typeof parsePasswordRule>, passwords: Awaited<ReturnType<PayslipsService["passwordData"]>>, failures: Array<{ code: string; error: string; message: string }>): Promise<Prisma.PayslipCreateManyInput> {
    const base = { exportId: job.exportId, sheetId: job.sheetId, payrollEmployeeId: job.payrollEmployeeId, employeeId: employee.employeeId, channel: "BULK", fileName: fileName(job.periodCode, employee.code), snapshotHash: job.snapshotHash, issuedById: job.actorId };
    try {
      const password = payslipPassword(tokens, passwords.get(employee.employeeId) ?? { employeeCode: employee.code, idNumber: null, dob: null });
      const file = await renderPayslipPdf(payslipView(content, employee, { ...names, snapshotHash: job.snapshotHash }), password);
      zip.file(base.fileName, file, { binary: true, date: new Date("2026-01-01T00:00:00Z") });
      return { ...base, status: "ISSUED", fileHash: sha(file) };
    } catch (error) {
      const code = error instanceof PayslipError ? error.code : "PAYSLIP_RENDER_FAILED";
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ code: employee.code, error: code, message });
      return { ...base, status: "FAILED", errorCode: code, errorMessage: message.slice(0, 2000) };
    }
  }

  /** AES-256-GCM via the key ring (common/data-crypto). The archive never sits on disk in clear. */
  private seal(data: Buffer) { return sealBuffer(this.access.key, data); }
  private open(data: Buffer) { return openBuffer(this.access.key, data); }

  async exportStatus(user: AuthUser, exportId: string) {
    const job = await this.prisma.payslipExport.findUnique({ where: { id: exportId }, include: { createdBy: { select: { displayName: true } } } });
    if (!job) throw new NotFoundException("Không tìm thấy lần xuất phiếu lương.");
    await this.access.lockedSheet(user, job.sheetId, "payroll.payslips");
    const errors = await this.prisma.payslip.findMany({ where: { exportId, status: "FAILED" }, include: { employee: { select: { code: true, fullName: true } } }, orderBy: { issuedAt: "asc" }, take: 200 });
    return { export: this.exportView(job), errors: errors.map(row => ({ employee: row.employee, code: row.errorCode, message: row.errorMessage })) };
  }

  /** One-time download for the requester; the encrypted file is removed after reading or on expiry. */
  async download(user: AuthUser, exportId: string, ip?: string) {
    const job = await this.prisma.payslipExport.findUnique({ where: { id: exportId }, include: { sheet: { include: { payrollPeriod: true } } } });
    if (!job) throw new NotFoundException("Không tìm thấy lần xuất phiếu lương.");
    await this.access.lockedSheet(user, job.sheetId, "payroll.payslips");
    if (job.createdById !== user.id) throw new ForbiddenException("Chỉ người tạo lần xuất mới được tải gói phiếu lương.");
    if (job.status === "COMPLETED" && job.expiresAt && job.expiresAt < new Date()) {
      await this.prisma.payslipExport.update({ where: { id: exportId }, data: { status: "EXPIRED" } });
      if (job.archivePath) await rm(job.archivePath, { force: true });
      throw new ConflictException({ code: "PAYSLIP_EXPORT_EXPIRED", message: "Gói phiếu lương đã hết hạn tải; tạo lần xuất mới." });
    }
    if (job.status !== "COMPLETED" || !job.archivePath) throw new ConflictException({ code: "PAYSLIP_EXPORT_NOT_AVAILABLE", message: job.status === "DOWNLOADED" ? "Gói phiếu lương chỉ tải được một lần và đã được tải." : "Gói phiếu lương chưa sẵn sàng." });
    const claimed = await this.prisma.payslipExport.updateMany({ where: { id: exportId, status: "COMPLETED" }, data: { status: "DOWNLOADED", downloadedAt: new Date() } });
    if (claimed.count !== 1) throw new ConflictException({ code: "PAYSLIP_EXPORT_NOT_AVAILABLE", message: "Gói phiếu lương chỉ tải được một lần và đã được tải." });
    const archive = this.open(await readFile(job.archivePath));
    await rm(job.archivePath, { force: true });
    if (sha(archive) !== job.archiveHash) throw new ConflictException({ code: "PAYSLIP_EXPORT_CORRUPTED", message: "Gói phiếu lương không khớp mã băm." });
    await this.audit.record({ actorId: user.id, entityType: "payslip_export", entityId: exportId, action: "DOWNLOAD", result: "SUCCESS", newValue: { archiveHash: job.archiveHash }, ipAddress: ip });
    return { file: archive, name: `phieu-luong-${job.sheet.payrollPeriod.code}.zip`.replace(/[^\w.-]+/g, "_") };
  }
}
