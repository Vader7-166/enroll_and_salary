CREATE TYPE "TaxSubject" AS ENUM ('RESIDENT_PROGRESSIVE', 'RESIDENT_FLAT_10', 'NON_RESIDENT');
CREATE TYPE "TaxExemptionMode" AS ENUM ('PREMIUM_ONLY', 'ELIGIBLE_PAYMENT');
CREATE TYPE "PitBracketBasis" AS ENUM ('MONTH', 'YEAR');
CREATE TYPE "PaymentDateStatus" AS ENUM ('PROJECTED', 'ACTUAL');
CREATE TYPE "TaxWithholdingStatus" AS ENUM ('DRAFT', 'LOCKED');
CREATE TYPE "TaxFilingStatus" AS ENUM ('NOT_FILED', 'FILED');

-- A ruleset is one versioned unit: brackets, deductions, thresholds and exemption mode are chosen together.
CREATE TABLE "tax_ruleset" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" VARCHAR(40) NOT NULL CHECK ("code" ~ '^[A-Z0-9][A-Z0-9_-]{1,39}$'),
  "subject" "TaxSubject" NOT NULL,
  "exemption_mode" "TaxExemptionMode" NOT NULL,
  "settings" JSONB NOT NULL,
  "legal_basis" VARCHAR(1000) NOT NULL CHECK (btrim("legal_basis") <> ''),
  "status" "PolicyStatus" NOT NULL,
  "effective_from" DATE NOT NULL,
  "effective_to" DATE,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by_id" UUID REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "tax_ruleset_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tax_ruleset_code_key" UNIQUE ("code"),
  CONSTRAINT "tax_ruleset_range_check" CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from"),
  CONSTRAINT "tax_ruleset_no_overlap" EXCLUDE USING gist ("subject" WITH =, daterange("effective_from", COALESCE("effective_to", 'infinity'::date), '[]') WITH &&)
);
CREATE TABLE "pit_bracket" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "ruleset_id" UUID NOT NULL REFERENCES "tax_ruleset"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "basis" "PitBracketBasis" NOT NULL,
  "bracket_no" INTEGER NOT NULL CHECK ("bracket_no" >= 1),
  "lower_bound" DECIMAL(18,0) NOT NULL CHECK ("lower_bound" >= 0),
  "upper_bound" DECIMAL(18,0),
  "rate" DECIMAL(6,4) NOT NULL CHECK ("rate" > 0 AND "rate" < 1),
  CONSTRAINT "pit_bracket_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pit_bracket_key" UNIQUE ("ruleset_id", "basis", "bracket_no"),
  CONSTRAINT "pit_bracket_bounds" CHECK ("upper_bound" IS NULL OR "upper_bound" > "lower_bound")
);
CREATE FUNCTION tax_ruleset_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'UPDATE' OR (to_jsonb(NEW) - 'effective_to') IS DISTINCT FROM (to_jsonb(OLD) - 'effective_to') OR OLD.effective_to IS NOT NULL OR NEW.effective_to IS NULL
  THEN RAISE EXCEPTION 'Tax ruleset history is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tax_ruleset_guard BEFORE UPDATE OR DELETE ON "tax_ruleset" FOR EACH ROW EXECUTE FUNCTION tax_ruleset_guard();
CREATE TRIGGER tax_ruleset_no_truncate BEFORE TRUNCATE ON "tax_ruleset" FOR EACH STATEMENT EXECUTE FUNCTION tax_ruleset_guard();
CREATE FUNCTION pit_bracket_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Tax brackets are immutable'; END $$;
CREATE TRIGGER pit_bracket_guard BEFORE UPDATE OR DELETE ON "pit_bracket" FOR EACH ROW EXECUTE FUNCTION pit_bracket_guard();
CREATE TRIGGER pit_bracket_no_truncate BEFORE TRUNCATE ON "pit_bracket" FOR EACH STATEMENT EXECUTE FUNCTION pit_bracket_guard();

