import { Equals, IsBoolean, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min } from "class-validator";
export class WorkshopPeriodQuery { @IsUUID() periodId!: string; }
export class WorkshopReviewQuery extends WorkshopPeriodQuery { @IsUUID() workshopOrgUnitId!: string; }
export class WorkshopClosureDto extends WorkshopReviewQuery {
  @IsInt() @Min(0) revision!: number;
  @IsString() @Matches(/^[a-f0-9]{64}$/) sourceHash!: string;
  @Equals(true) reviewed!: boolean;
  @IsBoolean() acknowledgeWarnings!: boolean;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
}
export class WorkshopReturnDto extends WorkshopReviewQuery { @IsInt() @Min(1) revision!: number; @IsString() @Matches(/^[a-f0-9]{64}$/) sourceHash!: string; @IsString() @Matches(/\S/) @MaxLength(2000) reason!: string; }
