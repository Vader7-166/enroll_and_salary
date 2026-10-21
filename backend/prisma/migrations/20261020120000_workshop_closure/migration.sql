CREATE TYPE "AttendanceWorkshopClosureAction" AS ENUM ('CLOSE', 'RETURN');

CREATE TABLE attendance_workshop_closure (
  id UUID PRIMARY KEY,
  period_id UUID NOT NULL REFERENCES business_period(id),
  workshop_org_unit_id UUID NOT NULL REFERENCES org_unit(id),
  revision INTEGER NOT NULL CHECK (revision > 0),
  action "AttendanceWorkshopClosureAction" NOT NULL,
  source_hash CHAR(64) NOT NULL CHECK (source_hash ~ '^[a-f0-9]{64}$'),
  note VARCHAR(2000) NOT NULL,
  snapshot JSONB NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  actor_id UUID NOT NULL REFERENCES user_account(id),
  occurred_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (period_id, workshop_org_unit_id, revision)
);
CREATE INDEX attendance_workshop_closure_period_workshop_revision_idx ON attendance_workshop_closure(period_id, workshop_org_unit_id, revision DESC);

CREATE FUNCTION guard_attendance_workshop_closure() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous_revision INTEGER; period_status "BusinessPeriodStatus"; workshop_type "OrgUnitType";
BEGIN
  PERFORM pg_advisory_xact_lock(8210472);
  SELECT status INTO period_status FROM business_period WHERE id = NEW.period_id AND period_type = 'ATTENDANCE';
  IF period_status IS NULL OR period_status <> 'OPEN' THEN RAISE EXCEPTION 'PERIOD_STATE_CONFLICT' USING ERRCODE = '23514'; END IF;
  SELECT unit_type INTO workshop_type FROM org_unit_version WHERE org_unit_id = NEW.workshop_org_unit_id AND effective_from <= (SELECT date_to FROM business_period WHERE id = NEW.period_id) AND (effective_to IS NULL OR effective_to >= (SELECT date_from FROM business_period WHERE id = NEW.period_id)) ORDER BY effective_from DESC LIMIT 1;
  IF workshop_type IS DISTINCT FROM 'DEPARTMENT' THEN RAISE EXCEPTION 'WORKSHOP_SCOPE_CONFLICT' USING ERRCODE = '23514'; END IF;
  SELECT COALESCE(MAX(revision), 0) INTO previous_revision FROM attendance_workshop_closure WHERE period_id = NEW.period_id AND workshop_org_unit_id = NEW.workshop_org_unit_id;
  IF NEW.revision <> previous_revision + 1 THEN RAISE EXCEPTION 'WORKSHOP_CLOSURE_REVISION_CONFLICT' USING ERRCODE = '23514'; END IF;
  IF NEW.action = 'RETURN' AND NOT EXISTS (SELECT 1 FROM attendance_workshop_closure WHERE period_id = NEW.period_id AND workshop_org_unit_id = NEW.workshop_org_unit_id AND revision = previous_revision AND action = 'CLOSE') THEN RAISE EXCEPTION 'WORKSHOP_RETURN_CONFLICT' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER attendance_workshop_closure_insert BEFORE INSERT ON attendance_workshop_closure FOR EACH ROW EXECUTE FUNCTION guard_attendance_workshop_closure();
CREATE TRIGGER attendance_workshop_closure_no_update_delete BEFORE UPDATE OR DELETE ON attendance_workshop_closure FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
CREATE TRIGGER attendance_workshop_closure_no_truncate BEFORE TRUNCATE ON attendance_workshop_closure FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_mutation();
REVOKE UPDATE, DELETE, TRUNCATE ON attendance_workshop_closure FROM PUBLIC;

