CREATE EXTENSION IF NOT EXISTS "btree_gist";
CREATE TYPE "IdentityDocumentType" AS ENUM ('CCCD', 'PASSPORT');
CREATE TYPE "TaxResidency" AS ENUM ('RESIDENT', 'NON_RESIDENT');
CREATE TYPE "EmployeeSpecialStatusType" AS ENUM ('FOREIGN_WORKER', 'PENSIONER', 'MINOR', 'FEMALE', 'VOCATIONAL_TRAINED');

CREATE TABLE "bank" (
  "code" VARCHAR(20) NOT NULL CHECK ("code" ~ '^[A-Z0-9]{2,20}$'),
  "name" VARCHAR(200) NOT NULL CHECK (btrim("name") <> ''),
  "short_name" VARCHAR(60) NOT NULL CHECK (btrim("short_name") <> ''),
  "active" BOOLEAN NOT NULL DEFAULT true,
  "status" "PolicyStatus" NOT NULL,
  CONSTRAINT "bank_pkey" PRIMARY KEY ("code")
);
INSERT INTO "bank" ("code", "name", "short_name", "status") VALUES
 ('VCB', 'Ngân hàng TMCP Ngoại thương Việt Nam', 'Vietcombank', 'SIMULATION'),
 ('BIDV', 'Ngân hàng TMCP Đầu tư và Phát triển Việt Nam', 'BIDV', 'SIMULATION'),
 ('CTG', 'Ngân hàng TMCP Công Thương Việt Nam', 'VietinBank', 'SIMULATION'),
 ('AGR', 'Ngân hàng Nông nghiệp và Phát triển Nông thôn Việt Nam', 'Agribank', 'SIMULATION'),
 ('TCB', 'Ngân hàng TMCP Kỹ Thương Việt Nam', 'Techcombank', 'SIMULATION'),
 ('MB', 'Ngân hàng TMCP Quân đội', 'MB', 'SIMULATION'),
 ('ACB', 'Ngân hàng TMCP Á Châu', 'ACB', 'SIMULATION'),
 ('VPB', 'Ngân hàng TMCP Việt Nam Thịnh Vượng', 'VPBank', 'SIMULATION');

-- Current identity per employee; identifiers are AES-GCM ciphertext plus a keyed blind index for duplicate checks.
CREATE TABLE "employee_identity" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "employee_id" UUID NOT NULL REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "document_type" "IdentityDocumentType" NOT NULL,
  "id_number_cipher" TEXT NOT NULL,
  "id_number_hash" VARCHAR(80) NOT NULL,
  "id_issue_date" DATE,
  "id_issue_place" VARCHAR(200),
  "tax_code_cipher" TEXT,
  "tax_code_hash" VARCHAR(80),
  "si_book_cipher" TEXT,
  "si_book_hash" VARCHAR(80),
  "emergency_contact_name" VARCHAR(120),
  "emergency_contact_phone" VARCHAR(30),
  "emergency_contact_relation" VARCHAR(60),
  "document_reference" VARCHAR(500),
  "data_status" "PolicyStatus" NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" >= 1),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by_id" UUID REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "employee_identity_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "employee_identity_employee_id_key" UNIQUE ("employee_id"),
  CONSTRAINT "employee_identity_id_number_hash_key" UNIQUE ("id_number_hash"),
  CONSTRAINT "employee_identity_tax_code_hash_key" UNIQUE ("tax_code_hash"),
  CONSTRAINT "employee_identity_si_book_hash_key" UNIQUE ("si_book_hash"),
  CONSTRAINT "employee_identity_tax_pair" CHECK (("tax_code_cipher" IS NULL) = ("tax_code_hash" IS NULL)),
  CONSTRAINT "employee_identity_si_pair" CHECK (("si_book_cipher" IS NULL) = ("si_book_hash" IS NULL))
);
CREATE FUNCTION employee_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN RAISE EXCEPTION 'Employee identity cannot be deleted or truncated'; END IF;
  IF NEW.employee_id <> OLD.employee_id OR NEW.revision <> OLD.revision + 1 THEN RAISE EXCEPTION 'Employee identity update must keep the employee and advance the revision'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER employee_identity_guard BEFORE UPDATE OR DELETE ON "employee_identity" FOR EACH ROW EXECUTE FUNCTION employee_identity_guard();
CREATE TRIGGER employee_identity_no_truncate BEFORE TRUNCATE ON "employee_identity" FOR EACH STATEMENT EXECUTE FUNCTION employee_identity_guard();

