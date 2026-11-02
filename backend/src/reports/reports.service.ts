import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { AuditService } from "../audit/audit.service";
import type { AuthUser } from "../auth/auth.types";
import { businessDate } from "../auth/business-date";
import { cipherText, plainText } from "../common/data-crypto";
import { PrismaService } from "../database/prisma.service";
import { effectiveAt, ScopeService } from "../organization/scope.service";
import { attendanceReports } from "./definitions/attendance-reports";
import { payrollReports } from "./definitions/payroll-reports";
import { renderPdf, renderXlsx } from "./report-renderer";
import { key, type Column, type ReportContext, type ReportDefinition, type ReportParams, type ReportResult, type Row, type UnitInfo } from "./report-types";

const MASK = "***";
const PREVIEW_ROWS = 200;
const DEFAULT_ROW_WARNING = 20000;
const STATUS_LABEL = { DRAFT: "Nháp", OFFICIAL: "Chính thức" } as const;
const REGISTRY = new Map<string, ReportDefinition>([...attendanceReports, ...payrollReports].map(definition => [definition.type, definition]));

/**
 * Shared report framework (FR-10.0.1; docs 13 §6): role + permission + scope before any query, exclusions, organization as
 * of the report date, masked sensitive columns (also in files), Draft/Official label, recorded and audited exports.
 */
@Injectable()
export class ReportsService {
  private readonly key: Buffer;
  private readonly logger = new Logger(ReportsService.name);
  constructor(private readonly prisma: PrismaService, private readonly scope: ScopeService, private readonly audit: AuditService, config: ConfigService) {
    this.key = Buffer.from(config.getOrThrow<string>("HR_DATA_KEY"), "base64");
  }

  private allowedFor(user: AuthUser, definition: ReportDefinition) {
    return definition.roles.some(role => user.roles.includes(role)) && user.permissions.includes(definition.permission);
  }

  catalog(user: AuthUser) {
    return { items: [...REGISTRY.values()].filter(definition => this.allowedFor(user, definition)).map(definition => ({ type: definition.type, title: definition.title, group: definition.group, params: definition.params, sensitive: definition.sensitive })) };
  }

  private definition(user: AuthUser, type: string) {
    const definition = REGISTRY.get(type);
    if (!definition) throw new NotFoundException({ code: "REPORT_UNKNOWN", message: "Không có báo cáo " + type + "." });
    if (!this.allowedFor(user, definition)) throw new ForbiddenException({ code: "FORBIDDEN", message: "Vai trò/quyền hiện tại không xem được báo cáo này." });
    return definition;
  }

  private validate(definition: ReportDefinition, params: ReportParams) {
    const need = (ok: boolean, label: string) => { if (!ok) throw new BadRequestException({ code: "REPORT_PARAM_INVALID", message: "Thiếu hoặc sai tham số: " + label + "." }); };
    for (const name of definition.params) {
      if (name === "dateRange") { need(/^\d{4}-\d{2}-\d{2}$/.test(params.dateFrom ?? "") && /^\d{4}-\d{2}-\d{2}$/.test(params.dateTo ?? "") && params.dateFrom! <= params.dateTo!, "khoảng ngày");
        need((Date.parse(params.dateTo!) - Date.parse(params.dateFrom!)) / 86400000 <= 400, "khoảng ngày tối đa 400 ngày"); }
      if (name === "month") need(/^\d{4}-(0[1-9]|1[0-2])$/.test(params.month ?? ""), "tháng");
      if (name === "year") need(/^\d{4}$/.test(params.year ?? ""), "năm");
    }
  }

