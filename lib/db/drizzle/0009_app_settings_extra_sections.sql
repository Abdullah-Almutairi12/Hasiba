-- Extend app_settings singleton with 6 additional jsonb sections so the
-- /settings page can host the full "expected settings" surface for
-- subscribers without future migrations.
ALTER TABLE "app_settings"
  ADD COLUMN IF NOT EXISTS "notifications"  jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS "localization"   jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS "numbering"      jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS "appearance"     jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS "backup"         jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS "templates"      jsonb NOT NULL DEFAULT '{}'::jsonb;
