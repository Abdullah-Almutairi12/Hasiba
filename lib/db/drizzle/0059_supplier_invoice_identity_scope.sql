-- The canonical guard/index installed in 0056 scopes identity to the legal
-- company, canonical supplier, document type and meaningful document number.
-- The old global number constraint incorrectly rejects different suppliers'
-- legitimate invoices, including through the retained scan entry point.
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_invoice_number_unique;
