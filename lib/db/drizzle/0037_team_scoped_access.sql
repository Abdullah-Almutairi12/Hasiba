-- Extend the existing HR record, without inventing employment or payroll facts.
ALTER TABLE employees ALTER COLUMN hire_date DROP NOT NULL;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS record_kind text NOT NULL DEFAULT 'employee';

CREATE TABLE team_setup_state (
 company_id integer PRIMARY KEY REFERENCES companies(id),
 mode text NOT NULL DEFAULT 'team' CHECK(mode IN ('solo','team')),
 step text NOT NULL DEFAULT 'people',
 draft jsonb NOT NULL DEFAULT '{}',
 revision integer NOT NULL DEFAULT 1,
 updated_by integer NOT NULL REFERENCES users(id),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE team_access_policy (
 company_id integer PRIMARY KEY REFERENCES companies(id),
 enabled_modules text[] NOT NULL DEFAULT '{}',
 seat_limit integer CHECK(seat_limit IS NULL OR seat_limit >= 0),
 source text NOT NULL DEFAULT 'development_configuration',
 updated_by integer NOT NULL REFERENCES users(id),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE employee_access (
 employee_id integer PRIMARY KEY REFERENCES employees(id),
 company_id integer NOT NULL REFERENCES companies(id),
 user_id integer REFERENCES users(id),
 login_kinds text[] NOT NULL DEFAULT '{}',
 status text NOT NULL CHECK(status IN ('record','pending','device_setup_required','active','suspended')),
 denied_actions text[] NOT NULL DEFAULT '{}',
 revision integer NOT NULL DEFAULT 1,
 creation_key text NOT NULL,
 creation_hash text NOT NULL,
 created_by integer NOT NULL REFERENCES users(id),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT employee_access_creation_key UNIQUE(company_id,creation_key)
);
CREATE UNIQUE INDEX employee_access_identity_uq ON employee_access(company_id,user_id) WHERE user_id IS NOT NULL;
CREATE TABLE responsibility_grants (
 id serial PRIMARY KEY,
 company_id integer NOT NULL REFERENCES companies(id),
 employee_id integer NOT NULL REFERENCES employee_access(employee_id),
 resource text NOT NULL CHECK(resource IN ('inventory','pos')),
 branch_id integer NOT NULL REFERENCES branches(id),
 warehouse_ids integer[] NOT NULL,
 actions text[] NOT NULL,
 amount_limit numeric(18,4) CHECK(amount_limit IS NULL OR amount_limit >= 0),
 starts_at timestamptz NOT NULL DEFAULT now(),
 ends_at timestamptz,
 revoked_at timestamptz,
 created_by integer NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(ends_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX responsibility_grants_actor_idx ON responsibility_grants(company_id,employee_id);
CREATE TABLE team_invitations (
 id serial PRIMARY KEY,
 company_id integer NOT NULL REFERENCES companies(id),
 employee_id integer NOT NULL REFERENCES employee_access(employee_id),
 revision integer NOT NULL,
 token_hash text NOT NULL UNIQUE,
 recipient_email text NOT NULL,
 expires_at timestamptz NOT NULL,
 used_at timestamptz,
 revoked_at timestamptz,
 created_by integer NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
-- Include missing/inserted grants in the same conservative authority fence.
DO $$
DECLARE relation text;
BEGIN
 FOREACH relation IN ARRAY ARRAY['employee_access','responsibility_grants','team_access_policy','team_invitations','employees','branches','warehouses']
 LOOP
  EXECUTE format('CREATE TRIGGER approval_authority_write_fence BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION approval_authority_write_fence_v1()', relation);
 END LOOP;
END $$;
