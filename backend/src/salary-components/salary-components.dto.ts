import { Type } from "class-transformer";
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from "class-validator";
import { PolicyStatus, SalaryComponentType, SalaryTaxClassification } from "@prisma/client";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class SalaryComponentQueryDto {
  @IsOptional() @IsUUID() orgUnitId?: string;
  @IsOptional() @Matches(DATE) asOf?: string;
  @IsOptional() @IsString() @MaxLength(150) search?: string;
}

export class SalaryComponentVersionDto {
  @IsString() @Matches(/\S/) @MaxLength(150) name!: string;
  @IsEnum(SalaryComponentType) componentType!: SalaryComponentType;
  @IsBoolean() active!: boolean;
  @IsBoolean() isInsurable!: boolean;
  @IsEnum(SalaryTaxClassification) taxClassification!: SalaryTaxClassification;
  @IsBoolean() isOtBase!: boolean;
  @IsBoolean() isProrated!: boolean;
  @Type(() => Number) @IsInt() @Min(0) @Max(9999) displayOrder!: number;
  @IsEnum(PolicyStatus) status!: PolicyStatus;
  @IsString() @Matches(/\S/) @MaxLength(2000) classificationBasis!: string;
  @IsString() @Matches(/\S/) @MaxLength(500) decisionReference!: string;
  @IsString() @Matches(/\S/) @MaxLength(2000) reason!: string;
  @Matches(DATE) effectiveFrom!: string;
  @IsOptional() @Matches(DATE) effectiveTo?: string;
}

export class CreateSalaryComponentDto extends SalaryComponentVersionDto {
  @IsUUID() orgUnitId!: string;
  @IsString() @Matches(/^[A-Z][A-Z0-9_]{1,31}$/) code!: string;
}

export class CreateSalaryComponentVersionDto extends SalaryComponentVersionDto {
  @Type(() => Number) @IsInt() @Min(1) revision!: number;
}
