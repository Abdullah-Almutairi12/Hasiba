-- Existing tenants remain segregated; no grants or solo-mode inference.
ALTER TABLE team_access_policy ADD COLUMN IF NOT EXISTS procurement_receiving_policy jsonb
  NOT NULL DEFAULT '{"allowCreator":false,"revision":0}'::jsonb;
