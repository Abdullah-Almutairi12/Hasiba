-- Historical decisions are not backfilled with invented reasons or source facts.
ALTER TABLE pos_cash_closings
  ADD COLUMN settlement_snapshot jsonb,
  ADD COLUMN settlement_revision text,
  ADD COLUMN settlement_version integer NOT NULL DEFAULT 1,
  ADD COLUMN reconciliation_reason text,
  ADD COLUMN review_reason text,
  ADD COLUMN review_snapshot jsonb;