-- A QD close freezes every normal source writer for that workshop while the attendance period remains OPEN.
-- Raw-punch import intentionally has no trigger: it is immutable evidence and its changed source hash makes the close STALE.
CREATE FUNCTION assert_workshop_source_open(p_team UUID, p_day DATE) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(8210472);
  IF EXISTS (
    WITH RECURSIVE hierarchy AS (
      SELECT org_unit_id, parent_id FROM org_unit_version WHERE org_unit_id = p_team AND effective_from <= p_day AND (effective_to IS NULL OR effective_to >= p_day)
      UNION ALL
      SELECT parent.org_unit_id, parent.parent_id FROM org_unit_version parent JOIN hierarchy child ON child.parent_id = parent.org_unit_id WHERE parent.effective_from <= p_day AND (parent.effective_to IS NULL OR parent.effective_to >= p_day)
    ), latest AS (
      SELECT DISTINCT ON (period_id, workshop_org_unit_id) period_id, workshop_org_unit_id, action FROM attendance_workshop_closure ORDER BY period_id, workshop_org_unit_id, revision DESC
    )
    SELECT 1 FROM latest close_row JOIN business_period period ON period.id = close_row.period_id JOIN hierarchy ON hierarchy.org_unit_id = close_row.workshop_org_unit_id
    WHERE close_row.action = 'CLOSE' AND period.status = 'OPEN' AND p_day BETWEEN period.date_from AND period.date_to
  ) THEN RAISE EXCEPTION 'WORKSHOP_CLOSED_RETURN_REQUIRED' USING ERRCODE = '23514'; END IF;
END $$;
CREATE FUNCTION guard_shift_schedule_workshop() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE unit_id UUID;
BEGIN
  IF TG_OP <> 'DELETE' THEN SELECT team_org_unit_id INTO unit_id FROM shift_plan WHERE id = NEW.plan_id; PERFORM assert_workshop_source_open(unit_id, NEW.work_date); END IF;
  IF TG_OP <> 'INSERT' THEN SELECT team_org_unit_id INTO unit_id FROM shift_plan WHERE id = OLD.plan_id; PERFORM assert_workshop_source_open(unit_id, OLD.work_date); END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE FUNCTION guard_daily_attendance_workshop() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF TG_OP <> 'DELETE' THEN PERFORM assert_workshop_source_open(NEW.org_unit_id, NEW.work_date); END IF; IF TG_OP <> 'INSERT' THEN PERFORM assert_workshop_source_open(OLD.org_unit_id, OLD.work_date); END IF; IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW; END $$;
CREATE FUNCTION guard_overtime_actual_workshop() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF TG_OP <> 'DELETE' THEN PERFORM assert_workshop_source_open(NEW.org_unit_id, NEW.work_date); END IF; IF TG_OP <> 'INSERT' THEN PERFORM assert_workshop_source_open(OLD.org_unit_id, OLD.work_date); END IF; IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW; END $$;
CREATE FUNCTION guard_overtime_request_workshop() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF TG_OP <> 'DELETE' THEN PERFORM assert_workshop_source_open(NEW.team_org_unit_id, NEW.work_date); END IF; IF TG_OP <> 'INSERT' THEN PERFORM assert_workshop_source_open(OLD.team_org_unit_id, OLD.work_date); END IF; IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW; END $$;
CREATE FUNCTION guard_correction_item_workshop() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF TG_OP <> 'DELETE' THEN PERFORM assert_workshop_source_open(NEW.org_unit_id, NEW.work_date); END IF; IF TG_OP <> 'INSERT' THEN PERFORM assert_workshop_source_open(OLD.org_unit_id, OLD.work_date); END IF; IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW; END $$;

CREATE FUNCTION guard_shift_plan_workshop() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE row_record RECORD;
BEGIN
  FOR row_record IN SELECT work_date FROM shift_schedule WHERE plan_id = COALESCE(NEW.id, OLD.id) LOOP
    IF TG_OP <> 'DELETE' THEN PERFORM assert_workshop_source_open(NEW.team_org_unit_id, row_record.work_date); END IF;
    IF TG_OP <> 'INSERT' THEN PERFORM assert_workshop_source_open(OLD.team_org_unit_id, row_record.work_date); END IF;
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE FUNCTION guard_shift_definition_workshop() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE row_record RECORD;
BEGIN
  FOR row_record IN SELECT plan.team_org_unit_id, schedule.work_date FROM shift_schedule schedule JOIN shift_plan plan ON plan.id = schedule.plan_id WHERE schedule.shift_id = COALESCE(NEW.id, OLD.id) LOOP
    PERFORM assert_workshop_source_open(row_record.team_org_unit_id, row_record.work_date);
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE FUNCTION guard_attendance_correction_workshop() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE row_record RECORD;
BEGIN
  FOR row_record IN SELECT org_unit_id, work_date FROM attendance_correction_item WHERE correction_id = COALESCE(NEW.id, OLD.id) LOOP
    PERFORM assert_workshop_source_open(row_record.org_unit_id, row_record.work_date);
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE FUNCTION guard_leave_request_workshop() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE line JSONB;
BEGIN
  FOR line IN SELECT value FROM jsonb_array_elements(COALESCE(NEW.snapshot->'lines', '[]'::jsonb) || COALESCE(OLD.snapshot->'lines', '[]'::jsonb)) LOOP
    PERFORM assert_workshop_source_open((line->>'orgUnitId')::uuid, (line->>'workDate')::date);
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE FUNCTION assert_assignment_workshop_open(unit_id UUID, start_day DATE, end_day DATE) RETURNS void LANGUAGE plpgsql AS $$
DECLARE row_record RECORD;
BEGIN
  FOR row_record IN SELECT period.date_from, period.date_to FROM business_period period JOIN attendance_workshop_closure closure ON closure.period_id = period.id WHERE period.period_type = 'ATTENDANCE' AND period.status = 'OPEN' AND NOT EXISTS (SELECT 1 FROM attendance_workshop_closure newer WHERE newer.period_id = closure.period_id AND newer.workshop_org_unit_id = closure.workshop_org_unit_id AND newer.revision > closure.revision) AND closure.action = 'CLOSE' AND period.date_from <= COALESCE(end_day, 'infinity'::date) AND period.date_to >= start_day LOOP
    PERFORM assert_workshop_source_open(unit_id, GREATEST(start_day, row_record.date_from));
  END LOOP;
