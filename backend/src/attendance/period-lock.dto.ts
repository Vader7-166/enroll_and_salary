import { Equals, IsBoolean, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min } from "class-validator";

export class AttendancePeriodLockQuery {
  @IsUUID()
  periodId!: string;
}

export class AttendancePeriodLockDto extends AttendancePeriodLockQuery {
  @IsInt()
  @Min(0)
  revision!: number;

  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  sourceHash!: string;

  @Equals(true)
  reviewed!: boolean;

  @IsBoolean()
  acknowledgeWarnings!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class AttendancePeriodReturnDto extends AttendancePeriodLockQuery {
  @IsInt()
  @Min(0)
  revision!: number;

  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  sourceHash!: string;

  @IsString()
  @Matches(/\S/)
  @MaxLength(2000)
  reason!: string;
}
