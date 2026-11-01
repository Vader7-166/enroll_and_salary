import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from "@nestjs/common";
import { TerminationReason } from "@prisma/client";
import { IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from "class-validator";
import { SessionGuard } from "../auth/session.guard";
import type { AuthRequest } from "../auth/auth.types";
import { TerminationService } from "./termination.service";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export class ContractAlertQueryDto { @IsOptional() @IsIn(["30", "60"]) days?: string; }
export class TerminationDto {
  @IsUUID() employeeId!: string;
  @IsString() @Matches(/\S/) @MaxLength(80) decisionNumber!: string;
  @Matches(DATE) effectiveDate!: string;
  @IsEnum(TerminationReason) reason!: TerminationReason;
  @IsString() @Matches(/\S/) @MaxLength(1000) legalBasis!: string;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
  @IsOptional() @IsInt() @Min(0) @Max(600) externalUnemploymentMonths?: number;
  @IsOptional() @IsString() @MaxLength(500) externalUnemploymentEvidence?: string;
}
export class TerminationRevisionDto { @IsInt() @Min(1) revision!: number; }
export class TerminationConfirmDto {
  @IsInt() @Min(1) revision!: number;
  @Matches(/^[0-9a-f]{64}$/) previewHash!: string;
  @IsString() @MaxLength(200) reauthToken!: string;
}
export class TerminationCancelDto {
  @IsInt() @Min(1) revision!: number;
  @IsString() @Matches(/\S/) @MaxLength(2000) reason!: string;
}
export class TerminationQueryDto { @IsOptional() @IsIn(["DRAFT", "CONFIRMED", "CANCELLED"]) status?: string; }

@Controller("personnel")
@UseGuards(SessionGuard)
export class TerminationController {
  constructor(private readonly terminations: TerminationService) {}
  @Get("contract-alerts") alerts(@Req() request: AuthRequest, @Query() query: ContractAlertQueryDto) { return this.terminations.alerts(request.user, query); }
  @Get("terminations") list(@Req() request: AuthRequest, @Query() query: TerminationQueryDto) { return this.terminations.list(request.user, query); }
  @Post("terminations") create(@Req() request: AuthRequest, @Body() dto: TerminationDto) { return this.terminations.createDraft(request.user, dto, request.ip); }
  @Get("terminations/:id") detail(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string) { return this.terminations.detail(request.user, id); }
  @Post("terminations/:id/refresh") refresh(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() dto: TerminationRevisionDto) { return this.terminations.refresh(request.user, id, dto, request.ip); }
  @Post("terminations/:id/confirm") confirm(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() dto: TerminationConfirmDto) { return this.terminations.confirm(request.user, request.sessionId, id, dto, request.ip); }
  @Post("terminations/:id/cancel") cancel(@Req() request: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() dto: TerminationCancelDto) { return this.terminations.cancel(request.user, id, dto, request.ip); }
}
