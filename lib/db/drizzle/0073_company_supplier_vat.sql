-- The original runner executes this entire file atomically. Protect local
-- identity before removing global uniqueness; never rewrite VATs, IDs or balances.
-- NULL values remain distinct. Historical blank values are deliberately retained:
-- incoming blank values are handled at the boundary, not bulk-normalized here.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'suppliers'::regclass AND conname = 'suppliers_company_vat_number_unique'
  ) THEN
    ALTER TABLE suppliers ADD CONSTRAINT suppliers_company_vat_number_unique UNIQUE (company_id, vat_number);
  END IF;
END $$;
ALTER TABLE suppliers DROP CONSTRAINT IF EXISTS suppliers_vat_number_unique;
-- Forward-only after legitimate cross-company reuse: no forced global rollback,
-- merging, deleting or renumbering suppliers to make a downgrade pass.
