import { PaymentDateStatus, PolicyStatus, TaxExemptionMode, TaxSubject } from "@prisma/client";
import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEnum, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, ValidateNested } from "class-validator";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const AMOUNT = /^\d{1,15}(?:\.\d{1,6})?$/;
export class IncomeItemDto {
  @IsString() @Matches(/\S/) @MaxLength(200) sourceRef!: string;
  @IsIn(["SALARY", "OT", "NIGHT_ALLOWANCE", "NIGHT_BASE_PORTION", "MEAL", "UNUSED_LEAVE", "OTHER_TAXABLE", "NON_TAXABLE"]) kind!: string;
  @Matches(AMOUNT) amountPaid!: string;
  @IsOptional() @Matches(AMOUNT) basePortion?: string;
  @IsOptional() @Matches(AMOUNT) eligibleAmount?: string;
  @IsOptional() @IsString() @MaxLength(500) evidenceRef?: string;
}
export class DeductionInputDto {
  @Matches(AMOUNT) insurance!: string;
  @IsOptional() @Matches(AMOUNT) voluntaryPension?: string;
  @IsOptional() @Matches(AMOUNT) charity?: string;
  @IsOptional() @Matches(AMOUNT) medicalEducation?: string;
}
export class PitPreviewDto {
  @IsOptional() @IsUUID() employeeId?: string;
  @IsOptional() @IsEnum(TaxSubject) subject?: TaxSubject;
  @Matches(DATE) paymentDate!: string;
  @IsEnum(PaymentDateStatus) paymentDateStatus!: PaymentDateStatus;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => IncomeItemDto) items!: IncomeItemDto[];
  @ValidateNested() @Type(() => DeductionInputDto) deductions!: DeductionInputDto;
  @IsOptional() @IsInt() @Min(0) dependents?: number;
  @IsOptional() @IsBoolean() commitment?: boolean;
  @IsOptional() @IsBoolean() voluntaryRequest?: boolean;
}
export class SaveWithholdingDto extends PitPreviewDto {
  @IsUUID() declare employeeId: string;
  @IsString() @Matches(/^[A-Za-z0-9:_.-]{3,160}$/) paymentKey!: string;
  @IsOptional() @IsUUID() payrollPeriodId?: string;
}
export class AdjustWithholdingDto extends PitPreviewDto {
  @IsString() @Matches(/\S/) @MaxLength(2000) reason!: string;
}
export class GrossUpDto {
  @IsOptional() @IsUUID() employeeId?: string;
  @Matches(AMOUNT) net!: string;
  @Matches(DATE) paymentDate!: string;
  @IsOptional() @IsInt() @Min(0) dependents?: number;
  @IsOptional() @Matches(/^(I|II|III|IV)$/) regionCode?: string;
}
export class BracketDto {
  @IsIn(["MONTH", "YEAR"]) basis!: "MONTH" | "YEAR";
  @IsInt() @Min(1) bracketNo!: number;
  @Matches(/^\d{1,15}$/) lower!: string;
  @IsOptional() @Matches(/^\d{1,15}$/) upper?: string;
  @Matches(/^0\.\d{1,4}$/) rate!: string;
}
export class TaxRulesetDto {
  @IsString() @Matches(/^[A-Z0-9][A-Z0-9_-]{1,39}$/) code!: string;
  @IsEnum(TaxSubject) subject!: TaxSubject;
  @IsEnum(TaxExemptionMode) exemptionMode!: TaxExemptionMode;
  @IsObject() settings!: Record<string, unknown>;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => BracketDto) brackets?: BracketDto[];
  @IsOptional() @IsString() @MaxLength(1000) legalBasis?: string;
  @IsEnum(PolicyStatus) status!: PolicyStatus;
  @Matches(DATE) effectiveFrom!: string;
}
export class WithholdingQueryDto { @IsOptional() @IsUUID() employeeId?: string; }
