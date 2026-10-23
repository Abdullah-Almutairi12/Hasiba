-- Existing plans are reused. Unowned legacy plans are NOT assigned to a tenant.
ALTER TABLE commission_plans ADD COLUMN IF NOT EXISTS company_id integer REFERENCES companies(id);
CREATE TABLE sales_seller_policies (
 id serial PRIMARY KEY, company_id integer NOT NULL REFERENCES companies(id),
 branch_id integer NOT NULL DEFAULT 0, inherit boolean NOT NULL DEFAULT false,
 mode text NOT NULL CHECK(mode IN ('hidden','optional','required')),
 granularity text NOT NULL CHECK(granularity IN ('invoice','line')),
 commission_plan_id integer REFERENCES commission_plans(id),
 commission_enabled boolean NOT NULL DEFAULT false,
 effective_from timestamptz NOT NULL, created_by integer NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sales_seller_policy_lookup ON sales_seller_policies(company_id,branch_id,effective_from DESC,id DESC);
CREATE TABLE sales_seller_eligibility (
 company_id integer NOT NULL REFERENCES companies(id), employee_id integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
 enabled boolean NOT NULL DEFAULT false, branch_ids jsonb,
 updated_by integer NOT NULL REFERENCES users(id), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(company_id,employee_id)
);
CREATE TABLE invoice_seller_lines (
 company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE, invoice_id integer NOT NULL REFERENCES customer_invoices(id) ON DELETE CASCADE,
 invoice_line_id integer PRIMARY KEY REFERENCES customer_invoice_lines(id) ON DELETE CASCADE,
 branch_id integer, employee_id integer, seller_name text NOT NULL, employee_no text,
 currency_code text NOT NULL, quantity numeric NOT NULL,
 gross_cents bigint NOT NULL, discount_cents bigint NOT NULL, net_cents bigint NOT NULL,
 policy jsonb NOT NULL, revision integer NOT NULL DEFAULT 1,
 updated_by integer NOT NULL REFERENCES users(id), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE invoice_seller_audit (
 id serial PRIMARY KEY, company_id integer NOT NULL REFERENCES companies(id),
 invoice_id integer NOT NULL REFERENCES customer_invoices(id) ON DELETE CASCADE, user_id integer NOT NULL REFERENCES users(id),
 reason text NOT NULL, before_value jsonb NOT NULL, after_value jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sales_commission_events (
 id serial PRIMARY KEY, company_id integer NOT NULL REFERENCES companies(id),
 invoice_id integer NOT NULL REFERENCES customer_invoices(id) ON DELETE CASCADE,
 invoice_line_id integer NOT NULL REFERENCES customer_invoice_lines(id) ON DELETE CASCADE,
 branch_id integer, employee_id integer, seller_name text NOT NULL, employee_no text,
 currency_code text NOT NULL, event_key text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('sale','return','return_cancel','cancel','change')),
 effective_date date NOT NULL, net_cents bigint NOT NULL, discount_cents bigint NOT NULL DEFAULT 0,
 commission_cents bigint NOT NULL, policy jsonb NOT NULL,
 status text NOT NULL DEFAULT 'calculated' CHECK(status IN ('calculated','approved','paid')),
 created_by integer REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 approved_by integer REFERENCES users(id), approved_at timestamptz,
 paid_by integer REFERENCES users(id), paid_at timestamptz, external_reference text,
 UNIQUE(company_id,event_key)
);
CREATE TABLE sales_commission_state_audit (
 id serial PRIMARY KEY, company_id integer NOT NULL REFERENCES companies(id),
 event_id integer NOT NULL REFERENCES sales_commission_events(id) ON DELETE CASCADE,
 old_status text NOT NULL,new_status text NOT NULL,reference text,
 user_id integer NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX seller_attribution_invoice_idx ON invoice_seller_lines(company_id,invoice_id,invoice_line_id);
CREATE INDEX seller_events_source_balance_idx ON sales_commission_events(company_id,invoice_line_id);
CREATE INDEX seller_events_period_idx ON sales_commission_events(company_id,effective_date,branch_id);