END $$;
CREATE FUNCTION guard_assignment_workshop() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'DELETE' THEN PERFORM assert_assignment_workshop_open(NEW.org_unit_id, NEW.effective_from, NEW.effective_to); END IF;
  IF TG_OP <> 'INSERT' THEN PERFORM assert_assignment_workshop_open(OLD.org_unit_id, OLD.effective_from, OLD.effective_to); END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;

CREATE FUNCTION guard_transfer_workshop() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE row_record RECORD;
BEGIN
  IF TG_OP <> 'DELETE' THEN FOR row_record IN SELECT period.date_from FROM business_period period JOIN attendance_workshop_closure closure ON closure.period_id = period.id WHERE period.period_type = 'ATTENDANCE' AND period.status = 'OPEN' AND NOT EXISTS (SELECT 1 FROM attendance_workshop_closure newer WHERE newer.period_id = closure.period_id AND newer.workshop_org_unit_id = closure.workshop_org_unit_id AND newer.revision > closure.revision) AND closure.action = 'CLOSE' AND period.date_to >= NEW.effective_from LOOP PERFORM assert_workshop_source_open(NEW.from_org_unit_id, GREATEST(NEW.effective_from, row_record.date_from)); PERFORM assert_workshop_source_open(NEW.to_org_unit_id, GREATEST(NEW.effective_from, row_record.date_from)); END LOOP; END IF;
  IF TG_OP <> 'INSERT' THEN FOR row_record IN SELECT period.date_from FROM business_period period JOIN attendance_workshop_closure closure ON closure.period_id = period.id WHERE period.period_type = 'ATTENDANCE' AND period.status = 'OPEN' AND NOT EXISTS (SELECT 1 FROM attendance_workshop_closure newer WHERE newer.period_id = closure.period_id AND newer.workshop_org_unit_id = closure.workshop_org_unit_id AND newer.revision > closure.revision) AND closure.action = 'CLOSE' AND period.date_to >= OLD.effective_from LOOP PERFORM assert_workshop_source_open(OLD.from_org_unit_id, GREATEST(OLD.effective_from, row_record.date_from)); PERFORM assert_workshop_source_open(OLD.to_org_unit_id, GREATEST(OLD.effective_from, row_record.date_from)); END LOOP; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER shift_schedule_workshop_guard BEFORE INSERT OR UPDATE OR DELETE ON shift_schedule FOR EACH ROW EXECUTE FUNCTION guard_shift_schedule_workshop();
