import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, StreamableFile, UseGuards } from "@nestjs/common";
import { Type } from "class-transformer";
import { IsIn, IsOptional, IsUUID, Matches, ValidateNested } from "class-validator";
import { SessionGuard } from "../auth/session.guard";
import type { AuthRequest } from "../auth/auth.types";
import { ReportsService } from "./reports.service";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export class ReportParamsDto {
  @IsOptional() @IsUUID() periodId?: string;
  @IsOptional() @IsUUID() payrollPeriodId?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}$/) month?: string;
  @IsOptional() @Matches(/^\d{4}$/) year?: string;
  @IsOptional() @Matches(DATE) dateFrom?: string;
  @IsOptional() @Matches(DATE) dateTo?: string;
  @IsOptional() @IsUUID() orgUnitId?: string;
}
export class ReportExportDto {
  @ValidateNested() @Type(() => ReportParamsDto) params!: ReportParamsDto;
  @IsIn(["XLSX", "PDF"]) format!: "XLSX" | "PDF";
}

@Controller("reports")
@UseGuards(SessionGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}
  @Get() catalog(@Req() r: AuthRequest) { return this.reports.catalog(r.user); }
  @Get("runs") runs(@Req() r: AuthRequest) { return this.reports.runs(r.user); }
  @Get("runs/:id") run(@Req() r: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string) { return this.reports.run(r.user, id); }
  @Get("runs/:id/download")
  async download(@Req() r: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string) {
    const { file, fileName, format } = await this.reports.download(r.user, id);
    return new StreamableFile(file, { type: format === "PDF" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", disposition: "attachment; filename=\"" + fileName + "\"", length: file.length });
  }
  @Get(":type/preview") preview(@Req() r: AuthRequest, @Param("type") type: string, @Query() q: ReportParamsDto) { return this.reports.preview(r.user, type, q); }
  @Post(":type/export") export(@Req() r: AuthRequest, @Param("type") type: string, @Body() d: ReportExportDto) { return this.reports.export(r.user, type, d.params, d.format, r.ip); }
}
