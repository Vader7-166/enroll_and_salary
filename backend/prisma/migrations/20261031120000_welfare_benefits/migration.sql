-- Welfare benefits (FR-9.1.1…9.1.3, 9.2.1, 9.2.2, 9.4.1; R1-AC-09; UAT-28): versioned catalog with data-only eligibility,
-- draft allocation batches, duplicate-proof confirmation, payroll inclusion and cost reporting.

CREATE TYPE "BenefitTaxTreatment" AS ENUM ('TAXABLE', 'NON_TAXABLE', 'EXEMPT_UP_TO_LIMIT');
CREATE TYPE "BenefitBatchStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'CANCELLED');

CREATE TABLE "benefit_catalog" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" VARCHAR(64) NOT NULL,
  "org_unit_id" UUID NOT NULL REFERENCES "org_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "category" VARCHAR(32) NOT NULL CHECK ("category" IN ('HEALTH_INSURANCE', 'HEALTH_CHECK', 'MEAL', 'SHUTTLE', 'PHONE', 'UNIFORM', 'GIFT', 'FAMILY_EVENT', 'TRAVEL', 'TRAINING', 'HOUSING', 'CHILDCARE')),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "benefit_catalog_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "benefit_catalog_code_key" UNIQUE ("code")
);

CREATE TABLE "benefit_catalog_version" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "catalog_id" UUID NOT NULL REFERENCES "benefit_catalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "name" VARCHAR(200) NOT NULL,
  "amount" DECIMAL(18,0) NOT NULL CHECK ("amount" >= 0),
  "tax_treatment" "BenefitTaxTreatment" NOT NULL,
  "exempt_limit" DECIMAL(18,0) CHECK ("exempt_limit" >= 0),
  "payroll_included" BOOLEAN NOT NULL,
  "eligibility" JSONB NOT NULL DEFAULT '{}',
  "decision_reference" VARCHAR(500) NOT NULL,
  "status" "PolicyStatus" NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "effective_from" DATE NOT NULL,
  "effective_to" DATE,
  "created_by_id" UUID REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "benefit_catalog_version_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "benefit_catalog_version_range" CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from"),
  CONSTRAINT "benefit_catalog_version_limit" CHECK (("tax_treatment" = 'EXEMPT_UP_TO_LIMIT') = ("exempt_limit" IS NOT NULL)),
  CONSTRAINT "benefit_catalog_version_no_overlap" EXCLUDE USING gist ("catalog_id" WITH =, daterange("effective_from", "effective_to", '[]') WITH &&)
);

-- A version never changes except that an open version may be closed once by its successor.
CREATE FUNCTION benefit_catalog_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'BENEFIT_VERSION_IMMUTABLE'; END IF;
  IF OLD.effective_to IS NULL AND NEW.effective_to IS NOT NULL
     AND (to_jsonb(NEW) - 'effective_to') = (to_jsonb(OLD) - 'effective_to') THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'BENEFIT_VERSION_IMMUTABLE';
END;
$$;
CREATE TRIGGER benefit_catalog_version_guard BEFORE UPDATE OR DELETE ON "benefit_catalog_version" FOR EACH ROW EXECUTE FUNCTION benefit_catalog_version_guard();

CREATE TABLE "benefit_allocation_batch" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" VARCHAR(64) NOT NULL,
  "catalog_id" UUID NOT NULL REFERENCES "benefit_catalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "version_id" UUID NOT NULL REFERENCES "benefit_catalog_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "period_code" VARCHAR(32) NOT NULL,
  "reference_date" DATE NOT NULL,
  "scope_org_unit_id" UUID NOT NULL REFERENCES "org_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "payroll_period_id" UUID REFERENCES "payroll_period"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "status" "BenefitBatchStatus" NOT NULL DEFAULT 'DRAFT',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "note" VARCHAR(2000),
  "result" JSONB,
  "created_by_id" UUID NOT NULL REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmed_by_id" UUID REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "confirmed_at" TIMESTAMPTZ(3),
  "cancel_reason" VARCHAR(2000),
  CONSTRAINT "benefit_allocation_batch_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "benefit_allocation_batch_code_key" UNIQUE ("code"),
  CONSTRAINT "benefit_allocation_batch_confirmed" CHECK (("status" = 'CONFIRMED') = ("confirmed_at" IS NOT NULL))
);

