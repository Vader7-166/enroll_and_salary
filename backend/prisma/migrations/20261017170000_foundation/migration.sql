-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "RoleCode" AS ENUM ('TT', 'QD', 'KT', 'AD');

-- CreateEnum
CREATE TYPE "OrgUnitType" AS ENUM ('COMPANY', 'SITE', 'BLOCK', 'DEPARTMENT', 'TEAM');

-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('ACTIVE', 'TERMINATED');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateTable
CREATE TABLE "wage_region" (
    "code" VARCHAR(3) NOT NULL,
    "name" VARCHAR(100) NOT NULL,

    CONSTRAINT "wage_region_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "site" (
    "id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "address" TEXT NOT NULL,
    "wage_region_code" VARCHAR(3) NOT NULL,

    CONSTRAINT "site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_unit" (
    "id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,

    CONSTRAINT "org_unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_unit_version" (
    "id" UUID NOT NULL,
    "org_unit_id" UUID NOT NULL,
    "parent_id" UUID,
    "site_id" UUID,
    "name" VARCHAR(150) NOT NULL,
    "unit_type" "OrgUnitType" NOT NULL,
    "level" INTEGER NOT NULL,
    "cost_center_code" VARCHAR(40),
    "accounting_account" VARCHAR(10),
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,

    CONSTRAINT "org_unit_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_grade" (
    "id" UUID NOT NULL,
    "code" VARCHAR(10) NOT NULL,
    "name" VARCHAR(100) NOT NULL,

    CONSTRAINT "job_grade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_title" (
    "id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "job_level" INTEGER NOT NULL,
    "job_grade_id" UUID NOT NULL,

    CONSTRAINT "job_title_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee" (
    "id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "full_name" VARCHAR(120) NOT NULL,
    "gender" "Gender" NOT NULL,
    "dob" DATE NOT NULL,
    "nationality" VARCHAR(80) NOT NULL DEFAULT 'Việt Nam',
    "email" VARCHAR(150),
    "phone" VARCHAR(30),
    "hire_date" DATE NOT NULL,
    "status" "EmployeeStatus" NOT NULL DEFAULT 'ACTIVE',
    "termination_date" DATE,
    "job_title_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_assignment" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "org_unit_id" UUID NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT true,
    "allocation_ratio" DECIMAL(5,2) NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,

    CONSTRAINT "org_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role" (
    "code" "RoleCode" NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "function_permissions" TEXT[],

    CONSTRAINT "role_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "user_account" (
    "id" UUID NOT NULL,
    "username" VARCHAR(64) NOT NULL,
    "display_name" VARCHAR(120) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "employee_id" UUID,
    "failed_logins" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_assignment" (
    "id" UUID NOT NULL,
    "user_account_id" UUID NOT NULL,
    "role_code" "RoleCode" NOT NULL,
    "scope_org_unit_id" UUID NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,

    CONSTRAINT "role_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_exclusion" (
    "id" UUID NOT NULL,
    "user_account_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,

    CONSTRAINT "employee_exclusion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "web_session" (
    "id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "user_account_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "absolute_expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "web_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" BIGSERIAL NOT NULL,
    "actor_id" UUID,
    "entity_type" VARCHAR(80) NOT NULL,
    "entity_id" TEXT NOT NULL,
    "action" VARCHAR(40) NOT NULL,
    "result" VARCHAR(40) NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "old_value" JSONB,
    "new_value" JSONB,
    "ip_address" VARCHAR(64),
    "prev_hash" CHAR(64) NOT NULL,
    "record_hash" CHAR(64) NOT NULL,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "site_code_key" ON "site"("code");

-- CreateIndex
CREATE UNIQUE INDEX "org_unit_code_key" ON "org_unit"("code");

-- CreateIndex
CREATE INDEX "org_unit_version_parent_id_effective_from_effective_to_idx" ON "org_unit_version"("parent_id", "effective_from", "effective_to");

-- CreateIndex
CREATE UNIQUE INDEX "job_grade_code_key" ON "job_grade"("code");

-- CreateIndex
CREATE UNIQUE INDEX "job_title_code_key" ON "job_title"("code");

-- CreateIndex
CREATE UNIQUE INDEX "employee_code_key" ON "employee"("code");

-- CreateIndex
CREATE INDEX "employee_full_name_idx" ON "employee"("full_name");

-- CreateIndex
CREATE INDEX "org_assignment_org_unit_id_effective_from_effective_to_idx" ON "org_assignment"("org_unit_id", "effective_from", "effective_to");

-- CreateIndex
CREATE UNIQUE INDEX "user_account_username_key" ON "user_account"("username");

-- CreateIndex
CREATE INDEX "role_assignment_user_account_id_effective_from_effective_to_idx" ON "role_assignment"("user_account_id", "effective_from", "effective_to");

-- CreateIndex
CREATE INDEX "employee_exclusion_user_account_id_employee_id_idx" ON "employee_exclusion"("user_account_id", "employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "web_session_token_hash_key" ON "web_session"("token_hash");

-- CreateIndex
CREATE INDEX "web_session_user_account_id_idx" ON "web_session"("user_account_id");

-- AddForeignKey
ALTER TABLE "site" ADD CONSTRAINT "site_wage_region_code_fkey" FOREIGN KEY ("wage_region_code") REFERENCES "wage_region"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_unit_version" ADD CONSTRAINT "org_unit_version_org_unit_id_fkey" FOREIGN KEY ("org_unit_id") REFERENCES "org_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_unit_version" ADD CONSTRAINT "org_unit_version_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "org_unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_unit_version" ADD CONSTRAINT "org_unit_version_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_title" ADD CONSTRAINT "job_title_job_grade_id_fkey" FOREIGN KEY ("job_grade_id") REFERENCES "job_grade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee" ADD CONSTRAINT "employee_job_title_id_fkey" FOREIGN KEY ("job_title_id") REFERENCES "job_title"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_assignment" ADD CONSTRAINT "org_assignment_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_assignment" ADD CONSTRAINT "org_assignment_org_unit_id_fkey" FOREIGN KEY ("org_unit_id") REFERENCES "org_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_account" ADD CONSTRAINT "user_account_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_assignment" ADD CONSTRAINT "role_assignment_user_account_id_fkey" FOREIGN KEY ("user_account_id") REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_assignment" ADD CONSTRAINT "role_assignment_role_code_fkey" FOREIGN KEY ("role_code") REFERENCES "role"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_assignment" ADD CONSTRAINT "role_assignment_scope_org_unit_id_fkey" FOREIGN KEY ("scope_org_unit_id") REFERENCES "org_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_exclusion" ADD CONSTRAINT "employee_exclusion_user_account_id_fkey" FOREIGN KEY ("user_account_id") REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_exclusion" ADD CONSTRAINT "employee_exclusion_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "web_session" ADD CONSTRAINT "web_session_user_account_id_fkey" FOREIGN KEY ("user_account_id") REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "user_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
