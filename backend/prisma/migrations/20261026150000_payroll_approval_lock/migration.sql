ALTER TYPE "PayrollSheetStatus" ADD VALUE IF NOT EXISTS 'APPROVED';
ALTER TYPE "PayrollSheetStatus" ADD VALUE IF NOT EXISTS 'LOCKED';

ALTER TABLE "payroll_period" ADD COLUMN "is_initial" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "payroll_sheet"
  ADD COLUMN "approved_source_hash" CHAR(64),
  ADD COLUMN "approved_at" TIMESTAMPTZ(3),
  ADD COLUMN "approved_by_id" UUID REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD COLUMN "locked_at" TIMESTAMPTZ(3),
  ADD COLUMN "locked_by_id" UUID REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "payroll_sheet_history" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "sheet_id" UUID NOT NULL REFERENCES "payroll_sheet"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "action" VARCHAR(30) NOT NULL,
  "from_status" VARCHAR(20) NOT NULL,
  "to_status" VARCHAR(20) NOT NULL,
  "revision" INTEGER NOT NULL,
  "source_hash" CHAR(64),
  "totals_cipher" TEXT,
  "reason" VARCHAR(2000),
  "actor_id" UUID REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payroll_sheet_history_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "payroll_sheet_history_sheet_idx" ON "payroll_sheet_history"("sheet_id", "created_at");

CREATE TABLE "payroll_snapshot" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "sheet_id" UUID NOT NULL REFERENCES "payroll_sheet"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "content_cipher" TEXT NOT NULL,
  "content_hash" CHAR(64) NOT NULL,
  "source_hash" CHAR(64) NOT NULL,
  "compliance" JSONB NOT NULL,
  "parameters" JSONB NOT NULL,
  "compliance_result_ids" UUID[] NOT NULL,
  "locked_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "locked_by_id" UUID NOT NULL REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payroll_snapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payroll_snapshot_sheet_key" UNIQUE ("sheet_id")
);

CREATE FUNCTION payroll_ledger_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Payroll history and snapshots are immutable'; END $$;
CREATE TRIGGER payroll_sheet_history_guard BEFORE UPDATE OR DELETE ON "payroll_sheet_history" FOR EACH ROW EXECUTE FUNCTION payroll_ledger_immutable();
CREATE TRIGGER payroll_sheet_history_no_truncate BEFORE TRUNCATE ON "payroll_sheet_history" FOR EACH STATEMENT EXECUTE FUNCTION payroll_ledger_immutable();
CREATE TRIGGER payroll_snapshot_guard BEFORE UPDATE OR DELETE ON "payroll_snapshot" FOR EACH ROW EXECUTE FUNCTION payroll_ledger_immutable();
CREATE TRIGGER payroll_snapshot_no_truncate BEFORE TRUNCATE ON "payroll_snapshot" FOR EACH STATEMENT EXECUTE FUNCTION payroll_ledger_immutable();

-- A LOCKED sheet never changes again; DRAFT ↔ APPROVED moves freely before the lock.
CREATE FUNCTION payroll_sheet_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status::text = 'LOCKED' THEN RAISE EXCEPTION 'Locked payroll sheet is immutable'; END IF;
  IF NEW.status::text = 'LOCKED' AND (OLD.status::text <> 'APPROVED' OR NOT EXISTS (SELECT 1 FROM "payroll_snapshot" WHERE "sheet_id" = NEW.id)) THEN
    RAISE EXCEPTION 'Only an APPROVED sheet with a snapshot can be locked';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payroll_sheet_guard BEFORE UPDATE OR DELETE ON "payroll_sheet" FOR EACH ROW EXECUTE FUNCTION payroll_sheet_guard();

CREATE FUNCTION payroll_locked_rows_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sheet_status TEXT;
BEGIN
  IF TG_TABLE_NAME = 'payroll_employee' THEN
    SELECT status::text INTO sheet_status FROM "payroll_sheet" WHERE "id" = OLD.sheet_id;
  ELSIF TG_TABLE_NAME = 'payroll_line' THEN
    SELECT sheet.status::text INTO sheet_status FROM "payroll_employee" employee JOIN "payroll_sheet" sheet ON sheet.id = employee.sheet_id WHERE employee.id = OLD.payroll_employee_id;
  ELSIF TG_TABLE_NAME = 'payroll_line_input' THEN
    SELECT sheet.status::text INTO sheet_status FROM "payroll_line" line JOIN "payroll_employee" employee ON employee.id = line.payroll_employee_id JOIN "payroll_sheet" sheet ON sheet.id = employee.sheet_id WHERE line.id = OLD.payroll_line_id;
  ELSE
    SELECT sheet.status::text INTO sheet_status FROM "payroll_employee" employee JOIN "payroll_sheet" sheet ON sheet.id = employee.sheet_id WHERE employee.id = OLD.payroll_employee_id;
  END IF;
  IF sheet_status = 'LOCKED' THEN RAISE EXCEPTION 'Rows of a locked payroll sheet are immutable'; END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER payroll_employee_locked_guard BEFORE UPDATE OR DELETE ON "payroll_employee" FOR EACH ROW EXECUTE FUNCTION payroll_locked_rows_guard();
CREATE TRIGGER payroll_line_locked_guard BEFORE UPDATE OR DELETE ON "payroll_line" FOR EACH ROW EXECUTE FUNCTION payroll_locked_rows_guard();
CREATE TRIGGER payroll_line_input_locked_guard BEFORE UPDATE OR DELETE ON "payroll_line_input" FOR EACH ROW EXECUTE FUNCTION payroll_locked_rows_guard();
CREATE TRIGGER insurance_contribution_locked_guard BEFORE DELETE ON "insurance_contribution" FOR EACH ROW EXECUTE FUNCTION payroll_locked_rows_guard();

INSERT INTO legal_parameter(id,param_code,scope_key,subject_type,application_basis,value,unit,effective_from,document_effective_date,legal_basis)
SELECT gen_random_uuid(),'PAYROLL_DUE_WARNING_DAYS','GLOBAL','ALL','WORK_DATE','"3"'::jsonb,'day','2025-01-01','2025-01-01','FR-7.5.3: cảnh báo khi còn ≤ N ngày đến ngày chi dự kiến mà bảng lương chưa khóa — SIMULATION'
WHERE NOT EXISTS (SELECT 1 FROM legal_parameter WHERE param_code = 'PAYROLL_DUE_WARNING_DAYS');

UPDATE "role" SET "function_permissions" = ARRAY(SELECT DISTINCT unnest("function_permissions" || ARRAY['payroll.approve', 'payroll.lock']) ORDER BY 1) WHERE "code" = 'KT';
