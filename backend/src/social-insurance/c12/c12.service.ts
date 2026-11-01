import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { parse } from "csv-parse/sync";
import Decimal from "decimal.js";
import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import { AuditService } from "../../audit/audit.service";
import type { AuthUser } from "../../auth/auth.types";
import { blindIndex, cipherText, plainText } from "../../common/data-crypto";
import { PrismaService } from "../../database/prisma.service";
import { InsuranceChangesService } from "../changes/insurance-changes.service";

type Category = "MISSING_IN_C12" | "MISSING_IN_SYSTEM" | "AMOUNT_DIFF" | "SALARY_BASE_DIFF";
interface Mapping { siBook: string; fullName: string; insurableSalary: string; amount: string }
interface C12Row { row: number; siBook: string; fullName: string; insurableSalary: string | null; amount: string | null }
interface SystemRow { employeeId: string; code: string; fullName: string; insurableSalary: string | null; amount: string }
const MAX_ROWS = 10000;
const KINDS = new Set(["BHXH", "BHYT", "BHTN"]);
const fold = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/đ/gi, "d").replace(/\s+/g, " ").trim().toLowerCase();
function bad(code: string, message: string): never { throw new BadRequestException({ code, message }); }
function money(value: unknown, label: string, row: number): string | null {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const text = typeof value === "number" ? String(value) : String(value).replace(/[\s.,](?=\d{3}(\D|$))/g, "").replace(",", ".").trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) bad("C12_VALUE_INVALID", "Dòng " + row + ": " + label + " không phải số tiền hợp lệ.");
  return new Decimal(text).toString();
}

