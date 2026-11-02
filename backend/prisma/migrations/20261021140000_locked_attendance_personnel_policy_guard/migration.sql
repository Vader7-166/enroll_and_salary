CREATE OR REPLACE FUNCTION "assert_attendance_source_writable"(source_team_id UUID, source_work_date DATE)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  period_row RECORD;
BEGIN
  FOR period_row IN
    SELECT "id", "status", "scope_org_unit_id"
    FROM "business_period"
    WHERE "period_type" = 'ATTENDANCE'
      AND "status" IN ('CLOSED', 'LOCKED')
      AND source_work_date BETWEEN "date_from" AND "date_to"
  LOOP
    IF EXISTS (
      WITH RECURSIVE "lineage" AS (
        SELECT "org_unit_id", "parent_id" FROM "org_unit_version"
        WHERE "org_unit_id" = source_team_id AND "effective_from" <= source_work_date AND ("effective_to" IS NULL OR "effective_to" >= source_work_date)
        UNION ALL
        SELECT parent."org_unit_id", parent."parent_id" FROM "org_unit_version" parent
        INNER JOIN "lineage" child ON child."parent_id" = parent."org_unit_id"
        WHERE parent."effective_from" <= source_work_date AND (parent."effective_to" IS NULL OR parent."effective_to" >= source_work_date)
      )
      SELECT 1 FROM "lineage" WHERE "org_unit_id" = period_row."scope_org_unit_id"
    ) THEN
      RAISE EXCEPTION '%', CASE WHEN period_row."status" = 'LOCKED' THEN 'PERIOD_LOCKED' ELSE 'PERIOD_CLOSED' END USING ERRCODE = '23514';
    END IF;
  END LOOP;

  IF EXISTS (
    WITH RECURSIVE "lineage" AS (
      SELECT "org_unit_id", "parent_id" FROM "org_unit_version"
      WHERE "org_unit_id" = source_team_id AND "effective_from" <= source_work_date AND ("effective_to" IS NULL OR "effective_to" >= source_work_date)
      UNION ALL
      SELECT parent."org_unit_id", parent."parent_id" FROM "org_unit_version" parent
      INNER JOIN "lineage" child ON child."parent_id" = parent."org_unit_id"
      WHERE parent."effective_from" <= source_work_date AND (parent."effective_to" IS NULL OR parent."effective_to" >= source_work_date)
    )
    SELECT 1
    FROM "attendance_workshop_closure" closure
    INNER JOIN "business_period" period ON period."id" = closure."period_id"
    WHERE period."period_type" = 'ATTENDANCE'
      AND source_work_date BETWEEN period."date_from" AND period."date_to"
      AND closure."workshop_org_unit_id" IN (SELECT "org_unit_id" FROM "lineage")
      AND closure."action" = 'CLOSE'
      AND NOT EXISTS (
        SELECT 1 FROM "attendance_workshop_closure" newer
        WHERE newer."period_id" = closure."period_id"
          AND newer."workshop_org_unit_id" = closure."workshop_org_unit_id"
          AND newer."revision" > closure."revision"
      )
  ) THEN
    RAISE EXCEPTION 'WORKSHOP_CLOSED_RETURN_REQUIRED' USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION "guard_employee_attendance_period"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  source_row RECORD;
BEGIN
  IF NEW."hire_date" IS NOT DISTINCT FROM OLD."hire_date"
    AND NEW."termination_date" IS NOT DISTINCT FROM OLD."termination_date"
    AND NEW."status" IS NOT DISTINCT FROM OLD."status" THEN
    RETURN NEW;
  END IF;
  FOR source_row IN
    SELECT plan."team_org_unit_id", schedule."work_date"
    FROM "shift_schedule" schedule
    INNER JOIN "shift_plan" plan ON plan."id" = schedule."plan_id"
    WHERE schedule."employee_id" = OLD."id"
  LOOP
    PERFORM "assert_attendance_source_writable"(source_row."team_org_unit_id", source_row."work_date");
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "employee_attendance_period_guard"
BEFORE UPDATE ON "employee"
FOR EACH ROW EXECUTE FUNCTION "guard_employee_attendance_period"();

CREATE OR REPLACE FUNCTION "assert_legal_parameter_writable"(parameter_scope TEXT, parameter_from DATE, parameter_to DATE)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "business_period" period
    WHERE period."period_type" = 'ATTENDANCE'
      AND period."status" = 'LOCKED'
      AND parameter_from <= period."date_to"
      AND (parameter_to IS NULL OR parameter_to >= period."date_from")
      AND parameter_scope = 'SITE:' || period."scope_org_unit_id"::text
  ) THEN
    RAISE EXCEPTION 'PERIOD_LOCKED' USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION "guard_legal_parameter_attendance_period"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM "assert_legal_parameter_writable"(OLD."scope_key", OLD."effective_from", OLD."effective_to");
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM "assert_legal_parameter_writable"(NEW."scope_key", NEW."effective_from", NEW."effective_to");
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER "legal_parameter_attendance_period_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "legal_parameter"
FOR EACH ROW EXECUTE FUNCTION "guard_legal_parameter_attendance_period"();
