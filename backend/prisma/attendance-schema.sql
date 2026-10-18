-- CreateTable
CREATE TABLE "attendance_import_profile" (
    "id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "mapping" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_import_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_import" (
    "id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "reference_period_id" UUID NOT NULL,
    "profile_id" UUID,
    "file_name" VARCHAR(255) NOT NULL,
    "file_hash" CHAR(64) NOT NULL,
    "mapping" JSONB NOT NULL,
    "status" VARCHAR(32) NOT NULL,
    "total_rows" INTEGER NOT NULL,
    "summary" JSONB NOT NULL,
    "errors" JSONB NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_import_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "raw_punch" (
    "id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "punched_at" TIMESTAMPTZ(3) NOT NULL,
    "device_code" VARCHAR(80) NOT NULL,
    "direction" VARCHAR(4) NOT NULL,
    "batch_id" UUID NOT NULL,
    "row_number" INTEGER NOT NULL,
    "source" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "raw_punch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "punch_processing" (
    "punch_id" UUID NOT NULL,
    "schedule_id" UUID,
    "period_id" UUID,
    "work_date" DATE,
    "state" VARCHAR(16) NOT NULL,
    "reason" VARCHAR(80),
    "processed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "punch_processing_pkey" PRIMARY KEY ("punch_id")
);

-- CreateTable
CREATE TABLE "daily_attendance" (
    "id" UUID NOT NULL,
    "schedule_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "org_unit_id" UUID NOT NULL,
    "period_id" UUID NOT NULL,
    "work_date" DATE NOT NULL,
    "check_in_id" UUID,
    "check_out_id" UUID,
    "status" VARCHAR(3) NOT NULL,
    "flags" TEXT[],
    "worked_minutes" DECIMAL(12,6) NOT NULL,
    "day_minutes" DECIMAL(12,6) NOT NULL,
    "night_minutes" DECIMAL(12,6) NOT NULL,
    "late_minutes" INTEGER NOT NULL,
    "early_minutes" INTEGER NOT NULL,
    "absent" BOOLEAN NOT NULL,
    "work_units" DECIMAL(10,6) NOT NULL,
    "segments" JSONB NOT NULL,
    "rules" JSONB NOT NULL,
    "processed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_attendance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "attendance_import_profile_site_id_name_key" ON "attendance_import_profile"("site_id", "name");

-- CreateIndex
CREATE INDEX "attendance_import_site_id_created_at_idx" ON "attendance_import"("site_id", "created_at");

-- CreateIndex
CREATE INDEX "raw_punch_site_id_punched_at_idx" ON "raw_punch"("site_id", "punched_at");

-- CreateIndex
CREATE INDEX "raw_punch_employee_id_punched_at_idx" ON "raw_punch"("employee_id", "punched_at");

-- CreateIndex
CREATE UNIQUE INDEX "raw_punch_site_id_device_code_employee_id_punched_at_key" ON "raw_punch"("site_id", "device_code", "employee_id", "punched_at");

-- CreateIndex
CREATE INDEX "punch_processing_period_id_state_idx" ON "punch_processing"("period_id", "state");

-- CreateIndex
CREATE UNIQUE INDEX "daily_attendance_schedule_id_key" ON "daily_attendance"("schedule_id");

-- CreateIndex
CREATE INDEX "daily_attendance_period_id_org_unit_id_work_date_idx" ON "daily_attendance"("period_id", "org_unit_id", "work_date");

-- CreateIndex
CREATE INDEX "daily_attendance_employee_id_work_date_idx" ON "daily_attendance"("employee_id", "work_date");

-- AddForeignKey
ALTER TABLE "attendance_import_profile" ADD CONSTRAINT "attendance_import_profile_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_import" ADD CONSTRAINT "attendance_import_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_import" ADD CONSTRAINT "attendance_import_reference_period_id_fkey" FOREIGN KEY ("reference_period_id") REFERENCES "business_period"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_import" ADD CONSTRAINT "attendance_import_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "attendance_import_profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_import" ADD CONSTRAINT "attendance_import_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_punch" ADD CONSTRAINT "raw_punch_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_punch" ADD CONSTRAINT "raw_punch_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_punch" ADD CONSTRAINT "raw_punch_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "attendance_import"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "punch_processing" ADD CONSTRAINT "punch_processing_punch_id_fkey" FOREIGN KEY ("punch_id") REFERENCES "raw_punch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "punch_processing" ADD CONSTRAINT "punch_processing_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "shift_schedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "punch_processing" ADD CONSTRAINT "punch_processing_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "business_period"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_attendance" ADD CONSTRAINT "daily_attendance_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "shift_schedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_attendance" ADD CONSTRAINT "daily_attendance_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_attendance" ADD CONSTRAINT "daily_attendance_org_unit_id_fkey" FOREIGN KEY ("org_unit_id") REFERENCES "org_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_attendance" ADD CONSTRAINT "daily_attendance_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "business_period"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_attendance" ADD CONSTRAINT "daily_attendance_check_in_id_fkey" FOREIGN KEY ("check_in_id") REFERENCES "raw_punch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_attendance" ADD CONSTRAINT "daily_attendance_check_out_id_fkey" FOREIGN KEY ("check_out_id") REFERENCES "raw_punch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
