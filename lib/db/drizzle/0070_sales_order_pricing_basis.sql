-- Do not backfill legacy contracts from today's company or catalogue settings.
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS pricing_basis jsonb;
