-- Contract expiry alerts (FR-2.4.1, 2.4.2; BR-58) and contract termination across modules (FR-2.5.1, 2.5.2, FR-9.3.1,
-- FR-6.2.3; BR-36, BR-59; UAT-27; SQ-09). Nothing changes on a contract or employee until KT confirms.

CREATE TYPE "TerminationStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'CANCELLED');
CREATE TYPE "TerminationReason" AS ENUM ('RESIGNATION', 'JOB_LOSS', 'CONTRACT_EXPIRY', 'MUTUAL_AGREEMENT', 'OTHER');

CREATE TABLE "termination_decision" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "employee_id" UUID NOT NULL REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "decision_number" VARCHAR(80) NOT NULL,
  "effective_date" DATE NOT NULL,
  "reason" "TerminationReason" NOT NULL,
  "allowance_kind" VARCHAR(16) NOT NULL CHECK ("allowance_kind" IN ('SEVERANCE', 'JOB_LOSS', 'NONE')),
  "legal_basis" VARCHAR(1000) NOT NULL,
  "note" VARCHAR(2000),
  "external_unemployment_months" INTEGER NOT NULL DEFAULT 0 CHECK ("external_unemployment_months" >= 0),
  "external_unemployment_evidence" VARCHAR(500),
  "status" "TerminationStatus" NOT NULL DEFAULT 'DRAFT',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "preview_cipher" TEXT NOT NULL,
  "preview_hash" CHAR(64) NOT NULL,
  "created_by_id" UUID NOT NULL REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmed_by_id" UUID REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "confirmed_at" TIMESTAMPTZ(3),
  "cancelled_at" TIMESTAMPTZ(3),
  "cancel_reason" VARCHAR(2000),
  CONSTRAINT "termination_decision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "termination_decision_number_key" UNIQUE ("employee_id", "decision_number"),
  CONSTRAINT "termination_decision_evidence" CHECK ("external_unemployment_months" = 0 OR "external_unemployment_evidence" IS NOT NULL),
  CONSTRAINT "termination_decision_confirmed" CHECK (("status" = 'CONFIRMED') = ("confirmed_at" IS NOT NULL))
);
-- One live (draft or confirmed) termination per employee.
CREATE UNIQUE INDEX "termination_decision_live_key" ON "termination_decision"("employee_id") WHERE "status" IN ('DRAFT', 'CONFIRMED');

CREATE TABLE "severance_allowance" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "decision_id" UUID NOT NULL REFERENCES "termination_decision"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "employee_id" UUID NOT NULL REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "allowance_kind" VARCHAR(16) NOT NULL CHECK ("allowance_kind" IN ('SEVERANCE', 'JOB_LOSS')),
  "service_months" INTEGER NOT NULL CHECK ("service_months" >= 0),
  "detail_cipher" TEXT NOT NULL,
  "amount_cipher" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "severance_allowance_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "severance_allowance_decision_key" UNIQUE ("decision_id")
);
CREATE INDEX "severance_allowance_employee_idx" ON "severance_allowance"("employee_id");

CREATE TABLE "termination_payment_item" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "decision_id" UUID NOT NULL REFERENCES "termination_decision"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "employee_id" UUID NOT NULL REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "site_org_unit_id" UUID NOT NULL REFERENCES "org_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "kind" VARCHAR(24) NOT NULL CHECK ("kind" IN ('SEVERANCE', 'JOB_LOSS', 'UNUSED_LEAVE_PAY')),
  "label" VARCHAR(200) NOT NULL,
  "amount_cipher" TEXT NOT NULL,
  "detail_cipher" TEXT NOT NULL,
  -- NULL while no open payroll period of the site exists yet; bound when the next period is calculated.
  "payroll_period_id" UUID REFERENCES "payroll_period"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "termination_payment_item_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "termination_payment_item_decision_kind_key" UNIQUE ("decision_id", "kind")
);
CREATE INDEX "termination_payment_item_period_idx" ON "termination_payment_item"("payroll_period_id");

