-- Leave catalog and annual leave ledger. Generated from the leave models; deliberately additive.
CREATE EXTENSION IF NOT EXISTS "btree_gist";

CREATE TABLE "leave_type" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_unit_id" UUID NOT NULL,
  "code" VARCHAR(32) NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "leave_type_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "leave_type_org_unit_id_code_key" UNIQUE ("org_unit_id", "code")
);
CREATE TABLE "leave_type_version" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "leave_type_id" UUID NOT NULL,
  "name" VARCHAR(150) NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "is_paid" BOOLEAN NOT NULL,
  "counts_as_workday" BOOLEAN NOT NULL,
  "deducts_annual_quota" BOOLEAN NOT NULL,
  "si_paid" BOOLEAN NOT NULL,
  "requires_document" BOOLEAN NOT NULL,
  "max_days" DECIMAL(8,2),
  "attendance_symbol" VARCHAR(12) NOT NULL,
  "status" "PolicyStatus" NOT NULL,
  "decision_reference" VARCHAR(500) NOT NULL,
  "reason" VARCHAR(2000) NOT NULL,
  "effective_from" DATE NOT NULL,
  "effective_to" DATE,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by_id" UUID,
  CONSTRAINT "leave_type_version_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "leave_type_version_leave_type_id_effective_from_key" UNIQUE ("leave_type_id", "effective_from"),
  CONSTRAINT "leave_type_version_range_check" CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from"),
  CONSTRAINT "leave_type_version_max_days_check" CHECK ("max_days" IS NULL OR "max_days" >= 0),
  CONSTRAINT "leave_type_version_si_paid_check" CHECK (NOT ("si_paid" AND "is_paid")),
  CONSTRAINT "leave_type_version_annual_quota_check" CHECK (NOT "deducts_annual_quota" OR ("is_paid" AND "counts_as_workday" AND NOT "si_paid"))
);
CREATE TABLE "leave_policy" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_unit_id" UUID NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "leave_policy_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "leave_policy_org_unit_id_key" UNIQUE ("org_unit_id")
);
CREATE TABLE "leave_policy_version" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "policy_id" UUID NOT NULL,
  "name" VARCHAR(150) NOT NULL,
  "normal_days" INTEGER NOT NULL,
  "hazardous_days" INTEGER NOT NULL,
  "extreme_days" INTEGER NOT NULL,
  "carry_limit_days" DECIMAL(8,2) NOT NULL,
  "carry_expiry_month" INTEGER NOT NULL,
  "carry_expiry_day" INTEGER NOT NULL,
  "advance_limit_days" DECIMAL(8,2) NOT NULL,
  "status" "PolicyStatus" NOT NULL,
  "decision_reference" VARCHAR(500) NOT NULL,
  "reason" VARCHAR(2000) NOT NULL,
  "effective_from" DATE NOT NULL,
  "effective_to" DATE,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by_id" UUID,
  CONSTRAINT "leave_policy_version_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "leave_policy_version_policy_id_effective_from_key" UNIQUE ("policy_id", "effective_from"),
  CONSTRAINT "leave_policy_version_range_check" CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from"),
  CONSTRAINT "leave_policy_version_days_check" CHECK ("normal_days" >= 12 AND "hazardous_days" >= 14 AND "extreme_days" >= 16 AND "normal_days" <= "hazardous_days" AND "hazardous_days" <= "extreme_days" AND "extreme_days" <= 366),
  CONSTRAINT "leave_policy_version_limits_check" CHECK ("carry_limit_days" >= 0 AND "advance_limit_days" >= 0),
  CONSTRAINT "leave_policy_version_expiry_check" CHECK ("carry_expiry_month" BETWEEN 1 AND 12 AND "carry_expiry_day" BETWEEN 1 AND CASE WHEN "carry_expiry_month" = 2 THEN 29 WHEN "carry_expiry_month" IN (4,6,9,11) THEN 30 ELSE 31 END)
);
CREATE TABLE "annual_leave_balance" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "employee_id" UUID NOT NULL,
  "year" INTEGER NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "calculation" JSONB,
  CONSTRAINT "annual_leave_balance_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "annual_leave_balance_employee_id_year_key" UNIQUE ("employee_id", "year"),
  CONSTRAINT "annual_leave_balance_year_check" CHECK ("year" BETWEEN 1900 AND 2200)
);
CREATE TABLE "leave_operation" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "sequence" BIGSERIAL NOT NULL,
  "request_id" UUID NOT NULL,
  "request_hash" CHAR(64) NOT NULL,
  "kind" VARCHAR(24) NOT NULL,
  "effective_date" DATE NOT NULL,
  "reason" VARCHAR(2000) NOT NULL,
  "reference" VARCHAR(500) NOT NULL,
  "snapshot" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actor_id" UUID NOT NULL,
  CONSTRAINT "leave_operation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "leave_operation_sequence_key" UNIQUE ("sequence"),
  CONSTRAINT "leave_operation_request_id_key" UNIQUE ("request_id"),
  CONSTRAINT "leave_operation_reason_check" CHECK (btrim("reason") <> ''),
  CONSTRAINT "leave_operation_reference_check" CHECK (btrim("reference") <> '')
);
CREATE TABLE "leave_ledger_entry" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "balance_id" UUID NOT NULL,
  "operation_id" UUID NOT NULL,
  "kind" VARCHAR(24) NOT NULL,
  "bucket" VARCHAR(12) NOT NULL,
  "days" DECIMAL(8,2) NOT NULL,
  "expires_at" DATE,
  CONSTRAINT "leave_ledger_entry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "leave_ledger_entry_operation_id_balance_id_kind_key" UNIQUE ("operation_id", "balance_id", "kind"),
  CONSTRAINT "leave_ledger_entry_shape_check" CHECK (("kind" = 'ENTITLEMENT' AND "bucket" = 'ANNUAL' AND "days" >= 0 AND "expires_at" IS NULL) OR ("kind" = 'RECALCULATION' AND "bucket" = 'ANNUAL' AND "expires_at" IS NULL) OR ("kind" = 'ADJUSTMENT' AND "bucket" = 'ANNUAL' AND "days" <> 0 AND "expires_at" IS NULL) OR ("kind" = 'CARRY_IN' AND "bucket" = 'CARRY' AND "days" > 0 AND "expires_at" IS NOT NULL) OR ("kind" = 'CARRY_OUT' AND "bucket" = 'ANNUAL' AND "days" < 0 AND "expires_at" IS NULL) OR ("kind" = 'ADVANCE_IN' AND "bucket" = 'ADVANCE' AND "days" > 0 AND "expires_at" IS NULL) OR ("kind" = 'ADVANCE_OUT' AND "bucket" = 'ANNUAL' AND "days" < 0 AND "expires_at" IS NULL))
);
CREATE INDEX "leave_ledger_entry_balance_id_idx" ON "leave_ledger_entry"("balance_id");
ALTER TABLE "leave_type" ADD CONSTRAINT "leave_type_org_unit_id_fkey" FOREIGN KEY ("org_unit_id") REFERENCES "org_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "leave_type_version" ADD CONSTRAINT "leave_type_version_leave_type_id_fkey" FOREIGN KEY ("leave_type_id") REFERENCES "leave_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "leave_type_version" ADD CONSTRAINT "leave_type_version_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "leave_policy" ADD CONSTRAINT "leave_policy_org_unit_id_fkey" FOREIGN KEY ("org_unit_id") REFERENCES "org_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "leave_policy_version" ADD CONSTRAINT "leave_policy_version_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "leave_policy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "leave_policy_version" ADD CONSTRAINT "leave_policy_version_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "annual_leave_balance" ADD CONSTRAINT "annual_leave_balance_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "leave_operation" ADD CONSTRAINT "leave_operation_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "leave_ledger_entry" ADD CONSTRAINT "leave_ledger_entry_balance_id_fkey" FOREIGN KEY ("balance_id") REFERENCES "annual_leave_balance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "leave_ledger_entry" ADD CONSTRAINT "leave_ledger_entry_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "leave_operation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "leave_type_version" ADD CONSTRAINT "leave_type_version_no_overlap" EXCLUDE USING gist ("leave_type_id" WITH =, daterange("effective_from", COALESCE("effective_to", 'infinity'::date), '[]') WITH &&);
ALTER TABLE "leave_policy_version" ADD CONSTRAINT "leave_policy_version_no_overlap" EXCLUDE USING gist ("policy_id" WITH =, daterange("effective_from", COALESCE("effective_to", 'infinity'::date), '[]') WITH &&);
CREATE OR REPLACE FUNCTION leave_version_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Leave configuration history is immutable'; END IF;
  IF (to_jsonb(NEW) - 'effective_to') IS DISTINCT FROM (to_jsonb(OLD) - 'effective_to') OR NEW.effective_to IS NULL OR (OLD.effective_to IS NOT NULL AND NEW.effective_to >= OLD.effective_to) THEN RAISE EXCEPTION 'Leave configuration history is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER leave_type_version_immutable BEFORE UPDATE OR DELETE ON "leave_type_version" FOR EACH ROW EXECUTE FUNCTION leave_version_immutable();
