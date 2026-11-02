import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { FormulaRoundingMode, PayrollConfigurationKind, PayrollPriceType, PolicyStatus, Prisma } from "@prisma/client";
import Decimal from "decimal.js";
import { createHash } from "node:crypto";
import { canonicalJson } from "../audit/audit.service";
import type { AuthUser } from "../auth/auth.types";
import { businessDate } from "../auth/business-date";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { effectiveAt } from "../organization/scope.service";
import { SalaryComponentsService } from "../salary-components/salary-components.service";
import { compileFormula, decimalValue, roundFormula } from "./formula-engine";
import { CreatePayrollConfigurationDto, CreatePayrollConfigurationVersionDto, FormulaVariableDto, PayrollConfigurationDetailQueryDto, PayrollConfigurationQueryDto, PayrollConfigurationVersionDto, PreviewContextQueryDto, PreviewPayrollConfigurationDto } from "./payroll-configuration.dto";
type Db = Prisma.TransactionClient;
type Variable = {
    symbol: string;
    source: "INPUT" | "PARAMETER" | "PRICE" | "FORMULA";
    reference: string;
    unit: string;
    min?: string;
    max?: string;
};
type Version = Prisma.PayrollConfigurationVersionGetPayload<{
    include: {
        createdBy: {
            select: {
                id: true;
                displayName: true;
            };
        };
        component: true;
    };
}>;
type PreviewResult = {
    versionId: string;
    rawValue: string;
    value: string;
    [key: string]: unknown;
};
type PreviewTrace = {
    symbol: string;
    source: Variable["source"];
    reference: string;
    unit: string;
    value: string;
    versionId?: string;
};
type BindingDependency = {
    source: "FORMULA" | "PRICE" | "PARAMETER";
    code: string;
    sourceId: string;
    versionId: string;
    unit: string;
    active: boolean;
    status: string | null;
    effectiveFrom: string;
    effectiveTo: string | null;
    metadata: Record<string, unknown>;
};
type ParameterBinding = {
    id: string;
    paramCode: string;
    scopeKey: string;
    subjectType: string;
    applicationBasis: string;
    value: Prisma.JsonValue;
    unit: string;
    effectiveFrom: Date;
    effectiveTo: Date | null;
};
type ResolvedSource = {
    header: Header;
    version: Version;
};
type ResolvedSources = {
    headers: Header[];
    resolve: (kind: PayrollConfigurationKind, requestedCode: string) => ResolvedSource;
    component: (id: string) => void;
    parameter: (reference: string) => { value: Decimal; unit: string; id: string; row: ParameterBinding };
};
type Header = Prisma.PayrollConfigurationGetPayload<{
    include: typeof INCLUDE;
}>;
const DAY = 86400000, OPEN = new Date("9999-12-31T00:00:00.000Z");
const INCLUDE = { orgUnit: true, versions: { include: { createdBy: { select: { id: true, displayName: true } }, component: true }, orderBy: { effectiveFrom: "desc" as const } } } satisfies Prisma.PayrollConfigurationInclude;
const code = /^[A-Z][A-Z0-9_]{0,79}$/;
function dateText(value: Date) { return value.toISOString().slice(0, 10); }
function date(value: string) { const result = new Date(value + "T00:00:00.000Z"); if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(result.getTime()) || dateText(result) !== value || value < "1900-01-01")
    throw new BadRequestException("Ngày hiệu lực không hợp lệ hoặc trước năm 1900."); return result; }
