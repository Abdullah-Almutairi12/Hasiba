ALTER TABLE stock_takes ADD COLUMN IF NOT EXISTS variance_review jsonb;
ALTER TABLE team_access_policy ADD COLUMN IF NOT EXISTS stocktake_policy jsonb NOT NULL DEFAULT '{"allowParticipant":false,"revision":0}'::jsonb;
