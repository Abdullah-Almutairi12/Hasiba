-- Old issued documents retain their historical behaviour and evidence.
-- Newly deferred physical receipts do not change the approved financial facts.
ALTER TABLE return_controls
  ADD COLUMN receipt_required boolean NOT NULL DEFAULT false,
  ADD COLUMN received_by integer REFERENCES users(id),
  ADD COLUMN received_at timestamptz,
  ADD COLUMN receipt_reference text;
ALTER TABLE return_controls ADD CONSTRAINT return_receipt_evidence_complete CHECK (
  (received_by IS NULL AND received_at IS NULL AND receipt_reference IS NULL) OR
  (received_by IS NOT NULL AND received_at IS NOT NULL AND length(btrim(receipt_reference)) >= 3)
);
