import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, StreamableFile, UseGuards } from "@nestjs/common";
import { BenefitTaxTreatment, PolicyStatus } from "@prisma/client";
import { Type } from "class-transformer";
import { IsBoolean, IsEnum, IsInt, IsObject, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, ValidateNested } from "class-validator";
import { SessionGuard } from "../auth/session.guard";
import type { AuthRequest } from "../auth/auth.types";
import { WelfareService } from "./welfare.service";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export class BenefitVersionDto {
  @IsString() @Matches(/\S/) @MaxLength(200) name!: string;
  @Matches(/^\d{1,15}$/) amount!: string;
  @IsEnum(BenefitTaxTreatment) taxTreatment!: BenefitTaxTreatment;
  @IsOptional() @Matches(/^\d{1,15}$/) exemptLimit?: string;
  @IsBoolean() payrollIncluded!: boolean;
  @IsObject() eligibility!: Record<string, unknown>;
  @IsString() @Matches(/\S/) @MaxLength(500) decisionReference!: string;
  @IsEnum(PolicyStatus) status!: PolicyStatus;
  @IsOptional() @IsBoolean() active?: boolean;
  @Matches(DATE) effectiveFrom!: string;
  @IsOptional() @Matches(DATE) effectiveTo?: string;
}
export class BenefitCatalogDto {
  @Matches(/^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/) code!: string;
  @IsUUID() orgUnitId!: string;
  @IsString() category!: string;
  @ValidateNested() @Type(() => BenefitVersionDto) version!: BenefitVersionDto;
}
export class BenefitBatchDto {
  @IsUUID() catalogId!: string;
  @IsString() @MaxLength(32) periodCode!: string;
  @Matches(DATE) referenceDate!: string;
  @IsUUID() scopeOrgUnitId!: string;
  @IsOptional() @IsUUID() payrollPeriodId?: string;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
}
export class BenefitCandidateDto {
  @IsInt() @Min(1) revision!: number;
  @IsUUID() employeeId!: string;
  @IsOptional() @IsString() @MaxLength(2000) reason?: string;
}
export class BenefitRevisionDto { @IsInt() @Min(1) revision!: number; }
export class BenefitCancelDto { @IsInt() @Min(1) revision!: number; @IsString() @Matches(/\S/) @MaxLength(2000) reason!: string; }
export class CatalogQueryDto { @IsOptional() @Matches(DATE) asOf?: string; }
export class CostQueryDto { @Matches(/^\d{4}-\d{2}$/) from!: string; @Matches(/^\d{4}-\d{2}$/) to!: string; }

@Controller("welfare")
@UseGuards(SessionGuard)
export class WelfareController {
  constructor(private readonly welfare: WelfareService) {}
  @Get("catalog") catalog(@Req() request: AuthRequest, @Query() query: CatalogQueryDto) { return this.welfare.catalog(request.user, query); }
  @Post("catalog") createCatalog(@Req() request: AuthRequest, @Body() dto: BenefitCatalogDto) { return this.welfare.createCatalog(request.user, dto, request.ip); }
  @Post("catalog/:id/versions") addVersion(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() dto: BenefitVersionDto) { return this.welfare.addVersion(request.user, id, dto, request.ip); }
  @Get("allocations") batches(@Req() request: AuthRequest) { return this.welfare.batches(request.user); }
  @Post("allocations") createBatch(@Req() request: AuthRequest, @Body() dto: BenefitBatchDto) { return this.welfare.createBatch(request.user, dto, request.ip); }
  @Get("allocations/:id") detail(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string) { return this.welfare.detail(request.user, id); }
  @Post("allocations/:id/candidates") add(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() dto: BenefitCandidateDto) { return this.welfare.addCandidate(request.user, id, dto, request.ip); }
  @Post("allocations/:id/candidates/remove") remove(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() dto: BenefitCandidateDto) { return this.welfare.removeCandidate(request.user, id, dto, request.ip); }
  @Post("allocations/:id/confirm") confirm(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() dto: BenefitRevisionDto) { return this.welfare.confirm(request.user, id, dto, request.ip); }
  @Post("allocations/:id/cancel") cancel(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() dto: BenefitCancelDto) { return this.welfare.cancel(request.user, id, dto, request.ip); }
  @Get("costs") costs(@Req() request: AuthRequest, @Query() query: CostQueryDto) { return this.welfare.costs(request.user, query); }
  @Get("costs/export")
  async exportCosts(@Req() request: AuthRequest, @Query() query: CostQueryDto) {
    const file = await this.welfare.exportCosts(request.user, query, request.ip);
    return new StreamableFile(file, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", disposition: "attachment; filename=\"chi-phi-phuc-loi-" + query.from + "-" + query.to + ".xlsx\"", length: file.length });
  }
}
