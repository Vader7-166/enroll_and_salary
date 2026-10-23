import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsDateString, IsEnum, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested } from "class-validator";

const DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d{1,6})?$/;
export const INPUT_TYPES = ["TIME","PRODUCT","PIECEWORK","COMMISSION","THREE_P","ALLOWANCE","BONUS","DEDUCTION","EMPLOYER_COST","ADJUSTMENT"] as const;
export const VALUE_STATES = ["PRESENT","MISSING","CONFIRMED_ZERO","NOT_APPLICABLE"] as const;
export const CALCULATION_MODES = ["FORMULA","AMOUNT"] as const;

export class PayrollPeriodDto {
  @IsString() @Matches(/^[A-Z0-9][A-Z0-9_-]{0,63}$/) code!: string;
  @IsUUID() siteOrgUnitId!: string;
  @IsDateString() dateFrom!: string;
  @IsDateString() dateTo!: string;
  @IsOptional() @IsDateString() expectedPaymentDate?: string;
}
export class PayrollInputValueDto { @IsString() @Matches(/^[A-Z][A-Z0-9_]{0,79}$/) code!: string; @IsString() @MaxLength(32) unit!: string; @IsString() @Matches(DECIMAL) value!: string; }
export class PayrollInputLineDto {
  @IsString() @Matches(/^\S.{0,159}$/) sourceLineId!: string;
  @IsUUID() employeeId!: string; @IsUUID() componentId!: string;
  @IsEnum(INPUT_TYPES) inputType!: typeof INPUT_TYPES[number];
  @IsDateString() workFrom!: string; @IsDateString() workTo!: string;
  @IsEnum(VALUE_STATES) valueState!: typeof VALUE_STATES[number];
  @IsEnum(CALCULATION_MODES) calculationMode!: typeof CALCULATION_MODES[number];
  @IsOptional() @IsString() @Matches(/^[A-Z][A-Z0-9_]{0,79}$/) formulaCode?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(32) @ValidateNested({each:true}) @Type(() => PayrollInputValueDto) inputs?: PayrollInputValueDto[];
  @IsOptional() @IsString() @Matches(DECIMAL) amount?: string;
  @IsOptional() @IsString() @MaxLength(32) unit?: string; @IsOptional() @IsString() @MaxLength(500) amountBasis?: string;
  @IsOptional() @IsString() @MaxLength(500) businessReference?: string; @IsOptional() @IsUUID() adjustmentOfLineId?: string;
  @IsOptional() @IsString() @MaxLength(160) teamAllocationKey?: string; @IsOptional() @IsString() @Matches(DECIMAL) allocatedAmount?: string; @IsOptional() @IsUUID() supersedesLineId?: string;
}
export class PayrollTeamAllocationDto { @IsString() @Matches(/^\S.{0,159}$/) key!: string; @IsUUID() teamOrgUnitId!: string; @IsString() @Matches(DECIMAL) acceptedAmount!: string; @IsString() @MaxLength(500) reference!: string; }
export class PayrollBatchDto {
  @IsUUID() payrollPeriodId!: string; @IsString() @MaxLength(80) sourceSystem!: string; @IsString() @MaxLength(160) sourceDocumentNo!: string; @IsString() @MaxLength(80) sourceVersion!: string; @IsString() @MaxLength(80) mappingVersion!: string;
  @IsEnum(["SIMULATION","BUSINESS_CONFIRMED"] as const) provenance!: "SIMULATION"|"BUSINESS_CONFIRMED"; @IsString() @MaxLength(200) preparedBy!: string;
  @IsOptional() @IsString() @MaxLength(200) sourceApprovedBy?: string; @IsOptional() @IsDateString() sourceApprovedAt?: string; @IsOptional() @IsString() @MaxLength(500) sourceApprovalReference?: string;
  @IsString() @MaxLength(2000) reason!: string; @IsOptional() @IsUUID() supersedesBatchId?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsUUID("4", {each:true}) attendancePeriodIds?: string[];
  @IsArray() @ArrayMaxSize(500) @ValidateNested({each:true}) @Type(() => PayrollInputLineDto) lines!: PayrollInputLineDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(500) @ValidateNested({each:true}) @Type(() => PayrollTeamAllocationDto) teamAllocations?: PayrollTeamAllocationDto[];
}
export class PayrollActionDto { @Type(() => Number) @IsInt() @Min(1) revision!: number; @IsOptional() @IsString() @MaxLength(2000) reason?: string; }
export class PayrollListQueryDto { @IsOptional() @IsUUID() payrollPeriodId?: string; @IsOptional() @IsString() @MaxLength(150) search?: string; @IsOptional() @IsEnum(["DRAFT","VALIDATED","CONFIRMED","RETURNED","SUPERSEDED"] as const) status?: string; @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number; @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number; }
export class PayrollConfirmedQueryDto { @IsUUID() payrollPeriodId!: string; }
