import { randomBytes } from "node:crypto";
import Decimal from "decimal.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import PDFDocument from "pdfkit";

// Pure payslip rendering from the locked payroll snapshot (FR-7.6.1, BR-62). Nothing here reads the database.
export interface SnapshotLine { lineNo: number; lineType: string; label: string; componentCode: string | null; sourceReference?: string | null; quantity?: string | null; amount: string }
export interface SnapshotEmployee {
  employeeId: string; code: string; fullName?: string; status: string;
  totals: { gross: string; insuranceEmployee: string; unionFee: string; tax: string; deductions: string; adjustments: string; net: string };
  units?: Array<{ orgUnitCode: string; orgUnitName: string; from: string; to: string; workUnits: string }>;
  lines: SnapshotLine[];
}
export interface SnapshotContent {
  period: { id: string; code: string; siteOrgUnitId: string; dateFrom: string; dateTo: string; expectedPaymentDate: string | null };
  sheet: { id: string };
  employees: SnapshotEmployee[];
}
export interface PayslipSection { title: string; rows: Array<{ label: string; detail: string | null; amount: string }>; total: string | null }
export interface PayslipView {
  period: { code: string; dateFrom: string; dateTo: string; expectedPaymentDate: string | null }; siteName: string; companyName: string;
  employee: { code: string; fullName: string }; units: Array<{ orgUnit: string; from: string; to: string; workUnits: string }>;
  sections: PayslipSection[]; net: string; snapshotHash: string;
}

export class PayslipError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

const EARNINGS: Record<string, string> = { MAIN: "Lương chính", ALLOWANCE: "Phụ cấp", OT: "Lương làm thêm giờ", NIGHT_ALLOWANCE: "Phụ cấp làm đêm", BONUS: "Thưởng" };
const UNIT: Record<string, string> = { MAIN: "công", OT: "giờ", NIGHT_ALLOWANCE: "giờ" };
const money = (value: string | number) => Math.round(Number(value)).toLocaleString("vi-VN") + " đ";

/** Groups snapshot lines into the mandatory payslip content: earnings, insurance, tax, deductions, adjustments with origin period, net. */
export function payslipView(content: SnapshotContent, employee: SnapshotEmployee, meta: { siteName: string; companyName: string; snapshotHash: string }): PayslipView {
  const pick = (types: string[]) => employee.lines.filter(line => types.includes(line.lineType));
  const row = (line: SnapshotLine, detail: string | null = null) => ({ label: line.label, detail, amount: line.amount });
  const quantity = (line: SnapshotLine) => line.quantity && UNIT[line.lineType] ? `${Number(line.quantity).toLocaleString("vi-VN", { maximumFractionDigits: 2 })} ${UNIT[line.lineType]}` : null;
  const earnings = pick(Object.keys(EARNINGS)).map(line => row(line, [EARNINGS[line.lineType], quantity(line)].filter(Boolean).join(" · ")));
  const insurance = pick(["INSURANCE_EMPLOYEE", "UNION_FEE"]).map(line => row(line));
  const tax = pick(["TAX"]).map(line => row(line));
  const deductions = pick(["DEDUCTION"]).map(line => row(line, line.sourceReference ?? null));
  const adjustments = pick(["ADJUSTMENT"]).map(line => row(line, line.sourceReference ?? "Kỳ gốc không ghi nhận"));
  const insuranceTotal = new Decimal(employee.totals.insuranceEmployee).add(employee.totals.unionFee).toFixed();
  return {
    period: { code: content.period.code, dateFrom: content.period.dateFrom, dateTo: content.period.dateTo, expectedPaymentDate: content.period.expectedPaymentDate },
    siteName: meta.siteName, companyName: meta.companyName,
    employee: { code: employee.code, fullName: employee.fullName ?? employee.code },
    units: (employee.units ?? []).map(unit => ({ orgUnit: `${unit.orgUnitCode} — ${unit.orgUnitName}`, from: unit.from, to: unit.to, workUnits: unit.workUnits })),
    sections: [
      { title: "Thu nhập", rows: earnings, total: employee.totals.gross },
      { title: "Bảo hiểm bắt buộc và đoàn phí (người lao động)", rows: insurance, total: insuranceTotal },
      { title: "Thuế thu nhập cá nhân", rows: tax, total: employee.totals.tax },
      { title: "Khấu trừ khác", rows: deductions, total: employee.totals.deductions },
      { title: "Điều chỉnh (ghi rõ kỳ gốc)", rows: adjustments, total: employee.totals.adjustments },
    ],
    net: employee.totals.net, snapshotHash: meta.snapshotHash,
  };
}

