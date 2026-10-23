-- No inferred ownership: historical global/branch-only matrices and delegations
-- remain intact but quarantined until independently verified.
ALTER TABLE approval_rules ADD COLUMN IF NOT EXISTS company_id integer REFERENCES companies(id);
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS company_id integer REFERENCES companies(id);
ALTER TABLE approver_delegations ADD COLUMN IF NOT EXISTS company_id integer REFERENCES companies(id);
CREATE INDEX IF NOT EXISTS approval_rules_company_lookup ON approval_rules(company_id,doc_type,is_active);
CREATE INDEX IF NOT EXISTS approval_requests_company_lookup ON approval_requests(company_id,status,created_at);
CREATE INDEX IF NOT EXISTS approver_delegations_company_lookup ON approver_delegations(company_id,from_user_id,from_date,to_date);
