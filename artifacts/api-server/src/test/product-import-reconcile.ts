/** Independent, read-only catalogue/ledger reconciliation. Hashes only for noncatalogue tables. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
const state = JSON.parse(readFileSync("/tmp/hasba-browser-state.json", "utf8"));
const url = new URL(state.env.TEST_DATABASE_URL);
assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.username, "hasba_test");
assert.equal(url.pathname, "/hasba_test_verify"); assert.equal(state.env.ACCOUNT_ISOLATED_TEST, "true");
assert.equal(state.env.DATABASE_URL, state.env.TEST_DATABASE_URL);
Object.assign(process.env, state.env);
const { pool } = await import("@workspace/db");
const dir = resolve(import.meta.dirname, "../../../../generated-artifacts/product-import");
const phase = process.argv[2]; assert.ok(phase === "before" || phase === "after");
const names = (await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
const tables: Record<string, { rows: string; hash: string | null }> = {};
for (const { tablename } of names) {
  const name = `"${String(tablename).replace(/"/g, '""')}"`;
  tables[tablename] = (await pool.query(`SELECT count(*)::text AS rows, md5(coalesce(string_agg(md5(to_jsonb(t)::text),',' ORDER BY md5(to_jsonb(t)::text)),'')) AS hash FROM ${name} t`)).rows[0];
}
const productRows = (await pool.query("SELECT to_jsonb(p) AS data FROM products p ORDER BY id")).rows.map(({ data }) => ({
  id: data.id, companyId: data.company_id, sku: data.sku, barcode: data.barcode, nameAr: data.name_ar,
  stock: data.stock, price: data.price, costPrice: data.cost_price, tracking: data.tracking_mode,
  hash: createHash("sha256").update(JSON.stringify(data)).digest("hex"),
}));
const result: Record<string, unknown> = { at: new Date().toISOString(), readOnly: true, isolated: true, tables, products: productRows };
if (phase === "after") {
  const before = JSON.parse(readFileSync(resolve(dir, "reconcile-before.json"), "utf8"));
  const oldIds = new Set<number>(before.products.map((p: { id: number }) => p.id));
  const protectedNames = Object.keys(tables).filter(name => /^(stock_|inventory_|journal_|accounts$|invoices$|invoice_items$|payments$|receipts$|sales_|purchase_|cash_|ledger|tax_|product_(cost|variant|batch|serial))/.test(name));
  const changedProtected = protectedNames.filter(name => JSON.stringify(tables[name]) !== JSON.stringify(before.tables[name]));
  const changedOriginal = before.products.filter((p: { id: number; hash: string }) => productRows.find(q => q.id === p.id)?.hash !== p.hash);
  const added = productRows.filter(p => !oldIds.has(p.id));
  result.acceptance = { protectedTableCount: protectedNames.length, changedProtectedTables: changedProtected,
    originalProductsChanged: changedOriginal.map((p: { id: number }) => p.id), addedProducts: added,
    newProductsZeroStock: added.every(p => Number(p.stock) === 0), newProductsUntracked: added.every(p => p.tracking === "none"),
    passed: changedProtected.length === 0 && changedOriginal.length === 0 && added.length > 0 && added.every(p => Number(p.stock) === 0) };
  assert.equal((result.acceptance as { passed: boolean }).passed, true, "Independent reconciliation failed");
}
writeFileSync(resolve(dir, `reconcile-${phase}.json`), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ phase, at: result.at, tables: Object.keys(tables).length, acceptance: result.acceptance ?? "baseline saved" }));
await pool.end();
