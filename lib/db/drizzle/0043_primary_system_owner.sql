-- Explicit subscriber-appointed account responsibility, never inferred from owner.
ALTER TABLE company_administrators ADD COLUMN primary_owner boolean NOT NULL DEFAULT false;
ALTER TABLE company_administrators ADD COLUMN may_appoint_primary_owner boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX company_one_primary_system_owner ON company_administrators(company_id) WHERE primary_owner;
ALTER TABLE administration_handovers ADD COLUMN owner_transfer boolean NOT NULL DEFAULT false;
