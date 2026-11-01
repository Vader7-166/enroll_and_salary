-- Sickness/maternity benefits paid by the social insurance fund (FR-6.4.1; BR-35) and workshop absence rate (FR-6.5.1; UAT-25).
-- Records are KT tracking with an estimate; nothing here is filed with the insurance agency or paid by the company.

CREATE TYPE "SiBenefitType" AS ENUM ('SICK', 'CHILD_SICK', 'MATERNITY', 'PRENATAL', 'RECOVERY');

CREATE TABLE "sickness_maternity_record" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "employee_id" UUID NOT NULL REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "benefit_type" "SiBenefitType" NOT NULL,
  "leave_request_id" UUID REFERENCES "leave_request"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "document_number" VARCHAR(80) NOT NULL,
  "facility" VARCHAR(200) NOT NULL,
  "date_from" DATE NOT NULL,
  "date_to" DATE NOT NULL,
  "external_contribution_months" INTEGER NOT NULL DEFAULT 0 CHECK ("external_contribution_months" >= 0),
  "external_evidence" VARCHAR(500),
  "evidence_file_name" VARCHAR(255) NOT NULL,
  "evidence_content_type" VARCHAR(100) NOT NULL,
  "evidence_size" INTEGER NOT NULL,
  "evidence_sha256" CHAR(64) NOT NULL,
  "evidence_cipher" TEXT NOT NULL,
  "benefit_days" DECIMAL(8,2),
  "estimate_cipher" TEXT NOT NULL,
  "estimate_status" VARCHAR(20) NOT NULL CHECK ("estimate_status" IN ('ESTIMATED', 'NOT_ELIGIBLE', 'INSUFFICIENT_DATA')),
  "paid_amount_cipher" TEXT,
  "paid_date" DATE,
  "paid_reference" VARCHAR(200),
  "revision" INTEGER NOT NULL DEFAULT 1,
  "created_by_id" UUID NOT NULL REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "paid_recorded_by_id" UUID REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "sickness_maternity_record_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sickness_maternity_record_range" CHECK ("date_to" >= "date_from"),
  CONSTRAINT "sickness_maternity_record_external" CHECK ("external_contribution_months" = 0 OR "external_evidence" IS NOT NULL),
  CONSTRAINT "sickness_maternity_record_paid" CHECK (("paid_amount_cipher" IS NULL) = ("paid_date" IS NULL)),
  CONSTRAINT "sickness_maternity_record_no_overlap" EXCLUDE USING gist ("employee_id" WITH =, daterange("date_from", "date_to", '[]') WITH &&)
);

-- Only the actual-payment fields may be filled in later; the document and estimate never change.
CREATE FUNCTION sickness_maternity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'SI_BENEFIT_RECORD_IMMUTABLE'; END IF;
  IF (to_jsonb(NEW) - 'paid_amount_cipher' - 'paid_date' - 'paid_reference' - 'paid_recorded_by_id' - 'revision')
     <> (to_jsonb(OLD) - 'paid_amount_cipher' - 'paid_date' - 'paid_reference' - 'paid_recorded_by_id' - 'revision') THEN
    RAISE EXCEPTION 'SI_BENEFIT_RECORD_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER sickness_maternity_guard BEFORE UPDATE OR DELETE ON "sickness_maternity_record" FOR EACH ROW EXECUTE FUNCTION sickness_maternity_guard();

INSERT INTO legal_parameter(id,param_code,scope_key,subject_type,application_basis,value,unit,effective_from,document_effective_date,legal_basis)
SELECT gen_random_uuid(),code,'GLOBAL','ALL','WORK_DATE',amount,unit,'2025-07-01','2025-07-01',basis FROM (VALUES
 ('SICKNESS_BENEFIT_RATE','"0.75"'::jsonb,'ratio','Mức hưởng ốm đau 75% tiền lương đóng BHXH tháng liền kề; Luật BHXH 2024 — SIMULATION'),
 ('MATERNITY_BENEFIT_RATE','"1"'::jsonb,'ratio','Mức hưởng thai sản 100% bình quân tiền lương đóng BHXH 6 tháng liền kề; Luật BHXH 2024 — SIMULATION'),
 ('SI_BENEFIT_STANDARD_DAYS','"24"'::jsonb,'day','Mức hưởng một ngày = mức hưởng tháng chia 24 ngày (chế độ tính theo ngày làm việc) — SIMULATION'),
 ('SICKNESS_DAYS_BY_SERVICE','[{"fromYears":0,"days":30},{"fromYears":15,"days":40},{"fromYears":30,"days":60}]'::jsonb,'day/year','Số ngày hưởng ốm đau tối đa/năm theo thời gian đóng BHXH (điều kiện bình thường); Luật BHXH 2024 — SIMULATION, chờ xác nhận'),
 ('CHILD_SICK_DAYS_PER_YEAR','"20"'::jsonb,'day/year','Nghỉ chăm con ốm dưới 3 tuổi tối đa 20 ngày làm việc/năm — SIMULATION'),
 ('PRENATAL_DAYS_PER_YEAR','"5"'::jsonb,'day/year','Nghỉ khám thai tối đa 5 lần × 1 ngày — SIMULATION'),
 ('RECOVERY_DAYS_PER_YEAR','"5"'::jsonb,'day/year','Nghỉ dưỡng sức phục hồi sức khỏe tối đa 5 ngày — SIMULATION'),
 ('MATERNITY_DAYS','"180"'::jsonb,'day','Nghỉ sinh con 6 tháng (ngày lịch) — SIMULATION'),
 ('MATERNITY_MIN_CONTRIBUTION_MONTHS','"6"'::jsonb,'month','Đủ 6 tháng đóng BHXH trong 12 tháng trước khi sinh — SIMULATION'),
 ('ABSENCE_RATE_WARNING_THRESHOLD','"0.1"'::jsonb,'ratio','Ngưỡng cảnh báo tỷ lệ vắng mặt theo tổ/ngày; tài liệu 05 FR-6.5.1 — SIMULATION')
) AS p(code,amount,unit,basis)
WHERE NOT EXISTS (SELECT 1 FROM legal_parameter existing WHERE existing.param_code = p.code AND existing.scope_key = 'GLOBAL');
