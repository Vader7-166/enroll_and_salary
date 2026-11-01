import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, StreamableFile, UseGuards } from "@nestjs/common";
import { Type } from "class-transformer";
import { IsInt, Matches, Max, Min } from "class-validator";
import { SessionGuard } from "../../auth/session.guard";
import type { AuthRequest } from "../../auth/auth.types";
import { TaxFinalizationService } from "./finalization.service";

export class FinalizationYearDto { @Type(() => Number) @IsInt() @Min(2020) @Max(2100) year!: number; }
export class FinalizationCompleteDto { @Matches(/^[0-9a-f]{64}$/) sourceHash!: string; }

@Controller("pit/finalizations")
@UseGuards(SessionGuard)
export class TaxFinalizationController {
  constructor(private readonly finalizations: TaxFinalizationService) {}
  @Get() list(@Req() request: AuthRequest, @Query() query: FinalizationYearDto) { return this.finalizations.list(request.user, query); }
  @Post("run") run(@Req() request: AuthRequest, @Body() dto: FinalizationYearDto) { return this.finalizations.run(request.user, dto, request.ip); }
  @Get("export")
  async export(@Req() request: AuthRequest, @Query() query: FinalizationYearDto) {
    const file = await this.finalizations.export(request.user, query, request.ip);
    return new StreamableFile(file, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", disposition: "attachment; filename=\"quyet-toan-tncn-" + query.year + ".xlsx\"", length: file.length });
  }
  @Get(":id") detail(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string) { return this.finalizations.detail(request.user, id); }
  @Post(":id/complete") complete(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() dto: FinalizationCompleteDto) { return this.finalizations.complete(request.user, id, dto, request.ip); }
}
