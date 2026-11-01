import { IsIn, IsISO8601, IsOptional, IsString, Matches, MaxLength } from "class-validator";

export class AuditQueryDto {
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;
  @IsOptional() @IsString() @MaxLength(120) actor?: string;
  @IsOptional() @IsString() @MaxLength(40) action?: string;
  @IsOptional() @IsString() @MaxLength(80) entityType?: string;
  @IsOptional() @IsString() @MaxLength(120) entityId?: string;
  @IsOptional() @IsString() @MaxLength(40) result?: string;
  @IsOptional() @Matches(/^\d{1,19}$/) cursor?: string;
  @IsOptional() @IsIn(["20", "50", "100", "200"]) pageSize?: string;
}
