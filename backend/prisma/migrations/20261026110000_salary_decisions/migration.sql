CREATE TYPE "RetroCandidateStatus" AS ENUM ('PENDING', 'RESOLVED', 'DISMISSED');

CREATE TABLE "salary_decision" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "employee_id" UUID NOT NULL REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "decision_number" VARCHAR(80) NOT NULL CHECK (btrim("decision_number") <> ''),
  "decision_date" DATE NOT NULL,
  "effective_from" DATE NOT NULL,
  "reason" VARCHAR(2000) NOT NULL CHECK (btrim("reason") <> ''),
  "legal_basis" VARCHAR(1000) NOT NULL CHECK (btrim("legal_basis") <> ''),
  "warnings" JSONB NOT NULL DEFAULT '[]',
  "warning_acknowledgement" VARCHAR(2000),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by_id" UUID NOT NULL REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "salary_decision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "salary_decision_employee_id_decision_number_key" UNIQUE ("employee_id", "decision_number"),
  CONSTRAINT "salary_decision_dates_check" CHECK ("decision_date" <= "effective_from" + 366)
);
CREATE INDEX "salary_decision_employee_id_effective_from_idx" ON "salary_decision"("employee_id", "effective_from");

-- component_id NULL is the agreed (contract) salary; other rows are salary components. No FK to the component
-- catalogue: its own TRUNCATE guard must stay the first error raised; the service validates the component.
CREATE TABLE "employee_salary" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "employee_id" UUID NOT NULL REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "decision_id" UUID NOT NULL REFERENCES "salary_decision"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "component_id" UUID,
  "amount_cipher" TEXT NOT NULL,
  "salary_basis" "SalaryBasis" NOT NULL,
  "effective_from" DATE NOT NULL,
  "effective_to" DATE,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "employee_salary_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "employee_salary_range_check" CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from")
);
CREATE UNIQUE INDEX "employee_salary_component_effective_key" ON "employee_salary"("employee_id", COALESCE("component_id", '00000000-0000-0000-0000-000000000000'::uuid), "effective_from");
CREATE INDEX "employee_salary_employee_id_effective_from_idx" ON "employee_salary"("employee_id", "effective_from");
ALTER TABLE "employee_salary" ADD CONSTRAINT "employee_salary_no_overlap" EXCLUDE USING gist ("employee_id" WITH =, COALESCE("component_id", '00000000-0000-0000-0000-000000000000'::uuid) WITH =, daterange("effective_from", COALESCE("effective_to", 'infinity'::date), '[]') WITH &&);

CREATE FUNCTION salary_decision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Salary decisions are immutable'; END $$;
CREATE TRIGGER salary_decision_guard BEFORE UPDATE OR DELETE ON "salary_decision" FOR EACH ROW EXECUTE FUNCTION salary_decision_guard();
CREATE TRIGGER salary_decision_no_truncate BEFORE TRUNCATE ON "salary_decision" FOR EACH STATEMENT EXECUTE FUNCTION salary_decision_guard();

CREATE FUNCTION employee_salary_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'UPDATE' OR (to_jsonb(NEW) - 'effective_to') IS DISTINCT FROM (to_jsonb(OLD) - 'effective_to') OR OLD.effective_to IS NOT NULL OR NEW.effective_to IS NULL
  THEN RAISE EXCEPTION 'Employee salary history is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER employee_salary_guard BEFORE UPDATE OR DELETE ON "employee_salary" FOR EACH ROW EXECUTE FUNCTION employee_salary_guard();
CREATE TRIGGER employee_salary_no_truncate BEFORE TRUNCATE ON "employee_salary" FOR EACH STATEMENT EXECUTE FUNCTION employee_salary_guard();

CREATE TABLE "retro_candidate" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "decision_id" UUID NOT NULL REFERENCES "salary_decision"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "employee_id" UUID NOT NULL REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "payroll_period_id" UUID NOT NULL REFERENCES "payroll_period"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "status" "RetroCandidateStatus" NOT NULL DEFAULT 'PENDING',
  "note" VARCHAR(2000),
  "resolved_by_id" UUID REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "resolved_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "retro_candidate_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "retro_candidate_decision_id_payroll_period_id_key" UNIQUE ("decision_id", "payroll_period_id"),
  CONSTRAINT "retro_candidate_resolution_check" CHECK (("status" = 'PENDING') = ("resolved_at" IS NULL))
);
CREATE INDEX "retro_candidate_status_idx" ON "retro_candidate"("status", "payroll_period_id");
CREATE FUNCTION retro_candidate_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'UPDATE' OR OLD.status <> 'PENDING' OR NEW.status = 'PENDING'
     OR (to_jsonb(NEW) - 'status' - 'note' - 'resolved_by_id' - 'resolved_at') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'note' - 'resolved_by_id' - 'resolved_at')
  THEN RAISE EXCEPTION 'Retro candidates only move once from PENDING and are otherwise immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER retro_candidate_guard BEFORE UPDATE OR DELETE ON "retro_candidate" FOR EACH ROW EXECUTE FUNCTION retro_candidate_guard();
CREATE TRIGGER retro_candidate_no_truncate BEFORE TRUNCATE ON "retro_candidate" FOR EACH STATEMENT EXECUTE FUNCTION retro_candidate_guard();
