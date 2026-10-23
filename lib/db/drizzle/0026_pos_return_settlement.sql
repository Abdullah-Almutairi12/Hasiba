CREATE TABLE IF NOT EXISTS return_access (
 company_id integer NOT NULL REFERENCES companies(id),
 user_id integer NOT NULL REFERENCES users(id),
 template text NOT NULL,
 capabilities jsonb NOT NULL,
 branches jsonb NOT NULL,
 updated_by integer NOT NULL REFERENCES users(id),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(company_id,user_id)
);
CREATE TABLE IF NOT EXISTS return_policies (
 company_id integer NOT NULL REFERENCES companies(id),
 branch_id integer NOT NULL DEFAULT 0,
 approval_above numeric(18,2),
 allow_resale boolean NOT NULL DEFAULT true,
 PRIMARY KEY(company_id,branch_id),
 CHECK(approval_above IS NULL OR approval_above >= 0)
);
CREATE TABLE IF NOT EXISTS return_controls (
 note_id integer PRIMARY KEY REFERENCES credit_notes(id),
 company_id integer NOT NULL REFERENCES companies(id),
 branch_id integer NOT NULL REFERENCES branches(id),
 created_by integer NOT NULL REFERENCES users(id),
 fingerprint text NOT NULL,
 disposition text NOT NULL CHECK(disposition IN ('resale','discard','no_goods')),
 settlement_method text NOT NULL CHECK(settlement_method IN ('credit','cash','card','transfer','stc')),
 proof_ref text NOT NULL,
 approval_id integer REFERENCES approval_requests(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS return_payouts (
 id serial PRIMARY KEY,
 company_id integer NOT NULL REFERENCES companies(id),
 note_id integer NOT NULL REFERENCES credit_notes(id),
 invoice_id integer NOT NULL REFERENCES customer_invoices(id),
 receipt_id integer NOT NULL REFERENCES customer_receipts(id),
 session_id integer NOT NULL REFERENCES pos_sessions(id),
 amount numeric(18,2) NOT NULL CHECK(amount > 0),
 method text NOT NULL CHECK(method IN ('cash','card','transfer','stc')),
 status text NOT NULL CHECK(status IN ('requested','confirmed','external_confirmed','cancelled')),
 reference text NOT NULL,
 idempotency_key text NOT NULL,
 fingerprint text NOT NULL,
 created_by integer NOT NULL REFERENCES users(id),
 confirmed_by integer REFERENCES users(id),
 journal_id integer REFERENCES journal_entries(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 confirmed_at timestamptz,
 UNIQUE(company_id,idempotency_key)
);
CREATE TABLE IF NOT EXISTS pos_cash_closings (
 session_id integer PRIMARY KEY REFERENCES pos_sessions(id),
 company_id integer NOT NULL REFERENCES companies(id),
 expected numeric(18,2) NOT NULL,
 counted numeric(18,2) NOT NULL CHECK(counted >= 0),
 difference numeric(18,2) NOT NULL,
 reason text NOT NULL,
 status text NOT NULL CHECK(status IN ('pending','approved')),
 created_by integer NOT NULL REFERENCES users(id),
 approved_by integer REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 approved_at timestamptz
);
CREATE TABLE IF NOT EXISTS pos_cash_expenses (
 id serial PRIMARY KEY,
 company_id integer NOT NULL REFERENCES companies(id),
 session_id integer NOT NULL REFERENCES pos_sessions(id),
 amount numeric(18,2) NOT NULL CHECK(amount > 0),
 reference text NOT NULL,
 idempotency_key text NOT NULL,
 fingerprint text NOT NULL,
 journal_id integer NOT NULL REFERENCES journal_entries(id),
 created_by integer NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,idempotency_key)
);
