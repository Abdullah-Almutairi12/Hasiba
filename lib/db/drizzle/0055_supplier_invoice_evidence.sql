-- New invoices retain their own original lines. Historical rows remain
-- version NULL: a purchase order is not evidence of a past partial invoice.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS line_evidence_version integer;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS billed_quantities_applied boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS supplier_invoice_lines (
  id serial PRIMARY KEY,
  invoice_id integer NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  position integer NOT NULL,
  description text NOT NULL,
  quantity numeric(20,6) NOT NULL,
  unit_price numeric(20,6) NOT NULL,
  source_total numeric(20,6) NOT NULL,
  net_amount numeric(20,6) NOT NULL,
  unit text,
  product_id integer REFERENCES products(id) ON DELETE RESTRICT,
  po_line_id integer REFERENCES purchase_order_lines(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(invoice_id,position)
);
CREATE INDEX IF NOT EXISTS supplier_invoice_lines_source ON supplier_invoice_lines(company_id,po_line_id);
CREATE OR REPLACE FUNCTION supplier_invoice_line_owner_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE invoice_row invoices;
BEGIN
 SELECT * INTO invoice_row FROM invoices WHERE id=CASE WHEN TG_OP='INSERT' THEN NEW.invoice_id ELSE OLD.invoice_id END FOR UPDATE;
 IF (TG_OP<>'INSERT' OR invoice_row.line_evidence_version IS NOT NULL) AND invoice_row.status<>'draft' THEN
   RAISE EXCEPTION 'Original supplier invoice evidence is append-only';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF TG_OP='UPDATE' AND (NEW.invoice_id<>OLD.invoice_id OR NEW.company_id<>OLD.company_id)
 THEN RAISE EXCEPTION 'Supplier invoice evidence cannot change its source'; END IF;
 IF invoice_row.company_id<>NEW.company_id OR
   (NEW.product_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM products WHERE id=NEW.product_id AND company_id=NEW.company_id)) OR
   (NEW.po_line_id IS NOT NULL AND NOT EXISTS(
     SELECT 1 FROM purchase_order_lines l JOIN purchase_orders p ON p.id=l.po_id
     WHERE l.id=NEW.po_line_id AND p.id=invoice_row.po_id AND p.company_id=NEW.company_id))
 THEN RAISE EXCEPTION 'Supplier invoice evidence source is outside its company or order'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS supplier_invoice_line_owner_guard ON supplier_invoice_lines;
CREATE TRIGGER supplier_invoice_line_owner_guard BEFORE INSERT OR UPDATE OR DELETE ON supplier_invoice_lines
 FOR EACH ROW EXECUTE FUNCTION supplier_invoice_line_owner_guard();
