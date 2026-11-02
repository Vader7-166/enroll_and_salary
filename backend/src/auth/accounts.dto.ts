import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEnum, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { AccountStatus, RoleCode } from '@prisma/client';

export class DatedGrantDto {
  @IsEnum(RoleCode) roleCode!: RoleCode;
  @IsUUID() scopeOrgUnitId!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) effectiveFrom!: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) effectiveTo?: string | null;
}
export class DatedExclusionDto {
  @IsUUID() employeeId!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) effectiveFrom!: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) effectiveTo?: string | null;
}
export class AccountDetailsDto {
  @IsString() @MinLength(1) @MaxLength(120) displayName!: string;
  @IsOptional() @IsUUID() employeeId?: string | null;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => DatedGrantDto) assignments!: DatedGrantDto[];
  @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => DatedExclusionDto) exclusions!: DatedExclusionDto[];
  @IsString() @MinLength(3) @MaxLength(1000) reason!: string;
}
export class CreateAccountDto extends AccountDetailsDto {
  @Matches(/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,63}$/) username!: string;
  @IsString() @MaxLength(128) password!: string;
}
export class UpdateAccountDto extends AccountDetailsDto {
  @IsInt() @Min(1) revision!: number;
}
export class AccountStatusDto {
  @IsInt() @Min(1) revision!: number;
  @IsEnum(AccountStatus) status!: AccountStatus;
  @IsString() @MinLength(3) @MaxLength(1000) reason!: string;
}
export class ResetPasswordDto {
  @IsInt() @Min(1) revision!: number;
  @IsString() @MaxLength(128) password!: string;
  @IsString() @MinLength(3) @MaxLength(1000) reason!: string;
}
export class ChangePasswordDto {
  @IsString() @MinLength(1) @MaxLength(1024) currentPassword!: string;
  @IsString() @MaxLength(128) newPassword!: string;
}
