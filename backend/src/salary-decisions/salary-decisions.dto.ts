import { RetroCandidateStatus, SalaryBasis } from "@prisma/client";
import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEnum, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateNested } from "class-validator";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export class SalaryLineDto {
  /** Omitted for the agreed (contract) salary. */
  @IsOptional() @IsUUID() componentId?: string;
  @IsString() @MaxLength(20) amount!: string;
  @IsEnum(SalaryBasis) salaryBasis!: SalaryBasis;
}
export class CreateSalaryDecisionDto {
  @IsString() @Matches(/\S/) @MaxLength(80) decisionNumber!: string;
  @Matches(DATE) decisionDate!: string;
  @Matches(DATE) effectiveFrom!: string;
  @IsString() @Matches(/\S/) @MaxLength(2000) reason!: string;
  @IsString() @Matches(/\S/) @MaxLength(1000) legalBasis!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => SalaryLineDto) lines!: SalaryLineDto[];
  @IsOptional() @IsString() @MaxLength(2000) warningAcknowledgement?: string;
}
export class SalaryTimelineQueryDto {
  @Matches(DATE) from!: string;
  @Matches(DATE) to!: string;
}
export class RetroCandidateQueryDto {
  @IsOptional() @IsEnum(RetroCandidateStatus) status?: RetroCandidateStatus;
}
export class RetroCandidateActionDto {
  @IsString() @Matches(/\S/) @MaxLength(2000) note!: string;
}
