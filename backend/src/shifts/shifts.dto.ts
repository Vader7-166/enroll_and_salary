import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested } from "class-validator";
import { ShiftKind, ShiftPlanStatus } from "@prisma/client";

export class ShiftQueryDto {
  @IsOptional() @IsUUID() orgUnitId?: string;
}
export class MembersQueryDto {
  @IsUUID() orgUnitId!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) workDate!: string;
}
export class CreateShiftDto {
  @IsUUID() orgUnitId!: string;
  @Matches(/^[A-Z0-9][A-Z0-9_-]{0,31}$/) code!: string;
  @IsString() @Matches(/\S/) @MaxLength(120) name!: string;
  @IsEnum(ShiftKind) kind!: ShiftKind;
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) startTime!: string;
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) endTime!: string;
  @IsBoolean() crossesMidnight!: boolean;
  @IsInt() @Min(0) @Max(1439) breakStartOffset!: number;
  @IsInt() @Min(0) @Max(1439) breakMinutes!: number;
  @IsBoolean() paidBreak!: boolean;
}
export class UpdateShiftDto extends CreateShiftDto {
  @IsInt() @Min(0) revision!: number;
}
export class ShiftActiveDto {
  @IsInt() @Min(0) revision!: number;
  @IsBoolean() active!: boolean;
}
export class PlanSlotDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/) workDate!: string;
  @IsUUID() shiftId!: string;
  // Omitted = every direct primary member of the unit on this work date.
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ArrayUnique() @IsUUID("all", { each: true }) employeeIds?: string[];
}
export class CreatePlanDto {
  @IsUUID() teamOrgUnitId!: string;
  @IsString() @Matches(/\S/) @MaxLength(160) title!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(31) @ValidateNested({ each: true }) @Type(() => PlanSlotDto) slots!: PlanSlotDto[];
}
export class UpdatePlanDto extends CreatePlanDto {
  @IsInt() @Min(0) revision!: number;
}
export class PlanActionDto {
  @IsInt() @Min(0) revision!: number;
  @IsOptional() @IsString() @MaxLength(2000) reason?: string;
}
export class PlanQueryDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/) dateFrom!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) dateTo!: string;
  @IsOptional() @IsUUID() teamOrgUnitId?: string;
  @IsOptional() @IsEnum(ShiftPlanStatus) status?: ShiftPlanStatus;
}
