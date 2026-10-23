-- Additive only: no backfill or rewriting of issued/signed business documents.
CREATE TABLE IF NOT EXISTS company_print_profiles (
 company_id integer PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
 revision integer NOT NULL DEFAULT 0,
 profile jsonb NOT NULL DEFAULT '{}',
 updated_by integer REFERENCES users(id),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS company_print_profile_audit (
 id serial PRIMARY KEY,
 company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 user_id integer NOT NULL REFERENCES users(id),
 before_value jsonb NOT NULL,
 after_value jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS document_issuer_snapshots (
 company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 document_kind text NOT NULL CHECK(document_kind IN ('invoice','pos','credit','refund','closing')),
 document_id integer NOT NULL,
 issuer jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(company_id,document_kind,document_id)
);
CREATE TABLE IF NOT EXISTS company_print_logos (
 object_key text PRIMARY KEY,
 company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 digest text NOT NULL,
 content_type text NOT NULL CHECK(content_type IN ('image/png','image/jpeg')),
 created_at timestamptz NOT NULL DEFAULT now()
);
