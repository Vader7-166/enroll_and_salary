import { Type } from "class-transformer";
import {
  IsDefined,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import {
  ApplicationBasis,
  PolicyStatus,
  SitePolicyKey,
} from "@prisma/client";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export class ParameterQueryDto {
  @IsOptional() @IsString() @Matches(ISO_DATE) asOf?: string;
  @IsOptional() @IsString() @Matches(/^[A-Z][A-Z0-9_]{1,79}$/) paramCode?: string;
  @IsOptional() @IsString() @MaxLength(64) scopeKey?: string;
}

export class CreateParameterDto {
  @IsString() @Matches(/^[A-Z][A-Z0-9_]{1,79}$/) paramCode!: string;
  @IsString() @Matches(/^(GLOBAL|REGION:(I|II|III|IV)|SITE:[0-9a-fA-F-]{36})$/) scopeKey!: string;
  @IsString() @Matches(/^[A-Z][A-Z0-9_]{1,63}$/) subjectType!: string;
  @IsEnum(ApplicationBasis) applicationBasis!: ApplicationBasis;
  @IsDefined() value!: unknown;
  @IsString() @Matches(/^\S(?:.*\S)?$/) @MaxLength(32) unit!: string;
  @IsString() @Matches(ISO_DATE) effectiveFrom!: string;
  @IsOptional() @IsString() @Matches(ISO_DATE) effectiveTo?: string;
  @IsString() @Matches(ISO_DATE) documentEffectiveDate!: string;
  @IsString() @Matches(/^\S(?:.|\r|\n)*$/) @MaxLength(4000) legalBasis!: string;
}

export class PolicyQueryDto {
  @IsOptional() @IsUUID() orgUnitId?: string;
  @IsOptional() @IsString() @Matches(ISO_DATE) asOf?: string;
}

export class CreatePolicyDto {
  @IsUUID() orgUnitId!: string;
  @IsEnum(SitePolicyKey) policyKey!: SitePolicyKey;
  @Type(() => Number) @IsInt() @Min(1) @Max(31) value!: number;
  @IsEnum(PolicyStatus) status!: PolicyStatus;
  @IsString() @Matches(/^\S(?:.|\r|\n)*$/) @MaxLength(200) decisionReference!: string;
  @IsString() @Matches(ISO_DATE) effectiveFrom!: string;
  @IsOptional() @IsString() @Matches(ISO_DATE) effectiveTo?: string;
}

export class ResolvePolicyQueryDto {
  @IsUUID() orgUnitId!: string;
  @IsString() @Matches(ISO_DATE) asOf!: string;
  @IsEnum(SitePolicyKey) policyKey!: SitePolicyKey;
}

export class PeriodPreviewQueryDto {
  @IsUUID() scopeOrgUnitId!: string;
  @IsString() @Matches(MONTH) month!: string;
}

export class CreatePeriodDto extends PeriodPreviewQueryDto {
  @IsString() @Matches(/^[A-Z0-9][A-Z0-9_-]{1,63}$/) code!: string;
  @IsOptional() @IsString() @Matches(ISO_DATE) dateFrom?: string;
  @IsOptional() @IsString() @Matches(ISO_DATE) dateTo?: string;
}

export class OpenPeriodDto {
  @Type(() => Number) @IsInt() @Min(0) revision!: number;
}
