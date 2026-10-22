import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function checkReceiptCleanup(proxy, browser) {
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
  assert.equal(proxy.invoicePostCount, 0);
  assert.equal(proxy.receiptPostCount, 2);
  assert.equal(proxy.events.length, 2);
  const [first, retry] = proxy.events;
  assert.ok(first.key);
  assert.ok(Number.isInteger(first.paymentReceiptId) && first.paymentReceiptId > 0);
  assert.match(first.reference, /^RCT-/);
  assert.deepEqual(first.body, { customerId: invoice.customerId, amount: 50, paymentMethod: "cash",
    allocations: [{ invoiceId: invoice.id, amount: 50 }] });
  for (const field of ["paymentReceiptId", "reference", "key", "bodyHash", "storageKey", "body", "journals", "receipts", "paymentState"]) {
    assert.deepEqual(retry[field], first[field], `Unchanged ${field}`);
  }
  for (const [index, event] of proxy.events.entries()) {
    assert.equal(event.upstreamStatus, 201);
    assert.equal(event.dropped, false);
    assert.equal(event.replayed, index === 1);
    assert.equal(event.replayHeader, index === 1 ? "true" : null);
    assert.deepEqual(event.counts, { invoices: 1, paymentReceipts: 1, receipts: 1 });
    assert.equal(event.receipts.length, 1);
    assert.equal(event.receipts[0].key, first.key);
    assert.match(event.receipts[0].operation, /^POST:.*:\/sales\/receipts$/);
    assert.equal(String(event.receipts[0].paymentReceiptId), String(first.paymentReceiptId));
    assert.equal(event.paymentState.payments.length, 1);
    const [payment] = event.paymentState.payments;
    assert.deepEqual(payment, { id: first.paymentReceiptId, reference: first.reference,
      customerId: invoice.customerId, amount: 50, paymentMethod: "cash", journalEntryId: payment.journalEntryId });
    assert.ok(Number.isInteger(payment.journalEntryId) && payment.journalEntryId > 0);
    assert.deepEqual(event.journals, [...proxy.initialJournals, { id: payment.journalEntryId }]);
    assert.deepEqual(event.paymentState.allocations, [{ receiptId: payment.id, invoiceId: invoice.id, amount: 50 }]);
    assert.deepEqual(event.paymentState.invoices, [{ ...invoice, amountPaid: 50, status: "partially_paid" }]);
  }
  assert.deepEqual(proxy.finalCounts, first.counts);
  assert.deepEqual(proxy.finalJournals, first.journals);
  assert.deepEqual(proxy.finalReceipts, first.receipts);
  assert.deepEqual(proxy.finalPaymentState, first.paymentState);
  assert.equal(browser.responses.length, 2);
  browser.responses.forEach((response, i) => {
    assert.equal(response.status, 201);
    assert.equal(response.body.id, first.paymentReceiptId);
    assert.equal(response.body.reference, first.reference);
    assert.equal(response.key, first.key);
    assert.deepEqual(JSON.parse(response.requestBody), first.body);
    const hash = (s) => createHash("sha256").update(s).digest("hex");
    assert.equal(hash(response.requestBody), first.bodyHash);
    assert.equal(`hasba:financial-request:${hash(`/api/sales/receipts\n${response.requestBody}`)}`, first.storageKey);
    assert.equal(response.replayed, i === 1);
    assert.ok(Number.isFinite(response.jsonObservedAt));
  });
  assert.equal(browser.removalAttempts.length, 1);
  assert.equal(browser.removalAttempts[0].key, first.storageKey);
  assert.ok(browser.removalAttempts[0].at >= browser.responses[0].jsonObservedAt);
  assert.equal(browser.afterCleanupFailure.formOpen, true);
  assert.match(browser.afterCleanupFailure.message, /تم حفظ العملية بالفعل، لكن تعذر تنظيف مفتاحها/);
  assert.ok(browser.customerName && browser.invoiceReference);
  assert.deepEqual(browser.beforeSave.fields, { customerName: browser.customerName, amount: "50",
    paymentMethod: "نقدي", invoiceReference: browser.invoiceReference, allocation: "50" });
  assert.deepEqual(browser.afterCleanupFailure.fields, browser.beforeSave.fields);
  assert.deepEqual(browser.beforeRetry.fields, browser.beforeSave.fields);
  assert.equal(browser.beforeRetry.formOpen, true);
  for (const snapshot of [browser.afterCleanupFailure, browser.beforeRetry]) {
    assert.deepEqual(snapshot.entries, [{ storageKey: first.storageKey, key: first.key }]);
  }
  assert.deepEqual(browser.restored, { removeItem: true, probe: true, fetch: true });
  for (const snapshot of [browser.afterSuccess, browser.afterReload]) {
    assert.equal(snapshot.formClosed, true);
    assert.deepEqual(snapshot.entries, []);
    assert.equal(snapshot.visibleReceiptCount, 1);
    assert.deepEqual(snapshot.references, [first.reference]);
  }
  assert.ok(Number.isFinite(browser.afterSuccess.timeOrigin));
  assert.ok(browser.afterReload.timeOrigin > browser.afterSuccess.timeOrigin, "Require a real reload");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = "generated-artifacts/verification";
  checkReceiptCleanup(
    JSON.parse(readFileSync(`${dir}/browser-identical-receipt-proxy.json`, "utf8")),
    JSON.parse(readFileSync(`${dir}/browser-receipt-cleanup-success.json`, "utf8")),
  );
  console.log("PASS: confirmed receipt success, failed cleanup, unchanged replay, accounting and reload");
}
