import { it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { pool } from "@workspace/db";

it("migrates shared fiscal controls conservatively, remaps journals, and quarantines unowned bank/report data", async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: companies } = await client.query(
      "INSERT INTO companies(name) VALUES ('migration A'), ('migration B') RETURNING id",
    );
    const { rows: years } = await client.query(
      `INSERT INTO fiscal_years(name, start_date, end_date, status)
       VALUES ('migration legacy', '1997-01-01', '1997-12-31', 'closed') RETURNING id`,
    );
    const { rows: periods } = await client.query(
      `INSERT INTO fiscal_periods(fiscal_year_id, code, name, start_date, end_date, status)
       VALUES ($1, '1997-M01', 'legacy', '1997-01-01', '1997-01-31', 'closed') RETURNING id`, [years[0].id],
    );
    const { rows: entries } = await client.query(
      `INSERT INTO journal_entries(company_id, entry_number, entry_date, period_id, description)
       VALUES ($1, 'migration synthetic', '1997-01-02', $2, 'synthetic') RETURNING id`,
      [companies[0].id, periods[0].id],
    );
    const { rows: banks } = await client.query(
      `INSERT INTO bank_accounts(name, bank_name, account_number, gl_account_id)
       SELECT 'legacy', 'synthetic', 'synthetic', id FROM accounts WHERE system_key = 'bank' RETURNING id`,
    );
    const { rows: reports } = await client.query(
      `INSERT INTO report_definitions(name, data_source, owner_user_id)
       VALUES ('legacy', 'journal_entries', 0) RETURNING id`,
    );
    const migration = await readFile(new URL("../../../../lib/db/drizzle/0017_finance_reporting_tenants.sql", import.meta.url), "utf8");
    await client.query(migration);
    await client.query(migration); // Safe on repeated application.
    const { rows: owned } = await client.query(
      "SELECT id, company_id, status FROM fiscal_years WHERE name = 'migration legacy' AND company_id = ANY($1)", [companies.map(c => c.id)],
    );
    expect(owned).toHaveLength(2);
    expect(owned.every(y => y.status === "closed")).toBe(true);
    const { rows: linked } = await client.query(
      `SELECT fy.company_id, fp.status FROM journal_entries je
       JOIN fiscal_periods fp ON fp.id = je.period_id JOIN fiscal_years fy ON fy.id = fp.fiscal_year_id
       WHERE je.id = $1`, [entries[0].id],
    );
    expect(linked).toEqual([{ company_id: companies[0].id, status: "closed" }]);
    const { rows: bank } = await client.query("SELECT company_id FROM bank_accounts WHERE id = $1", [banks[0].id]);
    const { rows: report } = await client.query("SELECT company_id FROM report_definitions WHERE id = $1", [reports[0].id]);
    expect(bank[0].company_id).toBeNull();
    expect(report[0].company_id).toBeNull();
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});