CREATE TRIGGER shift_plan_workshop_guard BEFORE UPDATE OR DELETE ON shift_plan FOR EACH ROW EXECUTE FUNCTION guard_shift_plan_workshop();
CREATE TRIGGER shift_definition_workshop_guard BEFORE UPDATE OR DELETE ON shift_definition FOR EACH ROW EXECUTE FUNCTION guard_shift_definition_workshop();
CREATE TRIGGER attendance_correction_workshop_guard BEFORE UPDATE OR DELETE ON attendance_correction FOR EACH ROW EXECUTE FUNCTION guard_attendance_correction_workshop();
CREATE TRIGGER leave_request_workshop_guard BEFORE INSERT OR UPDATE OR DELETE ON leave_request FOR EACH ROW EXECUTE FUNCTION guard_leave_request_workshop();
CREATE TRIGGER org_assignment_workshop_guard BEFORE INSERT OR UPDATE OR DELETE ON org_assignment FOR EACH ROW EXECUTE FUNCTION guard_assignment_workshop();
CREATE TRIGGER personnel_transfer_workshop_guard BEFORE INSERT OR UPDATE OR DELETE ON personnel_transfer FOR EACH ROW EXECUTE FUNCTION guard_transfer_workshop();
CREATE TRIGGER daily_attendance_workshop_guard BEFORE INSERT OR UPDATE OR DELETE ON daily_attendance FOR EACH ROW EXECUTE FUNCTION guard_daily_attendance_workshop();
CREATE TRIGGER overtime_actual_workshop_guard BEFORE INSERT OR UPDATE OR DELETE ON overtime_actual FOR EACH ROW EXECUTE FUNCTION guard_overtime_actual_workshop();
CREATE TRIGGER overtime_request_workshop_guard BEFORE INSERT OR UPDATE OR DELETE ON overtime_request FOR EACH ROW EXECUTE FUNCTION guard_overtime_request_workshop();
CREATE TRIGGER correction_item_workshop_guard BEFORE INSERT OR UPDATE OR DELETE ON attendance_correction_item FOR EACH ROW EXECUTE FUNCTION guard_correction_item_workshop();


CREATE FUNCTION guard_team_workshop_record() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE period_row RECORD; day DATE;
BEGIN
  SELECT date_from, date_to INTO period_row FROM business_period WHERE id = NEW.period_id;
  FOR day IN SELECT generate_series(period_row.date_from, period_row.date_to, '1 day'::interval)::date LOOP
    PERFORM assert_workshop_source_open(NEW.team_org_unit_id, day);
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER source_coverage_workshop_guard BEFORE INSERT ON attendance_source_coverage FOR EACH ROW EXECUTE FUNCTION guard_team_workshop_record();
CREATE TRIGGER team_confirmation_workshop_guard BEFORE INSERT ON attendance_team_confirmation FOR EACH ROW EXECUTE FUNCTION guard_team_workshop_record();

CREATE FUNCTION guard_linked_workshop_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item RECORD; source JSONB;
BEGIN
  FOR source IN SELECT value FROM jsonb_array_elements(jsonb_build_array(to_jsonb(OLD), to_jsonb(NEW))) WHERE value <> 'null'::jsonb LOOP
    IF TG_TABLE_NAME = 'overtime_member' THEN
      FOR item IN SELECT team_org_unit_id AS unit_id, work_date FROM overtime_request WHERE id = (source->>'request_id')::uuid LOOP
        PERFORM assert_workshop_source_open(item.unit_id, item.work_date);
      END LOOP;
    ELSE
      FOR item IN SELECT org_unit_id AS unit_id, work_date FROM attendance_correction_item WHERE correction_id = (source->>'correction_id')::uuid LOOP
        PERFORM assert_workshop_source_open(item.unit_id, item.work_date);
      END LOOP;
    END IF;
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER overtime_member_workshop_guard BEFORE INSERT OR UPDATE OR DELETE ON overtime_member FOR EACH ROW EXECUTE FUNCTION guard_linked_workshop_source();
CREATE TRIGGER correction_evidence_workshop_guard BEFORE INSERT OR UPDATE OR DELETE ON attendance_correction_evidence FOR EACH ROW EXECUTE FUNCTION guard_linked_workshop_source();

CREATE FUNCTION assert_workshop_parameter_open(scope TEXT, starts DATE, ends DATE) RETURNS void LANGUAGE plpgsql AS $$
DECLARE item RECORD;
BEGIN
  PERFORM pg_advisory_xact_lock(8210472);
  FOR item IN
    WITH latest AS (SELECT DISTINCT ON (period_id, workshop_org_unit_id) period_id, workshop_org_unit_id, action FROM attendance_workshop_closure ORDER BY period_id, workshop_org_unit_id, revision DESC)
    SELECT latest.workshop_org_unit_id, GREATEST(starts, period.date_from) AS day
    FROM latest JOIN business_period period ON period.id = latest.period_id
    JOIN org_unit_version unit ON unit.org_unit_id = latest.workshop_org_unit_id AND unit.effective_from <= period.date_to AND (unit.effective_to IS NULL OR unit.effective_to >= period.date_from)
    LEFT JOIN site ON site.id = unit.site_id
    WHERE latest.action = 'CLOSE' AND period.status = 'OPEN' AND period.date_to >= starts AND period.date_from <= COALESCE(ends, 'infinity'::date)
      AND (scope = 'GLOBAL' OR scope = 'SITE:' || site.id::text OR scope = 'REGION:' || site.wage_region_code)
  LOOP
    PERFORM assert_workshop_source_open(item.workshop_org_unit_id, item.day);
  END LOOP;
