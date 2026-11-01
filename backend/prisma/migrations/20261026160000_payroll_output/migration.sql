-- Payslips, bank payment files, actual payment dates and late-payment compensation (FR-7.6.1…7.6.3, FR-7.5.4).

CREATE TYPE "PayslipExportStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED', 'DOWNLOADED', 'EXPIRED');
CREATE TYPE "PayslipStatus" AS ENUM ('ISSUED', 'FAILED');
CREATE TYPE "BankFileType" AS ENUM ('CSV', 'XLSX');
CREATE TYPE "SalaryPaymentStatus" AS ENUM ('EXPORTED', 'PAID', 'CANCELLED');
CREATE TYPE "PayrollAdjustmentStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'DISMISSED');

CREATE TABLE "payslip_export" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "sheet_id" UUID NOT NULL REFERENCES "payroll_sheet"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "status" "PayslipExportStatus" NOT NULL DEFAULT 'RUNNING',
  "progress_total" INTEGER NOT NULL DEFAULT 0,
  "progress_done" INTEGER NOT NULL DEFAULT 0,
  "error_count" INTEGER NOT NULL DEFAULT 0,
  "archive_path" VARCHAR(500),
  "archive_hash" CHAR(64),
  "archive_bytes" INTEGER,
  "failure" VARCHAR(2000),
  "expires_at" TIMESTAMPTZ(3),
  "downloaded_at" TIMESTAMPTZ(3),
  "created_by_id" UUID NOT NULL REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at" TIMESTAMPTZ(3),
  CONSTRAINT "payslip_export_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "payslip_export_sheet_idx" ON "payslip_export"("sheet_id", "created_at");
CREATE UNIQUE INDEX "payslip_export_running_key" ON "payslip_export"("sheet_id") WHERE "status" = 'RUNNING';

-- One row per issued (or failed) payslip file; the password is never stored.
CREATE TABLE "payslip" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "export_id" UUID REFERENCES "payslip_export"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "sheet_id" UUID NOT NULL REFERENCES "payroll_sheet"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "payroll_employee_id" UUID NOT NULL REFERENCES "payroll_employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "employee_id" UUID NOT NULL REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "status" "PayslipStatus" NOT NULL,
  "channel" VARCHAR(20) NOT NULL,
  "file_name" VARCHAR(200),
  "file_hash" CHAR(64),
  "snapshot_hash" CHAR(64) NOT NULL,
  "error_code" VARCHAR(60),
  "error_message" VARCHAR(2000),
  "issued_by_id" UUID NOT NULL REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "issued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payslip_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "payslip_sheet_employee_idx" ON "payslip"("sheet_id", "employee_id", "issued_at");
CREATE INDEX "payslip_export_idx" ON "payslip"("export_id");

-- Bank file layouts are data (NFR-21): a new bank or layout is a new versioned row, never code.
CREATE TABLE "bank_file_template" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "bank_code" VARCHAR(20) NOT NULL REFERENCES "bank"("code") ON DELETE RESTRICT ON UPDATE CASCADE,
  "version" INTEGER NOT NULL,
  "name" VARCHAR(200) NOT NULL,
  "file_type" "BankFileType" NOT NULL,
  "columns" JSONB NOT NULL,
  "split_by_site" BOOLEAN NOT NULL DEFAULT false,
  "include_header" BOOLEAN NOT NULL DEFAULT true,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "status" "PolicyStatus" NOT NULL,
  "reason" VARCHAR(2000) NOT NULL,
  "created_by_id" UUID REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bank_file_template_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "bank_file_template_version_key" UNIQUE ("bank_code", "version")
);

CREATE TABLE "salary_payment_batch" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" VARCHAR(64) NOT NULL,
  "template_id" UUID NOT NULL REFERENCES "bank_file_template"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "status" "SalaryPaymentStatus" NOT NULL DEFAULT 'EXPORTED',
  "item_count" INTEGER NOT NULL,
  "total_cipher" TEXT NOT NULL,
  "file_hash" CHAR(64) NOT NULL,
  "due_date" DATE NOT NULL,
  "paid_date" DATE,
  "late_days" INTEGER,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "note" VARCHAR(2000),
  "cancel_reason" VARCHAR(2000),
  "created_by_id" UUID NOT NULL REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "paid_by_id" UUID REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "paid_at" TIMESTAMPTZ(3),
  "cancelled_by_id" UUID REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "cancelled_at" TIMESTAMPTZ(3),
  CONSTRAINT "salary_payment_batch_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "salary_payment_batch_code_key" UNIQUE ("code")
);

