// Independent of the invoice/reload guard: recover in place, then start a new intent.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export function checkBrowserIdenticalReceipt(proxy, browser) {
  assert.equal(proxy.scenario, "identical-receipt");
  assert.ok(proxy.runId);
  assert.equal(browser.runId, proxy.runId, "Evidence must belong to this isolated run");
  assert.equal(proxy.receiptPostCount, 3, "Exactly three receipt POSTs must arrive");
  assert.equal(proxy.invoicePostCount, 0, "Use the synthetic invoice, not a financial setup request");
  assert.equal(proxy.events.length, 3, "Expected lost success, replay, then fresh identical receipt");
  assert.deepEqual(proxy.initialCounts, { invoices: 1, paymentReceipts: 0, receipts: 0 });
  assert.deepEqual(proxy.initialPaymentState.payments, []);
  assert.deepEqual(proxy.initialPaymentState.allocations, []);
  const [invoice] = proxy.initialPaymentState.invoices;
  assert.equal(proxy.initialPaymentState.invoices.length, 1);
  assert.equal(invoice.amountPaid, 0);
  assert.equal(invoice.status, "open");
  const [first, retry, second] = proxy.events;
  assert.deepEqual(first.body, {
    customerId: invoice.customerId, amount: 50, paymentMethod: "cash",
    allocations: [{ invoiceId: invoice.id, amount: 50 }],
  });
  assert.ok(invoice.total > first.body.amount * 2, "Seed enough balance for both identical receipts");
  assert.match(first.bodyHash, /^[a-f0-9]{64}$/);
  assert.match(first.storageKey, /^hasba:financial-request:[a-f0-9]{64}$/);
  assert.equal(first.dropped, true);
  assert.equal(first.replayed, false);
  assert.equal(first.replayHeader, null);
  assert.equal(retry.dropped, false);
  assert.equal(retry.replayed, true);
  assert.equal(retry.replayHeader, "true");
  assert.equal(second.dropped, false);
  assert.equal(second.replayed, false);
  assert.equal(second.replayHeader, null, "Fresh intent must have no Idempotency-Replayed header");
  assert.equal(first.key, retry.key);
  assert.notEqual(second.key, first.key, "Confirmed success must permit a new key");
  assert.equal(first.paymentReceiptId, retry.paymentReceiptId);
  assert.equal(first.reference, retry.reference);
  assert.notEqual(second.paymentReceiptId, first.paymentReceiptId);
  assert.notEqual(second.reference, first.reference);

  const identity = (r) => JSON.stringify([r.companyId, r.userId, r.operation, r.key]);
  for (const [index, event] of proxy.events.entries()) {
    const count = index === 2 ? 2 : 1;
    assert.ok(event.upstreamStatus >= 200 && event.upstreamStatus < 300);
    assert.ok(Number.isInteger(event.paymentReceiptId) && event.paymentReceiptId > 0);
    assert.match(event.reference, /^RCT-/);
    assert.ok(typeof event.key === "string" && event.key.length > 0);
    assert.ok(Number.isFinite(event.recordedAt));
    assert.equal(event.bodyHash, first.bodyHash);
    assert.equal(event.storageKey, first.storageKey);
    assert.deepEqual(event.body, first.body, "All form data must be identical");
    assert.deepEqual(event.counts, { invoices: 1, paymentReceipts: count, receipts: count });
    assert.equal(event.receipts.length, count);
    assert.equal(new Set(event.receipts.map(identity)).size, count);
    for (const receipt of event.receipts) {
      assert.ok(Number.isInteger(receipt.companyId) && receipt.companyId > 0);
      assert.ok(Number.isInteger(receipt.userId) && receipt.userId > 0);
      assert.match(receipt.operation, /^POST:.*:\/sales\/receipts$/);
      assert.equal(receipt.companyId, first.receipts[0].companyId);
      assert.equal(receipt.userId, first.receipts[0].userId);
      assert.equal(receipt.operation, first.receipts[0].operation);
    }
    const paymentState = event.paymentState;
    assert.equal(paymentState.payments.length, count);
    assert.equal(paymentState.allocations.length, count);
    assert.deepEqual(paymentState.invoices, [{
      ...invoice, amountPaid: first.body.amount * count, status: "partially_paid",
    }], "A replay must not apply the first payment again");
    for (const payment of paymentState.payments) {
      const origin = payment.id === first.paymentReceiptId ? first : second;
      assert.equal(payment.id, origin.paymentReceiptId);
      assert.equal(payment.reference, origin.reference);
      assert.equal(payment.customerId, first.body.customerId);
      assert.equal(payment.amount, first.body.amount);
      assert.equal(payment.paymentMethod, first.body.paymentMethod);
      assert.ok(Number.isInteger(payment.journalEntryId) && payment.journalEntryId > 0);
      assert.deepEqual(paymentState.allocations.filter((a) => a.receiptId === payment.id),
        [{ receiptId: payment.id, invoiceId: invoice.id, amount: first.body.amount }]);
      const receipt = event.receipts.find((r) => r.key === origin.key);
      assert.ok(receipt);
      assert.equal(String(receipt.paymentReceiptId), String(payment.id));
    }
  }
  assert.deepEqual(retry.receipts, first.receipts);
  assert.deepEqual(retry.paymentState, first.paymentState);
  assert.deepEqual(second.receipts.find((r) => r.key === first.key), first.receipts[0]);
  assert.equal(new Set(second.paymentState.payments.map((p) => p.journalEntryId)).size, 2);
  assert.ok(proxy.receiptsObservedAt >= second.recordedAt);
  assert.deepEqual(proxy.finalReceipts, second.receipts, "Persisted receipts must preserve both links");
  assert.deepEqual(proxy.finalPaymentState, second.paymentState);

  const { beforeRetry, afterSuccess, afterNewForm, afterSecondSuccess } = browser;
  for (const stage of [beforeRetry, afterSuccess, afterNewForm, afterSecondSuccess]) {
    assert.ok(stage && Number.isFinite(stage.observedAt));
    assert.ok(Number.isFinite(stage.timeOrigin));
    assert.equal(stage.timeOrigin, beforeRetry.timeOrigin, "This is not a reload scenario");
    assert.ok(Array.isArray(stage.entries));
  }
  assert.deepEqual(beforeRetry.entries, [[first.storageKey, first.key]]);
  assert.equal(beforeRetry.formOpen, true, "Keep the uncertain form available to retry");
  assert.ok(first.recordedAt <= beforeRetry.observedAt);
  assert.ok(beforeRetry.observedAt < retry.recordedAt);
  assert.ok(retry.recordedAt <= afterSuccess.observedAt);
  assert.ok(afterSuccess.observedAt < afterNewForm.observedAt);
  assert.ok(afterNewForm.observedAt < second.recordedAt);
  assert.ok(second.recordedAt <= afterSecondSuccess.observedAt);
  for (const stage of [afterSuccess, afterNewForm, afterSecondSuccess]) {
    assert.deepEqual(stage.entries, [], "Confirmed success must clear the pending key");
  }
  assert.equal(afterSuccess.formClosed, true);
  assert.equal(afterSuccess.visibleReceiptCount, 1);
  assert.deepEqual(afterSuccess.references, [first.reference]);
  assert.equal(afterNewForm.formOpen, true, "Reopen after confirmed success");
  assert.deepEqual(afterNewForm.fields, beforeRetry.fields, "Fill the new dialog with identical values");
  assert.deepEqual(beforeRetry.fields, {
    customerName: browser.customerName, amount: "50", paymentMethod: "نقدي",
    invoiceReference: browser.invoiceReference, allocation: "50",
  });
  assert.ok(browser.customerName && browser.invoiceReference);
  assert.equal(afterSecondSuccess.formClosed, true);
  assert.equal(afterSecondSuccess.visibleReceiptCount, 2);
  assert.deepEqual([...afterSecondSuccess.references].sort(), [first.reference, second.reference].sort(),
    "Both receipts must appear once in the refreshed list");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = new URL("../generated-artifacts/verification/", import.meta.url);
  checkBrowserIdenticalReceipt(
    JSON.parse(readFileSync(new URL("browser-identical-receipt-proxy.json", dir), "utf8")),
    JSON.parse(readFileSync(new URL("browser-identical-receipt.json", dir), "utf8")),
  );
  console.log("PASS: recovered receipt confirmed; fresh identical form uses a new key, no replay header, two receipt documents and two persisted retry receipts.");
}
