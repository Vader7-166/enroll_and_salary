import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import Decimal from "decimal.js";
import { plainText } from "../../common/data-crypto";
import { effectiveAt } from "../../organization/scope.service";
import { DAY, hours, key, monthBounds, parseDay, type Column, type Db, type ReportContext, type ReportDefinition, type Row } from "../report-types";

type Totals = { gross: string; insuranceEmployee: string; unionFee: string; insuranceEmployer: string; tax: string; deductions: string; adjustments: string; net: string; employerCost: string };
type Line = { lineType: string; label: string; componentCode: string | null; sourceReference: string | null; amount: string };
const money = (title: string, keyName: string): Column => ({ key: keyName, title, type: "money", sensitive: "salary" });
const num = (value: Decimal.Value) => new Decimal(value).toNumber();
const EARNING_GROUPS: Record<string, string> = { MAIN: "main", OT: "overtime", NIGHT_ALLOWANCE: "allowance", ALLOWANCE: "allowance", BONUS: "bonus", BENEFIT: "benefit", TERMINATION: "termination" };

async function payrollPeriod(ctx: ReportContext) {
  if (!ctx.params.payrollPeriodId) throw new BadRequestException({ code: "PAYROLL_PERIOD_REQUIRED", message: "Chọn kỳ lương." });
  const period = await ctx.db.payrollPeriod.findUnique({ where: { id: ctx.params.payrollPeriodId }, include: { payrollSheet: { include: { snapshot: true } } } });
  if (!period) throw new NotFoundException({ code: "NOT_FOUND", message: "Không tìm thấy kỳ lương." });
  if (!ctx.allowed.has(period.siteOrgUnitId)) throw new ForbiddenException({ code: "OUT_OF_SCOPE", message: "Kỳ lương thuộc cơ sở ngoài phạm vi." });
  return period;
}

/** Locked sheet → snapshot content (never recomputed); otherwise the current calculated rows, labelled draft. */
async function payrollEmployees(ctx: ReportContext) {
  const period = await payrollPeriod(ctx);
  const sheet = period.payrollSheet;
  if (!sheet) throw new NotFoundException({ code: "PAYROLL_NOT_CALCULATED", message: "Kỳ lương chưa được tính." });
  const excluded = new Set((await ctx.db.employeeExclusion.findMany({ where: { userAccountId: ctx.user.id, ...effectiveAt(period.dateTo) }, select: { employeeId: true } })).map(row => row.employeeId));
  if (sheet.status === "LOCKED" && sheet.snapshot) {
    const content = JSON.parse(plainText(ctx.key, sheet.snapshot.contentCipher, "bản lưu bảng lương")) as { employees: Array<{ employeeId: string; code: string; fullName: string; status: string; totals: Totals; lines: Line[] }> };
    return { period, sheet, status: "OFFICIAL" as const, source: "Bản lưu khóa bảng lương " + period.code, sourceHash: sheet.snapshot.contentHash,
      employees: content.employees.filter(row => !excluded.has(row.employeeId)).map(row => ({ id: null as string | null, ...row })) };
  }
  const rows = await ctx.db.payrollEmployee.findMany({ where: { sheetId: sheet.id }, include: { employee: { select: { code: true, fullName: true } }, lines: { orderBy: { lineNo: "asc" } } }, orderBy: { employee: { code: "asc" } } });
  return { period, sheet, status: "DRAFT" as const, source: "Bảng lương " + period.code + " trạng thái " + sheet.status, sourceHash: sheet.sourceHash,
    employees: rows.filter(row => !excluded.has(row.employeeId)).map(row => ({ id: row.id, employeeId: row.employeeId, code: row.employee.code, fullName: row.employee.fullName, status: row.status,
      totals: JSON.parse(plainText(ctx.key, row.totalsCipher)) as Totals,
      lines: row.lines.map(line => ({ lineType: line.lineType, label: line.label, componentCode: line.componentCode, sourceReference: line.sourceReference, amount: plainText(ctx.key, line.amountCipher) })) })) };
}

