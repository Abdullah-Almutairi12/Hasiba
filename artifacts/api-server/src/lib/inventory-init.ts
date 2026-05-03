import { pool } from "@workspace/db";
import { logger } from "./logger";

/**
 * Boot-time initialization of the Inventory subsystem.
 *
 * - Adds the new ledger columns to `products` (barcode, tracking_mode,
 *   costing_method, is_variant_parent).
 * - Creates the inventory tables idempotently:
 *   stock_lots, stock_serials, stock_moves, stock_quants,
 *   product_variants, product_variant_attributes, reorder_rules,
 *   stock_takes, stock_take_lines.
 * - Ensures a default warehouse exists (auto-creates one tied to the first
 *   branch if none).
 * - One-time migration: replays any non-zero `products.stock` value as a
 *   single 'receipt' stock_move into the default warehouse so legacy
 *   on-hand quantities show up in the new ledger / quants cache.
 *
 * All steps are idempotent. Failures bubble up so the server fails fast.
 */
export async function initInventory(): Promise<void> {
  // --- Add new columns to products (idempotent) ---
  await pool.query(`
    ALTER TABLE products ADD COLUMN IF NOT EXISTS barcode text;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS tracking_mode text NOT NULL DEFAULT 'none';
    ALTER TABLE products ADD COLUMN IF NOT EXISTS costing_method text NOT NULL DEFAULT 'average';
    ALTER TABLE products ADD COLUMN IF NOT EXISTS is_variant_parent boolean NOT NULL DEFAULT false;
    -- Promote products.stock from integer to numeric so the cache preserves
    -- decimal quantities recorded in the ledger (stock_quants.quantity is
    -- numeric(18,4)). Idempotent — re-running is a no-op once the column is
    -- already numeric.
    ALTER TABLE products ALTER COLUMN stock TYPE numeric(18,4) USING stock::numeric;
    ALTER TABLE products ALTER COLUMN stock SET DEFAULT 0;
    CREATE INDEX IF NOT EXISTS products_barcode_idx ON products (barcode);
  `);

  // --- Create inventory tables ---
  await pool.query(`
    CREATE TABLE IF NOT EXISTS stock_lots (
      id serial PRIMARY KEY,
      product_id integer NOT NULL REFERENCES products(id),
      lot_number text NOT NULL,
      expiry_date date,
      supplier_ref text,
      created_at timestamp NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS stock_lots_unique ON stock_lots (product_id, lot_number);
    CREATE INDEX IF NOT EXISTS stock_lots_expiry_idx ON stock_lots (expiry_date);

    CREATE TABLE IF NOT EXISTS stock_serials (
      id serial PRIMARY KEY,
      product_id integer NOT NULL REFERENCES products(id),
      serial_number text NOT NULL,
      current_warehouse_id integer REFERENCES warehouses(id),
      state text NOT NULL DEFAULT 'in_stock',
      created_at timestamp NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS stock_serials_unique ON stock_serials (product_id, serial_number);

    CREATE TABLE IF NOT EXISTS stock_moves (
      id serial PRIMARY KEY,
      product_id integer NOT NULL REFERENCES products(id),
      variant_id integer,
      from_warehouse_id integer REFERENCES warehouses(id),
      to_warehouse_id integer REFERENCES warehouses(id),
      quantity numeric(18,4) NOT NULL,
      unit_cost numeric(18,4) NOT NULL DEFAULT 0,
      lot_id integer REFERENCES stock_lots(id),
      serial_id integer REFERENCES stock_serials(id),
      kind text NOT NULL,
      state text NOT NULL DEFAULT 'done',
      source_type text,
      source_id integer,
      source_ref text,
      journal_entry_id integer,
      occurred_at timestamp NOT NULL DEFAULT now(),
      created_by integer REFERENCES users(id),
      created_at timestamp NOT NULL DEFAULT now(),
      notes text,
      CONSTRAINT stock_moves_kind_chk CHECK (kind IN ('receipt','issue','transfer','adjustment','return_in','return_out')),
      CONSTRAINT stock_moves_state_chk CHECK (state IN ('draft','in_transit','done','cancelled'))
    );
    CREATE INDEX IF NOT EXISTS stock_moves_product_idx ON stock_moves (product_id, occurred_at);
    CREATE INDEX IF NOT EXISTS stock_moves_from_idx ON stock_moves (from_warehouse_id);
    CREATE INDEX IF NOT EXISTS stock_moves_to_idx ON stock_moves (to_warehouse_id);
    CREATE INDEX IF NOT EXISTS stock_moves_kind_idx ON stock_moves (kind, state);
    CREATE INDEX IF NOT EXISTS stock_moves_source_idx ON stock_moves (source_type, source_id);

    -- FIFO cost layers. One row per "in" move for FIFO-tracked products.
    -- Issues consume rows in receipt order, decrementing remaining_qty.
    CREATE TABLE IF NOT EXISTS stock_layers (
      id serial PRIMARY KEY,
      receipt_move_id integer NOT NULL REFERENCES stock_moves(id) ON DELETE CASCADE,
      product_id integer NOT NULL REFERENCES products(id),
      warehouse_id integer NOT NULL REFERENCES warehouses(id),
      variant_id integer,
      lot_id integer REFERENCES stock_lots(id),
      unit_cost numeric(18,4) NOT NULL,
      remaining_qty numeric(18,4) NOT NULL,
      created_at timestamp NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS stock_layers_consume_idx
      ON stock_layers (product_id, warehouse_id, created_at)
      WHERE remaining_qty > 0;

    CREATE TABLE IF NOT EXISTS stock_quants (
      id serial PRIMARY KEY,
      product_id integer NOT NULL REFERENCES products(id),
      variant_id integer,
      warehouse_id integer NOT NULL REFERENCES warehouses(id),
      lot_id integer REFERENCES stock_lots(id),
      quantity numeric(18,4) NOT NULL DEFAULT 0,
      avg_cost numeric(18,4) NOT NULL DEFAULT 0,
      updated_at timestamp NOT NULL DEFAULT now()
    );
    -- Composite uniqueness includes optional variant/lot columns. Postgres
    -- treats NULLs as distinct in unique indexes, so two rows with NULL
    -- variant/lot for the same product+warehouse would *not* collide and
    -- would silently double-write. Use COALESCE to coerce NULL to 0 so the
    -- "no variant / no lot" rows for a given (product, warehouse) collapse
    -- to a single quant row, which is what stock-engine.upsertQuant relies on.
    CREATE UNIQUE INDEX IF NOT EXISTS stock_quants_unique
      ON stock_quants (product_id, warehouse_id, COALESCE(variant_id, 0), COALESCE(lot_id, 0));
    CREATE INDEX IF NOT EXISTS stock_quants_warehouse_idx ON stock_quants (warehouse_id);

    CREATE TABLE IF NOT EXISTS product_variants (
      id serial PRIMARY KEY,
      product_id integer NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      sku text NOT NULL UNIQUE,
      barcode text,
      attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
      price numeric(10,2),
      cost_price numeric(10,2),
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamp NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS product_variants_product_idx ON product_variants (product_id);
    CREATE INDEX IF NOT EXISTS product_variants_barcode_idx ON product_variants (barcode);

    CREATE TABLE IF NOT EXISTS product_variant_attributes (
      id serial PRIMARY KEY,
      product_id integer NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      name text NOT NULL,
      name_ar text NOT NULL,
      values jsonb NOT NULL DEFAULT '[]'::jsonb
    );
    CREATE INDEX IF NOT EXISTS product_variant_attrs_product_idx ON product_variant_attributes (product_id);

    CREATE TABLE IF NOT EXISTS reorder_rules (
      id serial PRIMARY KEY,
      product_id integer NOT NULL REFERENCES products(id),
      warehouse_id integer NOT NULL REFERENCES warehouses(id),
      min_qty numeric(18,4) NOT NULL DEFAULT 0,
      max_qty numeric(18,4) NOT NULL DEFAULT 0,
      eoq numeric(18,4) NOT NULL DEFAULT 0,
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamp NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS reorder_rules_unique ON reorder_rules (product_id, warehouse_id);

    CREATE TABLE IF NOT EXISTS stock_takes (
      id serial PRIMARY KEY,
      reference text NOT NULL UNIQUE,
      warehouse_id integer NOT NULL REFERENCES warehouses(id),
      status text NOT NULL DEFAULT 'draft',
      notes text,
      started_at timestamp NOT NULL DEFAULT now(),
      completed_at timestamp,
      completed_by integer REFERENCES users(id),
      created_by integer REFERENCES users(id),
      CONSTRAINT stock_takes_status_chk CHECK (status IN ('draft','in_progress','done','cancelled'))
    );

    CREATE TABLE IF NOT EXISTS stock_take_lines (
      id serial PRIMARY KEY,
      stock_take_id integer NOT NULL REFERENCES stock_takes(id) ON DELETE CASCADE,
      product_id integer NOT NULL REFERENCES products(id),
      variant_id integer,
      lot_id integer REFERENCES stock_lots(id),
      expected_qty numeric(18,4) NOT NULL DEFAULT 0,
      counted_qty numeric(18,4),
      unit_cost numeric(18,4) NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS stock_take_lines_take_idx ON stock_take_lines (stock_take_id);
  `);

  // --- Make sure a default warehouse exists ---
  await pool.query(`
    DO $$
    DECLARE
      bid integer;
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM warehouses) THEN
        SELECT id INTO bid FROM branches ORDER BY id LIMIT 1;
        IF bid IS NULL THEN
          INSERT INTO branches (name, name_ar, city)
          VALUES ('Main Branch', 'الفرع الرئيسي', 'الرياض')
          RETURNING id INTO bid;
        END IF;
        INSERT INTO warehouses (branch_id, name, name_ar, is_default)
          VALUES (bid, 'Main Warehouse', 'المستودع الرئيسي', true);
      ELSIF NOT EXISTS (SELECT 1 FROM warehouses WHERE is_default = true) THEN
        UPDATE warehouses SET is_default = true
          WHERE id = (SELECT id FROM warehouses ORDER BY id LIMIT 1);
      END IF;
    END $$;
  `);

  // --- One-time legacy migration: products.stock -> stock_moves + quants ---
  // We mark the migration as done by inserting a single sentinel row in
  // stock_moves with source_type='legacy_seed' for any product. We just check
  // for that existence to skip rerun.
  const { rows: seeded } = await pool.query(
    `SELECT 1 FROM stock_moves WHERE source_type = 'legacy_seed' LIMIT 1`,
  );
  if (seeded.length === 0) {
    const { rows: defWh } = await pool.query(
      `SELECT id FROM warehouses WHERE is_default = true ORDER BY id LIMIT 1`,
    );
    const defaultWarehouseId = defWh[0]?.id;
    if (defaultWarehouseId) {
      const { rows: products } = await pool.query(
        `SELECT id, stock, cost_price FROM products WHERE COALESCE(stock,0) > 0`,
      );
      for (const p of products) {
        const qty = Number(p.stock);
        const cost = Number(p.cost_price ?? 0);
        const { rows: moveRows } = await pool.query(
          `INSERT INTO stock_moves
             (product_id, to_warehouse_id, quantity, unit_cost, kind, state,
              source_type, source_ref, notes)
           VALUES ($1, $2, $3, $4, 'receipt', 'done',
              'legacy_seed', 'legacy', 'مرحَّل من العمود القديم products.stock')
           RETURNING id`,
          [p.id, defaultWarehouseId, qty, cost],
        );
        const moveId = moveRows[0].id;
        await pool.query(
          `INSERT INTO stock_quants (product_id, warehouse_id, quantity, avg_cost)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (product_id, warehouse_id, COALESCE(variant_id,0), COALESCE(lot_id,0))
           DO UPDATE SET quantity = stock_quants.quantity + EXCLUDED.quantity,
                         avg_cost = EXCLUDED.avg_cost,
                         updated_at = now()`,
          [p.id, defaultWarehouseId, qty, cost],
        );
        // Seed a FIFO layer so FIFO-costed products see the legacy stock as
        // their oldest layer.
        await pool.query(
          `INSERT INTO stock_layers
             (receipt_move_id, product_id, warehouse_id, unit_cost, remaining_qty)
           VALUES ($1, $2, $3, $4, $5)`,
          [moveId, p.id, defaultWarehouseId, cost, qty],
        );
      }
      logger.info({ migrated: products.length }, "Legacy products.stock migrated to stock ledger");
    } else {
      logger.warn("No default warehouse — skipped legacy stock migration");
    }
  }

  logger.info("Inventory subsystem initialized");
}
