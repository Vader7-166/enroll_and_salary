-- CreateEnum
CREATE TYPE "OvertimeStatus" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "overtime_request" (
    "id" UUID NOT NULL,
    "team_org_unit_id" UUID NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "work_date" DATE NOT NULL,
    "start_at" TIMESTAMPTZ(3) NOT NULL,
    "end_at" TIMESTAMPTZ(3) NOT NULL,
    "requested_minutes" INTEGER NOT NULL,
    "reason" VARCHAR(2000) NOT NULL,
    "status" "OvertimeStatus" NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "overtime_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "overtime_member" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "consent_reference" VARCHAR(500) NOT NULL,

    CONSTRAINT "overtime_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "overtime_history" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "action" VARCHAR(24) NOT NULL,
    "from_status" "OvertimeStatus",
    "to_status" "OvertimeStatus" NOT NULL,
    "revision" INTEGER NOT NULL,
    "reason" VARCHAR(2000),
    "snapshot" JSONB NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "overtime_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "overtime_request_team_org_unit_id_work_date_status_idx" ON "overtime_request"("team_org_unit_id", "work_date", "status");

-- CreateIndex
CREATE INDEX "overtime_request_start_at_end_at_idx" ON "overtime_request"("start_at", "end_at");

-- CreateIndex
CREATE INDEX "overtime_member_employee_id_idx" ON "overtime_member"("employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "overtime_member_request_id_employee_id_key" ON "overtime_member"("request_id", "employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "overtime_history_request_id_revision_key" ON "overtime_history"("request_id", "revision");

-- AddForeignKey
ALTER TABLE "overtime_request" ADD CONSTRAINT "overtime_request_team_org_unit_id_fkey" FOREIGN KEY ("team_org_unit_id") REFERENCES "org_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "overtime_request" ADD CONSTRAINT "overtime_request_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "overtime_member" ADD CONSTRAINT "overtime_member_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "overtime_request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "overtime_member" ADD CONSTRAINT "overtime_member_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "overtime_history" ADD CONSTRAINT "overtime_history_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "overtime_request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "overtime_history" ADD CONSTRAINT "overtime_history_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
