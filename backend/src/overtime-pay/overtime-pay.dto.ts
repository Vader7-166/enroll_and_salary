import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsISO8601, IsObject, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateNested } from "class-validator";

export class OvertimePayBucketQueryDto {
  @IsUUID() periodId!: string;
  @IsOptional() @IsUUID() orgUnitId?: string;
  @IsOptional() @IsUUID() employeeId?: string;
}
export class RatePreviewIntervalDto {
  @IsISO8601({ strict: true }) startAt!: string;
  @IsISO8601({ strict: true }) endAt!: string;
}
export class RatePreviewDto {
  @IsUUID() orgUnitId!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) workDate!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => RatePreviewIntervalDto) intervals!: RatePreviewIntervalDto[];
  /** Trial values replacing resolved parameters, e.g. { OT_RATE_WEEKDAY: "1.6" }; never persisted. */
  @IsOptional() @IsObject() overrides?: Record<string, string>;
}
export class CompTimeRequestDto {
  @IsUUID() employeeId!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) workDate!: string;
  @IsString() @Matches(/^\d+(?:\.\d{1,6})?$/) hours!: string;
  @IsOptional() @IsString() @MaxLength(2000) reason?: string;
  @IsOptional() @IsIn(["COMP_TIME"]) kind?: "COMP_TIME";
}
