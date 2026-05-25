/**
 * Idempotent migration that backfills the FX-analysis columns added
 * to `intercompany_imbalances` by the Smart Multi-Currency Variance
 * Analysis phase. Runs on every boot via `app.ts` — uses ADD COLUMN
 * IF NOT EXISTS so it is safe to run on fresh and already-migrated
 * databases alike.
 */

import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "./logger";

const STATEMENTS = [
  `ALTER TABLE intercompany_imbalances ADD COLUMN IF NOT EXISTS source_currency_code text`,
  `ALTER TABLE intercompany_imbalances ADD COLUMN IF NOT EXISTS target_currency_code text`,
  `ALTER TABLE intercompany_imbalances ADD COLUMN IF NOT EXISTS source_exchange_rate numeric(18,8)`,
  `ALTER TABLE intercompany_imbalances ADD COLUMN IF NOT EXISTS current_exchange_rate numeric(18,8)`,
  `ALTER TABLE intercompany_imbalances ADD COLUMN IF NOT EXISTS fx_variance_amount numeric(18,4)`,
  `ALTER TABLE intercompany_imbalances ADD COLUMN IF NOT EXISTS operational_variance_amount numeric(18,4)`,
  `ALTER TABLE intercompany_imbalances ADD COLUMN IF NOT EXISTS fx_settlement_journal_id integer`,
  `ALTER TABLE intercompany_imbalances ADD COLUMN IF NOT EXISTS fx_settled_at timestamp`,
  `ALTER TABLE intercompany_imbalances ADD COLUMN IF NOT EXISTS fx_settled_by integer`,
];

let initialized = false;

/** Apply the FX columns once per process. Subsequent calls are no-ops. */
export async function initIntercompanyImbalanceFxColumns(): Promise<void> {
  if (initialized) return;
  try {
    for (const stmt of STATEMENTS) {
      await db.execute(sql.raw(stmt));
    }
    initialized = true;
  } catch (err) {
    logger.error({ err }, "intercompany imbalance FX init failed");
  }
}
