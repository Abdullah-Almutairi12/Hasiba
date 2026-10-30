-- Widen storage only. Existing rows retain their original numeric value;
-- never reconstruct a historical agreement from today's discount rules.
ALTER TABLE sales_order_lines ALTER COLUMN discount_pct TYPE numeric(7,4);
