-- Preserve the existing 14 integer digits and retain fractional weighted costs.
-- Widening only: no historical cost reconstruction, backfill or journal repair.
ALTER TABLE stock_moves ALTER COLUMN unit_cost TYPE numeric(30,16);
ALTER TABLE stock_quants ALTER COLUMN avg_cost TYPE numeric(30,16);
-- On empty databases this initializer-owned table is created at app startup.
ALTER TABLE IF EXISTS stock_layers ALTER COLUMN unit_cost TYPE numeric(30,16);
ALTER TABLE sales_issue_allocations ALTER COLUMN unit_cost TYPE numeric(30,16);
