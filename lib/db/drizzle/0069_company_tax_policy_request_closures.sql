-- A known-closed request cannot arrive late and activate a different tax policy.
-- The identity of the closer is kept even after a later policy revision.
CREATE TABLE company_tax_policy_request_closures (
  company_id integer NOT NULL REFERENCES companies(id),
  user_id integer NOT NULL REFERENCES users(id),
  request_id uuid NOT NULL,
  request_hash text NOT NULL,
  reason text NOT NULL CHECK(length(btrim(reason))>=6),
  closed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(company_id,user_id,request_id)
);
CREATE TRIGGER company_tax_policy_closure_immutable BEFORE UPDATE OR DELETE ON company_tax_policy_request_closures
FOR EACH ROW EXECUTE FUNCTION protect_company_tax_policy();
