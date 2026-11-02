CREATE EXTENSION IF NOT EXISTS "btree_gist";

CREATE TYPE "PayrollPeriodStatus" AS ENUM ('OPEN', 'LOCKED');
CREATE TYPE "PayrollInputStatus" AS ENUM ('DRAFT', 'VALIDATED', 'CONFIRMED', 'RETURNED', 'SUPERSEDED');
CREATE TYPE "PayrollInputProvenance" AS ENUM ('SIMULATION', 'BUSINESS_CONFIRMED');

CREATE TABLE "payroll_period" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" VARCHAR(64) NOT NULL,
  "site_org_unit_id" UUID NOT NULL,
  "date_from" DATE NOT NULL,
  "date_to" DATE NOT NULL,
  "expected_payment_date" DATE,
  "status" "PayrollPeriodStatus" NOT NULL DEFAULT 'OPEN',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payroll_period_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payroll_period_code_key" UNIQUE ("code"),
  CONSTRAINT "payroll_period_site_org_unit_id_fkey" FOREIGN KEY ("site_org_unit_id") REFERENCES "org_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payroll_period_date_range" CHECK ("date_from" <= "date_to")
);
ALTER TABLE "payroll_period" ADD CONSTRAINT "payroll_period_no_overlap" EXCLUDE USING gist ("site_org_unit_id" WITH =, daterange("date_from", "date_to", '[]') WITH &&);
CREATE INDEX "payroll_period_site_org_unit_id_date_from_date_to_idx" ON "payroll_period"("site_org_unit_id", "date_from", "date_to");

CREATE TABLE "payroll_input_batch" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "payroll_period_id" UUID NOT NULL,
  "source_system" VARCHAR(80) NOT NULL,
  "source_document_no" VARCHAR(160) NOT NULL,
  "source_version" VARCHAR(80) NOT NULL,
  "mapping_version" VARCHAR(80) NOT NULL,
  "provenance" "PayrollInputProvenance" NOT NULL,
  "prepared_by" VARCHAR(200) NOT NULL,
  "source_approved_by" VARCHAR(200),
  "source_approved_at" DATE,
  "source_approval_reference" VARCHAR(500),
  "reason" VARCHAR(2000) NOT NULL,
  "attendance_period_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  "status" "PayrollInputStatus" NOT NULL DEFAULT 'DRAFT',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "content_hash" CHAR(64) NOT NULL,
  "payload_cipher" TEXT NOT NULL,
  "validation_cipher" TEXT,
  "file_name" VARCHAR(255),
  "file_hash" CHAR(64),
  "supersedes_batch_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by_id" UUID NOT NULL,
  CONSTRAINT "payroll_input_batch_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payroll_input_batch_source_system_source_document_no_source_version_key" UNIQUE ("source_system", "source_document_no", "source_version"),
  CONSTRAINT "payroll_input_batch_payroll_period_id_fkey" FOREIGN KEY ("payroll_period_id") REFERENCES "payroll_period"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payroll_input_batch_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payroll_input_batch_supersedes_batch_id_fkey" FOREIGN KEY ("supersedes_batch_id") REFERENCES "payroll_input_batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payroll_input_batch_revision_positive" CHECK ("revision" > 0),
  CONSTRAINT "payroll_input_batch_file_pair" CHECK (("file_name" IS NULL) = ("file_hash" IS NULL))
);
CREATE INDEX "payroll_input_batch_payroll_period_id_status_idx" ON "payroll_input_batch"("payroll_period_id", "status");
CREATE INDEX "payroll_input_batch_source_system_source_document_no_status_idx" ON "payroll_input_batch"("source_system", "source_document_no", "status");
CREATE UNIQUE INDEX "payroll_input_batch_active_source_document_key" ON "payroll_input_batch"("source_system", "source_document_no") WHERE "status" = 'CONFIRMED';

