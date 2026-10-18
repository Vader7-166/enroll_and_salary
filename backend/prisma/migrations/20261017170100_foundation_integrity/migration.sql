-- Temporal intervals are inclusive business dates; stable IDs reference dated versions.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE org_unit_version ADD CONSTRAINT org_version_dates CHECK (effective_to IS NULL OR effective_to >= effective_from);
ALTER TABLE org_unit_version ADD CONSTRAINT org_version_level CHECK (level = CASE unit_type WHEN 'COMPANY' THEN 1 WHEN 'SITE' THEN 2 WHEN 'BLOCK' THEN 3 WHEN 'DEPARTMENT' THEN 4 WHEN 'TEAM' THEN 5 END);
ALTER TABLE org_unit_version ADD CONSTRAINT org_version_root CHECK ((unit_type = 'COMPANY' AND parent_id IS NULL AND site_id IS NULL) OR (unit_type <> 'COMPANY' AND parent_id IS NOT NULL AND site_id IS NOT NULL));
ALTER TABLE org_unit_version ADD CONSTRAINT org_version_no_overlap EXCLUDE USING gist (org_unit_id WITH =, daterange(effective_from,effective_to,'[]') WITH &&);
ALTER TABLE org_unit_version ADD CONSTRAINT company_single_root EXCLUDE USING gist ((1) WITH =, daterange(effective_from,effective_to,'[]') WITH &&) WHERE (unit_type = 'COMPANY');
ALTER TABLE org_unit_version ADD CONSTRAINT site_single_root EXCLUDE USING gist (site_id WITH =, daterange(effective_from,effective_to,'[]') WITH &&) WHERE (unit_type = 'SITE');
ALTER TABLE role_assignment ADD CONSTRAINT role_assignment_dates CHECK (effective_to IS NULL OR effective_to >= effective_from);
ALTER TABLE role_assignment ADD CONSTRAINT role_assignment_no_overlap EXCLUDE USING gist (user_account_id WITH =, role_code WITH =, scope_org_unit_id WITH =, daterange(effective_from,effective_to,'[]') WITH &&);
ALTER TABLE employee_exclusion ADD CONSTRAINT exclusion_dates CHECK (effective_to IS NULL OR effective_to >= effective_from);
ALTER TABLE org_assignment ADD CONSTRAINT org_assignment_dates CHECK (effective_to IS NULL OR effective_to >= effective_from);
ALTER TABLE org_assignment ADD CONSTRAINT allocation_range CHECK (allocation_ratio > 0 AND allocation_ratio <= 100);
ALTER TABLE org_assignment ADD CONSTRAINT primary_assignment_no_overlap EXCLUDE USING gist (employee_id WITH =, daterange(effective_from,effective_to,'[]') WITH &&) WHERE (is_primary);
ALTER TABLE org_assignment ADD CONSTRAINT unit_assignment_no_overlap EXCLUDE USING gist (employee_id WITH =, org_unit_id WITH =, daterange(effective_from,effective_to,'[]') WITH &&);
ALTER TABLE employee ADD CONSTRAINT employee_dates CHECK (dob < hire_date AND (termination_date IS NULL OR termination_date >= hire_date));
ALTER TABLE employee ADD CONSTRAINT employee_code_format CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{1,31}$');
ALTER TABLE employee ADD CONSTRAINT employee_name_not_blank CHECK (length(btrim(full_name)) >= 2);
ALTER TABLE job_title ADD CONSTRAINT job_level_range CHECK (job_level BETWEEN 1 AND 8);
ALTER TABLE user_account ADD CONSTRAINT failed_logins_nonnegative CHECK (failed_logins >= 0);
ALTER TABLE user_account ADD CONSTRAINT username_lowercase CHECK (username = lower(username));
ALTER TABLE web_session ADD CONSTRAINT session_dates CHECK (created_at <= last_seen_at AND last_seen_at < expires_at AND expires_at <= absolute_expires_at);

-- Parent levels strictly decrease, so cycles and depth >5 cannot be committed.
-- Check the complete covered date range, not just today's organization.
CREATE FUNCTION check_org_tree() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE child org_unit_version%ROWTYPE; affected uuid;
BEGIN
  affected := COALESCE(NEW.org_unit_id, OLD.org_unit_id);
  FOR child IN SELECT * FROM org_unit_version WHERE org_unit_id = affected OR parent_id = affected LOOP
    IF child.unit_type <> 'COMPANY' AND NOT (
      SELECT COALESCE(range_agg(daterange(p.effective_from,p.effective_to,'[]')), '{}'::datemultirange) @> daterange(child.effective_from,child.effective_to,'[]')
      FROM org_unit_version p
      WHERE p.org_unit_id = child.parent_id AND p.level = child.level-1
        AND (child.unit_type = 'SITE' OR p.site_id = child.site_id)
    ) THEN RAISE EXCEPTION 'ORG_CYCLE_DEPTH_SITE_OR_COVERAGE_INVALID' USING ERRCODE='23514'; END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER org_tree_integrity AFTER INSERT OR UPDATE OR DELETE ON org_unit_version DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_org_tree();

CREATE FUNCTION check_role_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT (
    SELECT COALESCE(range_agg(daterange(v.effective_from,v.effective_to,'[]')), '{}'::datemultirange) @> daterange(NEW.effective_from,NEW.effective_to,'[]')
    FROM org_unit_version v WHERE v.org_unit_id=NEW.scope_org_unit_id AND (
      (NEW.role_code='TT' AND v.unit_type='TEAM') OR (NEW.role_code='QD' AND v.unit_type='DEPARTMENT') OR
      (NEW.role_code IN ('KT','AD') AND v.unit_type IN ('COMPANY','SITE')))
  ) THEN RAISE EXCEPTION 'ROLE_SCOPE_INVALID' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER role_scope_integrity AFTER INSERT OR UPDATE ON role_assignment DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_role_scope();

CREATE FUNCTION check_employee_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE emp uuid; point date; total numeric; primaries bigint;
BEGIN
  FOR emp IN SELECT DISTINCT unnest(ARRAY[NEW.employee_id,OLD.employee_id]) LOOP
    IF emp IS NULL THEN CONTINUE; END IF;
    FOR point IN SELECT effective_from FROM org_assignment WHERE employee_id=emp
                 UNION SELECT effective_to+1 FROM org_assignment WHERE employee_id=emp AND effective_to IS NOT NULL LOOP
      SELECT COALESCE(sum(allocation_ratio),0),count(*) FILTER (WHERE is_primary) INTO total,primaries FROM org_assignment
        WHERE employee_id=emp AND daterange(effective_from,effective_to,'[]') @> point;
      IF total <> 0 AND (total <> 100 OR primaries <> 1) THEN RAISE EXCEPTION 'EMPLOYEE_ALLOCATION_MUST_TOTAL_100_WITH_ONE_PRIMARY' USING ERRCODE='23514'; END IF;
    END LOOP;
  END LOOP;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER allocation_integrity AFTER INSERT OR UPDATE OR DELETE ON org_assignment DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_employee_allocation();

CREATE FUNCTION reject_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'AUDIT_LOG_APPEND_ONLY' USING ERRCODE='42501'; END;
$$;
CREATE TRIGGER audit_no_update_delete BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
CREATE TRIGGER audit_no_truncate BEFORE TRUNCATE ON audit_log FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_mutation();
REVOKE UPDATE,DELETE,TRUNCATE ON audit_log FROM PUBLIC;
