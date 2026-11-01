CREATE TYPE "InsuranceType" AS ENUM ('BHXH', 'BHYT', 'BHTN', 'KPCD');
CREATE TYPE "InsuranceCapReference" AS ENUM ('BASE_SALARY', 'REGIONAL_MINIMUM', 'NONE');

-- One row per insurance type (and optional wage region) and validity. Floors and caps reference dated legal
-- parameters (regional minimum, base salary) instead of copying amounts.
CREATE TABLE "insurance_rate" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "insurance_type" "InsuranceType" NOT NULL,
  "region_code" VARCHAR(3) REFERENCES "wage_region"("code") ON DELETE RESTRICT ON UPDATE CASCADE,
  "employee_rate" DECIMAL(8,6) NOT NULL CHECK ("employee_rate" >= 0 AND "employee_rate" < 1),
  "employer_rate" DECIMAL(8,6) NOT NULL CHECK ("employer_rate" >= 0 AND "employer_rate" < 1),
  "fund_detail" JSONB NOT NULL DEFAULT '{}',
  "floor_regional_minimum" BOOLEAN NOT NULL,
  "cap_reference" "InsuranceCapReference" NOT NULL,
  "cap_multiplier" DECIMAL(8,4) CHECK ("cap_multiplier" IS NULL OR "cap_multiplier" > 0),
  "legal_basis" VARCHAR(1000) NOT NULL CHECK (btrim("legal_basis") <> ''),
  "status" "PolicyStatus" NOT NULL,
  "effective_from" DATE NOT NULL,
  "effective_to" DATE,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by_id" UUID REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "insurance_rate_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "insurance_rate_range_check" CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from"),
  CONSTRAINT "insurance_rate_cap_check" CHECK (("cap_reference" = 'NONE') = ("cap_multiplier" IS NULL)),
  CONSTRAINT "insurance_rate_no_overlap" EXCLUDE USING gist ("insurance_type" WITH =, COALESCE("region_code", '*') WITH =, daterange("effective_from", COALESCE("effective_to", 'infinity'::date), '[]') WITH &&)
);
CREATE INDEX "insurance_rate_type_effective_idx" ON "insurance_rate"("insurance_type", "effective_from");
CREATE FUNCTION insurance_rate_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'UPDATE' OR (to_jsonb(NEW) - 'effective_to') IS DISTINCT FROM (to_jsonb(OLD) - 'effective_to') OR OLD.effective_to IS NOT NULL OR NEW.effective_to IS NULL
  THEN RAISE EXCEPTION 'Insurance rate history is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER insurance_rate_guard BEFORE UPDATE OR DELETE ON "insurance_rate" FOR EACH ROW EXECUTE FUNCTION insurance_rate_guard();
CREATE TRIGGER insurance_rate_no_truncate BEFORE TRUNCATE ON "insurance_rate" FOR EACH STATEMENT EXECUTE FUNCTION insurance_rate_guard();

INSERT INTO "insurance_rate" ("insurance_type", "employee_rate", "employer_rate", "fund_detail", "floor_regional_minimum", "cap_reference", "cap_multiplier", "legal_basis", "status", "effective_from") VALUES
 ('BHXH', 0.08, 0.175, '{"employee":{"HUU_TRI_TU_TUAT":0.08},"employer":{"HUU_TRI_TU_TUAT":0.14,"OM_DAU_THAI_SAN":0.03,"TNLD_BNN":0.005}}', true, 'BASE_SALARY', 20, 'Luật BHXH; QĐ 595/QĐ-BHXH; tài liệu 04 BR-47/48 — SIMULATION', 'SIMULATION', '2026-01-01'),
 ('BHYT', 0.015, 0.03, '{}', true, 'BASE_SALARY', 20, 'Luật BHYT; tài liệu 04 BR-48 — SIMULATION', 'SIMULATION', '2026-01-01'),
 ('BHTN', 0.01, 0.01, '{}', true, 'REGIONAL_MINIMUM', 20, 'Luật Việc làm; tài liệu 04 BR-48 — SIMULATION', 'SIMULATION', '2026-01-01'),
 ('KPCD', 0, 0.02, '{}', true, 'BASE_SALARY', 20, 'Luật Công đoàn: KPCĐ 2% quỹ lương đóng BHXH; tài liệu 04 BR-50 — SIMULATION', 'SIMULATION', '2026-01-01');

INSERT INTO legal_parameter(id,param_code,scope_key,subject_type,application_basis,value,unit,effective_from,document_effective_date,legal_basis)
SELECT gen_random_uuid(),code,'GLOBAL','ALL','WORK_DATE',amount,unit,'2026-01-01','2026-01-01',basis FROM (VALUES
 ('BASE_SALARY_MONTH','"2340000"'::jsonb,'VND/month','Lương cơ sở/mức tham chiếu NĐ 73/2024/NĐ-CP; dùng cho trần BHXH/BHYT — SIMULATION'),
 ('UNION_FEE_RATE','"0.01"'::jsonb,'ratio','Điều lệ Công đoàn: đoàn phí 1% tiền lương đóng BHXH; tài liệu 04 BR-50 — SIMULATION'),
 ('UNION_FEE_CAP','"234000"'::jsonb,'VND/month','Trần đoàn phí 10% lương cơ sở — SIMULATION, chờ xác nhận quy định công đoàn'),
 ('INSURANCE_TRAINED_FLOOR_ADDON','"0.07"'::jsonb,'ratio','Sàn đóng BH cao hơn 7% với lao động đã qua đào tạo nghề; tài liệu 04 BR-47 — SIMULATION'),
 ('UNPAID_LEAVE_INSURANCE_EXEMPT_DAYS','"14"'::jsonb,'day','Không làm việc và không hưởng lương từ 14 ngày làm việc trong tháng thì không đóng BH tháng đó; tài liệu 04 BR-49 — SIMULATION')
) AS p(code,amount,unit,basis)
WHERE NOT EXISTS (SELECT 1 FROM legal_parameter existing WHERE existing.param_code = p.code AND existing.scope_key = 'GLOBAL' AND existing.subject_type = 'ALL' AND existing.application_basis = 'WORK_DATE');

UPDATE "role" SET "function_permissions" = ARRAY(SELECT DISTINCT unnest("function_permissions" || ARRAY['insurance.read', 'insurance.manage']) ORDER BY 1) WHERE "code" = 'KT';

-- Written by the payroll engine per calculated employee; amounts live only in the encrypted detail.
CREATE TABLE "insurance_contribution" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "payroll_period_id" UUID NOT NULL REFERENCES "payroll_period"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "payroll_employee_id" UUID NOT NULL,
  "employee_id" UUID NOT NULL REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "contribution_month" CHAR(7) NOT NULL CHECK ("contribution_month" ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  "eligible" JSONB NOT NULL,
  "insurable_salary_cipher" TEXT,
  "detail_cipher" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "insurance_contribution_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "insurance_contribution_payroll_employee_key" UNIQUE ("payroll_employee_id")
);
CREATE INDEX "insurance_contribution_employee_month_idx" ON "insurance_contribution"("employee_id", "contribution_month");
CREATE FUNCTION insurance_contribution_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Insurance contributions are immutable; recalculation writes a new payroll employee row'; END $$;
CREATE TRIGGER insurance_contribution_guard BEFORE UPDATE ON "insurance_contribution" FOR EACH ROW EXECUTE FUNCTION insurance_contribution_guard();
