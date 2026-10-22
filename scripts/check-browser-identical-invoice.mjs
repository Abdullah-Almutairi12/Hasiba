// Separate three-request scenario; the reload-only guard still requires exactly two.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { checkBrowserRetry } from "./check-browser-retry.mjs";

export function checkBrowserIdenticalInvoice(proxy, browser) {
  assert.equal(proxy.events.length, 3, "Expected lost success, replay, then a new identical invoice");
  checkBrowserRetry({ ...proxy, events: proxy.events.slice(0, 2) }, browser);
  const [first, retry, second] = proxy.events;
  const { afterSuccess, afterNewForm, afterSecondSuccess } = browser;
  assert.ok(second.upstreamStatus >= 200 && second.upstreamStatus < 300);
  assert.equal(second.dropped, false);
  assert.equal(second.replayed, false, "A new intent must not replay the first invoice");
  assert.equal(second.replayHeader, null, "The new response must have no replay header at all");
  assert.equal(typeof second.key, "string");
  assert.ok(second.key.length > 0);
  assert.notEqual(second.key, first.key, "Confirmed success must permit a fresh operation key");
  assert.equal(second.bodyHash, first.bodyHash, "The new invoice must have exactly the same form data");
  assert.equal(second.storageKey, first.storageKey, "Identical data must address the same session slot");
  assert.ok(second.invoiceId);
  assert.ok(second.reference);
  assert.notEqual(second.invoiceId, first.invoiceId);
  assert.notEqual(second.reference, first.reference);
  assert.deepEqual(second.counts, { invoices: 2, receipts: 2 });

  for (const attempt of [first, retry, second]) {
    assert.equal(attempt.receipts.length, attempt.counts.receipts);
    assert.equal(new Set(attempt.receipts.map((r) =>
      JSON.stringify([r.companyId, r.userId, r.operation, r.key]))).size, attempt.receipts.length,
    "Receipt identities must be distinct");
    for (const receipt of attempt.receipts) {
      assert.ok(Number.isInteger(receipt.companyId) && receipt.companyId > 0);
      assert.ok(Number.isInteger(receipt.userId) && receipt.userId > 0);
      assert.ok(typeof receipt.operation === "string" && receipt.operation.length > 0);
    }
  }
  assert.equal(first.receipts[0].key, first.key);
  assert.deepEqual(retry.receipts, first.receipts, "Replay must preserve the original receipt");
  assert.deepEqual(second.receipts.find((r) => r.key === first.key), first.receipts[0]);
  assert.ok(Number.isFinite(proxy.receiptsObservedAt) && proxy.receiptsObservedAt >= second.recordedAt,
    "Read persisted receipt links after the final commit");
  assert.equal(proxy.finalReceipts.length, 2);
  const identity = (r) => JSON.stringify([r.companyId, r.userId, r.operation, r.key]);
  assert.deepEqual(proxy.finalReceipts.map(identity).sort(), second.receipts.map(identity).sort(),
    "The final database snapshot must preserve exactly the evidenced receipt identities");
  const originalReceipt = proxy.finalReceipts.find((r) => r.key === first.key);
  assert.equal(String(originalReceipt?.invoiceId), String(first.invoiceId));
  const newReceipt = proxy.finalReceipts.find((r) => r.key === second.key);
  assert.ok(newReceipt, "A separate persisted receipt must belong to the fresh key");
  assert.equal(String(newReceipt.invoiceId), String(second.invoiceId));
  for (const field of ["companyId", "userId", "operation"]) {
    assert.equal(newReceipt[field], first.receipts[0][field]);
  }

  for (const stage of [afterNewForm, afterSecondSuccess]) {
    assert.ok(stage && Number.isFinite(stage.observedAt));
    assert.equal(stage.timeOrigin, afterSuccess.timeOrigin, "Start the next form in the same document");
    assert.deepEqual(stage.entries, [], "No pending key may remain after confirmed success");
  }
  assert.equal(afterNewForm.formOpen, true, "Open a new form after the successful replay closed it");
  assert.ok(afterSuccess.observedAt < afterNewForm.observedAt);
  assert.ok(afterNewForm.observedAt < second.recordedAt);
  assert.ok(second.recordedAt <= afterSecondSuccess.observedAt);
  assert.equal(afterSecondSuccess.formClosed, true);
  assert.equal(afterSecondSuccess.visibleInvoiceCount, 2);
  assert.deepEqual([...afterSecondSuccess.references].sort(), [first.reference, second.reference].sort(),
    "Both distinct references must appear exactly once in the refreshed list");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = new URL("../generated-artifacts/verification/", import.meta.url);
  checkBrowserIdenticalInvoice(
    JSON.parse(readFileSync(new URL("browser-identical-invoice-proxy.json", dir), "utf8")),
    JSON.parse(readFileSync(new URL("browser-identical-invoice.json", dir), "utf8")),
  );
  console.log("PASS: lost success recovered; a new identical form uses a fresh key, no replay header, two invoices and two distinct persisted receipts.");
}
