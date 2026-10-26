CREATE TABLE supplier_invoice_receipt_allocations(
 id serial PRIMARY KEY,
 invoice_line_id integer NOT NULL REFERENCES supplier_invoice_lines(id),
 receipt_line_id integer NOT NULL REFERENCES goods_receipt_lines(id),
 company_id integer NOT NULL REFERENCES companies(id),
 quantity numeric(20,6) NOT NULL CHECK(quantity>0),
 source_unit_cost numeric(20,6) NOT NULL CHECK(source_unit_cost>=0),
 created_at timestamptz NOT NULL DEFAULT now(),reversed_at timestamptz,
 UNIQUE(invoice_line_id,receipt_line_id)
);
CREATE INDEX supplier_invoice_receipt_capacity ON supplier_invoice_receipt_allocations(receipt_line_id) WHERE reversed_at IS NULL;
CREATE FUNCTION supplier_invoice_allocation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Receipt allocation evidence cannot be deleted'; END IF;
 IF TG_OP='UPDATE' AND ((to_jsonb(NEW)-'reversed_at') IS DISTINCT FROM (to_jsonb(OLD)-'reversed_at')
   OR OLD.reversed_at IS NOT NULL AND NEW.reversed_at IS DISTINCT FROM OLD.reversed_at)
 THEN RAISE EXCEPTION 'Receipt allocation evidence is immutable'; END IF;
 IF NOT EXISTS(SELECT 1 FROM supplier_invoice_lines e JOIN invoices i ON i.id=e.invoice_id
   JOIN goods_receipt_lines r ON r.id=NEW.receipt_line_id AND r.po_line_id=e.po_line_id
   JOIN goods_receipts g ON g.id=r.grn_id AND g.po_id=i.po_id
   JOIN purchase_orders p ON p.id=g.po_id AND p.company_id=NEW.company_id
   JOIN warehouses w ON w.id=g.warehouse_id AND w.company_id=NEW.company_id
   WHERE e.id=NEW.invoice_line_id AND e.company_id=NEW.company_id AND i.company_id=NEW.company_id
     AND NEW.source_unit_cost=r.unit_cost)
 THEN RAISE EXCEPTION 'Receipt allocation source or company mismatch'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER supplier_invoice_allocation_guard BEFORE INSERT OR UPDATE OR DELETE ON supplier_invoice_receipt_allocations
 FOR EACH ROW EXECUTE FUNCTION supplier_invoice_allocation_guard();
