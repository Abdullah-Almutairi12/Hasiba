-- Existing decisions stay historical. No guessed authority is backfilled.
ALTER TABLE approval_actions ADD COLUMN IF NOT EXISTS authority_fingerprint text;

-- A short, transaction-scoped fence covers authorization rows AND absent rows
-- (new grants/delegations), including direct SQL/import writers. Writers acquire
-- it BEFORE taking row locks; approval readers acquire it before source locks.
-- This intentionally conservative global fence serializes authorization edits
-- against sensitive decisions, not ordinary reads or concurrent checkouts.
CREATE OR REPLACE FUNCTION approval_authority_write_fence_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(174223, 35);
  RETURN NULL;
END;
$$;

DO $$
DECLARE relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'users', 'user_companies', 'companies', 'return_access',
    'approver_delegations', 'financial_limits'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS approval_authority_write_fence_v1 ON %I', relation_name);
    EXECUTE format(
      'CREATE TRIGGER approval_authority_write_fence_v1 BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION approval_authority_write_fence_v1()',
      relation_name
    );
  END LOOP;
END;
$$;
