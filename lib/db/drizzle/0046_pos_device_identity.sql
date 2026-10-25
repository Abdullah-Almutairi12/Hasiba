-- POS-only identities have no invented email or platform password.
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
CREATE TABLE pos_device_stations (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id),
  branch_id integer NOT NULL REFERENCES branches(id),
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
  UNIQUE(company_id,branch_id,name)
);
CREATE TABLE pos_devices (
  id uuid PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id),
  branch_id integer NOT NULL REFERENCES branches(id),
  station_id integer NOT NULL REFERENCES pos_device_stations(id),
  name text NOT NULL,
  public_jwk jsonb NOT NULL,
  key_hash text NOT NULL,
  status text NOT NULL CHECK(status IN ('registered','active','revoked')),
  generation integer NOT NULL DEFAULT 1,
  activation_hash text,
  activation_expires_at timestamptz,
  activation_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE pos_device_challenges (
  id uuid PRIMARY KEY,
  device_id uuid NOT NULL REFERENCES pos_devices(id),
  generation integer NOT NULL,
  purpose text NOT NULL CHECK(purpose IN ('activate','unlock','request')),
  binding text NOT NULL,
  nonce_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);
CREATE INDEX pos_device_challenges_expiry ON pos_device_challenges(expires_at);
CREATE TABLE pos_employee_credentials (
  company_id integer NOT NULL REFERENCES companies(id),
  employee_id integer NOT NULL REFERENCES employees(id),
  pin_hash text NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  failures integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  PRIMARY KEY(company_id,employee_id)
);
