CREATE EXTENSION IF NOT EXISTS "btree_gist";
CREATE TYPE "PayrollConfigurationKind" AS ENUM ('PRICE', 'FORMULA');
CREATE TYPE "PayrollPriceType" AS ENUM ('MONTHLY', 'DAILY', 'HOURLY', 'PRODUCT', 'PIECEWORK', 'COMMISSION', 'P1', 'P2', 'P3');
CREATE TYPE "FormulaRoundingMode" AS ENUM ('NONE', 'HALF_UP', 'HALF_EVEN', 'DOWN', 'UP', 'FLOOR', 'CEIL');

CREATE TABLE "payroll_configuration" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_unit_id" UUID NOT NULL REFERENCES "org_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "kind" "PayrollConfigurationKind" NOT NULL,
  "code" VARCHAR(80) NOT NULL CHECK ("code" ~ '^[A-Z][A-Z0-9_]{0,79}$'),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" >= 1),
  CONSTRAINT "payroll_configuration_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payroll_configuration_org_unit_id_kind_code_key" UNIQUE ("org_unit_id", "kind", "code")
);
CREATE TABLE "payroll_configuration_version" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "configuration_id" UUID NOT NULL REFERENCES "payroll_configuration"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "name" VARCHAR(150) NOT NULL CHECK (btrim("name") <> ''),
  "unit" VARCHAR(32) NOT NULL CHECK (btrim("unit") <> ''),
  "active" BOOLEAN NOT NULL,
  "status" "PolicyStatus" NOT NULL,
  "decision_reference" VARCHAR(500) NOT NULL CHECK (btrim("decision_reference") <> ''),
  "reason" VARCHAR(2000) NOT NULL CHECK (btrim("reason") <> ''),
  "effective_from" DATE NOT NULL,
  "effective_to" DATE,
  "price_type" "PayrollPriceType",
  "amount" NUMERIC(26,6),
  "product_code" VARCHAR(80),
  "operation_code" VARCHAR(80),
  "component_id" UUID REFERENCES "salary_component"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "expression" VARCHAR(2000),
  "variables" JSONB,
  "rounding_mode" "FormulaRoundingMode",
  "rounding_scale" INTEGER,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by_id" UUID NOT NULL REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payroll_configuration_version_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payroll_configuration_version_configuration_id_effective_from_key" UNIQUE ("configuration_id", "effective_from"),
  CONSTRAINT "payroll_configuration_version_range_check" CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from"),
  CONSTRAINT "payroll_configuration_version_shape_check" CHECK (("price_type" IS NOT NULL) = ("amount" IS NOT NULL) AND (("price_type" IS NOT NULL AND "component_id" IS NULL AND "expression" IS NULL AND "variables" IS NULL AND "rounding_mode" IS NULL AND "rounding_scale" IS NULL) OR ("price_type" IS NULL AND "amount" IS NULL AND "component_id" IS NOT NULL AND "expression" IS NOT NULL AND "variables" IS NOT NULL AND "rounding_mode" IS NOT NULL AND "rounding_scale" BETWEEN 0 AND 6))),
  CONSTRAINT "payroll_configuration_version_no_overlap" EXCLUDE USING gist ("configuration_id" WITH =, daterange("effective_from", COALESCE("effective_to", 'infinity'::date), '[]') WITH &&)
);
CREATE INDEX "payroll_configuration_version_component_id_idx" ON "payroll_configuration_version"("component_id");

CREATE FUNCTION payroll_configuration_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE latest DATE;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Payroll configuration history is immutable'; END IF;
  PERFORM 1 FROM "payroll_configuration" WHERE "id" = NEW.configuration_id FOR UPDATE;
  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - 'effective_to') IS DISTINCT FROM (to_jsonb(OLD) - 'effective_to') OR NEW.effective_to IS NULL OR NEW.effective_to < (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh')::date OR (OLD.effective_to IS NOT NULL AND NEW.effective_to >= OLD.effective_to) THEN RAISE EXCEPTION 'Payroll configuration history is immutable'; END IF;
  ELSE
    SELECT max("effective_from") INTO latest FROM "payroll_configuration_version" WHERE "configuration_id" = NEW.configuration_id;
    IF latest IS NOT NULL AND (NEW.effective_from <= latest OR NEW.effective_from <= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh')::date) THEN RAISE EXCEPTION 'Payroll configuration successor must be future dated and ordered'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payroll_configuration_version_guard BEFORE INSERT OR UPDATE OR DELETE ON "payroll_configuration_version" FOR EACH ROW EXECUTE FUNCTION payroll_configuration_version_guard();
CREATE FUNCTION payroll_configuration_successor_required() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NOT EXISTS (SELECT 1 FROM "payroll_configuration_version" WHERE "configuration_id" = NEW.configuration_id AND "effective_from" = NEW.effective_to + 1) THEN RAISE EXCEPTION 'Payroll configuration validity can only close for a successor'; END IF; RETURN NULL; END $$;
CREATE CONSTRAINT TRIGGER payroll_configuration_successor_required AFTER UPDATE ON "payroll_configuration_version" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION payroll_configuration_successor_required();
CREATE FUNCTION payroll_configuration_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF TG_OP = 'DELETE' OR (to_jsonb(NEW) - 'revision') IS DISTINCT FROM (to_jsonb(OLD) - 'revision') OR NEW.revision <> OLD.revision + 1 THEN RAISE EXCEPTION 'Payroll configuration identity is immutable'; END IF; RETURN NEW; END $$;
CREATE TRIGGER payroll_configuration_identity_guard BEFORE UPDATE OR DELETE ON "payroll_configuration" FOR EACH ROW EXECUTE FUNCTION payroll_configuration_identity_guard();
CREATE FUNCTION payroll_configuration_no_truncate() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Payroll configuration history is immutable'; END $$;
CREATE TRIGGER payroll_configuration_no_truncate BEFORE TRUNCATE ON "payroll_configuration" FOR EACH STATEMENT EXECUTE FUNCTION payroll_configuration_no_truncate();
CREATE TRIGGER payroll_configuration_version_no_truncate BEFORE TRUNCATE ON "payroll_configuration_version" FOR EACH STATEMENT EXECUTE FUNCTION payroll_configuration_no_truncate();

UPDATE "role" SET "function_permissions" = ARRAY(SELECT DISTINCT permission FROM unnest("function_permissions" || ARRAY['payroll.components.read', 'payroll.components.manage']) AS permission) WHERE "code" = 'KT';
