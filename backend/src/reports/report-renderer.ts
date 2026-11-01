import ExcelJS from "exceljs";
import { dirname, join } from "node:path";
import PDFDocument from "pdfkit";
import type { Column, Row } from "./report-types";

const FONT = join(dirname(require.resolve("@expo-google-fonts/be-vietnam-pro/package.json")), "400Regular", "BeVietnamPro_400Regular.ttf");
const FONT_BOLD = join(dirname(require.resolve("@expo-google-fonts/be-vietnam-pro/package.json")), "700Bold", "BeVietnamPro_700Bold.ttf");
export interface RenderInput { title: string; header: string[]; notes: string[]; columns: Column[]; rows: Row[] }

const cell = (row: Row, column: Column) => {
  const value = row[column.key];
  if (value === null || value === undefined) return "";
  return typeof value === "boolean" ? (value ? "Có" : "") : value;
};

export async function renderXlsx(input: RenderInput): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet(input.title.slice(0, 31).replace(/[\\/?*[\]:]/g, "-"));
  sheet.addRow([input.title]).font = { bold: true, size: 14 };
  for (const line of input.header) sheet.addRow([line]);
  for (const note of input.notes) sheet.addRow(["Ghi chú: " + note]);
  sheet.addRow([]);
  const header = sheet.addRow(input.columns.map(column => column.title));
  header.font = { bold: true };
  for (const row of input.rows) sheet.addRow(input.columns.map(column => cell(row, column)));
  input.columns.forEach((column, index) => {
    const target = sheet.getColumn(index + 1);
    target.width = column.width ?? Math.min(40, Math.max(10, column.title.length + 2));
    if (column.type === "money") target.numFmt = "#,##0";
  });
  return Buffer.from(await book.xlsx.writeBuffer());
}

/** Landscape A4 table with the same header block as the spreadsheet. */
export function renderPdf(input: RenderInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 28 });
    const chunks: Buffer[] = [];
    doc.on("data", chunk => chunks.push(chunk)); doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject);
    doc.registerFont("body", FONT); doc.registerFont("bold", FONT_BOLD);
    doc.font("bold").fontSize(13).text(input.title);
    doc.font("body").fontSize(8);
    for (const line of [...input.header, ...input.notes.map(note => "Ghi chú: " + note)]) doc.text(line);
    doc.moveDown(0.5);
    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const weights = input.columns.map(column => column.width ?? Math.max(6, Math.min(24, column.title.length)));
    const total = weights.reduce((sum, value) => sum + value, 0);
    const widths = weights.map(value => (value / total) * width);
    const size = input.columns.length > 20 ? 5 : 6.5;
    const line = (values: string[], bold = false) => {
      const heights = values.map((value, index) => doc.font(bold ? "bold" : "body").fontSize(size).heightOfString(value, { width: widths[index] - 2 }));
      const height = Math.max(...heights, size + 2) + 2;
      if (doc.y + height > doc.page.height - doc.page.margins.bottom) doc.addPage();
      const top = doc.y;
      let x = doc.page.margins.left;
      values.forEach((value, index) => { doc.font(bold ? "bold" : "body").fontSize(size).text(value, x + 1, top + 1, { width: widths[index] - 2, align: input.columns[index].type === "money" || input.columns[index].type === "number" ? "right" : "left" }); x += widths[index]; });
      doc.y = top + height;
      doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.margins.left + width, doc.y).lineWidth(0.2).strokeColor("#bbbbbb").stroke();
    };
    line(input.columns.map(column => column.title), true);
    for (const row of input.rows) line(input.columns.map(column => { const value = cell(row, column); return typeof value === "number" && column.type === "money" ? value.toLocaleString("vi-VN") : String(value); }));
    doc.end();
  });
}
