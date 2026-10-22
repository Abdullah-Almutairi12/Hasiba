/**
 * Disposable browser-test API, never imported by the application.
 * Start only after `node scripts/test-isolated.mjs --browser` is ready
 * and the normal API workflow is stopped. Restore that workflow afterwards.
 *
 * Drops the first successful customer-invoice (or --receipts) response AFTER the real app
 * has committed it. Later requests pass through, including receipt replays.
 * No test endpoint, auth bypass, or production data is used.
 */
import "reflect-metadata";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createServer, request } from "node:http";
import { randomUUID, createHash } from "node:crypto";
import { resolve } from "node:path";
import assert from "node:assert/strict";

const state = JSON.parse(readFileSync("/tmp/hasba-browser-state.json", "utf8"));
const database = new URL(state.env.TEST_DATABASE_URL);
assert.equal(database.hostname, "127.0.0.1");
assert.equal(database.pathname, "/hasba_test_verify");
assert.equal(database.username, "hasba_test");
assert.ok(database.port);
assert.equal(state.env.DATABASE_URL, state.env.TEST_DATABASE_URL);
// Never inherit the application's database or integrations.
Object.assign(process.env, state.env, {
  NODE_ENV: "test", VITEST: "true", SESSION_SECRET: randomUUID(),
  SMTP_HOST: "", SMTP_USER: "", SMTP_PASS: "", SENTRY_DSN: "",
  AI_INTEGRATIONS_OPENAI_API_KEY: "", OPENAI_API_KEY: "", LOG_LEVEL: "error",
});

const { default: app, assertApplicationReady } = await import("../app");
const { pool } = await import("@workspace/db");
await assertApplicationReady();
const reportDir = resolve(import.meta.dirname, "../../../../generated-artifacts/verification");
mkdirSync(reportDir, { recursive: true });
const receiptMode = process.argv.includes("--receipts");
const reportFile = resolve(reportDir, receiptMode ? "browser-identical-receipt-proxy.json" : "browser-retry-proxy.json");
const readCounts = async () => (await pool.query(`
  SELECT
    (SELECT count(*)::int FROM customer_invoices) AS invoices,
    (SELECT count(*)::int FROM financial_requests) AS receipts
`)).rows[0];
const readScenarioCounts = async () => receiptMode ? (await pool.query(`
  SELECT
    (SELECT count(*)::int FROM customer_invoices) AS invoices,
    (SELECT count(*)::int FROM customer_receipts) AS "paymentReceipts",
    (SELECT count(*)::int FROM financial_requests) AS receipts
`)).rows[0] : readCounts();
// Read-only post-check for the no-send scenario. Run while this same
// disposable proxy/database are still alive, after restoring tab storage.
if (process.argv.includes("--capture-storage-block")) {
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  assert.ok(report.runId);
  assert.equal(report.invoicePostCount, 0, "No invoice POST may reach the proxy");
  assert.deepEqual(report.events, []);
  assert.deepEqual(report.initialCounts, { invoices: 0, receipts: 0 });
  const finalCounts = await readCounts();
  assert.deepEqual(finalCounts, report.initialCounts, "No invoice or retry receipt may exist");
  writeFileSync(resolve(reportDir, "browser-storage-block-proxy.json"), JSON.stringify({
    ...report, finalCounts, capturedAt: Date.now(),
  }, null, 2));
  await pool.end();
  process.exit(0);
}
const readReceipts = async () => (await pool.query(`
  SELECT company_id AS "companyId", user_id AS "userId", operation,
    request_key AS key, ${receiptMode
      ? `result->'value'->>'id' AS "paymentReceiptId"`
      : `result->'value'->'inv'->>'id' AS "invoiceId"`}
  FROM financial_requests ORDER BY request_key
`)).rows;
const readPaymentState = async () => {
  const payments = (await pool.query(`
    SELECT id, reference, customer_id AS "customerId", amount::float8 AS amount,
      payment_method AS "paymentMethod", journal_entry_id AS "journalEntryId"
    FROM customer_receipts ORDER BY id
  `)).rows;
  const allocations = (await pool.query(`
    SELECT receipt_id AS "receiptId", invoice_id AS "invoiceId", amount::float8 AS amount
    FROM customer_receipt_allocations ORDER BY receipt_id, invoice_id
  `)).rows;
  const invoices = (await pool.query(`
    SELECT id, customer_id AS "customerId", total::float8 AS total,
      amount_paid::float8 AS "amountPaid", status FROM customer_invoices ORDER BY id
  `)).rows;
  return { payments, allocations, invoices };
};
// Read-only follow-up evidence, without another browser submission or modifying
// the original event snapshots. Only the validated disposable database is used.
if (process.argv.includes("--capture-receipts")) {
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  const finalReceipts = await readReceipts();
  assert.ok(report.runId && report.events.length);
  const identities = (rows: Array<Record<string, unknown>>) => rows.map((r) =>
    JSON.stringify([r.companyId, r.userId, r.operation, r.key])).sort();
  assert.deepEqual(identities(finalReceipts), identities(report.events.at(-1).receipts),
    "The live disposable receipts must match this proxy run");
  writeFileSync(reportFile, JSON.stringify({
    ...report, finalReceipts, receiptsObservedAt: Date.now(),
    ...(receiptMode ? { finalPaymentState: await readPaymentState() } : {}),
  }, null, 2));
  await pool.end();
  process.exit(0);
}
const backend = app.listen(0, "127.0.0.1");
await new Promise<void>((done) => backend.once("listening", done));
const address = backend.address();
assert.ok(address && typeof address !== "string");
const backendPort = address.port;
const runId = randomUUID();
const events: Array<Record<string, unknown>> = [];
let finalReceipts: Array<Record<string, unknown>> = [];
let receiptsObservedAt = 0;
let dropped = false;
let invoicePostCount = 0;
let receiptPostCount = 0;
const startedAt = Date.now();
const initialCounts = await readScenarioCounts();
const initialPaymentState = receiptMode ? await readPaymentState() : undefined;
let finalPaymentState = initialPaymentState;
const save = () => writeFileSync(reportFile, JSON.stringify({
  runId, startedAt, initialCounts, invoicePostCount, events, finalReceipts, receiptsObservedAt,
  ...(receiptMode ? { scenario: "identical-receipt", receiptPostCount, initialPaymentState, finalPaymentState } : {}),
}, null, 2));
save();