-- Allowances and payment items are written once at confirmation; only the late period binding may change.
CREATE FUNCTION termination_rows_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'TERMINATION_IMMUTABLE'; END IF;
  IF TG_TABLE_NAME = 'termination_payment_item' AND OLD.payroll_period_id IS NULL
     AND (NEW.amount_cipher, NEW.detail_cipher, NEW.kind, NEW.employee_id, NEW.decision_id) IS NOT DISTINCT FROM (OLD.amount_cipher, OLD.detail_cipher, OLD.kind, OLD.employee_id, OLD.decision_id) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'TERMINATION_IMMUTABLE';
END;
$$;
CREATE TRIGGER severance_allowance_guard BEFORE UPDATE OR DELETE ON "severance_allowance" FOR EACH ROW EXECUTE FUNCTION termination_rows_guard();
CREATE TRIGGER termination_payment_item_guard BEFORE UPDATE OR DELETE ON "termination_payment_item" FOR EACH ROW EXECUTE FUNCTION termination_rows_guard();

-- A confirmed decision is final; a draft may only be re-previewed, confirmed or cancelled.
CREATE FUNCTION termination_decision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status <> 'DRAFT' THEN RAISE EXCEPTION 'TERMINATION_DECISION_FINAL'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER termination_decision_guard BEFORE UPDATE OR DELETE ON "termination_decision" FOR EACH ROW EXECUTE FUNCTION termination_decision_guard();

-- Indefinite contracts keep end_date NULL (indefinite_end_date); termination is recorded alongside, not by rewriting the term.
ALTER TABLE "employment_contract" ADD COLUMN "terminated_on" DATE;
ALTER TABLE "employment_contract" ADD COLUMN "termination_decision_id" UUID REFERENCES "termination_decision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employment_contract" ADD CONSTRAINT "employment_contract_termination" CHECK (("terminated_on" IS NULL) = ("termination_decision_id" IS NULL) AND ("terminated_on" IS NULL OR "terminated_on" >= "start_date"));

INSERT INTO legal_parameter(id,param_code,scope_key,subject_type,application_basis,value,unit,effective_from,document_effective_date,legal_basis)
SELECT gen_random_uuid(),code,'GLOBAL','ALL','WORK_DATE',amount,unit,'2021-01-01','2021-01-01',basis FROM (VALUES
 ('CONTRACT_EXPIRY_WARNING_DAYS','"30"'::jsonb,'day','Số ngày cảnh báo hợp đồng sắp hết hạn (30 hoặc 60); tài liệu 04 FR-2.4.1 — SIMULATION'),
 ('SEVERANCE_MONTHS_PER_YEAR','"0.5"'::jsonb,'month','Trợ cấp thôi việc: mỗi năm làm việc được trợ cấp một nửa tháng tiền lương; BLLĐ 2019 Điều 46 — SIMULATION'),
 ('JOB_LOSS_MONTHS_PER_YEAR','"1"'::jsonb,'month','Trợ cấp mất việc làm: mỗi năm làm việc trả 01 tháng tiền lương; BLLĐ 2019 Điều 47 — SIMULATION'),
 ('JOB_LOSS_MIN_MONTHS','"2"'::jsonb,'month','Trợ cấp mất việc làm ít nhất bằng 02 tháng tiền lương; BLLĐ 2019 Điều 47 — SIMULATION'),
 ('SEVERANCE_SALARY_AVERAGE_MONTHS','"6"'::jsonb,'month','Tiền lương tính trợ cấp là bình quân 06 tháng liền kề theo HĐ trước khi nghỉ; BLLĐ 2019 Điều 46 khoản 3 — SIMULATION'),
 ('SEVERANCE_HALF_YEAR_FROM_MONTHS','"1"'::jsonb,'month','Tháng lẻ từ đủ 01 đến dưới 06 tháng tính 1/2 năm, từ đủ 06 tháng tính 01 năm; NĐ 145/2020/NĐ-CP Điều 8 — SIMULATION, chờ chủ dự án xác nhận'),
 ('SEVERANCE_FULL_YEAR_FROM_MONTHS','"6"'::jsonb,'month','Tháng lẻ từ đủ 06 tháng trở lên tính 01 năm; NĐ 145/2020/NĐ-CP Điều 8 — SIMULATION, chờ chủ dự án xác nhận')
) AS p(code,amount,unit,basis)
WHERE NOT EXISTS (SELECT 1 FROM legal_parameter existing WHERE existing.param_code = p.code AND existing.scope_key = 'GLOBAL');
