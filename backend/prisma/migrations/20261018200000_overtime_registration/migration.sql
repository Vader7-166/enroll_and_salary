CREATE TYPE "OvertimeStatus" AS ENUM ('DRAFT','PENDING','APPROVED','RETURNED','REJECTED','CANCELLED');
CREATE TABLE overtime_request (
 id UUID PRIMARY KEY, team_org_unit_id UUID NOT NULL REFERENCES org_unit(id), title VARCHAR(160) NOT NULL,
 work_date DATE NOT NULL, start_at TIMESTAMPTZ(3) NOT NULL, end_at TIMESTAMPTZ(3) NOT NULL,
 requested_minutes INTEGER NOT NULL, reason VARCHAR(2000) NOT NULL, status "OvertimeStatus" NOT NULL DEFAULT 'DRAFT',
 revision INTEGER NOT NULL DEFAULT 0, created_by_id UUID NOT NULL REFERENCES user_account(id),
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ(3) NOT NULL,
 CONSTRAINT overtime_interval CHECK (end_at > start_at AND end_at <= start_at + interval '12 hours'
   AND requested_minutes > 0 AND requested_minutes = extract(epoch FROM end_at-start_at)/60
   AND date_trunc('minute',start_at)=start_at AND date_trunc('minute',end_at)=end_at
   AND (start_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date BETWEEN work_date AND work_date+1),
 CONSTRAINT overtime_text CHECK (length(trim(title))>0 AND length(trim(reason))>0 AND revision>=0)
);
CREATE TABLE overtime_member (
 id UUID PRIMARY KEY, request_id UUID NOT NULL REFERENCES overtime_request(id), employee_id UUID NOT NULL REFERENCES employee(id),
 consent_reference VARCHAR(500) NOT NULL CHECK (length(trim(consent_reference))>0)
);
CREATE TABLE overtime_history (
 id UUID PRIMARY KEY, request_id UUID NOT NULL REFERENCES overtime_request(id), actor_id UUID NOT NULL REFERENCES user_account(id),
 action VARCHAR(24) NOT NULL, from_status "OvertimeStatus", to_status "OvertimeStatus" NOT NULL, revision INTEGER NOT NULL,
 reason VARCHAR(2000), snapshot JSONB NOT NULL, occurred_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX overtime_request_team_org_unit_id_work_date_status_idx ON overtime_request(team_org_unit_id,work_date,status);
CREATE INDEX overtime_request_start_at_end_at_idx ON overtime_request(start_at,end_at);
CREATE INDEX overtime_member_employee_id_idx ON overtime_member(employee_id);
CREATE UNIQUE INDEX overtime_member_request_id_employee_id_key ON overtime_member(request_id,employee_id);
CREATE UNIQUE INDEX overtime_history_request_id_revision_key ON overtime_history(request_id,revision);
CREATE TRIGGER overtime_history_no_update_delete BEFORE UPDATE OR DELETE ON overtime_history FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
CREATE TRIGGER overtime_history_no_truncate BEFORE TRUNCATE ON overtime_history FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_mutation();
REVOKE UPDATE,DELETE,TRUNCATE ON overtime_history FROM PUBLIC;
UPDATE role SET function_permissions=ARRAY(SELECT DISTINCT unnest(function_permissions || CASE code::text
 WHEN 'TT' THEN ARRAY['overtime.read','overtime.plan'] WHEN 'QD' THEN ARRAY['overtime.read','overtime.approve']
 WHEN 'KT' THEN ARRAY['overtime.read'] ELSE ARRAY[]::text[] END));
INSERT INTO legal_parameter(id,param_code,scope_key,subject_type,application_basis,value,unit,effective_from,document_effective_date,legal_basis)
SELECT gen_random_uuid(),code,'GLOBAL','ALL','WORK_DATE',to_jsonb(amount),unit,'2026-01-01','2026-01-01',basis FROM (VALUES
 ('OT_DAILY_MAX_RATIO','0.5','ratio','BR-27; BLLĐ 2019 Điều 107: tối đa 50% giờ bình thường/ngày'),
 ('OT_MONTH_MAX_MINUTES','2400','minute','BR-27: tối đa 40 giờ/tháng'),
 ('OT_YEAR_MAX_MINUTES','12000','minute','BR-27: 200 giờ/năm; 300 chỉ khi có căn cứ thông báo hợp lệ')
) AS p(code,amount,unit,basis);