CREATE TRIGGER leave_policy_version_immutable BEFORE UPDATE OR DELETE ON "leave_policy_version" FOR EACH ROW EXECUTE FUNCTION leave_version_immutable();
CREATE OR REPLACE FUNCTION leave_ledger_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Leave ledger and operations are immutable'; END $$;
CREATE TRIGGER leave_operation_immutable BEFORE UPDATE OR DELETE ON "leave_operation" FOR EACH ROW EXECUTE FUNCTION leave_ledger_immutable();
CREATE TRIGGER leave_ledger_entry_immutable BEFORE UPDATE OR DELETE ON "leave_ledger_entry" FOR EACH ROW EXECUTE FUNCTION leave_ledger_immutable();
UPDATE "role" SET "function_permissions" = ARRAY(SELECT DISTINCT permission FROM unnest("function_permissions" || CASE "code" WHEN 'AD' THEN ARRAY['leave.read','leave.configure'] WHEN 'KT' THEN ARRAY['leave.read','leave.balance.read','leave.balance.manage'] WHEN 'TT' THEN ARRAY['leave.read','leave.balance.read'] WHEN 'QD' THEN ARRAY['leave.read','leave.balance.read'] ELSE ARRAY[]::text[] END) AS permission);
WITH company AS (
  SELECT "id" FROM "org_unit" WHERE "code" = 'COMPANY'
), inserted AS (
  INSERT INTO "leave_policy" ("org_unit_id", "revision")
  SELECT "id", 1 FROM company
  ON CONFLICT ("org_unit_id") DO NOTHING
  RETURNING "id"
)
INSERT INTO "leave_policy_version" ("policy_id", "name", "normal_days", "hazardous_days", "extreme_days", "carry_limit_days", "carry_expiry_month", "carry_expiry_day", "advance_limit_days", "status", "decision_reference", "reason", "effective_from")
SELECT "id", 'Chính sách phép năm mặc định', 12, 14, 16, 5.00, 3, 31, 3.00, 'SIMULATION', 'DEC03', 'Thiết lập dữ liệu nền', DATE '2026-01-01'
FROM inserted;

