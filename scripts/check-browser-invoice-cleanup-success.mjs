import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function checkInvoiceCleanup(proxy, browser) {
  assert.ok(proxy.runId);
  assert.equal(browser.runId, proxy.runId);
  assert.deepEqual(proxy.initialCounts, { invoices: 0, receipts: 0 });
  assert.deepEqual(proxy.initialJournals, []);
  assert.equal(proxy.invoicePostCount, 2);
  assert.equal(proxy.events.length, 2);
  const [first, retry] = proxy.events;
  assert.equal(first.replayed, false);
  assert.equal(retry.replayed, true);
  assert.equal(retry.replayHeader, "true");
  assert.ok(first.invoiceId);
  assert.ok(first.reference);
  assert.ok(first.key);
  for (const field of ["invoiceId", "reference", "key", "bodyHash", "storageKey", "body", "journals", "receipts"]) {
    assert.deepEqual(retry[field], first[field], `Unchanged ${field}`);
  }
  for (const event of proxy.events) {
    assert.equal(event.upstreamStatus, 201);
    assert.equal(event.dropped, false);
    assert.deepEqual(event.counts, { invoices: 1, receipts: 1 });
    assert.ok(Array.isArray(event.journals));
    assert.equal(event.journals.length, 1);
    assert.equal(event.receipts.length, 1);
    assert.equal(event.receipts[0].key, first.key);
    assert.equal(String(event.receipts[0].invoiceId), String(first.invoiceId));
  }
  assert.deepEqual(proxy.finalCounts, retry.counts);
  assert.deepEqual(proxy.finalJournals, first.journals);
  assert.deepEqual(proxy.finalReceipts, first.receipts);
  assert.equal(browser.responses.length, 2);
  browser.responses.forEach((response, i) => {
    assert.equal(response.status, 201);
    assert.equal(response.body.id, first.invoiceId);
    assert.equal(response.body.reference, first.reference);
    assert.equal(response.key, first.key);
    assert.deepEqual(JSON.parse(response.requestBody), first.body);
    assert.equal(response.replayed, i === 1);
    assert.ok(Number.isFinite(response.jsonObservedAt));
  });
  assert.equal(browser.removalAttempts.length, 1);
  assert.equal(browser.removalAttempts[0].key, first.storageKey);
  assert.ok(browser.removalAttempts[0].at >= browser.responses[0].jsonObservedAt);
  assert.equal(browser.afterCleanupFailure.formOpen, true);
  assert.match(browser.afterCleanupFailure.message, /تم حفظ العملية بالفعل، لكن تعذر تنظيف مفتاحها/);
  assert.ok(Object.keys(browser.beforeSave.fields).length > 0);
  assert.deepEqual(browser.afterCleanupFailure.fields, browser.beforeSave.fields);
  assert.deepEqual(browser.beforeRetry.fields, browser.beforeSave.fields);
  for (const snapshot of [browser.afterCleanupFailure, browser.beforeRetry]) {
    assert.deepEqual(snapshot.entries, [{ storageKey: first.storageKey, key: first.key }]);
  }
  assert.deepEqual(browser.restored, { removeItem: true, probe: true, fetch: true });
  assert.equal(browser.afterSuccess.formClosed, true);
  assert.deepEqual(browser.afterSuccess.entries, []);
  assert.equal(browser.afterSuccess.visibleInvoiceCount, 1);
  assert.deepEqual(browser.afterSuccess.references, [first.reference]);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = "generated-artifacts/verification";
  checkInvoiceCleanup(
    JSON.parse(readFileSync(`${dir}/browser-retry-proxy.json`, "utf8")),
    JSON.parse(readFileSync(`${dir}/browser-invoice-cleanup-success.json`, "utf8")),
  );
  console.log("PASS: confirmed invoice success, cleanup failure, unchanged replay and database state");
}
