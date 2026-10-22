import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Separate contract: no lost response, reload, or overlapping submissions.
export function checkRepeatedReceiptCleanup(proxy, browser) {
  assert.equal(proxy.scenario, "identical-receipt");
  assert.ok(proxy.runId);
  assert.equal(browser.runId, proxy.runId);
  const failures = browser.cleanupFailures;
  assert.ok(Array.isArray(failures) && failures.length >= 4);
  const n = failures.length;
  assert.equal(proxy.receiptPostCount, n + 2);
  assert.equal(proxy.invoicePostCount, 0);
  assert.equal(proxy.returnPostCount, 0);
  assert.equal(proxy.events.length, n + 2);
  assert.equal(browser.responses.length, n + 2);
  assert.equal(browser.removalAttempts.length, n);
  assert.deepEqual(proxy.initialCounts, { invoices: 1, paymentReceipts: 0, receipts: 0 });
  assert.deepEqual(proxy.initialPaymentState.payments, []);
  assert.deepEqual(proxy.initialPaymentState.allocations, []);
  assert.equal(proxy.initialPaymentState.invoices.length, 1);
  const [invoice] = proxy.initialPaymentState.invoices;
  assert.equal(invoice.amountPaid, 0);
  assert.equal(invoice.status, "open");
  assert.ok(invoice.total > 100);
  const first = proxy.events[0];
  const second = proxy.events.at(-1);
  const origin = browser.beforeSave.timeOrigin;
  const fields = browser.beforeSave.fields;
  assert.ok(Number.isFinite(origin));
  assert.ok(browser.customerName && browser.invoiceReference);
  assert.deepEqual(fields, { customerName: browser.customerName, amount: "50",
    paymentMethod: "نقدي", invoiceReference: browser.invoiceReference, allocation: "50" });
  assert.deepEqual(first.body, { customerId: invoice.customerId, amount: 50,
    paymentMethod: "cash", allocations: [{ invoiceId: invoice.id, amount: 50 }] });
  const hash = (s) => createHash("sha256").update(s).digest("hex");
  const responseAt = (i) => browser.responses[i].jsonObservedAt;
  const snapshot = (stage) => {
    assert.ok(Number.isFinite(stage.observedAt));
    assert.equal(stage.timeOrigin, origin, "No reload or replacement document");
  };
  snapshot(browser.beforeSave);
  assert.ok(browser.beforeSave.observedAt < responseAt(0));
  const pending = [{ storageKey: first.storageKey, key: first.key }];
  for (let i = 0; i < n + 2; i++) {
    const event = proxy.events[i];
    const response = browser.responses[i];
    const fresh = i === n + 1;
    const count = fresh ? 2 : 1;
    assert.equal(event.upstreamStatus, 201);
    assert.equal(event.dropped, false);
    assert.equal(event.replayed, i > 0 && !fresh);
    assert.equal(event.replayHeader, event.replayed ? "true" : null);
    assert.ok(Number.isFinite(event.recordedAt));
    if (i) assert.ok(event.recordedAt >= proxy.events[i - 1].recordedAt);
    assert.ok(typeof event.key === "string" && event.key.length > 0);
    assert.ok(Number.isInteger(event.paymentReceiptId) && event.paymentReceiptId > 0);
    assert.match(event.reference, /^RCT-/);
    assert.deepEqual(event.body, first.body);
    assert.equal(event.bodyHash, first.bodyHash);
    assert.equal(event.storageKey, first.storageKey);
    if (!fresh) {
      for (const field of ["paymentReceiptId", "reference", "key", "paymentState", "receipts", "journals"]) {
        assert.deepEqual(event[field], first[field], `Confirmation ${i}: unchanged ${field}`);
      }
    }
    assert.deepEqual(event.counts, { invoices: 1, paymentReceipts: count, receipts: count });
    assert.equal(event.paymentState.payments.length, count);
    assert.equal(event.paymentState.allocations.length, count);
    assert.equal(event.receipts.length, count);
    assert.deepEqual(event.paymentState.invoices, [{ ...invoice, amountPaid: count * 50, status: "partially_paid" }]);
    const journalIds = [];
    for (const payment of event.paymentState.payments) {
      const source = payment.id === first.paymentReceiptId ? first : second;
      assert.deepEqual(payment, { id: source.paymentReceiptId, reference: source.reference,
        customerId: invoice.customerId, amount: 50, paymentMethod: "cash", journalEntryId: payment.journalEntryId });
      assert.ok(Number.isInteger(payment.journalEntryId) && payment.journalEntryId > 0);
      journalIds.push(payment.journalEntryId);
      assert.deepEqual(event.paymentState.allocations.filter((a) => a.receiptId === payment.id),
        [{ receiptId: payment.id, invoiceId: invoice.id, amount: 50 }]);
      const receipt = event.receipts.find((r) => r.key === source.key);
      assert.ok(receipt);
      assert.equal(String(receipt.paymentReceiptId), String(payment.id));
      for (const field of ["companyId", "userId"]) {
        assert.ok(Number.isInteger(receipt[field]) && receipt[field] > 0);
        assert.equal(receipt[field], first.receipts[0][field]);
      }
      assert.match(receipt.operation, /^POST:.*:\/sales\/receipts$/);
      assert.equal(receipt.operation, first.receipts[0].operation);
    }
    assert.equal(new Set(journalIds).size, count);
    assert.deepEqual(event.journals, [...proxy.initialJournals, ...journalIds.map((id) => ({ id }))]);
    assert.equal(response.status, 201);
    assert.equal(response.replayed, event.replayed);
    assert.equal(response.key, event.key);
    assert.equal(response.body.id, event.paymentReceiptId);
    assert.equal(response.body.reference, event.reference);
    assert.equal(response.requestBody, browser.responses[0].requestBody);
    assert.deepEqual(JSON.parse(response.requestBody), event.body);
    assert.equal(hash(response.requestBody), event.bodyHash);
    assert.equal(`hasba:financial-request:${hash(`/api/sales/receipts\n${response.requestBody}`)}`, event.storageKey);
    assert.ok(Number.isFinite(responseAt(i)));
    if (i < n) {
      const attempt = browser.removalAttempts[i];
      const stage = failures[i];
      assert.equal(attempt.key, first.storageKey);
      assert.ok(Number.isFinite(attempt.at) && attempt.at >= responseAt(i));
      snapshot(stage);
      assert.equal(stage.formOpen, true);
      assert.deepEqual(stage.fields, fields);
      assert.deepEqual(stage.entries, pending);
      assert.match(stage.message, /تم حفظ العملية بالفعل، لكن تعذر تنظيف مفتاحها/);
      assert.ok(stage.observedAt >= attempt.at);
      assert.ok(stage.observedAt < (i + 1 < n ? responseAt(i + 1) : browser.beforeRecovery.observedAt),
        "Separate sequential confirmations, never double-click");
    }
  }
  assert.notEqual(second.key, first.key);
  assert.notEqual(second.paymentReceiptId, first.paymentReceiptId);
  assert.notEqual(second.reference, first.reference);
  assert.deepEqual(second.paymentState.payments[0], first.paymentState.payments[0]);
  assert.deepEqual(second.receipts.find((r) => r.key === first.key), first.receipts[0]);
  const recovery = browser.beforeRecovery;
  snapshot(recovery);
  assert.equal(recovery.formOpen, true);
  assert.deepEqual(recovery.fields, fields);
  assert.deepEqual(recovery.entries, pending);
  assert.deepEqual(recovery.restored, { removeItem: true, probe: true });
  assert.ok(recovery.observedAt < responseAt(n));
  const { afterSuccess, afterNewForm, afterSecondSuccess } = browser;
  for (const stage of [afterSuccess, afterNewForm, afterSecondSuccess]) {
    snapshot(stage);
    assert.deepEqual(stage.entries, []);
  }
  assert.equal(afterSuccess.formClosed, true);
  assert.equal(afterSuccess.visibleReceiptCount, 1);
  assert.deepEqual(afterSuccess.references, [first.reference]);
  assert.ok(afterSuccess.observedAt >= responseAt(n));
  assert.ok(afterSuccess.observedAt < afterNewForm.observedAt);
  assert.equal(afterNewForm.formOpen, true);
  assert.deepEqual(afterNewForm.fields, fields);
  assert.ok(afterNewForm.observedAt < responseAt(n + 1));
  assert.ok(afterSecondSuccess.observedAt >= responseAt(n + 1));
  assert.equal(afterSecondSuccess.formClosed, true);
  assert.equal(afterSecondSuccess.visibleReceiptCount, 2);
  assert.deepEqual([...afterSecondSuccess.references].sort(), [first.reference, second.reference].sort());
  assert.deepEqual(browser.restored, { fetch: true, removeItem: true, probe: true });
  assert.deepEqual(proxy.finalCounts, second.counts);
  assert.deepEqual(proxy.finalJournals, second.journals);
  assert.deepEqual(proxy.finalPaymentState, second.paymentState);
  assert.deepEqual(proxy.finalReceipts, second.receipts);
  assert.ok(proxy.receiptsObservedAt >= second.recordedAt);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = "generated-artifacts/verification";
  checkRepeatedReceiptCleanup(
    JSON.parse(readFileSync(`${dir}/browser-identical-receipt-proxy.json`, "utf8")),
    JSON.parse(readFileSync(`${dir}/browser-repeated-receipt-cleanup.json`, "utf8")),
  );
  console.log("PASS: repeated receipt cleanup failures preserve one payment, recovery confirms it, new identical intent is independent");
}
