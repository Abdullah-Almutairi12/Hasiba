ALTER TABLE invoices ADD COLUMN IF NOT EXISTS lifecycle_version integer;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS currency_code text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS created_by integer REFERENCES users(id);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS branch_id integer REFERENCES branches(id);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS supplier_document_number text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS normalized_document_number text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS document_type text NOT NULL DEFAULT 'invoice';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS invoice_kind text NOT NULL DEFAULT 'goods';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS net_amount numeric(18,2);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS vat_amount numeric(18,2);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS expense_account_id integer REFERENCES accounts(id);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS reviewed_by integer REFERENCES users(id);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS review_authority text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS reviewed_source text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS journal_entry_id integer REFERENCES journal_entries(id);
UPDATE invoices SET document_type='reversal' WHERE reverses_id IS NOT NULL;
ALTER TABLE supplier_invoice_lines ADD COLUMN IF NOT EXISTS tax_rate numeric(8,4) NOT NULL DEFAULT 0;
CREATE TABLE supplier_invoice_revisions (
 id serial PRIMARY KEY,invoice_id integer NOT NULL REFERENCES invoices(id),
 company_id integer NOT NULL REFERENCES companies(id),changed_by integer NOT NULL REFERENCES users(id),
 facts jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS supplier_invoice_document_identity
 ON invoices(company_id,supplier_id,document_type,normalized_document_number)
 WHERE normalized_document_number IS NOT NULL AND supplier_id IS NOT NULL AND status<>'cancelled';
CREATE FUNCTION supplier_invoice_number_key(value text) RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT translate(btrim(normalize(value,NFC)),'٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹','01234567890123456789')
$$;
CREATE FUNCTION supplier_invoice_duplicate_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE key_value text;
BEGIN
 IF NEW.supplier_id IS NULL THEN RETURN NEW; END IF;
 key_value:=supplier_invoice_number_key(coalesce(NEW.supplier_document_number,NEW.invoice_number));
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.company_id||':'||NEW.supplier_id||':'||NEW.document_type||':'||key_value,0));
 IF NEW.status<>'cancelled' AND EXISTS(
   SELECT 1 FROM invoices i WHERE i.company_id=NEW.company_id AND i.supplier_id=NEW.supplier_id
    AND i.document_type=NEW.document_type AND i.status<>'cancelled' AND i.id<>NEW.id
    AND coalesce(i.normalized_document_number,supplier_invoice_number_key(i.invoice_number))=key_value)
 THEN RAISE EXCEPTION 'Supplier invoice identity already exists' USING ERRCODE='23505'; END IF;
 NEW.normalized_document_number:=key_value;
 RETURN NEW;
END $$;
CREATE TRIGGER supplier_invoice_duplicate_guard BEFORE INSERT OR UPDATE OF supplier_id,supplier_document_number,invoice_number,document_type
 ON invoices FOR EACH ROW EXECUTE FUNCTION supplier_invoice_duplicate_guard();
-- Same source invalidation engine as the other native documents.
CREATE TRIGGER supplier_invoice_source_guard BEFORE UPDATE OF
 supplier_id,supplier_document_number,normalized_document_number,document_type,
 invoice_kind,net_amount,vat_amount,amount,po_id,branch_id,invoice_date,due_date,expense_account_id,notes
 ON invoices FOR EACH ROW EXECUTE FUNCTION approval_source_write_guard_v1('invoices','supplier_invoice','id');
CREATE TRIGGER supplier_invoice_lines_source_guard BEFORE INSERT OR UPDATE OR DELETE
 ON supplier_invoice_lines FOR EACH ROW
 EXECUTE FUNCTION approval_source_write_guard_v1('invoices','supplier_invoice','invoice_id');
