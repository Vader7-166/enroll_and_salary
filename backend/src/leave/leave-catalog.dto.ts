import { Type } from "class-transformer";
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from "class-validator";
import { PolicyStatus } from "@prisma/client";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;

export class LeaveCatalogQueryDto {
  @IsOptional() @IsUUID() orgUnitId?: string;
  @IsOptional() @Matches(DATE) asOf?: string;
  @IsOptional() @IsString() @MaxLength(150) search?: string;
}

export class LeaveVersionBaseDto {
  @IsString() @Matches(/\S/) @MaxLength(150) name!: string;
  @IsEnum(PolicyStatus) status!: PolicyStatus;
  @IsString() @Matches(/\S/) @MaxLength(500) decisionReference!: string;
  @IsString() @Matches(/\S/) @MaxLength(2000) reason!: string;
  @Matches(DATE) effectiveFrom!: string;
  @IsOptional() @Matches(DATE) effectiveTo?: string;
}

export class LeaveTypeVersionDto extends LeaveVersionBaseDto {
  @IsBoolean() active!: boolean;
  @IsBoolean() isPaid!: boolean;
  @IsBoolean() countsAsWorkday!: boolean;
  @IsBoolean() deductsAnnualQuota!: boolean;
  @IsBoolean() siPaid!: boolean;
  @IsBoolean() requiresDocument!: boolean;
  @IsOptional() @Matches(DECIMAL) maxDays?: string | null;
  @IsString() @Matches(/\S/) @MaxLength(12) attendanceSymbol!: string;
}

export class CreateLeaveTypeDto extends LeaveTypeVersionDto {
  @IsUUID() orgUnitId!: string;
  @IsString() @Matches(/^[A-Z][A-Z0-9_]{1,31}$/) code!: string;
}

export class CreateLeaveTypeVersionDto extends LeaveTypeVersionDto {
  @Type(() => Number) @IsInt() @Min(1) revision!: number;
}

export class LeavePolicyVersionDto extends LeaveVersionBaseDto {
  @Type(() => Number) @IsInt() @Min(12) @Max(366) normalDays!: number;
  @Type(() => Number) @IsInt() @Min(14) @Max(366) hazardousDays!: number;
  @Type(() => Number) @IsInt() @Min(16) @Max(366) extremeDays!: number;
  @IsString() @Matches(DECIMAL) carryLimitDays!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(12) carryExpiryMonth!: number;
  @Type(() => Number) @IsInt() @Min(1) @Max(31) carryExpiryDay!: number;
  @IsString() @Matches(DECIMAL) advanceLimitDays!: string;
}

export class CreateLeavePolicyDto extends LeavePolicyVersionDto {
  @IsUUID() orgUnitId!: string;
}

export class CreateLeavePolicyVersionDto extends LeavePolicyVersionDto {
  @Type(() => Number) @IsInt() @Min(1) revision!: number;
}
