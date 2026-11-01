-- Shift rotation patterns (FR-3.1.3, 3.2.1) and post-approval shift swaps (FR-3.3.1, 3.4.2; 06 §3.4 case 6).

CREATE TYPE "ShiftSwapStatus" AS ENUM ('PENDING', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED');

CREATE TABLE "shift_rotation_pattern" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "site_org_unit_id" UUID NOT NULL REFERENCES "org_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "code" VARCHAR(40) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "shift_rotation_pattern_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "shift_rotation_pattern_code_key" UNIQUE ("site_org_unit_id", "code")
);

CREATE TABLE "shift_rotation_pattern_version" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "pattern_id" UUID NOT NULL REFERENCES "shift_rotation_pattern"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "name" VARCHAR(160) NOT NULL,
  "cycle_days" INTEGER NOT NULL CHECK ("cycle_days" BETWEEN 1 AND 62),
  -- One entry per cycle day: a shift_definition id, or null for a rest day.
  "sequence" JSONB NOT NULL,
  "min_rest_minutes" INTEGER NOT NULL CHECK ("min_rest_minutes" BETWEEN 0 AND 2880),
  "effective_from" DATE NOT NULL,
  "effective_to" DATE,
  "created_by_id" UUID NOT NULL REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "shift_rotation_pattern_version_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "shift_rotation_pattern_version_range" CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from"),
  CONSTRAINT "shift_rotation_pattern_version_length" CHECK (jsonb_typeof("sequence") = 'array' AND jsonb_array_length("sequence") = "cycle_days"),
  CONSTRAINT "shift_rotation_pattern_version_no_overlap" EXCLUDE USING gist ("pattern_id" WITH =, daterange("effective_from", "effective_to", '[]') WITH &&)
);

CREATE FUNCTION shift_rotation_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ROTATION_VERSION_IMMUTABLE'; END IF;
  IF OLD.effective_to IS NULL AND NEW.effective_to IS NOT NULL AND (to_jsonb(NEW) - 'effective_to') = (to_jsonb(OLD) - 'effective_to') THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'ROTATION_VERSION_IMMUTABLE';
END;
$$;
CREATE TRIGGER shift_rotation_version_guard BEFORE UPDATE OR DELETE ON "shift_rotation_pattern_version" FOR EACH ROW EXECUTE FUNCTION shift_rotation_version_guard();

-- A swap is its own object: the approved schedule keeps driving attendance until a QĐ approves the swap.
CREATE TABLE "shift_swap_request" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "schedule_id" UUID NOT NULL REFERENCES "shift_schedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "plan_id" UUID NOT NULL REFERENCES "shift_plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "team_org_unit_id" UUID NOT NULL REFERENCES "org_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "employee_id" UUID NOT NULL REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "work_date" DATE NOT NULL,
  "old_shift_id" UUID NOT NULL REFERENCES "shift_definition"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "new_shift_id" UUID NOT NULL REFERENCES "shift_definition"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "reason" VARCHAR(2000) NOT NULL,
  "status" "ShiftSwapStatus" NOT NULL DEFAULT 'PENDING',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "created_by_id" UUID NOT NULL REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decided_by_id" UUID REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "decided_at" TIMESTAMPTZ(3),
  "decision_reason" VARCHAR(2000),
  CONSTRAINT "shift_swap_request_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "shift_swap_request_distinct" CHECK ("old_shift_id" <> "new_shift_id")
);
CREATE UNIQUE INDEX "shift_swap_request_pending_key" ON "shift_swap_request"("schedule_id") WHERE "status" = 'PENDING';
CREATE INDEX "shift_swap_request_team_idx" ON "shift_swap_request"("team_org_unit_id", "status", "work_date");

CREATE TABLE "shift_swap_history" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "swap_id" UUID NOT NULL REFERENCES "shift_swap_request"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "action" VARCHAR(24) NOT NULL,
  "from_status" "ShiftSwapStatus",
  "to_status" "ShiftSwapStatus" NOT NULL,
  "actor_id" UUID NOT NULL REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "reason" VARCHAR(2000),
  "snapshot" JSONB NOT NULL,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "shift_swap_history_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "shift_swap_history_swap_idx" ON "shift_swap_history"("swap_id", "occurred_at");

CREATE FUNCTION shift_swap_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'SHIFT_SWAP_HISTORY_IMMUTABLE'; END; $$;
CREATE TRIGGER shift_swap_history_guard BEFORE UPDATE OR DELETE ON "shift_swap_history" FOR EACH ROW EXECUTE FUNCTION shift_swap_history_immutable();
