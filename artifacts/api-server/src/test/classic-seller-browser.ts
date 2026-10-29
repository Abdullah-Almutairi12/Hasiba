/** Isolated evidence proxy only, never imported by the application. */
import "reflect-metadata";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createServer, request } from "node:http";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import assert from "node:assert/strict";

const state = JSON.parse(readFileSync("/tmp/hasba-browser-state.json", "utf8"));
const url = new URL(state.env.TEST_DATABASE_URL);
assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.username, "hasba_test");
assert.equal(url.pathname, "/hasba_test_verify"); assert.ok(url.port);
assert.equal(state.env.DATABASE_URL, state.env.TEST_DATABASE_URL);
assert.equal(state.env.ACCOUNT_ISOLATED_TEST, "true");
Object.assign(process.env, state.env, { NODE_ENV: "test", VITEST: "true", LOG_LEVEL: "error",
  SMTP_HOST: "", SMTP_USER: "", SMTP_PASS: "", SENTRY_DSN: "", OPENAI_API_KEY: "", AI_INTEGRATIONS_OPENAI_API_KEY: "" });
const { pool } = await import("@workspace/db");
const a = state.accounts.find((x: { role: string; posSession?: unknown }) => x.role === "owner" && x.posSession);
assert.ok(a);
const dir = resolve(import.meta.dirname, "../../../../generated-artifacts/classic-pos-sellers");
mkdirSync(dir, { recursive: true });
const file = resolve(dir, "browser-proxy.json");
const q = async (s: string, p: unknown[] = []) => (await pool.query(s, p)).rows;
const hash = (s: Buffer) => createHash("sha256").update(s).digest("hex");
async function snapshot(q: (sql: string, params?: unknown[]) => Promise<Record<string, any>[]> =
  async (sql, params = []) => (await pool.query(sql, params)).rows) {
  return {
    invoices: await q("SELECT id,reference,total::text,vat::text FROM customer_invoices WHERE company_id=$1", [a.companyId]),
    quants: await q("SELECT quantity::text,avg_cost::text FROM stock_quants WHERE product_id=$1", [a.productId]),
    layers: await q("SELECT remaining_qty::text,unit_cost::text FROM stock_layers WHERE product_id=$1", [a.productId]),
    moves: await q("SELECT id,kind,quantity::text,journal_entry_id FROM stock_moves WHERE product_id=$1 ORDER BY id", [a.productId]),
    journals: await q("SELECT id,reference,status FROM journal_entries WHERE company_id=$1 ORDER BY id", [a.companyId]),
    ledger: await q(`SELECT ac.system_key,sum(l.debit-l.credit)::text AS balance FROM journal_entries e
      JOIN journal_entry_lines l ON l.entry_id=e.id JOIN accounts ac ON ac.id=l.account_id
      WHERE e.company_id=$1 GROUP BY ac.system_key ORDER BY ac.system_key`, [a.companyId]),
    unbalanced: await q(`SELECT e.id FROM journal_entries e JOIN journal_entry_lines l ON l.entry_id=e.id
      WHERE e.company_id=$1 GROUP BY e.id HAVING sum(l.debit-l.credit)<>0`, [a.companyId]),
    sellers: await q("SELECT employee_id,seller_name,invoice_id,invoice_line_id,policy FROM invoice_seller_lines WHERE company_id=$1", [a.companyId]),
    employees: await q("SELECT id,name,name_ar,user_id FROM employees WHERE company_id=$1", [a.companyId]),
    policies: await q("SELECT * FROM sales_seller_policies WHERE company_id=$1 ORDER BY id", [a.companyId]),
    identities: await q("SELECT document_kind,document_id,issuer->'saleIdentity' AS identity,issuer->'invoiceDesign' AS design FROM document_issuer_snapshots WHERE company_id=$1", [a.companyId]),
    receipts: await q("SELECT operation,request_key,result->'value' AS value FROM financial_requests WHERE company_id=$1", [a.companyId]),
    commissions: await q("SELECT employee_id,kind,net_cents,commission_cents FROM sales_commission_events WHERE company_id=$1", [a.companyId]),
  };
}
if (process.argv.includes("--capture")) {
  const before = JSON.parse(readFileSync(file, "utf8")).baseline;
  const client = await pool.connect();
  await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    const s = await snapshot(async (sql, params = []) => (await client.query(sql, params)).rows);
    assert.equal(s.invoices.length, 1); assert.equal(Number(s.invoices[0].total), 115);
    assert.equal(s.moves.filter((m) => m.kind === "issue").length, 1);
    // The original POS engine posts one invoice JE, one cash-receipt JE and one
    // COGS JE. Do not mistake these three distinct entries for duplicate sales.
    assert.equal(s.journals.length, before.journals.length + 3);
    assert.equal(s.sellers.length, 1); assert.equal(s.receipts.length, 1); assert.equal(s.commissions.length, 1);
    assert.equal(s.unbalanced.length, 0);
    assert.equal(s.quants.reduce((n, r) => n + Number(r.quantity), 0), 19);
    assert.equal(s.layers.reduce((n, r) => n + Number(r.remaining_qty), 0), 19);
    assert.equal(s.quants.reduce((n, r) => n + Number(r.quantity) * Number(r.avg_cost), 0), 950);
    assert.equal(s.layers.reduce((n, r) => n + Number(r.remaining_qty) * Number(r.unit_cost), 0), 950);
    assert.equal(Number(s.ledger.find((r) => r.system_key === "inventory")?.balance), 950);
    assert.equal(Number(s.ledger.find((r) => r.system_key === "cogs")?.balance), 50);
    assert.equal(Number(s.ledger.find((r) => r.system_key === "sales_revenue")?.balance), -100);
    assert.equal(Number(s.ledger.find((r) => r.system_key === "vat_output")?.balance), -15);
    assert.deepEqual(s.policies, before.policies);
    assert.equal(s.policies[0].mode, "required"); assert.equal(s.policies[0].granularity, "line");
    const seller = s.employees.find((e) => e.id === s.sellers[0].employee_id);
    assert.equal(seller?.user_id, null);
    const identity = s.identities.find((i) => i.document_kind === "pos")!.identity;
    assert.equal(identity.cashier.id, a.userId);
    assert.equal(identity.sellers[0].employeeId, seller!.id);
    assert.equal(s.commissions[0].employee_id, seller!.id);
    assert.equal(Number(s.commissions[0].net_cents), 10000);
    assert.equal(Number(s.commissions[0].commission_cents), 1000);
    writeFileSync(resolve(dir, "browser-reconciliation.json"), JSON.stringify({ passed: true, snapshot: s }, null, 2));
  } finally { await client.query("ROLLBACK"); client.release(); await pool.end(); }
  console.log("[classic-sellers] Independent reconciliation passed.");
  process.exit(0);
}
const { default: app, assertApplicationReady } = await import("../app");
await assertApplicationReady();
const { verificationSource } = await import(new URL("../../../../scripts/verification-source.mjs", import.meta.url).href);
const evidence = { source: await verificationSource(resolve(import.meta.dirname, "../../../..")),
  baseline: await snapshot(), events: [] as Record<string, unknown>[] };
