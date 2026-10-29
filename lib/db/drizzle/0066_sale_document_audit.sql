-- Extend the existing audit trail; no new permission system or financial rows.
ALTER TABLE audit_logs ADD COLUMN document_id integer;
ALTER TABLE audit_logs ADD COLUMN document_event_id uuid;
ALTER TABLE audit_logs ADD COLUMN document_facts jsonb;
CREATE UNIQUE INDEX audit_document_event_once ON audit_logs(company_id,user_id,document_event_id)
  WHERE document_event_id IS NOT NULL;
CREATE INDEX audit_invoice_history ON audit_logs(company_id,document_id,created_at,id)
  WHERE document_id IS NOT NULL;
CREATE FUNCTION protect_document_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.document_id IS NOT NULL THEN
    RAISE EXCEPTION 'Document evidence is append-only';
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$$;
CREATE TRIGGER protect_document_audit BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION protect_document_audit();
