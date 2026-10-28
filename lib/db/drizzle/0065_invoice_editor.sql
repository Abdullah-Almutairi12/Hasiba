-- Prospective template workflow only; no grant or historical document rewrite.
CREATE TABLE invoice_editor_drafts (
 id uuid PRIMARY KEY,
 company_id integer NOT NULL REFERENCES companies(id),
 scope_key integer NOT NULL CHECK(scope_key >= 0),
 revision integer NOT NULL CHECK(revision > 0),
 design jsonb NOT NULL,
 updated_by integer NOT NULL REFERENCES users(id),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invoice_editor_drafts_scope ON invoice_editor_drafts(company_id,scope_key);
CREATE TABLE invoice_editor_releases (
 id uuid PRIMARY KEY,
 company_id integer NOT NULL REFERENCES companies(id),
 draft_id uuid NOT NULL REFERENCES invoice_editor_drafts(id),
 draft_revision integer NOT NULL,
 design jsonb NOT NULL,
 created_by integer NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,draft_id,draft_revision),
 UNIQUE(company_id,id)
);
CREATE TABLE invoice_editor_activation (
 company_id integer NOT NULL REFERENCES companies(id),
 scope_key integer NOT NULL CHECK(scope_key >= 0),
 revision integer NOT NULL DEFAULT 0,
 release_id uuid,
 PRIMARY KEY(company_id,scope_key),
 FOREIGN KEY(company_id,release_id) REFERENCES invoice_editor_releases(company_id,id)
);
CREATE TABLE invoice_editor_requests (
 company_id integer NOT NULL REFERENCES companies(id),
 request_id uuid NOT NULL,
 actor_id integer NOT NULL REFERENCES users(id),
 body_hash text NOT NULL,
 result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(company_id,request_id)
);
CREATE TABLE invoice_editor_previews (
 company_id integer NOT NULL REFERENCES companies(id),
 scope_key integer NOT NULL,
 design_hash text NOT NULL,
 sample text NOT NULL CHECK(sample IN ('short','long')),
 width text NOT NULL CHECK(width IN ('a4','80')),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(company_id,scope_key,design_hash,sample,width)
);
CREATE FUNCTION protect_invoice_editor_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Immutable invoice editor evidence'; END $$;
CREATE TRIGGER invoice_editor_release_immutable BEFORE UPDATE OR DELETE ON invoice_editor_releases
 FOR EACH ROW EXECUTE FUNCTION protect_invoice_editor_evidence();
CREATE TRIGGER invoice_editor_request_immutable BEFORE UPDATE OR DELETE ON invoice_editor_requests
 FOR EACH ROW EXECUTE FUNCTION protect_invoice_editor_evidence();
