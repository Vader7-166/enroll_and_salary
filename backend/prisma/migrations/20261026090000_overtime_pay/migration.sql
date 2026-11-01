CREATE TYPE "OvertimePayBucketKind" AS ENUM ('OT', 'NIGHT_REGULAR');
CREATE TYPE "OvertimeDayType" AS ENUM ('THUONG', 'NGHI_TUAN', 'LE_TET');
CREATE TYPE "OvertimePaySourceStatus" AS ENUM ('DRAFT', 'LOCKED');

-- Official buckets are materialized once from the immutable attendance lock snapshot; draft views are computed live.
CREATE TABLE "overtime_pay_bucket" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "period_id" UUID NOT NULL REFERENCES "business_period"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  -- No FK: the lock ledger must keep raising its own immutability error on TRUNCATE; the guard below checks the event.
  "lock_event_id" UUID,
  "employee_id" UUID NOT NULL REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "org_unit_id" UUID NOT NULL REFERENCES "org_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "work_date" DATE NOT NULL,
  "kind" "OvertimePayBucketKind" NOT NULL,
  "day_type" "OvertimeDayType" NOT NULL,
  "is_night" BOOLEAN NOT NULL,
  "has_day_ot" BOOLEAN NOT NULL,
  "minutes" DECIMAL(12,6) NOT NULL CHECK ("minutes" > 0),
  "rate" DECIMAL(10,6) NOT NULL CHECK ("rate" > 0),
  "rate_breakdown" JSONB NOT NULL,
  "source_status" "OvertimePaySourceStatus" NOT NULL,
  "source_hash" CHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "overtime_pay_bucket_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "overtime_pay_bucket_key" UNIQUE ("period_id", "employee_id", "org_unit_id", "work_date", "kind", "day_type", "is_night", "has_day_ot"),
  CONSTRAINT "overtime_pay_bucket_locked_source" CHECK ("source_status" = 'DRAFT' OR "lock_event_id" IS NOT NULL),
  CONSTRAINT "overtime_pay_bucket_night_regular" CHECK ("kind" = 'OT' OR ("is_night" AND NOT "has_day_ot"))
);
CREATE INDEX "overtime_pay_bucket_period_id_org_unit_id_work_date_idx" ON "overtime_pay_bucket"("period_id", "org_unit_id", "work_date");
CREATE INDEX "overtime_pay_bucket_employee_id_work_date_idx" ON "overtime_pay_bucket"("employee_id", "work_date");

CREATE FUNCTION overtime_pay_bucket_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Overtime pay buckets are immutable'; END IF;
  IF NEW.source_status = 'LOCKED' AND NOT EXISTS (
    SELECT 1 FROM "attendance_period_lock_event" event JOIN "business_period" period ON period."id" = event."period_id"
    WHERE event."id" = NEW.lock_event_id AND event."period_id" = NEW.period_id AND event."action" = 'LOCK'
      AND event."source_hash" = NEW.source_hash AND period."status" = 'LOCKED'
  ) THEN RAISE EXCEPTION 'Locked overtime buckets require the period lock snapshot'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER overtime_pay_bucket_guard BEFORE INSERT OR UPDATE OR DELETE ON "overtime_pay_bucket" FOR EACH ROW EXECUTE FUNCTION overtime_pay_bucket_guard();
CREATE TRIGGER overtime_pay_bucket_no_truncate BEFORE TRUNCATE ON "overtime_pay_bucket" FOR EACH STATEMENT EXECUTE FUNCTION overtime_pay_bucket_guard();

-- Rates feed locked attendance; changing them for a locked site period is refused like the OT limits.
CREATE OR REPLACE FUNCTION "guard_legal_parameter_attendance_period"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE guarded TEXT[] := ARRAY['SHIFT_MAX_DAILY_MINUTES', 'OT_DAILY_MAX_RATIO', 'OT_MONTH_MAX_MINUTES', 'OT_YEAR_MAX_MINUTES',
  'OT_RATE_WEEKDAY', 'OT_RATE_WEEKLY_REST', 'OT_RATE_HOLIDAY', 'NIGHT_ALLOWANCE_RATE', 'NIGHT_OT_ADDON_RATE', 'WEEKLY_REST_DAYS'];
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD."param_code" = ANY(guarded) AND OLD."subject_type" = 'ALL' AND OLD."application_basis" = 'WORK_DATE' THEN
    PERFORM "assert_legal_parameter_writable"(OLD."scope_key", OLD."effective_from", OLD."effective_to");
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW."param_code" = ANY(guarded) AND NEW."subject_type" = 'ALL' AND NEW."application_basis" = 'WORK_DATE' THEN
    PERFORM "assert_legal_parameter_writable"(NEW."scope_key", NEW."effective_from", NEW."effective_to");
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Standard parameter set of 06 §5.3 (SIMULATION, DEC-03). Rates are ratios; 200/210/270/390 are derived, never stored.
INSERT INTO legal_parameter(id,param_code,scope_key,subject_type,application_basis,value,unit,effective_from,document_effective_date,legal_basis)
SELECT gen_random_uuid(),code,'GLOBAL','ALL','WORK_DATE',amount,unit,'2026-01-01','2026-01-01',basis FROM (VALUES
 ('OT_RATE_WEEKDAY','"1.5"'::jsonb,'ratio','BLLĐ 2019 Điều 98 khoản 1a; NĐ 145/2020 Điều 55; tài liệu 04 BR-23 — SIMULATION'),
 ('OT_RATE_WEEKLY_REST','"2.0"'::jsonb,'ratio','BLLĐ 2019 Điều 98 khoản 1b; NĐ 145/2020 Điều 55; tài liệu 04 BR-23 — SIMULATION'),
 ('OT_RATE_HOLIDAY','"3.0"'::jsonb,'ratio','BLLĐ 2019 Điều 98 khoản 1c, chưa gồm lương ngày lễ; tài liệu 04 BR-23 — SIMULATION'),
 ('NIGHT_ALLOWANCE_RATE','"0.3"'::jsonb,'ratio','BLLĐ 2019 Điều 98 khoản 2; tài liệu 04 BR-24 — SIMULATION'),
 ('NIGHT_OT_ADDON_RATE','"0.2"'::jsonb,'ratio','BLLĐ 2019 Điều 98 khoản 3; NĐ 145/2020 Điều 57; tài liệu 04 BR-25 — SIMULATION'),
 ('COMP_TIME_ENABLED','false'::jsonb,'boolean','DEC-01: chưa kích hoạt quy đổi OT sang nghỉ bù; tài liệu 18 — SIMULATION'),
 ('WEEKLY_REST_DAYS','{"days":[7],"status":"SIMULATION","reference":"Ngày nghỉ hằng tuần mô phỏng: Chủ nhật (ISO 7); cơ sở ghi đè bằng phạm vi SITE"}'::jsonb,'weekday-list','BLLĐ 2019 Điều 111: người sử dụng lao động xác định ngày nghỉ hằng tuần — SIMULATION')
) AS p(code,amount,unit,basis)
WHERE NOT EXISTS (SELECT 1 FROM legal_parameter existing WHERE existing.param_code = p.code AND existing.scope_key = 'GLOBAL' AND existing.subject_type = 'ALL' AND existing.application_basis = 'WORK_DATE');
