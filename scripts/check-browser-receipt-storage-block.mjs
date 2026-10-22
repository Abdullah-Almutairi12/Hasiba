import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function checkReceiptStorageBlock(blocked, browser, final) {
  assert.ok(blocked.runId);
  for (const report of [browser, final]) assert.equal(report.runId, blocked.runId);
  assert.equal(blocked.scenario, "identical-receipt");
  assert.equal(final.scenario, blocked.scenario);
  for (const counter of ["receiptPostCount", "invoicePostCount", "returnPostCount"]) {
    assert.equal(blocked[counter], 0, `Zero ingress: ${counter}`);
  }
  assert.deepEqual(blocked.events, []);
  assert.deepEqual(blocked.arrivals, []);
  assert.deepEqual(blocked.initialCounts, { invoices: 1, paymentReceipts: 0, receipts: 0 });
  assert.deepEqual(blocked.finalCounts, blocked.initialCounts);
  assert.deepEqual(blocked.finalJournals, blocked.initialJournals, "No new journal");
  assert.deepEqual(blocked.finalPaymentState, blocked.initialPaymentState);
  assert.deepEqual(blocked.finalReceipts, []);
  assert.deepEqual(blocked.initialPaymentState.payments, []);
  assert.deepEqual(blocked.initialPaymentState.allocations, []);
  assert.equal(blocked.initialPaymentState.invoices.length, 1);
  const [invoice] = blocked.initialPaymentState.invoices;
  assert.ok(Number.isInteger(invoice.id) && invoice.id > 0);
  assert.equal(invoice.customerId, browser.customerId);
  assert.equal(invoice.total, 300);
  assert.equal(invoice.amountPaid, 0);
  assert.equal(invoice.status, "open");
  assert.ok(browser.customerName && browser.invoiceReference);
  const body = { customerId: invoice.customerId, amount: 50, paymentMethod: "cash",
    allocations: [{ invoiceId: invoice.id, amount: 50 }] };
  const digest = (s) => createHash("sha256").update(s).digest("hex");
  const storageKey = `hasba:financial-request:${digest(`/api/sales/receipts\n${JSON.stringify(body)}`)}`;
  assert.equal(browser.faultMethod, "setItem");
  assert.equal(browser.faultName, "SecurityError");
  assert.deepEqual(browser.blockedKeys, [storageKey], "Reach exactly the intended completed receipt");
  assert.equal(browser.blockedReceiptPostCount, 0, "No browser POST before storage recovery");
  assert.equal(browser.recoveryReceiptPostCount, 1);
  assert.equal(browser.unrelatedStorageWorked, true);
  const fields = { customerName: browser.customerName, amount: "50", paymentMethod: "نقدي",
    invoiceReference: browser.invoiceReference, allocation: "50" };
  let previous = -Infinity;
  for (const stage of [browser.beforeSave, browser.afterBlockedSave, browser.restored, browser.afterSuccess]) {
    assert.ok(Number.isFinite(stage.observedAt) && stage.observedAt > previous);
    previous = stage.observedAt;
    assert.ok(Number.isFinite(stage.timeOrigin) && stage.timeOrigin <= stage.observedAt);
    assert.equal(stage.timeOrigin, browser.beforeSave.timeOrigin);
    assert.deepEqual(stage.entries, []);
    if (stage !== browser.afterSuccess) {
      assert.equal(stage.formOpen, true);
      assert.deepEqual(stage.fields, fields, "Retain actual rendered form");
    }
  }
  assert.equal(browser.afterBlockedSave.error,
    "تعذر حفظ مفتاح العملية بأمان. لم يُرسل الطلب؛ فعّل تخزين الجلسة وأعد المحاولة.");
  for (const flag of ["originalGetItemRestored", "originalSetItemRestored",
    "originalRemoveItemRestored", "originalFetchRestored", "financialWriteReadRemoved"]) {
    assert.equal(browser.restored[flag], true, flag);
  }
  // Order proxy evidence only on its own clock, never against browser time.
  assert.ok(Number.isFinite(blocked.startedAt) && Number.isFinite(blocked.capturedAt));
  assert.ok(blocked.startedAt <= blocked.capturedAt);
  for (const field of ["initialCounts", "initialJournals", "initialPaymentState"]) {
    assert.deepEqual(final[field], blocked[field]);
  }
  assert.equal(final.receiptPostCount, 1);
  assert.equal(final.invoicePostCount, 0);
  assert.equal(final.returnPostCount, 0);
  assert.equal(final.arrivals.length, 1);
  assert.ok(final.arrivals[0].arrivedAt >= blocked.capturedAt);
  assert.equal(final.events.length, 1);
  const [event] = final.events;
  assert.ok(event.recordedAt >= final.arrivals[0].arrivedAt);
  assert.deepEqual(event.body, body);
  assert.equal(event.bodyHash, digest(JSON.stringify(body)));
  assert.equal(event.storageKey, storageKey);
  assert.ok(event.key);
  assert.equal(event.upstreamStatus, 201);
  assert.equal(event.replayed, false);
  assert.equal(event.replayHeader, null);
  assert.equal(event.dropped, false);
  assert.ok(Number.isInteger(event.paymentReceiptId) && event.paymentReceiptId > 0);
  assert.match(event.reference, /^RCT-/);
  assert.deepEqual(event.counts, { invoices: 1, paymentReceipts: 1, receipts: 1 });
  assert.equal(event.receipts.length, 1);
  const [receipt] = event.receipts;
  assert.ok(receipt.companyId > 0 && receipt.userId > 0);
  assert.match(receipt.operation, /^POST:.*:\/sales\/receipts$/);
  assert.equal(receipt.key, event.key);
  assert.equal(String(receipt.paymentReceiptId), String(event.paymentReceiptId));
  assert.equal(event.paymentState.payments.length, 1);
  const [payment] = event.paymentState.payments;
  assert.ok(Number.isInteger(payment.journalEntryId) && payment.journalEntryId > 0);
  assert.deepEqual(payment, { id: event.paymentReceiptId, reference: event.reference,
    customerId: invoice.customerId, amount: 50, paymentMethod: "cash", journalEntryId: payment.journalEntryId });
  assert.ok(!blocked.initialJournals.some((j) => j.id === payment.journalEntryId));
  assert.deepEqual(event.journals, [...blocked.initialJournals, { id: payment.journalEntryId }]);
  assert.deepEqual(event.paymentState.allocations, [{ receiptId: payment.id, invoiceId: invoice.id, amount: 50 }]);
  assert.deepEqual(event.paymentState.invoices, [{ ...invoice, amountPaid: 50, status: "partially_paid" }]);
  for (const [field, source] of [["finalCounts", "counts"], ["finalJournals", "journals"],
    ["finalReceipts", "receipts"], ["finalPaymentState", "paymentState"]]) {
    assert.deepEqual(final[field], event[source]);
  }
  assert.ok(Number.isFinite(final.receiptsObservedAt) && final.receiptsObservedAt >= event.recordedAt);
  assert.equal(browser.responses.length, 1);
  const [response] = browser.responses;
  assert.equal(response.status, 201);
  assert.equal(response.replayed, false);
  assert.equal(response.key, event.key);
  assert.equal(response.requestBody, JSON.stringify(body));
  assert.equal(response.body.id, payment.id);
  assert.equal(response.body.reference, payment.reference);
  assert.ok(response.jsonObservedAt >= browser.restored.observedAt);
  assert.ok(response.jsonObservedAt <= browser.afterSuccess.observedAt);
  assert.equal(browser.afterSuccess.formClosed, true);
  assert.equal(browser.afterSuccess.visibleReceiptCount, 1);
  assert.deepEqual(browser.afterSuccess.references, [event.reference]);
  assert.equal(browser.finalRestored.originalFetchRestored, true);
  assert.equal(browser.finalRestored.originalSetItemRestored, true);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = new URL("../generated-artifacts/verification/", import.meta.url);
  const load = (name) => JSON.parse(readFileSync(new URL(name, dir), "utf8"));
  checkReceiptStorageBlock(load("browser-receipt-storage-block-proxy.json"),
    load("browser-receipt-storage-block.json"), load("browser-identical-receipt-proxy.json"));
  console.log("PASS: first receipt storage write blocked without POST or financial effects; restored save creates exactly one allocated receipt and journal.");
}