assert.equal(evidence.baseline.policies[0].mode, "required");
const save = () => writeFileSync(file, JSON.stringify(evidence, null, 2));
let dropped = false;
const backend = app.listen(0, "127.0.0.1");
await new Promise<void>((done) => backend.once("listening", done));
const address = backend.address(); assert.ok(address && typeof address !== "string");
const proxy = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks), key = String(req.headers["idempotency-key"] ?? "");
    const upstream = request({ hostname: "127.0.0.1", port: address.port, method: req.method, path: req.url, headers: req.headers }, (r) => {
      const bytes: Buffer[] = [];
      r.on("data", (c) => bytes.push(c));
      r.on("end", async () => {
        const data = Buffer.concat(bytes);
        const sale = req.method === "POST" && req.url?.split("?")[0] === "/api/pos/orders";
        if (sale) {
          const rows = await q("SELECT result->'value' AS value FROM financial_requests WHERE company_id=$1 AND request_key=$2", [a.companyId, key]);
          const input = JSON.parse(body.toString("utf8"));
          const event = { phase: "response", key, bodyHash: hash(body), status: r.statusCode,
            selection: { sellerEmployeeId: input.sellerEmployeeId, lineSellers: input.lineSellers },
            replay: r.headers["idempotency-replayed"] ?? null, documentId: rows[0]?.value?.order?.id ?? null };
          evidence.events.push(event);
          if (!dropped && r.statusCode === 201 && rows[0]?.value?.order?.id) {
            dropped = true; evidence.events.push({ ...event, phase: "committed-response-dropped" }); save(); res.destroy(); return;
          }
        }
        if (req.url?.includes("receipt.pdf") && r.statusCode === 200) {
          writeFileSync(resolve(dir, "native-receipt.pdf"), data);
          evidence.events.push({ phase: "native-receipt", path: req.url, status: 200, sha256: hash(data), bytes: data.length });
        }
        save(); res.writeHead(r.statusCode ?? 502, r.headers); res.end(data);
      });
    });
    upstream.on("error", () => { if (!res.destroyed) res.writeHead(502).end(); });
    upstream.end(body);
  });
});
proxy.listen(8080, "0.0.0.0", () => { save(); console.log("[classic-sellers] Isolated native proxy ready; policy remains required/line."); });
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => {
  proxy.close(); backend.close(); void pool.end().then(() => process.exit(0));
});
