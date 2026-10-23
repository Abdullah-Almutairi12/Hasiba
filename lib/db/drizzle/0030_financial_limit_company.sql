-- Preserve unowned policies. A linked user/branch is not ownership evidence.
ALTER TABLE financial_limits ADD COLUMN IF NOT EXISTS company_id integer REFERENCES companies(id);
ALTER TABLE financial_limits DROP CONSTRAINT IF EXISTS financial_limits_role_action_key_key;
CREATE UNIQUE INDEX IF NOT EXISTS financial_limits_company_key ON financial_limits(company_id, role, action_key);
