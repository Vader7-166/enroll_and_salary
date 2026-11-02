CREATE TABLE "leave_request" (
 "id" UUID PRIMARY KEY, "employee_id" UUID NOT NULL REFERENCES "employee"("id"),
 "leave_type_id" UUID NOT NULL REFERENCES "leave_type"("id"), "created_by_id" UUID NOT NULL REFERENCES "user_account"("id"),
 "status" VARCHAR(24) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PENDING')),
 "revision" INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
 "date_from" DATE NOT NULL, "date_to" DATE NOT NULL CHECK (date_to >= date_from),
 "unit" VARCHAR(12) NOT NULL CHECK (unit IN ('DAY','HALF','HOUR')), "half" VARCHAR(12),
 "start_at" TIMESTAMPTZ(3), "end_at" TIMESTAMPTZ(3), "reason" VARCHAR(2000) NOT NULL,
 "document_reference" VARCHAR(500), "snapshot" JSONB NOT NULL, "submitted_at" TIMESTAMPTZ(3),
 "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ(3) NOT NULL,
 CHECK ((unit='DAY' AND half IS NULL AND start_at IS NULL AND end_at IS NULL) OR
 (unit='HALF' AND half IN ('FIRST','SECOND') AND date_from=date_to AND start_at IS NULL AND end_at IS NULL) OR
 (unit='HOUR' AND half IS NULL AND date_from=date_to AND start_at IS NOT NULL AND end_at > start_at))
);
CREATE INDEX "leave_request_employee_id_date_from_date_to_idx" ON "leave_request"("employee_id","date_from","date_to");
CREATE TABLE "leave_request_history" (
 "id" UUID PRIMARY KEY, "request_id" UUID NOT NULL REFERENCES "leave_request"("id"),
 "actor_id" UUID NOT NULL REFERENCES "user_account"("id"), "action" VARCHAR(24) NOT NULL,
 "revision" INTEGER NOT NULL, "snapshot" JSONB NOT NULL,
 "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("request_id","revision")
);
CREATE FUNCTION leave_request_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Leave request history is immutable'; END; $$;
CREATE TRIGGER leave_request_history_immutable BEFORE UPDATE OR DELETE ON "leave_request_history"
FOR EACH ROW EXECUTE FUNCTION leave_request_history_immutable();
UPDATE "role" SET "function_permissions"=array_append("function_permissions",'leave.request')
WHERE code='TT' AND NOT ('leave.request'=ANY("function_permissions"));