END $$;
CREATE FUNCTION guard_shared_workshop_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source JSONB; assignment RECORD; changed_from DATE; changed_to DATE;
BEGIN
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME IN ('legal_parameter','site_policy','org_unit_version') AND (to_jsonb(NEW)-'effective_to') = (to_jsonb(OLD)-'effective_to') THEN
    changed_from := LEAST(COALESCE(NEW.effective_to,'infinity'::date),COALESCE(OLD.effective_to,'infinity'::date))+1;
    changed_to := GREATEST(COALESCE(NEW.effective_to,'infinity'::date),COALESCE(OLD.effective_to,'infinity'::date));
    IF TG_TABLE_NAME = 'legal_parameter' THEN
      PERFORM assert_workshop_parameter_open(to_jsonb(NEW)->>'scope_key',changed_from,changed_to);
    ELSE
      PERFORM assert_assignment_workshop_open((to_jsonb(NEW)->>'org_unit_id')::uuid,changed_from,changed_to);
    END IF;
    RETURN NEW;
  END IF;
  FOR source IN SELECT value FROM jsonb_array_elements(jsonb_build_array(to_jsonb(OLD), to_jsonb(NEW))) WHERE value <> 'null'::jsonb LOOP
    IF TG_TABLE_NAME = 'legal_parameter' THEN
      IF source->>'param_code' LIKE 'ATTENDANCE_%' OR source->>'param_code' LIKE 'SHIFT_%' OR source->>'param_code' LIKE 'OT_%' OR source->>'param_code' = 'HOLIDAY_CALENDAR' THEN
        PERFORM assert_workshop_parameter_open(source->>'scope_key', (source->>'effective_from')::date, (source->>'effective_to')::date);
      END IF;
    ELSIF TG_TABLE_NAME = 'employee' OR TG_TABLE_NAME = 'employment_contract' THEN
      FOR assignment IN SELECT org_unit_id, effective_from, effective_to FROM org_assignment WHERE employee_id = (CASE WHEN TG_TABLE_NAME = 'employee' THEN source->>'id' ELSE source->>'employee_id' END)::uuid AND is_primary LOOP
        PERFORM assert_assignment_workshop_open(assignment.org_unit_id, assignment.effective_from, assignment.effective_to);
      END LOOP;
    ELSE
      PERFORM assert_assignment_workshop_open((source->>'org_unit_id')::uuid, (source->>'effective_from')::date, (source->>'effective_to')::date);
      IF TG_TABLE_NAME = 'org_unit_version' AND source->>'unit_type' IN ('COMPANY', 'SITE', 'BLOCK') THEN
        IF source->>'unit_type' = 'COMPANY' THEN
          PERFORM assert_workshop_parameter_open('GLOBAL', (source->>'effective_from')::date, (source->>'effective_to')::date);
        ELSE
          PERFORM assert_workshop_parameter_open('SITE:' || (source->>'site_id'), (source->>'effective_from')::date, (source->>'effective_to')::date);
        END IF;
      END IF;
    END IF;
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER legal_parameter_workshop_guard BEFORE INSERT OR UPDATE OR DELETE ON legal_parameter FOR EACH ROW EXECUTE FUNCTION guard_shared_workshop_source();
CREATE TRIGGER employee_workshop_guard BEFORE UPDATE OF code, full_name, status, hire_date, termination_date OR DELETE ON employee FOR EACH ROW EXECUTE FUNCTION guard_shared_workshop_source();
CREATE TRIGGER contract_workshop_guard BEFORE INSERT OR UPDATE OF employee_id, status, start_date, end_date OR DELETE ON employment_contract FOR EACH ROW EXECUTE FUNCTION guard_shared_workshop_source();
CREATE TRIGGER org_version_workshop_guard BEFORE INSERT OR UPDATE OR DELETE ON org_unit_version FOR EACH ROW EXECUTE FUNCTION guard_shared_workshop_source();
CREATE TRIGGER site_policy_workshop_guard BEFORE INSERT OR UPDATE OR DELETE ON site_policy FOR EACH ROW EXECUTE FUNCTION guard_shared_workshop_source();

