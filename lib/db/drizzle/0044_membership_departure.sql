-- Null means no explicit departure evidence. Do not infer restoration authority
-- for historical missing memberships from a generic suspended status.
ALTER TABLE employee_access ADD COLUMN membership_departure text
  CHECK (membership_departure IN ('suspend','terminate'));
