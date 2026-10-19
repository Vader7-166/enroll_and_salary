ALTER TABLE "leave_request" DROP CONSTRAINT "leave_request_status_check";
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_status_check"
  CHECK (status IN ('DRAFT', 'PENDING', 'RETURNED', 'APPROVED', 'REJECTED', 'CANCELLED'));
ALTER TABLE "leave_request_history"
  ADD COLUMN "from_status" VARCHAR(24),
  ADD COLUMN "reason" VARCHAR(2000);
