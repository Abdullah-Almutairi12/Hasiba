-- Existing encrypted prepared messages have no token reference: fail closed.
ALTER TABLE account_recovery_outbox DROP CONSTRAINT account_recovery_outbox_status_check;
ALTER TABLE account_recovery_outbox ADD CONSTRAINT account_recovery_outbox_status_check
  CHECK(status IN ('prepared','sent','failed','cancelled','expired'));
ALTER TABLE account_recovery_outbox ADD COLUMN token_hash text;
ALTER TABLE account_recovery_outbox ADD COLUMN attempts integer NOT NULL DEFAULT 0;
ALTER TABLE account_recovery_outbox ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp();
ALTER TABLE account_recovery_outbox ADD COLUMN accepted_at timestamptz;
ALTER TABLE account_recovery_outbox ADD COLUMN error_code text;
UPDATE account_recovery_outbox SET status='cancelled', encrypted_payload='', error_code='legacy_unbound'
  WHERE token_hash IS NULL AND status IN ('prepared','failed');
CREATE INDEX account_recovery_delivery_due ON account_recovery_outbox(next_attempt_at)
  WHERE status IN ('prepared','failed');