const RULE_TOKENS = ["EMPLOYEE_CODE", "ID_LAST4", "ID_LAST6", "DOB_DDMMYYYY", "DOB_DDMM", "DOB_YYYY"] as const;
export function parsePasswordRule(rule: string) {
  const tokens = rule.split("+").map(token => token.trim()).filter(Boolean);
  if (!tokens.length || tokens.some(token => !(RULE_TOKENS as readonly string[]).includes(token))) throw new PayslipError("PAYSLIP_PASSWORD_RULE_INVALID", "Quy tắc mật khẩu phiếu lương không hợp lệ: " + rule);
  return tokens as Array<(typeof RULE_TOKENS)[number]>;
}
/** Computes the open password from the configured rule; never stored. Missing source data isolates this employee's file. */
export function payslipPassword(tokens: ReturnType<typeof parsePasswordRule>, data: { employeeCode: string; idNumber: string | null; dob: string | null }) {
  const id = (data.idNumber ?? "").replace(/\s/g, "");
  const [year, month, day] = (data.dob ?? "").split("-");
  return tokens.map(token => {
    if (token === "EMPLOYEE_CODE") return data.employeeCode;
    if (token.startsWith("ID_")) {
      const size = token === "ID_LAST4" ? 4 : 6;
      if (id.length < size) throw new PayslipError("PAYSLIP_PASSWORD_DATA_MISSING", "Thiếu số giấy tờ tùy thân để tạo mật khẩu phiếu lương.");
      return id.slice(-size);
    }
    if (!year || !month || !day) throw new PayslipError("PAYSLIP_PASSWORD_DATA_MISSING", "Thiếu ngày sinh để tạo mật khẩu phiếu lương.");
    return token === "DOB_DDMMYYYY" ? day + month + year : token === "DOB_DDMM" ? day + month : year;
  }).join("");
}

const fontDir = dirname(require.resolve("@expo-google-fonts/be-vietnam-pro/package.json"));
let fonts: { regular: Buffer; bold: Buffer } | null = null;
function loadFonts() {
  fonts ??= { regular: readFileSync(join(fontDir, "400Regular", "BeVietnamPro_400Regular.ttf")), bold: readFileSync(join(fontDir, "700Bold", "BeVietnamPro_700Bold.ttf")) };
  return fonts;
}

/** One A4 PDF per person, AES-256 (PDF 1.7 ext 3) with a user password; printing allowed, editing not. */
export function renderPayslipPdf(view: PayslipView, password: string | null): Promise<Buffer> {
  const { regular, bold } = loadFonts();
  const document = new PDFDocument({
    size: "A4", margin: 40, compress: true,
    info: { Title: `Phiếu lương ${view.period.code} — ${view.employee.code}`, Subject: "payslip", Keywords: "snapshot-sha256:" + view.snapshotHash, Author: "HRTP" },
    ...(password ? { userPassword: password, ownerPassword: randomBytes(24).toString("base64url"), pdfVersion: "1.7ext3" as const, permissions: { printing: "highResolution" as const, modifying: false, copying: false, annotating: false } } : {}),
  });
  const chunks: Buffer[] = [];
  document.on("data", chunk => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => { document.on("end", () => resolve(Buffer.concat(chunks))); document.on("error", reject); });
  document.registerFont("regular", regular); document.registerFont("bold", bold);
  const width = document.page.width - 80;
  document.font("bold").fontSize(9).text(view.companyName.toUpperCase()).font("regular").text(view.siteName);
  document.moveDown(0.6).font("bold").fontSize(15).text("PHIẾU LƯƠNG", { align: "center" });
  document.font("regular").fontSize(10).text(`Kỳ ${view.period.code}: ${view.period.dateFrom} → ${view.period.dateTo}${view.period.expectedPaymentDate ? ` · Ngày chi dự kiến ${view.period.expectedPaymentDate}` : ""}`, { align: "center" });
  document.moveDown(0.6).font("bold").text("Người lao động: ", { continued: true }).font("regular").text(`${view.employee.fullName} (${view.employee.code})`);
  if (view.units.length) {
    document.font("bold").text("Đơn vị và số công:");
    document.font("regular");
    for (const unit of view.units) document.text(`• ${unit.orgUnit}: ${unit.from} → ${unit.to} — ${Number(unit.workUnits).toLocaleString("vi-VN", { maximumFractionDigits: 2 })} công`, { indent: 10 });
  }
  const line = (label: string, detail: string | null, amount: string, strong = false) => {
    const y = document.y;
    document.font(strong ? "bold" : "regular").fontSize(10).text(label + (detail ? ` (${detail})` : ""), 50, y, { width: width - 150 });
    const after = document.y;
    document.text(money(amount), 40 + width - 140, y, { width: 140, align: "right" });
    document.y = Math.max(after, document.y);
  };
  for (const section of view.sections) {
    if (!section.rows.length && new Decimal(section.total ?? 0).isZero()) continue;
    document.moveDown(0.5).font("bold").fontSize(11).text(section.title, 40);
    for (const row of section.rows) line(row.label, row.detail, row.amount);
    if (section.total !== null && section.rows.length > 1) line("Cộng", null, section.total, true);
  }
  document.moveDown(0.6).moveTo(40, document.y).lineTo(40 + width, document.y).stroke();
  document.moveDown(0.3);
  line("THỰC LĨNH", null, view.net, true);
  document.moveDown(1).font("regular").fontSize(7.5).fillColor("#555555").text(`Dựng từ bảng lương đã khóa · mã băm snapshot ${view.snapshotHash}. Tiền lương chuyển khoản đúng thực lĩnh, phí chuyển khoản do doanh nghiệp chịu. Dữ liệu mô phỏng.`, 40);
  document.end();
  return done;
}
