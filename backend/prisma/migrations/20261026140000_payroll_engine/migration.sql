CREATE TYPE "PayrollRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');
CREATE TYPE "PayrollSheetStatus" AS ENUM ('DRAFT');
CREATE TYPE "PayrollEmployeeStatus" AS ENUM ('OK', 'ERROR');
CREATE TYPE "ComplianceSeverity" AS ENUM ('BLOCKING', 'WARNING');

CREATE TABLE "payroll_run" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "payroll_period_id" UUID NOT NULL REFERENCES "payroll_period"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "site_org_unit_id" UUID NOT NULL REFERENCES "org_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "status" "PayrollRunStatus" NOT NULL DEFAULT 'RUNNING',
  "scope" JSONB NOT NULL DEFAULT '{}',
  "progress_total" INTEGER NOT NULL DEFAULT 0,
  "progress_done" INTEGER NOT NULL DEFAULT 0,
  "error_count" INTEGER NOT NULL DEFAULT 0,
  "cancel_requested" BOOLEAN NOT NULL DEFAULT false,
  "source_hash" CHAR(64),
  "param_snapshot_hash" CHAR(64),
  "version_set" JSONB NOT NULL DEFAULT '{}',
  "attendance_locks" JSONB NOT NULL DEFAULT '[]',
  "failure" VARCHAR(2000),
  "started_by_id" UUID NOT NULL REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at" TIMESTAMPTZ(3),
  CONSTRAINT "payroll_run_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "payroll_run_period_idx" ON "payroll_run"("payroll_period_id", "started_at");
-- At most one run in progress per payroll period.
CREATE UNIQUE INDEX "payroll_run_one_running" ON "payroll_run"("payroll_period_id") WHERE "status" = 'RUNNING';

CREATE TABLE "payroll_sheet" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "payroll_period_id" UUID NOT NULL REFERENCES "payroll_period"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "status" "PayrollSheetStatus" NOT NULL DEFAULT 'DRAFT',
  "calc_count" INTEGER NOT NULL DEFAULT 0,
  "last_run_id" UUID REFERENCES "payroll_run"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "source_hash" CHAR(64),
  "revision" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payroll_sheet_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payroll_sheet_period_key" UNIQUE ("payroll_period_id")
);

CREATE TABLE "payroll_employee" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "sheet_id" UUID NOT NULL REFERENCES "payroll_sheet"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "run_id" UUID NOT NULL REFERENCES "payroll_run"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "employee_id" UUID NOT NULL REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "status" "PayrollEmployeeStatus" NOT NULL,
  "errors" JSONB NOT NULL DEFAULT '[]',
  "source_hash" CHAR(64) NOT NULL,
  "totals_cipher" TEXT NOT NULL,
  "net_pay_cipher" TEXT NOT NULL,
  "insurable_salary_cipher" TEXT,
  "detail_cipher" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payroll_employee_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payroll_employee_sheet_employee_key" UNIQUE ("sheet_id", "employee_id")
);
CREATE INDEX "payroll_employee_employee_idx" ON "payroll_employee"("employee_id");

CREATE TABLE "payroll_line" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "payroll_employee_id" UUID NOT NULL REFERENCES "payroll_employee"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "line_no" INTEGER NOT NULL,
  "line_type" VARCHAR(30) NOT NULL,
  "label" VARCHAR(200) NOT NULL,
  "component_id" UUID,
  "component_code" VARCHAR(80),
  "param_code" VARCHAR(80),
  "source_reference" VARCHAR(500),
  "amount_cipher" TEXT NOT NULL,
  "trace_cipher" TEXT NOT NULL,
  CONSTRAINT "payroll_line_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payroll_line_employee_no_key" UNIQUE ("payroll_employee_id", "line_no")
);
CREATE TABLE "payroll_line_input" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "payroll_line_id" UUID NOT NULL REFERENCES "payroll_line"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "source_type" VARCHAR(40) NOT NULL,
  "source_id" VARCHAR(200) NOT NULL,
  "version_id" VARCHAR(80),
  "source_hash" VARCHAR(64),
  CONSTRAINT "payroll_line_input_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "payroll_line_input_line_idx" ON "payroll_line_input"("payroll_line_id");
