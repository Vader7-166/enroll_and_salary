CREATE OR REPLACE FUNCTION "protect_locked_attendance_period"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."status" = 'LOCKED' AND (TG_OP = 'DELETE' OR NEW IS DISTINCT FROM OLD) THEN
    RAISE EXCEPTION 'LOCKED attendance period is immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER "business_period_locked_immutable" ON "business_period";
CREATE TRIGGER "business_period_locked_immutable"
BEFORE UPDATE OR DELETE ON "business_period"
FOR EACH ROW EXECUTE FUNCTION "protect_locked_attendance_period"();

CREATE OR REPLACE FUNCTION "guard_employee_attendance_period"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  source_row RECORD;
BEGIN
  FOR source_row IN
    SELECT plan."team_org_unit_id", schedule."work_date"
    FROM "shift_schedule" schedule
    INNER JOIN "shift_plan" plan ON plan."id" = schedule."plan_id"
    WHERE schedule."employee_id" = OLD."id"
      AND (
        (schedule."work_date" >= OLD."hire_date" AND (OLD."termination_date" IS NULL OR schedule."work_date" <= OLD."termination_date"))
          IS DISTINCT FROM
        (schedule."work_date" >= NEW."hire_date" AND (NEW."termination_date" IS NULL OR schedule."work_date" <= NEW."termination_date"))
        OR (OLD."status" IS DISTINCT FROM NEW."status" AND OLD."termination_date" IS NULL AND NEW."termination_date" IS NULL)
      )
  LOOP
    PERFORM "assert_attendance_source_writable"(source_row."team_org_unit_id", source_row."work_date");
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "guard_legal_parameter_attendance_period"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD."param_code" IN ('SHIFT_MAX_DAILY_MINUTES', 'OT_DAILY_MAX_RATIO', 'OT_MONTH_MAX_MINUTES', 'OT_YEAR_MAX_MINUTES') AND OLD."subject_type" = 'ALL' AND OLD."application_basis" = 'WORK_DATE' THEN
    PERFORM "assert_legal_parameter_writable"(OLD."scope_key", OLD."effective_from", OLD."effective_to");
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW."param_code" IN ('SHIFT_MAX_DAILY_MINUTES', 'OT_DAILY_MAX_RATIO', 'OT_MONTH_MAX_MINUTES', 'OT_YEAR_MAX_MINUTES') AND NEW."subject_type" = 'ALL' AND NEW."application_basis" = 'WORK_DATE' THEN
    PERFORM "assert_legal_parameter_writable"(NEW."scope_key", NEW."effective_from", NEW."effective_to");
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
