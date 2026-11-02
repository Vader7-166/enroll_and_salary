import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsEnum, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, ValidateNested } from "class-validator";
import { OvertimeStatus } from "@prisma/client";

export class OvertimeMemberDto {
  @IsUUID() employeeId!: string;
  @IsString() @Matches(/\S/) @MaxLength(500) consentReference!: string;
}
export class CreateOvertimeDto {
  @IsUUID() teamOrgUnitId!: string;
  @IsString() @Matches(/\S/) @MaxLength(160) title!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) workDate!: string;
  @IsISO8601({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00(?:\.000)?(?:Z|\+07:00)$/) startAt!: string;
  @IsISO8601({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00(?:\.000)?(?:Z|\+07:00)$/) endAt!: string;
  @IsString() @Matches(/\S/) @MaxLength(2000) reason!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ArrayUnique((m: OvertimeMemberDto) => m.employeeId)
  @ValidateNested({ each: true }) @Type(() => OvertimeMemberDto) members!: OvertimeMemberDto[];
}
export class UpdateOvertimeDto extends CreateOvertimeDto {
  @IsInt() @Min(0) revision!: number;
}
export class OvertimeActionDto {
  @IsInt() @Min(0) revision!: number;
  @IsOptional() @IsString() @MaxLength(2000) reason?: string;
}
export class OvertimeQueryDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/) dateFrom!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) dateTo!: string;
  @IsOptional() @IsUUID() teamOrgUnitId?: string;
  @IsOptional() @IsEnum(OvertimeStatus) status?: OvertimeStatus;
}
export class OvertimeMembersQueryDto {
  @IsUUID() teamOrgUnitId!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) workDate!: string;
}