const payrollAsOf: ReportDefinition["asOf"] = async ctx => {
  const period = await ctx.db.payrollPeriod.findUnique({ where: { id: ctx.params.payrollPeriodId ?? "00000000-0000-0000-0000-000000000000" } });
  if (!period) throw new BadRequestException({ code: "PAYROLL_PERIOD_REQUIRED", message: "Chọn kỳ lương." });
  return period.dateTo;
};
const monthAsOf: ReportDefinition["asOf"] = async ctx => { if (!/^\d{4}-\d{2}$/.test(ctx.params.month ?? "")) throw new BadRequestException({ code: "MONTH_REQUIRED", message: "Chọn tháng." }); return monthBounds(ctx.params.month!).to; };
const yearAsOf: ReportDefinition["asOf"] = async ctx => { if (!/^\d{4}$/.test(ctx.params.year ?? "")) throw new BadRequestException({ code: "YEAR_REQUIRED", message: "Chọn năm." }); return new Date(Date.UTC(Number(ctx.params.year), 11, 31)); };

async function siteUnit(ctx: ReportContext) {
  if (!ctx.params.orgUnitId || ctx.units.get(ctx.params.orgUnitId)?.type !== "SITE") throw new BadRequestException({ code: "SITE_REQUIRED", message: "Chọn cơ sở." });
  if (!ctx.allowed.has(ctx.params.orgUnitId)) throw new ForbiddenException({ code: "OUT_OF_SCOPE", message: "Cơ sở ngoài phạm vi." });
  return ctx.params.orgUnitId;
}

