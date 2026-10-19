-- AlterTable
ALTER TABLE "daily_attendance" ADD COLUMN     "adjustment_id" UUID,
ADD COLUMN     "effective_check_in_at" TIMESTAMPTZ(3),
ADD COLUMN     "effective_check_out_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "overtime_actual" ADD COLUMN     "adjustment_id" UUID;

-- CreateTable
CREATE TABLE "attendance_correction" (
    "id" UUID NOT NULL,
    "period_id" UUID NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "reason" TEXT NOT NULL,
    "evidence_reference" TEXT,
    "incident_reference" TEXT,
    "warnings" TEXT[],
    "created_by_id" UUID NOT NULL,
    "decided_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submitted_at" TIMESTAMPTZ(3),
    "decided_at" TIMESTAMPTZ(3),
    "decision_reason" TEXT,

    CONSTRAINT "attendance_correction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_correction_item" (
    "id" UUID NOT NULL,
    "correction_id" UUID NOT NULL,
    "period_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "org_unit_id" UUID NOT NULL,
    "work_date" DATE NOT NULL,
    "source_dates" DATE[],
    "intervals" JSONB,
    "excuse_late_early" BOOLEAN NOT NULL DEFAULT false,
    "source_hash" CHAR(64),
    "before_snapshot" JSONB,
    "after_snapshot" JSONB,

    CONSTRAINT "attendance_correction_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_correction_evidence" (
    "id" UUID NOT NULL,
    "correction_id" UUID NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "content_type" VARCHAR(80) NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "content" BYTEA NOT NULL,
    "uploaded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_correction_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_correction_history" (
    "id" UUID NOT NULL,
    "correction_id" UUID NOT NULL,
    "action" VARCHAR(24) NOT NULL,
    "actor_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,
    "old_value" JSONB,
    "new_value" JSONB NOT NULL,

    CONSTRAINT "attendance_correction_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attendance_correction_period_id_status_created_at_idx" ON "attendance_correction"("period_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "attendance_correction_item_employee_id_org_unit_id_work_dat_idx" ON "attendance_correction_item"("employee_id", "org_unit_id", "work_date");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_correction_item_correction_id_employee_id_org_un_key" ON "attendance_correction_item"("correction_id", "employee_id", "org_unit_id", "work_date");

-- CreateIndex
CREATE INDEX "attendance_correction_evidence_correction_id_idx" ON "attendance_correction_evidence"("correction_id");

-- CreateIndex
CREATE INDEX "attendance_correction_history_correction_id_occurred_at_idx" ON "attendance_correction_history"("correction_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "daily_attendance" ADD CONSTRAINT "daily_attendance_adjustment_id_fkey" FOREIGN KEY ("adjustment_id") REFERENCES "attendance_correction_item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "overtime_actual" ADD CONSTRAINT "overtime_actual_adjustment_id_fkey" FOREIGN KEY ("adjustment_id") REFERENCES "attendance_correction_item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_correction" ADD CONSTRAINT "attendance_correction_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "business_period"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_correction" ADD CONSTRAINT "attendance_correction_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_correction" ADD CONSTRAINT "attendance_correction_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "user_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_correction_item" ADD CONSTRAINT "attendance_correction_item_correction_id_fkey" FOREIGN KEY ("correction_id") REFERENCES "attendance_correction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_correction_item" ADD CONSTRAINT "attendance_correction_item_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "business_period"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_correction_item" ADD CONSTRAINT "attendance_correction_item_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_correction_item" ADD CONSTRAINT "attendance_correction_item_org_unit_id_fkey" FOREIGN KEY ("org_unit_id") REFERENCES "org_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_correction_evidence" ADD CONSTRAINT "attendance_correction_evidence_correction_id_fkey" FOREIGN KEY ("correction_id") REFERENCES "attendance_correction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_correction_evidence" ADD CONSTRAINT "attendance_correction_evidence_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_correction_history" ADD CONSTRAINT "attendance_correction_history_correction_id_fkey" FOREIGN KEY ("correction_id") REFERENCES "attendance_correction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_correction_history" ADD CONSTRAINT "attendance_correction_history_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE SEQUENCE attendance_correction_approval_order;
ALTER TABLE attendance_correction ADD COLUMN applied_order BIGINT;
ALTER TABLE attendance_correction ADD CONSTRAINT correction_valid CHECK (kind IN ('EXPLANATION','CORRECTION') AND status IN ('DRAFT','PENDING','RETURNED','REJECTED','APPROVED') AND revision>0 AND length(trim(reason))>0);
ALTER TABLE attendance_correction_item ALTER COLUMN source_dates SET NOT NULL;
ALTER TABLE attendance_correction_item ADD CONSTRAINT correction_intervals CHECK (intervals IS NULL OR jsonb_typeof(intervals)='array');
ALTER TABLE attendance_correction_evidence ADD CONSTRAINT correction_evidence_size CHECK (size>0 AND size<=5242880 AND octet_length(content)=size);
UPDATE role SET function_permissions=ARRAY(SELECT DISTINCT unnest(function_permissions || CASE WHEN code::text='TT' THEN ARRAY['attendance.explain'] WHEN code::text='QD' THEN ARRAY['attendance.review'] ELSE ARRAY[]::text[] END));

CREATE FUNCTION assert_correction_period_open(target UUID, unit UUID, dates DATE[]) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE source_day DATE; state TEXT;
BEGIN
 PERFORM pg_advisory_xact_lock(8210472);
 SELECT status::text INTO state FROM business_period WHERE id=target FOR SHARE;
 IF state IS DISTINCT FROM 'OPEN' THEN RAISE EXCEPTION 'PERIOD_STATE_CONFLICT' USING ERRCODE='23514'; END IF;
 FOREACH source_day IN ARRAY dates LOOP
  IF EXISTS (WITH RECURSIVE ancestors(id) AS (
    SELECT unit UNION SELECT v.parent_id FROM org_unit_version v JOIN ancestors a ON a.id=v.org_unit_id
    WHERE v.effective_from<=source_day AND (v.effective_to IS NULL OR v.effective_to>=source_day) AND v.parent_id IS NOT NULL
   ) SELECT 1 FROM business_period p JOIN ancestors a ON a.id=p.scope_org_unit_id
    WHERE p.period_type='ATTENDANCE' AND p.status IN ('CLOSED','LOCKED') AND source_day BETWEEN p.date_from AND p.date_to)
  THEN RAISE EXCEPTION 'PERIOD_STATE_CONFLICT' USING ERRCODE='23514'; END IF;
 END LOOP;
END $$;

CREATE FUNCTION guard_correction_header() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item RECORD;
BEGIN
 PERFORM pg_advisory_xact_lock(8210472);
 IF TG_OP='DELETE' OR (TG_OP='UPDATE' AND OLD.status IN ('APPROVED','REJECTED')) THEN RAISE EXCEPTION 'CORRECTION_IMMUTABLE' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM business_period WHERE id=NEW.period_id AND status='OPEN') THEN RAISE EXCEPTION 'PERIOD_STATE_CONFLICT' USING ERRCODE='23514'; END IF;
 FOR item IN SELECT * FROM attendance_correction_item WHERE correction_id=NEW.id LOOP
  PERFORM assert_correction_period_open(item.period_id,item.org_unit_id,array_append(item.source_dates,item.work_date));
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER correction_header_guard BEFORE INSERT OR UPDATE OR DELETE ON attendance_correction FOR EACH ROW EXECUTE FUNCTION guard_correction_header();

CREATE FUNCTION guard_correction_item() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE entry RECORD; state TEXT; parent_period UUID;
BEGIN
 PERFORM pg_advisory_xact_lock(8210472);
 FOR entry IN SELECT * FROM jsonb_to_recordset(CASE WHEN TG_OP='INSERT' THEN jsonb_build_array(to_jsonb(NEW)) WHEN TG_OP='DELETE' THEN jsonb_build_array(to_jsonb(OLD)) ELSE jsonb_build_array(to_jsonb(OLD),to_jsonb(NEW)) END)
  AS x(correction_id UUID,period_id UUID,org_unit_id UUID,work_date DATE,source_dates DATE[]) LOOP
  SELECT status,period_id INTO state,parent_period FROM attendance_correction WHERE id=entry.correction_id;
  IF state NOT IN ('DRAFT','RETURNED','PENDING') OR parent_period IS DISTINCT FROM entry.period_id THEN RAISE EXCEPTION 'CORRECTION_IMMUTABLE' USING ERRCODE='23514'; END IF;
  PERFORM assert_correction_period_open(entry.period_id,entry.org_unit_id,array_append(entry.source_dates,entry.work_date));
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER correction_item_guard BEFORE INSERT OR UPDATE OR DELETE ON attendance_correction_item FOR EACH ROW EXECUTE FUNCTION guard_correction_item();

CREATE FUNCTION guard_correction_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE entry RECORD; state TEXT;
BEGIN
 PERFORM pg_advisory_xact_lock(8210472);
 SELECT status INTO state FROM attendance_correction WHERE id=NEW.correction_id;
 IF state NOT IN ('DRAFT','RETURNED') THEN RAISE EXCEPTION 'CORRECTION_IMMUTABLE' USING ERRCODE='23514'; END IF;
 FOR entry IN SELECT * FROM attendance_correction_item WHERE correction_id=NEW.correction_id LOOP
  PERFORM assert_correction_period_open(entry.period_id,entry.org_unit_id,array_append(entry.source_dates,entry.work_date));
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER correction_evidence_guard BEFORE INSERT ON attendance_correction_evidence FOR EACH ROW EXECUTE FUNCTION guard_correction_evidence();
CREATE TRIGGER correction_evidence_immutable BEFORE UPDATE OR DELETE ON attendance_correction_evidence FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
CREATE TRIGGER correction_history_immutable BEFORE UPDATE OR DELETE ON attendance_correction_history FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
CREATE TRIGGER correction_header_no_truncate BEFORE TRUNCATE ON attendance_correction FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_mutation();
CREATE TRIGGER correction_item_no_truncate BEFORE TRUNCATE ON attendance_correction_item FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_mutation();
CREATE TRIGGER correction_evidence_no_truncate BEFORE TRUNCATE ON attendance_correction_evidence FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_mutation();
CREATE TRIGGER correction_history_no_truncate BEFORE TRUNCATE ON attendance_correction_history FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_mutation();

-- Regular results now carry attested times as well as immutable raw references.
CREATE OR REPLACE FUNCTION guard_attendance_period() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE entry RECORD; dates DATE[];
BEGIN
 PERFORM pg_advisory_xact_lock(8210472);
 FOR entry IN SELECT * FROM jsonb_to_recordset(CASE WHEN TG_OP='INSERT' THEN jsonb_build_array(to_jsonb(NEW)) WHEN TG_OP='DELETE' THEN jsonb_build_array(to_jsonb(OLD)) ELSE jsonb_build_array(to_jsonb(OLD),to_jsonb(NEW)) END)
  AS x(period_id UUID,org_unit_id UUID,work_date DATE,check_in_id UUID,check_out_id UUID,effective_check_in_at TIMESTAMPTZ,effective_check_out_at TIMESTAMPTZ,adjustment_id UUID) LOOP
  SELECT array_agg(DISTINCT d) INTO dates FROM (
   SELECT entry.work_date d UNION SELECT (punched_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date FROM raw_punch WHERE id IN (entry.check_in_id,entry.check_out_id)
   UNION SELECT (entry.effective_check_in_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
   UNION SELECT (entry.effective_check_out_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
   UNION SELECT unnest(source_dates) FROM attendance_correction_item WHERE id=entry.adjustment_id
  ) sources WHERE d IS NOT NULL;
  PERFORM assert_correction_period_open(entry.period_id,entry.org_unit_id,dates);
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;

