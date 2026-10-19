DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM leave_request WHERE status='APPROVED') THEN
  RAISE EXCEPTION 'Cancel approved legacy leave requests through the old API before deploying leave integration; no automatic retroactive debits are allowed';
 END IF;
END $$;
ALTER TABLE daily_attendance ADD COLUMN "leave" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE leave_request ADD COLUMN integration JSONB NOT NULL DEFAULT '{}';
ALTER TABLE leave_operation ADD COLUMN leave_request_id UUID REFERENCES leave_request(id);
CREATE INDEX leave_operation_leave_request_id_idx ON leave_operation(leave_request_id);
DO $$ DECLARE original text; BEGIN
 SELECT pg_get_expr(conbin,conrelid) INTO original FROM pg_constraint WHERE conrelid='leave_ledger_entry'::regclass AND conname='leave_ledger_entry_shape_check';
 ALTER TABLE leave_ledger_entry DROP CONSTRAINT leave_ledger_entry_shape_check;
 EXECUTE format('ALTER TABLE leave_ledger_entry ADD CONSTRAINT leave_ledger_entry_shape_check CHECK ((%s) OR (kind IN (''USE'',''REFUND'') AND ((kind=''USE'' AND days<0) OR (kind=''REFUND'' AND days>0)) AND ((bucket IN (''ANNUAL'',''ADVANCE'') AND expires_at IS NULL) OR (bucket=''CARRY'' AND expires_at IS NOT NULL))))',original);
END $$;
INSERT INTO legal_parameter (id,param_code,scope_key,subject_type,application_basis,value,unit,effective_from,effective_to,document_effective_date,legal_basis)
SELECT gen_random_uuid(),'HOLIDAY_CALENDAR','GLOBAL','ALL','WORK_DATE',
'{"dates":["2026-01-01","2026-02-16","2026-02-17","2026-02-18","2026-02-19","2026-02-20","2026-04-26","2026-04-30","2026-05-01","2026-09-01","2026-09-02"],"status":"SIMULATION","reference":"Lịch nghỉ lễ demo 2026; cơ sở phải xác nhận lịch chính thức và ngày nghỉ bù"}'::jsonb,
'date-list','2026-01-01','2026-12-31','2026-01-01','Lịch lễ mô phỏng 2026; không tự suy ngày nghỉ bù hoặc lịch năm khác'
WHERE NOT EXISTS (SELECT 1 FROM legal_parameter WHERE param_code='HOLIDAY_CALENDAR' AND scope_key='GLOBAL' AND subject_type='ALL' AND application_basis='WORK_DATE' AND effective_from='2026-01-01');
