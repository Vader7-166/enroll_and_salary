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
        SELECT "org_unit_id", "parent_id"
        FROM "org_unit_version"
        WHERE "org_unit_id" = source_team_id
          AND "effective_from" <= source_work_date
          AND ("effective_to" IS NULL OR "effective_to" >= source_work_date)
        UNION ALL
        SELECT parent."org_unit_id", parent."parent_id"
        FROM "org_unit_version" parent
        INNER JOIN "lineage" child ON child."parent_id" = parent."org_unit_id"
        WHERE parent."effective_from" <= source_work_date
          AND (parent."effective_to" IS NULL OR parent."effective_to" >= source_work_date)
      )
      SELECT 1 FROM "lineage" WHERE "org_unit_id" = period_row."scope_org_unit_id"
    ) THEN
      RAISE EXCEPTION '%', CASE WHEN period_row."status" = 'LOCKED' THEN 'PERIOD_LOCKED' ELSE 'PERIOD_CLOSED' END USING ERRCODE = '23514';
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION "guard_shift_schedule_attendance_period"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  team_id UUID;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT "team_org_unit_id" INTO team_id FROM "shift_plan" WHERE "id" = OLD."plan_id";
    PERFORM "assert_attendance_source_writable"(team_id, OLD."work_date");
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT "team_org_unit_id" INTO team_id FROM "shift_plan" WHERE "id" = NEW."plan_id";
    PERFORM "assert_attendance_source_writable"(team_id, NEW."work_date");
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER "shift_schedule_attendance_period_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "shift_schedule"
FOR EACH ROW EXECUTE FUNCTION "guard_shift_schedule_attendance_period"();
