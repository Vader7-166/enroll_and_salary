import { InsuranceCapReference, InsuranceType, PolicyStatus } from "@prisma/client";
import { IsBoolean, IsEnum, IsObject, IsOptional, IsString, IsUUID, Matches, MaxLength } from "class-validator";

const RATE = /^(?:0(?:\.\d{1,6})?|1)$/;
export class InsuranceRateDto {
  @IsEnum(InsuranceType) insuranceType!: InsuranceType;
  @IsOptional() @Matches(/^(I|II|III|IV)$/) regionCode?: string;
  @Matches(RATE) employeeRate!: string;
  @Matches(RATE) employerRate!: string;
  @IsOptional() @IsObject() fundDetail?: Record<string, unknown>;
  @IsBoolean() floorRegionalMinimum!: boolean;
  @IsEnum(InsuranceCapReference) capReference!: InsuranceCapReference;
  @IsOptional() @Matches(/^\d{1,4}(?:\.\d{1,4})?$/) capMultiplier?: string;
  @IsOptional() @IsString() @MaxLength(1000) legalBasis?: string;
  @IsEnum(PolicyStatus) status!: PolicyStatus;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) effectiveFrom!: string;
}
export class InsurancePreviewDto {
  @IsUUID() employeeId!: string;
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) month!: string;
}
export class InsuranceRateQueryDto {
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) asOf?: string;
}