  /** Builds the context: everything a definition sees is already limited to the user's scope. */
  private async context(user: AuthUser, definition: ReportDefinition, params: ReportParams, db: Prisma.TransactionClient = this.prisma): Promise<ReportContext> {
    this.validate(definition, params);
    const scope = await this.scope.load(user, definition.permission, db);
    const base = { user, db, params, allowed: scope.allowed, key: this.key };
    if (params.orgUnitId && !scope.allowed.has(params.orgUnitId)) throw new ForbiddenException({ code: "OUT_OF_SCOPE", message: "Đơn vị nằm ngoài phạm vi được phân quyền." });
    const asOf = await definition.asOf(base);
    const versions = await db.orgUnitVersion.findMany({ where: effectiveAt(asOf), include: { orgUnit: { select: { code: true } } } });
    const units = new Map<string, UnitInfo>(versions.map(version => [version.orgUnitId, { id: version.orgUnitId, code: version.orgUnit.code, name: version.name, type: version.type, parentId: version.parentId, costCenterCode: version.costCenterCode, accountingAccount: version.accountingAccount, siteId: version.siteId }]));
    const within = (unitId: string, rootId: string) => { for (let current: string | null | undefined = unitId, guard = 0; current && guard < 20; current = units.get(current)?.parentId, guard++) if (current === rootId) return true; return false; };
    const employees: ReportContext["employees"] = async (at, extra = {}) => {
      const rows = await db.employee.findMany({ where: { AND: [extra, { assignments: { some: { isPrimary: true, orgUnitId: { in: [...scope.allowed] }, ...effectiveAt(at) } } }, { exclusions: { none: { userAccountId: user.id, OR: [effectiveAt(at), effectiveAt(businessDate())] } } }] },
        select: { id: true, code: true, fullName: true, assignments: { where: { isPrimary: true, ...effectiveAt(at) }, select: { orgUnitId: true } } }, orderBy: { code: "asc" } });
      return rows.map(row => ({ id: row.id, code: row.code, fullName: row.fullName, orgUnitId: row.assignments[0]?.orgUnitId ?? "" })).filter(row => scope.allowed.has(row.orgUnitId) && (!params.orgUnitId || within(row.orgUnitId, params.orgUnitId)));
    };
    return { ...base, asOf, units, within, employees };
  }

  /** Masks salary/personal columns the viewer may not read; hidden `_` keys stay only in previews (drill-down ids). */
  private mask(user: AuthUser, columns: Column[], rows: Row[]) {
    const hidden = columns.filter(column => (column.sensitive === "salary" && !user.permissions.includes("payroll.read")) || (column.sensitive === "personal" && !user.permissions.includes("employee.sensitive.read"))).map(column => column.key);
    if (!hidden.length) return rows;
    return rows.map(row => ({ ...row, ...Object.fromEntries(hidden.map(name => [name, row[name] === null || row[name] === undefined || row[name] === "" ? row[name] : MASK])) }));
  }

  private async threshold() {
    const row = await this.prisma.legalParameter.findFirst({ where: { paramCode: "REPORT_ROW_WARNING_THRESHOLD", scopeKey: "GLOBAL", ...effectiveAt(businessDate()) }, orderBy: { effectiveFrom: "desc" } });
    return Number(row?.value ?? DEFAULT_ROW_WARNING);
  }

  private async execute(user: AuthUser, type: string, params: ReportParams) {
    const definition = this.definition(user, type);
    const ctx = await this.context(user, definition, params);
    const result: ReportResult = await definition.run(ctx);
    return { definition, result: { ...result, rows: this.mask(user, result.columns, result.rows) } };
  }

  async preview(user: AuthUser, type: string, params: ReportParams) {
    const { definition, result } = await this.execute(user, type, params);
    const threshold = await this.threshold();
    return { type, title: definition.title, status: result.status, statusLabel: STATUS_LABEL[result.status], source: result.source, sourceHash: result.sourceHash ?? null, periodLabel: result.periodLabel,
      columns: result.columns, rows: result.rows.slice(0, PREVIEW_ROWS), total: result.rows.length, truncated: result.rows.length > PREVIEW_ROWS, rowWarning: result.rows.length > threshold, notes: result.notes ?? [] };
  }

  /** Export runs in the background; the client polls the run. Permission is checked again before the file is built. */
  async export(user: AuthUser, type: string, params: ReportParams, format: "XLSX" | "PDF", ip?: string) {
    const definition = this.definition(user, type);
    this.validate(definition, params);
    await this.context(user, definition, params);
    const run = await this.prisma.reportRun.create({ data: { reportType: type, params: params as Prisma.InputJsonValue, format, requestedById: user.id } });
    void this.render(user, run.id, type, params, format, ip);
    return { run: this.runView(run) };
  }

