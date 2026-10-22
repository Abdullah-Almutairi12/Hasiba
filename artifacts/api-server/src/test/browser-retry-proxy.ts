/**
 * Disposable browser-test API, never imported by the application.
 * Start only after `node scripts/test-isolated.mjs --browser` is ready
 * and the normal API workflow is stopped. Restore that workflow afterwards.
 *
 * Drops the first successful customer-invoice response AFTER the real app
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
const backend = app.listen(0, "127.0.0.1");
await new Promise<void>((done) => backend.once("listening", done));
const address = backend.address();
assert.ok(address && typeof address !== "string");
const backendPort = address.port;
const reportDir = resolve(import.meta.dirname, "../../../../generated-artifacts/verification");
mkdirSync(reportDir, { recursive: true });
const reportFile = resolve(reportDir, "browser-retry-proxy.json");
const events: Array<Record<string, unknown>> = [];
let dropped = false;
const save = () => writeFileSync(reportFile, JSON.stringify({ events }, null, 2));
save();

const proxy = createServer((req, res) => {
  const invoice = req.method === "POST" && req.url?.split("?")[0] === "/api/sales/invoices";
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
          if (invoice) {
            const key = req.headers["idempotency-key"];
            assert.equal(typeof key, "string", "The real UI must send Idempotency-Key");
            const successful = reply.statusCode !== undefined && reply.statusCode >= 200 && reply.statusCode < 300;
            const result = successful ? JSON.parse(output.toString("utf8")) : null;
            // This query uses only the disposable pool, after the response ended.
            const counts = await pool.query(`
              SELECT
                (SELECT count(*)::int FROM customer_invoices) AS invoices,
                (SELECT count(*)::int FROM financial_requests) AS receipts
            `);
            const drop = successful && !dropped;
            if (drop) dropped = true;
            events.push({
              key, bodyHash: createHash("sha256").update(input).digest("hex"),
              upstreamStatus: reply.statusCode,
              replayed: reply.headers["idempotency-replayed"] === "true",
              invoiceId: result?.id, reference: result?.reference,
              counts: counts.rows[0], dropped: drop,
            });
            save();
            if (drop) {
              // No bytes from the committed success are sent to the browser.
              res.destroy();
              console.log("[browser-retry] Committed success dropped; retry the unchanged form.");
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
