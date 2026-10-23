-- Historical rows are kept unassigned; no author/branch inference.
ALTER TABLE automation_rules ADD COLUMN IF NOT EXISTS company_id integer REFERENCES companies(id);
ALTER TABLE automation_rules ADD COLUMN IF NOT EXISTS branch_ids jsonb;
ALTER TABLE automation_runs ADD COLUMN IF NOT EXISTS company_id integer REFERENCES companies(id);
ALTER TABLE notification_inbox ADD COLUMN IF NOT EXISTS company_id integer REFERENCES companies(id);
CREATE INDEX IF NOT EXISTS automation_rules_company_idx ON automation_rules(company_id,is_active);
CREATE INDEX IF NOT EXISTS automation_runs_company_idx ON automation_runs(company_id,rule_id,triggered_at);
CREATE INDEX IF NOT EXISTS notification_inbox_company_idx ON notification_inbox(company_id,user_id,is_read,created_at);
-- Durable effect receipt shares the database transaction with every internal
-- effect. No external dispatch inside the transaction.
CREATE TABLE IF NOT EXISTS automation_effect_receipts (
  company_id integer NOT NULL REFERENCES companies(id),
  rule_id integer NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE,
  execution_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(company_id,rule_id,execution_key)
);