CREATE TABLE "employee_identity_history" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "employee_id" UUID NOT NULL REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "revision" INTEGER NOT NULL,
  "snapshot" JSONB NOT NULL,
  "reason" VARCHAR(2000) NOT NULL CHECK (btrim("reason") <> ''),
  "actor_id" UUID REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "employee_identity_history_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "employee_identity_history_employee_id_revision_key" UNIQUE ("employee_id", "revision")
);

CREATE TABLE "employee_bank_account" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "employee_id" UUID NOT NULL REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "bank_code" VARCHAR(20) NOT NULL REFERENCES "bank"("code") ON DELETE RESTRICT ON UPDATE CASCADE,
  "account_number_cipher" TEXT NOT NULL,
  "account_number_hash" VARCHAR(80) NOT NULL,
  "account_holder" VARCHAR(120) NOT NULL CHECK (btrim("account_holder") <> ''),
  "branch" VARCHAR(150),
  "reason" VARCHAR(2000) NOT NULL CHECK (btrim("reason") <> ''),
  "data_status" "PolicyStatus" NOT NULL,
  "effective_from" DATE NOT NULL,
  "effective_to" DATE,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by_id" UUID REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "employee_bank_account_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "employee_bank_account_range_check" CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from"),
  CONSTRAINT "employee_bank_account_no_overlap" EXCLUDE USING gist ("employee_id" WITH =, daterange("effective_from", COALESCE("effective_to", 'infinity'::date), '[]') WITH &&)
);
CREATE INDEX "employee_bank_account_employee_id_effective_from_idx" ON "employee_bank_account"("employee_id", "effective_from");

CREATE TABLE "tax_profile" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "employee_id" UUID NOT NULL REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "residency" "TaxResidency" NOT NULL,
  "commitment_reference" VARCHAR(500),
  "commitment_template_version" VARCHAR(80),
  "finalization_authorized" BOOLEAN NOT NULL DEFAULT false,
  "reason" VARCHAR(2000) NOT NULL CHECK (btrim("reason") <> ''),
  "data_status" "PolicyStatus" NOT NULL,
  "effective_from" DATE NOT NULL,
  "effective_to" DATE,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by_id" UUID REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "tax_profile_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tax_profile_range_check" CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from"),
  CONSTRAINT "tax_profile_commitment_pair" CHECK (("commitment_reference" IS NULL) = ("commitment_template_version" IS NULL)),
  CONSTRAINT "tax_profile_no_overlap" EXCLUDE USING gist ("employee_id" WITH =, daterange("effective_from", COALESCE("effective_to", 'infinity'::date), '[]') WITH &&)
);
CREATE INDEX "tax_profile_employee_id_effective_from_idx" ON "tax_profile"("employee_id", "effective_from");

CREATE TABLE "employee_special_status" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "employee_id" UUID NOT NULL REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "status_type" "EmployeeSpecialStatusType" NOT NULL,
  "work_permit_number" VARCHAR(80),
  "permit_expiry" DATE,
  "reference" VARCHAR(500) NOT NULL CHECK (btrim("reference") <> ''),
  "reason" VARCHAR(2000) NOT NULL CHECK (btrim("reason") <> ''),
  "data_status" "PolicyStatus" NOT NULL,
  "effective_from" DATE NOT NULL,
  "effective_to" DATE,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by_id" UUID REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "employee_special_status_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "employee_special_status_range_check" CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from"),
  CONSTRAINT "employee_special_status_permit" CHECK ("status_type" <> 'FOREIGN_WORKER' OR "work_permit_number" IS NOT NULL),
  CONSTRAINT "employee_special_status_no_overlap" EXCLUDE USING gist ("employee_id" WITH =, "status_type" WITH =, daterange("effective_from", COALESCE("effective_to", 'infinity'::date), '[]') WITH &&)
);
CREATE INDEX "employee_special_status_employee_id_effective_from_idx" ON "employee_special_status"("employee_id", "effective_from");

-- Dated history: rows are never deleted; the only update is closing an open row for a successor.
CREATE FUNCTION payroll_profile_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN RAISE EXCEPTION 'Payroll profile history is immutable'; END IF;
  IF (to_jsonb(NEW) - 'effective_to') IS DISTINCT FROM (to_jsonb(OLD) - 'effective_to') OR OLD.effective_to IS NOT NULL OR NEW.effective_to IS NULL
  THEN RAISE EXCEPTION 'Payroll profile history is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER employee_bank_account_guard BEFORE UPDATE OR DELETE ON "employee_bank_account" FOR EACH ROW EXECUTE FUNCTION payroll_profile_history_guard();
