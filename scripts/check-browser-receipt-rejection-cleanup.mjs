import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function checkReceiptRejectionCleanup(proxy, browser) {
  assert.equal(proxy.scenario, "identical-receipt");
  assert.ok(proxy.runId);
  assert.equal(browser.runId, proxy.runId);
  assert.deepEqual(proxy.initialCounts, { invoices: 1, paymentReceipts: 0, receipts: 0 });
  assert.deepEqual(proxy.initialPaymentState.payments, []);
  assert.deepEqual(proxy.initialPaymentState.allocations, []);
  assert.equal(proxy.initialPaymentState.invoices.length, 1);
  const [invoice] = proxy.initialPaymentState.invoices;
  assert.equal(invoice.amountPaid, 0);
  assert.equal(invoice.status, "open");
  assert.ok(Array.isArray(proxy.initialJournals));
  assert.equal(proxy.invoicePostCount, 0);
  assert.equal(proxy.returnPostCount, 0);
  assert.equal(proxy.receiptPostCount, 2);
  assert.equal(proxy.events.length, 2);
  assert.equal(proxy.arrivals.length, 2);
  assert.equal(browser.responses.length, 2);
  const hash = (s) => createHash("sha256").update(s).digest("hex");
  const [first] = proxy.events;
  assert.ok(first.key);
  const error = { error: "مجموع التوزيع يجب أن يساوي مبلغ السند" };
  const body = { customerId: invoice.customerId, amount: 50, paymentMethod: "cash",
    allocations: [{ invoiceId: invoice.id, amount: 40 }] };
  for (const [i, event] of proxy.events.entries()) {
    assert.equal(event.key, first.key);
    assert.equal(event.bodyHash, first.bodyHash);
    assert.equal(event.storageKey, first.storageKey);
    assert.deepEqual(event.body, body);
    assert.equal(event.upstreamStatus, 400);
    assert.deepEqual(event.responseBody, error);
    assert.equal(event.dropped, false);
    assert.equal(event.replayed, false);
    assert.equal(event.replayHeader, null);
    assert.equal(event.paymentReceiptId, undefined);
    assert.equal(event.reference, undefined);
    assert.equal(event.arrivalIndex, i);
    const arrival = proxy.arrivals[i];
    assert.ok(Number.isFinite(arrival.arrivedAt));
    assert.ok(arrival.responseSentAt >= event.recordedAt);
    assert.ok(event.recordedAt >= arrival.arrivedAt);
    assert.deepEqual(event.counts, proxy.initialCounts);
    assert.deepEqual(event.paymentState, proxy.initialPaymentState);
    assert.deepEqual(event.journals, proxy.initialJournals);
    assert.deepEqual(event.receipts, []);
    const response = browser.responses[i];
    assert.equal(response.requestBody, browser.responses[0].requestBody);
    assert.equal(response.status, 400);
    assert.deepEqual(response.body, error);
    assert.equal(response.key, first.key);
    assert.equal(response.replayed, false);
    assert.deepEqual(JSON.parse(response.requestBody), body);
    assert.equal(event.bodyHash, hash(response.requestBody));
    assert.equal(event.storageKey, `hasba:financial-request:${hash(`/api/sales/receipts\n${response.requestBody}`)}`);
    assert.ok(Number.isFinite(response.jsonObservedAt));
  }
  assert.ok(proxy.capturedAt >= proxy.arrivals[1].responseSentAt);
  assert.deepEqual(proxy.finalCounts, proxy.initialCounts);
  assert.deepEqual(proxy.finalJournals, proxy.initialJournals);
  assert.deepEqual(proxy.finalPaymentState, proxy.initialPaymentState);
  assert.deepEqual(proxy.finalReceipts, []);
  assert.ok(browser.customerName && browser.invoiceReference);
  assert.deepEqual(browser.beforeSave.fields, { customerName: browser.customerName, amount: "50",
    paymentMethod: "نقدي", invoiceReference: browser.invoiceReference, allocation: "40" });
  assert.deepEqual(browser.beforeSave.entries, []);
  assert.equal(browser.beforeSave.formOpen, true);
  for (const snapshot of [browser.afterCleanupFailure, browser.beforeRetry, browser.afterRetry]) {
    assert.equal(snapshot.formOpen, true);
    assert.deepEqual(snapshot.fields, browser.beforeSave.fields);
    assert.equal(snapshot.visibleReceiptCount, 0);
  }
  for (const snapshot of [browser.afterCleanupFailure, browser.beforeRetry]) {
    assert.deepEqual(snapshot.entries, [{ storageKey: first.storageKey, key: first.key }]);
  }
  assert.deepEqual(browser.afterRetry.entries, []);
  assert.match(browser.afterCleanupFailure.message, /رفض الخادم العملية، لكن تعذر تنظيف مفتاحها/);
  assert.match(browser.afterRetry.message, /مجموع التوزيع يجب أن يساوي مبلغ السند/);
  for (const snapshot of [browser.afterCleanupFailure, browser.afterRetry]) {
    assert.doesNotMatch(snapshot.message, /تم حفظ العملية بالفعل|تم تسجيل سند القبض|قد تكون حُفظت بالفعل/);
  }
  assert.equal(browser.removalAttempts.length, 1);
  assert.equal(browser.removalAttempts[0].key, first.storageKey);
  assert.ok(browser.removalAttempts[0].at >= browser.responses[0].jsonObservedAt);
  assert.deepEqual(browser.faultScope, { sessionStorageOnly: true, financialKeysOnly: true,
    getItemUnchanged: true, setItemUnchanged: true });
  assert.deepEqual(browser.restored, { removeItem: true, probe: true, fetch: true });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = "generated-artifacts/verification";
  checkReceiptRejectionCleanup(
    JSON.parse(readFileSync(`${dir}/browser-identical-receipt-proxy.json`, "utf8")),
    JSON.parse(readFileSync(`${dir}/browser-receipt-rejection-cleanup.json`, "utf8")),
  );
  console.log("PASS: definitive receipt rejection, cleanup failure, retained form/key, rejected retry and unchanged accounting");
}