CREATE TABLE "salary_payment_item" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "batch_id" UUID NOT NULL REFERENCES "salary_payment_batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "sheet_id" UUID NOT NULL REFERENCES "payroll_sheet"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "payroll_period_id" UUID NOT NULL REFERENCES "payroll_period"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "payroll_employee_id" UUID NOT NULL REFERENCES "payroll_employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "employee_id" UUID NOT NULL REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "site_org_unit_id" UUID NOT NULL REFERENCES "org_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "bank_account_id" UUID NOT NULL REFERENCES "employee_bank_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "amount_cipher" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "salary_payment_item_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "salary_payment_item_batch_idx" ON "salary_payment_item"("batch_id");
-- Decision 4: one employee of one period belongs to at most one live payment batch.
CREATE UNIQUE INDEX "salary_payment_item_active_key" ON "salary_payment_item"("payroll_period_id", "employee_id") WHERE "active";

-- Generic pending adjustment read by the engine's adjustment stage (step 10) of the next open period.
CREATE TABLE "payroll_adjustment" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "employee_id" UUID NOT NULL REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "kind" VARCHAR(40) NOT NULL,
  "status" "PayrollAdjustmentStatus" NOT NULL,
  "label" VARCHAR(200) NOT NULL,
  "origin_payroll_period_id" UUID NOT NULL REFERENCES "payroll_period"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "applied_payroll_period_id" UUID REFERENCES "payroll_period"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "amount_cipher" TEXT NOT NULL,
  "detail_cipher" TEXT NOT NULL,
  "source_type" VARCHAR(40) NOT NULL,
  "source_id" UUID NOT NULL,
  "created_by_id" UUID REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmed_by_id" UUID REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "confirmed_at" TIMESTAMPTZ(3),
  "applied_at" TIMESTAMPTZ(3),
  CONSTRAINT "payroll_adjustment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payroll_adjustment_source_key" UNIQUE ("source_type", "source_id", "kind")
);
CREATE INDEX "payroll_adjustment_pending_idx" ON "payroll_adjustment"("employee_id", "status") WHERE "applied_payroll_period_id" IS NULL;

CREATE FUNCTION payroll_output_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME; END $$;
CREATE TRIGGER payslip_guard BEFORE UPDATE OR DELETE ON "payslip" FOR EACH ROW EXECUTE FUNCTION payroll_output_append_only();
CREATE TRIGGER payslip_no_truncate BEFORE TRUNCATE ON "payslip" FOR EACH STATEMENT EXECUTE FUNCTION payroll_output_append_only();
CREATE TRIGGER bank_file_template_guard BEFORE UPDATE OR DELETE ON "bank_file_template" FOR EACH ROW EXECUTE FUNCTION payroll_output_append_only();

-- Items never change except leaving a cancelled batch; amounts and accounts are fixed at export.
CREATE FUNCTION salary_payment_item_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR NOT (OLD.active AND NOT NEW.active AND (to_jsonb(NEW) - 'active') = (to_jsonb(OLD) - 'active')) THEN
    RAISE EXCEPTION 'Salary payment items are immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER salary_payment_item_guard BEFORE UPDATE OR DELETE ON "salary_payment_item" FOR EACH ROW EXECUTE FUNCTION salary_payment_item_guard();

-- EXPORTED → PAID or EXPORTED → CANCELLED once; file, template and totals never change.
CREATE FUNCTION salary_payment_batch_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status::text <> 'EXPORTED' THEN RAISE EXCEPTION 'Paid or cancelled payment batch is immutable'; END IF;
  IF NEW.code <> OLD.code OR NEW.template_id <> OLD.template_id OR NEW.item_count <> OLD.item_count OR NEW.total_cipher <> OLD.total_cipher OR NEW.file_hash <> OLD.file_hash OR NEW.due_date <> OLD.due_date
  THEN RAISE EXCEPTION 'Payment batch content is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER salary_payment_batch_guard BEFORE UPDATE OR DELETE ON "salary_payment_batch" FOR EACH ROW EXECUTE FUNCTION salary_payment_batch_guard();

-- An adjustment applied by a locked period is part of that period's history.
CREATE FUNCTION payroll_adjustment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status::text = 'DRAFT' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Confirmed payroll adjustments are kept';
  END IF;
  IF OLD.applied_payroll_period_id IS NOT NULL THEN RAISE EXCEPTION 'Applied payroll adjustment is immutable'; END IF;
  IF NEW.employee_id <> OLD.employee_id OR NEW.kind <> OLD.kind OR NEW.origin_payroll_period_id <> OLD.origin_payroll_period_id OR NEW.source_id <> OLD.source_id
  THEN RAISE EXCEPTION 'Payroll adjustment identity is immutable'; END IF;
  IF OLD.status::text <> 'DRAFT' AND (NEW.amount_cipher <> OLD.amount_cipher OR NEW.status <> OLD.status) THEN RAISE EXCEPTION 'Confirmed or dismissed adjustment is final'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payroll_adjustment_guard BEFORE UPDATE OR DELETE ON "payroll_adjustment" FOR EACH ROW EXECUTE FUNCTION payroll_adjustment_guard();

