// Verify the real browser's requests recorded by the disposable API proxy.
// This does not create invoices or connect to any database.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export function checkBrowserRetry(proxy, browser) {
const { events } = proxy;
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
assert.ok(proxy.runId, "Evidence must identify the isolated proxy run");
assert.equal(browser.runId, proxy.runId, "Browser and proxy evidence must belong to the same run");
const { beforeReload, afterReload, afterSuccess } = browser;
for (const snapshot of [beforeReload, afterReload, afterSuccess]) {
  assert.ok(snapshot && Number.isFinite(snapshot.observedAt), "Each browser stage needs a timestamp");
  assert.ok(Number.isFinite(snapshot.timeOrigin), "Each stage needs the browser document time origin");
  assert.ok(Array.isArray(snapshot.entries), "Capture only financial sessionStorage entries");
  for (const [name, value] of snapshot.entries) {
    assert.match(name, /^hasba:financial-request:[a-f0-9]{64}$/);
    assert.equal(typeof value, "string");
  }
}
assert.match(first.storageKey, /^hasba:financial-request:[a-f0-9]{64}$/);
assert.equal(first.storageKey, retry.storageKey);
assert.deepEqual(beforeReload.entries, [[first.storageKey, first.key]], "Keep the uncertain intent before reload");
assert.deepEqual(afterReload.entries, beforeReload.entries, "sessionStorage must survive the real reload unchanged");
assert.ok(afterReload.timeOrigin > beforeReload.timeOrigin, "A new document must load between submissions");
assert.equal(afterReload.navigationType, "reload", "Use a real page reload, not an SPA navigation");
assert.equal(afterSuccess.timeOrigin, afterReload.timeOrigin, "Retry in the reloaded document");
assert.ok(first.recordedAt <= beforeReload.observedAt, "Capture the pending key after committed response loss");
assert.ok(beforeReload.observedAt < afterReload.timeOrigin, "Reload only after capturing the uncertain intent");
assert.ok(afterReload.timeOrigin <= afterReload.observedAt);
assert.ok(afterReload.observedAt < retry.recordedAt, "Capture the retained key before re-entering and saving");
assert.ok(retry.recordedAt <= afterSuccess.observedAt, "Inspect cleanup after the successful replay");
assert.deepEqual(afterSuccess.entries, [], "Confirmed success must remove the pending financial key");
assert.equal(afterSuccess.formClosed, true, "Successful retry must close the form");
assert.equal(afterSuccess.visibleInvoiceCount, 1, "The invoice list must show the invoice exactly once");
assert.equal(afterSuccess.reference, first.reference, "The list must show the original committed invoice");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = new URL("../generated-artifacts/verification/", import.meta.url);
  checkBrowserRetry(
    JSON.parse(readFileSync(new URL("browser-retry-proxy.json", dir), "utf8")),
    JSON.parse(readFileSync(new URL("browser-retry-reload.json", dir), "utf8")),
  );
  console.log("PASS: committed response lost, real reload with retained sessionStorage key, identical replay, one invoice/receipt, key cleared after success.");
}
