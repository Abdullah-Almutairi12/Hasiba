-- Account identity is global; tenant policy never owns its secrets.
CREATE TABLE account_security (
  user_id integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  credential_epoch integer NOT NULL DEFAULT 0,
  totp_secret text,
  last_totp_counter bigint NOT NULL DEFAULT -1,
  pending_secret text,
  pending_session text,
  pending_epoch integer,
  pending_expires_at timestamptz,
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE account_recovery_codes (
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(user_id,code_hash)
);
CREATE TABLE account_login_challenges (
  id uuid PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_epoch integer NOT NULL,
  company_id integer,
  intent text NOT NULL CHECK(intent IN ('login','receipt')),
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  consumed_at timestamptz
);
CREATE TABLE account_password_resets (
  token_hash text PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_epoch integer NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);
CREATE TABLE account_recovery_outbox (
  id uuid PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  encrypted_payload text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  status text NOT NULL DEFAULT 'prepared' CHECK(status IN ('prepared','sent','failed'))
);
ALTER TABLE companies ADD COLUMN account_mfa_required boolean NOT NULL DEFAULT false;
