import { pool } from "@workspace/db";
import { logger } from "./logger";

/**
 * Boot-time initialization of the Sales (Q2C) and CRM subsystems.
 *
 * - Extends `customers` with segment, default_pricelist_id, payment_terms_days,
 *   credit_limit, tax_number, billing/shipping addresses.
 * - Seeds Accounts Receivable (1200), Sales Discount (4900) and
 *   Commission Expense (5400) accounts.
 * - Creates pricelists / discount_rules / commission_plans tables and seeds
 *   a default retail pricelist and one default opportunity pipeline.
 * - Creates quotations / sales_orders / delivery_orders / customer_invoices /
 *   customer_receipts / credit_notes / opportunities tables idempotently.
 *
 * All steps are idempotent and safe to run on every boot.
 */
export async function initSales(): Promise<void> {
  // 1) Extend customers.
  await pool.query(`
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS segment text NOT NULL DEFAULT 'retail';
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS default_pricelist_id integer;
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS payment_terms_days integer NOT NULL DEFAULT 0;
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS credit_limit numeric(18,2) NOT NULL DEFAULT 0;
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS tax_number text;
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS billing_address text;
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS shipping_address text;
  `);

  // 2) Seed sales-related accounts (AR, sales discount, commission expense).
  await pool.query(`
    INSERT INTO accounts (code, name, name_ar, type, parent_id, is_group, system_key)
    SELECT '1200', 'Accounts Receivable', 'الذمم المدينة (العملاء)', 'asset',
           (SELECT id FROM accounts WHERE code = '1100'), false, 'ar'
     WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE system_key = 'ar');

    INSERT INTO accounts (code, name, name_ar, type, parent_id, is_group, system_key)
    SELECT '4900', 'Sales Discounts', 'خصومات مبيعات ممنوحة', 'revenue',
           (SELECT id FROM accounts WHERE code = '4000'), false, 'sales_discount'
     WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE system_key = 'sales_discount');

    INSERT INTO accounts (code, name, name_ar, type, parent_id, is_group, system_key)
    SELECT '5400', 'Sales Commission Expense', 'مصروف عمولات مبيعات', 'expense',
           (SELECT id FROM accounts WHERE code = '5000'), false, 'commission_expense'
     WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE system_key = 'commission_expense');

    INSERT INTO accounts (code, name, name_ar, type, parent_id, is_group, system_key)
    SELECT '2300', 'Commissions Payable', 'عمولات مستحقة الدفع', 'liability',
           (SELECT id FROM accounts WHERE code = '2100'), false, 'commission_payable'
     WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE system_key = 'commission_payable');

    INSERT INTO accounts (code, name, name_ar, type, parent_id, is_group, system_key)
    SELECT '4915', 'Sales Returns', 'مردودات المبيعات', 'revenue',
           (SELECT id FROM accounts WHERE code = '4000'), false, 'sales_returns'
     WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE system_key = 'sales_returns');
  `);

  // 3) Pricelists, items, discount rules, commission plans.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pricelists (
      id serial PRIMARY KEY,
      name text NOT NULL,
      name_ar text NOT NULL,
      currency_code text NOT NULL DEFAULT 'SAR',
      segment text,
      start_date date,
      end_date date,
      is_active boolean NOT NULL DEFAULT true,
      is_default boolean NOT NULL DEFAULT false,
      created_at timestamp NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS pricelist_items (
      id serial PRIMARY KEY,
      pricelist_id integer NOT NULL REFERENCES pricelists(id) ON DELETE CASCADE,
      product_id integer REFERENCES products(id) ON DELETE CASCADE,
      min_quantity numeric(18,4) NOT NULL DEFAULT 1,
      unit_price numeric(18,4) NOT NULL,
      discount_pct numeric(5,2)
    );
    CREATE INDEX IF NOT EXISTS pricelist_items_list_idx ON pricelist_items (pricelist_id);
    CREATE INDEX IF NOT EXISTS pricelist_items_product_idx ON pricelist_items (product_id);

    CREATE TABLE IF NOT EXISTS discount_rules (
      id serial PRIMARY KEY,
      name text NOT NULL,
      name_ar text NOT NULL,
      kind text NOT NULL DEFAULT 'percent',
      value numeric(18,4) NOT NULL DEFAULT 0,
      scope text NOT NULL DEFAULT 'line',
      reason_code text NOT NULL,
      account_system_key text NOT NULL DEFAULT 'sales_discount',
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamp NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS commission_plans (
      id serial PRIMARY KEY,
      name text NOT NULL,
      rate numeric(5,2) NOT NULL DEFAULT 0,
      quota numeric(18,2) NOT NULL DEFAULT 0,
      bonus_rate numeric(5,2) NOT NULL DEFAULT 0,
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamp NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS sales_rep_assignments (
      id serial PRIMARY KEY,
      user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      plan_id integer NOT NULL REFERENCES commission_plans(id),
      effective_from date NOT NULL,
      effective_to date,
      created_at timestamp NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    INSERT INTO pricelists (name, name_ar, segment, is_default)
    SELECT 'Default Retail', 'قائمة الأسعار العامة', 'retail', true
     WHERE NOT EXISTS (SELECT 1 FROM pricelists WHERE is_default = true);
  `);

  // 4) Quotations
  await pool.query(`
    CREATE TABLE IF NOT EXISTS quotations (
      id serial PRIMARY KEY,
      reference text NOT NULL UNIQUE,
      customer_id integer NOT NULL REFERENCES customers(id),
      customer_name text NOT NULL,
      pricelist_id integer REFERENCES pricelists(id),
      sales_rep_id integer REFERENCES users(id),
      branch_id integer REFERENCES branches(id),
      status text NOT NULL DEFAULT 'draft',
      quote_date date NOT NULL,
      valid_until date,
      currency_code text NOT NULL DEFAULT 'SAR',
      subtotal numeric(18,2) NOT NULL DEFAULT 0,
      discount numeric(18,2) NOT NULL DEFAULT 0,
      vat numeric(18,2) NOT NULL DEFAULT 0,
      total numeric(18,2) NOT NULL DEFAULT 0,
      notes text,
      sent_at timestamp,
      accepted_at timestamp,
      rejected_at timestamp,
      rejection_reason text,
      applied_discounts jsonb,
      created_by integer REFERENCES users(id),
      created_at timestamp NOT NULL DEFAULT now(),
      CONSTRAINT quotations_status_chk CHECK (status IN ('draft','sent','accepted','rejected','expired'))
    );
    CREATE INDEX IF NOT EXISTS quotations_customer_idx ON quotations (customer_id);
    CREATE INDEX IF NOT EXISTS quotations_status_idx ON quotations (status);
    -- Upgrade-path: persist discount-rule snapshot on existing rows so
    -- per-rule GL accounts survive Quote→SO→Invoice (round-16).
    ALTER TABLE quotations ADD COLUMN IF NOT EXISTS applied_discounts jsonb;

    CREATE TABLE IF NOT EXISTS quotation_lines (
      id serial PRIMARY KEY,
      quotation_id integer NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
      product_id integer REFERENCES products(id),
      description text NOT NULL,
      quantity numeric(18,4) NOT NULL,
      unit_price numeric(18,4) NOT NULL,
      discount_pct numeric(5,2) NOT NULL DEFAULT 0,
      tax_rate numeric(5,2) NOT NULL DEFAULT 15,
      line_total numeric(18,2) NOT NULL
    );
    CREATE INDEX IF NOT EXISTS quotation_lines_q_idx ON quotation_lines (quotation_id);
  `);

  // 5) Sales orders
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sales_orders (
      id serial PRIMARY KEY,
      reference text NOT NULL UNIQUE,
      quotation_id integer REFERENCES quotations(id),
      customer_id integer NOT NULL REFERENCES customers(id),
      customer_name text NOT NULL,
      pricelist_id integer REFERENCES pricelists(id),
      sales_rep_id integer REFERENCES users(id),
      branch_id integer REFERENCES branches(id),
      warehouse_id integer REFERENCES warehouses(id),
      status text NOT NULL DEFAULT 'draft',
      order_date date NOT NULL,
      expected_date date,
      currency_code text NOT NULL DEFAULT 'SAR',
      subtotal numeric(18,2) NOT NULL DEFAULT 0,
      discount numeric(18,2) NOT NULL DEFAULT 0,
      vat numeric(18,2) NOT NULL DEFAULT 0,
      total numeric(18,2) NOT NULL DEFAULT 0,
      notes text,
      source text NOT NULL DEFAULT 'manual',
      applied_discounts jsonb,
      created_by integer REFERENCES users(id),
      created_at timestamp NOT NULL DEFAULT now(),
      CONSTRAINT sales_orders_status_chk CHECK (status IN
        ('draft','confirmed','partially_delivered','fully_delivered','invoiced','done','cancelled'))
    );
    CREATE INDEX IF NOT EXISTS sales_orders_customer_idx ON sales_orders (customer_id);
    CREATE INDEX IF NOT EXISTS sales_orders_status_idx ON sales_orders (status);
    ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS applied_discounts jsonb;

    CREATE TABLE IF NOT EXISTS sales_order_lines (
      id serial PRIMARY KEY,
      so_id integer NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
      product_id integer REFERENCES products(id),
      description text NOT NULL,
      quantity numeric(18,4) NOT NULL,
      delivered_qty numeric(18,4) NOT NULL DEFAULT 0,
      invoiced_qty numeric(18,4) NOT NULL DEFAULT 0,
      unit_price numeric(18,4) NOT NULL,
      discount_pct numeric(5,2) NOT NULL DEFAULT 0,
      tax_rate numeric(5,2) NOT NULL DEFAULT 15,
      line_total numeric(18,2) NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sales_order_lines_so_idx ON sales_order_lines (so_id);
  `);

  // 6) Delivery orders
  await pool.query(`
    CREATE TABLE IF NOT EXISTS delivery_orders (
      id serial PRIMARY KEY,
      reference text NOT NULL UNIQUE,
      so_id integer NOT NULL REFERENCES sales_orders(id),
      warehouse_id integer NOT NULL REFERENCES warehouses(id),
      status text NOT NULL DEFAULT 'draft',
      delivery_date date NOT NULL,
      notes text,
      created_by integer REFERENCES users(id),
      delivered_at timestamp,
      created_at timestamp NOT NULL DEFAULT now(),
      CONSTRAINT delivery_orders_status_chk CHECK (status IN ('draft','ready','delivered','cancelled'))
    );
    CREATE INDEX IF NOT EXISTS delivery_orders_so_idx ON delivery_orders (so_id);

    CREATE TABLE IF NOT EXISTS delivery_order_lines (
      id serial PRIMARY KEY,
      do_id integer NOT NULL REFERENCES delivery_orders(id) ON DELETE CASCADE,
      so_line_id integer NOT NULL REFERENCES sales_order_lines(id),
      product_id integer REFERENCES products(id),
      description text NOT NULL,
      quantity numeric(18,4) NOT NULL
    );
  `);

  // 7) Customer invoices + receipts + allocations + credit notes
  await pool.query(`
    CREATE TABLE IF NOT EXISTS customer_invoices (
      id serial PRIMARY KEY,
      reference text NOT NULL UNIQUE,
      so_id integer REFERENCES sales_orders(id),
      customer_id integer NOT NULL REFERENCES customers(id),
      customer_name text NOT NULL,
      branch_id integer REFERENCES branches(id),
      sales_rep_id integer REFERENCES users(id),
      status text NOT NULL DEFAULT 'draft',
      invoice_date date NOT NULL,
      due_date date,
      currency_code text NOT NULL DEFAULT 'SAR',
      subtotal numeric(18,2) NOT NULL DEFAULT 0,
      discount numeric(18,2) NOT NULL DEFAULT 0,
      vat numeric(18,2) NOT NULL DEFAULT 0,
      total numeric(18,2) NOT NULL DEFAULT 0,
      amount_paid numeric(18,2) NOT NULL DEFAULT 0,
      notes text,
      zatca_qr text,
      source text NOT NULL DEFAULT 'manual',
      source_ref text,
      applied_discounts jsonb,
      created_by integer REFERENCES users(id),
      created_at timestamp NOT NULL DEFAULT now(),
      CONSTRAINT customer_invoices_status_chk CHECK (status IN
        ('draft','open','partially_paid','paid','cancelled'))
    );
    CREATE INDEX IF NOT EXISTS customer_invoices_customer_idx ON customer_invoices (customer_id);
    CREATE INDEX IF NOT EXISTS customer_invoices_status_idx ON customer_invoices (status);
    CREATE INDEX IF NOT EXISTS customer_invoices_due_idx ON customer_invoices (due_date);
    ALTER TABLE customer_invoices ADD COLUMN IF NOT EXISTS applied_discounts jsonb;

    CREATE TABLE IF NOT EXISTS customer_invoice_lines (
      id serial PRIMARY KEY,
      invoice_id integer NOT NULL REFERENCES customer_invoices(id) ON DELETE CASCADE,
      so_line_id integer REFERENCES sales_order_lines(id),
      product_id integer REFERENCES products(id),
      description text NOT NULL,
      quantity numeric(18,4) NOT NULL,
      unit_price numeric(18,4) NOT NULL,
      discount_pct numeric(5,2) NOT NULL DEFAULT 0,
      tax_rate numeric(5,2) NOT NULL DEFAULT 15,
      line_total numeric(18,2) NOT NULL
    );

    CREATE TABLE IF NOT EXISTS customer_receipts (
      id serial PRIMARY KEY,
      reference text NOT NULL UNIQUE,
      customer_id integer NOT NULL REFERENCES customers(id),
      customer_name text NOT NULL,
      receipt_date date NOT NULL,
      amount numeric(18,2) NOT NULL,
      currency_code text NOT NULL DEFAULT 'SAR',
      payment_method text NOT NULL DEFAULT 'cash',
      bank_ref text,
      journal_entry_id integer,
      created_by integer REFERENCES users(id),
      created_at timestamp NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS customer_receipt_allocations (
      id serial PRIMARY KEY,
      receipt_id integer NOT NULL REFERENCES customer_receipts(id) ON DELETE CASCADE,
      invoice_id integer NOT NULL REFERENCES customer_invoices(id),
      amount numeric(18,2) NOT NULL
    );
    CREATE INDEX IF NOT EXISTS cra_receipt_idx ON customer_receipt_allocations (receipt_id);
    CREATE INDEX IF NOT EXISTS cra_invoice_idx ON customer_receipt_allocations (invoice_id);

    CREATE TABLE IF NOT EXISTS credit_notes (
      id serial PRIMARY KEY,
      reference text NOT NULL UNIQUE,
      invoice_id integer REFERENCES customer_invoices(id),
      customer_id integer NOT NULL REFERENCES customers(id),
      customer_name text NOT NULL,
      note_date date NOT NULL,
      reason text,
      restock boolean NOT NULL DEFAULT true,
      warehouse_id integer REFERENCES warehouses(id),
      currency_code text NOT NULL DEFAULT 'SAR',
      subtotal numeric(18,2) NOT NULL DEFAULT 0,
      vat numeric(18,2) NOT NULL DEFAULT 0,
      total numeric(18,2) NOT NULL DEFAULT 0,
      status text NOT NULL DEFAULT 'draft',
      journal_entry_id integer,
      created_by integer REFERENCES users(id),
      created_at timestamp NOT NULL DEFAULT now(),
      CONSTRAINT credit_notes_status_chk CHECK (status IN ('draft','issued','applied','cancelled'))
    );

    CREATE TABLE IF NOT EXISTS credit_note_lines (
      id serial PRIMARY KEY,
      note_id integer NOT NULL REFERENCES credit_notes(id) ON DELETE CASCADE,
      invoice_line_id integer REFERENCES customer_invoice_lines(id),
      product_id integer REFERENCES products(id),
      description text NOT NULL,
      quantity numeric(18,4) NOT NULL,
      unit_price numeric(18,4) NOT NULL,
      tax_rate numeric(5,2) NOT NULL DEFAULT 15,
      line_total numeric(18,2) NOT NULL
    );
  `);

  // 8) CRM — opportunities + stages
  await pool.query(`
    CREATE TABLE IF NOT EXISTS opportunity_stages (
      id serial PRIMARY KEY,
      name text NOT NULL,
      name_ar text NOT NULL,
      sequence integer NOT NULL DEFAULT 0,
      probability integer NOT NULL DEFAULT 0,
      is_won boolean NOT NULL DEFAULT false,
      is_lost boolean NOT NULL DEFAULT false,
      is_active boolean NOT NULL DEFAULT true
    );

    CREATE TABLE IF NOT EXISTS opportunities (
      id serial PRIMARY KEY,
      name text NOT NULL,
      customer_id integer REFERENCES customers(id),
      customer_name text,
      lead_id integer,
      sales_rep_id integer REFERENCES users(id),
      stage_id integer NOT NULL REFERENCES opportunity_stages(id),
      expected_revenue numeric(18,2) NOT NULL DEFAULT 0,
      probability integer NOT NULL DEFAULT 0,
      expected_close_date date,
      closed_at timestamp,
      win_loss_reason text,
      notes text,
      created_by integer REFERENCES users(id),
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS opportunities_stage_idx ON opportunities (stage_id);
    CREATE INDEX IF NOT EXISTS opportunities_rep_idx ON opportunities (sales_rep_id);
  `);

  // Seed default opportunity stages.
  await pool.query(`
    INSERT INTO opportunity_stages (name, name_ar, sequence, probability, is_won, is_lost)
    SELECT s.name, s.name_ar, s.sequence, s.probability, s.is_won, s.is_lost
    FROM (VALUES
      ('New', 'جديد', 10, 10, false, false),
      ('Qualified', 'مؤهل', 20, 25, false, false),
      ('Proposal', 'عرض سعر', 30, 50, false, false),
      ('Negotiation', 'تفاوض', 40, 75, false, false),
      ('Won', 'فوز', 50, 100, true, false),
      ('Lost', 'خسارة', 60, 0, false, true)
    ) AS s(name, name_ar, sequence, probability, is_won, is_lost)
    WHERE NOT EXISTS (SELECT 1 FROM opportunity_stages WHERE name = s.name);
  `);

  // System "walk-in" customer for cash POS sales (no registered customer).
  // Used as the FK target so POS orders flow through the same SO/Invoice ledger.
  await pool.query(`
    INSERT INTO customers (name, phone, email, segment, payment_terms_days, credit_limit, tax_number)
    SELECT 'عميل نقدي - نقطة بيع', NULL, NULL, 'retail', 0, 0, 'POS-WALKIN'
     WHERE NOT EXISTS (SELECT 1 FROM customers WHERE tax_number = 'POS-WALKIN');
  `);

  // Email outbox — captures send attempts for quotations/invoices/etc.
  // In dev this is the durable record of every hand-off; production wiring
  // would later flush queued rows through SMTP/SES and stamp sent_at.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sales_email_outbox (
      id serial PRIMARY KEY,
      kind text NOT NULL,
      ref_id integer NOT NULL,
      reference text NOT NULL,
      recipient text NOT NULL,
      subject text NOT NULL,
      body text NOT NULL,
      status text NOT NULL DEFAULT 'queued',
      error text,
      created_by integer REFERENCES users(id),
      created_at timestamp NOT NULL DEFAULT now(),
      sent_at timestamp
    );
    CREATE INDEX IF NOT EXISTS sales_email_outbox_kind_ref_idx
      ON sales_email_outbox (kind, ref_id);
  `);

  // Split-bill payments per POS order (one row per tendered method).
  // The legacy `pos_orders.payment_method` column stays for backward
  // compatibility ('cash' / 'card' / 'transfer' / 'split'); accurate
  // method-level totals come from this table.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pos_order_payments (
      id serial PRIMARY KEY,
      order_id integer NOT NULL REFERENCES pos_orders(id) ON DELETE CASCADE,
      method text NOT NULL,
      amount numeric(10,2) NOT NULL,
      reference text,
      payer_name text,
      created_at timestamp NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS pos_order_payments_order_idx
      ON pos_order_payments (order_id);
  `);

  logger.info("Sales / CRM subsystem initialized");
}
