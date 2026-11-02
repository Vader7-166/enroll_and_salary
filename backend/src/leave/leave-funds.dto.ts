import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayUnique, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from "class-validator";

export class LeaveFundQueryDto {
  @Type(() => Number) @IsInt() @Min(1900) @Max(2200) year!: number;
  @IsOptional() @IsUUID() orgUnitId?: string;
  @IsOptional() @IsString() @MaxLength(120) search?: string;
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) asOf?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
}
export class LeaveFundAsOfDto {
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) asOf?: string;
}
export class LeaveFundActionDto {
  @IsUUID() requestId!: string;
  @IsInt() @Min(0) revision!: number;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) effectiveDate!: string;
  @IsString() @Matches(/\S/) @MaxLength(2000) reason!: string;
  @IsString() @Matches(/\S/) @MaxLength(500) reference!: string;
}
export class RecalculateLeaveDto extends LeaveFundActionDto {
  @IsIn(["NORMAL", "HAZARDOUS", "EXTREME"]) workingCondition!: "NORMAL" | "HAZARDOUS" | "EXTREME";
  @IsArray() @ArrayMaxSize(12) @ArrayUnique() @IsInt({ each: true }) @Min(1, { each: true }) @Max(12, { each: true }) eligibleMonths!: number[];
}
export class AdjustLeaveDto extends LeaveFundActionDto {
  @IsString() @Matches(/^-?(?:0|[1-9]\d{0,3})(?:\.\d{1,2})?$/) days!: string;
}
export class TransferLeaveDto extends LeaveFundActionDto {
  @IsInt() @Min(0) targetRevision!: number;
  @IsString() @Matches(/^(?:0|[1-9]\d{0,3})(?:\.\d{1,2})?$/) days!: string;
}