CREATE INDEX "payroll_line_input_source_idx" ON "payroll_line_input"("source_type", "source_id");

CREATE TABLE "payroll_run_error" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "run_id" UUID NOT NULL REFERENCES "payroll_run"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "employee_id" UUID REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "code" VARCHAR(60) NOT NULL,
  "message" VARCHAR(2000) NOT NULL,
  "detail" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payroll_run_error_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "payroll_run_error_run_idx" ON "payroll_run_error"("run_id");

CREATE TABLE "compliance_check_result" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "run_id" UUID NOT NULL REFERENCES "payroll_run"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "sheet_id" UUID NOT NULL REFERENCES "payroll_sheet"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "code" VARCHAR(20) NOT NULL,
  "severity" "ComplianceSeverity" NOT NULL,
  "violation_count" INTEGER NOT NULL CHECK ("violation_count" >= 0),
  "details_cipher" TEXT NOT NULL,
  "employee_ids" UUID[] NOT NULL DEFAULT '{}',
  "acknowledgements" JSONB NOT NULL DEFAULT '[]',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "compliance_check_result_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "compliance_check_result_run_code_key" UNIQUE ("run_id", "code")
);
CREATE INDEX "compliance_check_result_sheet_idx" ON "compliance_check_result"("sheet_id", "created_at");
-- Only CP-08 warnings accept acknowledgements; nothing else is ever rewritten.
CREATE FUNCTION compliance_check_result_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Compliance results are immutable'; END IF;
  IF OLD.severity <> 'WARNING' OR (to_jsonb(NEW) - 'acknowledgements') IS DISTINCT FROM (to_jsonb(OLD) - 'acknowledgements') THEN RAISE EXCEPTION 'Compliance results are immutable except warning acknowledgements'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER compliance_check_result_guard BEFORE UPDATE OR DELETE ON "compliance_check_result" FOR EACH ROW EXECUTE FUNCTION compliance_check_result_guard();

INSERT INTO legal_parameter(id,param_code,scope_key,subject_type,application_basis,value,unit,effective_from,document_effective_date,legal_basis)
SELECT gen_random_uuid(),code,'GLOBAL','ALL','WORK_DATE',amount,unit,'2025-01-01','2025-01-01',basis FROM (VALUES
 ('PAYROLL_STANDARD_WORKDAYS','"26"'::jsonb,'day','Công chuẩn lương thời gian sản xuất PS-01, HRTP-SIM-2026-V1 — SIMULATION'),
 ('PAYROLL_VARIANCE_THRESHOLD','"0.2"'::jsonb,'ratio','CP-08: chênh lệch tổng thu nhập so với kỳ trước cần KT xác nhận — SIMULATION'),
 ('DEDUCTION_MAX_NET_RATIO','"0.3"'::jsonb,'ratio','BLLĐ 2019 Điều 102 khoản 3: khấu trừ không quá 30% tiền lương thực trả sau BH, thuế — CP-04')
) AS p(code,amount,unit,basis)
WHERE NOT EXISTS (SELECT 1 FROM legal_parameter existing WHERE existing.param_code = p.code AND existing.scope_key = 'GLOBAL');

ALTER TABLE "insurance_contribution" ADD CONSTRAINT "insurance_contribution_payroll_employee_fkey" FOREIGN KEY ("payroll_employee_id") REFERENCES "payroll_employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

UPDATE "role" SET "function_permissions" = ARRAY(SELECT DISTINCT unnest("function_permissions" || ARRAY['payroll.read', 'payroll.calculate']) ORDER BY 1) WHERE "code" = 'KT';
