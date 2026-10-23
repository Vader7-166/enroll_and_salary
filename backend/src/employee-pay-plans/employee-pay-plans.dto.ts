import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsEnum, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested } from "class-validator";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class EmployeePayPlanQueryDto {
  @IsOptional() @Matches(DATE) asOf?: string;
  @IsOptional() @IsUUID() orgUnitId?: string;
  @IsOptional() @IsString() @MaxLength(150) search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
}

export class EmployeePayPlanEmployeeQueryDto extends EmployeePayPlanQueryDto {}
export class EmployeePayPlanDetailQueryDto { @IsOptional() @Matches(DATE) asOf?: string; }
export class EmployeePayPlanCatalogueQueryDto extends EmployeePayPlanDetailQueryDto { @IsUUID() employeeId!: string; }

export class PlanLineDto {
  @IsUUID() componentId!: string;
  @IsEnum(["BASE", "ADDITIONAL", "NOT_APPLICABLE"] as const) role!: "BASE" | "ADDITIONAL" | "NOT_APPLICABLE";
  @IsEnum(["TIME", "PRODUCT", "PIECEWORK", "COMMISSION", "THREE_P", "ALLOWANCE", "BONUS", "DEDUCTION", "EMPLOYER_COST"] as const) sourceType!: "TIME" | "PRODUCT" | "PIECEWORK" | "COMMISSION" | "THREE_P" | "ALLOWANCE" | "BONUS" | "DEDUCTION" | "EMPLOYER_COST";
  @IsOptional() @IsString() @Matches(/\S/) @MaxLength(80) formulaCode?: string;
  @IsString() @Matches(/\S/) @MaxLength(1000) sourceReference!: string;
  @IsOptional() @IsString() @Matches(/\S/) @MaxLength(500) separateDecisionReference?: string;
  @IsEnum(["INDIVIDUAL", "CONFIRMED_TEAM_ALLOCATION"] as const) allocation!: "INDIVIDUAL" | "CONFIRMED_TEAM_ALLOCATION";
  @IsOptional() @IsString() @Matches(/\S/) @MaxLength(500) allocationReference?: string;
}

export class PlanVersionInputDto {
  @IsString() @Matches(/\S/) @MaxLength(150) name!: string;
  @IsEnum(["MONTHLY", "DAILY", "HOURLY", "PRODUCT", "PIECEWORK", "COMMISSION", "THREE_P"] as const) payMode!: "MONTHLY" | "DAILY" | "HOURLY" | "PRODUCT" | "PIECEWORK" | "COMMISSION" | "THREE_P";
  @IsEnum(["SIMULATION", "BUSINESS_CONFIRMED"] as const) status!: "SIMULATION" | "BUSINESS_CONFIRMED";
  @IsString() @Matches(/\S/) @MaxLength(500) decisionReference!: string;
  @IsString() @Matches(/\S/) @MaxLength(2000) reason!: string;
  @Matches(DATE) effectiveFrom!: string;
  @IsOptional() @Matches(DATE) effectiveTo?: string;
  @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => PlanLineDto) lines!: PlanLineDto[];
}

export class CreateEmployeePayPlanDto extends PlanVersionInputDto { @IsUUID() employeeId!: string; }
export class CreateEmployeePayPlanVersionDto extends PlanVersionInputDto { @Type(() => Number) @IsInt() @Min(1) revision!: number; }