-- Actual payment date (FR-7.6.3): a LOCKED withholding may move PROJECTED → ACTUAL once and carry a context flag.
ALTER TABLE "tax_withholding" ADD COLUMN "context_flag" VARCHAR(30);
CREATE OR REPLACE FUNCTION tax_withholding_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'DRAFT' AND OLD.filing_status = 'NOT_FILED' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Locked or filed tax withholding is immutable';
  END IF;
  IF OLD.filing_status = 'FILED' THEN RAISE EXCEPTION 'Filed tax withholding is immutable; create an adjustment'; END IF;
  IF OLD.status = 'LOCKED' THEN
    IF (to_jsonb(NEW) - 'filing_status' - 'updated_at' - 'payment_date' - 'payment_date_status' - 'context_flag') IS DISTINCT FROM (to_jsonb(OLD) - 'filing_status' - 'updated_at' - 'payment_date' - 'payment_date_status' - 'context_flag')
      OR (NEW.filing_status <> OLD.filing_status AND NEW.filing_status <> 'FILED')
    THEN RAISE EXCEPTION 'Locked tax withholding is immutable except filing and actual payment date'; END IF;
    IF (NEW.payment_date, NEW.payment_date_status, NEW.context_flag) IS DISTINCT FROM (OLD.payment_date, OLD.payment_date_status, OLD.context_flag)
      AND NOT (OLD.payment_date_status = 'PROJECTED' AND NEW.payment_date_status = 'ACTUAL')
    THEN RAISE EXCEPTION 'Actual payment date of a locked withholding is recorded once'; END IF;
  END IF;
  IF NEW.employee_id <> OLD.employee_id OR NEW.payment_key <> OLD.payment_key OR NEW.original_withholding_id IS DISTINCT FROM OLD.original_withholding_id
  THEN RAISE EXCEPTION 'Tax withholding identity is immutable'; END IF;
  RETURN NEW;
END $$;

INSERT INTO legal_parameter(id,param_code,scope_key,subject_type,application_basis,value,unit,effective_from,document_effective_date,legal_basis)
SELECT gen_random_uuid(),'LATE_PAYMENT_RATE','GLOBAL','ALL','PAYMENT_DATE','"0.005"'::jsonb,'ratio/year','2025-01-01','2025-01-01','BR-61, Điều 97 BLLĐ 2019 và Điều 57 NĐ 145/2020: đền bù ≥ tiền lãi theo lãi suất huy động tiền gửi kỳ hạn 1 tháng tại thời điểm trả lương — SIMULATION, KT cập nhật lãi suất thực tế'
WHERE NOT EXISTS (SELECT 1 FROM legal_parameter WHERE param_code = 'LATE_PAYMENT_RATE');
INSERT INTO legal_parameter(id,param_code,scope_key,subject_type,application_basis,value,unit,effective_from,document_effective_date,legal_basis)
SELECT gen_random_uuid(),'LATE_PAYMENT_GRACE_DAYS','GLOBAL','ALL','PAYMENT_DATE','"15"'::jsonb,'day','2025-01-01','2025-01-01','Điều 97 BLLĐ 2019: chậm trả quá 15 ngày phải đền bù — SIMULATION'
WHERE NOT EXISTS (SELECT 1 FROM legal_parameter WHERE param_code = 'LATE_PAYMENT_GRACE_DAYS');
INSERT INTO legal_parameter(id,param_code,scope_key,subject_type,application_basis,value,unit,effective_from,document_effective_date,legal_basis)
SELECT gen_random_uuid(),'PAYSLIP_PASSWORD_RULE','GLOBAL','ALL','PAYMENT_DATE','"EMPLOYEE_CODE+ID_LAST4+DOB_DDMMYYYY"'::jsonb,'rule','2025-01-01','2025-01-01','Docs 10 §3.3: mật khẩu mở phiếu lương ghép mã NV + 4 số cuối giấy tờ + ngày sinh; không lưu, không gửi cùng kênh — SIMULATION'
WHERE NOT EXISTS (SELECT 1 FROM legal_parameter WHERE param_code = 'PAYSLIP_PASSWORD_RULE');

INSERT INTO "bank_file_template" ("bank_code", "version", "name", "file_type", "columns", "split_by_site", "include_header", "status", "reason") VALUES
 ('VCB', 1, 'Mẫu chi lương Vietcombank (mô phỏng)', 'XLSX', '[{"field":"SEQ","header":"STT"},{"field":"ACCOUNT_NUMBER","header":"So tai khoan"},{"field":"BENEFICIARY_NAME","header":"Ten nguoi huong","format":"UPPER_ASCII"},{"field":"AMOUNT","header":"So tien","format":"INTEGER"},{"field":"BANK_CODE","header":"Ma ngan hang"},{"field":"DESCRIPTION","header":"Noi dung","format":"UPPER_ASCII"},{"field":"EMPLOYEE_CODE","header":"Ma NV"}]'::jsonb, true, true, 'SIMULATION', 'Mẫu mô phỏng theo docs 11 §2; chưa phải mẫu ngân hàng thật (PV2-22)');

UPDATE "role" SET "function_permissions" = ARRAY(SELECT DISTINCT unnest("function_permissions" || ARRAY['payroll.payslips', 'payroll.payment']) ORDER BY 1) WHERE "code" = 'KT';
