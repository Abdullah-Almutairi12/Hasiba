-- These previously global records have no reliable historical tenant owner.
-- Do not infer one from BoMs/operations: those links accepted arbitrary IDs.
ALTER TABLE work_centers ADD COLUMN IF NOT EXISTS company_id integer REFERENCES companies(id) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE routings ADD COLUMN IF NOT EXISTS company_id integer REFERENCES companies(id) ON DELETE RESTRICT;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS work_centers_company_idx ON work_centers(company_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS routings_company_idx ON routings(company_id);
