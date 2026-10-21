-- Unknown legacy bank/report owners stay NULL (quarantined), never assigned
-- to the first company or inferred from a shared user's current membership.
ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS company_id integer REFERENCES companies(id) ON DELETE RESTRICT;
ALTER TABLE report_definitions ADD COLUMN IF NOT EXISTS company_id integer REFERENCES companies(id) ON DELETE RESTRICT;
ALTER TABLE fiscal_years ADD COLUMN IF NOT EXISTS company_id integer REFERENCES companies(id) ON DELETE RESTRICT;
ALTER TABLE fiscal_periods ADD COLUMN IF NOT EXISTS code text;
ALTER TABLE fiscal_years DROP CONSTRAINT IF EXISTS fiscal_years_name_key;
ALTER TABLE fiscal_years DROP CONSTRAINT IF EXISTS fiscal_years_name_uniq;
CREATE UNIQUE INDEX IF NOT EXISTS fiscal_years_company_name ON fiscal_years(company_id, name);
CREATE INDEX IF NOT EXISTS bank_accounts_company_idx ON bank_accounts(company_id);
CREATE INDEX IF NOT EXISTS report_definitions_company_idx ON report_definitions(company_id);

-- Calendar definitions were global. Copy their controls conservatively for
-- each existing company; never let one company's close affect another.
INSERT INTO fiscal_years(company_id, name, start_date, end_date, status, closed_at, closed_by)
SELECT c.id, y.name, y.start_date, y.end_date, y.status, y.closed_at, y.closed_by
FROM companies c CROSS JOIN fiscal_years y
WHERE y.company_id IS NULL
ON CONFLICT (company_id, name) DO NOTHING;

INSERT INTO fiscal_periods(fiscal_year_id, code, name, start_date, end_date, status, closed_at, closed_by)
SELECT owned.id, p.code, p.name, p.start_date, p.end_date, p.status, p.closed_at, p.closed_by
FROM fiscal_periods p
JOIN fiscal_years legacy ON legacy.id = p.fiscal_year_id AND legacy.company_id IS NULL
JOIN fiscal_years owned ON owned.name = legacy.name AND owned.company_id IS NOT NULL
WHERE NOT EXISTS (
 SELECT 1 FROM fiscal_periods existing
 WHERE existing.fiscal_year_id = owned.id AND existing.start_date = p.start_date AND existing.end_date = p.end_date
);

UPDATE journal_entries je SET period_id = target.id
FROM fiscal_periods old
JOIN fiscal_years legacy ON legacy.id = old.fiscal_year_id AND legacy.company_id IS NULL
JOIN fiscal_years owned ON owned.name = legacy.name AND owned.company_id IS NOT NULL
JOIN fiscal_periods target ON target.fiscal_year_id = owned.id
 AND target.start_date = old.start_date AND target.end_date = old.end_date
WHERE je.period_id = old.id AND je.company_id = owned.company_id;
