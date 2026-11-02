import { Type } from "class-transformer";
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from "class-validator";
export class LeaveRequestQueryDto {
  @IsOptional() @IsString() @MaxLength(120) search?: string;
  @IsOptional() @IsIn(["DRAFT", "PENDING", "RETURNED", "APPROVED", "REJECTED", "CANCELLED"]) status?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
}
export class CreateLeaveRequestDto {
  @IsUUID() employeeId!: string;
  @IsUUID() leaveTypeId!: string;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) dateFrom!: string;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) dateTo!: string;
  @IsIn(["DAY", "HALF", "HOUR"]) unit!: "DAY" | "HALF" | "HOUR";
  @IsOptional() @IsIn(["FIRST", "SECOND"]) half?: "FIRST" | "SECOND";
  @IsOptional() @IsISO8601({ strict: true }) startAt?: string;
  @IsOptional() @IsISO8601({ strict: true }) endAt?: string;
  @IsString() @Matches(/\S/) @MaxLength(2000) reason!: string;
  @IsOptional() @IsString() @MaxLength(500) documentReference?: string;
}
export class UpdateLeaveRequestDto extends CreateLeaveRequestDto {
  @IsInt() @Min(1) revision!: number;
}
export class SubmitLeaveRequestDto {
  @IsInt() @Min(1) revision!: number;
}
export class LeaveRequestActionDto extends SubmitLeaveRequestDto {
  @IsOptional() @IsString() @MaxLength(2000) reason?: string;
}
