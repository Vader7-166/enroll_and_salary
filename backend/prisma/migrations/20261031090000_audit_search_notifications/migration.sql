-- Audit search by scope (FR-1.6.4), hash-chain integrity checks (FR-1.6.1, NFR-26), in-app notifications (FR-X.5)
-- and parameter expiry warnings (FR-1.3.3).

-- Adding a nullable column rewrites no existing row; the no-update trigger still guards every record.
ALTER TABLE "audit_log" ADD COLUMN "scope_org_unit_id" UUID;
CREATE INDEX "audit_log_scope_time_idx" ON "audit_log"("scope_org_unit_id", "occurred_at" DESC);
CREATE INDEX "audit_log_time_idx" ON "audit_log"("occurred_at" DESC);
CREATE INDEX "audit_log_actor_time_idx" ON "audit_log"("actor_id", "occurred_at" DESC);
CREATE INDEX "audit_log_entity_idx" ON "audit_log"("entity_type", "entity_id");
CREATE INDEX "audit_log_result_time_idx" ON "audit_log"("result", "occurred_at" DESC);

CREATE TYPE "AuditIntegrityStatus" AS ENUM ('VALID', 'BROKEN');

CREATE TABLE "audit_integrity_check" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "trigger" VARCHAR(16) NOT NULL CHECK ("trigger" IN ('SCHEDULED', 'MANUAL')),
  "status" "AuditIntegrityStatus" NOT NULL,
  "from_id" BIGINT,
  "to_id" BIGINT,
  "checked_count" INTEGER NOT NULL,
  "first_broken_id" BIGINT,
  "failure_reason" VARCHAR(40),
  "started_at" TIMESTAMPTZ(3) NOT NULL,
  "finished_at" TIMESTAMPTZ(3) NOT NULL,
  "triggered_by_id" UUID REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "audit_integrity_check_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "audit_integrity_check_broken" CHECK (("status" = 'BROKEN') = ("first_broken_id" IS NOT NULL))
);
CREATE INDEX "audit_integrity_check_time_idx" ON "audit_integrity_check"("started_at" DESC);

CREATE TABLE "notification" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "notification_type" VARCHAR(40) NOT NULL,
  "title" VARCHAR(300) NOT NULL,
  "payload" JSONB NOT NULL DEFAULT '{}',
  "link_key" VARCHAR(40) NOT NULL,
  "scope_org_unit_id" UUID REFERENCES "org_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "dedupe_key" VARCHAR(200),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notification_dedupe_key" UNIQUE ("dedupe_key")
);
CREATE INDEX "notification_time_idx" ON "notification"("created_at" DESC);

CREATE TABLE "notification_recipient" (
  "notification_id" UUID NOT NULL REFERENCES "notification"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "user_account_id" UUID NOT NULL REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "read_at" TIMESTAMPTZ(3),
  CONSTRAINT "notification_recipient_pkey" PRIMARY KEY ("notification_id", "user_account_id")
);
CREATE INDEX "notification_recipient_inbox_idx" ON "notification_recipient"("user_account_id", "read_at");

INSERT INTO legal_parameter(id,param_code,scope_key,subject_type,application_basis,value,unit,effective_from,document_effective_date,legal_basis)
SELECT gen_random_uuid(),'PARAMETER_EXPIRY_WARNING_DAYS','GLOBAL','ALL','WORK_DATE','"30"'::jsonb,'day','2026-01-01','2026-01-01','Số ngày cảnh báo tham số sắp hết hiệu lực chưa có bản kế tiếp; tài liệu 05 FR-1.3.3 — SIMULATION'
WHERE NOT EXISTS (SELECT 1 FROM legal_parameter WHERE param_code = 'PARAMETER_EXPIRY_WARNING_DAYS' AND scope_key = 'GLOBAL');

UPDATE "role" SET "function_permissions" = ARRAY(SELECT DISTINCT unnest("function_permissions" || ARRAY['audit.read']) ORDER BY 1) WHERE "code" = 'AD';
