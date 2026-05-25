-- Task #183: Remember each manager's preferred branch across devices.
--
-- Adds a nullable `preferred_branch_id` column on `users` so the
-- Retail liquidity view (and any future per-user preferences) can
-- auto-select the manager's chosen branch on every device/browser.
--
-- Nullable + no FK on purpose:
--   * NULL == "no preference yet" → fall back to existing behaviour
--     (single-branch auto-select, otherwise the all-branches rollup).
--   * The application layer validates the branch is still active and
--     accessible before applying it on load, so a stale id never
--     surfaces in the UI. Skipping the FK keeps branch hard-deletes
--     from cascading into user rows.
--
-- Statement is idempotent: re-applying on a database that already
-- has the column (e.g. one pushed via `drizzle-kit push`) is a no-op.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "preferred_branch_id" integer;
