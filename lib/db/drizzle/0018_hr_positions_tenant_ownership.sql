-- Earlier writes accepted arbitrary department IDs, so even a department
-- reference does not establish who authored a legacy position. Preserve old
-- rows as unowned/inaccessible until ownership can be explicitly verified.
ALTER TABLE positions ADD COLUMN IF NOT EXISTS company_id integer REFERENCES companies(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS positions_company_idx ON positions(company_id);
