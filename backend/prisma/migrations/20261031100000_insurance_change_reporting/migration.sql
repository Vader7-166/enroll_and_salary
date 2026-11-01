-- Monthly insurance increase/decrease/adjustment lists (FR-8.3.1, 8.3.2; BR-51), late-report arrears/refunds and
-- C12 reconciliation (FR-8.3.3). Salary bases and amounts are AES-GCM ciphers like every other payroll value.

CREATE TYPE "InsuranceChangeListStatus" AS ENUM ('DRAFT', 'FINALIZED');
CREATE TYPE "InsuranceChangeType" AS ENUM ('INCREASE', 'DECREASE', 'ADJUST');
CREATE TYPE "InsuranceFileTemplateKind" AS ENUM ('EXPORT', 'C12');
CREATE TYPE "C12DifferenceCategory" AS ENUM ('MISSING_IN_C12', 'MISSING_IN_SYSTEM', 'AMOUNT_DIFF', 'SALARY_BASE_DIFF');

-- Column layouts are configuration (versioned), never code: the official D02-LT / C12 forms replace the simulation rows.
CREATE TABLE "insurance_file_template" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "kind" "InsuranceFileTemplateKind" NOT NULL,
  "code" VARCHAR(64) NOT NULL,
  "version" INTEGER NOT NULL,
  "name" VARCHAR(200) NOT NULL,
  "header_row" INTEGER NOT NULL DEFAULT 1 CHECK ("header_row" BETWEEN 1 AND 50),
  "columns" JSONB NOT NULL,
  "status" "PolicyStatus" NOT NULL,
  "legal_basis" VARCHAR(500) NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "insurance_file_template_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "insurance_file_template_code_version_key" UNIQUE ("kind", "code", "version")
);

CREATE TABLE "insurance_change_list" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "site_org_unit_id" UUID NOT NULL REFERENCES "org_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "month" CHAR(7) NOT NULL CHECK ("month" ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  "status" "InsuranceChangeListStatus" NOT NULL DEFAULT 'DRAFT',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "item_count" INTEGER NOT NULL DEFAULT 0,
  "content_hash" CHAR(64),
  "generated_at" TIMESTAMPTZ(3),
  "generated_by_id" UUID REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "finalized_at" TIMESTAMPTZ(3),
  "finalized_by_id" UUID REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "insurance_change_list_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "insurance_change_list_site_month_key" UNIQUE ("site_org_unit_id", "month"),
  CONSTRAINT "insurance_change_list_finalized" CHECK (("status" = 'FINALIZED') = ("finalized_at" IS NOT NULL))
);

-- Declared state per employee for the list month: what was reported, the baseline for late detection and arrears.
CREATE TABLE "insurance_change_state" (
  "list_id" UUID NOT NULL REFERENCES "insurance_change_list"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "employee_id" UUID NOT NULL REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "eligible" JSONB NOT NULL,
  "reason_code" VARCHAR(40) NOT NULL,
  "state_cipher" TEXT NOT NULL,
  CONSTRAINT "insurance_change_state_pkey" PRIMARY KEY ("list_id", "employee_id")
);

CREATE TABLE "insurance_change_item" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "list_id" UUID NOT NULL REFERENCES "insurance_change_list"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "employee_id" UUID NOT NULL REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "change_type" "InsuranceChangeType" NOT NULL,
  "reason_code" VARCHAR(40) NOT NULL,
  "effective_date" DATE NOT NULL,
  "values_cipher" TEXT NOT NULL,
  "source" JSONB NOT NULL DEFAULT '{}',
  "late" BOOLEAN NOT NULL DEFAULT false,
  "origin_month" CHAR(7),
  CONSTRAINT "insurance_change_item_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "insurance_change_item_late_origin" CHECK ("late" = ("origin_month" IS NOT NULL))
);
CREATE INDEX "insurance_change_item_list_idx" ON "insurance_change_item"("list_id");
CREATE INDEX "insurance_change_item_employee_idx" ON "insurance_change_item"("employee_id", "origin_month");

CREATE TABLE "insurance_arrears" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "item_id" UUID NOT NULL REFERENCES "insurance_change_item"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "origin_month" CHAR(7) NOT NULL,
  "direction" VARCHAR(10) NOT NULL CHECK ("direction" IN ('ARREARS', 'REFUND')),
  "detail_cipher" TEXT NOT NULL,
  CONSTRAINT "insurance_arrears_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "insurance_arrears_item_month_key" UNIQUE ("item_id", "origin_month")
);

CREATE FUNCTION insurance_change_finalized_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE list_status TEXT;
BEGIN
  IF TG_TABLE_NAME = 'insurance_change_list' THEN
    IF OLD.status = 'FINALIZED' THEN RAISE EXCEPTION 'INSURANCE_LIST_FINALIZED'; END IF;
    RETURN COALESCE(NEW, OLD);
  ELSIF TG_TABLE_NAME = 'insurance_arrears' THEN
    SELECT l.status::text INTO list_status FROM insurance_change_item i JOIN insurance_change_list l ON l.id = i.list_id WHERE i.id = COALESCE(NEW.item_id, OLD.item_id);
  ELSE
    SELECT status::text INTO list_status FROM insurance_change_list WHERE id = COALESCE(NEW.list_id, OLD.list_id);
  END IF;
  IF list_status = 'FINALIZED' THEN RAISE EXCEPTION 'INSURANCE_LIST_FINALIZED'; END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