const proxy = createServer((req, res) => {
  const invoice = req.method === "POST" && req.url?.split("?")[0] === "/api/sales/invoices";
  const receipt = req.method === "POST" && req.url?.split("?")[0] === "/api/sales/receipts";
  // Record arrival, not just successful upstream replies: zero events alone
  // would miss rejected requests or requests still in flight.
  if (invoice) {
    invoicePostCount += 1;
    save();
  }
  if (receipt) {
    receiptPostCount += 1;
    save();
  }
  const body: Buffer[] = [];
  req.on("data", (chunk: Buffer) => body.push(chunk));
  req.on("end", () => {
    const input = Buffer.concat(body);
    const upstream = request({
      hostname: "127.0.0.1", port: backendPort,
      method: req.method, path: req.url, headers: req.headers,
    }, (reply) => {
      const chunks: Buffer[] = [];
      reply.on("data", (chunk: Buffer) => chunks.push(chunk));
      reply.on("end", () => {
        void (async () => {
          const output = Buffer.concat(chunks);
          if (receiptMode ? receipt : invoice) {
            const key = req.headers["idempotency-key"];
            assert.equal(typeof key, "string", "The real UI must send Idempotency-Key");
            const successful = reply.statusCode !== undefined && reply.statusCode >= 200 && reply.statusCode < 300;
            const result = successful ? JSON.parse(output.toString("utf8")) : null;
            // This query uses only the disposable pool, after the response ended.
            const counts = await readScenarioCounts();
            const receipts = await readReceipts();
            const paymentState = receiptMode ? await readPaymentState() : undefined;
            const drop = successful && !dropped;
            if (drop) dropped = true;
            events.push({
              recordedAt: Date.now(),
              storageKey: `hasba:financial-request:${createHash("sha256").update(`${req.url?.split("?")[0]}\n${input.toString("utf8")}`).digest("hex")}`,
              key, bodyHash: createHash("sha256").update(input).digest("hex"),
              upstreamStatus: reply.statusCode,
              replayed: reply.headers["idempotency-replayed"] === "true",
              replayHeader: reply.headers["idempotency-replayed"] ?? null,
              ...(receiptMode ? { paymentReceiptId: result?.id, paymentState, body: JSON.parse(input.toString("utf8")) } : { invoiceId: result?.id }),
              reference: result?.reference,
              counts, receipts, dropped: drop,
            });
            finalReceipts = receipts;
            finalPaymentState = paymentState;
            receiptsObservedAt = Date.now();
            save();
            if (drop) {
              // No bytes from the committed success are sent to the browser.
              res.destroy();
              console.log(receiptMode
                ? "[browser-retry] Committed receipt success dropped; capture sessionStorage, then retry the unchanged dialog."
                : "[browser-retry] Committed success dropped; capture sessionStorage, reload, then re-enter the same data.");
              return;
            }
          }
          res.writeHead(reply.statusCode ?? 502, reply.headers);
          res.end(output);
        })().catch((error) => {
          console.error("[browser-retry] Evidence capture failed", error);
          res.destroy();
        });
      });
    });
    upstream.on("error", () => {
      res.writeHead(502);
      res.end("Disposable test upstream unavailable");
    });
    upstream.end(input);
  });
});
proxy.listen(8080, "0.0.0.0", () => {
  console.log("[browser-retry] Isolated API proxy ready on port 8080.");
});
async function shutdown() {
  proxy.closeAllConnections();
  backend.closeAllConnections();
  await Promise.all([
    new Promise<void>((done) => proxy.close(() => done())),
    new Promise<void>((done) => backend.close(() => done())),
  ]);
  await pool.end();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
