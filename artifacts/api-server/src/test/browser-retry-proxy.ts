/**
 * Disposable browser-test API, never imported by the application.
 * Start only after `node scripts/test-isolated.mjs --browser` is ready
 * and the normal API workflow is stopped. Restore that workflow afterwards.
 *
 * Drops the first successful customer-invoice (or --receipts / --returns) response AFTER the real app
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
const returnMode = process.argv.includes("--returns");
// Cleanup-after-success tests need the real successful response in the tab.
// Keep the default lost-response scenario unchanged for existing callers.
const passSuccess = process.argv.includes("--pass-success");
// Test-only rendezvous: neither request is forwarded until both UI clicks
// arrive. A bounded timeout releases the server but makes the guard fail.
const overlapReturns = process.argv.includes("--overlap-returns");
assert.ok(!overlapReturns || (returnMode && passSuccess), "Overlap requires --returns --pass-success");
const overlapInvoices = process.argv.includes("--overlap-invoices");
assert.ok(!overlapInvoices || (!returnMode && !receiptMode && passSuccess),
  "Invoice overlap requires --pass-success without --returns or --receipts");
const overlapReceipts = process.argv.includes("--overlap-receipts");
assert.ok(!overlapReceipts || (receiptMode && passSuccess), "Overlap requires --receipts --pass-success");
const overlap = overlapReturns || overlapInvoices || overlapReceipts;
assert.ok(!(receiptMode && returnMode), "Choose one isolated scenario");
const reportFile = resolve(reportDir, returnMode ? "browser-identical-return-proxy.json" : receiptMode ? "browser-identical-receipt-proxy.json" : "browser-retry-proxy.json");
const readCounts = async () => (await pool.query(`
  SELECT
    (SELECT count(*)::int FROM customer_invoices) AS invoices,
    (SELECT count(*)::int FROM financial_requests) AS receipts
`)).rows[0];
const readJournals = async () => (await pool.query(
  "SELECT id FROM journal_entries ORDER BY id",
)).rows;
// Customer invoices bill goods; delivery orders issue them. Invoice saves
// must not change either the product balance or the warehouse ledger.
const readInvoiceState = async () => ({
  invoices: (await pool.query(`SELECT id, reference, customer_id AS "customerId",
    total::float8 AS total FROM customer_invoices ORDER BY id`)).rows,
  products: (await pool.query("SELECT id, stock::float8 AS stock FROM products ORDER BY id")).rows,
  moves: (await pool.query("SELECT id FROM stock_moves ORDER BY id")).rows,
  quants: (await pool.query(`SELECT id, quantity::float8 AS quantity,
    avg_cost::float8 AS "avgCost" FROM stock_quants ORDER BY id`)).rows,
});
const readScenarioCounts = async () => returnMode ? (await pool.query(`
  SELECT (SELECT count(*)::int FROM customer_invoices) AS invoices,
    (SELECT count(*)::int FROM credit_notes) AS "creditNotes",
    (SELECT count(*)::int FROM financial_requests) AS receipts
`)).rows[0] : receiptMode ? (await pool.query(`
  SELECT
    (SELECT count(*)::int FROM customer_invoices) AS invoices,
    (SELECT count(*)::int FROM customer_receipts) AS "paymentReceipts",
    (SELECT count(*)::int FROM financial_requests) AS receipts
`)).rows[0] : readCounts();
// Read-only post-check for the no-send scenario. Run while this same
// disposable proxy/database are still alive, after restoring tab storage.
if (process.argv.includes("--capture-storage-block") && !returnMode) {
  assert.ok(!receiptMode, "Storage-block capture supports invoices or --returns");
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
    request_key AS key, ${returnMode
      ? `result->'value'->>'id' AS "creditNoteId"`
      : receiptMode
      ? `result->'value'->>'id' AS "paymentReceiptId"`
      : `result->'value'->'inv'->>'id' AS "invoiceId"`}
  FROM financial_requests ORDER BY request_key
`)).rows;
const readReturnState = async () => {
  const fixture = state.accounts.find((a: { returnInvoice?: unknown }) => a.returnInvoice)?.returnInvoice;
  assert.ok(fixture, "Start isolated runner with --returns");
  const notes = (await pool.query(`SELECT id, reference, status, invoice_id AS "invoiceId",
    journal_entry_id AS "journalEntryId" FROM credit_notes ORDER BY id`)).rows;
  const moves = (await pool.query(`SELECT id, product_id AS "productId", source_id AS "noteId",
    invoice_line_id AS "invoiceLineId", original_move_id AS "originalMoveId",
    to_warehouse_id AS "warehouseId", quantity::float8 AS quantity, unit_cost::float8 AS "unitCost",
    state FROM stock_moves WHERE kind = 'return_in' AND source_type = 'credit_note' ORDER BY id`)).rows;
  const quants = (await pool.query(`SELECT warehouse_id AS "warehouseId", quantity::float8 AS quantity,
    avg_cost::float8 AS "avgCost" FROM stock_quants WHERE product_id = $1 ORDER BY id`, [fixture.productId])).rows;
  const product = (await pool.query(`SELECT stock::float8 AS stock FROM products WHERE id = $1`, [fixture.productId])).rows[0];
  return { notes, moves, quants, stock: product.stock };
};
if (process.argv.includes("--capture-storage-block") && returnMode) {
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  assert.ok(report.runId);
  assert.equal(report.scenario, "identical-return");
  assert.equal(report.returnPostCount, 0, "No return POST may reach the proxy");
  assert.equal(report.invoicePostCount, 0);
  assert.equal(report.receiptPostCount, 0);
  assert.deepEqual(report.events, []);
  assert.deepEqual(report.initialCounts, { invoices: 1, creditNotes: 0, receipts: 0 });
  const finalCounts = await readScenarioCounts();
  const finalReturnState = await readReturnState();
  assert.deepEqual(finalCounts, report.initialCounts, "No return or financial receipt may exist");
  assert.deepEqual(report.initialReturnState.notes, []);
  assert.deepEqual(report.initialReturnState.moves, []);
  assert.deepEqual(finalReturnState, report.initialReturnState, "No stock restoration may occur");
  writeFileSync(resolve(reportDir, "browser-return-storage-block-proxy.json"), JSON.stringify({
    ...report, finalCounts, finalReturnState, capturedAt: Date.now(),
  }, null, 2));
  await pool.end();
  process.exit(0);
}
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
if (process.argv.includes("--capture-receipts") || process.argv.includes("--capture-cleanup-success")) {
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  const finalReceipts = await readReceipts();
  assert.ok(report.runId && report.events.length);
  const identities = (rows: Array<Record<string, unknown>>) => rows.map((r) =>
    JSON.stringify([r.companyId, r.userId, r.operation, r.key])).sort();
  assert.deepEqual(identities(finalReceipts), identities(report.events.at(-1).receipts),
    "The live disposable receipts must match this proxy run");
  if (process.argv.includes("--capture-cleanup-success")) {
    assert.ok(returnMode && !receiptMode, "Cleanup-success capture requires --returns");
    assert.deepEqual(report.initialCounts, { invoices: 1, creditNotes: 0, receipts: 0 });
    assert.equal(report.returnPostCount, 2);
    assert.equal(report.invoicePostCount, 0);
    assert.equal(report.receiptPostCount, 0);
    assert.equal(report.events.length, 2);
    const [first, retry] = report.events;
    assert.equal(first.replayed, false);
    assert.equal(retry.replayed, true);
    assert.equal(first.key, retry.key);
    assert.equal(first.bodyHash, retry.bodyHash);
    assert.deepEqual(first.body, retry.body);
    assert.equal(first.creditNoteId, retry.creditNoteId);
    for (const event of report.events) {
      assert.equal(event.dropped, false, "The browser must receive the confirmed success");
      assert.equal(event.upstreamStatus, 201);
      assert.deepEqual(event.counts, { invoices: 1, creditNotes: 1, receipts: 1 });
      assert.equal(event.returnState.notes.length, 1);
      assert.equal(event.returnState.moves.length, 1);
      assert.equal(event.returnState.moves[0].quantity, 1);
      assert.equal(event.returnState.moves[0].unitCost, report.returnFixture.unitCost);
      assert.equal(event.returnState.stock, 1);
    }
    assert.deepEqual(first.returnState, retry.returnState);
    assert.deepEqual(await readScenarioCounts(), retry.counts);
    assert.deepEqual(await readReturnState(), retry.returnState);
    assert.equal(finalReceipts.length, 1);
    writeFileSync(resolve(reportDir, "browser-return-cleanup-success-proxy.json"), JSON.stringify({
      ...report, finalReceipts, finalReturnState: await readReturnState(),
      capturedAt: Date.now(), assertionsPassed: true,
    }, null, 2));
  }
  writeFileSync(reportFile, JSON.stringify({
    ...report, finalReceipts, receiptsObservedAt: Date.now(), capturedAt: Date.now(),
    ...(!receiptMode && !returnMode ? { finalCounts: await readCounts(), finalJournals: await readJournals() } : {}),
    ...(!receiptMode && !returnMode ? { finalInvoiceState: await readInvoiceState() } : {}),
    ...(report.overlapReturns || report.overlapInvoices || report.overlapReceipts ? {
      finalCounts: await readScenarioCounts(),
      finalJournalCount: Number((await pool.query("SELECT count(*) AS count FROM journal_entries")).rows[0].count),
    } : {}),
    ...(receiptMode ? { finalPaymentState: await readPaymentState(), finalCounts: await readScenarioCounts(), finalJournals: await readJournals() } : {}),
    ...(returnMode ? { finalReturnState: await readReturnState() } : {}),
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
let returnPostCount = 0;
const arrivals: Array<{ arrivedAt: number; forwardedAt?: number; responseSentAt?: number }> = [];
let releaseOverlap: (() => void) | undefined;
let overlapTimedOut = false;
let overlapTimer: ReturnType<typeof setTimeout> | undefined;
const overlapGate = overlap ? new Promise<void>((done) => {
  releaseOverlap = done;
}) : Promise.resolve();
const startedAt = Date.now();
const initialCounts = await readScenarioCounts();
const initialJournals = !returnMode ? await readJournals() : undefined;
const journalCount = async () => Number((await pool.query("SELECT count(*) AS count FROM journal_entries")).rows[0].count);
const initialJournalCount = overlap ? await journalCount() : undefined;
const initialInvoiceState = !receiptMode && !returnMode ? await readInvoiceState() : undefined;
const initialPaymentState = receiptMode ? await readPaymentState() : undefined;
let finalPaymentState = initialPaymentState;
const returnFixture = returnMode ? state.accounts.find((a: { returnInvoice?: unknown }) => a.returnInvoice).returnInvoice : undefined;
const initialReturnState = returnMode ? await readReturnState() : undefined;
let finalReturnState = initialReturnState;
const save = () => writeFileSync(reportFile, JSON.stringify({
  runId, startedAt, initialCounts, invoicePostCount, events, finalReceipts, receiptsObservedAt,
  ...(!returnMode ? { initialJournals } : {}),
  ...(!receiptMode && !returnMode ? { initialInvoiceState } : {}),
  arrivals,
  ...(overlap ? { overlapReturns, overlapInvoices, overlapReceipts, overlapTimedOut, initialJournalCount } : {}),
  ...(overlapInvoices ? { scenario: "overlapping-invoice", initialInvoiceState, receiptPostCount, returnPostCount } : {}),
  ...(receiptMode ? { scenario: "identical-receipt", receiptPostCount, returnPostCount, initialPaymentState, finalPaymentState } : {}),
  ...(returnMode ? { scenario: "identical-return", returnPostCount, receiptPostCount, returnFixture, initialReturnState, finalReturnState } : {}),
}, null, 2));
save();

const proxy = createServer((req, res) => {
  const arrival = { arrivedAt: Date.now() } as typeof arrivals[number];
  const invoice = req.method === "POST" && req.url?.split("?")[0] === "/api/sales/invoices";
  const receipt = req.method === "POST" && req.url?.split("?")[0] === "/api/sales/receipts";
  const creditNote = req.method === "POST" && req.url?.split("?")[0] === "/api/sales/credit-notes";
  if (receipt && !overlap) arrivals.push(arrival);
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
  if (creditNote) {
    returnPostCount += 1;
    save();
  }
  if ((overlapReturns && creditNote) || (overlapInvoices && invoice) || (overlapReceipts && receipt)) {
      arrivals.push(arrival);
      if (arrivals.length === 1) overlapTimer = setTimeout(() => {
        overlapTimedOut = true;
        releaseOverlap?.();
        save();
      }, 15000);
      if (arrivals.length === 2) {
        clearTimeout(overlapTimer);
        // Keep both requests pending briefly for browser/storage evidence.
        setTimeout(() => releaseOverlap?.(), 1500);
      }
    save();
  }
  const body: Buffer[] = [];
  req.on("data", (chunk: Buffer) => body.push(chunk));
  req.on("end", async () => {
    const input = Buffer.concat(body);
    if ((overlapReturns && creditNote) || (overlapInvoices && invoice) || (overlapReceipts && receipt)) {
      await overlapGate;
      arrival.forwardedAt = Date.now();
      save();
    }
    const upstream = request({
      hostname: "127.0.0.1", port: backendPort,
      method: req.method, path: req.url, headers: req.headers,
    }, (reply) => {
      const chunks: Buffer[] = [];
      reply.on("data", (chunk: Buffer) => chunks.push(chunk));
      reply.on("end", () => {
        void (async () => {
          const output = Buffer.concat(chunks);
          if (returnMode ? creditNote : receiptMode ? receipt : invoice) {
            const key = req.headers["idempotency-key"];
            assert.equal(typeof key, "string", "The real UI must send Idempotency-Key");
            const successful = reply.statusCode !== undefined && reply.statusCode >= 200 && reply.statusCode < 300;
            let responseBody;
            try { responseBody = JSON.parse(output.toString("utf8")); }
            catch { assert.ok(!successful, "Successful financial response must contain JSON"); }
            const result = successful ? responseBody : null;
            // This query uses only the disposable pool, after the response ended.
            const counts = await readScenarioCounts();
            const receipts = await readReceipts();
            const paymentState = receiptMode ? await readPaymentState() : undefined;
            const returnState = returnMode ? await readReturnState() : undefined;
            const drop = successful && !dropped && !passSuccess;
            if (drop) dropped = true;
            events.push({
              ...(overlap ? { arrivalIndex: arrivals.indexOf(arrival), journalCount: await journalCount() } : {}),
              ...(!receiptMode && !returnMode ? { invoiceState: await readInvoiceState() } : {}),
              recordedAt: Date.now(),
              responseBody,
              ...(receipt ? { arrivalIndex: arrivals.indexOf(arrival) } : {}),
              ...(!receiptMode && !returnMode ? { journals: await readJournals(), body: JSON.parse(input.toString("utf8")) } : {}),
              storageKey: `hasba:financial-request:${createHash("sha256").update(`${req.url?.split("?")[0]}\n${input.toString("utf8")}`).digest("hex")}`,
              key, bodyHash: createHash("sha256").update(input).digest("hex"),
              upstreamStatus: reply.statusCode,
              replayed: reply.headers["idempotency-replayed"] === "true",
              replayHeader: reply.headers["idempotency-replayed"] ?? null,
              ...(receiptMode ? { paymentReceiptId: result?.id, paymentState, journals: await readJournals(), body: JSON.parse(input.toString("utf8")) } : { invoiceId: result?.id }),
              ...(returnMode ? { creditNoteId: result?.id, returnState, body: JSON.parse(input.toString("utf8")) } : {}),
              reference: result?.reference,
              counts, receipts, dropped: drop,
            });
            finalReceipts = receipts;
            finalPaymentState = paymentState;
            finalReturnState = returnState;
            receiptsObservedAt = Date.now();
            save();
            if (drop) {
              // No bytes from the committed success are sent to the browser.
              res.destroy();
              console.log(returnMode
                ? "[browser-retry] Committed return success dropped; capture sessionStorage, then retry the unchanged dialog."
                : receiptMode
                ? "[browser-retry] Committed receipt success dropped; capture sessionStorage, then retry the unchanged dialog."
                : "[browser-retry] Committed success dropped; capture sessionStorage, reload, then re-enter the same data.");
              return;
            }
          }
          res.writeHead(reply.statusCode ?? 502, reply.headers);
          res.end(output);
          if ((overlapReturns && creditNote) || (overlapInvoices && invoice) || receipt) {
            arrival.responseSentAt = Date.now();
            save();
          }
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
