-- New posting evidence only. Legacy notes remain NULL; no cost backfill.
ALTER TABLE credit_notes
  ADD COLUMN IF NOT EXISTS inventory_cost numeric(18,2),
  ADD COLUMN IF NOT EXISTS cancellation_rounding numeric(18,2);
