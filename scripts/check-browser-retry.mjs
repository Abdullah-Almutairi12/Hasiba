// Verify the real browser's requests recorded by the disposable API proxy.
// This does not create invoices or connect to any database.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const report = fileURLToPath(new URL("../generated-artifacts/verification/browser-retry-proxy.json", import.meta.url));
const { events } = JSON.parse(readFileSync(report, "utf8"));
assert.equal(events.length, 2, "Expected one form submission and one unchanged retry");
const [first, retry] = events;
for (const attempt of events) {
  assert.ok(attempt.upstreamStatus >= 200 && attempt.upstreamStatus < 300, "The real API must commit successfully");
  assert.ok(attempt.invoiceId, "The response must identify the invoice");
  assert.ok(attempt.reference, "The response must identify the invoice reference");
  assert.deepEqual(attempt.counts, { invoices: 1, receipts: 1 }, "Each attempt must leave just one invoice and receipt");
}
assert.equal(first.dropped, true, "Drop the committed success, not the outgoing request");
assert.equal(first.replayed, false);
assert.equal(retry.dropped, false);
assert.equal(retry.replayed, true, "The retry must replay the committed receipt");
assert.equal(typeof first.key, "string");
assert.ok(first.key.length > 0);
assert.equal(first.key, retry.key, "The browser must reuse Idempotency-Key");
assert.equal(first.bodyHash, retry.bodyHash, "The form must retry unchanged data");
assert.equal(first.invoiceId, retry.invoiceId);
assert.equal(first.reference, retry.reference);
console.log("PASS: two real form requests, lost committed response, same key/body, one replayed invoice and one receipt.");