CREATE TABLE "payroll_input_line" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "batch_id" UUID NOT NULL,
  "source_line_id" VARCHAR(160) NOT NULL,
  "employee_id" UUID NOT NULL,
  "component_id" UUID NOT NULL,
  "input_type" VARCHAR(32) NOT NULL,
  "work_from" DATE NOT NULL,
  "work_to" DATE NOT NULL,
  "value_state" VARCHAR(32) NOT NULL,
  "calculation_mode" VARCHAR(16) NOT NULL,
  "business_reference" VARCHAR(500),
  "adjustment_of_line_id" UUID,
  "team_allocation_key" VARCHAR(160),
  "payload_cipher" TEXT NOT NULL,
  "binding_snapshot_cipher" TEXT,
  "input_hash" CHAR(64) NOT NULL,
  "supersedes_line_id" UUID,
  CONSTRAINT "payroll_input_line_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payroll_input_line_batch_id_source_line_id_key" UNIQUE ("batch_id", "source_line_id"),
  CONSTRAINT "payroll_input_line_work_range" CHECK ("work_from" <= "work_to"),
  CONSTRAINT "payroll_input_line_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "payroll_input_batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payroll_input_line_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payroll_input_line_component_id_fkey" FOREIGN KEY ("component_id") REFERENCES "salary_component"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payroll_input_line_adjustment_of_line_id_fkey" FOREIGN KEY ("adjustment_of_line_id") REFERENCES "payroll_input_line"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payroll_input_line_supersedes_line_id_fkey" FOREIGN KEY ("supersedes_line_id") REFERENCES "payroll_input_line"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "payroll_input_line_employee_id_component_id_work_from_work_to_idx" ON "payroll_input_line"("employee_id", "component_id", "work_from", "work_to");

CREATE TABLE "payroll_input_team_allocation" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "batch_id" UUID NOT NULL,
  "allocation_key" VARCHAR(160) NOT NULL,
  "team_org_unit_id" UUID NOT NULL,
  "accepted_amount_cipher" TEXT NOT NULL,
  "reference" VARCHAR(500) NOT NULL,
  CONSTRAINT "payroll_input_team_allocation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payroll_input_team_allocation_batch_id_allocation_key_key" UNIQUE ("batch_id", "allocation_key"),
  CONSTRAINT "payroll_input_team_allocation_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "payroll_input_batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payroll_input_team_allocation_team_org_unit_id_fkey" FOREIGN KEY ("team_org_unit_id") REFERENCES "org_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "payroll_input_evidence" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "batch_id" UUID NOT NULL,
  "file_name" VARCHAR(255) NOT NULL,
  "content_type" VARCHAR(100) NOT NULL,
  "size" INTEGER NOT NULL,
  "sha256" CHAR(64) NOT NULL,
  "content_cipher" TEXT NOT NULL,
  "uploaded_by_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payroll_input_evidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payroll_input_evidence_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "payroll_input_batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payroll_input_evidence_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payroll_input_evidence_size_positive" CHECK ("size" > 0)
);

CREATE TABLE "payroll_input_history" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "batch_id" UUID NOT NULL,
  "actor_id" UUID NOT NULL,
  "action" VARCHAR(40) NOT NULL,
  "from_status" "PayrollInputStatus",
  "to_status" "PayrollInputStatus" NOT NULL,
  "reason" VARCHAR(2000) NOT NULL,
  "revision" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payroll_input_history_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payroll_input_history_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "payroll_input_batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payroll_input_history_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payroll_input_history_revision_positive" CHECK ("revision" > 0)
);
CREATE INDEX "payroll_input_history_batch_id_created_at_idx" ON "payroll_input_history"("batch_id", "created_at");

CREATE OR REPLACE FUNCTION payroll_inputs_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Payroll input records are immutable';
END;
$$;

CREATE TRIGGER payroll_period_no_delete BEFORE DELETE OR TRUNCATE ON "payroll_period" FOR EACH STATEMENT EXECUTE FUNCTION payroll_inputs_no_delete();
CREATE TRIGGER payroll_input_batch_no_delete BEFORE DELETE OR TRUNCATE ON "payroll_input_batch" FOR EACH STATEMENT EXECUTE FUNCTION payroll_inputs_no_delete();
CREATE TRIGGER payroll_input_line_no_delete BEFORE DELETE OR TRUNCATE ON "payroll_input_line" FOR EACH STATEMENT EXECUTE FUNCTION payroll_inputs_no_delete();
CREATE TRIGGER payroll_input_team_allocation_no_delete BEFORE DELETE OR TRUNCATE ON "payroll_input_team_allocation" FOR EACH STATEMENT EXECUTE FUNCTION payroll_inputs_no_delete();
CREATE TRIGGER payroll_input_evidence_no_delete BEFORE DELETE OR TRUNCATE ON "payroll_input_evidence" FOR EACH STATEMENT EXECUTE FUNCTION payroll_inputs_no_delete();
CREATE TRIGGER payroll_input_history_no_delete BEFORE DELETE OR TRUNCATE ON "payroll_input_history" FOR EACH STATEMENT EXECUTE FUNCTION payroll_inputs_no_delete();

