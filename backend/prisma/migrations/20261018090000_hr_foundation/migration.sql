-- CreateEnum
CREATE TYPE "ApplicationBasis" AS ENUM ('WORK_DATE', 'TAX_YEAR', 'PAYMENT_DATE');

-- CreateEnum
CREATE TYPE "SitePolicyKey" AS ENUM ('CUTOFF_DAY');

-- CreateEnum
CREATE TYPE "PolicyStatus" AS ENUM ('SIMULATION', 'BUSINESS_CONFIRMED');

-- CreateEnum
CREATE TYPE "BusinessPeriodType" AS ENUM ('ATTENDANCE');

-- CreateEnum
CREATE TYPE "BusinessPeriodStatus" AS ENUM ('PLANNED', 'OPEN', 'CLOSED', 'LOCKED');

-- CreateEnum
CREATE TYPE "EmploymentContractType" AS ENUM ('INDEFINITE', 'FIXED_TERM', 'PROBATION', 'UNDER_ONE_MONTH', 'PIECEWORK', 'COLLABORATOR');

-- CreateEnum
CREATE TYPE "EmploymentContractStatus" AS ENUM ('DRAFT', 'ACTIVE');

-- CreateEnum
CREATE TYPE "SalaryBasis" AS ENUM ('MONTHLY', 'HOURLY');

-- CreateEnum
CREATE TYPE "ProbationClass" AS ENUM ('TECHNICAL', 'WORKER');

-- CreateTable
CREATE TABLE "legal_parameter" (
    "id" UUID NOT NULL,
    "param_code" VARCHAR(80) NOT NULL,
    "scope_key" VARCHAR(64) NOT NULL,
    "subject_type" VARCHAR(64) NOT NULL,
    "application_basis" "ApplicationBasis" NOT NULL,
    "value" JSONB NOT NULL,
    "unit" VARCHAR(32) NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "document_effective_date" DATE NOT NULL,
    "legal_basis" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_parameter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_policy" (
    "id" UUID NOT NULL,
    "org_unit_id" UUID NOT NULL,
    "policy_key" "SitePolicyKey" NOT NULL,
    "value" INTEGER NOT NULL,
    "status" "PolicyStatus" NOT NULL,
    "decision_reference" VARCHAR(200) NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "site_policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_period" (
    "id" UUID NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "period_type" "BusinessPeriodType" NOT NULL DEFAULT 'ATTENDANCE',
    "scope_org_unit_id" UUID NOT NULL,
    "date_from" DATE NOT NULL,
    "date_to" DATE NOT NULL,
    "cutoff_day" INTEGER NOT NULL,
    "cutoff_policy_id" UUID NOT NULL,
    "status" "BusinessPeriodStatus" NOT NULL DEFAULT 'PLANNED',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "opened_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_period_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employment_contract" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "number" VARCHAR(80) NOT NULL,
    "contract_type" "EmploymentContractType" NOT NULL,
    "status" "EmploymentContractStatus" NOT NULL DEFAULT 'DRAFT',
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "signed_date" DATE NOT NULL,
    "salary_cipher" TEXT NOT NULL,
    "official_salary_cipher" TEXT,
    "salary_basis" "SalaryBasis" NOT NULL,
    "probation_class" "ProbationClass",
    "insurance_eligible" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employment_contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_annex" (
    "id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "number" VARCHAR(80) NOT NULL,
    "effective_from" DATE NOT NULL,
    "signed_date" DATE NOT NULL,
    "content_cipher" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_annex_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "personnel_transfer" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "from_org_unit_id" UUID NOT NULL,
    "to_org_unit_id" UUID NOT NULL,
    "effective_from" DATE NOT NULL,
    "decision_number" VARCHAR(80) NOT NULL,
    "decision_date" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "personnel_transfer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "legal_parameter_param_code_scope_key_subject_type_applicati_idx" ON "legal_parameter"("param_code", "scope_key", "subject_type", "application_basis", "effective_from", "effective_to");

-- CreateIndex
CREATE INDEX "site_policy_org_unit_id_policy_key_effective_from_effective_idx" ON "site_policy"("org_unit_id", "policy_key", "effective_from", "effective_to");

-- CreateIndex
CREATE INDEX "business_period_period_type_scope_org_unit_id_date_from_dat_idx" ON "business_period"("period_type", "scope_org_unit_id", "date_from", "date_to");

-- CreateIndex
CREATE UNIQUE INDEX "business_period_code_key" ON "business_period"("code");

-- CreateIndex
CREATE INDEX "employment_contract_employee_id_status_start_date_end_date_idx" ON "employment_contract"("employee_id", "status", "start_date", "end_date");

-- CreateIndex
CREATE UNIQUE INDEX "employment_contract_employee_id_number_key" ON "employment_contract"("employee_id", "number");

-- CreateIndex
CREATE INDEX "contract_annex_contract_id_effective_from_idx" ON "contract_annex"("contract_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "contract_annex_contract_id_number_key" ON "contract_annex"("contract_id", "number");

-- CreateIndex
CREATE INDEX "personnel_transfer_employee_id_effective_from_idx" ON "personnel_transfer"("employee_id", "effective_from");

-- CreateIndex
CREATE INDEX "personnel_transfer_from_org_unit_id_effective_from_idx" ON "personnel_transfer"("from_org_unit_id", "effective_from");

-- CreateIndex
CREATE INDEX "personnel_transfer_to_org_unit_id_effective_from_idx" ON "personnel_transfer"("to_org_unit_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "personnel_transfer_employee_id_effective_from_key" ON "personnel_transfer"("employee_id", "effective_from");

-- AddForeignKey
ALTER TABLE "site_policy" ADD CONSTRAINT "site_policy_org_unit_id_fkey" FOREIGN KEY ("org_unit_id") REFERENCES "org_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_period" ADD CONSTRAINT "business_period_scope_org_unit_id_fkey" FOREIGN KEY ("scope_org_unit_id") REFERENCES "org_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_period" ADD CONSTRAINT "business_period_cutoff_policy_id_fkey" FOREIGN KEY ("cutoff_policy_id") REFERENCES "site_policy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_contract" ADD CONSTRAINT "employment_contract_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_annex" ADD CONSTRAINT "contract_annex_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "employment_contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personnel_transfer" ADD CONSTRAINT "personnel_transfer_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personnel_transfer" ADD CONSTRAINT "personnel_transfer_from_org_unit_id_fkey" FOREIGN KEY ("from_org_unit_id") REFERENCES "org_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personnel_transfer" ADD CONSTRAINT "personnel_transfer_to_org_unit_id_fkey" FOREIGN KEY ("to_org_unit_id") REFERENCES "org_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
