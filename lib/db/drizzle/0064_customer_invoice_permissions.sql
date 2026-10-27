-- Extend the existing responsibility/template catalog only.
-- No conversion, entitlement enablement, or grant backfill for existing accounts.
ALTER TABLE responsibility_grants DROP CONSTRAINT responsibility_grants_resource_check;
ALTER TABLE responsibility_grants ADD CONSTRAINT responsibility_grants_resource_check
 CHECK(resource IN ('inventory','pos','procurement','sales'));
ALTER TABLE team_permission_templates DROP CONSTRAINT team_permission_templates_resource_check;
ALTER TABLE team_permission_templates ADD CONSTRAINT team_permission_templates_resource_check
 CHECK(resource IN ('inventory','pos','procurement','sales'));