CREATE OR REPLACE FUNCTION payroll_period_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'OPEN' OR EXISTS (
      SELECT 1
      FROM generate_series(NEW.date_from, NEW.date_to, INTERVAL '1 day') AS day_at
      WHERE NOT EXISTS (
        SELECT 1 FROM "org_unit_version"
        WHERE "org_unit_id" = NEW.site_org_unit_id AND "unit_type" = 'SITE'
          AND "effective_from" <= day_at::date
          AND ("effective_to" IS NULL OR "effective_to" >= day_at::date)
      )
    ) THEN
      RAISE EXCEPTION 'Payroll period must be an OPEN SITE period';
    END IF;
    RETURN NEW;
  END IF;

  IF (to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status')
    OR OLD.status <> 'OPEN' OR NEW.status <> 'LOCKED' THEN
    RAISE EXCEPTION 'Payroll period identity is immutable and may only lock once';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER payroll_period_guard BEFORE INSERT OR UPDATE ON "payroll_period" FOR EACH ROW EXECUTE FUNCTION payroll_period_guard();

CREATE OR REPLACE FUNCTION payroll_input_batch_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  period_status "PayrollPeriodStatus";
  predecessor "payroll_input_batch"%ROWTYPE;
BEGIN
  SELECT "status" INTO period_status FROM "payroll_period" WHERE "id" = NEW.payroll_period_id;
  IF period_status IS DISTINCT FROM 'OPEN' THEN
    RAISE EXCEPTION 'Payroll input writes require an OPEN payroll period';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' OR NEW.revision <> 1 THEN
      RAISE EXCEPTION 'Payroll input batches must start as revision 1 DRAFT';
    END IF;
    IF NEW.supersedes_batch_id IS NOT NULL THEN
      SELECT * INTO predecessor FROM "payroll_input_batch" WHERE "id" = NEW.supersedes_batch_id;
      IF NOT FOUND OR predecessor.payroll_period_id <> NEW.payroll_period_id
        OR predecessor.source_system <> NEW.source_system
        OR predecessor.source_document_no <> NEW.source_document_no
        OR predecessor.source_version = NEW.source_version THEN
        RAISE EXCEPTION 'Payroll input replacement must link a distinct predecessor in the same source document and period';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.revision <> OLD.revision + 1 THEN
    RAISE EXCEPTION 'Payroll input revision must advance exactly once';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['status', 'revision', 'validation_cipher', 'file_name', 'file_hash'])
      IS DISTINCT FROM
      (to_jsonb(OLD) - ARRAY['status', 'revision', 'validation_cipher', 'file_name', 'file_hash']) THEN
    RAISE EXCEPTION 'Payroll input source header and content are immutable';
  END IF;
  IF (NEW.file_name, NEW.file_hash) IS DISTINCT FROM (OLD.file_name, OLD.file_hash)
    AND NOT (OLD.status = 'DRAFT' AND NEW.status = 'DRAFT'
      AND OLD.file_name IS NULL AND OLD.file_hash IS NULL
      AND NEW.file_name IS NOT NULL AND NEW.file_hash IS NOT NULL) THEN
    RAISE EXCEPTION 'Payroll input file metadata may only be set once on an initial DRAFT import';
  END IF;

  IF OLD.status = 'CONFIRMED' THEN
    IF NEW.status NOT IN ('RETURNED', 'SUPERSEDED') OR NEW.validation_cipher IS DISTINCT FROM OLD.validation_cipher
      OR (NEW.file_name, NEW.file_hash) IS DISTINCT FROM (OLD.file_name, OLD.file_hash) THEN
      RAISE EXCEPTION 'Confirmed payroll input batches may only be returned or superseded';
    END IF;
  ELSIF OLD.status = 'RETURNED' THEN
    IF NEW.status <> 'SUPERSEDED' OR NEW.validation_cipher IS DISTINCT FROM OLD.validation_cipher
      OR (NEW.file_name, NEW.file_hash) IS DISTINCT FROM (OLD.file_name, OLD.file_hash) THEN
      RAISE EXCEPTION 'Returned payroll input batches may only be superseded';
    END IF;
  ELSIF OLD.status = 'SUPERSEDED' THEN
    RAISE EXCEPTION 'Superseded payroll input batches are immutable';
  ELSIF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    (OLD.status = 'DRAFT' AND NEW.status IN ('VALIDATED', 'RETURNED', 'SUPERSEDED'))
    OR (OLD.status = 'VALIDATED' AND NEW.status IN ('DRAFT', 'CONFIRMED', 'RETURNED', 'SUPERSEDED'))
  ) THEN
    RAISE EXCEPTION 'Illegal payroll input status transition';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER payroll_input_batch_guard BEFORE INSERT OR UPDATE ON "payroll_input_batch" FOR EACH ROW EXECUTE FUNCTION payroll_input_batch_guard();

