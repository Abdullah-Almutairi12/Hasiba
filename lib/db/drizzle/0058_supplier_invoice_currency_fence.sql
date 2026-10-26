-- Currency is a financial source fact too. Preserve every existing field fence.
DROP TRIGGER supplier_invoice_source_guard ON invoices;
CREATE TRIGGER supplier_invoice_source_guard BEFORE UPDATE OF
 supplier_id,supplier_document_number,normalized_document_number,document_type,
 invoice_kind,net_amount,vat_amount,amount,po_id,branch_id,currency_code,invoice_date,due_date,expense_account_id,notes
 ON invoices FOR EACH ROW EXECUTE FUNCTION approval_source_write_guard_v1('invoices','supplier_invoice','id');
