import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Independent of confirmed-success cleanup: the first response never reaches the tab.
export function checkReloadedReceiptReadBlock(proxy, browser, blockedProxy) {
  assert.equal(proxy.scenario, "identical-receipt");
  assert.ok(proxy.runId);
  assert.equal(browser.runId, proxy.runId);
  assert.deepEqual(proxy.initialCounts, { invoices: 1, paymentReceipts: 0, receipts: 0 });
  assert.deepEqual(proxy.initialPaymentState.payments, []);
  assert.deepEqual(proxy.initialPaymentState.allocations, []);
  assert.equal(proxy.initialPaymentState.invoices.length, 1);
  const [invoice] = proxy.initialPaymentState.invoices;
  assert.ok(Number.isInteger(invoice.id) && invoice.id > 0);
  assert.ok(Number.isInteger(browser.customerId) && browser.customerId > 0);
  assert.equal(invoice.customerId, browser.customerId);
  assert.equal(invoice.total, 300);
  assert.equal(invoice.amountPaid, 0);
  assert.equal(invoice.status, "open");
  assert.ok(browser.customerName && browser.invoiceReference);
  assert.equal(proxy.invoicePostCount, 0);
  assert.equal(proxy.returnPostCount, 0);
  assert.equal(proxy.receiptPostCount, 2);
  assert.equal(proxy.events.length, 2);
  const [first, retry] = proxy.events;
  const digest = (s) => createHash("sha256").update(s).digest("hex");
  assert.deepEqual(first.body, {
    customerId: browser.customerId, amount: 50, paymentMethod: "cash",
    allocations: [{ invoiceId: invoice.id, amount: 50 }],
  });
  assert.equal(first.bodyHash, digest(JSON.stringify(first.body)));
  assert.equal(first.storageKey, `hasba:financial-request:${digest(`/api/sales/receipts\n${JSON.stringify(first.body)}`)}`);
  assert.ok(typeof first.key === "string" && first.key.length > 0);
  assert.ok(Number.isInteger(first.paymentReceiptId) && first.paymentReceiptId > 0);
  assert.match(first.reference, /^RCT-/);
  assert.equal(first.dropped, true);
  assert.equal(first.replayed, false);
  assert.equal(first.replayHeader, null);
  assert.equal(retry.dropped, false);
  assert.equal(retry.replayed, true);
  assert.equal(retry.replayHeader, "true");
  for (const field of ["key", "body", "bodyHash", "storageKey", "paymentReceiptId",
    "reference", "counts", "receipts", "paymentState", "journals"]) {
    assert.deepEqual(retry[field], first[field], `Replay preserves ${field}`);
  }
  for (const event of proxy.events) {
    assert.equal(event.upstreamStatus, 201);
    assert.ok(Number.isFinite(event.recordedAt));
    assert.deepEqual(event.counts, { invoices: 1, paymentReceipts: 1, receipts: 1 });
    assert.equal(event.receipts.length, 1);
    const [receipt] = event.receipts;
    assert.ok(Number.isInteger(receipt.companyId) && receipt.companyId > 0);
    assert.ok(Number.isInteger(receipt.userId) && receipt.userId > 0);
    assert.match(receipt.operation, /^POST:.*:\/sales\/receipts$/);
    assert.equal(receipt.key, first.key);
    assert.equal(String(receipt.paymentReceiptId), String(first.paymentReceiptId));
    assert.equal(event.paymentState.payments.length, 1);
    const [payment] = event.paymentState.payments;
    assert.ok(Number.isInteger(payment.journalEntryId) && payment.journalEntryId > 0);
    assert.deepEqual(payment, { id: first.paymentReceiptId, reference: first.reference,
      customerId: browser.customerId, amount: 50, paymentMethod: "cash",
      journalEntryId: payment.journalEntryId });
    assert.ok(Array.isArray(proxy.initialJournals));
    assert.ok(!proxy.initialJournals.some((j) => j.id === payment.journalEntryId));
    assert.deepEqual(event.journals, [...proxy.initialJournals, { id: payment.journalEntryId }]);
    assert.deepEqual(event.paymentState.allocations, [{ receiptId: payment.id, invoiceId: invoice.id, amount: 50 }]);
    assert.deepEqual(event.paymentState.invoices, [{ ...invoice, amountPaid: 50, status: "partially_paid" }]);
  }
  assert.deepEqual(proxy.finalCounts, first.counts);
  assert.deepEqual(proxy.finalJournals, first.journals);
  assert.deepEqual(proxy.finalReceipts, first.receipts);
  assert.deepEqual(proxy.finalPaymentState, first.paymentState);

  const { afterLostResponse, beforeBlockedSave, afterBlockedSave, restored, afterSuccess } = browser;
  assert.ok(beforeBlockedSave.timeOrigin > afterLostResponse.timeOrigin, "Require a real reload");
  assert.ok(beforeBlockedSave.timeOrigin > afterLostResponse.observedAt);
  assert.equal(beforeBlockedSave.navigationType, "reload");
  const fields = { customerName: browser.customerName, amount: "50", paymentMethod: "نقدي",
    invoiceReference: browser.invoiceReference, allocation: "50" };
  let previous = first.recordedAt;
  for (const stage of [afterLostResponse, beforeBlockedSave, afterBlockedSave, restored, afterSuccess]) {
    assert.ok(Number.isFinite(stage.observedAt) && stage.observedAt > previous);
    previous = stage.observedAt;
    assert.ok(Number.isFinite(stage.timeOrigin) && stage.timeOrigin <= stage.observedAt);
    if (stage !== afterLostResponse) assert.equal(stage.timeOrigin, beforeBlockedSave.timeOrigin);
    if (stage !== afterSuccess) {
      assert.equal(stage.formOpen, true);
      assert.deepEqual(stage.fields, fields, "Read the actual unchanged receipt form");
      assert.deepEqual(stage.entries, [[first.storageKey, first.key]]);
      assert.ok(stage.observedAt < retry.recordedAt, "No replay before restoration");
    }
  }
  assert.ok(retry.recordedAt <= afterSuccess.observedAt);
  assert.equal(afterSuccess.formClosed, true);
  assert.equal(afterSuccess.visibleReceiptCount, 1);
  assert.deepEqual(afterSuccess.references, [first.reference]);
  assert.deepEqual(afterSuccess.entries, []);
  assert.ok(Number.isFinite(proxy.receiptsObservedAt) && proxy.receiptsObservedAt >= afterSuccess.observedAt);
  assert.equal(browser.faultMethod, "getItem");
  assert.equal(browser.faultName, "SecurityError");
  assert.deepEqual(browser.blockedKeys, [first.storageKey]);
  assert.deepEqual(browser.financialWriteKeys, []);
  assert.deepEqual(browser.financialRemoveKeys, []);
  assert.equal(browser.unrelatedStorageWorked, true);
  assert.equal(browser.blockedReceiptPostCount, 0);
  assert.equal(browser.recoveryReceiptPostCount, 1);
  assert.equal(afterBlockedSave.error,
    "تعذر حفظ مفتاح العملية بأمان. لم يُرسل الطلب؛ فعّل تخزين الجلسة وأعد المحاولة.");
  for (const flag of ["originalGetItemRestored", "originalSetItemRestored",
    "originalRemoveItemRestored", "originalFetchRestored", "financialWriteReadRemoved"]) {
    assert.equal(restored[flag], true, flag);
  }
  assert.equal(blockedProxy.runId, proxy.runId);
  assert.equal(blockedProxy.scenario, proxy.scenario);
  assert.equal(blockedProxy.receiptPostCount, 1, "No additional ingress during read fault");
  assert.equal(blockedProxy.invoicePostCount, 0);
  assert.equal(blockedProxy.returnPostCount, 0);
  assert.deepEqual(blockedProxy.events, [first]);
  for (const field of ["initialCounts", "initialJournals", "initialPaymentState"]) {
    assert.deepEqual(blockedProxy[field], proxy[field]);
  }
  assert.deepEqual(blockedProxy.finalCounts, first.counts);
  assert.deepEqual(blockedProxy.finalJournals, first.journals);
  assert.deepEqual(blockedProxy.finalReceipts, first.receipts);
  assert.deepEqual(blockedProxy.finalPaymentState, first.paymentState);
  assert.ok(Number.isFinite(blockedProxy.receiptsObservedAt));
  assert.ok(blockedProxy.receiptsObservedAt >= restored.observedAt);
  assert.ok(blockedProxy.receiptsObservedAt < retry.recordedAt);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = new URL("../generated-artifacts/verification/", import.meta.url);
  const load = (name) => JSON.parse(readFileSync(new URL(name, dir), "utf8"));
  checkReloadedReceiptReadBlock(load("browser-identical-receipt-proxy.json"),
    load("browser-reloaded-receipt-read-block.json"), load("browser-reloaded-receipt-blocked-proxy.json"));
  console.log("PASS: reload read fault retains receipt form/key without POST/write/removal; restored retry replays the same receipt, journal and collected amount.");
}
