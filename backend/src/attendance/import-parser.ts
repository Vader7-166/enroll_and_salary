import { BadRequestException } from "@nestjs/common";
import ExcelJS from "exceljs";
import { parse } from "csv-parse/sync";
import * as iconv from "iconv-lite";
import { TextDecoder } from "node:util";
import {
  ImportMapping,
  ImportRowError,
  ParsedImport,
  PunchDirection,
} from "./attendance.types";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_ROWS = 20_000;
const MAX_XLSX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
const COLUMN_NAMES = ["employeeCode", "date", "time", "deviceCode", "direction"] as const;
type ColumnName = (typeof COLUMN_NAMES)[number];
type CellValue = string | number | Date | undefined;

function badRequest(message: string): never {
  throw new BadRequestException(message);
}

/** Validates and normalizes the file-to-punch column mapping supplied by the client. */
export function validateMapping(value: unknown): ImportMapping {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return badRequest("Cấu hình ánh xạ tệp chấm công không hợp lệ.");
  }
  const candidate = value as Record<string, unknown>;
  const columns = candidate.columns;
  if (columns === null || typeof columns !== "object" || Array.isArray(columns)) {
    return badRequest("Cấu hình cột ánh xạ không hợp lệ.");
  }

  const inputColumns = columns as Record<string, unknown>;
  const mappedColumns: Record<ColumnName, number> = {} as Record<ColumnName, number>;
  for (const name of COLUMN_NAMES) {
    const index = inputColumns[name];
    if (!Number.isInteger(index) || (index as number) < 0 || (index as number) > 49) {
      return badRequest("Cột dữ liệu phải là số nguyên từ 0 đến 49.");
    }
    mappedColumns[name] = index as number;
  }
  if (new Set(Object.values(mappedColumns)).size !== COLUMN_NAMES.length) {
    return badRequest("Các cột dữ liệu không được trùng nhau.");
  }

  if (![",", ";", "\t", "|"].includes(candidate.delimiter as string)) {
    return badRequest("Dấu phân cách không hợp lệ.");
  }
  if (!["utf8", "utf16le", "windows1258"].includes(candidate.encoding as string)) {
    return badRequest("Bảng mã không hợp lệ.");
  }
  if (!Number.isInteger(candidate.skipRows) || (candidate.skipRows as number) < 0 || (candidate.skipRows as number) > 50) {
    return badRequest("Số dòng bỏ qua phải là số nguyên từ 0 đến 50.");
  }
  if (candidate.dateFormat !== "YYYY-MM-DD" && candidate.dateFormat !== "DD/MM/YYYY") {
    return badRequest("Định dạng ngày không hợp lệ.");
  }
  if (candidate.timeFormat !== "HH:mm:ss" && candidate.timeFormat !== "HH:mm") {
    return badRequest("Định dạng giờ không hợp lệ.");
  }

  return {
    columns: {
      employeeCode: mappedColumns.employeeCode,
      date: mappedColumns.date,
      time: mappedColumns.time,
      deviceCode: mappedColumns.deviceCode,
      direction: mappedColumns.direction,
    },
    delimiter: candidate.delimiter as ImportMapping["delimiter"],
    encoding: candidate.encoding as ImportMapping["encoding"],
    skipRows: candidate.skipRows as number,
    dateFormat: candidate.dateFormat,
    timeFormat: candidate.timeFormat,
  };
}

/** Parses a CSV/TXT or XLSX attendance export without evaluating spreadsheet formulas. */
export async function parseAttendanceFile(
  buffer: Buffer,
  filename: string,
  suppliedMapping: ImportMapping,
): Promise<ParsedImport> {
  const mapping = validateMapping(suppliedMapping);
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) badRequest("Tệp chấm công trống.");
  if (buffer.length > MAX_FILE_BYTES) badRequest("Tệp chấm công không được lớn hơn 10 MiB.");
  if (typeof filename !== "string") badRequest("Tên tệp không hợp lệ.");

  const extension = filename.trim().toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (extension === "csv" || extension === "txt") return parseDelimited(buffer, mapping);
  if (extension === "xlsx") return parseXlsx(buffer, mapping);
  return badRequest("Chỉ hỗ trợ tệp CSV, TXT hoặc XLSX.");
}

function parseDelimited(buffer: Buffer, mapping: ImportMapping): ParsedImport {
  if (buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
    return badRequest("Nội dung tệp CSV/TXT không hợp lệ.");
  }
  const text = decodeDelimited(buffer, mapping.encoding);
  let records: Array<{ record: string[]; info: { lines: number }; raw: string }>;
  try {
    records = parse(text, {
      bom: true,
      delimiter: mapping.delimiter,
      info: true,
      raw: true,
      relax_column_count: true,
      skip_empty_lines: true,
    }) as unknown as Array<{ record: string[]; info: { lines: number }; raw: string }>;
  } catch {
    return badRequest("Nội dung tệp CSV/TXT không hợp lệ.");
  }

  const result: ParsedImport = { rows: [], errors: [], totalRows: 0 };
  for (const entry of records) {
    const sourceRow = csvSourceRow(entry.raw, entry.info.lines);
    if (sourceRow <= mapping.skipRows) continue;
    result.totalRows += 1;
    if (result.totalRows > MAX_ROWS) badRequest("Tệp chấm công có tối đa 20.000 dòng dữ liệu.");
    addValidatedRow(result, sourceRow, entry.record, mapping);
  }
  ensureHasRows(result);
  return result;
}

