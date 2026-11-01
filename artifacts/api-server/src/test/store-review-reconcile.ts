/** Independent, read-only evidence for the disposable store UI review. */
import "reflect-metadata";
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

const state = JSON.parse(readFileSync("/tmp/hasba-browser-state.json", "utf8"));
const url = new URL(state.env.TEST_DATABASE_URL);
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.username, "hasba_test");
assert.equal(url.pathname, "/hasba_test_verify");
assert.equal(state.env.DATABASE_URL, state.env.TEST_DATABASE_URL);
assert.equal(state.env.ACCOUNT_ISOLATED_TEST, "true");
Object.assign(process.env, state.env);
const { pool } = await import("@workspace/db");
const client = await pool.connect();
try {
  await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const queries: Record<string, string> = {
    companies: "SELECT id,name,business_type FROM companies ORDER BY id",
    branches: "SELECT id,company_id,name FROM branches ORDER BY id",
    warehouses: "SELECT id,company_id,name FROM warehouses ORDER BY id",
    products: "SELECT id,company_id,name,costing_method FROM products ORDER BY id",
    quants: `SELECT q.product_id,q.warehouse_id,q.quantity,q.avg_cost,
      p.company_id,p.costing_method FROM stock_quants q JOIN products p ON p.id=q.product_id
      ORDER BY q.product_id,q.warehouse_id`,
    layers: `SELECT l.product_id,l.warehouse_id,l.remaining_qty,l.unit_cost
      FROM stock_layers l ORDER BY l.product_id,l.warehouse_id,l.id`,
    moves: `SELECT id,kind,product_id,quantity,unit_cost,journal_entry_id
      FROM stock_moves ORDER BY id`,
    inventoryByCompany: `SELECT p.company_id,sum(q.quantity*q.avg_cost)::text AS carrying
      FROM stock_quants q JOIN products p ON p.id=q.product_id GROUP BY p.company_id ORDER BY p.company_id`,
    inventoryLedgerReconciliation: `SELECT c.id AS company_id,
      coalesce((SELECT sum(q.quantity*q.avg_cost) FROM stock_quants q
        JOIN products p ON p.id=q.product_id WHERE p.company_id=c.id),0)::text AS carrying,
      coalesce((SELECT sum(l.debit-l.credit) FROM journal_entries e
        JOIN journal_entry_lines l ON l.entry_id=e.id JOIN accounts a ON a.id=l.account_id
        WHERE e.company_id=c.id AND e.status='posted' AND a.system_key='inventory'),0)::text AS ledger
      FROM companies c ORDER BY c.id`,
    fifoReconciliation: `SELECT p.id,p.company_id,
      coalesce((SELECT sum(q.quantity*q.avg_cost) FROM stock_quants q WHERE q.product_id=p.id),0)::text AS carrying,
      coalesce((SELECT sum(l.remaining_qty*l.unit_cost) FROM stock_layers l WHERE l.product_id=p.id),0)::text AS layers,
      coalesce((SELECT sum(q.quantity) FROM stock_quants q WHERE q.product_id=p.id),0)::text AS quantity,
      coalesce((SELECT sum(l.remaining_qty) FROM stock_layers l WHERE l.product_id=p.id),0)::text AS layered_quantity
      FROM products p WHERE p.costing_method='fifo' ORDER BY p.id`,
    ledger: `SELECT e.company_id,a.system_key,sum(l.debit-l.credit)::text AS balance
      FROM journal_entries e JOIN journal_entry_lines l ON l.entry_id=e.id
      JOIN accounts a ON a.id=l.account_id
      WHERE e.status='posted' GROUP BY e.company_id,a.system_key ORDER BY e.company_id,a.system_key`,
    unbalancedPosted: `SELECT e.id,e.company_id,sum(l.debit-l.credit)::text AS difference
      FROM journal_entries e JOIN journal_entry_lines l ON l.entry_id=e.id
      WHERE e.status='posted' GROUP BY e.id HAVING sum(l.debit-l.credit)<>0`,
    invoices: `SELECT id,company_id,reference,total,subtotal,discount,vat,so_id
      FROM customer_invoices ORDER BY id`,
    journals: "SELECT id,company_id,reference,status FROM journal_entries ORDER BY id",
    receiptCounts: `SELECT company_id,operation,count(*)::int AS receipts
      FROM financial_requests GROUP BY company_id,operation ORDER BY company_id,operation`,
    duplicateRequestKeys: `SELECT company_id,operation,request_key,count(*)::int AS copies
      FROM financial_requests GROUP BY company_id,operation,request_key HAVING count(*)>1`,
  };
  const data: Record<string, unknown[]> = {};
  for (const [key, sql] of Object.entries(queries)) data[key] = (await client.query(sql)).rows;
  await client.query("COMMIT");
  const fingerprint = createHash("sha256").update(JSON.stringify(data)).digest("hex");
  const dir = resolve(import.meta.dirname, "../../../../generated-artifacts/store-review");
  mkdirSync(dir, { recursive: true });
  const label = process.argv.includes("--before") ? "before" : "after";
  writeFileSync(resolve(dir, `reconciliation-${label}.json`), JSON.stringify({
    at: new Date().toISOString(), isolated: true, readOnly: true,
    note: "Observed native operations only; counts do not prove unexecuted user journeys.",
    fingerprint, sql: queries, data,
  }, null, 2));
  console.log(`[store-review] ${label} read-only reconciliation saved; no row data or credentials logged.`);
} finally {
  client.release();
  await pool.end();
}
