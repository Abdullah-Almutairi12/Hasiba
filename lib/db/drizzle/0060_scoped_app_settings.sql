ALTER TABLE app_settings ADD COLUMN company_id integer REFERENCES companies(id);
ALTER TABLE app_settings ADD COLUMN branch_id integer REFERENCES branches(id);
ALTER TABLE app_settings ADD COLUMN revision integer NOT NULL DEFAULT 0 CHECK(revision>=0);
ALTER TABLE app_settings ADD CONSTRAINT app_settings_branch_owner CHECK(branch_id IS NULL OR company_id IS NOT NULL);
CREATE UNIQUE INDEX app_settings_owner_scope ON app_settings(company_id,coalesce(branch_id,0)) WHERE company_id IS NOT NULL;
-- Reserve the historic platform singleton; never adopt or copy its payload.
SELECT setval('app_settings_id_seq',greatest(
 coalesce((SELECT max(id) FROM app_settings),1),
 (SELECT last_value FROM app_settings_id_seq),1),true);
CREATE TABLE app_settings_versions(
 id serial PRIMARY KEY, company_id integer NOT NULL REFERENCES companies(id),
 branch_id integer REFERENCES branches(id), revision integer NOT NULL,
 parent_revision integer NOT NULL, changed_sections jsonb NOT NULL,
 created_by integer NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX app_settings_versions_scope ON app_settings_versions(company_id,coalesce(branch_id,0),revision);
CREATE FUNCTION app_settings_scope_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.company_id IS DISTINCT FROM OLD.company_id OR NEW.branch_id IS DISTINCT FROM OLD.branch_id)
 THEN RAISE EXCEPTION 'Settings ownership is immutable'; END IF;
 IF NEW.company_id IS NOT NULL AND NEW.branch_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM branches WHERE id=NEW.branch_id AND company_id=NEW.company_id)
 THEN RAISE EXCEPTION 'Settings branch owner mismatch'; END IF;
 IF TG_OP='UPDATE' AND NEW.company_id IS NOT NULL AND NEW.revision<>OLD.revision+1
 THEN RAISE EXCEPTION 'Settings revision must advance once'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER app_settings_scope_guard BEFORE INSERT OR UPDATE ON app_settings FOR EACH ROW EXECUTE FUNCTION app_settings_scope_guard();
CREATE FUNCTION app_settings_versions_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Settings version evidence is immutable'; END $$;
CREATE TRIGGER app_settings_versions_immutable BEFORE UPDATE OR DELETE ON app_settings_versions FOR EACH ROW EXECUTE FUNCTION app_settings_versions_immutable();
