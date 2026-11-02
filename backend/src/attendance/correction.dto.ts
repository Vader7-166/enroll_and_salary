import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, ValidateNested } from "class-validator";
import { AttendanceBoardQuery } from "./attendance.dto";
export class CorrectionIntervalDto {
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/) startAt!: string;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/) endAt!: string;
}
export class CorrectionItemDto {
  @IsUUID() employeeId!: string;
  @IsUUID() orgUnitId!: string;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) workDate!: string;
  @IsOptional() @IsArray() @ArrayMaxSize(8) @ValidateNested({ each: true }) @Type(() => CorrectionIntervalDto) intervals?: CorrectionIntervalDto[] | null;
  @IsBoolean() excuseLateEarly!: boolean;
}
export class CreateCorrectionDto {
  @IsUUID() periodId!: string;
  @IsIn(["EXPLANATION", "CORRECTION"]) kind!: "EXPLANATION" | "CORRECTION";
  @IsString() @Matches(/\S/) @MaxLength(2000) reason!: string;
  @IsOptional() @IsString() @MaxLength(2000) evidenceReference?: string;
  @IsOptional() @IsString() @MaxLength(2000) incidentReference?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => CorrectionItemDto) items!: CorrectionItemDto[];
}
export class UpdateCorrectionDto extends CreateCorrectionDto { @IsInt() @Min(1) revision!: number; }
export class CorrectionActionDto { @IsInt() @Min(1) revision!: number; @IsOptional() @IsString() @Matches(/\S/) @MaxLength(2000) reason?: string; }
export class CorrectionQueryDto extends AttendanceBoardQuery {
  @IsOptional() @IsIn(["DRAFT", "PENDING", "RETURNED", "REJECTED", "APPROVED"]) status?: string;
}
export class CorrectionTargetQueryDto extends AttendanceBoardQuery { @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) workDate!: string; }
