-- Business dates are inclusive. Exclusion constraints protect concurrent writers,
-- including callers that bypass HTTP, in addition to per-entity transaction locks.
ALTER TABLE legal_parameter ADD CONSTRAINT legal_parameter_dates CHECK (effective_to IS NULL OR effective_to >= effective_from);
ALTER TABLE legal_parameter ADD CONSTRAINT legal_parameter_basis_required CHECK (length(btrim(legal_basis)) > 0);
ALTER TABLE legal_parameter ADD CONSTRAINT legal_parameter_no_overlap EXCLUDE USING gist
  (param_code WITH =, scope_key WITH =, subject_type WITH =, application_basis WITH =, daterange(effective_from,effective_to,'[]') WITH &&);
ALTER TABLE site_policy ADD CONSTRAINT site_policy_dates CHECK (effective_to IS NULL OR effective_to >= effective_from);
ALTER TABLE site_policy ADD CONSTRAINT cutoff_day_range CHECK (value BETWEEN 1 AND 31);
ALTER TABLE site_policy ADD CONSTRAINT policy_decision_required CHECK (length(btrim(decision_reference)) > 0);
ALTER TABLE site_policy ADD CONSTRAINT site_policy_no_overlap EXCLUDE USING gist
  (org_unit_id WITH =, policy_key WITH =, daterange(effective_from,effective_to,'[]') WITH &&);
ALTER TABLE business_period ADD CONSTRAINT business_period_dates CHECK (date_to >= date_from);
ALTER TABLE business_period ADD CONSTRAINT business_period_cutoff CHECK (cutoff_day BETWEEN 1 AND 31);
ALTER TABLE business_period ADD CONSTRAINT business_period_revision CHECK (revision >= 0);
ALTER TABLE business_period ADD CONSTRAINT business_period_no_overlap EXCLUDE USING gist
  (period_type WITH =, scope_org_unit_id WITH =, daterange(date_from,date_to,'[]') WITH &&);
ALTER TABLE employment_contract ADD CONSTRAINT employment_contract_dates CHECK (end_date IS NULL OR end_date >= start_date);
ALTER TABLE employment_contract ADD CONSTRAINT indefinite_end_date CHECK ((contract_type = 'INDEFINITE') = (end_date IS NULL));
ALTER TABLE employment_contract ADD CONSTRAINT active_contract_no_overlap EXCLUDE USING gist
  (employee_id WITH =, daterange(start_date,end_date,'[]') WITH &&) WHERE (status = 'ACTIVE');
ALTER TABLE personnel_transfer ADD CONSTRAINT transfer_distinct_units CHECK (from_org_unit_id <> to_org_unit_id);
ALTER TABLE personnel_transfer ADD CONSTRAINT transfer_decision_dates CHECK (decision_date <= effective_from);
ALTER TABLE personnel_transfer ADD CONSTRAINT transfer_reason_required CHECK (length(btrim(reason)) > 0 AND length(btrim(decision_number)) > 0);