function active<T extends {
    effectiveFrom: Date;
    effectiveTo: Date | null;
}>(rows: T[], at: Date) { return rows.find(row => row.effectiveFrom <= at && (!row.effectiveTo || row.effectiveTo >= at)); }
function text(value: Decimal) { return value.toFixed(); }
function decimal(raw: string, label: string) { try {
    const result = decimalValue(raw, label);
    if (result.decimalPlaces() > 6 || result.abs().gte("100000000000000000000000000000000"))
        throw new Error();
    return result;
}
catch {
    throw new BadRequestException(`${label} phải là số thập phân tối đa 26 chữ số và 6 chữ số lẻ.`);
} }
@Injectable()
export class PayrollConfigurationService {
    constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly components: SalaryComponentsService) { }
    private read<T>(work: (db: Db) => Promise<T>) { return this.prisma.$transaction(work, { isolationLevel: "RepeatableRead", timeout: 30000 }); }
    private write<T>(work: (db: Db) => Promise<T>) { return this.prisma.$transaction(async (db) => { await db.$queryRaw `SELECT pg_advisory_xact_lock(8210500)::text`; await db.$queryRaw `SELECT pg_advisory_xact_lock(8210473)::text`; await db.$queryRaw `SELECT pg_advisory_xact_lock(8210522)::text`; return work(db); }, { isolationLevel: "Serializable", timeout: 60000 }); }
    private range(dto: PayrollConfigurationVersionDto) { const from = date(dto.effectiveFrom), to = dto.effectiveTo ? date(dto.effectiveTo) : null; if (to && to < from)
        throw new BadRequestException("Ngày kết thúc phải từ ngày bắt đầu hiệu lực trở đi."); return { from, to }; }
    private variables(dto: PayrollConfigurationVersionDto) {
        const rows = (dto.variables ?? []).map(row => ({ ...row, symbol: row.symbol.trim(), reference: row.reference.trim(), unit: row.unit.trim(), min: row.min?.trim(), max: row.max?.trim() })) as Variable[];
        const seen = new Set<string>();
        for (const row of rows) {
            if (!seen.add(row.symbol))
                throw new BadRequestException("Ký hiệu biến không được trùng.");
            if ((row.min && !row.min.match(/^-?(?:0|[1-9]\d*)(?:\.\d{1,6})?$/)) || (row.max && !row.max.match(/^-?(?:0|[1-9]\d*)(?:\.\d{1,6})?$/)))
                throw new BadRequestException("Cận biến không hợp lệ.");
            if (row.min && row.max && decimal(row.min, "Cận dưới").gt(decimal(row.max, "Cận trên")))
                throw new BadRequestException("Cận dưới không được lớn hơn cận trên.");
        }
        return rows;
    }
    private storedVariables(value: Prisma.JsonValue | null): Variable[] {
        if (!Array.isArray(value))
            throw new BadRequestException("Biến công thức đã lưu không hợp lệ.");
        const rows: Variable[] = [];
        for (const candidate of value) {
            if (!candidate || typeof candidate !== "object" || Array.isArray(candidate) || !("symbol" in candidate) || !("source" in candidate) || !("reference" in candidate) || !("unit" in candidate))
                throw new BadRequestException("Biến công thức đã lưu không hợp lệ.");
            const { symbol, source, reference, unit, min, max } = candidate;
            if (typeof symbol !== "string" || typeof reference !== "string" || typeof unit !== "string" || typeof source !== "string" || (source !== "INPUT" && source !== "PARAMETER" && source !== "PRICE" && source !== "FORMULA") || (min != null && typeof min !== "string") || (max != null && typeof max !== "string"))
                throw new BadRequestException("Biến công thức đã lưu không hợp lệ.");
            rows.push({ symbol, source, reference, unit, ...(typeof min === "string" ? { min } : {}), ...(typeof max === "string" ? { max } : {}) });
        }
        return rows;
    }
    private validateShape(kind: PayrollConfigurationKind, dto: PayrollConfigurationVersionDto) {
        if (kind === "PRICE") {
            if (!dto.priceType || dto.amount == null || dto.componentId || dto.expression || dto.variables || dto.roundingMode || dto.roundingScale != null)
                throw new BadRequestException("Giá phải khai báo loại giá và số tiền; không được chứa công thức.");
            const amount = decimal(dto.amount, "Số tiền");
            if (amount.lt(0) || amount.decimalPlaces() > 6 || amount.e >= 20)
                throw new BadRequestException("Số tiền phải là số không âm trong miền numeric(26,6).");
            if (dto.priceType === "COMMISSION" && (amount.gt(100) || dto.unit.trim() !== "%"))
                throw new BadRequestException("Hoa hồng phải là phần trăm từ 0 đến 100.");
            if (dto.priceType === "PRODUCT" && !dto.productCode)
                throw new BadRequestException("Giá sản phẩm phải có mã sản phẩm.");
            if (dto.priceType === "PIECEWORK" && !dto.operationCode && !dto.productCode)
                throw new BadRequestException("Giá theo công đoạn phải có nguồn gốc sản phẩm hoặc công đoạn.");
            return;
        }
        if (!dto.componentId || !dto.expression || !dto.variables || !dto.roundingMode || dto.roundingScale == null || dto.priceType || dto.amount != null || dto.productCode || dto.operationCode)
            throw new BadRequestException("Công thức phải khai báo cấu phần, biểu thức, biến và làm tròn.");
        const variables = this.variables(dto);
        const compiled = compileFormula(dto.expression.trim(), variables.map(row => row.symbol));
        if (compiled.symbols.length !== variables.length)
            throw new BadRequestException("Mọi biến khai báo phải được dùng đúng một lần trong biểu thức.");
    }
    private versionView(version: Version) { return { id: version.id, name: version.name, unit: version.unit, active: version.active, status: version.status, decisionReference: version.decisionReference, reason: version.reason, effectiveFrom: dateText(version.effectiveFrom), effectiveTo: version.effectiveTo ? dateText(version.effectiveTo) : null, createdAt: version.createdAt.toISOString(), createdBy: version.createdBy, ...(version.priceType ? { priceType: version.priceType, amount: version.amount!.toFixed(6), ...(version.productCode ? { productCode: version.productCode } : {}), ...(version.operationCode ? { operationCode: version.operationCode } : {}) } : { componentId: version.componentId, expression: version.expression, variables: version.variables, roundingMode: version.roundingMode, roundingScale: version.roundingScale }) }; }
    private view(header: Header, asOf: Date, name: string, canManage: boolean) { const version = active(header.versions, asOf); return { id: header.id, kind: header.kind, code: header.code, orgUnitId: header.orgUnitId, orgUnitCode: header.orgUnit.code, orgUnitName: name, revision: header.revision, canManage, activeVersion: version ? this.versionView(version) : null, versions: header.versions.map(row => this.versionView(row)) }; }
    private async scopes(user: AuthUser, asOf: Date, db: Db) { return this.components.readScopes(user, asOf, db); }
    private async unitAt(id: string, at: Date, db: Db) { const row = await db.orgUnitVersion.findFirst({ where: { orgUnitId: id, ...effectiveAt(at) }, include: { orgUnit: true } }); if (!row || !["COMPANY", "SITE"].includes(row.type))
        throw new BadRequestException("Chỉ được cấu hình tại công ty hoặc cơ sở."); return row; }
    private async targetScopes(orgUnitId: string, at: Date, db: Db) {
        const rows = await db.orgUnitVersion.findMany({ where: effectiveAt(at), include: { orgUnit: true } });
        const byId = new Map(rows.map(row => [row.orgUnitId, row]));
        const target = byId.get(orgUnitId);
        if (!target || !["COMPANY", "SITE"].includes(target.type))
            throw new BadRequestException("Đơn vị đích phải là công ty hoặc cơ sở.");
        let current: typeof target | undefined = target, company: typeof target | undefined = target.type === "COMPANY" ? target : undefined;
        const visited = new Set<string>();
        while (!company && current?.parentId && !visited.has(current.parentId)) {
            visited.add(current.parentId);
            current = byId.get(current.parentId);
            if (current?.type === "COMPANY")
                company = current;
        }
        if (!company)
            throw new BadRequestException("Không xác định được công ty chủ quản.");
        return { target, company, rows, byId };
    }
    private async sources(db: Db, orgUnitId: string, at: Date): Promise<ResolvedSources> {
        const { target, company } = await this.targetScopes(orgUnitId, at, db);
        const scopeIds = target.orgUnitId === company.orgUnitId ? [company.orgUnitId] : [target.orgUnitId, company.orgUnitId];
        const site = target.siteId ? await db.site.findUnique({ where: { id: target.siteId } }) : null;
        const parameterScopes = target.type === "COMPANY" ? ["GLOBAL"] : ["SITE:" + (target.siteId ?? ""), "REGION:" + (site?.wageRegionCode ?? ""), "GLOBAL"];
        const [headers, components, parameters] = await Promise.all([
            db.payrollConfiguration.findMany({ where: { orgUnitId: { in: scopeIds } }, include: INCLUDE }),
            db.salaryComponentVersion.findMany({ where: { component: { orgUnitId: { in: scopeIds } }, active: true, ...effectiveAt(at) }, select: { componentId: true } }),
            db.legalParameter.findMany({ where: { scopeKey: { in: parameterScopes }, subjectType: "ALL", applicationBasis: "WORK_DATE", ...effectiveAt(at) } }),
        ]);
        const activeComponents = new Set(components.map(row => row.componentId));
        const selected = new Map<string, Header>();
        // A future local override must not change historical company resolution.
        // Once started, an inactive version or gap blocks fallback to the company.
        for (const scopeId of scopeIds) for (const header of headers) {
            const key = header.kind + ":" + header.code;
            if (header.orgUnitId === scopeId && header.versions.some(version => version.effectiveFrom <= at) && !selected.has(key)) selected.set(key, header);
        }
        return {
            headers: [...selected.values()],
            resolve: (kind: PayrollConfigurationKind, requestedCode: string) => {
                const header = selected.get(kind + ":" + requestedCode);
                const version = header && active(header.versions, at);
                if (!header || !version?.active) throw new BadRequestException(
                    "Nguồn " + requestedCode + " không có phiên bản hiệu lực hoạt động tại đơn vị và ngày chọn.");
                return { header, version };
            },
            component: (id: string) => {
                if (!activeComponents.has(id)) throw new BadRequestException("Cấu phần lương ràng buộc không có hiệu lực trong phạm vi đơn vị.");
            },
            parameter: (reference: string) => {
                const row = parameterScopes.map(scopeKey => parameters.find(item => item.paramCode === reference && item.scopeKey === scopeKey)).find(Boolean);
                if (!row) throw new BadRequestException("Không tìm thấy tham số pháp lý " + reference + " theo ngày làm việc.");
                const raw = typeof row.value === "string" ? row.value : typeof row.value === "number" ? String(row.value) : null;
                if (raw === null) throw new BadRequestException("Tham số " + reference + " không phải giá trị số.");
                return { value: decimal(raw, "Tham số " + reference), unit: row.unit, id: row.id, row };
            },
        };
    }
    private async validateAffected(db: Db, changedOrgUnitId: string, from: Date) {
        const changed = await this.targetScopes(changedOrgUnitId, from, db);
        const overlap = { OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }] };
        const select = { effectiveFrom: true, effectiveTo: true };
        const [organizations, configurations, components, parameters] = await Promise.all([
            db.orgUnitVersion.findMany({ where: overlap }),
            db.payrollConfigurationVersion.findMany({ where: overlap, select }),
            db.salaryComponentVersion.findMany({ where: overlap, select }),
            db.legalParameter.findMany({ where: overlap, select }),
        ]);
        const boundaries = new Set<number>([from.getTime()]);
        for (const row of [...organizations, ...configurations, ...components, ...parameters]) {
            if (row.effectiveFrom >= from && row.effectiveFrom <= OPEN) boundaries.add(row.effectiveFrom.getTime());
            if (row.effectiveTo && row.effectiveTo >= from && row.effectiveTo < OPEN) boundaries.add(row.effectiveTo.getTime() + DAY);
        }
        // Validate each constant-resolution interval, including expiry + 1 and
        // inactive successors, for the company and all inheriting site targets.
        for (const timestamp of [...boundaries].sort((a, b) => a - b)) {
            const at = new Date(timestamp);
            for (const target of organizations.filter(row => ["COMPANY", "SITE"].includes(row.type) && row.effectiveFrom <= at && (!row.effectiveTo || row.effectiveTo >= at))) {
                if (changed.target.type === "SITE" && target.orgUnitId !== changedOrgUnitId) continue;
                const current = await this.targetScopes(target.orgUnitId, at, db);
                if (changed.target.type === "COMPANY" && current.company.orgUnitId !== changed.company.orgUnitId) continue;
                const sources = await this.sources(db, target.orgUnitId, at);
                for (const header of sources.headers) {
                    if (header.kind !== "FORMULA" || !active(header.versions, at)?.active) continue;
                    this.closure(sources, header.code, null);
                }
            }
        }
    }
    private data(dto: PayrollConfigurationVersionDto, kind: PayrollConfigurationKind, from: Date, to: Date | null, userId: string): Prisma.PayrollConfigurationVersionUncheckedCreateWithoutConfigurationInput {
        const common = { name: dto.name.trim(), unit: dto.unit.trim(), active: dto.active, status: dto.status, decisionReference: dto.decisionReference.trim(), reason: dto.reason.trim(), effectiveFrom: from, effectiveTo: to, createdById: userId };
        if (kind === "PRICE")
            return { ...common, priceType: dto.priceType!, amount: decimal(dto.amount!, "Số tiền").toFixed(6), productCode: dto.productCode?.trim() || null, operationCode: dto.operationCode?.trim() || null };
        return { ...common, componentId: dto.componentId!, expression: dto.expression!.trim(), variables: this.variables(dto) as Prisma.InputJsonValue, roundingMode: dto.roundingMode!, roundingScale: dto.roundingScale! };
    }
    context(user: AuthUser) { return this.read(async (db) => { const asOf = businessDate(), scopes = await this.scopes(user, asOf, db), units = scopes.current.versions.filter(row => scopes.visible.has(row.orgUnitId) && ["COMPANY", "SITE"].includes(row.type)).map(row => ({ id: row.orgUnitId, code: row.orgUnit.code, name: row.name, type: row.type, parentId: row.parentId })); const managementUnits = scopes.management?.versions.filter(row => scopes.management!.allowed.has(row.orgUnitId) && ["COMPANY", "SITE"].includes(row.type)).map(row => ({ id: row.orgUnitId, code: row.orgUnit.code, name: row.name, type: row.type, parentId: row.parentId })) ?? []; return { asOf: dateText(asOf), minimumSuccessorDate: dateText(new Date(asOf.getTime() + DAY)), units, managementUnits }; }); }
    list(user: AuthUser, query: PayrollConfigurationQueryDto) { const asOf = query.asOf ? date(query.asOf) : businessDate(); return this.read(async (db) => { const scopes = await this.scopes(user, asOf, db); if (query.orgUnitId && !scopes.visible.has(query.orgUnitId))
        throw new NotFoundException("Không tìm thấy đơn vị trong phạm vi được cấp."); const search = query.search?.trim(); const rows = await db.payrollConfiguration.findMany({ where: { kind: query.kind, orgUnitId: { in: query.orgUnitId ? [query.orgUnitId] : [...scopes.visible] }, ...(search ? { OR: [{ code: { contains: search, mode: "insensitive" } }, { versions: { some: { name: { contains: search, mode: "insensitive" } } } }] } : {}) }, include: INCLUDE, orderBy: [{ orgUnit: { code: "asc" } }, { code: "asc" }] }); const names = new Map(scopes.dated.versions.map(row => [row.orgUnitId, row.name])); return { asOf: dateText(asOf), items: rows.map(row => this.view(row, asOf, names.get(row.orgUnitId) ?? row.orgUnit.code, scopes.management?.allowed.has(row.orgUnitId) ?? false)) }; }); }
    detail(user: AuthUser, id: string, query: PayrollConfigurationDetailQueryDto) { const asOf = query.asOf ? date(query.asOf) : businessDate(); return this.read(async (db) => { const scopes = await this.scopes(user, asOf, db), row = await db.payrollConfiguration.findUnique({ where: { id }, include: INCLUDE }); if (!row || !scopes.visible.has(row.orgUnitId))
        throw new NotFoundException("Không tìm thấy cấu hình lương."); return { item: this.view(row, asOf, scopes.dated.versions.find(unit => unit.orgUnitId === row.orgUnitId)?.name ?? row.orgUnit.code, scopes.management?.allowed.has(row.orgUnitId) ?? false) }; }); }
    create(user: AuthUser, dto: CreatePayrollConfigurationDto, ipAddress?: string) {
        this.validateShape(dto.kind, dto);
        const { from, to } = this.range(dto);
        return this.write(async db => {
            await this.components.assertWritable(user, dto.orgUnitId, from, to ?? OPEN, db);
            await this.unitAt(dto.orgUnitId, from, db);
            if (await db.payrollConfiguration.findUnique({ where: { orgUnitId_kind_code: { orgUnitId: dto.orgUnitId, kind: dto.kind, code: dto.code } } })) throw new ConflictException("Mã cấu hình đã tồn tại tại đơn vị này.");
            const row = await db.payrollConfiguration.create({ data: { orgUnitId: dto.orgUnitId, kind: dto.kind, code: dto.code, versions: { create: this.data(dto, dto.kind, from, to, user.id) } }, include: INCLUDE });
            await this.validateAffected(db, dto.orgUnitId, from);
            const item = this.view(row, businessDate(), row.orgUnit.code, true);
            await this.audit.record({ actorId: user.id, entityType: "payroll_configuration", entityId: row.id, action: "CREATE", result: "SUCCESS", newValue: { item }, ipAddress }, db);
            return { item };
        });
    }
    async employeePlanCatalogue(db: Db, orgUnitId: string, at: Date) {
        const { target, company } = await this.targetScopes(orgUnitId, at, db);
        const sources = await this.sources(db, orgUnitId, at);
        const rows = await db.salaryComponent.findMany({
            where: { orgUnitId: { in: [target.orgUnitId, company.orgUnitId] } },
            include: { versions: { where: { active: true, ...effectiveAt(at) } } },
            orderBy: { code: "asc" },
        });
        const components = rows.flatMap(row => row.versions.map(version => ({ id: row.id, code: row.code, name: version.name, componentType: version.componentType })));
        const componentIds = new Set(components.map(row => row.id));
        const formulae = sources.headers.flatMap(header => {
            const version = active(header.versions, at);
            return header.kind === "FORMULA" && version?.active && version.unit === "VND" && componentIds.has(version.componentId!)
                ? [{ code: header.code, name: version.name, componentId: version.componentId! }] : [];
        });
        return { components, formulae };
    }
    async assertComponentBinding(db: Db, orgUnitId: string, at: Date, componentId: string) {
        (await this.sources(db, orgUnitId, at)).component(componentId);
    }
    private async componentBinding(db: Db, at: Date, componentId: string, requireConfirmed: boolean, sources: ResolvedSources) {
        sources.component(componentId);
        const version = await db.salaryComponentVersion.findFirst({
            where: { componentId, ...effectiveAt(at) },
            select: { id: true, componentId: true, name: true, componentType: true, active: true, status: true, effectiveFrom: true, effectiveTo: true },
        });
        if (!version?.active || (requireConfirmed && version.status === "SIMULATION"))
            throw new BadRequestException("Cấu phần lương không có hiệu lực hoặc không đủ trạng thái xác nhận.");
        return {
            componentId: version.componentId,
            versionId: version.id,
            name: version.name,
            componentType: version.componentType,
            unit: "VND",
            active: version.active,
            status: version.status,
            effectiveFrom: dateText(version.effectiveFrom),
            effectiveTo: version.effectiveTo ? dateText(version.effectiveTo) : null,
        };
    }
    async resolveInputComponent(db: Db, siteOrgUnitId: string, at: Date, componentId: string, requireConfirmed: boolean) {
        const sources = await this.sources(db, siteOrgUnitId, at);
        return this.componentBinding(db, at, componentId, requireConfirmed, sources);
    }
    async bindingBoundaries(db: Db, siteOrgUnitId: string, from: Date, to: Date): Promise<Date[]> {
        if (to < from) throw new BadRequestException("Khoảng ngày ràng buộc không hợp lệ.");
        await this.targetScopes(siteOrgUnitId, from, db);
        await this.targetScopes(siteOrgUnitId, to, db);
        const overlap = { effectiveFrom: { lte: to }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }] };
        const [organizations, configurations, components, parameters] = await Promise.all([
            db.orgUnitVersion.findMany({ where: overlap, select: { effectiveFrom: true, effectiveTo: true } }),
            db.payrollConfigurationVersion.findMany({ where: overlap, select: { effectiveFrom: true, effectiveTo: true } }),
            db.salaryComponentVersion.findMany({ where: overlap, select: { effectiveFrom: true, effectiveTo: true } }),
            db.legalParameter.findMany({ where: overlap, select: { effectiveFrom: true, effectiveTo: true } }),
        ]);
        const boundaries = new Map<string, Date>([[dateText(from), from], [dateText(to), to]]);
        for (const row of [...organizations, ...configurations, ...components, ...parameters]) {
            if (row.effectiveFrom >= from && row.effectiveFrom <= to) boundaries.set(dateText(row.effectiveFrom), row.effectiveFrom);
            if (row.effectiveTo) {
                const after = new Date(row.effectiveTo.getTime() + DAY);
                if (after >= from && after <= to) boundaries.set(dateText(after), after);
            }
        }
        return [...boundaries.values()].sort((a, b) => a.getTime() - b.getTime());
    }
    /** Reuses the dated configuration resolver for employee-plan formula bindings. */
    private async assertFormulaBindingWithSources(db: Db, at: Date, sources: ResolvedSources, formulaCode: string, componentId: string, requireConfirmed: boolean, validateClosure: boolean): Promise<string[]> {
        const visited = new Set<string>();
        const codes = new Set<string>();
        const visit = async (source: ResolvedSource): Promise<void> => {
            if (visited.has(source.version.id)) return;
            visited.add(source.version.id);
            if (requireConfirmed && source.version.status === "SIMULATION") throw new BadRequestException("Kế hoạch đã xác nhận không được phụ thuộc cấu hình mô phỏng.");
            if (source.header.kind !== "FORMULA") return;
            codes.add(source.header.code);
            await this.componentBinding(db, at, source.version.componentId!, requireConfirmed, sources);
            for (const variable of this.storedVariables(source.version.variables)) {
                if (variable.source === "INPUT") continue;
                if (variable.source === "PARAMETER") { sources.parameter(variable.reference); continue; }
                await visit(sources.resolve(variable.source, variable.reference));
            }
        };
        const root = sources.resolve("FORMULA", formulaCode);
        if (root.version.componentId !== componentId) throw new BadRequestException("Công thức không được gắn với cấu phần của dòng phương án.");
        if (root.version.unit !== "VND") throw new BadRequestException("Công thức chi trả phải có đơn vị đầu ra VND.");
        await visit(root);
        if (validateClosure) this.closure(sources, formulaCode, null);
        return [...codes];
    }
    async assertFormulaBinding(db: Db, orgUnitId: string, at: Date, formulaCode: string, componentId: string, requireConfirmed: boolean): Promise<string[]> {
        const sources = await this.sources(db, orgUnitId, at);
        return this.assertFormulaBindingWithSources(db, at, sources, formulaCode, componentId, requireConfirmed, true);
    }
    /** Resolves the dated formula closure used by configuration preview into a pinned payroll input snapshot. */
    async resolveInputBinding(db: Db, orgUnitId: string, at: Date, formulaCode: string, componentId: string, inputs: Array<{ code: string; unit: string; value: string }>, requireConfirmed: boolean) {
        const sources = await this.sources(db, orgUnitId, at);
        await this.assertFormulaBindingWithSources(db, at, sources, formulaCode, componentId, requireConfirmed, false);
        const component = await this.componentBinding(db, at, componentId, requireConfirmed, sources);
        const supplied = new Map<string, { unit: string; value: Decimal }>();
        for (const row of inputs) {
            if (supplied.has(row.code)) throw new BadRequestException("Dữ liệu nhập không được trùng mã.");
            supplied.set(row.code, { unit: row.unit.trim(), value: decimal(row.value, "Dữ liệu " + row.code) });
        }
        const closure = this.closure(sources, formulaCode, supplied);
        for (const key of supplied.keys()) if (!closure.inputs.has(key)) throw new BadRequestException("Dữ liệu " + key + " không được công thức sử dụng.");
        const inputRows = [...closure.inputs].map(([code, row]) => ({ code, ...row }));
        const dependencies = closure.dependencies;
        return {
            formulaCode,
            component,
            inputs: inputRows,
            results: closure.results,
            dependencies,
            inputHash: createHash("sha256").update(canonicalJson(inputs)).digest("hex"),
            bindingHash: createHash("sha256").update(canonicalJson({ formulaCode, component, inputs: inputRows, dependencies })).digest("hex"),
        };
    }
    createVersion(user: AuthUser, id: string, dto: CreatePayrollConfigurationVersionDto, ipAddress?: string) {
        const { from, to } = this.range(dto);
        if (from <= businessDate()) throw new BadRequestException("Phiên bản kế tiếp phải hiệu lực từ ngày mai trở đi.");
        return this.write(async db => {
            const before = await db.payrollConfiguration.findUnique({ where: { id }, include: INCLUDE });
            if (!before) throw new NotFoundException("Không tìm thấy cấu hình lương.");
            this.validateShape(before.kind, dto);
            await this.components.assertWritable(user, before.orgUnitId, from, to ?? OPEN, db);
            if (before.revision !== dto.revision) throw new ConflictException("Cấu hình đã có phiên bản mới. Tải lại trước khi thực hiện.");
            const latest = before.versions[0];
            if (latest && from <= latest.effectiveFrom) throw new BadRequestException("Ngày hiệu lực phải sau phiên bản mới nhất.");
            if (latest && (!latest.effectiveTo || latest.effectiveTo >= from)) await db.payrollConfigurationVersion.update({ where: { id: latest.id }, data: { effectiveTo: new Date(from.getTime() - DAY) } });
            const row = await db.payrollConfiguration.update({ where: { id }, data: { revision: { increment: 1 }, versions: { create: this.data(dto, before.kind, from, to, user.id) } }, include: INCLUDE });
            await this.validateAffected(db, before.orgUnitId, from);
            const item = this.view(row, businessDate(), row.orgUnit.code, true);
            await this.audit.record({ actorId: user.id, entityType: "payroll_configuration", entityId: id, action: "CREATE_VERSION", result: "SUCCESS", oldValue: this.view(before, businessDate(), before.orgUnit.code, true), newValue: { item }, ipAddress }, db);
            return { item };
        });
    }
    private closure(sources: ResolvedSources, formulaCode: string, input: Map<string, { unit: string; value: Decimal }> | null) {
        const root = sources.resolve("FORMULA", formulaCode);
        const inputs = new Map<string, { unit: string; min?: string; max?: string }>();
        const visiting = new Set<string>();
        const computed = new Map<string, Decimal>();
        const dependencies = new Map<string, BindingDependency>();
        const order: string[] = [], results: PreviewResult[] = [];
        const rememberConfiguration = (source: "FORMULA" | "PRICE", header: Header, version: Version) => {
            dependencies.set(`${source}:${version.id}`, {
                source,
                code: header.code,
                sourceId: header.id,
                versionId: version.id,
                unit: version.unit,
                active: version.active,
                status: version.status,
                effectiveFrom: dateText(version.effectiveFrom),
                effectiveTo: version.effectiveTo ? dateText(version.effectiveTo) : null,
                metadata: {
                    configurationId: header.id,
                    kind: header.kind,
                    orgUnitId: header.orgUnitId,
                    name: version.name,
                    priceType: version.priceType,
                    amount: version.amount?.toFixed() ?? null,
                    productCode: version.productCode,
                    operationCode: version.operationCode,
                    componentId: version.componentId,
                    expression: version.expression,
                    variables: version.variables,
                    roundingMode: version.roundingMode,
                    roundingScale: version.roundingScale,
                },
            });
        };
        const resolve = (header: Header, version: Version): Decimal => {
            if (visiting.has(version.id)) throw new BadRequestException("Phát hiện vòng phụ thuộc công thức.");
            const previous = computed.get(version.id);
            if (previous) return previous;
            rememberConfiguration("FORMULA", header, version);
            sources.component(version.componentId!);
            visiting.add(version.id);
            const vars = this.storedVariables(version.variables);
            const compiled = compileFormula(version.expression!, vars.map(row => row.symbol));
            const values = new Map<string, Decimal>();
            const trace: PreviewTrace[] = [];
            for (const variable of vars) {
                let value: Decimal, versionId: string | undefined;
                if (variable.source === "INPUT") {
                    const prior = inputs.get(variable.reference);
                    if (prior && prior.unit !== variable.unit) throw new BadRequestException("Một dữ liệu nhập không thể dùng với hai đơn vị khác nhau.");
                    const min = prior?.min && variable.min ? Decimal.max(prior.min, variable.min).toFixed() : prior?.min ?? variable.min;
                    const max = prior?.max && variable.max ? Decimal.min(prior.max, variable.max).toFixed() : prior?.max ?? variable.max;
                    if (min !== undefined && max !== undefined && new Decimal(min).gt(max)) throw new BadRequestException("Cận của dữ liệu nhập dùng chung không tương thích.");
                    inputs.set(variable.reference, { unit: variable.unit, ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) });
                    if (!input) continue;
                    const supplied = input.get(variable.reference);
                    if (!supplied) throw new BadRequestException({ code: "PREVIEW_INPUT_MISSING", message: "Thiếu dữ liệu nhập " + variable.reference + "." });
                    if (supplied.unit !== variable.unit) throw new BadRequestException("Đơn vị dữ liệu " + variable.reference + " không khớp.");
                    value = supplied.value;
                } else if (variable.source === "PARAMETER") {
                    const parameter = sources.parameter(variable.reference);
                    if (parameter.unit !== variable.unit) throw new BadRequestException("Đơn vị tham số " + variable.reference + " không khớp.");
                    value = parameter.value;
                    versionId = parameter.id;
                    dependencies.set(`PARAMETER:${parameter.id}`, {
                        source: "PARAMETER",
                        code: parameter.row.paramCode,
                        sourceId: parameter.id,
                        versionId: parameter.id,
                        unit: parameter.unit,
                        active: true,
                        status: null,
                        effectiveFrom: dateText(parameter.row.effectiveFrom),
                        effectiveTo: parameter.row.effectiveTo ? dateText(parameter.row.effectiveTo) : null,
                        metadata: {
                            scopeKey: parameter.row.scopeKey,
                            subjectType: parameter.row.subjectType,
                            applicationBasis: parameter.row.applicationBasis,
                            value: text(parameter.value),
                        },
                    });
                } else {
                    const source = sources.resolve(variable.source, variable.reference);
                    if (source.version.unit !== variable.unit) throw new BadRequestException("Đơn vị nguồn " + variable.reference + " không khớp.");
                    versionId = source.version.id;
                    if (variable.source === "PRICE") rememberConfiguration("PRICE", source.header, source.version);
                    value = variable.source === "PRICE" ? new Decimal(source.version.amount!.toString()) : resolve(source.header, source.version);
                    if (!input && variable.source === "FORMULA") continue;
                }
                if ((variable.min !== undefined && value.lt(decimal(variable.min, "Cận dưới"))) || (variable.max !== undefined && value.gt(decimal(variable.max, "Cận trên")))) throw new BadRequestException("Giá trị " + variable.reference + " nằm ngoài cận khai báo.");
                values.set(variable.symbol, value);
                trace.push({ symbol: variable.symbol, source: variable.source, reference: variable.reference, unit: variable.unit, value: text(value), ...(versionId ? { versionId } : {}) });
            }
            const raw = input ? compiled.evaluate(values) : new Decimal(0);
            const rounded = input ? roundFormula(raw, version.roundingMode!, version.roundingScale!) : raw;
            computed.set(version.id, rounded);
            if (input) results.push({ code: header.code, name: version.name, unit: version.unit, value: text(rounded), rawValue: text(raw), expression: version.expression, versionId: version.id, roundingMode: version.roundingMode, roundingScale: version.roundingScale, variables: trace });
            order.push(header.code);
            visiting.delete(version.id);
            return rounded;
        };
        resolve(root.header, root.version);
        return { order, results, inputs, dependencies: [...dependencies.values()].sort((left, right) => left.source.localeCompare(right.source) || left.sourceId.localeCompare(right.sourceId)) };
    }
    previewContext(user: AuthUser, query: PreviewContextQueryDto) {
        const at = date(query.asOf);
        return this.read(async db => {
            const scopes = await this.scopes(user, at, db);
            if (!scopes.visible.has(query.orgUnitId)) throw new NotFoundException("Không tìm thấy đơn vị trong phạm vi được cấp.");
            const closure = this.closure(await this.sources(db, query.orgUnitId, at), query.formulaCode, null);
            return { asOf: dateText(at), orgUnitId: query.orgUnitId, formulaCode: query.formulaCode, inputs: [...closure.inputs].map(([code, row]) => ({ code, ...row })), order: closure.order };
        });
    }
    preview(user: AuthUser, dto: PreviewPayrollConfigurationDto) {
        const at = date(dto.asOf);
        return this.read(async db => {
            const scopes = await this.scopes(user, at, db);
            if (!scopes.visible.has(dto.orgUnitId)) throw new NotFoundException("Không tìm thấy đơn vị trong phạm vi được cấp.");
            const supplied = new Map<string, { unit: string; value: Decimal }>();
            for (const row of dto.inputs) {
                if (supplied.has(row.code)) throw new BadRequestException("Dữ liệu nhập không được trùng mã.");
                supplied.set(row.code, { unit: row.unit.trim(), value: decimal(row.value, "Dữ liệu " + row.code) });
            }
            const closure = this.closure(await this.sources(db, dto.orgUnitId, at), dto.formulaCode, supplied);
            for (const key of supplied.keys()) if (!closure.inputs.has(key)) throw new BadRequestException("Dữ liệu " + key + " không được công thức sử dụng.");
            return { simulation: true, asOf: dateText(at), orgUnitId: dto.orgUnitId, order: closure.order, results: closure.results };
        });
    }
}