  private async render(user: AuthUser, runId: string, type: string, params: ReportParams, format: "XLSX" | "PDF", ip?: string) {
    const started = Date.now();
    try {
      const { definition, result } = await this.execute(user, type, params);
      const threshold = await this.threshold();
      const rowWarning = result.rows.length > threshold;
      if (rowWarning) this.logger.warn("Report " + type + " exported " + result.rows.length + " rows (> " + threshold + ")");
      const exportedAt = new Date().toISOString();
      const input = { title: definition.title, columns: result.columns, rows: result.rows,
        header: ["Trạng thái dữ liệu: " + STATUS_LABEL[result.status], "Kỳ: " + result.periodLabel, "Nguồn: " + result.source + (result.sourceHash ? " · mã băm " + result.sourceHash : ""), "Xuất lúc " + exportedAt + " bởi " + user.username + " (" + user.displayName + ")", ...(rowWarning ? ["Cảnh báo: " + result.rows.length + " dòng, vượt ngưỡng " + threshold + "."] : [])],
        notes: result.notes ?? [] };
      const file = format === "PDF" ? await renderPdf(input) : await renderXlsx(input);
      const fileName = type.toLowerCase() + "-" + key(new Date()) + (format === "PDF" ? ".pdf" : ".xlsx");
      const sha = createHash("sha256").update(file).digest("hex");
      await this.prisma.reportRun.update({ where: { id: runId }, data: { status: "COMPLETED", dataStatus: result.status, source: result.source.slice(0, 500), sourceHash: result.sourceHash ?? null, rowCount: result.rows.length, rowWarning,
        fileName, fileSha256: sha, fileCipher: cipherText(this.key, file.toString("base64")), finishedAt: new Date(), durationMs: Date.now() - started } });
      if (definition.sensitive) await this.audit.record({ actorId: user.id, entityType: "report_run", entityId: runId, action: "EXPORT", result: "SUCCESS",
        newValue: { type, params: params as Prisma.InputJsonValue, format, rows: result.rows.length, dataStatus: result.status, fileSha256: sha, ...(params.orgUnitId ? { scopeOrgUnitId: params.orgUnitId } : {}) }, ipAddress: ip });
    } catch (error) {
      const message = error instanceof Error ? (error as Error & { response?: { message?: string } }).response?.message ?? error.message : String(error);
      this.logger.error("Report " + type + " failed: " + message);
      await this.prisma.reportRun.update({ where: { id: runId }, data: { status: "FAILED", failure: message.slice(0, 2000), finishedAt: new Date(), durationMs: Date.now() - started } }).catch(() => undefined);
    }
  }

  private runView(row: { id: string; reportType: string; params: Prisma.JsonValue; format: string; status: string; dataStatus: string | null; rowCount: number | null; rowWarning: boolean; fileName: string | null; failure: string | null; durationMs: number | null; requestedAt: Date; finishedAt: Date | null }) {
    return { id: row.id, type: row.reportType, title: REGISTRY.get(row.reportType)?.title ?? row.reportType, params: row.params, format: row.format, status: row.status, dataStatus: row.dataStatus,
      statusLabel: row.dataStatus ? STATUS_LABEL[row.dataStatus as "DRAFT"] : null, rowCount: row.rowCount, rowWarning: row.rowWarning, fileName: row.fileName, failure: row.failure, durationMs: row.durationMs,
      requestedAt: row.requestedAt.toISOString(), finishedAt: row.finishedAt?.toISOString() ?? null };
  }

  async runs(user: AuthUser) {
    const rows = await this.prisma.reportRun.findMany({ where: { requestedById: user.id }, orderBy: { requestedAt: "desc" }, take: 50, select: { id: true, reportType: true, params: true, format: true, status: true, dataStatus: true, rowCount: true, rowWarning: true, fileName: true, failure: true, durationMs: true, requestedAt: true, finishedAt: true } });
    return { items: rows.map(row => this.runView(row)) };
  }

  async run(user: AuthUser, id: string) {
    const row = await this.prisma.reportRun.findFirst({ where: { id, requestedById: user.id } });
    if (!row) throw new NotFoundException({ code: "NOT_FOUND", message: "Không tìm thấy lần kết xuất." });
    return { run: this.runView(row) };
  }

  /** Only the requester downloads, and only while the report is still allowed for them. */
  async download(user: AuthUser, id: string) {
    const row = await this.prisma.reportRun.findFirst({ where: { id, requestedById: user.id } });
    if (!row || row.status !== "COMPLETED" || !row.fileCipher) throw new NotFoundException({ code: "NOT_READY", message: "Tệp chưa sẵn sàng." });
    this.definition(user, row.reportType);
    return { file: Buffer.from(plainText(this.key, row.fileCipher, "báo cáo"), "base64"), fileName: row.fileName!, format: row.format };
  }
}
