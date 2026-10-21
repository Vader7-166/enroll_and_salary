CREATE EXTENSION IF NOT EXISTS "btree_gist";
CREATE TYPE "SalaryComponentType" AS ENUM ('EARNING', 'DEDUCTION', 'EMPLOYER_COST');
CREATE TYPE "SalaryTaxClassification" AS ENUM ('TAXABLE', 'NON_TAXABLE', 'CONDITIONAL');

CREATE TABLE "salary_component" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_unit_id" UUID NOT NULL REFERENCES "org_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "code" VARCHAR(32) NOT NULL CHECK ("code" ~ '^[A-Z][A-Z0-9_]{1,31}$'),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" >= 1),
  CONSTRAINT "salary_component_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "salary_component_org_unit_id_code_key" UNIQUE ("org_unit_id", "code")
);
CREATE TABLE "salary_component_version" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "component_id" UUID NOT NULL REFERENCES "salary_component"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "name" VARCHAR(150) NOT NULL CHECK (btrim("name") <> ''),
  "component_type" "SalaryComponentType" NOT NULL,
  "active" BOOLEAN NOT NULL,
  "is_insurable" BOOLEAN NOT NULL,
  "tax_classification" "SalaryTaxClassification" NOT NULL,
  "is_ot_base" BOOLEAN NOT NULL,
  "is_prorated" BOOLEAN NOT NULL,
  "display_order" INTEGER NOT NULL CHECK ("display_order" BETWEEN 0 AND 9999),
  "status" "PolicyStatus" NOT NULL,
  "classification_basis" VARCHAR(2000) NOT NULL CHECK (btrim("classification_basis") <> ''),
  "decision_reference" VARCHAR(500) NOT NULL CHECK (btrim("decision_reference") <> ''),
  "reason" VARCHAR(2000) NOT NULL CHECK (btrim("reason") <> ''),
  "effective_from" DATE NOT NULL,
  "effective_to" DATE,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by_id" UUID NOT NULL REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "salary_component_version_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "salary_component_version_component_id_effective_from_key" UNIQUE ("component_id", "effective_from"),
  CONSTRAINT "salary_component_version_range_check" CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from"),
  CONSTRAINT "salary_component_version_no_overlap" EXCLUDE USING gist ("component_id" WITH =, daterange("effective_from", COALESCE("effective_to", 'infinity'::date), '[]') WITH &&)
);

-- Content is immutable even before its first payroll use. Only a successor can
-- shorten the previous validity window, and only strictly after the business day.
CREATE FUNCTION salary_component_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE latest DATE;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Salary component history is immutable'; END IF;
  PERFORM 1 FROM "salary_component" WHERE "id" = NEW.component_id FOR UPDATE;
  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - 'effective_to') IS DISTINCT FROM (to_jsonb(OLD) - 'effective_to')
       OR NEW.effective_to IS NULL
       OR NEW.effective_to < (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
       OR (OLD.effective_to IS NOT NULL AND NEW.effective_to >= OLD.effective_to)
    THEN RAISE EXCEPTION 'Salary component history is immutable'; END IF;
  ELSE
    SELECT max("effective_from") INTO latest FROM "salary_component_version" WHERE "component_id" = NEW.component_id;
    IF latest IS NOT NULL AND (NEW.effective_from <= latest OR NEW.effective_from <= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)
    THEN RAISE EXCEPTION 'Salary component successor must be future dated and ordered'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER salary_component_version_guard BEFORE INSERT OR UPDATE OR DELETE ON "salary_component_version" FOR EACH ROW EXECUTE FUNCTION salary_component_version_guard();
CREATE FUNCTION salary_component_successor_required() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "salary_component_version" WHERE "component_id" = NEW.component_id AND "effective_from" = NEW.effective_to + 1)
  THEN RAISE EXCEPTION 'Salary component validity can only close for a successor'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER salary_component_successor_required AFTER UPDATE ON "salary_component_version" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION salary_component_successor_required();
CREATE FUNCTION salary_component_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Salary component history is immutable'; END IF;
  IF (to_jsonb(NEW) - 'revision') IS DISTINCT FROM (to_jsonb(OLD) - 'revision') OR NEW.revision <> OLD.revision + 1
  THEN RAISE EXCEPTION 'Salary component identity is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER salary_component_identity_guard BEFORE UPDATE OR DELETE ON "salary_component" FOR EACH ROW EXECUTE FUNCTION salary_component_identity_guard();
CREATE FUNCTION salary_component_no_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Salary component history is immutable'; END $$;
CREATE TRIGGER salary_component_no_truncate BEFORE TRUNCATE ON "salary_component" EXECUTE FUNCTION salary_component_no_truncate();
CREATE TRIGGER salary_component_version_no_truncate BEFORE TRUNCATE ON "salary_component_version" EXECUTE FUNCTION salary_component_no_truncate();

UPDATE "role" SET "function_permissions" = ARRAY(SELECT DISTINCT permission FROM unnest("function_permissions" || ARRAY['payroll.components.read', 'payroll.components.manage']) AS permission) WHERE "code" = 'KT';
