CREATE TABLE attendance_source_coverage (
 id UUID PRIMARY KEY, period_id UUID NOT NULL REFERENCES business_period(id), team_org_unit_id UUID NOT NULL REFERENCES org_unit(id),
 revision INTEGER NOT NULL CHECK(revision>0), source_hash CHAR(64) NOT NULL CHECK(source_hash ~ '^[a-f0-9]{64}$'),
 covered_from TIMESTAMPTZ(3) NOT NULL, covered_until TIMESTAMPTZ(3) NOT NULL,
 reference VARCHAR(500) NOT NULL CHECK(length(trim(reference))>0), reason VARCHAR(2000) NOT NULL CHECK(length(trim(reason))>0),
 batch_ids UUID[] NOT NULL, snapshot JSONB NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
 actor_id UUID NOT NULL REFERENCES user_account(id), created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(period_id,team_org_unit_id,revision), CHECK(covered_until>=covered_from)
);
CREATE TABLE attendance_team_confirmation (
 id UUID PRIMARY KEY, period_id UUID NOT NULL REFERENCES business_period(id), team_org_unit_id UUID NOT NULL REFERENCES org_unit(id),
 revision INTEGER NOT NULL CHECK(revision>0), source_hash CHAR(64) NOT NULL CHECK(source_hash ~ '^[a-f0-9]{64}$'),
 snapshot JSONB NOT NULL CHECK(jsonb_typeof(snapshot)='object'), note VARCHAR(2000) NOT NULL,
 actor_id UUID NOT NULL REFERENCES user_account(id), confirmed_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(period_id,team_org_unit_id,revision)
);
CREATE FUNCTION guard_attendance_attestation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE first_day DATE; last_day DATE; dates DATE[]; prior INTEGER;
BEGIN
 PERFORM pg_advisory_xact_lock(8210472);
 SELECT date_from,date_to INTO first_day,last_day FROM business_period WHERE id=NEW.period_id AND period_type='ATTENDANCE';
 IF first_day IS NULL THEN RAISE EXCEPTION 'PERIOD_STATE_CONFLICT' USING ERRCODE='23514'; END IF;
 SELECT array_agg(d::date) INTO dates FROM generate_series(first_day,last_day,interval '1 day') d;
 PERFORM assert_correction_period_open(NEW.period_id,NEW.team_org_unit_id,dates);
 EXECUTE format('SELECT COALESCE(MAX(revision),0) FROM %I WHERE period_id=$1 AND team_org_unit_id=$2',TG_TABLE_NAME)
  INTO prior USING NEW.period_id,NEW.team_org_unit_id;
 IF NEW.revision<>prior+1 THEN RAISE EXCEPTION 'ATTESTATION_REVISION_CONFLICT' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER source_coverage_insert BEFORE INSERT ON attendance_source_coverage FOR EACH ROW EXECUTE FUNCTION guard_attendance_attestation();
CREATE TRIGGER team_confirmation_insert BEFORE INSERT ON attendance_team_confirmation FOR EACH ROW EXECUTE FUNCTION guard_attendance_attestation();
CREATE TRIGGER source_coverage_immutable BEFORE UPDATE OR DELETE ON attendance_source_coverage FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
CREATE TRIGGER team_confirmation_immutable BEFORE UPDATE OR DELETE ON attendance_team_confirmation FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
CREATE TRIGGER source_coverage_no_truncate BEFORE TRUNCATE ON attendance_source_coverage FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_mutation();
CREATE TRIGGER team_confirmation_no_truncate BEFORE TRUNCATE ON attendance_team_confirmation FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_mutation();
UPDATE role SET function_permissions=ARRAY(SELECT DISTINCT unnest(function_permissions||ARRAY['attendance.confirm'])) WHERE code::text='TT';
