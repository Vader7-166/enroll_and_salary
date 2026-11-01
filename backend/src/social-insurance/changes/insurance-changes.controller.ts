import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, StreamableFile, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { IsInt, IsOptional, IsString, IsUUID, Matches, Min } from "class-validator";
import { SessionGuard } from "../../auth/session.guard";
import type { AuthRequest } from "../../auth/auth.types";
import { PrismaService } from "../../database/prisma.service";
import { C12Service } from "../c12/c12.service";
import { InsuranceChangesService } from "./insurance-changes.service";

export class ChangeListQueryDto {
  @IsUUID() siteOrgUnitId!: string;
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) month!: string;
}
export class FinalizeListDto {
  @IsInt() @Min(1) revision!: number;
  @IsString() @Matches(/^[0-9a-f]{64}$/) contentHash!: string;
}
export class C12QueryDto {
  @IsUUID() siteOrgUnitId!: string;
  @IsOptional() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) month?: string;
}

@Controller("social-insurance")
@UseGuards(SessionGuard)
export class InsuranceChangesController {
  constructor(private readonly changes: InsuranceChangesService, private readonly c12: C12Service, private readonly prisma: PrismaService) {}

  @Get("change-lists") find(@Req() request: AuthRequest, @Query() query: ChangeListQueryDto) { return this.changes.find(request.user, query); }
  @Post("change-lists/generate") generate(@Req() request: AuthRequest, @Body() dto: ChangeListQueryDto) { return this.changes.generate(request.user, dto, request.ip); }
  @Get("change-lists/:id") view(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string) { return this.changes.view(request.user, id); }
  @Post("change-lists/:id/finalize") finalize(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() dto: FinalizeListDto) { return this.changes.finalize(request.user, id, dto, request.ip); }
  @Get("change-lists/:id/export")
  async export(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string) {
    const { file, name } = await this.changes.export(request.user, id, request.ip);
    return new StreamableFile(file, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", disposition: "attachment; filename=\"" + name + "\"", length: file.length });
  }

  @Get("file-templates")
  async templates(@Req() request: AuthRequest) {
    if (!request.user.roles.includes("KT") || !request.user.permissions.includes("insurance.read")) return { items: [] };
    const rows = await this.prisma.insuranceFileTemplate.findMany({ where: { active: true }, orderBy: [{ kind: "asc" }, { code: "asc" }, { version: "desc" }] });
    return { items: rows.map(row => ({ id: row.id, kind: row.kind, code: row.code, version: row.version, name: row.name, headerRow: row.headerRow, columns: row.columns, status: row.status, legalBasis: row.legalBasis })) };
  }

  @Post("c12-imports") @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 5_242_880, files: 1, fields: 5 } }))
  importC12(@Req() request: AuthRequest, @UploadedFile() file: Express.Multer.File | undefined, @Body() body: { siteOrgUnitId?: string; month?: string; templateId?: string }) {
    return this.c12.import(request.user, file, body, request.ip);
  }
  @Get("c12-imports") imports(@Req() request: AuthRequest, @Query() query: C12QueryDto) { return this.c12.list(request.user, query); }
  @Get("c12-imports/:id") importDetail(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string) { return this.c12.detail(request.user, id); }
}
