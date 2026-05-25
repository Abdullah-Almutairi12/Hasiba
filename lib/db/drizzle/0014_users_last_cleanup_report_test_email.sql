-- Task #202: Reconcile DB drift on `users` that broke HTTP-level tests.
--
-- The `last_cleanup_report_test_email` column was added to the Drizzle
-- schema (lib/db/src/schema/users.ts) without a matching migration, so
-- live databases were missing it. Any test that exercised the real
-- auth route (e.g. lib/tenant-http.test.ts) crashed inside
-- `SELECT ... FROM users` with "column does not exist".
--
-- Nullable text: remembers the last email address an admin sent a
-- cleanup-report test email to, so the UI can pre-fill the field on
-- next visit. NULL = "never sent one".
--
-- Statement is idempotent: re-applying on a database that already has
-- the column (e.g. one pushed via `drizzle-kit push`) is a no-op.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "last_cleanup_report_test_email" text;
