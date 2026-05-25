import { pool } from "@workspace/db";
import { seedDefaultChartOfAccounts } from "./coa-template";

/**
 * Per-company provisioning + validation helpers used by Multi-Company
 * Phase 3 (routes/companies.ts). Kept SRP and pure so they can be unit
 * tested without spinning the Express stack.
 */

/**
 * Tables that hold "active business data" for a tenant. Used by
 * {@link countActiveDataForCompany} to refuse soft-deletes of a company
 * that still has live records and prevent silent data orphaning.
 */
const ACTIVE_DATA_TABLES = [
  "invoices",
  "pos_orders",
  "journal_entries",
] as const;
export type ActiveDataTable = (typeof ACTIVE_DATA_TABLES)[number];

/**
 * Row counts per scoped business table for a given company. Zeros are
 * always returned for unknown tables. Counts run in parallel for speed.
 */
export async function countActiveDataForCompany(
  companyId: number,
): Promise<Record<ActiveDataTable, number>> {
  const results = await Promise.all(
    ACTIVE_DATA_TABLES.map(async (table) => {
      const { rows } = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM ${table} WHERE company_id = $1`,
        [companyId],
      );
      return [table, Number(rows[0]?.n ?? 0)] as const;
    }),
  );
  return Object.fromEntries(results) as Record<ActiveDataTable, number>;
}

/** Provision a brand-new company: seed default CoA. */
export async function provisionNewCompany(_companyId: number): Promise<void> {
  // CoA seeding is currently global (accounts.code is uniquely indexed
  // across all tenants). The helper is still idempotent and a no-op after
  // the first run. See lib/coa-template.ts for the migration plan.
  await seedDefaultChartOfAccounts();
}

/**
 * True when the database currently has at least one row with
 * `is_active = true` in `companies`. Used to forbid soft-deleting the
 * last remaining tenant.
 */
export async function countActiveCompanies(): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM companies WHERE is_active = true`,
  );
  return Number(rows[0]?.n ?? 0);
}
