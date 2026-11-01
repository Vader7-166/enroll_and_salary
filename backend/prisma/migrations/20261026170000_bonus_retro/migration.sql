-- Bonuses (FR-7.3.1, FR-7.2.6, BR-45) and retroactive adjustments into the open period (FR-7.4.1, 7.4.2, BR-42).

CREATE TYPE "BonusType" AS ENUM ('MONTHLY', 'QUARTERLY', 'ANNUAL', 'KPI', 'HOLIDAY', 'SENIORITY', 'AD_HOC');
CREATE TYPE "BonusPlanStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'CANCELLED');
CREATE TYPE "RetroCalculationStatus" AS ENUM ('CALCULATED', 'CONFIRMED', 'DISCARDED');

CREATE TABLE "bonus_plan" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" VARCHAR(64) NOT NULL,
  "bonus_type" "BonusType" NOT NULL,
  "name" VARCHAR(200) NOT NULL,
  "decision_reference" VARCHAR(500) NOT NULL,
  "independent_decision_ref" VARCHAR(500),
  "kpi_source_reference" VARCHAR(200),
  "earn_from" DATE NOT NULL,
  "earn_to" DATE NOT NULL,
  "pay_payroll_period_id" UUID NOT NULL REFERENCES "payroll_period"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "component_id" UUID REFERENCES "salary_component"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "calculation_mode" VARCHAR(10) NOT NULL CHECK ("calculation_mode" IN ('AMOUNT', 'FORMULA')),
  "amount_cipher" TEXT,
  "formula" VARCHAR(2000),
  "variables" JSONB NOT NULL DEFAULT '[]',
  "status" "BonusPlanStatus" NOT NULL DEFAULT 'DRAFT',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "reason" VARCHAR(2000) NOT NULL,
  "cancel_reason" VARCHAR(2000),
  "created_by_id" UUID NOT NULL REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmed_by_id" UUID REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "confirmed_at" TIMESTAMPTZ(3),
  CONSTRAINT "bonus_plan_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "bonus_plan_code_key" UNIQUE ("code"),
  CONSTRAINT "bonus_plan_earn_range" CHECK ("earn_from" <= "earn_to"),
  CONSTRAINT "bonus_plan_mode_value" CHECK (("calculation_mode" = 'AMOUNT' AND "amount_cipher" IS NOT NULL) OR ("calculation_mode" = 'FORMULA' AND "formula" IS NOT NULL))
);
CREATE INDEX "bonus_plan_pay_period_idx" ON "bonus_plan"("pay_payroll_period_id", "status");

CREATE TABLE "bonus_allocation" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "plan_id" UUID NOT NULL REFERENCES "bonus_plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "employee_id" UUID NOT NULL REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "inputs_cipher" TEXT NOT NULL,
  "amount_cipher" TEXT NOT NULL,
  "conflict_code" VARCHAR(40),
  "conflict_detail" VARCHAR(2000),
  "created_by_id" UUID NOT NULL REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bonus_allocation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "bonus_allocation_plan_employee_key" UNIQUE ("plan_id", "employee_id")
);

CREATE TABLE "retro_calculation" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "decision_id" UUID NOT NULL REFERENCES "salary_decision"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "employee_id" UUID NOT NULL REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "candidate_ids" UUID[] NOT NULL,
  "target_payroll_period_id" UUID NOT NULL REFERENCES "payroll_period"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "status" "RetroCalculationStatus" NOT NULL DEFAULT 'CALCULATED',
  "result_cipher" TEXT NOT NULL,
  "result_hash" CHAR(64) NOT NULL,
  "created_by_id" UUID NOT NULL REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decided_by_id" UUID REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "decided_at" TIMESTAMPTZ(3),
  CONSTRAINT "retro_calculation_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "retro_calculation_employee_idx" ON "retro_calculation"("employee_id", "created_at");

ALTER TABLE "payroll_adjustment"
  ADD COLUMN "retro_calculation_id" UUID REFERENCES "retro_calculation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD COLUMN "target_payroll_period_id" UUID REFERENCES "payroll_period"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A confirmed plan's allocations are final; only a draft plan's allocations may be removed.
CREATE FUNCTION bonus_allocation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE plan_status TEXT;
BEGIN
  SELECT status::text INTO plan_status FROM "bonus_plan" WHERE "id" = OLD.plan_id;
  IF TG_OP = 'DELETE' AND plan_status = 'DRAFT' THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Bonus allocations are immutable once the plan leaves DRAFT';
END $$;
CREATE TRIGGER bonus_allocation_guard BEFORE UPDATE OR DELETE ON "bonus_allocation" FOR EACH ROW EXECUTE FUNCTION bonus_allocation_guard();

CREATE FUNCTION bonus_plan_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Bonus plans are kept'; END IF;
  IF OLD.status::text = 'CANCELLED' THEN RAISE EXCEPTION 'Cancelled bonus plan is final'; END IF;
  IF OLD.status::text = 'CONFIRMED' AND (NEW.status::text <> 'CANCELLED' OR (to_jsonb(NEW) - 'status' - 'revision' - 'cancel_reason') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'revision' - 'cancel_reason'))
  THEN RAISE EXCEPTION 'Confirmed bonus plan can only be cancelled'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER bonus_plan_guard BEFORE UPDATE OR DELETE ON "bonus_plan" FOR EACH ROW EXECUTE FUNCTION bonus_plan_guard();

CREATE FUNCTION retro_calculation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status::text <> 'CALCULATED' OR NEW.status::text = 'CALCULATED'
    OR (to_jsonb(NEW) - 'status' - 'decided_by_id' - 'decided_at') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'decided_by_id' - 'decided_at')
  THEN RAISE EXCEPTION 'Retro calculation result is immutable; it is confirmed or discarded once'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER retro_calculation_guard BEFORE UPDATE OR DELETE ON "retro_calculation" FOR EACH ROW EXECUTE FUNCTION retro_calculation_guard();

UPDATE "role" SET "function_permissions" = ARRAY(SELECT DISTINCT unnest("function_permissions" || ARRAY['payroll.bonus', 'payroll.adjust']) ORDER BY 1) WHERE "code" = 'KT';