export const payrollReports: ReportDefinition[] = [
  {
    type: "PAYROLL_PAYMENT", title: "Bảng thanh toán tiền lương", group: "10.3", roles: ["KT"], permission: "payroll.read", params: ["payrollPeriodId"], sensitive: true, asOf: payrollAsOf,
    async run(ctx) {
      const data = await payrollEmployees(ctx);
      const rows: Row[] = data.employees.map(employee => {
        const row: Row = { code: employee.code, fullName: employee.fullName, status: employee.status, main: 0, overtime: 0, allowance: 0, bonus: 0, benefit: 0, termination: 0,
          gross: num(employee.totals.gross), insurance: num(employee.totals.insuranceEmployee), unionFee: num(employee.totals.unionFee), tax: num(employee.totals.tax), deductions: num(employee.totals.deductions),
          adjustments: num(employee.totals.adjustments), adjustmentOrigin: employee.lines.filter(line => line.lineType === "ADJUSTMENT").map(line => line.label + (line.sourceReference ? " (" + line.sourceReference + ")" : "")).join("; "), net: num(employee.totals.net),
          _payrollEmployeeId: employee.id, _sheetId: data.sheet.id, _employeeId: employee.employeeId };
        for (const line of employee.lines) { const group = EARNING_GROUPS[line.lineType]; if (group) row[group] = (row[group] as number) + num(line.amount); }
        return row;
      });
      return { status: data.status, source: data.source, sourceHash: data.sourceHash, periodLabel: data.period.code, rows,
        columns: [{ key: "code", title: "Mã NV" }, { key: "fullName", title: "Họ và tên" }, { key: "status", title: "Trạng thái tính" }, money("Lương chính", "main"), money("OT", "overtime"), money("Phụ cấp", "allowance"), money("Thưởng", "bonus"),
          money("Phúc lợi", "benefit"), money("Trợ cấp/phép khi nghỉ", "termination"), money("Tổng thu nhập", "gross"), money("BH NLĐ", "insurance"), money("Đoàn phí", "unionFee"), money("Thuế TNCN", "tax"),
          money("Khấu trừ khác", "deductions"), money("Điều chỉnh", "adjustments"), { key: "adjustmentOrigin", title: "Điều chỉnh — kỳ gốc" }, money("Thực lĩnh", "net")],
        notes: ["Chi tiết từng ô: mở dòng nhân viên trong trang Bảng lương (truy vết tới công/lượt quẹt)."] };
    },
  },
  {
    type: "BONUS_PAYMENT", title: "Bảng thanh toán tiền thưởng", group: "10.3", roles: ["KT"], permission: "payroll.read", params: ["payrollPeriodId"], sensitive: true, asOf: payrollAsOf,
    async run(ctx) {
      const period = await payrollPeriod(ctx);
      const rows = await ctx.db.bonusAllocation.findMany({ where: { plan: { payPayrollPeriodId: period.id, status: "CONFIRMED" } }, include: { plan: { include: { component: { include: { versions: { orderBy: { effectiveFrom: "desc" }, take: 1 } } } } }, employee: { select: { code: true, fullName: true } } }, orderBy: [{ plan: { code: "asc" } }] });
      return { status: period.payrollSheet?.status === "LOCKED" ? "OFFICIAL" : "DRAFT", source: "Đợt thưởng đã xác nhận chi trong kỳ " + period.code, sourceHash: period.payrollSheet?.snapshot?.contentHash ?? null, periodLabel: period.code,
        rows: rows.map(row => ({ plan: row.plan.code, type: row.plan.bonusType, decision: row.plan.decisionReference, code: row.employee.code, fullName: row.employee.fullName, amount: num(plainText(ctx.key, row.amountCipher, "thưởng")),
          taxable: (row.plan.component?.versions[0]?.taxClassification ?? "TAXABLE") === "NON_TAXABLE" ? "Không" : "Có" })),
        columns: [{ key: "plan", title: "Đợt thưởng" }, { key: "type", title: "Loại" }, { key: "decision", title: "Căn cứ" }, { key: "code", title: "Mã NV" }, { key: "fullName", title: "Họ và tên" }, money("Số tiền", "amount"), { key: "taxable", title: "Chịu thuế" }],
        notes: ["Thuế khấu trừ của khoản thưởng nằm trong thuế TNCN của lần chi kỳ lương (tính chung với lương), xem Bảng thuế khấu trừ."] };
    },
  },
  {
    type: "PAYROLL_FUND", title: "Quỹ lương theo cơ sở/đơn vị", group: "10.3", roles: ["KT"], permission: "payroll.read", params: ["month"], sensitive: true, asOf: monthAsOf,
    async run(ctx) {
      const { from, to } = monthBounds(ctx.params.month!);
      const periods = await ctx.db.payrollPeriod.findMany({ where: { dateTo: { gte: from, lte: to }, siteOrgUnitId: { in: [...ctx.allowed] } }, include: { payrollSheet: { include: { employees: { where: { status: "OK" } } } } } });
      const groups = new Map<string, Row>();
      for (const period of periods) for (const employee of period.payrollSheet?.employees ?? []) {
        const totals = JSON.parse(plainText(ctx.key, employee.totalsCipher)) as Totals;
        const detail = JSON.parse(plainText(ctx.key, employee.detailCipher)) as { costAllocation?: Array<{ orgUnitId: string; ratio: string }> };
        for (const share of detail.costAllocation?.length ? detail.costAllocation : [{ orgUnitId: period.siteOrgUnitId, ratio: "1" }]) {
          const id = period.siteOrgUnitId + "|" + share.orgUnitId;
          const row = groups.get(id) ?? { site: ctx.units.get(period.siteOrgUnitId)?.name ?? "", unit: ctx.units.get(share.orgUnitId)?.name ?? share.orgUnitId, headcount: 0, gross: 0, insuranceEmployer: 0, net: 0, employerCost: 0 };
          row.headcount = Math.round(((row.headcount as number) + num(share.ratio)) * 100) / 100;
          for (const field of ["gross", "insuranceEmployer", "net", "employerCost"] as const) row[field] = (row[field] as number) + Math.round(num(totals[field]) * num(share.ratio));
          groups.set(id, row);
        }
      }
      const locked = periods.length > 0 && periods.every(period => period.payrollSheet?.status === "LOCKED");
      return { status: locked ? "OFFICIAL" : "DRAFT", source: periods.length + " kỳ lương có ngày kết thúc trong " + ctx.params.month, periodLabel: ctx.params.month!, rows: [...groups.values()],
        columns: [{ key: "site", title: "Cơ sở" }, { key: "unit", title: "Đơn vị" }, { key: "headcount", title: "Người (quy đổi)", type: "number" }, money("Tổng thu nhập", "gross"), money("BH phần DN", "insuranceEmployer"), money("Thực lĩnh", "net"), money("Chi phí DN khác", "employerCost")] };
    },
  },
  {
    type: "COST_ALLOCATION", title: "Phân bổ chi phí lương theo cost center (TK 622/642)", group: "10.3", roles: ["KT"], permission: "payroll.read", params: ["payrollPeriodId"], sensitive: true, asOf: payrollAsOf,
    async run(ctx) {
      const period = await payrollPeriod(ctx);
      const sheet = period.payrollSheet;
      if (!sheet) throw new NotFoundException({ code: "PAYROLL_NOT_CALCULATED", message: "Kỳ lương chưa được tính." });
      // Calculated rows of a locked sheet are immutable, so they equal the snapshot.
      const employees = await ctx.db.payrollEmployee.findMany({ where: { sheetId: sheet.id, status: "OK" }, include: { lines: { where: { lineType: "INSURANCE_EMPLOYER" } } } });
      const groups = new Map<string, { costCenter: string; account: string; salary: Decimal; insurance: Decimal; union: Decimal }>();
      for (const employee of employees) {
        const totals = JSON.parse(plainText(ctx.key, employee.totalsCipher)) as Totals;
        const detail = JSON.parse(plainText(ctx.key, employee.detailCipher)) as { costAllocation?: Array<{ costCenterCode: string | null; orgUnitId: string; days: number; ratio: string; amount: string }> };
        const union = employee.lines.filter(line => line.componentCode === "KPCD").reduce((total, line) => total.plus(plainText(ctx.key, line.amountCipher)), new Decimal(0));
        const insurance = new Decimal(totals.insuranceEmployer).minus(union);
        for (const share of detail.costAllocation ?? []) {
          const unit = ctx.units.get(share.orgUnitId);
          const id = (share.costCenterCode ?? "—") + "|" + (unit?.accountingAccount ?? "—");
          const group = groups.get(id) ?? { costCenter: share.costCenterCode ?? "—", account: unit?.accountingAccount ?? "—", salary: new Decimal(0), insurance: new Decimal(0), union: new Decimal(0) };
          group.salary = group.salary.plus(share.amount); group.insurance = group.insurance.plus(insurance.times(share.ratio)); group.union = group.union.plus(union.times(share.ratio));
          groups.set(id, group);
        }
      }
      const rows = [...groups.values()].sort((left, right) => left.costCenter.localeCompare(right.costCenter)).map(group => ({ costCenter: group.costCenter, account: group.account, salary: group.salary.round().toNumber(),
        insurance: group.insurance.round().toNumber(), union: group.union.round().toNumber(), total: group.salary.plus(group.insurance).plus(group.union).round().toNumber() }));
      return { status: sheet.status === "LOCKED" ? "OFFICIAL" : "DRAFT", source: "Kết quả tính lương kỳ " + period.code + " (phân bổ theo ngày công từng đoạn đơn vị)", sourceHash: sheet.snapshot?.contentHash ?? sheet.sourceHash, periodLabel: period.code, rows,
        columns: [{ key: "costCenter", title: "Cost center" }, { key: "account", title: "Tài khoản" }, money("Chi phí lương", "salary"), money("BH phần DN", "insurance"), money("KPCĐ", "union"), money("Tổng chi phí", "total")],
        notes: ["Chỉ xuất tệp, không đẩy sang ERP. Nhân sự nhiều đơn vị trong kỳ được chia theo tỷ lệ ngày công từng đoạn."] };
    },
  },
  {
    type: "INSURANCE_CONTRIBUTIONS", title: "Bảng trích BHXH, BHYT, BHTN, KPCĐ", group: "10.4", roles: ["KT"], permission: "insurance.read", params: ["payrollPeriodId"], sensitive: true, asOf: payrollAsOf,
    async run(ctx) {
      const period = await payrollPeriod(ctx);
      const rows = await ctx.db.insuranceContribution.findMany({ where: { payrollPeriodId: period.id }, include: { employee: { select: { code: true, fullName: true } } }, orderBy: { employee: { code: "asc" } } });
      return { status: period.payrollSheet?.status === "LOCKED" ? "OFFICIAL" : "DRAFT", source: "Kết quả tính BH của kỳ lương " + period.code, sourceHash: period.payrollSheet?.snapshot?.contentHash ?? null, periodLabel: period.code,
        rows: rows.map(row => {
          const detail = JSON.parse(plainText(ctx.key, row.detailCipher, "bảo hiểm")) as { salary: { perKind: { BHXH: { value: string } } } | null; contribution: { lines: Array<{ kind: string; employee: string; employer: string }> } | null };
          const line = (kind: string) => detail.contribution?.lines.find(item => item.kind === kind);
          const out: Row = { code: row.employee.code, fullName: row.employee.fullName, month: row.contributionMonth, base: detail.salary ? num(detail.salary.perKind.BHXH.value) : null };
          for (const kind of ["BHXH", "BHYT", "BHTN"]) { out[kind + "_e"] = num(line(kind)?.employee ?? 0); out[kind + "_r"] = num(line(kind)?.employer ?? 0); }
          out.KPCD = num(line("KPCD")?.employer ?? 0); out.union = num(line("UNION_FEE")?.employee ?? 0);
          return out;
        }),
        columns: [{ key: "code", title: "Mã NV" }, { key: "fullName", title: "Họ và tên" }, { key: "month", title: "Tháng đóng" }, money("Lương đóng BHXH", "base"), money("BHXH NLĐ", "BHXH_e"), money("BHXH DN", "BHXH_r"),
          money("BHYT NLĐ", "BHYT_e"), money("BHYT DN", "BHYT_r"), money("BHTN NLĐ", "BHTN_e"), money("BHTN DN", "BHTN_r"), money("KPCĐ (DN)", "KPCD"), money("Đoàn phí", "union")] };
    },
  },
  {
    type: "INSURANCE_CHANGES", title: "Danh sách tăng/giảm/điều chỉnh BH", group: "10.4", roles: ["KT"], permission: "insurance.read", params: ["orgUnitId", "month"], sensitive: true, asOf: monthAsOf,
    async run(ctx) {
      const site = await siteUnit(ctx);
      const list = await ctx.db.insuranceChangeList.findUnique({ where: { siteOrgUnitId_month: { siteOrgUnitId: site, month: ctx.params.month! } }, include: { items: { include: { employee: { select: { code: true, fullName: true } }, arrears: true } } } });
      if (!list) throw new NotFoundException({ code: "LIST_NOT_GENERATED", message: "Chưa lập danh sách biến động BH của tháng." });
      return { status: list.status === "FINALIZED" ? "OFFICIAL" : "DRAFT", source: "Danh sách biến động BH " + ctx.params.month + " revision " + list.revision, sourceHash: list.contentHash, periodLabel: ctx.params.month!,
        rows: list.items.map(item => {
          const values = JSON.parse(plainText(ctx.key, item.valuesCipher, "bảo hiểm")) as { old: { base: Record<string, string> | null }; new: { base: Record<string, string> | null } };
          const arrears = item.arrears.reduce((total, row) => total.plus((JSON.parse(plainText(ctx.key, row.detailCipher, "bảo hiểm")) as { total: string }).total), new Decimal(0));
          return { code: item.employee.code, fullName: item.employee.fullName, type: item.changeType, reason: item.reasonCode, effectiveDate: key(item.effectiveDate), oldBase: values.old.base ? num(values.old.base.BHXH) : null,
            newBase: values.new.base ? num(values.new.base.BHXH) : null, late: item.late ? "Muộn — " + item.originMonth : "", arrears: item.arrears.length ? arrears.toNumber() : null };
        }),
        columns: [{ key: "code", title: "Mã NV" }, { key: "fullName", title: "Họ và tên" }, { key: "type", title: "Loại" }, { key: "reason", title: "Lý do" }, { key: "effectiveDate", title: "Hiệu lực", type: "date" },
          money("Mức cũ", "oldBase"), money("Mức mới", "newBase"), { key: "late", title: "Báo muộn" }, money("Truy thu/thoái thu", "arrears")] };
    },
  },
  {
    type: "C12_RECONCILIATION", title: "Đối chiếu C12", group: "10.4", roles: ["KT"], permission: "insurance.read", params: ["orgUnitId", "month"], sensitive: true, asOf: monthAsOf,
    async run(ctx) {
      const site = await siteUnit(ctx);
      const imported = await ctx.db.c12Import.findFirst({ where: { siteOrgUnitId: site, month: ctx.params.month! }, orderBy: { importedAt: "desc" }, include: { differences: { include: { employee: { select: { code: true, fullName: true } } } } } });
      if (!imported) throw new NotFoundException({ code: "C12_NOT_IMPORTED", message: "Chưa nhập C12 của tháng." });
      return { status: "OFFICIAL", source: "Lần nhập C12 " + imported.fileName + " lúc " + imported.importedAt.toISOString(), sourceHash: imported.fileHash, periodLabel: ctx.params.month!,
        rows: imported.differences.map(row => { const detail = JSON.parse(plainText(ctx.key, row.detailCipher, "C12")) as Record<string, unknown>;
          return { category: row.category, code: row.employee?.code ?? "", fullName: row.employee?.fullName ?? String((detail.c12 as { fullName?: string } | undefined)?.fullName ?? ""), rowNumber: row.rowNumber,
            c12: typeof detail.c12 === "string" ? num(detail.c12) : null, system: typeof detail.system === "string" ? num(detail.system) : null, difference: typeof detail.difference === "string" ? num(detail.difference) : null }; }),
        columns: [{ key: "category", title: "Phân loại" }, { key: "code", title: "Mã NV" }, { key: "fullName", title: "Họ và tên" }, { key: "rowNumber", title: "Dòng C12", type: "number" }, money("Theo C12", "c12"), money("Theo hệ thống", "system"), money("Chênh lệch", "difference")] };
    },
  },
  {
    type: "TAX_WITHHOLDING", title: "Bảng thuế TNCN khấu trừ", group: "10.4", roles: ["KT"], permission: "tax.read", params: ["month"], sensitive: true, asOf: monthAsOf,
    async run(ctx) {
      const { from, to } = monthBounds(ctx.params.month!);
      const rows = await ctx.db.taxWithholding.findMany({ where: { paymentDate: { gte: from, lte: to } }, include: { employee: { select: { id: true, code: true, fullName: true } }, ruleset: { select: { code: true } }, exemptionLines: true }, orderBy: [{ paymentDate: "asc" }, { createdAt: "asc" }] });
      const visible: Row[] = [];
      for (const row of rows) {
        const unit = await ctx.db.orgAssignment.findFirst({ where: { employeeId: row.employeeId, isPrimary: true, ...effectiveAt(row.paymentDate) }, select: { orgUnitId: true } });
        if (!unit || !ctx.allowed.has(unit.orgUnitId)) continue;
        const detail = JSON.parse(plainText(ctx.key, row.detailCipher, "thuế")) as { exemptions: { taxable: string; exempt: string }; tax: string };
        const byKind = row.exemptionLines.map(line => { const amounts = JSON.parse(plainText(ctx.key, line.amountsCipher, "thuế")) as { exempt: string; taxable: string }; return line.kind + ": miễn " + Number(amounts.exempt).toLocaleString("vi-VN") + " / chịu " + Number(amounts.taxable).toLocaleString("vi-VN"); }).join("; ");
        const paymentDate = key(row.paymentDate);
        visible.push({ paymentDate, dateStatus: row.paymentDateStatus === "ACTUAL" ? "Thực tế" : "Dự kiến", taxPeriod: row.taxPeriod, code: row.employee.code, fullName: row.employee.fullName, branch: row.branch, ruleset: row.ruleset.code,
          taxable: num(detail.exemptions.taxable), exempt: num(detail.exemptions.exempt), tax: num(detail.tax), byKind, filing: row.filingStatus === "FILED" ? "Đã khai" : "Chưa khai",
          link: row.originalWithholdingId ? "Điều chỉnh của bản ghi gốc " + row.originalWithholdingId.slice(0, 8) : paymentDate >= "2026-01-01" && paymentDate <= "2026-06-30" ? "Giữ nguyên số đã khai (chuyển tiếp 2026)" : "" });
      }
      return { status: visible.every(row => row.dateStatus === "Thực tế") ? "OFFICIAL" : "DRAFT", source: "Sổ khấu trừ thuế theo ngày chi trong " + ctx.params.month, periodLabel: ctx.params.month!, rows: visible,
        columns: [{ key: "paymentDate", title: "Ngày chi", type: "date" }, { key: "dateStatus", title: "Ngày chi" }, { key: "taxPeriod", title: "Kỳ thuế" }, { key: "code", title: "Mã NV" }, { key: "fullName", title: "Họ và tên" }, { key: "branch", title: "Nhánh" },
          { key: "ruleset", title: "Bộ quy tắc" }, money("Chịu thuế", "taxable"), money("Miễn", "exempt"), money("Thuế khấu trừ", "tax"), { key: "byKind", title: "Theo khoản", sensitive: "salary" }, { key: "filing", title: "Kê khai" }, { key: "link", title: "Liên kết" }],
        notes: ["Nhóm theo ngày chi trả thực tế, không theo tên kỳ công (lương tháng 12 chi tháng 1 thuộc tháng 1)."] };
    },
  },
  {
    type: "TAX_FINALIZATION_SUMMARY", title: "Tổng hợp quyết toán thuế TNCN", group: "10.4", roles: ["KT"], permission: "tax.read", params: ["year"], sensitive: true, asOf: yearAsOf,
    async run(ctx) {
      const year = Number(ctx.params.year);
      const rows = await ctx.db.annualTaxFinalization.findMany({ where: { taxYear: year }, include: { employee: { select: { id: true, code: true, fullName: true } } }, orderBy: [{ employee: { code: "asc" } }, { version: "desc" }] });
      const latest = new Map<string, (typeof rows)[number]>();
      for (const row of rows) if (!latest.has(row.employeeId)) latest.set(row.employeeId, row);
      const visible = [];
      for (const row of latest.values()) { const unit = await ctx.db.orgAssignment.findFirst({ where: { employeeId: row.employeeId, isPrimary: true }, orderBy: { effectiveFrom: "desc" }, select: { orgUnitId: true } }); if (unit && ctx.allowed.has(unit.orgUnitId)) visible.push(row); }
      return { status: visible.every(row => row.status === "DONE") ? "OFFICIAL" : "DRAFT", source: "Dự thảo quyết toán năm " + year + " (phiên bản mới nhất)", periodLabel: "Năm " + year,
        rows: visible.map(row => { const summary = JSON.parse(plainText(ctx.key, row.summaryCipher, "thuế")) as { taxableIncome: string; totalDeductions: string; assessableIncome: string; annualTax: string; withheld: string; difference: string };
          return { code: row.employee.code, fullName: row.employee.fullName, version: row.version, status: row.status, taxable: num(summary.taxableIncome), deductions: num(summary.totalDeductions), assessable: num(summary.assessableIncome),
            annualTax: num(summary.annualTax), withheld: num(summary.withheld), difference: num(summary.difference) }; }),
        columns: [{ key: "code", title: "Mã NV" }, { key: "fullName", title: "Họ và tên" }, { key: "version", title: "Phiên bản", type: "number" }, { key: "status", title: "Trạng thái" }, money("Chịu thuế", "taxable"), money("Giảm trừ", "deductions"),
          money("Tính thuế", "assessable"), money("Thuế năm", "annualTax"), money("Đã khấu trừ", "withheld"), money("Chênh lệch", "difference")] };
    },
  },
  {
    type: "LABOR_USAGE", title: "Tình hình sử dụng lao động", group: "10.4", roles: ["KT"], permission: "employee.read", params: ["dateRange"], sensitive: false,
    asOf: async ctx => parseDay(ctx.params.dateTo!),
    async run(ctx) {
      const from = parseDay(ctx.params.dateFrom!), to = parseDay(ctx.params.dateTo!);
      const rows: Row[] = [];
      for (let cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1)); cursor <= to; cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1))) {
        const end = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0));
        const people = await ctx.employees(end, { hireDate: { lte: end }, OR: [{ terminationDate: null }, { terminationDate: { gte: end } }] });
        const details = await ctx.db.employee.findMany({ where: { id: { in: people.map(person => person.id) } }, select: { gender: true, nationality: true, contracts: { where: { status: "ACTIVE", startDate: { lte: end } }, orderBy: { startDate: "desc" }, take: 1, select: { type: true } } } });
        const hires = await ctx.employees(end, { hireDate: { gte: cursor, lte: end } });
        const leavers = (await ctx.employees(new Date(cursor.getTime() - DAY), { terminationDate: { gte: cursor, lte: end } })).length;
        const count = (predicate: (row: (typeof details)[number]) => boolean) => details.filter(predicate).length;
        rows.push({ month: key(cursor).slice(0, 7), headcount: people.length, female: count(row => row.gender === "FEMALE"), foreign: count(row => row.nationality !== "Việt Nam"),
          indefinite: count(row => row.contracts[0]?.type === "INDEFINITE"), fixedTerm: count(row => row.contracts[0]?.type === "FIXED_TERM"), other: count(row => !["INDEFINITE", "FIXED_TERM"].includes(row.contracts[0]?.type ?? "")), hires: hires.length, leavers });
      }
      return { status: "DRAFT", source: "Hồ sơ nhân sự và hợp đồng", periodLabel: ctx.params.dateFrom + " → " + ctx.params.dateTo, rows,
        columns: [{ key: "month", title: "Tháng" }, { key: "headcount", title: "Lao động cuối tháng", type: "number" }, { key: "female", title: "Nữ", type: "number" }, { key: "foreign", title: "Nước ngoài", type: "number" },
          { key: "indefinite", title: "HĐ không thời hạn", type: "number" }, { key: "fixedTerm", title: "HĐ xác định thời hạn", type: "number" }, { key: "other", title: "Khác/chưa có HĐ", type: "number" }, { key: "hires", title: "Tăng trong tháng", type: "number" }, { key: "leavers", title: "Giảm trong tháng", type: "number" }],
        notes: ["Cột theo mẫu mô phỏng; cấu hình lại theo biểu mẫu báo cáo sử dụng lao động hiện hành khi được xác nhận."] };
    },
  },
  {
    type: "OT_ANNUAL", title: "Làm thêm giờ 200–300 giờ/năm", group: "10.4", roles: ["KT", "QD"], permission: "attendance.read", params: ["year"], sensitive: false, asOf: yearAsOf,
    async run(ctx) {
      const year = Number(ctx.params.year), start = new Date(Date.UTC(year, 0, 1)), end = new Date(Date.UTC(year, 11, 31));
      const sums = await ctx.db.overtimeActual.groupBy({ by: ["employeeId"], where: { workDate: { gte: start, lte: end } }, _sum: { eligibleMinutes: true } });
      const heavy = sums.filter(row => Number(row._sum.eligibleMinutes ?? 0) > 0);
      const people = new Map((await ctx.employees(end < ctx.asOf ? end : ctx.asOf, { id: { in: heavy.map(row => row.employeeId) } })).map(person => [person.id, person]));
      const rows: Row[] = [];
      for (const row of heavy) {
        const person = people.get(row.employeeId); if (!person) continue;
        const minutes = Number(row._sum.eligibleMinutes ?? 0);
        const cap = await ctx.db.legalParameter.findFirst({ where: { paramCode: "OT_YEAR_MAX_MINUTES", scopeKey: { in: ["GLOBAL"] }, ...effectiveAt(end) } });
        const capMinutes = Number(cap?.value ?? 12000);
        rows.push({ code: person.code, fullName: person.fullName, unit: ctx.units.get(person.orgUnitId)?.name ?? "", hours: hours(minutes), band: minutes > 18000 ? "> 300 giờ" : minutes > 12000 ? "200–300 giờ" : "≤ 200 giờ", cap: hours(capMinutes), warning: minutes > capMinutes ? "Vượt trần áp dụng" : "" });
      }
      return { status: "DRAFT", source: "OT đủ điều kiện năm " + year, periodLabel: "Năm " + year, rows: rows.sort((left, right) => (right.hours as number) - (left.hours as number)),
        columns: [{ key: "code", title: "Mã NV" }, { key: "fullName", title: "Họ và tên" }, { key: "unit", title: "Đơn vị" }, { key: "hours", title: "Giờ OT năm", type: "number" }, { key: "band", title: "Nhóm" }, { key: "cap", title: "Trần áp dụng (h)", type: "number" }, { key: "warning", title: "Cảnh báo" }],
        notes: ["Trần 300 giờ chỉ áp dụng khi cơ sở có thông báo hợp lệ với cơ quan lao động (BR-27)."] };
    },
  },
];
export type { Db };
