CREATE EXTENSION IF NOT EXISTS "btree_gist";

CREATE TYPE "EmployeePayMode" AS ENUM ('MONTHLY', 'DAILY', 'HOURLY', 'PRODUCT', 'PIECEWORK', 'COMMISSION', 'THREE_P');
CREATE TYPE "EmployeePayPlanStatus" AS ENUM ('SIMULATION', 'BUSINESS_CONFIRMED');
CREATE TYPE "EmployeePayPlanLineRole" AS ENUM ('BASE', 'ADDITIONAL', 'NOT_APPLICABLE');
CREATE TYPE "EmployeePayPlanSourceType" AS ENUM ('TIME', 'PRODUCT', 'PIECEWORK', 'COMMISSION', 'THREE_P', 'ALLOWANCE', 'BONUS', 'DEDUCTION', 'EMPLOYER_COST');
CREATE TYPE "EmployeePayPlanAllocation" AS ENUM ('INDIVIDUAL', 'CONFIRMED_TEAM_ALLOCATION');

CREATE TABLE "employee_pay_plan" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "employee_id" UUID NOT NULL REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" >= 1),
  CONSTRAINT "employee_pay_plan_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "employee_pay_plan_employee_id_key" UNIQUE ("employee_id")
);

CREATE TABLE "employee_pay_plan_version" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "pay_plan_id" UUID NOT NULL REFERENCES "employee_pay_plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "name" VARCHAR(150) NOT NULL CHECK (btrim("name") <> ''),
  "pay_mode" "EmployeePayMode" NOT NULL,
  "status" "EmployeePayPlanStatus" NOT NULL,
  "decision_reference" VARCHAR(500) NOT NULL CHECK (btrim("decision_reference") <> ''),
  "reason" VARCHAR(2000) NOT NULL CHECK (btrim("reason") <> ''),
  "effective_from" DATE NOT NULL,
  "effective_to" DATE,
  "lines" JSONB NOT NULL CHECK (jsonb_typeof("lines") = 'array' AND jsonb_array_length("lines") > 0),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by_id" UUID NOT NULL REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "employee_pay_plan_version_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "employee_pay_plan_version_pay_plan_id_effective_from_key" UNIQUE ("pay_plan_id", "effective_from"),
  CONSTRAINT "employee_pay_plan_version_range_check" CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from"),
  CONSTRAINT "employee_pay_plan_version_no_overlap" EXCLUDE USING gist ("pay_plan_id" WITH =, daterange("effective_from", COALESCE("effective_to", 'infinity'::date), '[]') WITH &&)
);
CREATE INDEX "employee_pay_plan_version_pay_plan_id_effective_from_effective_to_idx" ON "employee_pay_plan_version"("pay_plan_id", "effective_from", "effective_to");

CREATE FUNCTION employee_pay_plan_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE latest DATE;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Employee pay plan history is immutable'; END IF;
  PERFORM 1 FROM "employee_pay_plan" WHERE "id" = NEW.pay_plan_id FOR UPDATE;
  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - 'effective_to') IS DISTINCT FROM (to_jsonb(OLD) - 'effective_to')
       OR NEW.effective_to IS NULL
       OR NEW.effective_to < (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
       OR (OLD.effective_to IS NOT NULL AND NEW.effective_to >= OLD.effective_to)
    THEN RAISE EXCEPTION 'Employee pay plan history is immutable'; END IF;
  ELSE
    SELECT max("effective_from") INTO latest FROM "employee_pay_plan_version" WHERE "pay_plan_id" = NEW.pay_plan_id;
    IF latest IS NOT NULL AND (NEW.effective_from <= latest OR NEW.effective_from <= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)
    THEN RAISE EXCEPTION 'Employee pay plan successor must be future dated and ordered'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER employee_pay_plan_version_guard BEFORE INSERT OR UPDATE OR DELETE ON "employee_pay_plan_version" FOR EACH ROW EXECUTE FUNCTION employee_pay_plan_version_guard();

CREATE FUNCTION employee_pay_plan_successor_required() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "employee_pay_plan_version" WHERE "pay_plan_id" = NEW.pay_plan_id AND "effective_from" = NEW.effective_to + 1)
  THEN RAISE EXCEPTION 'Employee pay plan validity can only close for a successor'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER employee_pay_plan_successor_required AFTER UPDATE ON "employee_pay_plan_version" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION employee_pay_plan_successor_required();

CREATE FUNCTION employee_pay_plan_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (to_jsonb(NEW) - 'revision') IS DISTINCT FROM (to_jsonb(OLD) - 'revision') OR NEW.revision <> OLD.revision + 1
  THEN RAISE EXCEPTION 'Employee pay plan identity is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER employee_pay_plan_identity_guard BEFORE UPDATE OR DELETE ON "employee_pay_plan" FOR EACH ROW EXECUTE FUNCTION employee_pay_plan_identity_guard();

CREATE FUNCTION employee_pay_plan_no_truncate() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Employee pay plan history is immutable'; END $$;
CREATE TRIGGER employee_pay_plan_no_truncate BEFORE TRUNCATE ON "employee_pay_plan" FOR EACH STATEMENT EXECUTE FUNCTION employee_pay_plan_no_truncate();
CREATE TRIGGER employee_pay_plan_version_no_truncate BEFORE TRUNCATE ON "employee_pay_plan_version" FOR EACH STATEMENT EXECUTE FUNCTION employee_pay_plan_no_truncate();

UPDATE "role" SET "function_permissions" = ARRAY(SELECT DISTINCT permission FROM unnest("function_permissions" || ARRAY['payroll.components.read', 'payroll.components.manage']) AS permission) WHERE "code" = 'KT';
