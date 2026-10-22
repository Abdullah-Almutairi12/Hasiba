import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function checkBrowserOverlappingReceipt(p, b) {
  assert.equal(p.scenario, "identical-receipt");
  assert.ok(p.runId);
  assert.equal(b.runId, p.runId);
  assert.equal(p.overlapReceipts, true);
  assert.equal(p.overlapTimedOut, false);
  assert.equal(p.receiptPostCount, 2);
  assert.equal(p.invoicePostCount, 0);
  assert.equal(p.returnPostCount, 0);
  assert.deepEqual(p.initialCounts, { invoices: 1, paymentReceipts: 0, receipts: 0 });
  assert.deepEqual(p.initialPaymentState.payments, []);
  assert.deepEqual(p.initialPaymentState.allocations, []);
  assert.equal(p.initialPaymentState.invoices.length, 1);
  const [invoice] = p.initialPaymentState.invoices;
  assert.equal(invoice.amountPaid, 0);
  assert.equal(invoice.status, "open");
  assert.equal(invoice.total, 300);
  assert.equal(p.arrivals.length, 2);
  const [a, c] = p.arrivals;
  for (const v of p.arrivals) {
    for (const key of ["arrivedAt", "forwardedAt", "responseSentAt"]) assert.ok(Number.isFinite(v[key]));
    assert.ok(v.arrivedAt <= v.forwardedAt && v.forwardedAt <= v.responseSentAt);
    assert.ok(c.arrivedAt <= v.forwardedAt, "Both requests must arrive before either is forwarded");
  }
  assert.ok(a.arrivedAt <= c.arrivedAt);
  const firstResponse = Math.min(a.responseSentAt, c.responseSentAt);
  const lastResponse = Math.max(a.responseSentAt, c.responseSentAt);
  assert.ok(c.arrivedAt < firstResponse, "Require actual overlap, not sequential retry");
  assert.equal(p.events.length, 2);
  assert.deepEqual(p.events.map(e => e.arrivalIndex).sort(), [0, 1]);
  const original = p.events.find(e => e.replayed === false);
  const replay = p.events.find(e => e.replayed === true);
  assert.ok(original && replay);
  assert.equal(original.replayHeader, null);
  assert.equal(replay.replayHeader, "true");
  const body = { customerId: invoice.customerId, amount: 50, paymentMethod: "cash",
    allocations: [{ invoiceId: invoice.id, amount: 50 }] };
  const hash = s => createHash("sha256").update(s).digest("hex");
  const storageKey = `hasba:financial-request:${hash(`/api/sales/receipts\n${JSON.stringify(body)}`)}`;
  assert.ok(Number.isInteger(p.initialJournalCount));
  assert.equal(p.initialJournalCount, p.initialJournals.length);
  for (const e of p.events) {
    assert.equal(e.upstreamStatus, 201);
    assert.equal(e.dropped, false);
    assert.deepEqual(e.body, body);
    assert.equal(e.bodyHash, hash(JSON.stringify(body)));
    assert.equal(e.storageKey, storageKey);
    assert.ok(typeof e.key === "string" && e.key.length > 0);
    assert.equal(e.key, original.key);
    assert.ok(Number.isInteger(e.paymentReceiptId) && e.paymentReceiptId > 0);
    assert.equal(e.paymentReceiptId, original.paymentReceiptId);
    assert.equal(e.reference, original.reference);
    assert.match(e.reference, /^RCT-/);
    assert.equal(e.journalCount, p.initialJournalCount + 1);
    assert.deepEqual(e.counts, { invoices: 1, paymentReceipts: 1, receipts: 1 });
    assert.equal(e.receipts.length, 1);
    const [r] = e.receipts;
    for (const key of ["companyId", "userId"]) {
      assert.ok(Number.isInteger(b[key]) && b[key] > 0);
      assert.equal(r[key], b[key]);
    }
    assert.match(r.operation, /^POST:.*:\/sales\/receipts$/);
    assert.equal(r.key, original.key);
    assert.equal(String(r.paymentReceiptId), String(original.paymentReceiptId));
    assert.equal(e.paymentState.payments.length, 1);
    const [payment] = e.paymentState.payments;
    assert.ok(Number.isInteger(payment.journalEntryId) && payment.journalEntryId > 0);
    assert.deepEqual(payment, { id: original.paymentReceiptId, reference: original.reference,
      customerId: invoice.customerId, amount: 50, paymentMethod: "cash", journalEntryId: payment.journalEntryId });
    assert.deepEqual(e.journals, [...p.initialJournals, { id: payment.journalEntryId }]);
    assert.deepEqual(e.paymentState.allocations, [{ receiptId: payment.id, invoiceId: invoice.id, amount: 50 }]);
    assert.deepEqual(e.paymentState.invoices, [{ ...invoice, amountPaid: 50, status: "partially_paid" }]);
    assert.ok(Number.isFinite(e.recordedAt));
  }
  assert.deepEqual(replay.paymentState, original.paymentState);
  assert.deepEqual(replay.receipts, original.receipts);
  assert.deepEqual(p.finalPaymentState, original.paymentState);
  assert.deepEqual(p.finalReceipts, original.receipts);
  assert.deepEqual(p.finalCounts, original.counts);
  assert.deepEqual(p.finalJournals, original.journals);
  assert.equal(p.finalJournalCount, p.initialJournalCount + 1);
  assert.ok(p.receiptsObservedAt >= Math.max(...p.events.map(e => e.recordedAt)));
  assert.ok(b.customerName && b.invoiceReference);
  const pending = b.pending;
  assert.equal(pending.formOpen, true);
  assert.deepEqual(pending.entries, [[storageKey, original.key]]);
  assert.ok(pending.observedAt >= c.arrivedAt && pending.observedAt < firstResponse);
  assert.deepEqual(pending.fields, { customerName: b.customerName, amount: "50",
    paymentMethod: "نقدي", invoiceReference: b.invoiceReference, allocation: "50" });
  assert.equal(b.clicks.length, 2);
  assert.ok(b.clicks.every(Number.isFinite));
  assert.ok(b.clicks[0] <= b.clicks[1] && b.clicks[1] - b.clicks[0] <= 500);
  assert.ok(b.clicks[1] <= c.arrivedAt && b.clicks[1] < firstResponse);
  assert.ok(Number.isFinite(pending.timeOrigin));
  assert.equal(b.afterSuccess.timeOrigin, pending.timeOrigin);
  assert.ok(b.afterSuccess.observedAt >= lastResponse);
  assert.equal(b.afterSuccess.formClosed, true);
  assert.deepEqual(b.afterSuccess.entries, []);
  assert.equal(b.afterSuccess.visibleReceiptCount, 1);
  assert.deepEqual(b.afterSuccess.references, [original.reference]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = "generated-artifacts/verification";
  checkBrowserOverlappingReceipt(
    JSON.parse(readFileSync(`${dir}/browser-identical-receipt-proxy.json`)),
    JSON.parse(readFileSync(`${dir}/browser-overlapping-receipt.json`)));
  console.log("PASS: overlapping UI saves share one key, financial receipt, payment, journal and allocation; amountPaid=50");
}
