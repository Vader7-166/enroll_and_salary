import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from "@nestjs/common";
import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested } from "class-validator";
import { SessionGuard } from "../auth/session.guard";
import type { AuthRequest } from "../auth/auth.types";
import { ShiftRotationService } from "./rotation.service";
import { ShiftSwapService } from "./swap.service";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export class PatternVersionDto {
  @IsString() @Matches(/\S/) @MaxLength(160) name!: string;
  // Entries are a shift id or null (rest day); checked in the service.
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(62) sequence!: Array<string | null>;
  @IsInt() @Min(0) @Max(2880) minRestMinutes!: number;
  @Matches(DATE) effectiveFrom!: string;
  @IsOptional() @Matches(DATE) effectiveTo?: string;
}
export class PatternDto extends PatternVersionDto {
  @IsUUID() siteOrgUnitId!: string;
  @Matches(/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/) code!: string;
}
export class PatternQueryDto { @IsOptional() @IsUUID() siteOrgUnitId?: string; }
export class GenerateMemberDto { @IsUUID() employeeId!: string; @IsInt() @Min(0) @Max(61) cycleOffset!: number; }
export class GenerateDto {
  @IsInt() @Min(0) revision!: number;
  @IsUUID() patternId!: string;
  @Matches(DATE) dateFrom!: string;
  @Matches(DATE) dateTo!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(300) @ValidateNested({ each: true }) @Type(() => GenerateMemberDto) members!: GenerateMemberDto[];
}
export class BulkAssignDto {
  @IsInt() @Min(0) revision!: number;
  @IsUUID() shiftId!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(300) @IsUUID("all", { each: true }) employeeIds!: string[];
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(62) @Matches(DATE, { each: true }) dates!: string[];
}
export class CopyPreviousDto {
  @IsUUID() teamOrgUnitId!: string;
  @IsString() @Matches(/\S/) @MaxLength(160) title!: string;
  @Matches(DATE) sourceFrom!: string; @Matches(DATE) sourceTo!: string;
  @Matches(DATE) targetFrom!: string; @Matches(DATE) targetTo!: string;
  @IsIn(["WEEKDAY", "CYCLE"]) mode!: "WEEKDAY" | "CYCLE";
  @IsOptional() @IsInt() @Min(1) @Max(62) cycleDays?: number;
}
export class SwapDto { @IsUUID() scheduleId!: string; @IsUUID() newShiftId!: string; @IsString() @Matches(/\S/) @MaxLength(2000) reason!: string; }
export class SwapDecisionDto { @IsInt() @Min(1) revision!: number; @IsOptional() @IsString() @MaxLength(2000) reason?: string; }
export class SwapCancelDto { @IsInt() @Min(1) revision!: number; @IsString() @Matches(/\S/) @MaxLength(2000) reason!: string; }
export class SwapQueryDto { @IsOptional() @IsIn(["PENDING", "APPROVED", "RETURNED", "REJECTED", "CANCELLED"]) status?: string; }

@Controller("shifts")
@UseGuards(SessionGuard)
export class ShiftRotationController {
  constructor(private readonly rotation: ShiftRotationService, private readonly swaps: ShiftSwapService) {}
  @Get("rotation-patterns") patterns(@Req() r: AuthRequest, @Query() q: PatternQueryDto) { return this.rotation.patterns(r.user, q); }
  @Post("rotation-patterns") createPattern(@Req() r: AuthRequest, @Body() d: PatternDto) { return this.rotation.createPattern(r.user, d, r.ip); }
  @Post("rotation-patterns/:id/versions") addVersion(@Req() r: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() d: PatternVersionDto) { return this.rotation.addVersion(r.user, id, d, r.ip); }
  @Post("plans/copy-previous") copy(@Req() r: AuthRequest, @Body() d: CopyPreviousDto) { return this.rotation.copyPrevious(r.user, d, r.ip); }
  @Post("plans/:id/generate") generate(@Req() r: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() d: GenerateDto) { return this.rotation.generate(r.user, id, d, r.ip); }
  @Post("plans/:id/bulk-assign") bulk(@Req() r: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() d: BulkAssignDto) { return this.rotation.bulkAssign(r.user, id, d, r.ip); }
  @Get("swaps") listSwaps(@Req() r: AuthRequest, @Query() q: SwapQueryDto) { return this.swaps.list(r.user, q); }
  @Post("swaps") createSwap(@Req() r: AuthRequest, @Body() d: SwapDto) { return this.swaps.create(r.user, d, r.ip); }
  @Post("swaps/:id/approve") approve(@Req() r: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() d: SwapDecisionDto) { return this.swaps.decide(r.user, id, "APPROVE", d, r.ip); }
  @Post("swaps/:id/return") returnSwap(@Req() r: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() d: SwapDecisionDto) { return this.swaps.decide(r.user, id, "RETURN", d, r.ip); }
  @Post("swaps/:id/reject") reject(@Req() r: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() d: SwapDecisionDto) { return this.swaps.decide(r.user, id, "REJECT", d, r.ip); }
  @Post("swaps/:id/cancel") cancel(@Req() r: AuthRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() d: SwapCancelDto) { return this.swaps.cancel(r.user, id, d, r.ip); }
}
