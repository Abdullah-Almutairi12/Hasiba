ALTER TABLE approver_delegations
  ADD COLUMN IF NOT EXISTS branch_id integer REFERENCES branches(id),
  ADD COLUMN IF NOT EXISTS doc_types text[],
  ADD COLUMN IF NOT EXISTS max_amount numeric(18,4),
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS revoked_by integer;
-- NULL doc_types denotes an old, unreviewed delegation, not "all documents".
-- Keep its original ownership, period and evidence; do not activate/backfill it.
ALTER TABLE approver_delegations ADD CONSTRAINT delegation_scope_amount_nonnegative
  CHECK (max_amount IS NULL OR max_amount >= 0);
