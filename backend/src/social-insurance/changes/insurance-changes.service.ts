import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import Decimal from "decimal.js";
import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import { AuditService } from "../../audit/audit.service";
import type { AuthUser } from "../../auth/auth.types";
import { cipherText, plainText } from "../../common/data-crypto";
import { PrismaService } from "../../database/prisma.service";
import { effectiveAt, ScopeService } from "../../organization/scope.service";
import { INSURANCE_KINDS } from "../insurance-engine";
import { SocialInsuranceService } from "../social-insurance.service";
import { arrearsFor, detectChange, monthBounds, shiftMonth, type Amounts, type ChangeEvent, type MonthState } from "./change-rules";

type Db = Prisma.TransactionClient;
const DEFAULT_LOOKBACK = 3;
const date = (value: string) => new Date(value + "T00:00:00.000Z");
const key = (value: Date) => value.toISOString().slice(0, 10);
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
function fail(kind: "conflict" | "bad" | "missing", code: string, message: string): never {
  throw kind === "conflict" ? new ConflictException({ code, message }) : kind === "missing" ? new NotFoundException({ code, message }) : new BadRequestException({ code, message });
}
export const REASON_LABELS: Record<string, string> = {
  NEW_HIRE: "Vào làm", TRANSFER_IN: "Điều chuyển đến", RETURN_TO_WORK: "Đi làm lại", ELIGIBLE_CONTRACT: "Hợp đồng thuộc diện",
  TERMINATION: "Nghỉ việc / chấm dứt HĐ", TRANSFER_OUT: "Điều chuyển đi", MATERNITY: "Nghỉ thai sản", UNPAID_LEAVE_14_DAYS: "Nghỉ không lương từ 14 ngày",
  NO_CONTRACT: "Không còn hợp đồng", PROBATION_ONLY: "Chỉ còn hợp đồng thử việc", CONTRACT_UNDER_1_MONTH: "Hợp đồng dưới 1 tháng", CONTRACT_NOT_ELIGIBLE: "Hợp đồng không thuộc diện",
  RETIREE: "Đã hưởng lương hưu", SALARY_CHANGE: "Thay đổi lương đóng", PARTICIPATION_CHANGE: "Thay đổi loại BH tham gia",
};
const TYPE_LABELS = { INCREASE: "Báo tăng", DECREASE: "Báo giảm", ADJUST: "Điều chỉnh" } as const;

interface ItemValues { old: ChangeEvent["old"]; new: ChangeEvent["new"] }
interface PlannedItem { employeeId: string; event: ChangeEvent; late: boolean; originMonth: string | null; arrears: NonNullable<ReturnType<typeof arrearsFor>>[] }

@Injectable()
export class InsuranceChangesService {
  private readonly key: Buffer;
  constructor(private readonly prisma: PrismaService, private readonly scope: ScopeService, private readonly audit: AuditService, private readonly insurance: SocialInsuranceService, config: ConfigService) {
    this.key = Buffer.from(config.getOrThrow<string>("HR_DATA_KEY"), "base64");
  }
  private encrypt(value: unknown) { return cipherText(this.key, JSON.stringify(value)); }
  private decrypt<T>(value: string): T { return JSON.parse(plainText(this.key, value, "bảo hiểm")); }

  /** KT with the permission whose scope contains the site; returns the site's `site` row id. */
  async site(user: AuthUser, permission: "insurance.read" | "insurance.manage", siteOrgUnitId: string, db: Db = this.prisma) {
    if (!user.roles.includes("KT") || !user.permissions.includes(permission)) throw new ForbiddenException("Chỉ KT được xem hoặc lập danh sách biến động BH.");
    const scope = await this.scope.load(user, permission, db);
    const version = scope.versions.find(row => row.orgUnitId === siteOrgUnitId && row.type === "SITE");
    if (!version?.siteId) throw new ForbiddenException("Cơ sở nằm ngoài phạm vi được phân quyền.");
    return { siteId: version.siteId, name: version.name };
  }

