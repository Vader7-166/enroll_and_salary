import { Type } from "class-transformer";
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { EmployeeStatus, Gender } from "@prisma/client";

export class EmployeeQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
  @IsOptional() @IsString() @MaxLength(120) search?: string;
  @IsOptional() @IsUUID() orgUnitId?: string;
  @IsOptional() @IsEnum(EmployeeStatus) status?: EmployeeStatus;
}

export class CreateEmployeeDto {
  @IsString() @Matches(/^[A-Z0-9][A-Z0-9_-]{1,31}$/) code!: string;
  @IsString() @Length(2, 120) fullName!: string;
  @IsEnum(Gender) gender!: Gender;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) dob!: string;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) hireDate!: string;
  @IsOptional() @IsString() @Length(2, 80) nationality?: string;
  @IsOptional() @IsEmail() @MaxLength(150) email?: string;
  @IsOptional() @IsString() @Matches(/^\+?[0-9 ()-]{6,30}$/) phone?: string;
  @IsUUID() orgUnitId!: string;
  @IsOptional() @IsUUID() jobTitleId?: string;
}