CREATE OR REPLACE FUNCTION payroll_input_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  batch_row "payroll_input_batch"%ROWTYPE;
  linked_line "payroll_input_line"%ROWTYPE;
  linked_batch "payroll_input_batch"%ROWTYPE;
BEGIN
  SELECT * INTO batch_row FROM "payroll_input_batch" WHERE "id" = NEW.batch_id;
  IF NOT FOUND OR batch_row.status NOT IN ('DRAFT', 'VALIDATED') OR NOT EXISTS (
    SELECT 1 FROM "payroll_period" WHERE "id" = batch_row.payroll_period_id AND "status" = 'OPEN'
  ) THEN
    RAISE EXCEPTION 'Payroll input lines require an editable batch in an OPEN payroll period';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF batch_row.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'Payroll input lines may only be inserted into an initial DRAFT batch';
    END IF;
    IF NEW.supersedes_line_id IS NOT NULL THEN
      SELECT * INTO linked_line FROM "payroll_input_line" WHERE "id" = NEW.supersedes_line_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Payroll input replacement line predecessor does not exist'; END IF;
      SELECT * INTO linked_batch FROM "payroll_input_batch" WHERE "id" = linked_line.batch_id;
      IF linked_line.batch_id <> batch_row.supersedes_batch_id
        OR linked_line.source_line_id <> NEW.source_line_id
        OR linked_line.employee_id <> NEW.employee_id
        OR linked_line.component_id <> NEW.component_id THEN
        RAISE EXCEPTION 'Payroll input replacement line must match its predecessor';
      END IF;
    END IF;
    IF NEW.adjustment_of_line_id IS NOT NULL THEN
      SELECT * INTO linked_line FROM "payroll_input_line" WHERE "id" = NEW.adjustment_of_line_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Payroll input adjustment predecessor does not exist'; END IF;
      SELECT * INTO linked_batch FROM "payroll_input_batch" WHERE "id" = linked_line.batch_id;
      IF linked_line.employee_id <> NEW.employee_id OR linked_line.component_id <> NEW.component_id
        OR linked_batch.status NOT IN ('CONFIRMED', 'SUPERSEDED') THEN
        RAISE EXCEPTION 'Payroll input adjustment must reference a confirmed source line for the same employee and component';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF (to_jsonb(NEW) - 'binding_snapshot_cipher') IS DISTINCT FROM (to_jsonb(OLD) - 'binding_snapshot_cipher') THEN
    RAISE EXCEPTION 'Payroll input line content is immutable';
  END IF;
  IF OLD.binding_snapshot_cipher IS NOT NULL AND NEW.binding_snapshot_cipher IS DISTINCT FROM OLD.binding_snapshot_cipher
    AND batch_row.status = 'CONFIRMED' THEN
    RAISE EXCEPTION 'Accepted payroll input binding snapshots are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER payroll_input_line_guard BEFORE INSERT OR UPDATE ON "payroll_input_line" FOR EACH ROW EXECUTE FUNCTION payroll_input_line_guard();

CREATE OR REPLACE FUNCTION payroll_input_team_allocation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Payroll team allocations are immutable';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "payroll_input_batch" batch
    JOIN "payroll_period" period ON period."id" = batch."payroll_period_id"
    WHERE batch."id" = NEW.batch_id AND batch."status" = 'DRAFT' AND period."status" = 'OPEN'
  ) THEN
    RAISE EXCEPTION 'Payroll team allocations require an initial DRAFT batch in an OPEN payroll period';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER payroll_input_team_allocation_guard BEFORE INSERT OR UPDATE ON "payroll_input_team_allocation" FOR EACH ROW EXECUTE FUNCTION payroll_input_team_allocation_guard();

CREATE OR REPLACE FUNCTION payroll_input_evidence_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Payroll input evidence is immutable';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "payroll_input_batch" batch
    JOIN "payroll_period" period ON period."id" = batch."payroll_period_id"
    WHERE batch."id" = NEW.batch_id AND batch."status" IN ('DRAFT', 'VALIDATED') AND period."status" = 'OPEN'
  ) THEN
    RAISE EXCEPTION 'Payroll evidence requires an editable batch in an OPEN payroll period';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER payroll_input_evidence_guard BEFORE INSERT OR UPDATE ON "payroll_input_evidence" FOR EACH ROW EXECUTE FUNCTION payroll_input_evidence_guard();

