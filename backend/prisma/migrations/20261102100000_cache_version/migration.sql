-- add-caching-layer: version stamps for the shared reference-data cache.
-- Every write to a source table bumps its group in the same transaction, so a reader that sees the new rows also sees
-- the new version. Versions come from a sequence, not a counter: a rolled-back transaction's value is never reused, so a
-- cache entry built inside a transaction that later rolled back can never match a committed state.
CREATE SEQUENCE cache_version_seq;

CREATE TABLE cache_version (
  name VARCHAR(40) PRIMARY KEY,
  version BIGINT NOT NULL
);

INSERT INTO cache_version (name, version) VALUES
  ('org', nextval('cache_version_seq')),
  ('roles', nextval('cache_version_seq')),
  ('legal-parameters', nextval('cache_version_seq')),
  ('site-policies', nextval('cache_version_seq')),
  ('shifts', nextval('cache_version_seq'));

CREATE FUNCTION bump_cache_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE cache_version SET version = nextval('cache_version_seq') WHERE name = TG_ARGV[0];
  IF NOT FOUND THEN RAISE EXCEPTION 'CACHE_GROUP_UNKNOWN %', TG_ARGV[0]; END IF;
  RETURN NULL;
END $$;

-- Statement level: one bump per statement, including bulk writes, seeds, migrations and manual SQL.
CREATE TRIGGER org_unit_cache_version AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON org_unit FOR EACH STATEMENT EXECUTE FUNCTION bump_cache_version('org');
CREATE TRIGGER org_unit_version_cache_version AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON org_unit_version FOR EACH STATEMENT EXECUTE FUNCTION bump_cache_version('org');
CREATE TRIGGER site_cache_version AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON site FOR EACH STATEMENT EXECUTE FUNCTION bump_cache_version('org');
CREATE TRIGGER role_cache_version AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON role FOR EACH STATEMENT EXECUTE FUNCTION bump_cache_version('roles');
CREATE TRIGGER legal_parameter_cache_version AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON legal_parameter FOR EACH STATEMENT EXECUTE FUNCTION bump_cache_version('legal-parameters');
CREATE TRIGGER site_policy_cache_version AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON site_policy FOR EACH STATEMENT EXECUTE FUNCTION bump_cache_version('site-policies');
CREATE TRIGGER shift_definition_cache_version AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON shift_definition FOR EACH STATEMENT EXECUTE FUNCTION bump_cache_version('shifts');
