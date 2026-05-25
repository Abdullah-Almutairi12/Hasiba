/**
 * Multi-Company Phase 1 backfill.
 *
 * Idempotently:
 *   1. Creates the `companies` and `user_companies` tables.
 *   2. Adds nullable `company_id` columns (+ FKs) to every shared table.
 *   3. Seeds a single "Main Company" row from `company_settings` if no
 *      company exists yet.
 *   4. Backfills every existing row with the default company id.
 *   5. Inserts a `user_companies` row per existing user (isDefault=true).
 *
 * This script runs from `scripts/post-merge.sh` BEFORE `drizzle-kit push`,
 * so push sees nothing new to migrate for our additions. We do the SQL
 * by hand because drizzle-kit push prompts interactively on this repo and
 * cannot be auto-answered from the post-merge runner.
 */
import { pool } from "@workspace/db";

/** Tables that gain a nullable `company_id` column in Phase 1. */
const SCOPED_TABLES = [
  "branches",
  "warehouses",
  "products",
  "customers",
  "suppliers",
  "invoices",
  "journal_entries",
  "pos_orders",
  "employees",
  "projects",
  "campaigns",
  "leads",
  "alerts",
  "audit_logs",
  "sales_email_outbox",
  "procurement_email_outbox",
] as const;

/**
 * Creates the companies/user_companies tables if they don't exist.
 */
async function createCompaniesTables(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS companies (
      id              serial PRIMARY KEY,
      name            text NOT NULL,
      name_en         text,
      vat_number      text,
      cr_number       text,
      base_currency   text NOT NULL DEFAULT 'SAR',
      fiscal_year_start_month integer NOT NULL DEFAULT 1,
      logo_url        text,
      address         jsonb NOT NULL DEFAULT '{}'::jsonb,
      is_active       boolean NOT NULL DEFAULT true,
      created_at      timestamp NOT NULL DEFAULT now(),
      updated_at      timestamp NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS user_companies (
      id          serial PRIMARY KEY,
      user_id     integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      company_id  integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      role        text NOT NULL,
      is_default  boolean NOT NULL DEFAULT false,
      created_at  timestamp NOT NULL DEFAULT now()
    );

    CREATE UNIQUE INDEX IF NOT EXISTS user_companies_user_company_unique
      ON user_companies (user_id, company_id);
  `);
}

/**
 * Adds nullable `company_id integer REFERENCES companies(id)` to every
 * shared table if the column or table exists. Skips tables that aren't
 * provisioned yet (e.g. outbox tables created by route init code).
 */
async function addCompanyIdColumns(): Promise<void> {
  for (const tableName of SCOPED_TABLES) {
    const exists = await pool.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = $1
       ) AS exists`,
      [tableName],
    );
    if (!exists.rows[0]?.exists) {
      // Outbox tables and a few module tables are provisioned lazily by
      // route init code; they'll pick up the column on next boot through
      // their own ALTER TABLE IF NOT EXISTS guards (added separately).
      continue;
    }
    await pool.query(
      `ALTER TABLE ${tableName} ADD COLUMN IF NOT EXISTS company_id integer`,
    );
    // Add FK only if missing — Postgres has no IF NOT EXISTS for constraints.
    const fkName = `${tableName}_company_id_fkey`;
    const hasFk = await pool.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM pg_constraint WHERE conname = $1
       ) AS exists`,
      [fkName],
    );
    if (!hasFk.rows[0]?.exists) {
      await pool.query(
        `ALTER TABLE ${tableName}
           ADD CONSTRAINT ${fkName}
           FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL`,
      );
    }
  }
}

/**
 * Returns the id of the default company, creating one from company_settings
 * (or a hard-coded default) if no company exists yet.
 */
async function ensureDefaultCompany(): Promise<number> {
  const existing = await pool.query<{ id: number }>(
    "SELECT id FROM companies ORDER BY id ASC LIMIT 1",
  );
  if (existing.rows[0]) return existing.rows[0].id;

  const hasSettings = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'company_settings'
     ) AS exists`,
  );
  let s:
    | {
        name_ar: string | null;
        name_en: string | null;
        vat_number: string | null;
        logo_object_key: string | null;
      }
    | undefined;
  if (hasSettings.rows[0]?.exists) {
    const settings = await pool.query<{
      name_ar: string | null;
      name_en: string | null;
      vat_number: string | null;
      logo_object_key: string | null;
    }>(
      `SELECT name_ar, name_en, vat_number, logo_object_key
         FROM company_settings ORDER BY id ASC LIMIT 1`,
    );
    s = settings.rows[0];
  }
  const name = s?.name_ar?.trim() || s?.name_en?.trim() || "الشركة الرئيسية";
  const inserted = await pool.query<{ id: number }>(
    `INSERT INTO companies (name, name_en, vat_number, logo_url, is_active)
     VALUES ($1, $2, $3, $4, true)
     RETURNING id`,
    [name, s?.name_en ?? null, s?.vat_number ?? null, s?.logo_object_key ?? null],
  );
  return inserted.rows[0]!.id;
}

/** Backfills every existing row's company_id to the default company. */
async function backfillExistingRows(defaultCompanyId: number): Promise<void> {
  for (const tableName of SCOPED_TABLES) {
    const exists = await pool.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = $1 AND column_name = 'company_id'
       ) AS exists`,
      [tableName],
    );
    if (!exists.rows[0]?.exists) continue;
    await pool.query(
      `UPDATE ${tableName} SET company_id = $1 WHERE company_id IS NULL`,
      [defaultCompanyId],
    );
  }
}

/** Ensures every active user has a user_companies row for the default company. */
async function backfillUserCompanies(defaultCompanyId: number): Promise<void> {
  await pool.query(
    `INSERT INTO user_companies (user_id, company_id, role, is_default)
     SELECT u.id, $1, u.role, true
       FROM users u
      WHERE NOT EXISTS (
        SELECT 1 FROM user_companies uc
         WHERE uc.user_id = u.id AND uc.company_id = $1
      )`,
    [defaultCompanyId],
  );
}

/** Top-level entrypoint — safe to call repeatedly. */
async function main(): Promise<void> {
  await createCompaniesTables();
  await addCompanyIdColumns();
  const defaultCompanyId = await ensureDefaultCompany();
  await backfillExistingRows(defaultCompanyId);
  await backfillUserCompanies(defaultCompanyId);
  // eslint-disable-next-line no-console
  console.log(
    `[multi-company] backfill complete (default company id=${defaultCompanyId})`,
  );
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    // eslint-disable-next-line no-console
    console.error("[multi-company] backfill failed:", err);
    await pool.end();
    process.exit(1);
  });