CREATE TRIGGER insurance_change_list_guard BEFORE UPDATE OR DELETE ON "insurance_change_list" FOR EACH ROW EXECUTE FUNCTION insurance_change_finalized_guard();
CREATE TRIGGER insurance_change_state_guard BEFORE INSERT OR UPDATE OR DELETE ON "insurance_change_state" FOR EACH ROW EXECUTE FUNCTION insurance_change_finalized_guard();
CREATE TRIGGER insurance_change_item_guard BEFORE INSERT OR UPDATE OR DELETE ON "insurance_change_item" FOR EACH ROW EXECUTE FUNCTION insurance_change_finalized_guard();
CREATE TRIGGER insurance_arrears_guard BEFORE INSERT OR UPDATE OR DELETE ON "insurance_arrears" FOR EACH ROW EXECUTE FUNCTION insurance_change_finalized_guard();

CREATE TABLE "c12_import" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "site_org_unit_id" UUID NOT NULL REFERENCES "org_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "month" CHAR(7) NOT NULL CHECK ("month" ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  "template_id" UUID NOT NULL REFERENCES "insurance_file_template"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "file_name" VARCHAR(255) NOT NULL,
  "file_hash" CHAR(64) NOT NULL,
  "row_count" INTEGER NOT NULL,
  "summary" JSONB NOT NULL,
  "imported_by_id" UUID NOT NULL REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "imported_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "c12_import_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "c12_import_site_month_idx" ON "c12_import"("site_org_unit_id", "month", "imported_at" DESC);

CREATE TABLE "c12_difference" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "import_id" UUID NOT NULL REFERENCES "c12_import"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "category" "C12DifferenceCategory" NOT NULL,
  "employee_id" UUID REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "row_number" INTEGER,
  "detail_cipher" TEXT NOT NULL,
  CONSTRAINT "c12_difference_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "c12_difference_import_idx" ON "c12_difference"("import_id", "category");

-- Imports and their differences are evidence: append-only.
CREATE FUNCTION c12_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'C12_IMMUTABLE'; END; $$;
CREATE TRIGGER c12_import_immutable BEFORE UPDATE OR DELETE ON "c12_import" FOR EACH ROW EXECUTE FUNCTION c12_append_only();
CREATE TRIGGER c12_difference_immutable BEFORE UPDATE OR DELETE ON "c12_difference" FOR EACH ROW EXECUTE FUNCTION c12_append_only();

INSERT INTO "insurance_file_template" ("kind", "code", "version", "name", "header_row", "columns", "status", "legal_basis") VALUES
 ('EXPORT', 'BH-BIEN-DONG-MP', 1, 'Danh sách báo tăng/giảm/điều chỉnh (mẫu mô phỏng)', 1,
  '[{"field":"employeeCode","header":"Mã NV"},{"field":"fullName","header":"Họ và tên"},{"field":"siBook","header":"Mã số BHXH"},{"field":"changeType","header":"Loại biến động"},{"field":"reason","header":"Lý do"},{"field":"effectiveDate","header":"Từ ngày"},{"field":"oldBase","header":"Mức đóng cũ"},{"field":"newBase","header":"Mức đóng mới"},{"field":"late","header":"Báo muộn"},{"field":"originMonth","header":"Tháng gốc"},{"field":"arrears","header":"Truy thu (+) / thoái thu (−)"}]',
  'SIMULATION', 'Cột theo mẫu mô phỏng; thay bằng mẫu D02-LT hiện hành khi cơ quan BHXH xác nhận — SIMULATION'),
 ('C12', 'C12-MP', 1, 'Thông báo kết quả đóng BHXH, BHYT, BHTN — C12 (mẫu mô phỏng)', 1,
  '{"siBook":"Mã số BHXH","fullName":"Họ và tên","insurableSalary":"Mức lương đóng","amount":"Số phải đóng"}',
  'SIMULATION', 'Ánh xạ cột theo mẫu C12 mô phỏng; cấu hình lại khi có tệp C12 thật — SIMULATION');

INSERT INTO legal_parameter(id,param_code,scope_key,subject_type,application_basis,value,unit,effective_from,document_effective_date,legal_basis)
SELECT gen_random_uuid(),'INSURANCE_LATE_LOOKBACK_MONTHS','GLOBAL','ALL','WORK_DATE','"3"'::jsonb,'month','2026-01-01','2026-01-01','Số tháng đã chốt được rà lại để phát hiện biến động BH báo muộn; tài liệu 05 FR-8.3.2 — SIMULATION'
WHERE NOT EXISTS (SELECT 1 FROM legal_parameter WHERE param_code = 'INSURANCE_LATE_LOOKBACK_MONTHS' AND scope_key = 'GLOBAL');
