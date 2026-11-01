import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, ValidateNested } from "class-validator";
import { BANK_FIELDS, BANK_FORMATS } from "./bank-file";

export class BankColumnDto {
  @IsIn(BANK_FIELDS) field!: (typeof BANK_FIELDS)[number];
  @IsString() @Matches(/\S/) @MaxLength(100) header!: string;
  @IsOptional() @IsIn(BANK_FORMATS) format?: (typeof BANK_FORMATS)[number];
}
export class CreateTemplateDto {
  @IsString() @MaxLength(20) bankCode!: string;
  @IsString() @Matches(/\S/) @MaxLength(200) name!: string;
  @IsIn(["CSV", "XLSX"]) fileType!: "CSV" | "XLSX";
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => BankColumnDto) columns!: BankColumnDto[];
  @IsBoolean() splitBySite!: boolean;
  @IsOptional() @IsBoolean() includeHeader?: boolean;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsIn(["SIMULATION", "BUSINESS_CONFIRMED"]) status!: "SIMULATION" | "BUSINESS_CONFIRMED";
  @IsString() @Matches(/\S/) @MaxLength(2000) reason!: string;
}
export class CreateBatchDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @IsUUID("4", { each: true }) sheetIds!: string[];
  @IsUUID() templateId!: string;
  @IsString() @MaxLength(200) reauthToken!: string;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
}
export class MarkPaidDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/) paidDate!: string;
  @IsInt() @Min(1) revision!: number;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
}
export class CancelBatchDto {
  @IsInt() @Min(1) revision!: number;
  @IsString() @Matches(/\S/) @MaxLength(2000) reason!: string;
}
