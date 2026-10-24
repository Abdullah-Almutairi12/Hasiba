-- Explicit, reversible adoption of existing identities; never rewrite their
-- membership role, credentials, HR facts, or historical financial evidence.
CREATE TABLE legacy_team_conversions (
 id serial PRIMARY KEY,
 company_id integer NOT NULL REFERENCES companies(id),
 user_id integer NOT NULL REFERENCES users(id),
 employee_id integer NOT NULL REFERENCES employee_access(employee_id),
 original_role text NOT NULL CHECK(original_role IN ('cashier','inventory')),
 original_branch_id integer,
 applied_digest text NOT NULL,
 state text NOT NULL DEFAULT 'active' CHECK(state IN ('active','reverted')),
 created_by integer NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 reverted_by integer REFERENCES users(id),
 reverted_at timestamptz,
 reason text,
 UNIQUE(company_id,user_id),
 UNIQUE(employee_id)
);
CREATE TRIGGER approval_authority_write_fence BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE
 ON legacy_team_conversions FOR EACH STATEMENT EXECUTE FUNCTION approval_authority_write_fence_v1();
