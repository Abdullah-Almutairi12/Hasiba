import { pool } from "@workspace/db";
import { logger } from "./logger";

/**
 * Boot-time initialization of the Manufacturing (MRP) subsystem.
 *
 * - Creates BoMs, Work Centers, Routings, Work Orders, Consumptions,
 *   Productions, Quality Checks and Scrap Records tables idempotently.
 * - Seeds the WIP (Work in Progress), Finished Goods and Scrap Loss
 *   accounts so balanced GL postings are possible out of the box.
 *
 * Safe to run on every boot.
 */
export async function initManufacturing(): Promise<void> {
  // 1) Seed manufacturing GL accounts.
  await pool.query(`
    INSERT INTO accounts (code, name, name_ar, type, parent_id, is_group, system_key)
    SELECT '1220', 'Work In Progress', 'إنتاج تحت التشغيل', 'asset',
           (SELECT id FROM accounts WHERE code = '1100'), false, 'wip'
     WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE system_key = 'wip');

    INSERT INTO accounts (code, name, name_ar, type, parent_id, is_group, system_key)
    SELECT '1230', 'Finished Goods', 'منتجات تامة الصنع', 'asset',
           (SELECT id FROM accounts WHERE code = '1100'), false, 'finished_goods'
     WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE system_key = 'finished_goods');

    INSERT INTO accounts (code, name, name_ar, type, parent_id, is_group, system_key)
    SELECT '5950', 'Scrap & Loss', 'خسائر تالف وإهدار', 'expense',
           (SELECT id FROM accounts WHERE code = '5000'), false, 'scrap_loss'
     WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE system_key = 'scrap_loss');
  `);

  // 2) Tables.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS boms (
      id serial PRIMARY KEY,
      reference text NOT NULL UNIQUE,
      product_id integer NOT NULL REFERENCES products(id),
      quantity numeric(18,4) NOT NULL DEFAULT 1,
      is_phantom boolean NOT NULL DEFAULT false,
      is_active boolean NOT NULL DEFAULT true,
      routing_id integer,
      notes text,
      created_by integer REFERENCES users(id),
      created_at timestamp NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS boms_product_idx ON boms (product_id);

    CREATE TABLE IF NOT EXISTS bom_lines (
      id serial PRIMARY KEY,
      bom_id integer NOT NULL REFERENCES boms(id) ON DELETE CASCADE,
      component_id integer NOT NULL REFERENCES products(id),
      quantity_per numeric(18,4) NOT NULL,
      unit text NOT NULL DEFAULT 'piece',
      scrap_pct numeric(5,2) NOT NULL DEFAULT 0,
      notes text
    );
    CREATE INDEX IF NOT EXISTS bom_lines_bom_idx ON bom_lines (bom_id);

    CREATE TABLE IF NOT EXISTS work_centers (
      id serial PRIMARY KEY,
      code text NOT NULL UNIQUE,
      name text NOT NULL,
      name_ar text NOT NULL,
      capacity_per_day numeric(18,4) NOT NULL DEFAULT 8,
      hourly_cost numeric(18,4) NOT NULL DEFAULT 0,
      is_active boolean NOT NULL DEFAULT true,
      notes text,
      created_at timestamp NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS routings (
      id serial PRIMARY KEY,
      reference text NOT NULL UNIQUE,
      name text NOT NULL,
      name_ar text NOT NULL,
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamp NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS routing_operations (
      id serial PRIMARY KEY,
      routing_id integer NOT NULL REFERENCES routings(id) ON DELETE CASCADE,
      sequence integer NOT NULL DEFAULT 10,
      name text NOT NULL,
      name_ar text NOT NULL,
      work_center_id integer NOT NULL REFERENCES work_centers(id),
      duration_minutes numeric(18,2) NOT NULL DEFAULT 0,
      instructions text
    );
    CREATE INDEX IF NOT EXISTS routing_ops_routing_idx ON routing_operations (routing_id, sequence);

    CREATE TABLE IF NOT EXISTS work_orders (
      id serial PRIMARY KEY,
      reference text NOT NULL UNIQUE,
      bom_id integer NOT NULL REFERENCES boms(id),
      product_id integer NOT NULL REFERENCES products(id),
      quantity numeric(18,4) NOT NULL,
      quantity_produced numeric(18,4) NOT NULL DEFAULT 0,
      warehouse_id integer NOT NULL REFERENCES warehouses(id),
      state text NOT NULL DEFAULT 'draft',
      planned_start date,
      planned_end date,
      started_at timestamp,
      completed_at timestamp,
      standard_cost numeric(18,4) NOT NULL DEFAULT 0,
      notes text,
      created_by integer REFERENCES users(id),
      completed_by integer REFERENCES users(id),
      created_at timestamp NOT NULL DEFAULT now(),
      CONSTRAINT wo_state_chk CHECK (state IN ('draft','confirmed','in_progress','done','cancelled'))
    );
    CREATE INDEX IF NOT EXISTS work_orders_state_idx ON work_orders (state);
    CREATE INDEX IF NOT EXISTS work_orders_product_idx ON work_orders (product_id);

    CREATE TABLE IF NOT EXISTS work_order_reservations (
      id serial PRIMARY KEY,
      work_order_id integer NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
      component_id integer NOT NULL REFERENCES products(id),
      warehouse_id integer NOT NULL REFERENCES warehouses(id),
      quantity numeric(18,4) NOT NULL,
      consumed_qty numeric(18,4) NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS wo_reservations_wo_idx ON work_order_reservations (work_order_id);

    CREATE TABLE IF NOT EXISTS work_order_consumptions (
      id serial PRIMARY KEY,
      work_order_id integer NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
      component_id integer NOT NULL REFERENCES products(id),
      quantity numeric(18,4) NOT NULL,
      unit_cost numeric(18,4) NOT NULL DEFAULT 0,
      lot_id integer,
      serial_id integer,
      stock_move_id integer,
      occurred_at timestamp NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS wo_consumptions_wo_idx ON work_order_consumptions (work_order_id);

    CREATE TABLE IF NOT EXISTS work_order_productions (
      id serial PRIMARY KEY,
      work_order_id integer NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
      quantity numeric(18,4) NOT NULL,
      unit_cost numeric(18,4) NOT NULL DEFAULT 0,
      lot_id integer,
      serial_id integer,
      stock_move_id integer,
      occurred_at timestamp NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS wo_productions_wo_idx ON work_order_productions (work_order_id);

    CREATE TABLE IF NOT EXISTS quality_checks (
      id serial PRIMARY KEY,
      work_order_id integer NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
      operation_id integer REFERENCES routing_operations(id),
      name text NOT NULL,
      name_ar text NOT NULL,
      is_mandatory boolean NOT NULL DEFAULT true,
      result text NOT NULL DEFAULT 'pending',
      notes text,
      checked_by integer REFERENCES users(id),
      checked_at timestamp,
      created_at timestamp NOT NULL DEFAULT now(),
      CONSTRAINT qc_result_chk CHECK (result IN ('pending','pass','fail'))
    );
    CREATE INDEX IF NOT EXISTS quality_checks_wo_idx ON quality_checks (work_order_id);

    CREATE TABLE IF NOT EXISTS scrap_records (
      id serial PRIMARY KEY,
      reference text NOT NULL UNIQUE,
      product_id integer NOT NULL REFERENCES products(id),
      quantity numeric(18,4) NOT NULL,
      from_warehouse_id integer NOT NULL REFERENCES warehouses(id),
      to_warehouse_id integer REFERENCES warehouses(id),
      work_order_id integer REFERENCES work_orders(id),
      reworked_at timestamp,
      reason text NOT NULL DEFAULT 'other',
      notes text,
      stock_move_id integer,
      journal_entry_id integer,
      created_by integer REFERENCES users(id),
      created_at timestamp NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS scrap_records_product_idx ON scrap_records (product_id);
    CREATE INDEX IF NOT EXISTS scrap_records_wo_idx ON scrap_records (work_order_id);

    CREATE TABLE IF NOT EXISTS bom_qc_templates (
      id serial PRIMARY KEY,
      bom_id integer NOT NULL REFERENCES boms(id) ON DELETE CASCADE,
      operation_id integer REFERENCES routing_operations(id),
      name text NOT NULL,
      name_ar text NOT NULL,
      is_mandatory boolean NOT NULL DEFAULT true,
      notes text
    );
    CREATE INDEX IF NOT EXISTS bom_qc_templates_bom_idx ON bom_qc_templates (bom_id);

    -- Backfill columns added after the original schema, idempotently.
    ALTER TABLE work_orders   ADD COLUMN IF NOT EXISTS parent_work_order_id integer;
    ALTER TABLE work_orders   ADD COLUMN IF NOT EXISTS is_rework boolean NOT NULL DEFAULT false;
    ALTER TABLE scrap_records ADD COLUMN IF NOT EXISTS to_warehouse_id integer REFERENCES warehouses(id);
    ALTER TABLE scrap_records ADD COLUMN IF NOT EXISTS reworked_at timestamp;
    ALTER TABLE work_order_consumptions ADD COLUMN IF NOT EXISTS lot_id integer;
    ALTER TABLE work_order_consumptions ADD COLUMN IF NOT EXISTS serial_id integer;
    ALTER TABLE work_order_productions  ADD COLUMN IF NOT EXISTS lot_id integer;
    ALTER TABLE work_order_productions  ADD COLUMN IF NOT EXISTS serial_id integer;
  `);

  // 2b) Ensure a dedicated, NON-VALUATED Scrap warehouse exists per branch.
  //     Scrapped goods land here so we have an audit trail of physical
  //     location, but quantities in is_scrap warehouses are excluded from
  //     `products.stock` so on-hand stock stays consistent with the GL
  //     write-off (Scrap Loss Dr / Inventory Cr) posted at the same time.
  await pool.query(`
    ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS is_scrap boolean NOT NULL DEFAULT false;
    -- company_id is NOT NULL on warehouses (Phase-2 tenant isolation,
    -- migration 0008). Inherit it from the parent branch so the scrap
    -- warehouse is correctly tenant-scoped per company.
    INSERT INTO warehouses (company_id, branch_id, name, name_ar, is_default, is_scrap)
    SELECT b.company_id, b.id, 'Scrap', 'مستودع التالف', false, true
      FROM branches b
     WHERE b.company_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM warehouses w WHERE w.branch_id = b.id AND w.name = 'Scrap'
       );
    UPDATE warehouses SET is_scrap = true WHERE name = 'Scrap' AND is_scrap = false;
  `).catch((e) => logger.warn({ err: e }, "scrap warehouse seed skipped"));

  // 3) FK from boms.routing_id to routings(id), added after both exist.
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'boms_routing_id_fkey'
      ) THEN
        ALTER TABLE boms
          ADD CONSTRAINT boms_routing_id_fkey
          FOREIGN KEY (routing_id) REFERENCES routings(id);
      END IF;
    END $$;
  `).catch((e) => logger.warn({ err: e }, "boms_routing_id_fkey skipped"));

  logger.info("Manufacturing (MRP) subsystem initialized");
}
