CREATE TABLE IF NOT EXISTS pos_owner_exception_policies (
  company_id integer PRIMARY KEY REFERENCES companies(id),
  enabled boolean NOT NULL DEFAULT false,
  operations jsonb NOT NULL DEFAULT '[]'::jsonb,
  amount_limit numeric(18,2) NOT NULL DEFAULT 0 CHECK (amount_limit >= 0),
  revision integer NOT NULL DEFAULT 1,
  reason text NOT NULL,
  updated_by integer NOT NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS pos_owner_operation_proofs (
  token_hash text PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id),
  user_id integer NOT NULL REFERENCES users(id),
  purpose text NOT NULL,
  session_id integer NOT NULL REFERENCES pos_sessions(id),
  source_fingerprint text NOT NULL,
  policy_revision integer NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS pos_cash_responsibility_decisions (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id),
  session_id integer NOT NULL REFERENCES pos_sessions(id),
  decision text NOT NULL CHECK (decision IN ('company_bears','employee_responsible')),
  employee_id integer REFERENCES employees(id),
  reason text NOT NULL,
  evidence text NOT NULL,
  decided_by integer NOT NULL REFERENCES users(id),
  decided_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  idempotency_key uuid NOT NULL,
  fingerprint text NOT NULL,
  owner_exception boolean NOT NULL DEFAULT false,
  difference_amount numeric(18,2) NOT NULL,
  closing_snapshot jsonb NOT NULL,
  UNIQUE(company_id,session_id),
  UNIQUE(company_id,idempotency_key),
  CHECK ((decision='employee_responsible')=(employee_id IS NOT NULL))
);
