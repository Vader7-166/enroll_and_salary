import ExcelJS from "exceljs";
import Decimal from "decimal.js";

// Bank payment file layouts are data (NFR-21). A template lists columns drawn from a fixed field set.
export const BANK_FIELDS = ["SEQ", "EMPLOYEE_CODE", "BENEFICIARY_NAME", "ACCOUNT_NUMBER", "BANK_CODE", "BANK_NAME", "BRANCH", "AMOUNT", "DESCRIPTION", "SITE_CODE", "PERIOD_CODE"] as const;
export const BANK_FORMATS = ["TEXT", "UPPER_ASCII", "INTEGER", "DECIMAL2"] as const;
export type BankField = (typeof BANK_FIELDS)[number];
export interface BankColumn { field: BankField; header: string; format?: (typeof BANK_FORMATS)[number] }
export interface PaymentRow { employeeCode: string; beneficiaryName: string; accountNumber: string; bankCode: string; bankName: string; branch: string | null; amount: string; description: string; siteCode: string; periodCode: string }

/** Returns a list of problems; empty means the layout can produce a valid file. */
export function validateColumns(columns: unknown): string[] {
  if (!Array.isArray(columns) || !columns.length || columns.length > 30) return ["Mẫu cần từ 1 đến 30 cột."];
  const problems: string[] = [];
  columns.forEach((column, index) => {
    const value = column as Partial<BankColumn>;
    if (!value || typeof value !== "object") { problems.push(`Cột ${index + 1} không hợp lệ.`); return; }
    if (!BANK_FIELDS.includes(value.field as BankField)) problems.push(`Cột ${index + 1}: trường "${String(value.field)}" không nằm trong tập trường cho phép.`);
    if (typeof value.header !== "string" || !value.header.trim() || value.header.length > 100) problems.push(`Cột ${index + 1}: tiêu đề 1–100 ký tự.`);
    if (value.format !== undefined && !BANK_FORMATS.includes(value.format)) problems.push(`Cột ${index + 1}: định dạng "${String(value.format)}" không hỗ trợ.`);
    if ((value.format === "INTEGER" || value.format === "DECIMAL2") && value.field !== "AMOUNT" && value.field !== "SEQ") problems.push(`Cột ${index + 1}: định dạng số chỉ dùng cho AMOUNT hoặc SEQ.`);
  });
  const fields = columns.map(column => (column as BankColumn).field);
  for (const required of ["ACCOUNT_NUMBER", "AMOUNT"] as const) if (!fields.includes(required)) problems.push(`Mẫu bắt buộc có cột ${required}.`);
  return problems;
}

export function upperAscii(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toUpperCase();
}

function cell(column: BankColumn, row: PaymentRow, seq: number): string {
  const raw: Record<BankField, string> = { SEQ: String(seq), EMPLOYEE_CODE: row.employeeCode, BENEFICIARY_NAME: row.beneficiaryName, ACCOUNT_NUMBER: row.accountNumber, BANK_CODE: row.bankCode, BANK_NAME: row.bankName, BRANCH: row.branch ?? "", AMOUNT: row.amount, DESCRIPTION: row.description, SITE_CODE: row.siteCode, PERIOD_CODE: row.periodCode };
  const value = raw[column.field];
  if (column.format === "UPPER_ASCII") return upperAscii(value);
  if (column.format === "INTEGER") return new Decimal(value).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0);
  if (column.format === "DECIMAL2") return new Decimal(value).toFixed(2);
  return column.field === "AMOUNT" ? new Decimal(value).toFixed() : value;
}

/** Cell values in template order; the amount is exactly the net pay, never reduced by transfer fees (BR-60). */
export function tableFor(columns: BankColumn[], rows: PaymentRow[]) {
  return rows.map((row, index) => columns.map(column => cell(column, row, index + 1)));
}

const csvCell = (value: string) => /[",\r\n]/.test(value) || /^[=+\-@]/.test(value) ? '"' + (/^[=+\-@]/.test(value) ? "'" : "") + value.replace(/"/g, '""') + '"' : value;
export async function renderBankFile(fileType: "CSV" | "XLSX", columns: BankColumn[], includeHeader: boolean, rows: PaymentRow[], sheetName: string): Promise<Buffer> {
  const table = tableFor(columns, rows);
  if (fileType === "CSV") {
    const lines = [...(includeHeader ? [columns.map(column => csvCell(column.header))] : []), ...table.map(values => values.map(csvCell))].map(values => values.join(","));
    return Buffer.from("﻿" + lines.join("\r\n") + "\r\n", "utf8");
  }
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "HRTP";
  const sheet = workbook.addWorksheet(sheetName.slice(0, 31) || "Chi luong");
  if (includeHeader) sheet.addRow(columns.map(column => column.header)).font = { bold: true };
  for (const values of table) {
    const added = sheet.addRow(values.map((value, index) => columns[index].field === "AMOUNT" || (columns[index].field === "SEQ") ? Number(value) : value));
    columns.forEach((column, index) => { if (column.field === "ACCOUNT_NUMBER") added.getCell(index + 1).numFmt = "@"; if (column.field === "AMOUNT") added.getCell(index + 1).numFmt = column.format === "DECIMAL2" ? "#,##0.00" : "#,##0"; });
  }
  columns.forEach((column, index) => { sheet.getColumn(index + 1).width = Math.max(10, column.header.length + 4, column.field === "BENEFICIARY_NAME" || column.field === "DESCRIPTION" ? 32 : 0); });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
