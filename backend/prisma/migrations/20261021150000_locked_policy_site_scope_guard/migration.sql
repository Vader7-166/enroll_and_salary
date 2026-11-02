CREATE OR REPLACE FUNCTION "assert_legal_parameter_writable"(parameter_scope TEXT, parameter_from DATE, parameter_to DATE)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "business_period" period
    INNER JOIN "org_unit_version" scope_version
      ON scope_version."org_unit_id" = period."scope_org_unit_id"
      AND scope_version."effective_from" <= period."date_to"
      AND (scope_version."effective_to" IS NULL OR scope_version."effective_to" >= period."date_to")
    WHERE period."period_type" = 'ATTENDANCE'
      AND period."status" = 'LOCKED'
      AND parameter_from <= period."date_to"
      AND (parameter_to IS NULL OR parameter_to >= period."date_from")
      AND parameter_scope = 'SITE:' || scope_version."site_id"::text
  ) THEN
    RAISE EXCEPTION 'PERIOD_LOCKED' USING ERRCODE = '23514';
  END IF;
END;
$$;
