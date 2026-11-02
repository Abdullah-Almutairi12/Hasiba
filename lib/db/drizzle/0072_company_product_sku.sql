-- Forward-only once tenants intentionally reuse a SKU. Never rename products
-- or restore a global constraint without an independently approved data policy.
-- The runner wraps this entire file in one transaction; install protection
-- before removing the original constraint. PostgreSQL waits for active writers.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'products'::regclass AND conname = 'products_company_sku_unique'
  ) THEN
    ALTER TABLE products ADD CONSTRAINT products_company_sku_unique UNIQUE (company_id, sku);
  END IF;
END $$;
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_sku_unique;
