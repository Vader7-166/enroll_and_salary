import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";
import {
  EmploymentContractType,
  ProbationClass,
  SalaryBasis,
} from "@prisma/client";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONEY = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;

export class CreateContractDto {
  @IsString() @MinLength(1) @MaxLength(80) number!: string;
  @IsEnum(EmploymentContractType) type!: EmploymentContractType;
  @Matches(ISO_DATE, { message: "startDate phải có dạng YYYY-MM-DD." }) startDate!: string;
  @IsOptional() @Matches(ISO_DATE, { message: "endDate phải có dạng YYYY-MM-DD." }) endDate?: string;
  @Matches(ISO_DATE, { message: "signedDate phải có dạng YYYY-MM-DD." }) signedDate!: string;
  @Matches(MONEY, { message: "salary phải là số tiền thập phân dương hợp lệ." }) salary!: string;
  @IsOptional() @Matches(MONEY, { message: "officialSalary phải là số tiền thập phân dương hợp lệ." }) officialSalary?: string;
  @IsEnum(SalaryBasis) salaryBasis!: SalaryBasis;
  @IsOptional() @IsEnum(ProbationClass) probationClass?: ProbationClass;
}

export class CreateContractAnnexDto {
  @IsString() @MinLength(1) @MaxLength(80) number!: string;
  @Matches(ISO_DATE, { message: "effectiveFrom phải có dạng YYYY-MM-DD." }) effectiveFrom!: string;
  @Matches(ISO_DATE, { message: "signedDate phải có dạng YYYY-MM-DD." }) signedDate!: string;
  @IsString() @MinLength(1) @MaxLength(20_000) content!: string;
}

export class AssignmentQueryDto {
  @IsOptional() @Matches(ISO_DATE, { message: "asOf phải có dạng YYYY-MM-DD." }) asOf?: string;
}

export class CreateTransferDto {
  @IsUUID() toOrgUnitId!: string;
  @Matches(ISO_DATE, { message: "effectiveFrom phải có dạng YYYY-MM-DD." }) effectiveFrom!: string;
  @IsString() @MinLength(1) @MaxLength(80) decisionNumber!: string;
  @Matches(ISO_DATE, { message: "decisionDate phải có dạng YYYY-MM-DD." }) decisionDate!: string;
  @IsString() @MinLength(1) @MaxLength(4_000) reason!: string;
}