function decodeDelimited(buffer: Buffer, encoding: ImportMapping["encoding"]): string {
  try {
    if (encoding === "utf8") return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(buffer);
    if (encoding === "utf16le") {
      if (buffer.length % 2 !== 0) badRequest("Nội dung UTF-16LE không hợp lệ.");
      return new TextDecoder("utf-16le", { fatal: true, ignoreBOM: false }).decode(buffer);
    }
    return iconv.decode(buffer, "windows-1258");
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    return badRequest(encoding === "utf8" ? "Nội dung UTF-8 không hợp lệ." : "Nội dung UTF-16LE không hợp lệ.");
  }
}

function csvSourceRow(raw: string, endLine: number): number {
  const record = raw.replace(/^(?:\r?\n)+/, "");
  const endings = (record.match(/\r\n|\n|\r/g) ?? []).length;
  const physicalLines = endings + (/(?:\r\n|\n|\r)$/.test(record) ? 0 : 1);
  return Math.max(1, endLine - physicalLines + 1);
}

async function parseXlsx(buffer: Buffer, mapping: ImportMapping): Promise<ParsedImport> {
  preflightXlsx(buffer);
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as never, { ignoreNodes: ["extLst"] });
  } catch {
    return badRequest("Nội dung tệp XLSX không hợp lệ.");
  }
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return badRequest("Tệp XLSX không có trang tính.");

  const result: ParsedImport = { rows: [], errors: [], totalRows: 0 };
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber <= mapping.skipRows) return;
    result.totalRows += 1;
    if (result.totalRows > MAX_ROWS) badRequest("Tệp chấm công có tối đa 20.000 dòng dữ liệu.");

    const width = Math.max(row.cellCount, ...Object.values(mapping.columns).map((column) => column + 1));
    const source: string[] = [];
    const values: Record<ColumnName, CellValue> = {} as Record<ColumnName, CellValue>;
    const formulas = new Set<ColumnName>();
    for (let index = 1; index <= width; index += 1) {
      const cell = row.getCell(index);
      source.push(cell.text ?? "");
    }
    for (const name of COLUMN_NAMES) {
      const cell = row.getCell(mapping.columns[name] + 1);
      if (isFormulaCell(cell.value)) formulas.add(name);
      values[name] = formulaFreeValue(cell.value);
    }
    addValidatedRow(result, rowNumber, source, mapping, values, formulas);
  });
  ensureHasRows(result);
  return result;
}

function preflightXlsx(buffer: Buffer): void {
  if (!buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
    badRequest("Nội dung tệp XLSX không hợp lệ.");
  }
  const eocd = findEndOfCentralDirectory(buffer);
  if (eocd < 0 || eocd + 22 > buffer.length) badRequest("Nội dung tệp XLSX không hợp lệ.");
  const entries = buffer.readUInt16LE(eocd + 10);
  const centralDirectoryOffset = buffer.readUInt32LE(eocd + 16);
  if (entries === 0xffff || centralDirectoryOffset === 0xffffffff) badRequest("Nội dung tệp XLSX không hợp lệ.");
  let offset = centralDirectoryOffset;
  let expandedSize = 0;
  for (let index = 0; index < entries; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) {
      badRequest("Nội dung tệp XLSX không hợp lệ.");
    }
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    expandedSize += uncompressedSize;
    if (expandedSize > MAX_XLSX_UNCOMPRESSED_BYTES) {
      badRequest("Tệp XLSX vượt quá giới hạn giải nén an toàn.");
    }
    offset += 46 + nameLength + extraLength + commentLength;
    if (offset > buffer.length) badRequest("Nội dung tệp XLSX không hợp lệ.");
  }
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const minimum = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return -1;
}

function isFormulaCell(value: unknown): boolean {
  return value !== null && typeof value === "object" && "formula" in value;
}

function formulaFreeValue(value: unknown): CellValue {
  if (isFormulaCell(value)) return undefined;
  return value instanceof Date || typeof value === "string" || typeof value === "number" ? value : undefined;
}