-- One active row per payment (payment_key); adjustments are new rows linked to the original.
CREATE TABLE "tax_withholding" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "employee_id" UUID NOT NULL REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "payment_key" VARCHAR(160) NOT NULL CHECK (btrim("payment_key") <> ''),
  "payroll_period_id" UUID REFERENCES "payroll_period"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "payment_date" DATE NOT NULL,
  "payment_date_status" "PaymentDateStatus" NOT NULL,
  "tax_period" CHAR(7) NOT NULL CHECK ("tax_period" ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  "subject" "TaxSubject" NOT NULL,
  "branch" VARCHAR(20) NOT NULL,
  "ruleset_id" UUID NOT NULL REFERENCES "tax_ruleset"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "status" "TaxWithholdingStatus" NOT NULL DEFAULT 'DRAFT',
  "filing_status" "TaxFilingStatus" NOT NULL DEFAULT 'NOT_FILED',
  "original_withholding_id" UUID REFERENCES "tax_withholding"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "reason" VARCHAR(2000),
  "has_exceptions" BOOLEAN NOT NULL DEFAULT false,
  "detail_cipher" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by_id" UUID REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "tax_withholding_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tax_withholding_adjustment_reason" CHECK ("original_withholding_id" IS NULL OR btrim(COALESCE("reason", '')) <> '')
);
CREATE UNIQUE INDEX "tax_withholding_payment_key" ON "tax_withholding"("payment_key") WHERE "original_withholding_id" IS NULL;
CREATE INDEX "tax_withholding_employee_period_idx" ON "tax_withholding"("employee_id", "tax_period");
CREATE FUNCTION tax_withholding_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'DRAFT' AND OLD.filing_status = 'NOT_FILED' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Locked or filed tax withholding is immutable';
  END IF;
  IF OLD.filing_status = 'FILED' THEN RAISE EXCEPTION 'Filed tax withholding is immutable; create an adjustment'; END IF;
  IF OLD.status = 'LOCKED' AND ((to_jsonb(NEW) - 'filing_status' - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'filing_status' - 'updated_at') OR NEW.filing_status <> 'FILED')
  THEN RAISE EXCEPTION 'Locked tax withholding is immutable except filing'; END IF;
  IF NEW.employee_id <> OLD.employee_id OR NEW.payment_key <> OLD.payment_key OR NEW.original_withholding_id IS DISTINCT FROM OLD.original_withholding_id
  THEN RAISE EXCEPTION 'Tax withholding identity is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tax_withholding_guard BEFORE UPDATE OR DELETE ON "tax_withholding" FOR EACH ROW EXECUTE FUNCTION tax_withholding_guard();
CREATE FUNCTION tax_withholding_no_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Tax withholding ledger is immutable'; END $$;
CREATE TRIGGER tax_withholding_no_truncate BEFORE TRUNCATE ON "tax_withholding" FOR EACH STATEMENT EXECUTE FUNCTION tax_withholding_no_truncate();

CREATE TABLE "tax_exemption_line" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "withholding_id" UUID NOT NULL REFERENCES "tax_withholding"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "source_ref" VARCHAR(200) NOT NULL,
  "kind" VARCHAR(30) NOT NULL,
  "rule" VARCHAR(40) NOT NULL,
  "exception_code" VARCHAR(60),
  "evidence_ref" VARCHAR(500),
  "amounts_cipher" TEXT NOT NULL,
  CONSTRAINT "tax_exemption_line_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tax_exemption_line_key" UNIQUE ("withholding_id", "source_ref")
);

CREATE TABLE "tax_deduction_usage" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "employee_id" UUID NOT NULL REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "tax_year" INTEGER NOT NULL CHECK ("tax_year" BETWEEN 2000 AND 2100),
  "kind" VARCHAR(30) NOT NULL CHECK ("kind" IN ('MEDICAL_EDUCATION', 'VOLUNTARY_PENSION', 'CHARITY')),
  "used_amount_cipher" TEXT NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tax_deduction_usage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tax_deduction_usage_key" UNIQUE ("employee_id", "tax_year", "kind")
);

INSERT INTO "tax_ruleset" ("code", "subject", "exemption_mode", "settings", "legal_basis", "status", "effective_from", "effective_to") VALUES
 ('RES-PROG-2025', 'RESIDENT_PROGRESSIVE', 'PREMIUM_ONLY', '{"selfDeduction":"11000000","dependentDeduction":"4400000","voluntaryPensionCapMonth":"1000000"}', 'Luật TNCN 2007 sửa đổi; NQ 954/2020/UBTVQH14; TT 111/2013/TT-BTC — SIMULATION', 'SIMULATION', '2020-07-01', '2025-12-31'),
 ('RES-PROG-2026', 'RESIDENT_PROGRESSIVE', 'ELIGIBLE_PAYMENT', '{"selfDeduction":"15500000","dependentDeduction":"6200000","voluntaryPensionCapMonth":"1000000","medicalEducationCapYear":null}', 'Luật 109/2025/QH15 Điều 9, 10, 29; NQ 110/2025/UBTVQH15; NĐ 253/2026 Điều 26 — SIMULATION', 'SIMULATION', '2026-01-01', NULL),
 ('RES-FLAT10-2025', 'RESIDENT_FLAT_10', 'PREMIUM_ONLY', '{"rate":"0.1","threshold":"2000000","belowThresholdOnRequestOnly":false}', 'TT 111/2013/TT-BTC Điều 25 khoản 1 điểm i — SIMULATION', 'SIMULATION', '2015-01-01', '2025-12-31'),
 ('RES-FLAT10-2026', 'RESIDENT_FLAT_10', 'ELIGIBLE_PAYMENT', '{"rate":"0.1","threshold":"5000000","belowThresholdOnRequestOnly":true}', 'NĐ 253/2026 khoản 2 Điều 50, điểm a khoản 1 Điều 69 — SIMULATION', 'SIMULATION', '2026-01-01', NULL),
 ('NONRES-2025', 'NON_RESIDENT', 'PREMIUM_ONLY', '{"rate":"0.2"}', 'Luật TNCN; TT 111/2013 Điều 18 — SIMULATION', 'SIMULATION', '2015-01-01', '2026-06-30'),
 ('NONRES-2026H2', 'NON_RESIDENT', 'ELIGIBLE_PAYMENT', '{"rate":"0.2"}', 'NĐ 253/2026 Điều 64, 69 (từ 01/07/2026) — SIMULATION', 'SIMULATION', '2026-07-01', NULL);