CREATE OR REPLACE FUNCTION payroll_input_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  batch_row "payroll_input_batch"%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Payroll input history is immutable';
  END IF;
  SELECT * INTO batch_row FROM "payroll_input_batch" WHERE "id" = NEW.batch_id;
  IF NOT FOUND OR NEW.revision <> batch_row.revision OR NEW.to_status <> batch_row.status
    OR NOT EXISTS (SELECT 1 FROM "payroll_period" WHERE "id" = batch_row.payroll_period_id AND "status" = 'OPEN') THEN
    RAISE EXCEPTION 'Payroll input history must attest the current batch revision in an OPEN payroll period';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER payroll_input_history_guard BEFORE INSERT OR UPDATE ON "payroll_input_history" FOR EACH ROW EXECUTE FUNCTION payroll_input_history_guard();

CREATE OR REPLACE FUNCTION payroll_input_milestone_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  line_row RECORD;
BEGIN
  IF NEW.status <> 'CONFIRMED' OR OLD.status = 'CONFIRMED' THEN
    RETURN NEW;
  END IF;
  FOR line_row IN
    SELECT "employee_id", "component_id", "input_type", "business_reference", "work_from", "work_to"
    FROM "payroll_input_line"
    WHERE "batch_id" = NEW.id AND "business_reference" IS NOT NULL
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(
      line_row.employee_id::text || ':' || line_row.component_id::text || ':' || line_row.input_type || ':' || line_row.business_reference,
      8210524
    ));
    IF EXISTS (
      SELECT 1
      FROM "payroll_input_line" prior_line
      JOIN "payroll_input_batch" prior_batch ON prior_batch."id" = prior_line."batch_id"
      WHERE prior_batch."status" = 'CONFIRMED' AND prior_batch."id" <> NEW.id
        AND prior_line."employee_id" = line_row.employee_id
        AND prior_line."component_id" = line_row.component_id
        AND prior_line."input_type" = line_row.input_type
        AND prior_line."business_reference" = line_row.business_reference
        AND daterange(prior_line."work_from", prior_line."work_to", '[]') && daterange(line_row.work_from, line_row.work_to, '[]')
    ) THEN
      RAISE EXCEPTION 'Payroll business milestone is already confirmed by another active source';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
CREATE TRIGGER payroll_input_milestone_guard BEFORE UPDATE OF "status" ON "payroll_input_batch" FOR EACH ROW EXECUTE FUNCTION payroll_input_milestone_guard();

CREATE OR REPLACE FUNCTION payroll_input_transition_attestation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  predecessor "payroll_input_batch"%ROWTYPE;
BEGIN
  IF NEW.status = 'SUPERSEDED' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "payroll_input_batch" replacement
      WHERE replacement."supersedes_batch_id" = NEW.id
        AND replacement."status" = 'CONFIRMED'
        AND replacement."payroll_period_id" = NEW.payroll_period_id
        AND replacement."source_system" = NEW.source_system
        AND replacement."source_document_no" = NEW.source_document_no
    ) THEN
      RAISE EXCEPTION 'Superseded payroll input requires a confirmed same-period replacement';
    END IF;
  END IF;
  IF NEW.status = 'CONFIRMED' AND NEW.supersedes_batch_id IS NOT NULL THEN
    SELECT * INTO predecessor FROM "payroll_input_batch" WHERE "id" = NEW.supersedes_batch_id;
    IF NOT FOUND OR predecessor.status <> 'SUPERSEDED'
      OR predecessor.payroll_period_id <> NEW.payroll_period_id
      OR predecessor.source_system <> NEW.source_system
      OR predecessor.source_document_no <> NEW.source_document_no THEN
      RAISE EXCEPTION 'Confirmed replacement requires its predecessor to be superseded in the same period and source document';
    END IF;
  END IF;
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT EXISTS (
      SELECT 1 FROM "payroll_input_history"
      WHERE "batch_id" = NEW.id AND "revision" = NEW.revision AND "to_status" = NEW.status
    ) THEN
      RAISE EXCEPTION 'Payroll input status changes require immutable history in the same transaction';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER payroll_input_transition_attestation
AFTER INSERT OR UPDATE ON "payroll_input_batch"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION payroll_input_transition_attestation();

UPDATE "role"
SET "function_permissions" = ARRAY(
  SELECT DISTINCT permission
  FROM unnest("function_permissions" || ARRAY['payroll.inputs.read', 'payroll.inputs.manage']) AS permission
)
WHERE "code" = 'KT';