/** C12 reconciliation (FR-8.3.3): imported per configured column mapping, matched by SI-book blind index only. */
@Injectable()
export class C12Service {
  private readonly key: Buffer;
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly changes: InsuranceChangesService, config: ConfigService) {
    this.key = Buffer.from(config.getOrThrow<string>("HR_DATA_KEY"), "base64");
  }

  private async rows(file: Express.Multer.File, mapping: Mapping, headerRow: number): Promise<C12Row[]> {
    let table: unknown[][];
    if (/\.csv$/i.test(file.originalname) || file.mimetype === "text/csv") {
      table = parse(file.buffer.toString("utf8").replace(/^﻿/, ""), { relax_column_count: true, skip_empty_lines: true }) as unknown[][];
    } else {
      const book = new ExcelJS.Workbook();
      try { await book.xlsx.load(file.buffer as never); } catch { bad("C12_FILE_INVALID", "Không đọc được tệp Excel C12."); }
      const sheet = book.worksheets[0];
      if (!sheet) bad("C12_FILE_INVALID", "Tệp C12 không có trang tính.");
      table = [];
      sheet.eachRow({ includeEmpty: true }, (row, number) => { table[number - 1] = (row.values as unknown[]).slice(1).map(cell => cell && typeof cell === "object" && "result" in (cell as object) ? (cell as { result: unknown }).result : cell); });
    }
    const header = (table[headerRow - 1] ?? []).map(cell => String(cell ?? "").trim());
    const index = Object.fromEntries(Object.entries(mapping).map(([field, title]) => [field, header.findIndex(cell => fold(cell) === fold(title))])) as Record<keyof Mapping, number>;
    const absent = Object.entries(index).filter(([, at]) => at < 0).map(([field]) => mapping[field as keyof Mapping]);
    if (absent.length) bad("C12_COLUMNS_MISSING", "Tệp C12 thiếu cột theo mẫu ánh xạ: " + absent.join(", ") + ".");
    const result: C12Row[] = [];
    for (let at = headerRow; at < table.length; at++) {
      const cells = table[at] ?? [];
      if (!cells.some(cell => String(cell ?? "").trim())) continue;
      const row = at + 1;
      result.push({ row, siBook: String(cells[index.siBook] ?? "").replace(/\s+/g, ""), fullName: String(cells[index.fullName] ?? "").trim(),
        insurableSalary: money(cells[index.insurableSalary], "mức lương đóng", row), amount: money(cells[index.amount], "số phải đóng", row) });
      if (result.length > MAX_ROWS) bad("C12_TOO_MANY_ROWS", "Tệp C12 vượt " + MAX_ROWS + " dòng.");
    }
    if (!result.length) bad("C12_EMPTY", "Tệp C12 không có dòng dữ liệu.");
    return result;
  }

  /** Locked-payroll contributions of the site and month (BHXH + BHYT + BHTN, employee + employer). */
  private async system(siteOrgUnitId: string, month: string): Promise<SystemRow[]> {
    const rows = await this.prisma.insuranceContribution.findMany({
      where: { contributionMonth: month, payrollPeriod: { siteOrgUnitId }, payrollEmployee: { sheet: { status: "LOCKED" } } },
      include: { employee: { select: { id: true, code: true, fullName: true } } },
    });
    const byEmployee = new Map<string, SystemRow>();
    for (const row of rows) {
      const detail = JSON.parse(plainText(this.key, row.detailCipher, "bảo hiểm")) as { salary: { perKind: { BHXH: { value: string } } } | null; contribution: { lines: Array<{ kind: string; employee: string; employer: string }> } | null };
      const amount = (detail.contribution?.lines ?? []).filter(line => KINDS.has(line.kind)).reduce((total, line) => total.plus(line.employee).plus(line.employer), new Decimal(0));
      const current = byEmployee.get(row.employeeId);
      byEmployee.set(row.employeeId, { employeeId: row.employeeId, code: row.employee.code, fullName: row.employee.fullName,
        insurableSalary: detail.salary?.perKind.BHXH.value ?? current?.insurableSalary ?? null, amount: new Decimal(current?.amount ?? 0).plus(amount).toString() });
    }
    return [...byEmployee.values()].filter(row => !new Decimal(row.amount).isZero());
  }

  async import(user: AuthUser, file: Express.Multer.File | undefined, body: { siteOrgUnitId?: string; month?: string; templateId?: string }, ip?: string) {
    if (!file?.buffer?.length) bad("C12_FILE_REQUIRED", "Chọn tệp C12 (Excel hoặc CSV).");
    const { siteOrgUnitId, month, templateId } = body;
    if (!siteOrgUnitId || !/^[0-9a-f-]{36}$/i.test(siteOrgUnitId)) bad("SITE_REQUIRED", "Chọn cơ sở.");
    if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) bad("MONTH_INVALID", "Tháng phải có dạng YYYY-MM.");
    await this.changes.site(user, "insurance.manage", siteOrgUnitId);
    const template = templateId
      ? await this.prisma.insuranceFileTemplate.findFirst({ where: { id: templateId, kind: "C12", active: true } })
      : await this.prisma.insuranceFileTemplate.findFirst({ where: { kind: "C12", active: true }, orderBy: [{ code: "asc" }, { version: "desc" }] });
    if (!template) bad("C12_TEMPLATE_MISSING", "Chưa có mẫu ánh xạ C12 đang dùng.");
    const parsed = await this.rows(file, template.columns as unknown as Mapping, template.headerRow);
    const system = await this.system(siteOrgUnitId, month);
    const identities = await this.prisma.employeeIdentity.findMany({ where: { siBookHash: { in: parsed.filter(row => /^\d{10}$/.test(row.siBook)).map(row => blindIndex(this.key, "SI_BOOK", row.siBook)) } }, include: { employee: { select: { id: true, code: true, fullName: true, dob: true } } } });
    const byHash = new Map(identities.map(row => [row.siBookHash!, row.employee]));
    const differences: Array<{ category: Category; employeeId: string | null; rowNumber: number | null; detail: Record<string, unknown> }> = [];
    const seen = new Set<string>();
    for (const row of parsed) {
      const employee = /^\d{10}$/.test(row.siBook) ? byHash.get(blindIndex(this.key, "SI_BOOK", row.siBook)) : undefined;
      const mine = employee ? system.find(item => item.employeeId === employee.id) : undefined;
      if (!employee || !mine) {
        // Never auto-match: a name hint is shown for KT to resolve manually.
        const hints = employee ? [] : system.filter(item => fold(item.fullName) === fold(row.fullName)).map(item => ({ code: item.code, fullName: item.fullName }));
        differences.push({ category: "MISSING_IN_SYSTEM", employeeId: employee?.id ?? null, rowNumber: row.row, detail: { c12: row, reason: employee ? "NO_LOCKED_CONTRIBUTION" : "SI_BOOK_NOT_FOUND", hints } });
        continue;
      }
      seen.add(employee.id);
      if (row.insurableSalary !== null && mine.insurableSalary !== null && !new Decimal(row.insurableSalary).eq(mine.insurableSalary))
        differences.push({ category: "SALARY_BASE_DIFF", employeeId: employee.id, rowNumber: row.row, detail: { c12: row.insurableSalary, system: mine.insurableSalary, difference: new Decimal(row.insurableSalary).minus(mine.insurableSalary).toString(), employee: { code: mine.code, fullName: mine.fullName } } });
      if (row.amount !== null && !new Decimal(row.amount).eq(mine.amount))
        differences.push({ category: "AMOUNT_DIFF", employeeId: employee.id, rowNumber: row.row, detail: { c12: row.amount, system: mine.amount, difference: new Decimal(row.amount).minus(mine.amount).toString(), employee: { code: mine.code, fullName: mine.fullName } } });
    }
    for (const item of system) if (!seen.has(item.employeeId))
      differences.push({ category: "MISSING_IN_C12", employeeId: item.employeeId, rowNumber: null, detail: { system: item.amount, insurableSalary: item.insurableSalary, employee: { code: item.code, fullName: item.fullName } } });
    const summary = { rows: parsed.length, systemEmployees: system.length, matched: seen.size,
      ...Object.fromEntries((["MISSING_IN_C12", "MISSING_IN_SYSTEM", "AMOUNT_DIFF", "SALARY_BASE_DIFF"] as const).map(category => [category, differences.filter(row => row.category === category).length])) };
    const saved = await this.prisma.$transaction(async db => {
      const record = await db.c12Import.create({ data: { siteOrgUnitId, month, templateId: template.id, fileName: file.originalname.slice(0, 255), fileHash: createHash("sha256").update(file.buffer).digest("hex"),
        rowCount: parsed.length, summary, importedById: user.id } });
      if (differences.length) await db.c12Difference.createMany({ data: differences.map(row => ({ importId: record.id, category: row.category, employeeId: row.employeeId, rowNumber: row.rowNumber, detailCipher: cipherText(this.key, JSON.stringify(row.detail)) })) });
      await this.audit.record({ actorId: user.id, entityType: "c12_import", entityId: record.id, action: "IMPORT", result: "SUCCESS", newValue: { month, fileHash: record.fileHash, summary, template: template.code + "@" + template.version, scopeOrgUnitId: siteOrgUnitId }, ipAddress: ip }, db);
      return record;
    });
    return this.detail(user, saved.id);
  }

  async list(user: AuthUser, query: { siteOrgUnitId: string; month?: string }) {
    await this.changes.site(user, "insurance.read", query.siteOrgUnitId);
    const rows = await this.prisma.c12Import.findMany({ where: { siteOrgUnitId: query.siteOrgUnitId, ...(query.month ? { month: query.month } : {}) }, orderBy: { importedAt: "desc" }, take: 50, include: { importedBy: { select: { displayName: true } }, template: { select: { code: true, version: true } } } });
    return { items: rows.map(row => ({ id: row.id, month: row.month, fileName: row.fileName, rowCount: row.rowCount, summary: row.summary, importedAt: row.importedAt.toISOString(), importedBy: row.importedBy.displayName, template: row.template.code + "@" + row.template.version })) };
  }

  async detail(user: AuthUser, id: string) {
    const row = await this.prisma.c12Import.findUnique({ where: { id }, include: { differences: { orderBy: [{ category: "asc" }, { rowNumber: "asc" }] }, importedBy: { select: { displayName: true } } } });
    if (!row) throw new NotFoundException("Không tìm thấy lần nhập C12.");
    await this.changes.site(user, "insurance.read", row.siteOrgUnitId);
    return { import: { id: row.id, siteOrgUnitId: row.siteOrgUnitId, month: row.month, fileName: row.fileName, fileHash: row.fileHash, rowCount: row.rowCount, summary: row.summary, importedAt: row.importedAt.toISOString(), importedBy: row.importedBy.displayName },
      differences: row.differences.map(item => ({ id: item.id, category: item.category, employeeId: item.employeeId, rowNumber: item.rowNumber, ...JSON.parse(plainText(this.key, item.detailCipher, "C12")) })) };
  }
}
