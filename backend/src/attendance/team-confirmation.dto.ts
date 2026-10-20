import { ArrayUnique, Equals, IsArray, IsBoolean, IsISO8601, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min } from "class-validator";
export class TeamReviewQuery {
  @IsUUID() periodId!: string;
  @IsUUID() teamOrgUnitId!: string;
}
export class TeamPeriodQuery { @IsUUID() periodId!: string; }
export class TeamConfirmationDto extends TeamReviewQuery {
  @IsInt() @Min(0) revision!: number;
  @IsString() @Matches(/^[a-f0-9]{64}$/) sourceHash!: string;
  @Equals(true) reviewed!: boolean;
  @IsBoolean() acknowledgeWarnings!: boolean;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
}
export class SourceCoverageDto extends TeamReviewQuery {
  @IsInt() @Min(0) revision!: number;
  @IsString() @Matches(/^[a-f0-9]{64}$/) sourceHash!: string;
  @IsISO8601({strict:true}) @Matches(/(?:Z|[+-]\d{2}:\d{2})$/) coveredFrom!: string;
  @IsISO8601({strict:true}) @Matches(/(?:Z|[+-]\d{2}:\d{2})$/) coveredUntil!: string;
  @IsString() @Matches(/\S/) @MaxLength(500) reference!: string;
  @IsString() @Matches(/\S/) @MaxLength(2000) reason!: string;
  @IsArray() @ArrayUnique() @IsUUID('all',{each:true}) batchIds!: string[];
}
