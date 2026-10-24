ALTER TABLE approval_actions ADD COLUMN IF NOT EXISTS decision_key text;
ALTER TABLE approval_actions ADD COLUMN IF NOT EXISTS decision_fingerprint text;
ALTER TABLE approval_actions ADD COLUMN IF NOT EXISTS decision_result jsonb;
CREATE UNIQUE INDEX approval_actions_decision_key
 ON approval_actions(request_id,decision_key) WHERE decision_key IS NOT NULL;
