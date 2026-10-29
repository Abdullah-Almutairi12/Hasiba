-- The original taxable net unit may have a repeating decimal when the
-- customer-paid price included VAT. Preserve twelve decimals for new credit
-- notes; existing money amounts and issued evidence remain unchanged.
ALTER TABLE credit_note_lines ALTER COLUMN unit_price TYPE numeric(30,12);
