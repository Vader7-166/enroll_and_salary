import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf, ValidateNested } from "class-validator";
import { FormulaRoundingMode, PayrollConfigurationKind, PayrollPriceType, PolicyStatus } from "@prisma/client";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CODE = /^[A-Z][A-Z0-9_]{0,79}$/;
const DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d{1,6})?$/;

export class PayrollConfigurationQueryDto {
  @IsOptional() @IsEnum(PayrollConfigurationKind) kind?: PayrollConfigurationKind;
  @IsOptional() @IsUUID() orgUnitId?: string;
  @IsOptional() @Matches(DATE) asOf?: string;
  @IsOptional() @IsString() @MaxLength(150) search?: string;
}

export class PayrollConfigurationDetailQueryDto { @IsOptional() @Matches(DATE) asOf?: string; }

export class FormulaVariableDto {
  @IsString() @Matches(CODE) symbol!: string;
  @IsEnum(["INPUT", "PARAMETER", "PRICE", "FORMULA"] as const) source!: "INPUT" | "PARAMETER" | "PRICE" | "FORMULA";
  @IsString() @Matches(CODE) reference!: string;
  @IsString() @Matches(/\S/) @MaxLength(32) unit!: string;
  @IsOptional() @IsString() @Matches(DECIMAL) min?: string;
  @IsOptional() @IsString() @Matches(DECIMAL) max?: string;
}

export class PayrollConfigurationVersionDto {
  @IsString() @Matches(/\S/) @MaxLength(150) name!: string;
  @IsString() @Matches(/\S/) @MaxLength(32) unit!: string;
  @IsBoolean() active!: boolean;
  @IsEnum(PolicyStatus) status!: PolicyStatus;
  @IsString() @Matches(/\S/) @MaxLength(500) decisionReference!: string;
  @IsString() @Matches(/\S/) @MaxLength(2000) reason!: string;
  @Matches(DATE) effectiveFrom!: string;
  @IsOptional() @Matches(DATE) effectiveTo?: string;
  @IsOptional() @IsEnum(PayrollPriceType) priceType?: PayrollPriceType;
  @IsOptional() @IsString() @Matches(DECIMAL) amount?: string;
  @IsOptional() @IsString() @Matches(/^[A-Z][A-Z0-9_-]{0,79}$/) productCode?: string;
  @IsOptional() @IsString() @Matches(/^[A-Z][A-Z0-9_-]{0,79}$/) operationCode?: string;
  @IsOptional() @IsUUID() componentId?: string;
  @IsOptional() @IsString() @MaxLength(2000) expression?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(32) @ValidateNested({ each: true }) @Type(() => FormulaVariableDto) variables?: FormulaVariableDto[];
  @IsOptional() @IsEnum(FormulaRoundingMode) roundingMode?: FormulaRoundingMode;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(6) roundingScale?: number;
}

export class CreatePayrollConfigurationDto extends PayrollConfigurationVersionDto {
  @IsEnum(PayrollConfigurationKind) kind!: PayrollConfigurationKind;
  @IsString() @Matches(CODE) code!: string;
  @IsUUID() orgUnitId!: string;
}
export class CreatePayrollConfigurationVersionDto extends PayrollConfigurationVersionDto { @Type(() => Number) @IsInt() @Min(1) revision!: number; }
export class PreviewContextQueryDto { @IsUUID() orgUnitId!: string; @Matches(DATE) asOf!: string; @Matches(CODE) formulaCode!: string; }
export class PreviewInputDto { @IsString() @Matches(CODE) code!: string; @IsString() @Matches(/\S/) @MaxLength(32) unit!: string; @IsString() @Matches(DECIMAL) value!: string; }
export class PreviewPayrollConfigurationDto { @IsUUID() orgUnitId!: string; @Matches(DATE) asOf!: string; @Matches(CODE) formulaCode!: string; @IsArray() @ArrayMaxSize(32) @ValidateNested({ each: true }) @Type(() => PreviewInputDto) inputs!: PreviewInputDto[]; }
