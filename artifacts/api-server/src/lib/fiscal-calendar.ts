import { pool } from "@workspace/db";

/** Same default calendar as before, with independent controls for each tenant. */
export async function seedCompanyFiscalCalendar(companyId: number): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(81327, $1)", [companyId]);
    const current = new Date().getUTCFullYear();
    for (const year of [current - 1, current]) {
      const { rows } = await client.query(
        `INSERT INTO fiscal_years(company_id, name, start_date, end_date)
         VALUES ($1, $2, $3, $4) ON CONFLICT (company_id, name)
         DO UPDATE SET name = EXCLUDED.name RETURNING id, status`,
        [companyId, String(year), `${year}-01-01`, `${year}-12-31`],
      );
      for (let m = 0; m <= 12; m++) {
        const annual = m === 12;
        const start = annual ? `${year}-01-01` : new Date(Date.UTC(year, m, 1)).toISOString().slice(0, 10);
        const end = annual ? `${year}-12-31` : new Date(Date.UTC(year, m + 1, 0)).toISOString().slice(0, 10);
        const code = annual ? `${year}-Y` : `${year}-M${String(m + 1).padStart(2, "0")}`;
        await client.query(
          `INSERT INTO fiscal_periods(fiscal_year_id, code, name, start_date, end_date, status)
           SELECT $1, $2, $2, $3, $4, $5 WHERE NOT EXISTS (
             SELECT 1 FROM fiscal_periods WHERE fiscal_year_id = $1 AND start_date = $3 AND end_date = $4
           )`, [rows[0].id, code, start, end, rows[0].status],
        );
      }
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
