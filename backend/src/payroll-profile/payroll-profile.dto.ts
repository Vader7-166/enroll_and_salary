import { EmployeeSpecialStatusType, IdentityDocumentType, PolicyStatus, TaxResidency } from "@prisma/client";
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Matches, MaxLength, Min } from "class-validator";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export class IdentityDto {
  @IsInt() @Min(0) revision!: number;
  @IsEnum(IdentityDocumentType) documentType!: IdentityDocumentType;
  @IsString() @MaxLength(20) idNumber!: string;
  @IsOptional() @Matches(DATE) idIssueDate?: string;
  @IsOptional() @IsString() @MaxLength(200) idIssuePlace?: string;
  @IsOptional() @IsString() @MaxLength(20) taxCode?: string;
  @IsOptional() @IsString() @MaxLength(20) siBookNumber?: string;
  @IsOptional() @IsString() @MaxLength(120) emergencyContactName?: string;
  @IsOptional() @IsString() @MaxLength(30) emergencyContactPhone?: string;
  @IsOptional() @IsString() @MaxLength(60) emergencyContactRelation?: string;
  @IsOptional() @IsString() @MaxLength(500) documentReference?: string;
  @IsEnum(PolicyStatus) dataStatus!: PolicyStatus;
  @IsString() @Matches(/\S/) @MaxLength(2000) reason!: string;
}
export class BankAccountDto {
  @IsString() @Matches(/^[A-Z0-9]{2,20}$/) bankCode!: string;
  @IsString() @MaxLength(30) accountNumber!: string;
  @IsString() @Matches(/\S/) @MaxLength(120) accountHolder!: string;
  @IsOptional() @IsString() @MaxLength(150) branch?: string;
  @Matches(DATE) effectiveFrom!: string;
  @IsEnum(PolicyStatus) dataStatus!: PolicyStatus;
  @IsString() @Matches(/\S/) @MaxLength(2000) reason!: string;
}
export class DependentDto {
  @IsString() @Matches(/\S/) @MaxLength(120) fullName!: string;
  @IsString() @Matches(/\S/) @MaxLength(40) relationship!: string;
  @IsOptional() @IsString() @MaxLength(20) taxCode?: string;
  @IsOptional() @Matches(DATE) birthDate?: string;
  @Matches(MONTH) deductionFromMonth!: string;
  @IsOptional() @Matches(MONTH) deductionToMonth?: string;
  @IsOptional() @IsString() @MaxLength(500) evidenceReference?: string;
  @IsEnum(PolicyStatus) dataStatus!: PolicyStatus;
  @IsString() @Matches(/\S/) @MaxLength(2000) reason!: string;
}
export class DependentVersionDto extends DependentDto {
  @IsInt() @Min(1) expectedVersion!: number;
}
export class TaxProfileDto {
  @IsEnum(TaxResidency) residency!: TaxResidency;
  @IsOptional() @IsString() @MaxLength(500) commitmentReference?: string;
  @IsOptional() @IsString() @MaxLength(80) commitmentTemplateVersion?: string;
  @IsBoolean() finalizationAuthorized!: boolean;
  @Matches(DATE) effectiveFrom!: string;
  @IsOptional() @Matches(DATE) effectiveTo?: string;
  @IsEnum(PolicyStatus) dataStatus!: PolicyStatus;
  @IsString() @Matches(/\S/) @MaxLength(2000) reason!: string;
}
export class SpecialStatusDto {
  @IsEnum(EmployeeSpecialStatusType) statusType!: EmployeeSpecialStatusType;
  @IsOptional() @IsString() @MaxLength(80) workPermitNumber?: string;
  @IsOptional() @Matches(DATE) permitExpiry?: string;
  @IsString() @Matches(/\S/) @MaxLength(500) reference!: string;
  @Matches(DATE) effectiveFrom!: string;
  @IsOptional() @Matches(DATE) effectiveTo?: string;
  @IsEnum(PolicyStatus) dataStatus!: PolicyStatus;
  @IsString() @Matches(/\S/) @MaxLength(2000) reason!: string;
}
export class DependentCountQueryDto {
  @Matches(MONTH) month!: string;
}
