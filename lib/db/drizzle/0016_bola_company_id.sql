-- ====================================================================
-- BOLA full tenant scoping: add company_id to 18 unscoped tables.
-- Idempotent. Backfills via FK joins; falls back to company_id = 1
-- (the bootstrap company) where no link exists. Then adds NOT NULL
-- + REFERENCES companies(id) only when every row has been backfilled.
-- ====================================================================

-- ---------- helper: ensure default company exists ----------
INSERT INTO companies (id, name)
SELECT 1, 'Default'
WHERE NOT EXISTS (SELECT 1 FROM companies WHERE id = 1);
SELECT setval(pg_get_serial_sequence('companies', 'id'),
              GREATEST((SELECT MAX(id) FROM companies), 1));

-- ---------- SALES ----------
ALTER TABLE quotations             ADD COLUMN IF NOT EXISTS company_id INTEGER;
ALTER TABLE sales_orders           ADD COLUMN IF NOT EXISTS company_id INTEGER;
ALTER TABLE delivery_orders        ADD COLUMN IF NOT EXISTS company_id INTEGER;
ALTER TABLE customer_invoices      ADD COLUMN IF NOT EXISTS company_id INTEGER;
ALTER TABLE credit_notes           ADD COLUMN IF NOT EXISTS company_id INTEGER;
ALTER TABLE opportunities          ADD COLUMN IF NOT EXISTS company_id INTEGER;

UPDATE quotations q
SET company_id = c.company_id
FROM customers c WHERE q.customer_id = c.id AND q.company_id IS NULL;

UPDATE sales_orders s
SET company_id = c.company_id
FROM customers c WHERE s.customer_id = c.id AND s.company_id IS NULL;

UPDATE delivery_orders d
SET company_id = w.company_id
FROM warehouses w WHERE d.warehouse_id = w.id AND d.company_id IS NULL;

UPDATE customer_invoices i
SET company_id = c.company_id
FROM customers c WHERE i.customer_id = c.id AND i.company_id IS NULL;

UPDATE credit_notes n
SET company_id = c.company_id
FROM customers c WHERE n.customer_id = c.id AND n.company_id IS NULL;

UPDATE opportunities o
SET company_id = c.company_id
FROM customers c WHERE o.customer_id = c.id AND o.company_id IS NULL;
UPDATE opportunities SET company_id = 1 WHERE company_id IS NULL;

-- ---------- PROCUREMENT ----------
ALTER TABLE rfqs                   ADD COLUMN IF NOT EXISTS company_id INTEGER;
ALTER TABLE purchase_orders        ADD COLUMN IF NOT EXISTS company_id INTEGER;
ALTER TABLE payment_runs           ADD COLUMN IF NOT EXISTS company_id INTEGER;

UPDATE rfqs r
SET company_id = pr.company_id
FROM purchase_requisitions pr WHERE r.requisition_id = pr.id AND r.company_id IS NULL;
UPDATE rfqs SET company_id = 1 WHERE company_id IS NULL;

UPDATE purchase_orders p
SET company_id = w.company_id
FROM warehouses w WHERE p.warehouse_id = w.id AND p.company_id IS NULL;
UPDATE purchase_orders p
SET company_id = s.company_id
FROM suppliers s WHERE p.supplier_id = s.id AND p.company_id IS NULL;
UPDATE purchase_orders SET company_id = 1 WHERE company_id IS NULL;

-- payment_runs has no direct FK to a scoped table; use the most common
-- supplier from its lines, else default to 1.
UPDATE payment_runs pr
SET company_id = sub.company_id
FROM (
  SELECT pl.run_id, MIN(s.company_id) AS company_id
  FROM payment_run_lines pl
  JOIN suppliers s ON s.id = pl.supplier_id
  GROUP BY pl.run_id
) sub WHERE pr.id = sub.run_id AND pr.company_id IS NULL;
UPDATE payment_runs SET company_id = 1 WHERE company_id IS NULL;

-- ---------- MANUFACTURING ----------
ALTER TABLE boms                   ADD COLUMN IF NOT EXISTS company_id INTEGER;
ALTER TABLE work_orders            ADD COLUMN IF NOT EXISTS company_id INTEGER;

UPDATE boms b
SET company_id = p.company_id
FROM products p WHERE b.product_id = p.id AND b.company_id IS NULL;

UPDATE work_orders wo
SET company_id = w.company_id
FROM warehouses w WHERE wo.warehouse_id = w.id AND wo.company_id IS NULL;

-- ---------- HR ----------
ALTER TABLE departments            ADD COLUMN IF NOT EXISTS company_id INTEGER;
ALTER TABLE leave_requests         ADD COLUMN IF NOT EXISTS company_id INTEGER;
ALTER TABLE payroll_runs           ADD COLUMN IF NOT EXISTS company_id INTEGER;
ALTER TABLE employee_documents     ADD COLUMN IF NOT EXISTS company_id INTEGER;
ALTER TABLE payslips               ADD COLUMN IF NOT EXISTS company_id INTEGER;
ALTER TABLE shifts                 ADD COLUMN IF NOT EXISTS company_id INTEGER;
ALTER TABLE employee_shifts        ADD COLUMN IF NOT EXISTS company_id INTEGER;

UPDATE departments d
SET company_id = b.company_id
FROM branches b WHERE d.branch_id = b.id AND d.company_id IS NULL;
UPDATE departments SET company_id = 1 WHERE company_id IS NULL;

UPDATE leave_requests lr
SET company_id = e.company_id
FROM employees e WHERE lr.employee_id = e.id AND lr.company_id IS NULL;

UPDATE payroll_runs p
SET company_id = b.company_id
FROM branches b WHERE p.branch_id = b.id AND p.company_id IS NULL;
UPDATE payroll_runs SET company_id = 1 WHERE company_id IS NULL;

UPDATE employee_documents ed
SET company_id = e.company_id
FROM employees e WHERE ed.employee_id = e.id AND ed.company_id IS NULL;

UPDATE payslips ps
SET company_id = e.company_id
FROM employees e WHERE ps.employee_id = e.id AND ps.company_id IS NULL;

UPDATE shifts SET company_id = 1 WHERE company_id IS NULL;

UPDATE employee_shifts es
SET company_id = e.company_id
FROM employees e WHERE es.employee_id = e.id AND es.company_id IS NULL;

-- ---------- NOT NULL + FK ----------
-- Wrapped in DO blocks so re-runs are no-ops once the constraint exists.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'quotations','sales_orders','delivery_orders','customer_invoices',
    'credit_notes','opportunities','rfqs','purchase_orders','payment_runs',
    'boms','work_orders','departments','leave_requests','payroll_runs',
    'employee_documents','payslips','shifts','employee_shifts'
  ])
  LOOP
    -- SET NOT NULL only if no nulls remain
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = t AND column_name = 'company_id' AND is_nullable = 'NO') THEN
      EXECUTE format('ALTER TABLE %I ALTER COLUMN company_id SET NOT NULL', t);
    END IF;
    -- Add FK only if missing
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                   WHERE table_name = t AND constraint_name = t || '_company_id_companies_id_fk') THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT',
        t, t || '_company_id_companies_id_fk'
      );
    END IF;
    -- Add a tenant index
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (company_id)', t || '_company_id_idx', t);
  END LOOP;
END $$;
