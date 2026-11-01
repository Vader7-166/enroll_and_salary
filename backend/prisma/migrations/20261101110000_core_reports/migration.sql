-- Core reports 10.x (FR-10.0.1…10.4.1, FR-2.1.5, 2.1.7, FR-4.5.5; R1-AC-10): every export is a recorded run.

CREATE TYPE "ReportRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

CREATE TABLE "report_run" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "report_type" VARCHAR(40) NOT NULL,
  "params" JSONB NOT NULL,
  "format" VARCHAR(8) NOT NULL CHECK ("format" IN ('XLSX', 'PDF')),
  "status" "ReportRunStatus" NOT NULL DEFAULT 'RUNNING',
  "data_status" VARCHAR(12) CHECK ("data_status" IN ('DRAFT', 'OFFICIAL')),
  "source" VARCHAR(500),
  "source_hash" CHAR(64),
  "row_count" INTEGER,
  "row_warning" BOOLEAN NOT NULL DEFAULT false,
  "file_name" VARCHAR(255),
  "file_sha256" CHAR(64),
  "file_cipher" TEXT,
  "failure" VARCHAR(2000),
  "duration_ms" INTEGER,
  "requested_by_id" UUID NOT NULL REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at" TIMESTAMPTZ(3),
  CONSTRAINT "report_run_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "report_run_requester_idx" ON "report_run"("requested_by_id", "requested_at" DESC);

-- Report queries scan these by period/date.
CREATE INDEX IF NOT EXISTS "daily_attendance_work_date_idx" ON "daily_attendance"("work_date", "org_unit_id");
CREATE INDEX IF NOT EXISTS "overtime_actual_work_date_idx" ON "overtime_actual"("work_date", "employee_id");
CREATE INDEX IF NOT EXISTS "tax_withholding_payment_date_idx" ON "tax_withholding"("payment_date");

INSERT INTO legal_parameter(id,param_code,scope_key,subject_type,application_basis,value,unit,effective_from,document_effective_date,legal_basis)
SELECT gen_random_uuid(),'REPORT_ROW_WARNING_THRESHOLD','GLOBAL','ALL','WORK_DATE','"20000"'::jsonb,'row','2020-01-01','2020-01-01','Ngưỡng cảnh báo số dòng khi kết xuất báo cáo; tài liệu 13 §6 — SIMULATION'
WHERE NOT EXISTS (SELECT 1 FROM legal_parameter WHERE param_code = 'REPORT_ROW_WARNING_THRESHOLD' AND scope_key = 'GLOBAL');
