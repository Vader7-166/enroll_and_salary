CREATE TYPE "AttendancePeriodLockAction" AS ENUM ('RETURN', 'LOCK');

CREATE TABLE "attendance_period_lock_event" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "period_id" UUID NOT NULL,
  "revision" INTEGER NOT NULL,
  "action" "AttendancePeriodLockAction" NOT NULL,
  "source_hash" CHAR(64) NOT NULL,
  "note" VARCHAR(2000) NOT NULL,
  "snapshot" JSONB NOT NULL,
  "actor_id" UUID NOT NULL,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attendance_period_lock_event_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "attendance_period_lock_event_period_id_revision_key" UNIQUE ("period_id", "revision"),
  CONSTRAINT "attendance_period_lock_event_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "business_period"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "attendance_period_lock_event_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "user_account"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE INDEX "attendance_period_lock_event_period_id_revision_idx" ON "attendance_period_lock_event"("period_id", "revision");

CREATE OR REPLACE FUNCTION "protect_locked_attendance_period"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."status" = 'LOCKED' AND (
    NEW."status" IS DISTINCT FROM OLD."status" OR
    NEW."code" IS DISTINCT FROM OLD."code" OR
    NEW."period_type" IS DISTINCT FROM OLD."period_type" OR
    NEW."scope_org_unit_id" IS DISTINCT FROM OLD."scope_org_unit_id" OR
    NEW."date_from" IS DISTINCT FROM OLD."date_from" OR
    NEW."date_to" IS DISTINCT FROM OLD."date_to" OR
    NEW."cutoff_day" IS DISTINCT FROM OLD."cutoff_day" OR
    NEW."cutoff_policy_id" IS DISTINCT FROM OLD."cutoff_policy_id"
  ) THEN
    RAISE EXCEPTION 'LOCKED attendance period is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "business_period_locked_immutable"
BEFORE UPDATE ON "business_period"
FOR EACH ROW EXECUTE FUNCTION "protect_locked_attendance_period"();

CREATE OR REPLACE FUNCTION "protect_attendance_period_lock_event"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  period_status "BusinessPeriodStatus";
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'attendance period lock ledger is immutable';
  END IF;
  SELECT "status" INTO period_status FROM "business_period" WHERE "id" = NEW."period_id" FOR KEY SHARE;
  IF NEW."action" = 'LOCK' AND period_status <> 'LOCKED' THEN
    RAISE EXCEPTION 'LOCK event requires a LOCKED business period';
  END IF;
  IF NEW."action" = 'RETURN' AND period_status = 'LOCKED' THEN
    RAISE EXCEPTION 'LOCKED attendance period cannot be returned';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "attendance_period_lock_event_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "attendance_period_lock_event"
FOR EACH ROW EXECUTE FUNCTION "protect_attendance_period_lock_event"();

CREATE OR REPLACE FUNCTION "reject_attendance_period_lock_truncate"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'attendance period lock ledger is immutable';
END;
$$;

CREATE TRIGGER "attendance_period_lock_event_no_truncate"
BEFORE TRUNCATE ON "attendance_period_lock_event"
FOR EACH STATEMENT EXECUTE FUNCTION "reject_attendance_period_lock_truncate"();

UPDATE "role"
SET "function_permissions" = array_append("function_permissions", 'attendance.lock')
WHERE "code" = 'KT'
  AND NOT ('attendance.lock' = ANY("function_permissions"));
