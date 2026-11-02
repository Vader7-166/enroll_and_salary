-- CreateEnum
CREATE TYPE "ShiftKind" AS ENUM ('ADMINISTRATIVE', 'DAY', 'NIGHT');

-- CreateEnum
CREATE TYPE "ShiftPlanStatus" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'RETURNED', 'CANCELLED');

-- CreateTable
CREATE TABLE "shift_definition" (
    "id" UUID NOT NULL,
    "org_unit_id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "kind" "ShiftKind" NOT NULL,
    "start_time" VARCHAR(5) NOT NULL,
    "end_time" VARCHAR(5) NOT NULL,
    "crosses_midnight" BOOLEAN NOT NULL,
    "break_start_offset" INTEGER NOT NULL,
    "break_minutes" INTEGER NOT NULL,
    "paid_break" BOOLEAN NOT NULL,
    "work_minutes" INTEGER NOT NULL,
    "is_night_shift" BOOLEAN NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shift_definition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift_plan" (
    "id" UUID NOT NULL,
    "team_org_unit_id" UUID NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "status" "ShiftPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "shift_plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift_schedule" (
    "id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "work_date" DATE NOT NULL,
    "shift_id" UUID NOT NULL,
    "start_at" TIMESTAMPTZ(3) NOT NULL,
    "end_at" TIMESTAMPTZ(3) NOT NULL,
    "work_minutes" INTEGER NOT NULL,

    CONSTRAINT "shift_schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift_plan_history" (
    "id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "action" VARCHAR(24) NOT NULL,
    "from_status" "ShiftPlanStatus",
    "to_status" "ShiftPlanStatus" NOT NULL,
    "revision" INTEGER NOT NULL,
    "reason" VARCHAR(2000),
    "snapshot" JSONB NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shift_plan_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shift_definition_org_unit_id_code_key" ON "shift_definition"("org_unit_id", "code");

-- CreateIndex
CREATE INDEX "shift_plan_team_org_unit_id_status_idx" ON "shift_plan"("team_org_unit_id", "status");

-- CreateIndex
CREATE INDEX "shift_schedule_employee_id_work_date_idx" ON "shift_schedule"("employee_id", "work_date");

-- CreateIndex
CREATE UNIQUE INDEX "shift_schedule_plan_id_employee_id_work_date_key" ON "shift_schedule"("plan_id", "employee_id", "work_date");

-- CreateIndex
CREATE UNIQUE INDEX "shift_plan_history_plan_id_revision_key" ON "shift_plan_history"("plan_id", "revision");

-- AddForeignKey
ALTER TABLE "shift_definition" ADD CONSTRAINT "shift_definition_org_unit_id_fkey" FOREIGN KEY ("org_unit_id") REFERENCES "org_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_plan" ADD CONSTRAINT "shift_plan_team_org_unit_id_fkey" FOREIGN KEY ("team_org_unit_id") REFERENCES "org_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_plan" ADD CONSTRAINT "shift_plan_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_schedule" ADD CONSTRAINT "shift_schedule_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "shift_plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_schedule" ADD CONSTRAINT "shift_schedule_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_schedule" ADD CONSTRAINT "shift_schedule_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shift_definition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_plan_history" ADD CONSTRAINT "shift_plan_history_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "shift_plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_plan_history" ADD CONSTRAINT "shift_plan_history_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE shift_definition ADD CONSTRAINT shift_definition_work CHECK (work_minutes > 0 AND work_minutes <= 480 AND break_minutes >= 0 AND break_start_offset >= 0);
ALTER TABLE shift_schedule ADD CONSTRAINT shift_schedule_interval CHECK (end_at > start_at AND end_at <= start_at + interval '24 hours' AND work_minutes > 0 AND work_minutes <= 480);
CREATE TRIGGER shift_history_no_update_delete BEFORE UPDATE OR DELETE ON shift_plan_history FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
CREATE TRIGGER shift_history_no_truncate BEFORE TRUNCATE ON shift_plan_history FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_mutation();
REVOKE UPDATE, DELETE, TRUNCATE ON shift_plan_history FROM PUBLIC;

UPDATE role SET function_permissions = ARRAY(SELECT DISTINCT unnest(function_permissions || CASE code::text
 WHEN 'TT' THEN ARRAY['shift.read','shift.plan'] WHEN 'QD' THEN ARRAY['shift.read','shift.approve']
 WHEN 'KT' THEN ARRAY['shift.read'] WHEN 'AD' THEN ARRAY['shift.read','shift.manage'] ELSE ARRAY[]::text[] END));
INSERT INTO legal_parameter (id,param_code,scope_key,subject_type,application_basis,value,unit,effective_from,document_effective_date,legal_basis)
SELECT gen_random_uuid(), code, 'GLOBAL', 'ALL', 'WORK_DATE', to_jsonb(amount), 'minute', '2026-01-01', '2026-01-01', basis
FROM (VALUES
 ('SHIFT_MAX_DAILY_MINUTES','480','BLLĐ 2019 Điều 105; BR-11: 8 giờ/ngày'),
 ('SHIFT_MAX_WEEKLY_MINUTES','2880','BLLĐ 2019 Điều 105; BR-11: 48 giờ/tuần; tuần thứ Hai–Chủ nhật theo ngày bắt đầu ca'),
 ('SHIFT_MIN_REST_MINUTES','720','BLLĐ 2019 Điều 110: nghỉ chuyển ca ít nhất 12 giờ'),
 ('SHIFT_MIN_DAY_BREAK_MINUTES','30','BLLĐ 2019 Điều 109: nghỉ giữa giờ ít nhất 30 phút khi làm từ 6 giờ'),
 ('SHIFT_MIN_NIGHT_BREAK_MINUTES','45','BLLĐ 2019 Điều 109: làm ban đêm, nghỉ giữa giờ ít nhất 45 phút khi làm từ 6 giờ')
) AS p(code,amount,basis);
