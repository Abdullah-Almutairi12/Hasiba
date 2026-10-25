-- Administrative authority is company-local, not legal ownership or finance.
CREATE TABLE company_administrators (
 company_id integer NOT NULL REFERENCES companies(id),
 user_id integer NOT NULL REFERENCES users(id),
 responsibilities text[] NOT NULL DEFAULT '{}',
 active boolean NOT NULL DEFAULT true,
 revision integer NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(company_id,user_id)
);
-- Preserve established authority, once, without assigning any new finance role.
INSERT INTO company_administrators(company_id,user_id,responsibilities)
 SELECT uc.company_id,uc.user_id,ARRAY['users','administrators','settings','subscription','contact']
 FROM user_companies uc WHERE uc.role='owner' AND NOT EXISTS
 (SELECT 1 FROM employee_access a WHERE a.company_id=uc.company_id AND a.user_id=uc.user_id);
CREATE TABLE administration_handovers (
 id uuid PRIMARY KEY,
 company_id integer NOT NULL REFERENCES companies(id),
 from_user_id integer NOT NULL REFERENCES users(id),
 to_user_id integer REFERENCES users(id),
 person_id integer REFERENCES employees(id),
 responsibilities text[] NOT NULL,
 departure text NOT NULL CHECK(departure IN ('retain','stay','suspend','terminate')),
 revision integer NOT NULL DEFAULT 1,
 state text NOT NULL DEFAULT 'proposed' CHECK(state IN ('proposed','accepted','completed','cancelled')),
 accepted_revision integer,
 eligibility text,
 accepted_at timestamptz,
 completed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(to_user_id IS NOT NULL OR person_id IS NOT NULL)
);
CREATE UNIQUE INDEX administration_one_open_handover
 ON administration_handovers(company_id,from_user_id) WHERE state IN ('proposed','accepted');
CREATE TABLE administration_notices (
 id bigserial PRIMARY KEY,
 company_id integer NOT NULL REFERENCES companies(id),
 user_id integer NOT NULL REFERENCES users(id),
 handover_id uuid NOT NULL REFERENCES administration_handovers(id),
 message text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
