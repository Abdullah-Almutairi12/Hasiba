-- Task #198: Remember more admin panel preferences across reloads.
--
-- Adds a nullable `admin_prefs` JSONB column on `users` to persist
-- per-admin UI state for the /admin panel (selected top-level tab,
-- cleanup-runs date filter, ...) across reloads. The shape is opaque
-- to the database — the application route validates keys with Zod
-- (see `admin_prefs_patch_schema` in routes/admin.ts), so future
-- preferences land without further migrations.
--
-- Nullable: NULL == "no remembered prefs yet" → the admin page falls
-- back to its built-in defaults. The route also resets the column to
-- NULL whenever the resulting bag has no remembered values, so empty
-- rows don't accumulate `{}` JSON noise.
--
-- Statement is idempotent: re-applying on a database that already has
-- the column (e.g. one pushed via `drizzle-kit push`) is a no-op.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "admin_prefs" jsonb;
