import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, ValidateNested } from "class-validator";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const BONUS_TYPES = ["MONTHLY", "QUARTERLY", "ANNUAL", "KPI", "HOLIDAY", "SENIORITY", "AD_HOC"] as const;
export class BonusVariableDto {
  @Matches(/^[A-Z][A-Z0-9_]{0,79}$/) name!: string;
  @IsOptional() @IsString() @MaxLength(30) defaultValue?: string;
}
export class CreateBonusDto {
  @Matches(/^[A-Za-z0-9._-]{2,64}$/) code!: string;
  @IsIn(BONUS_TYPES) bonusType!: (typeof BONUS_TYPES)[number];
  @IsString() @Matches(/\S/) @MaxLength(200) name!: string;
  @IsString() @Matches(/\S/) @MaxLength(500) decisionReference!: string;
  @IsOptional() @IsString() @MaxLength(500) independentDecisionRef?: string;
  @IsOptional() @IsString() @MaxLength(200) kpiSourceReference?: string;
  @Matches(DATE) earnFrom!: string;
  @Matches(DATE) earnTo!: string;
  @IsUUID() payPayrollPeriodId!: string;
  @IsOptional() @IsUUID() componentId?: string;
  @IsIn(["AMOUNT", "FORMULA"]) calculationMode!: "AMOUNT" | "FORMULA";
  @IsOptional() @IsString() @MaxLength(20) amount?: string;
  @IsOptional() @IsString() @MaxLength(2000) formula?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(32) @ValidateNested({ each: true }) @Type(() => BonusVariableDto) variables?: BonusVariableDto[];
  @IsString() @Matches(/\S/) @MaxLength(2000) reason!: string;
}
export class AllocationItemDto {
  @IsUUID() employeeId!: string;
  @IsOptional() @IsObject() inputs?: Record<string, string>;
}
export class AllocationsDto {
  @IsOptional() @IsArray() @ArrayMaxSize(5000) @ValidateNested({ each: true }) @Type(() => AllocationItemDto) items?: AllocationItemDto[];
  @IsOptional() @IsUUID() orgUnitId?: string;
  @IsOptional() @IsObject() inputs?: Record<string, string>;
}
export class RevisionDto { @IsInt() @Min(1) revision!: number; }
export class CancelBonusDto {
  @IsInt() @Min(1) revision!: number;
  @IsString() @Matches(/\S/) @MaxLength(2000) reason!: string;
}
export class RetroCalculateDto { @IsOptional() @IsUUID() targetPayrollPeriodId?: string; }
export class ConfirmRetroDto {
  @IsString() @MaxLength(200) reauthToken!: string;
  @Matches(/^[a-f0-9]{64}$/) resultHash!: string;
}
export class StatusQueryDto { @IsOptional() @IsString() @MaxLength(20) status?: string; }
