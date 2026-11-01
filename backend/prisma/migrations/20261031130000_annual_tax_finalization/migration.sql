-- Annual PIT finalization drafts (FR-8.5.1, 8.5.2; BR-55; R1-AC-08; TC-T10): grouped by the year of the actual payment
-- date, taxed with the YEAR brackets; withholding records are referenced, never modified.

CREATE TYPE "TaxFinalizationStatus" AS ENUM ('DRAFT', 'DONE');

CREATE TABLE "annual_tax_finalization" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tax_year" INTEGER NOT NULL CHECK ("tax_year" BETWEEN 2020 AND 2100),
  "employee_id" UUID NOT NULL REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "version" INTEGER NOT NULL CHECK ("version" >= 1),
  "status" "TaxFinalizationStatus" NOT NULL DEFAULT 'DRAFT',
  "ruleset_id" UUID NOT NULL REFERENCES "tax_ruleset"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "tax_profile_id" UUID NOT NULL REFERENCES "tax_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "summary_cipher" TEXT NOT NULL,
  "direction" VARCHAR(8) NOT NULL CHECK ("direction" IN ('PAYABLE', 'REFUND', 'NONE')),
  "issues" JSONB NOT NULL DEFAULT '[]',
  "source_hash" CHAR(64) NOT NULL,
  "created_by_id" UUID NOT NULL REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_by_id" UUID REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "completed_at" TIMESTAMPTZ(3),
  CONSTRAINT "annual_tax_finalization_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "annual_tax_finalization_version_key" UNIQUE ("tax_year", "employee_id", "version"),
  CONSTRAINT "annual_tax_finalization_done" CHECK (("status" = 'DONE') = ("completed_at" IS NOT NULL))
);
CREATE INDEX "annual_tax_finalization_year_idx" ON "annual_tax_finalization"("tax_year", "employee_id", "version" DESC);

CREATE TABLE "annual_tax_finalization_line" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "finalization_id" UUID NOT NULL REFERENCES "annual_tax_finalization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "kind" VARCHAR(24) NOT NULL CHECK ("kind" IN ('WITHHELD', 'WITHHELD_ORIGINAL', 'SETTLEMENT')),
  "withholding_id" UUID REFERENCES "tax_withholding"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "detail_cipher" TEXT NOT NULL,
  CONSTRAINT "annual_tax_finalization_line_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "annual_tax_finalization_line_ref" CHECK (("kind" = 'SETTLEMENT') = ("withholding_id" IS NULL))
);
CREATE INDEX "annual_tax_finalization_line_idx" ON "annual_tax_finalization_line"("finalization_id");

-- A draft may only be completed; a completed one is final. Lines never change. Recalculation adds a version.
CREATE FUNCTION annual_tax_finalization_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'annual_tax_finalization_line' THEN RAISE EXCEPTION 'TAX_FINALIZATION_IMMUTABLE'; END IF;
  IF TG_OP = 'DELETE' OR OLD.status <> 'DRAFT' OR NEW.status <> 'DONE'
     OR (to_jsonb(NEW) - 'status' - 'completed_at' - 'completed_by_id') <> (to_jsonb(OLD) - 'status' - 'completed_at' - 'completed_by_id') THEN
    RAISE EXCEPTION 'TAX_FINALIZATION_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER annual_tax_finalization_guard BEFORE UPDATE OR DELETE ON "annual_tax_finalization" FOR EACH ROW EXECUTE FUNCTION annual_tax_finalization_guard();
CREATE TRIGGER annual_tax_finalization_line_guard BEFORE UPDATE OR DELETE ON "annual_tax_finalization_line" FOR EACH ROW EXECUTE FUNCTION annual_tax_finalization_guard();

-- Column layout of the exported draft (summary declaration + per-person appendix) is versioned configuration.
CREATE TABLE "tax_finalization_template" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" VARCHAR(64) NOT NULL,
  "version" INTEGER NOT NULL,
  "name" VARCHAR(200) NOT NULL,
  "appendix_columns" JSONB NOT NULL,
  "status" "PolicyStatus" NOT NULL,
  "legal_basis" VARCHAR(500) NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tax_finalization_template_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tax_finalization_template_key" UNIQUE ("code", "version")
);
INSERT INTO "tax_finalization_template" ("code", "version", "name", "appendix_columns", "status", "legal_basis") VALUES
 ('QTT-TNCN-MP', 1, 'Dự thảo quyết toán thuế TNCN (mẫu mô phỏng: tờ khai tổng hợp + phụ lục cá nhân)',
  '[{"field":"employeeCode","header":"Mã NV"},{"field":"fullName","header":"Họ và tên"},{"field":"taxCode","header":"Mã số thuế"},{"field":"totalIncome","header":"Tổng thu nhập"},{"field":"exempt","header":"Thu nhập miễn"},{"field":"taxableIncome","header":"Thu nhập chịu thuế"},{"field":"selfDeduction","header":"Giảm trừ bản thân"},{"field":"dependentMonths","header":"Số tháng NPT"},{"field":"dependentDeduction","header":"Giảm trừ NPT"},{"field":"insurance","header":"BH được trừ"},{"field":"otherDeductions","header":"Giảm trừ khác"},{"field":"assessableIncome","header":"Thu nhập tính thuế"},{"field":"annualTax","header":"Thuế phải nộp năm"},{"field":"withheld","header":"Thuế đã khấu trừ"},{"field":"difference","header":"Nộp thêm (+) / hoàn (−)"}]',
  'SIMULATION', 'Cột theo mẫu mô phỏng (05/QTT-TNCN và phụ lục 05-1BK-QTT); thay bằng mẫu hiện hành khi được xác nhận — SIMULATION');

INSERT INTO legal_parameter(id,param_code,scope_key,subject_type,application_basis,value,unit,effective_from,document_effective_date,legal_basis)
SELECT gen_random_uuid(),'PIT_FINALIZATION_SELF_DEDUCTION_MONTHS','GLOBAL','ALL','WORK_DATE','"12"'::jsonb,'month','2020-01-01','2020-01-01','Cá nhân cư trú quyết toán được giảm trừ bản thân đủ 12 tháng trong năm; TT 111/2013/TT-BTC Điều 9 khoản 1 — SIMULATION'
WHERE NOT EXISTS (SELECT 1 FROM legal_parameter WHERE param_code = 'PIT_FINALIZATION_SELF_DEDUCTION_MONTHS' AND scope_key = 'GLOBAL');
