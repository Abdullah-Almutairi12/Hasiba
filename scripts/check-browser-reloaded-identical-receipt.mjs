import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkReloadedReceiptCleanup } from "./check-browser-reloaded-receipt-cleanup.mjs";

export function checkReloadedIdenticalReceipt(proxy, browser, beforeRetryProxy, afterRecoveryProxy) {
  assert.equal(proxy.events.length, 3);
  assert.equal(proxy.receiptPostCount, 3);
  assert.equal(proxy.invoicePostCount, 0);
  assert.equal(afterRecoveryProxy.events.length, 2);
  assert.equal(afterRecoveryProxy.receiptPostCount, 2);
  assert.deepEqual(afterRecoveryProxy.events, proxy.events.slice(0, 2));
  assert.equal(afterRecoveryProxy.runId, proxy.runId);
  assert.equal(afterRecoveryProxy.scenario, proxy.scenario);
  for (const field of ["initialCounts", "initialJournals", "initialPaymentState"]) {
    assert.deepEqual(afterRecoveryProxy[field], proxy[field]);
  }
  assert.equal(browser.responses.length, 3);
  // Validate the complete reload/replay flow against its independently captured
  // database state before the next intent, not a manufactured final snapshot.
  checkReloadedReceiptCleanup(afterRecoveryProxy,
    { ...browser, responses: browser.responses.slice(0, 2) }, beforeRetryProxy);
  const [first, retry, second] = proxy.events;
  assert.ok(afterRecoveryProxy.receiptsObservedAt < second.recordedAt);
  assert.equal(second.upstreamStatus, 201);
  assert.equal(second.dropped, false);
  assert.equal(second.replayed, false);
  assert.equal(second.replayHeader, null);
  assert.ok(typeof second.key === "string" && second.key.length > 0);
  assert.notEqual(second.key, first.key);
  assert.ok(Number.isInteger(second.paymentReceiptId) && second.paymentReceiptId > 0);
  assert.notEqual(second.paymentReceiptId, first.paymentReceiptId);
  assert.match(second.reference, /^RCT-/);
  assert.notEqual(second.reference, first.reference);
  for (const field of ["body", "bodyHash", "storageKey"]) assert.deepEqual(second[field], first[field]);
  assert.deepEqual(second.counts, { invoices: 1, paymentReceipts: 2, receipts: 2 });
  const invoice = proxy.initialPaymentState.invoices[0];
  assert.ok(invoice.total > 100);
  assert.deepEqual(second.paymentState.invoices,
    [{ ...invoice, amountPaid: 100, status: "partially_paid" }]);
  const originalPayment = first.paymentState.payments[0];
  assert.equal(second.paymentState.payments.length, 2);
  assert.deepEqual(second.paymentState.payments.find((p) => p.id === originalPayment.id), originalPayment);
  const newPayment = second.paymentState.payments.find((p) => p.id === second.paymentReceiptId);
  assert.ok(newPayment);
  assert.deepEqual(newPayment, { id: second.paymentReceiptId, reference: second.reference,
    customerId: first.body.customerId, amount: 50, paymentMethod: "cash",
    journalEntryId: newPayment.journalEntryId });
  assert.ok(Number.isInteger(newPayment.journalEntryId) && newPayment.journalEntryId > 0);
  assert.notEqual(newPayment.journalEntryId, originalPayment.journalEntryId);
  assert.deepEqual(second.journals, [...first.journals, { id: newPayment.journalEntryId }]);
  assert.equal(new Set(second.journals.map((j) => j.id)).size, second.journals.length);
  assert.equal(second.journals.length, proxy.initialJournals.length + 2);
  assert.deepEqual(second.paymentState.allocations, [
    ...first.paymentState.allocations, { receiptId: newPayment.id, invoiceId: invoice.id, amount: 50 },
  ]);
  assert.equal(second.receipts.length, 2);
  assert.deepEqual(second.receipts.find((r) => r.key === first.key), first.receipts[0]);
  assert.deepEqual(second.receipts.find((r) => r.key === second.key),
    { ...first.receipts[0], key: second.key, paymentReceiptId: String(second.paymentReceiptId) });
  assert.ok(retry.recordedAt < second.recordedAt);
  assert.ok(Number.isFinite(proxy.receiptsObservedAt) && proxy.receiptsObservedAt >= second.recordedAt);
  for (const [final, event] of [["finalCounts", "counts"], ["finalJournals", "journals"],
    ["finalReceipts", "receipts"], ["finalPaymentState", "paymentState"]]) {
    assert.deepEqual(proxy[final], second[event]);
  }
  const { afterSuccess, afterNewForm, afterSecondSuccess } = browser;
  for (const stage of [afterNewForm, afterSecondSuccess]) {
    assert.ok(Number.isFinite(stage.observedAt));
    assert.equal(stage.timeOrigin, afterSuccess.timeOrigin);
    assert.deepEqual(stage.entries, []);
  }
  assert.ok(afterSuccess.observedAt < afterNewForm.observedAt);
  assert.equal(afterNewForm.formOpen, true);
  assert.deepEqual(afterNewForm.fields, browser.beforeRetry.fields);
  assert.equal(afterNewForm.receiptPostCount, 1, "Opening/refilling must not POST");
  const response = browser.responses[2];
  assert.equal(response.status, 201);
  assert.equal(response.replayed, false);
  assert.equal(response.key, second.key);
  assert.equal(response.body.id, second.paymentReceiptId);
  assert.equal(response.body.reference, second.reference);
  assert.equal(response.requestBody, browser.responses[1].requestBody);
  assert.equal(createHash("sha256").update(response.requestBody).digest("hex"), second.bodyHash);
  assert.ok(Number.isFinite(response.jsonObservedAt));
  assert.ok(afterNewForm.observedAt < response.jsonObservedAt);
  assert.ok(response.jsonObservedAt <= afterSecondSuccess.observedAt);
  assert.equal(afterSecondSuccess.formClosed, true);
  assert.equal(afterSecondSuccess.receiptPostCount, 2);
  assert.equal(afterSecondSuccess.visibleReceiptCount, 2);
  assert.deepEqual([...afterSecondSuccess.references].sort(), [first.reference, second.reference].sort());
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = new URL("../generated-artifacts/verification/", import.meta.url);
  const load = (name) => JSON.parse(readFileSync(new URL(name, dir), "utf8"));
  checkReloadedIdenticalReceipt(load("browser-identical-receipt-proxy.json"),
    load("browser-reloaded-identical-receipt.json"),
    load("browser-reloaded-receipt-cleanup-before-retry-proxy.json"),
    load("browser-reloaded-identical-receipt-after-recovery-proxy.json"));
  console.log("PASS: reload recovery then fresh identical receipt; new key/ID, two rows/allocations, paid 100, exactly two new journals.");
}
