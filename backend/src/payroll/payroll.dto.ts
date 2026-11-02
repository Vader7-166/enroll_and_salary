import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min } from "class-validator";

export class StartRunDto {
  @IsUUID() payrollPeriodId!: string;
  /** Partial re-run for these employees only; omitted means the whole site. */
  @IsOptional() @IsArray() @ArrayMaxSize(5000) @IsUUID("4", { each: true }) employeeIds?: string[];
}
export class ApproveDto {
  @IsInt() @Min(1) revision!: number;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
}
export class ReturnDto {
  @IsInt() @Min(1) revision!: number;
  @IsString() @Matches(/\S/) @MaxLength(2000) reason!: string;
}
export class LockDto {
  @IsInt() @Min(1) revision!: number;
  @IsString() @MaxLength(200) reauthToken!: string;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
}
export class PeriodQueryDto { @IsUUID() payrollPeriodId!: string; }
export class AcknowledgeDto {
  @IsIn(["CP-01", "CP-02", "CP-03", "CP-04", "CP-05", "CP-06", "CP-07", "CP-08", "CP-09"]) code!: string;
  @IsUUID() employeeId!: string;
  @IsString() @Matches(/\S/) @MaxLength(2000) reason!: string;
}
