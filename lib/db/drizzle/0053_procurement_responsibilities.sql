-- Expand the SAME grants/templates; do not adopt or broaden any existing grant.
ALTER TABLE responsibility_grants DROP CONSTRAINT responsibility_grants_resource_check;
ALTER TABLE responsibility_grants ADD CONSTRAINT responsibility_grants_resource_check
 CHECK(resource IN ('inventory','pos','procurement'));
ALTER TABLE team_permission_templates DROP CONSTRAINT team_permission_templates_resource_check;
ALTER TABLE team_permission_templates ADD CONSTRAINT team_permission_templates_resource_check
 CHECK(resource IN ('inventory','pos','procurement'));
-- No entitlement backfill: configured companies explicitly enable the module.