  private assertMonth(month: string) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) fail("bad", "MONTH_INVALID", "Tháng phải có dạng YYYY-MM.");
  }

  private async lookback(db: Db, month: string) {
    const row = await db.legalParameter.findFirst({ where: { paramCode: "INSURANCE_LATE_LOOKBACK_MONTHS", scopeKey: "GLOBAL", ...effectiveAt(date(monthBounds(month).to)) }, orderBy: { effectiveFrom: "desc" } });
    return typeof row?.value === "string" && /^[1-9]\d?$/.test(row.value) ? Number(row.value) : DEFAULT_LOOKBACK;
  }

  /** Correct (recomputed) state of one employee for one month at this site. */
  private async state(db: Db, employee: { id: string; hireDate: Date; terminationDate: Date | null }, month: string, siteId: string): Promise<MonthState> {
    const { from, to } = monthBounds(month);
    const base: MonthState = { month, present: false, eligible: { BHXH: false, BHYT: false, BHTN: false }, reasonCode: "NOT_EMPLOYED", base: null, contribution: null,
      hireDate: key(employee.hireDate), terminationDate: employee.terminationDate ? key(employee.terminationDate) : null, maternity: false, sources: {} };
    if (key(employee.hireDate) > to) return base;
    if (employee.terminationDate && key(employee.terminationDate) < from) return { ...base, reasonCode: "TERMINATION" };
    const result = await this.insurance.compute(db, employee.id, month);
    const present = result.unit?.siteId === siteId;
    const contribution = result.contribution ? Object.fromEntries(INSURANCE_KINDS.map(kind => {
      const line = result.contribution!.lines.find(item => item.kind === kind);
      return [kind, { employee: line?.employee ?? "0", employer: line?.employer ?? "0" }];
    })) as Amounts : null;
    const maternity = !!await db.leaveRequest.findFirst({ where: { employeeId: employee.id, status: "APPROVED", leaveType: { code: "MATERNITY" }, dateFrom: { lte: date(to) }, dateTo: { gte: date(from) } }, select: { id: true } });
    const contracts = await db.employmentContract.findMany({ where: { employeeId: employee.id, status: "ACTIVE", startDate: { lte: date(to) }, OR: [{ endDate: null }, { endDate: { gte: date(from) } }] }, select: { id: true, number: true } });
    return {
      ...base, present, eligible: result.eligibility.eligible, reasonCode: result.eligibility.reasonCode,
      base: result.salary ? Object.fromEntries(INSURANCE_KINDS.map(kind => [kind, result.salary!.perKind[kind].value])) as MonthState["base"] : null,
      contribution, maternity,
      sources: { contracts: contracts.map(row => row.number), unit: result.unit?.orgUnitCode ?? null, unpaidLeaveDays: result.unpaidLeaveDays, missing: result.missing },
    };
  }

  /** Builds list N: this month's changes, plus late changes of finalized months in the lookback window with arrears. */
  private async plan(db: Db, siteOrgUnitId: string, siteId: string, month: string) {
    const lookback = await this.lookback(db, month);
    const window = await db.insuranceChangeList.findMany({ where: { siteOrgUnitId, status: "FINALIZED", month: { gte: shiftMonth(month, -lookback), lt: month } }, orderBy: { month: "asc" }, include: { states: true, items: true } });
    const earliest = window[0]?.month ?? month;
    const span = { from: monthBounds(shiftMonth(earliest, -1)).from, to: monthBounds(month).to };
    const assigned = await db.$queryRaw<{ employee_id: string }[]>`
      SELECT DISTINCT a.employee_id::text AS employee_id FROM org_assignment a JOIN org_unit_version v ON v.org_unit_id = a.org_unit_id
      WHERE v.site_id = ${siteId}::uuid AND a.effective_from <= ${date(span.to)}::date AND (a.effective_to IS NULL OR a.effective_to >= ${date(span.from)}::date)
        AND v.effective_from <= ${date(span.to)}::date AND (v.effective_to IS NULL OR v.effective_to >= ${date(span.from)}::date)`;
    const ids = new Set([...assigned.map(row => row.employee_id), ...window.flatMap(list => list.states.map(state => state.employeeId))]);
    const employees = await db.employee.findMany({ where: { id: { in: [...ids] } }, select: { id: true, hireDate: true, terminationDate: true }, orderBy: { code: "asc" } });
    // Changes already reported for a month: in its own list, or late in a later finalized list.
    const reported = new Set<string>();
    const lateLists = await db.insuranceChangeItem.findMany({ where: { late: true, list: { siteOrgUnitId, status: "FINALIZED" } }, select: { employeeId: true, originMonth: true, changeType: true } });
    for (const list of window) for (const item of list.items) if (!item.late) reported.add(item.employeeId + "|" + list.month + "|" + item.changeType);
    for (const item of lateLists) reported.add(item.employeeId + "|" + item.originMonth + "|" + item.changeType);
    const declared = new Map(window.flatMap(list => list.states.map(state => [list.month + "|" + state.employeeId, this.decrypt<MonthState>(state.stateCipher)] as const)));
    const finalizedMonths = new Set(window.map(list => list.month));

    const states: Array<{ employeeId: string; state: MonthState }> = [];
    const items: PlannedItem[] = [];
    for (const employee of employees) {
      const cache = new Map<string, MonthState>();
      const at = async (value: string) => { if (!cache.has(value)) cache.set(value, await this.state(db, employee, value, siteId)); return cache.get(value)!; };
      for (const list of window) {
        const event = detectChange(await at(shiftMonth(list.month, -1)), await at(list.month));
        if (!event || reported.has(employee.id + "|" + list.month + "|" + event.type)) continue;
        const arrears = [];
        for (let current = list.month; current < month; current = shiftMonth(current, 1)) {
          if (!finalizedMonths.has(current)) continue;
          const owed = arrearsFor(declared.get(current + "|" + employee.id) ?? null, await at(current));
          if (owed) arrears.push(owed);
        }
        items.push({ employeeId: employee.id, event, late: true, originMonth: list.month, arrears });
      }
      const current = await at(month);
      const event = detectChange(await at(shiftMonth(month, -1)), current);
      if (event) items.push({ employeeId: employee.id, event, late: false, originMonth: null, arrears: [] });
      if (current.present || event) states.push({ employeeId: employee.id, state: current });
    }
    const contentHash = createHash("sha256").update(JSON.stringify(items.map(item => [item.employeeId, item.event, item.late, item.originMonth, item.arrears]))).digest("hex");
    return { items, states, contentHash, lookback };
  }

  async generate(user: AuthUser, dto: { siteOrgUnitId: string; month: string }, ip?: string) {
    this.assertMonth(dto.month);
    const result = await this.prisma.$transaction(async db => {
      const { siteId } = await this.site(user, "insurance.manage", dto.siteOrgUnitId, db);
      await db.$queryRaw`SELECT pg_advisory_xact_lock(8210490, hashtext(${dto.siteOrgUnitId + dto.month}))::text AS lock`;
      const existing = await db.insuranceChangeList.findUnique({ where: { siteOrgUnitId_month: { siteOrgUnitId: dto.siteOrgUnitId, month: dto.month } } });
      if (existing?.status === "FINALIZED") fail("conflict", "INSURANCE_LIST_FINALIZED", "Danh sách tháng " + dto.month + " đã chốt; biến động mới sẽ vào danh sách tháng đang mở.");
      const planned = await this.plan(db, dto.siteOrgUnitId, siteId, dto.month);
      const list = existing
        ? await db.insuranceChangeList.update({ where: { id: existing.id }, data: { revision: { increment: 1 }, itemCount: planned.items.length, contentHash: planned.contentHash, generatedAt: new Date(), generatedById: user.id } })
        : await db.insuranceChangeList.create({ data: { siteOrgUnitId: dto.siteOrgUnitId, month: dto.month, itemCount: planned.items.length, contentHash: planned.contentHash, generatedAt: new Date(), generatedById: user.id } });
      await db.insuranceChangeItem.deleteMany({ where: { listId: list.id } });
      await db.insuranceChangeState.deleteMany({ where: { listId: list.id } });
      if (planned.states.length) await db.insuranceChangeState.createMany({ data: planned.states.map(({ employeeId, state }) => ({ listId: list.id, employeeId, eligible: state.eligible, reasonCode: state.reasonCode, stateCipher: this.encrypt(state) })) });
      for (const item of planned.items) await db.insuranceChangeItem.create({ data: {
        listId: list.id, employeeId: item.employeeId, changeType: item.event.type, reasonCode: item.event.reason, effectiveDate: date(item.event.effectiveDate),
        valuesCipher: this.encrypt({ old: item.event.old, new: item.event.new } satisfies ItemValues), late: item.late, originMonth: item.originMonth,
        source: json({ month: item.originMonth ?? dto.month }),
        arrears: { create: item.arrears.map(row => ({ originMonth: row.month, direction: row.direction, detailCipher: this.encrypt(row) })) },
      } });
      await this.audit.record({ actorId: user.id, entityType: "insurance_change_list", entityId: list.id, action: existing ? "REGENERATE" : "GENERATE", result: "SUCCESS",
        newValue: { month: dto.month, revision: list.revision, items: planned.items.length, late: planned.items.filter(item => item.late).length, contentHash: planned.contentHash, scopeOrgUnitId: dto.siteOrgUnitId }, ipAddress: ip }, db);
      return list.id;
    }, { timeout: 120_000 });
    return this.view(user, result);
  }

  /** Finalizing re-plans and requires the reviewed content hash, so a source change since review is refused. */
  async finalize(user: AuthUser, id: string, dto: { revision: number; contentHash: string }, ip?: string) {
    await this.prisma.$transaction(async db => {
      const list = await db.insuranceChangeList.findUnique({ where: { id } });
      if (!list) fail("missing", "NOT_FOUND", "Không tìm thấy danh sách.");
      const { siteId } = await this.site(user, "insurance.manage", list.siteOrgUnitId, db);
      await db.$queryRaw`SELECT pg_advisory_xact_lock(8210490, hashtext(${list.siteOrgUnitId + list.month}))::text AS lock`;
      const current = await db.insuranceChangeList.findUniqueOrThrow({ where: { id } });
      if (current.status === "FINALIZED") fail("conflict", "INSURANCE_LIST_FINALIZED", "Danh sách đã chốt.");
      if (current.revision !== dto.revision || current.contentHash !== dto.contentHash) fail("conflict", "STALE_REVISION", "Danh sách đã thay đổi; tải lại trước khi chốt.");
      const planned = await this.plan(db, list.siteOrgUnitId, siteId, list.month);
      if (planned.contentHash !== current.contentHash) fail("conflict", "INSURANCE_SOURCE_CHANGED", "Dữ liệu nguồn đã thay đổi sau khi lập danh sách; lập lại trước khi chốt.");
      await db.insuranceChangeList.update({ where: { id }, data: { status: "FINALIZED", finalizedAt: new Date(), finalizedById: user.id, revision: { increment: 1 } } });
      await this.audit.record({ actorId: user.id, entityType: "insurance_change_list", entityId: id, action: "FINALIZE", result: "SUCCESS", newValue: { month: list.month, contentHash: current.contentHash, items: current.itemCount, scopeOrgUnitId: list.siteOrgUnitId }, ipAddress: ip }, db);
    }, { timeout: 120_000, isolationLevel: "Serializable" });
    return this.view(user, id);
  }

  async find(user: AuthUser, query: { siteOrgUnitId: string; month: string }) {
    this.assertMonth(query.month);
    await this.site(user, "insurance.read", query.siteOrgUnitId);
    const list = await this.prisma.insuranceChangeList.findUnique({ where: { siteOrgUnitId_month: { siteOrgUnitId: query.siteOrgUnitId, month: query.month } }, select: { id: true } });
    return list ? this.view(user, list.id) : { list: null };
  }

  async view(user: AuthUser, id: string) {
    const list = await this.prisma.insuranceChangeList.findUnique({ where: { id }, include: {
      siteOrgUnit: { select: { code: true } }, generatedBy: { select: { displayName: true } }, finalizedBy: { select: { displayName: true } },
      items: { include: { employee: { select: { id: true, code: true, fullName: true } }, arrears: { orderBy: { originMonth: "asc" } } }, orderBy: [{ late: "asc" }, { changeType: "asc" }, { effectiveDate: "asc" }] },
    } });
    if (!list) fail("missing", "NOT_FOUND", "Không tìm thấy danh sách.");
    await this.site(user, "insurance.read", list.siteOrgUnitId);
    const items = list.items.map(item => {
      const values = this.decrypt<ItemValues>(item.valuesCipher);
      const arrears = item.arrears.map(row => ({ originMonth: row.originMonth, ...this.decrypt<NonNullable<ReturnType<typeof arrearsFor>>>(row.detailCipher) }));
      return { id: item.id, employee: item.employee, changeType: item.changeType, reasonCode: item.reasonCode, reason: REASON_LABELS[item.reasonCode] ?? item.reasonCode,
        effectiveDate: key(item.effectiveDate), late: item.late, originMonth: item.originMonth, old: values.old, new: values.new,
        arrears, arrearsTotal: arrears.reduce((total, row) => total.plus(row.total), new Decimal(0)).toString(), arrearsMonths: arrears.length };
    });
    return { list: { id: list.id, siteOrgUnitId: list.siteOrgUnitId, siteCode: list.siteOrgUnit.code, month: list.month, status: list.status, revision: list.revision, contentHash: list.contentHash,
      itemCount: list.itemCount, generatedAt: list.generatedAt?.toISOString() ?? null, generatedBy: list.generatedBy?.displayName ?? null,
      finalizedAt: list.finalizedAt?.toISOString() ?? null, finalizedBy: list.finalizedBy?.displayName ?? null }, items };
  }

  async export(user: AuthUser, id: string, ip?: string): Promise<{ file: Buffer; name: string }> {
    const { list, items } = await this.view(user, id);
    if (!list) fail("missing", "NOT_FOUND", "Không tìm thấy danh sách.");
    const template = await this.prisma.insuranceFileTemplate.findFirst({ where: { kind: "EXPORT", active: true }, orderBy: [{ code: "asc" }, { version: "desc" }] });
    if (!template) fail("conflict", "INSURANCE_TEMPLATE_MISSING", "Chưa cấu hình mẫu xuất danh sách biến động BH.");
    const identities = await this.prisma.employeeIdentity.findMany({ where: { employeeId: { in: items.map(item => item.employee.id) } }, select: { employeeId: true, siBookCipher: true } });
    const siBooks = new Map(identities.map(row => [row.employeeId, row.siBookCipher ? plainText(this.key, row.siBookCipher, "hồ sơ") : ""]));
    const fields = (item: (typeof items)[number]): Record<string, string | number> => ({
      employeeCode: item.employee.code, fullName: item.employee.fullName, siBook: siBooks.get(item.employee.id) ?? "", changeType: TYPE_LABELS[item.changeType], reason: item.reason,
      effectiveDate: item.effectiveDate, oldBase: item.old.base?.BHXH ?? "", newBase: item.new.base?.BHXH ?? "", late: item.late ? "Có" : "", originMonth: item.originMonth ?? "", arrears: item.arrearsMonths ? item.arrearsTotal : "",
    });
    const columns = template.columns as Array<{ field: string; header: string }>;
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet("Bien dong BH " + list.month);
    for (let row = 1; row < template.headerRow; row++) sheet.addRow([row === 1 ? template.name + " — " + list.siteCode + " tháng " + list.month + (list.status === "DRAFT" ? " (NHÁP)" : "") : ""]);
    sheet.addRow(columns.map(column => column.header));
    for (const item of items) { const values = fields(item); sheet.addRow(columns.map(column => values[column.field] ?? "")); }
    await this.audit.record({ actorId: user.id, entityType: "insurance_change_list", entityId: id, action: "EXPORT", result: "SUCCESS", newValue: { month: list.month, status: list.status, rows: items.length, template: template.code + "@" + template.version, scopeOrgUnitId: list.siteOrgUnitId }, ipAddress: ip });
    return { file: Buffer.from(await book.xlsx.writeBuffer()), name: "bien-dong-bh-" + list.siteCode + "-" + list.month + ".xlsx" };
  }

  /** Decrease preview for a termination (used by contract termination before KT confirms). */
  async terminationPreview(db: Db, employeeId: string, terminationDate: string) {
    const employee = await db.employee.findUniqueOrThrow({ where: { id: employeeId }, select: { id: true, hireDate: true } });
    const month = terminationDate.slice(0, 7);
    const unit = (await this.insurance.compute(db, employeeId, month)).unit;
    if (!unit?.siteId) return null;
    const prev = await this.state(db, { ...employee, terminationDate: null }, shiftMonth(month, -1), unit.siteId);
    const cur = await this.state(db, { ...employee, terminationDate: date(terminationDate) }, month, unit.siteId);
    return detectChange(prev, cur);
  }
}
