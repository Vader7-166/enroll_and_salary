CREATE TABLE overtime_actual (
 id UUID PRIMARY KEY, employee_id UUID NOT NULL REFERENCES employee(id), org_unit_id UUID NOT NULL REFERENCES org_unit(id),
 period_id UUID NOT NULL REFERENCES business_period(id), work_date DATE NOT NULL, source_dates DATE[] NOT NULL,
 requested_minutes NUMERIC(12,6) NOT NULL, approved_minutes NUMERIC(12,6) NOT NULL,
 actual_minutes NUMERIC(12,6) NOT NULL, eligible_minutes NUMERIC(12,6) NOT NULL,
 day_minutes NUMERIC(12,6) NOT NULL, night_minutes NUMERIC(12,6) NOT NULL,
 unapproved_minutes NUMERIC(12,6) NOT NULL, unworked_approved_minutes NUMERIC(12,6) NOT NULL,
 flags TEXT[] NOT NULL, evidence JSONB NOT NULL, processed_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT overtime_actual_minutes CHECK (requested_minutes>=0 AND approved_minutes>=0 AND actual_minutes>=0 AND eligible_minutes>=0
  AND day_minutes>=0 AND night_minutes>=0 AND unapproved_minutes>=0 AND unworked_approved_minutes>=0
  AND eligible_minutes<=approved_minutes AND eligible_minutes<=actual_minutes
  AND abs(eligible_minutes-day_minutes-night_minutes)<=0.000001
  AND abs(actual_minutes-eligible_minutes-unapproved_minutes)<=0.000001
  AND abs(approved_minutes-eligible_minutes-unworked_approved_minutes)<=0.000001)
);
CREATE UNIQUE INDEX overtime_actual_employee_id_org_unit_id_work_date_key ON overtime_actual(employee_id,org_unit_id,work_date);
CREATE INDEX overtime_actual_period_id_org_unit_id_work_date_idx ON overtime_actual(period_id,org_unit_id,work_date);

-- Protect both the target period and dated ancestor periods, including the calendar
-- dates of a cross-midnight pair. Import may retain late raw logs, never rewrite this result.
CREATE FUNCTION guard_overtime_actual_period() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item RECORD; source_day DATE; state TEXT;
BEGIN
 PERFORM pg_advisory_xact_lock(8210472);
 FOR item IN SELECT * FROM jsonb_to_recordset(
   CASE WHEN TG_OP='INSERT' THEN jsonb_build_array(to_jsonb(NEW))
        WHEN TG_OP='DELETE' THEN jsonb_build_array(to_jsonb(OLD))
        ELSE jsonb_build_array(to_jsonb(OLD),to_jsonb(NEW)) END
 ) AS x(period_id UUID, org_unit_id UUID, work_date DATE, source_dates DATE[])
 LOOP
  SELECT status::text INTO state FROM business_period WHERE id=item.period_id FOR SHARE;
  IF state IS DISTINCT FROM 'OPEN' THEN RAISE EXCEPTION 'PERIOD_STATE_CONFLICT' USING ERRCODE='23514'; END IF;
  FOREACH source_day IN ARRAY array_append(item.source_dates,item.work_date) LOOP
   IF EXISTS (
    WITH RECURSIVE ancestors(id) AS (
     SELECT item.org_unit_id
     UNION
     SELECT v.parent_id FROM org_unit_version v JOIN ancestors a ON v.org_unit_id=a.id
      WHERE v.effective_from<=source_day AND (v.effective_to IS NULL OR v.effective_to>=source_day) AND v.parent_id IS NOT NULL
    )
    SELECT 1 FROM business_period p JOIN ancestors a ON a.id=p.scope_org_unit_id
     WHERE p.period_type='ATTENDANCE' AND p.status IN ('CLOSED','LOCKED') AND source_day BETWEEN p.date_from AND p.date_to
   ) THEN RAISE EXCEPTION 'PERIOD_STATE_CONFLICT' USING ERRCODE='23514'; END IF;
  END LOOP;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER overtime_actual_period_guard BEFORE INSERT OR UPDATE OR DELETE ON overtime_actual FOR EACH ROW EXECUTE FUNCTION guard_overtime_actual_period();
CREATE TRIGGER overtime_actual_no_truncate BEFORE TRUNCATE ON overtime_actual FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_mutation();
