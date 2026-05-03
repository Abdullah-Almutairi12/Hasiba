import { pool } from "@workspace/db";
import { logger } from "./logger";

/**
 * Boot-time initialization of the Procurement (P2P) subsystem.
 *
 * - Extends `suppliers` with payment_terms_days, default_currency, lead_time_days.
 * - Adds the GR-IR (Goods Received Not Invoiced) clearing account, which is
 *   debited on supplier-invoice posting and credited on goods receipt.
 * - Creates all procurement tables idempotently.
 *
 * Safe to run on every boot.
 */
export async function initProcurement(): Promise<void> {
  // 1) Extend suppliers with procurement fields.
  await pool.query(`
    ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS payment_terms_days integer NOT NULL DEFAULT 30;
    ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS default_currency text NOT NULL DEFAULT 'SAR';
    ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS lead_time_days integer NOT NULL DEFAULT 7;
    ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS default_tax numeric(5,2) NOT NULL DEFAULT 15;
  `);

  // 2) Seed GR-IR account if missing. Liability — credited on receipt and
  //    debited when the supplier invoice posts.
  await pool.query(`
    INSERT INTO accounts (code, name, name_ar, type, parent_id, is_group, system_key)
    SELECT '2150', 'GR-IR Clearing', 'استلام بضائع - فواتير معلقة', 'liability',
           (SELECT id FROM accounts WHERE code = '2100'), false, 'gr_ir'
     WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE system_key = 'gr_ir')
  `);

  // 3) Create procurement tables.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS purchase_requisitions (
      id serial PRIMARY KEY,
      reference text NOT NULL UNIQUE,
      requester_id integer REFERENCES users(id),
      branch_id integer REFERENCES branches(id),
      warehouse_id integer REFERENCES warehouses(id),
      status text NOT NULL DEFAULT 'draft',
      notes text,
      approved_by integer REFERENCES users(id),
      approved_at timestamp,
      created_at timestamp NOT NULL DEFAULT now(),
      CONSTRAINT pr_status_chk CHECK (status IN ('draft','submitted','approved','rejected','converted'))
    );
    CREATE INDEX IF NOT EXISTS pr_status_idx ON purchase_requisitions (status);

    CREATE TABLE IF NOT EXISTS purchase_requisition_lines (
      id serial PRIMARY KEY,
      requisition_id integer NOT NULL REFERENCES purchase_requisitions(id) ON DELETE CASCADE,
      product_id integer REFERENCES products(id),
      description text NOT NULL,
      quantity numeric(18,4) NOT NULL,
      estimated_cost numeric(18,4) NOT NULL DEFAULT 0,
      needed_by date
    );
    CREATE INDEX IF NOT EXISTS prl_req_idx ON purchase_requisition_lines (requisition_id);

    CREATE TABLE IF NOT EXISTS rfqs (
      id serial PRIMARY KEY,
      reference text NOT NULL UNIQUE,
      requisition_id integer REFERENCES purchase_requisitions(id),
      status text NOT NULL DEFAULT 'draft',
      due_date date,
      notes text,
      awarded_supplier_id integer REFERENCES suppliers(id),
      created_by integer REFERENCES users(id),
      created_at timestamp NOT NULL DEFAULT now(),
      CONSTRAINT rfq_status_chk CHECK (status IN ('draft','sent','closed','awarded'))
    );

    CREATE TABLE IF NOT EXISTS rfq_suppliers (
      id serial PRIMARY KEY,
      rfq_id integer NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
      supplier_id integer NOT NULL REFERENCES suppliers(id),
      sent_at timestamp,
      responded_at timestamp
    );
    CREATE UNIQUE INDEX IF NOT EXISTS rfq_supplier_unique ON rfq_suppliers (rfq_id, supplier_id);

    CREATE TABLE IF NOT EXISTS rfq_quote_lines (
      id serial PRIMARY KEY,
      rfq_id integer NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
      supplier_id integer NOT NULL REFERENCES suppliers(id),
      product_id integer REFERENCES products(id),
      description text NOT NULL,
      quantity numeric(18,4) NOT NULL,
      unit_price numeric(18,4) NOT NULL,
      lead_time_days integer NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS rfq_quote_rfq_idx ON rfq_quote_lines (rfq_id);

    CREATE TABLE IF NOT EXISTS purchase_orders (
      id serial PRIMARY KEY,
      reference text NOT NULL UNIQUE,
      supplier_id integer NOT NULL REFERENCES suppliers(id),
      supplier_name text NOT NULL,
      warehouse_id integer REFERENCES warehouses(id),
      status text NOT NULL DEFAULT 'draft',
      order_date date NOT NULL,
      expected_date date,
      currency_code text NOT NULL DEFAULT 'SAR',
      exchange_rate numeric(18,8) NOT NULL DEFAULT 1,
      subtotal numeric(18,2) NOT NULL DEFAULT 0,
      vat numeric(18,2) NOT NULL DEFAULT 0,
      total numeric(18,2) NOT NULL DEFAULT 0,
      notes text,
      requisition_id integer REFERENCES purchase_requisitions(id),
      rfq_id integer REFERENCES rfqs(id),
      agreement_id integer,
      requires_approval boolean NOT NULL DEFAULT false,
      approved_by integer REFERENCES users(id),
      approved_at timestamp,
      created_by integer REFERENCES users(id),
      created_at timestamp NOT NULL DEFAULT now(),
      CONSTRAINT po_status_chk CHECK (status IN
        ('draft','confirmed','partially_received','fully_received','closed','cancelled'))
    );
    CREATE INDEX IF NOT EXISTS po_supplier_idx ON purchase_orders (supplier_id);
    CREATE INDEX IF NOT EXISTS po_status_idx ON purchase_orders (status);
    CREATE INDEX IF NOT EXISTS po_date_idx ON purchase_orders (order_date);

    CREATE TABLE IF NOT EXISTS purchase_order_lines (
      id serial PRIMARY KEY,
      po_id integer NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
      product_id integer REFERENCES products(id),
      description text NOT NULL,
      quantity numeric(18,4) NOT NULL,
      received_qty numeric(18,4) NOT NULL DEFAULT 0,
      billed_qty numeric(18,4) NOT NULL DEFAULT 0,
      unit_price numeric(18,4) NOT NULL,
      tax_rate numeric(5,2) NOT NULL DEFAULT 15,
      line_total numeric(18,2) NOT NULL
    );
    CREATE INDEX IF NOT EXISTS pol_po_idx ON purchase_order_lines (po_id);

    CREATE TABLE IF NOT EXISTS goods_receipts (
      id serial PRIMARY KEY,
      reference text NOT NULL UNIQUE,
      po_id integer NOT NULL REFERENCES purchase_orders(id),
      warehouse_id integer NOT NULL REFERENCES warehouses(id),
      received_at timestamp NOT NULL DEFAULT now(),
      received_by integer REFERENCES users(id),
      notes text
    );
    CREATE INDEX IF NOT EXISTS grn_po_idx ON goods_receipts (po_id);

    CREATE TABLE IF NOT EXISTS goods_receipt_lines (
      id serial PRIMARY KEY,
      grn_id integer NOT NULL REFERENCES goods_receipts(id) ON DELETE CASCADE,
      po_line_id integer NOT NULL REFERENCES purchase_order_lines(id),
      product_id integer NOT NULL REFERENCES products(id),
      quantity numeric(18,4) NOT NULL,
      unit_cost numeric(18,4) NOT NULL
    );
    CREATE INDEX IF NOT EXISTS grnl_grn_idx ON goods_receipt_lines (grn_id);

    CREATE TABLE IF NOT EXISTS payment_runs (
      id serial PRIMARY KEY,
      reference text NOT NULL UNIQUE,
      payment_date date NOT NULL,
      payment_method text NOT NULL DEFAULT 'bank',
      bank_account_id integer,
      total_amount numeric(18,2) NOT NULL DEFAULT 0,
      status text NOT NULL DEFAULT 'draft',
      notes text,
      created_by integer REFERENCES users(id),
      executed_at timestamp,
      created_at timestamp NOT NULL DEFAULT now(),
      CONSTRAINT pmr_status_chk CHECK (status IN ('draft','executed','cancelled')),
      CONSTRAINT pmr_method_chk CHECK (payment_method IN ('cash','bank'))
    );

    CREATE TABLE IF NOT EXISTS payment_run_lines (
      id serial PRIMARY KEY,
      run_id integer NOT NULL REFERENCES payment_runs(id) ON DELETE CASCADE,
      supplier_id integer NOT NULL REFERENCES suppliers(id),
      invoice_id integer REFERENCES invoices(id),
      amount numeric(18,2) NOT NULL,
      journal_entry_id integer
    );
    CREATE INDEX IF NOT EXISTS pmrl_run_idx ON payment_run_lines (run_id);

    CREATE TABLE IF NOT EXISTS blanket_agreements (
      id serial PRIMARY KEY,
      reference text NOT NULL UNIQUE,
      supplier_id integer NOT NULL REFERENCES suppliers(id),
      start_date date NOT NULL,
      end_date date NOT NULL,
      total_committed_value numeric(18,2) NOT NULL DEFAULT 0,
      released_value numeric(18,2) NOT NULL DEFAULT 0,
      status text NOT NULL DEFAULT 'active',
      notes text,
      created_at timestamp NOT NULL DEFAULT now(),
      CONSTRAINT ba_status_chk CHECK (status IN ('active','expired','cancelled'))
    );

    CREATE TABLE IF NOT EXISTS blanket_agreement_items (
      id serial PRIMARY KEY,
      agreement_id integer NOT NULL REFERENCES blanket_agreements(id) ON DELETE CASCADE,
      product_id integer NOT NULL REFERENCES products(id),
      agreed_price numeric(18,4) NOT NULL,
      agreed_qty numeric(18,4) NOT NULL,
      released_qty numeric(18,4) NOT NULL DEFAULT 0
    );
  `);

  // 4) Link existing invoices to a PO (3-way matching trail). Nullable so
  //    standalone supplier invoices still work.
  await pool.query(`
    ALTER TABLE invoices ADD COLUMN IF NOT EXISTS po_id integer REFERENCES purchase_orders(id);
    CREATE INDEX IF NOT EXISTS invoices_po_idx ON invoices (po_id);
  `);

  logger.info("Procurement subsystem initialized");
}