-- Draft candidates: the provisional list. Rewritten while DRAFT; never read by payroll or cost reports.
CREATE TABLE "benefit_allocation_candidate" (
  "batch_id" UUID NOT NULL REFERENCES "benefit_allocation_batch"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "employee_id" UUID NOT NULL REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "eligible" BOOLEAN NOT NULL,
  "failed_rules" JSONB NOT NULL DEFAULT '[]',
  "manual" BOOLEAN NOT NULL DEFAULT false,
  "manual_reason" VARCHAR(2000),
  CONSTRAINT "benefit_allocation_candidate_pkey" PRIMARY KEY ("batch_id", "employee_id"),
  CONSTRAINT "benefit_allocation_candidate_reason" CHECK ("eligible" OR "manual_reason" IS NOT NULL)
);

CREATE TABLE "benefit_allocation" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "batch_id" UUID NOT NULL REFERENCES "benefit_allocation_batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "catalog_id" UUID NOT NULL REFERENCES "benefit_catalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "version_id" UUID NOT NULL REFERENCES "benefit_catalog_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "employee_id" UUID NOT NULL REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "period_code" VARCHAR(32) NOT NULL,
  "amount_cipher" TEXT NOT NULL,
  "tax_treatment" "BenefitTaxTreatment" NOT NULL,
  "payroll_period_id" UUID REFERENCES "payroll_period"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "org_unit_id" UUID NOT NULL REFERENCES "org_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "cost_center_code" VARCHAR(40),
  "cost_month" CHAR(7) NOT NULL,
  "manual_reason" VARCHAR(2000),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "benefit_allocation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "benefit_allocation_unique_key" UNIQUE ("catalog_id", "employee_id", "period_code")
);
CREATE INDEX "benefit_allocation_payroll_idx" ON "benefit_allocation"("payroll_period_id");
CREATE INDEX "benefit_allocation_cost_idx" ON "benefit_allocation"("cost_month", "cost_center_code");

CREATE FUNCTION benefit_allocation_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'BENEFIT_ALLOCATION_IMMUTABLE'; END; $$;
CREATE TRIGGER benefit_allocation_guard BEFORE UPDATE OR DELETE ON "benefit_allocation" FOR EACH ROW EXECUTE FUNCTION benefit_allocation_immutable();

CREATE FUNCTION benefit_batch_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE batch_status TEXT;
BEGIN
  IF TG_TABLE_NAME = 'benefit_allocation_batch' THEN
    IF TG_OP = 'DELETE' OR OLD.status <> 'DRAFT' THEN RAISE EXCEPTION 'BENEFIT_BATCH_FINAL'; END IF;
    RETURN NEW;
  END IF;
  SELECT status::text INTO batch_status FROM benefit_allocation_batch WHERE id = COALESCE(NEW.batch_id, OLD.batch_id);
  IF batch_status <> 'DRAFT' THEN RAISE EXCEPTION 'BENEFIT_BATCH_FINAL'; END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
CREATE TRIGGER benefit_allocation_batch_guard BEFORE UPDATE OR DELETE ON "benefit_allocation_batch" FOR EACH ROW EXECUTE FUNCTION benefit_batch_guard();
CREATE TRIGGER benefit_allocation_candidate_guard BEFORE INSERT OR UPDATE OR DELETE ON "benefit_allocation_candidate" FOR EACH ROW EXECUTE FUNCTION benefit_batch_guard();

UPDATE "role" SET "function_permissions" = ARRAY(SELECT DISTINCT unnest("function_permissions" || ARRAY['welfare.read', 'welfare.manage']) ORDER BY 1) WHERE "code" = 'KT';

-- The twelve simulation benefits are seeded by prisma/seed-welfare.cjs (they need the company org unit).
