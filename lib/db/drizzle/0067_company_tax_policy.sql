-- Preserve existing rows and issued evidence. Only future unspecified companies
-- start unresolved; an existing legacy default is not registration evidence.
ALTER TABLE companies ALTER COLUMN vat_registration_status SET DEFAULT 'unresolved';
CREATE TABLE company_tax_policy_versions (
  id bigserial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id),
  revision integer NOT NULL,
  request_id uuid NOT NULL,
  request_hash text NOT NULL,
  effective_from date NOT NULL,
  status text NOT NULL CHECK(status IN ('registered','voluntary','not_registered')),
  vat_number text,
  price_includes_vat boolean NOT NULL,
  product_rules jsonb NOT NULL,
  service_rule jsonb NOT NULL,
  legacy_state jsonb NOT NULL,
  reason text NOT NULL CHECK(length(btrim(reason))>=6),
  created_by integer NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(company_id,revision),
  UNIQUE(company_id,created_by,request_id)
);
CREATE INDEX company_tax_policy_date ON company_tax_policy_versions(company_id,effective_from DESC,revision DESC);
CREATE FUNCTION protect_company_tax_policy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'issued tax policy evidence is append-only';
END $$;
CREATE TRIGGER company_tax_policy_immutable BEFORE UPDATE OR DELETE ON company_tax_policy_versions
FOR EACH ROW EXECUTE FUNCTION protect_company_tax_policy();
-- More unit-price precision is representation, not a change to currency scale,
-- costs or historical monetary values. Currency totals remain two decimals.
ALTER TABLE quotation_lines ALTER COLUMN unit_price TYPE numeric(30,12);
ALTER TABLE sales_order_lines ALTER COLUMN unit_price TYPE numeric(30,12);
ALTER TABLE customer_invoice_lines ALTER COLUMN unit_price TYPE numeric(30,12);
