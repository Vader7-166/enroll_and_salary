import { Type } from "class-transformer";
import { IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from "class-validator";
export class AttendanceImportDto {
  @IsUUID() siteId!: string;
  @IsUUID() referencePeriodId!: string;
  @IsOptional() @IsUUID() profileId?: string;
}
export class AttendanceProcessDto {
  @IsUUID() siteId!: string;
  @IsUUID() referencePeriodId!: string;
}
export class AttendanceProfileDto {
  @IsUUID() siteId!: string;
  @IsString() @Matches(/\S/) @MaxLength(120) name!: string;
  @IsObject() mapping!: Record<string, unknown>;
}
export class AttendancePageQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
  @IsOptional() @IsUUID() siteId?: string;
}
export class AttendanceBoardQuery extends AttendancePageQuery {
  @IsUUID() periodId!: string;
  @IsOptional() @IsUUID() orgUnitId?: string;
  @IsOptional() @IsString() @MaxLength(120) search?: string;
  @IsOptional() @IsIn(["true", "false"]) exceptionsOnly?: string;
}
export class AttendancePunchQuery extends AttendancePageQuery {
  @IsOptional() @IsIn(["PROCESSED", "WAITING", "LATE", "UNMATCHED", "AMBIGUOUS", "SUPPRESSED"]) state?: string;
}