CREATE TRIGGER employee_bank_account_no_truncate BEFORE TRUNCATE ON "employee_bank_account" FOR EACH STATEMENT EXECUTE FUNCTION payroll_profile_history_guard();
CREATE TRIGGER tax_profile_guard BEFORE UPDATE OR DELETE ON "tax_profile" FOR EACH ROW EXECUTE FUNCTION payroll_profile_history_guard();
CREATE TRIGGER tax_profile_no_truncate BEFORE TRUNCATE ON "tax_profile" FOR EACH STATEMENT EXECUTE FUNCTION payroll_profile_history_guard();
CREATE TRIGGER employee_special_status_guard BEFORE UPDATE OR DELETE ON "employee_special_status" FOR EACH ROW EXECUTE FUNCTION payroll_profile_history_guard();
CREATE TRIGGER employee_special_status_no_truncate BEFORE TRUNCATE ON "employee_special_status" FOR EACH STATEMENT EXECUTE FUNCTION payroll_profile_history_guard();

CREATE TABLE "employee_dependent" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "employee_id" UUID NOT NULL REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "dependent_key" UUID NOT NULL,
  "version" INTEGER NOT NULL CHECK ("version" >= 1),
  "full_name" VARCHAR(120) NOT NULL CHECK (btrim("full_name") <> ''),
  "relationship" VARCHAR(40) NOT NULL CHECK (btrim("relationship") <> ''),
  "tax_code_cipher" TEXT,
  "birth_date" DATE,
  "deduction_from_month" CHAR(7) NOT NULL CHECK ("deduction_from_month" ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  "deduction_to_month" CHAR(7) CHECK ("deduction_to_month" ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  "evidence_reference" VARCHAR(500) NOT NULL CHECK (btrim("evidence_reference") <> ''),
  "reason" VARCHAR(2000) NOT NULL CHECK (btrim("reason") <> ''),
  "data_status" "PolicyStatus" NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by_id" UUID REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "employee_dependent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "employee_dependent_dependent_key_version_key" UNIQUE ("dependent_key", "version"),
  CONSTRAINT "employee_dependent_months_check" CHECK ("deduction_to_month" IS NULL OR "deduction_to_month" >= "deduction_from_month")
);
CREATE INDEX "employee_dependent_employee_id_idx" ON "employee_dependent"("employee_id", "dependent_key", "version");
CREATE FUNCTION employee_dependent_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE latest INTEGER; owner UUID;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Dependent history is immutable; add a new version'; END IF;
  SELECT max("version"), min("employee_id"::text)::uuid INTO latest, owner FROM "employee_dependent" WHERE "dependent_key" = NEW.dependent_key;
  IF NEW.version <> COALESCE(latest, 0) + 1 OR (owner IS NOT NULL AND owner <> NEW.employee_id) THEN RAISE EXCEPTION 'Dependent version must follow the latest version of the same employee'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER employee_dependent_guard BEFORE INSERT OR UPDATE OR DELETE ON "employee_dependent" FOR EACH ROW EXECUTE FUNCTION employee_dependent_guard();
CREATE TRIGGER employee_dependent_no_truncate BEFORE TRUNCATE ON "employee_dependent" FOR EACH STATEMENT EXECUTE FUNCTION employee_dependent_guard();

CREATE FUNCTION employee_identity_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Employee identity history is immutable'; END $$;
CREATE TRIGGER employee_identity_history_guard BEFORE UPDATE OR DELETE ON "employee_identity_history" FOR EACH ROW EXECUTE FUNCTION employee_identity_history_guard();
CREATE TRIGGER employee_identity_history_no_truncate BEFORE TRUNCATE ON "employee_identity_history" FOR EACH STATEMENT EXECUTE FUNCTION employee_identity_history_guard();

UPDATE "role" SET "function_permissions" = ARRAY(SELECT DISTINCT unnest("function_permissions" || ARRAY['payroll.profile.read', 'payroll.profile.manage', 'employee.sensitive.read']) ORDER BY 1) WHERE "code" = 'KT';
UPDATE "role" SET "function_permissions" = ARRAY(SELECT DISTINCT unnest("function_permissions" || ARRAY['payroll.profile.read']) ORDER BY 1) WHERE "code" = 'AD';