WITH defaults("code", "name", "is_paid", "counts_as_workday", "deducts_annual_quota", "si_paid", "requires_document", "max_days", "attendance_symbol") AS (
  VALUES
    ('ANNUAL', 'Nghỉ hằng năm', true, true, true, false, false, NULL::decimal, 'P'),
    ('UNPAID', 'Nghỉ không lương', false, false, false, false, true, NULL::decimal, 'KL'),
    ('COMPENSATORY', 'Nghỉ bù', true, true, false, false, false, NULL::decimal, 'NB'),
    ('SICK', 'Nghỉ ốm', false, false, false, true, true, NULL::decimal, 'OM'),
    ('CHILD_SICK', 'Nghỉ chăm con ốm', false, false, false, true, true, NULL::decimal, 'CO'),
    ('MATERNITY', 'Nghỉ thai sản', false, false, false, true, true, NULL::decimal, 'TS'),
    ('PRENATAL', 'Nghỉ khám thai', false, false, false, true, true, 5.00, 'KT'),
    ('RECOVERY', 'Nghỉ dưỡng sức', false, false, false, true, true, NULL::decimal, 'DS'),
    ('WORK_ACCIDENT', 'Nghỉ tai nạn lao động', false, false, false, true, true, NULL::decimal, 'TNL'),
    ('MARRIAGE', 'Nghỉ kết hôn', true, true, false, false, true, 3.00, 'KH'),
    ('BEREAVEMENT', 'Nghỉ việc riêng có lương', true, true, false, false, true, 3.00, 'VR'),
    ('PERSONAL', 'Nghỉ việc riêng', false, false, false, false, true, NULL::decimal, 'VR'),
    ('COMPANY', 'Nghỉ theo chính sách công ty', true, true, false, false, false, NULL::decimal, 'CT')
), company AS (
  SELECT "id" FROM "org_unit" WHERE "code" = 'COMPANY'
), inserted AS (
  INSERT INTO "leave_type" ("org_unit_id", "code", "revision")
  SELECT company."id", defaults."code", 1 FROM company CROSS JOIN defaults
  ON CONFLICT ("org_unit_id", "code") DO NOTHING
  RETURNING "id", "code"
)
INSERT INTO "leave_type_version" ("leave_type_id", "name", "active", "is_paid", "counts_as_workday", "deducts_annual_quota", "si_paid", "requires_document", "max_days", "attendance_symbol", "status", "decision_reference", "reason", "effective_from")
SELECT inserted."id", defaults."name", true, defaults."is_paid", defaults."counts_as_workday", defaults."deducts_annual_quota", defaults."si_paid", defaults."requires_document", defaults."max_days", defaults."attendance_symbol", 'SIMULATION', 'DEC03', 'Thiết lập dữ liệu nền', DATE '2026-01-01'
FROM inserted JOIN defaults USING ("code");