INSERT INTO "pit_bracket" ("ruleset_id", "basis", "bracket_no", "lower_bound", "upper_bound", "rate") VALUES
((SELECT id FROM tax_ruleset WHERE code='RES-PROG-2025'),'MONTH',1,0,5000000,0.05),
((SELECT id FROM tax_ruleset WHERE code='RES-PROG-2025'),'YEAR',1,0,60000000,0.05),
((SELECT id FROM tax_ruleset WHERE code='RES-PROG-2025'),'MONTH',2,5000000,10000000,0.10),
((SELECT id FROM tax_ruleset WHERE code='RES-PROG-2025'),'YEAR',2,60000000,120000000,0.10),
((SELECT id FROM tax_ruleset WHERE code='RES-PROG-2025'),'MONTH',3,10000000,18000000,0.15),
((SELECT id FROM tax_ruleset WHERE code='RES-PROG-2025'),'YEAR',3,120000000,216000000,0.15),
((SELECT id FROM tax_ruleset WHERE code='RES-PROG-2025'),'MONTH',4,18000000,32000000,0.20),
((SELECT id FROM tax_ruleset WHERE code='RES-PROG-2025'),'YEAR',4,216000000,384000000,0.20),
((SELECT id FROM tax_ruleset WHERE code='RES-PROG-2025'),'MONTH',5,32000000,52000000,0.25),
((SELECT id FROM tax_ruleset WHERE code='RES-PROG-2025'),'YEAR',5,384000000,624000000,0.25),
((SELECT id FROM tax_ruleset WHERE code='RES-PROG-2025'),'MONTH',6,52000000,80000000,0.30),
((SELECT id FROM tax_ruleset WHERE code='RES-PROG-2025'),'YEAR',6,624000000,960000000,0.30),
((SELECT id FROM tax_ruleset WHERE code='RES-PROG-2025'),'MONTH',7,80000000,NULL,0.35),
((SELECT id FROM tax_ruleset WHERE code='RES-PROG-2025'),'YEAR',7,960000000,NULL,0.35),
((SELECT id FROM tax_ruleset WHERE code='RES-PROG-2026'),'MONTH',1,0,10000000,0.05),
((SELECT id FROM tax_ruleset WHERE code='RES-PROG-2026'),'YEAR',1,0,120000000,0.05),
((SELECT id FROM tax_ruleset WHERE code='RES-PROG-2026'),'MONTH',2,10000000,30000000,0.10),
((SELECT id FROM tax_ruleset WHERE code='RES-PROG-2026'),'YEAR',2,120000000,360000000,0.10),
((SELECT id FROM tax_ruleset WHERE code='RES-PROG-2026'),'MONTH',3,30000000,60000000,0.20),
((SELECT id FROM tax_ruleset WHERE code='RES-PROG-2026'),'YEAR',3,360000000,720000000,0.20),
((SELECT id FROM tax_ruleset WHERE code='RES-PROG-2026'),'MONTH',4,60000000,100000000,0.30),
((SELECT id FROM tax_ruleset WHERE code='RES-PROG-2026'),'YEAR',4,720000000,1200000000,0.30),
((SELECT id FROM tax_ruleset WHERE code='RES-PROG-2026'),'MONTH',5,100000000,NULL,0.35),
((SELECT id FROM tax_ruleset WHERE code='RES-PROG-2026'),'YEAR',5,1200000000,NULL,0.35);

INSERT INTO legal_parameter(id,param_code,scope_key,subject_type,application_basis,value,unit,effective_from,effective_to,document_effective_date,legal_basis)
SELECT gen_random_uuid(),'PIT_MEAL_EXEMPT_MONTH','GLOBAL','ALL','PAYMENT_DATE',amount,'VND/month',f::date,t::date,d::date,basis FROM (VALUES
 ('"730000"'::jsonb,'2016-01-01',to_char(DATE '2026-06-30','YYYY-MM-DD'),'2016-01-01','Định mức ăn giữa ca lịch sử (TT 26/2016/TT-BLĐTBXH, TT 96/2015/TT-BTC) — SIMULATION'),
 ('"1200000"'::jsonb,'2026-07-01',NULL,'2026-07-01','NĐ 253/2026 điểm g khoản 2 Điều 8, điểm b khoản 1 Điều 69: 1,2 triệu/người/tháng từ 01/07/2026 — SIMULATION')
) AS p(amount,f,t,d,basis)
WHERE NOT EXISTS (SELECT 1 FROM legal_parameter existing WHERE existing.param_code = 'PIT_MEAL_EXEMPT_MONTH');

UPDATE "role" SET "function_permissions" = ARRAY(SELECT DISTINCT unnest("function_permissions" || ARRAY['tax.read', 'tax.manage']) ORDER BY 1) WHERE "code" = 'KT';