function addValidatedRow(
  result: ParsedImport,
  sourceRow: number,
  source: string[],
  mapping: ImportMapping,
  providedValues?: Record<ColumnName, CellValue>,
  formulas: ReadonlySet<ColumnName> = new Set(),
): void {
  const raw = (name: ColumnName): CellValue => providedValues?.[name] ?? source[mapping.columns[name]];
  const errors: ImportRowError[] = [];
  for (const name of formulas) {
    errors.push({ row: sourceRow, code: "FORMULA_CELL", message: `Cột ${displayName(name)} không được dùng công thức.` });
  }

  const employeeCode = stringValue(raw("employeeCode"));
  if (!employeeCode) errors.push(rowError(sourceRow, "EMPTY_EMPLOYEE_CODE", "Mã nhân viên là bắt buộc."));
  else if (employeeCode.length > 32) errors.push(rowError(sourceRow, "INVALID_EMPLOYEE_CODE", "Mã nhân viên không được quá 32 ký tự."));

  const date = parseDate(raw("date"), mapping.dateFormat);
  if (!date) errors.push(rowError(sourceRow, "INVALID_DATE", "Ngày chấm công không hợp lệ."));

  const time = parseTime(raw("time"), mapping.timeFormat);
  if (!time) errors.push(rowError(sourceRow, "INVALID_TIME", "Giờ chấm công không hợp lệ."));

  const deviceCode = stringValue(raw("deviceCode"));
  if (!deviceCode) errors.push(rowError(sourceRow, "EMPTY_DEVICE_CODE", "Mã thiết bị là bắt buộc."));
  else if (deviceCode.length > 80) errors.push(rowError(sourceRow, "INVALID_DEVICE_CODE", "Mã thiết bị không được quá 80 ký tự."));

  const direction = parseDirection(raw("direction"));
  if (!direction) errors.push(rowError(sourceRow, "INVALID_DIRECTION", "Chiều chấm công phải là Vào, Ra hoặc Tự động."));

  result.errors.push(...errors);
  if (errors.length > 0 || !date || !time || !direction || !employeeCode || !deviceCode) return;
  const punchedAt = new Date(Date.UTC(date.year, date.month - 1, date.day, time.hour - 7, time.minute, time.second)).toISOString();
  result.rows.push({ row: sourceRow, employeeCode, punchedAt, deviceCode, direction, source });
}

function rowError(row: number, code: string, message: string): ImportRowError {
  return { row, code, message };
}

function displayName(name: ColumnName): string {
  return ({ employeeCode: "mã nhân viên", date: "ngày", time: "giờ", deviceCode: "mã thiết bị", direction: "chiều chấm công" })[name];
}

function stringValue(value: CellValue): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function parseDate(value: CellValue, format: ImportMapping["dateFormat"]): { year: number; month: number; day: number } | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return calendarDate(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
  }
  if (typeof value === "number" && Number.isFinite(value)) return excelDate(value);
  if (typeof value !== "string") return null;
  const match = format === "YYYY-MM-DD"
    ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
    : /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match) return null;
  const [year, month, day] = format === "YYYY-MM-DD"
    ? [Number(match[1]), Number(match[2]), Number(match[3])]
    : [Number(match[3]), Number(match[2]), Number(match[1])];
  return calendarDate(year, month, day);
}

function calendarDate(year: number, month: number, day: number): { year: number; month: number; day: number } | null {
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? { year, month, day } : null;
}

function excelDate(serial: number): { year: number; month: number; day: number } | null {
  const wholeDays = Math.floor(serial);
  if (wholeDays < 1 || wholeDays > 2_958_465 || wholeDays === 60) return null;
  const date = new Date(Date.UTC(1899, 11, 30) + wholeDays * 86_400_000);
  return calendarDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function parseTime(value: CellValue, format: ImportMapping["timeFormat"]): { hour: number; minute: number; second: number } | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return { hour: value.getUTCHours(), minute: value.getUTCMinutes(), second: value.getUTCSeconds() };
  }
  if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value < 1) {
    const seconds = Math.round(value * 86_400);
    if (seconds >= 86_400) return null;
    return { hour: Math.floor(seconds / 3600), minute: Math.floor((seconds % 3600) / 60), second: seconds % 60 };
  }
  if (typeof value !== "string") return null;
  const match = format === "HH:mm:ss"
    ? /^(\d{2}):(\d{2}):(\d{2})$/.exec(value.trim())
    : /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]), minute = Number(match[2]), second = format === "HH:mm:ss" ? Number(match[3]) : 0;
  return hour < 24 && minute < 60 && second < 60 ? { hour, minute, second } : null;
}

function parseDirection(value: CellValue): PunchDirection | null {
  if (typeof value !== "string") return null;
  switch (value.trim().normalize("NFC").toLocaleUpperCase("vi-VN")) {
    case "IN":
    case "VÀO":
      return "IN";
    case "OUT":
    case "RA":
      return "OUT";
    case "AUTO":
    case "TỰ ĐỘNG":
      return "AUTO";
    default:
      return null;
  }
}

function ensureHasRows(result: ParsedImport): void {
  if (result.totalRows === 0) badRequest("Tệp chấm công không có dòng dữ liệu.");
}
