import { pool } from "@workspace/db";
import { logger } from "./logger";

/**
 * Multi-Company Phase 5 boot init. Idempotent ALTER + CREATE statements
 * to bring an existing database in line with the Drizzle schema added in
 * lib/db/src/schema/intercompany.ts plus the four new columns on
 * customers / suppliers / customer_invoices / invoices / purchase_orders.
 *
 * Safe to run on every server boot.
 */
export async function initIntercompany(): Promise<void> {
  // Phase-5.1: widen the status check constraint to allow 'unmatched'
  // (a manual review state) on existing deployments where it was created
  // with the narrower set. DO inside a DO block so we can drop+recreate
  // safely on every boot without erroring if the constraint is absent.
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'intercompany_links'
          AND constraint_name = 'intercompany_links_status_chk'
      ) THEN
        ALTER TABLE intercompany_links DROP CONSTRAINT intercompany_links_status_chk;
        ALTER TABLE intercompany_links ADD CONSTRAINT intercompany_links_status_chk
          CHECK (status IN ('matched','unmatched','void','resynced'));
      END IF;
    END $$;
  `);
  await pool.query(`
    ALTER TABLE customers
      ADD COLUMN IF NOT EXISTS linked_company_id integer REFERENCES companies(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS customers_linked_company_idx ON customers (linked_company_id);

    ALTER TABLE suppliers
      ADD COLUMN IF NOT EXISTS linked_company_id integer REFERENCES companies(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS suppliers_linked_company_idx ON suppliers (linked_company_id);

    ALTER TABLE invoices
      ADD COLUMN IF NOT EXISTS is_intercompany boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS counterparty_company_id integer REFERENCES companies(id) ON DELETE SET NULL;

    ALTER TABLE customer_invoices
      ADD COLUMN IF NOT EXISTS is_intercompany boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS counterparty_company_id integer;

    ALTER TABLE purchase_orders
      ADD COLUMN IF NOT EXISTS is_intercompany boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS counterparty_company_id integer;

    CREATE TABLE IF NOT EXISTS intercompany_links (
      id serial PRIMARY KEY,
      kind text NOT NULL,
      source_company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      source_doc_id integer NOT NULL,
      source_ref text NOT NULL,
      target_company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      target_doc_id integer NOT NULL,
      target_ref text NOT NULL,
      status text NOT NULL DEFAULT 'matched',
      notes text,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now(),
      CONSTRAINT intercompany_links_kind_chk CHECK (kind IN ('sales_invoice','purchase_order')),
      CONSTRAINT intercompany_links_status_chk CHECK (status IN ('matched','unmatched','void','resynced'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS intercompany_links_source_unique
      ON intercompany_links (kind, source_doc_id);
    CREATE INDEX IF NOT EXISTS intercompany_links_target_idx
      ON intercompany_links (kind, target_doc_id);
    CREATE INDEX IF NOT EXISTS intercompany_links_source_company_idx
      ON intercompany_links (source_company_id);
  `);
  // Phase-6: persisted intercompany pricing-policy mismatch queue.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS intercompany_imbalances (
      id serial PRIMARY KEY,
      link_id integer NOT NULL REFERENCES intercompany_links(id) ON DELETE CASCADE,
      basis text NOT NULL,
      kind text NOT NULL,
      source_company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      source_ref text NOT NULL,
      target_company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      target_ref text NOT NULL,
      source_amount numeric(18,4) NOT NULL,
      target_amount numeric(18,4) NOT NULL,
      difference numeric(18,4) NOT NULL,
      status text NOT NULL DEFAULT 'open',
      notes text,
      detected_at timestamp NOT NULL DEFAULT now(),
      last_seen_at timestamp NOT NULL DEFAULT now(),
      resolved_at timestamp,
      resolved_by integer,
      CONSTRAINT intercompany_imbalances_basis_chk CHECK (basis IN ('subtotal','open')),
      CONSTRAINT intercompany_imbalances_status_chk CHECK (status IN ('open','resolved','ignored'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS intercompany_imbalances_link_basis_unique
      ON intercompany_imbalances (link_id, basis);
    CREATE INDEX IF NOT EXISTS intercompany_imbalances_status_idx
      ON intercompany_imbalances (status);
    CREATE INDEX IF NOT EXISTS intercompany_imbalances_source_company_idx
      ON intercompany_imbalances (source_company_id);
    CREATE INDEX IF NOT EXISTS intercompany_imbalances_target_company_idx
      ON intercompany_imbalances (target_company_id);
  `);
  // Task 150 — single-use signed action tokens embedded in the
  // morning digest email so finance can resync/ignore a row in one
  // click. See lib/db/src/schema/intercompany.ts for the contract.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS intercompany_imbalance_action_tokens (
      id serial PRIMARY KEY,
      token_hash text NOT NULL,
      imbalance_id integer NOT NULL REFERENCES intercompany_imbalances(id) ON DELETE CASCADE,
      action text NOT NULL,
      user_id integer NOT NULL,
      email text NOT NULL,
      expires_at timestamp NOT NULL,
      consumed_at timestamp,
      consumed_ip text,
      created_at timestamp NOT NULL DEFAULT now(),
      CONSTRAINT intercompany_imbalance_action_tokens_action_chk
        CHECK (action IN ('resync','ignore'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS intercompany_imbalance_action_tokens_token_idx
      ON intercompany_imbalance_action_tokens (token_hash);
    CREATE INDEX IF NOT EXISTS intercompany_imbalance_action_tokens_imbalance_idx
      ON intercompany_imbalance_action_tokens (imbalance_id);
  `);
  logger.info("intercompany subsystem initialized");
}
