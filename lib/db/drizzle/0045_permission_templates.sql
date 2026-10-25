CREATE TABLE team_permission_templates (
 id serial PRIMARY KEY,
 company_id integer NOT NULL REFERENCES companies(id),
 name text NOT NULL,
 resource text NOT NULL CHECK(resource IN ('inventory','pos')),
 actions text[] NOT NULL,
 revision integer NOT NULL DEFAULT 1,
 created_by integer NOT NULL REFERENCES users(id),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id)
);
CREATE TABLE team_permission_template_versions (
 template_id integer NOT NULL REFERENCES team_permission_templates(id),
 revision integer NOT NULL,
 name text NOT NULL,
 actions text[] NOT NULL,
 created_by integer NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(template_id,revision)
);
ALTER TABLE responsibility_grants ADD COLUMN template_id integer;
ALTER TABLE responsibility_grants ADD COLUMN template_revision integer;
ALTER TABLE responsibility_grants ADD COLUMN template_mode text;
ALTER TABLE responsibility_grants ADD CONSTRAINT responsibility_template_tenant_fk
 FOREIGN KEY(company_id,template_id) REFERENCES team_permission_templates(company_id,id);
ALTER TABLE responsibility_grants ADD CONSTRAINT responsibility_template_version_fk
 FOREIGN KEY(template_id,template_revision) REFERENCES team_permission_template_versions(template_id,revision);
ALTER TABLE responsibility_grants ADD CONSTRAINT responsibility_template_shape CHECK (
 (template_id IS NULL AND template_revision IS NULL AND template_mode IS NULL) OR
 (template_id IS NOT NULL AND template_revision IS NOT NULL AND template_mode IS NOT NULL AND template_mode IN ('inherit','override'))
);
