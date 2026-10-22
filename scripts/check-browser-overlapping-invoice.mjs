import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function checkBrowserOverlappingInvoice(p, b) {
  assert.equal(p.scenario, "overlapping-invoice");
  assert.ok(p.runId);
  assert.equal(b.runId, p.runId);
  assert.equal(p.overlapInvoices, true);
  assert.equal(p.overlapTimedOut, false);
  assert.equal(p.invoicePostCount, 2);
  assert.equal(p.returnPostCount, 0);
  assert.equal(p.receiptPostCount, 0);
  assert.deepEqual(p.initialCounts, { invoices: 0, receipts: 0 });
  assert.deepEqual(p.initialJournals, []);
  assert.equal(p.initialJournalCount, 0);
  assert.deepEqual(p.initialInvoiceState.invoices, []);
  assert.ok(p.initialInvoiceState.products.length > 0);
  assert.equal(p.arrivals.length, 2);
  const [a, c] = p.arrivals;
  for (const v of p.arrivals) {
    for (const key of ["arrivedAt", "forwardedAt", "responseSentAt"]) assert.ok(Number.isFinite(v[key]));
    assert.ok(v.arrivedAt <= v.forwardedAt && v.forwardedAt <= v.responseSentAt);
    assert.ok(c.arrivedAt <= v.forwardedAt, "Both saves arrive before forwarding");
  }
  assert.ok(a.arrivedAt <= c.arrivedAt);
  const firstResponse = Math.min(a.responseSentAt, c.responseSentAt);
  assert.ok(c.arrivedAt < firstResponse, "Not a sequential retry");
  assert.equal(p.events.length, 2);
  assert.deepEqual(p.events.map(e => e.arrivalIndex).sort(), [0, 1]);
  const first = p.events.find(e => !e.replayed);
  const replay = p.events.find(e => e.replayed);
  assert.ok(first && replay);
  assert.equal(first.replayHeader, null);
  assert.equal(replay.replayHeader, "true");
  for (const key of ["customerId", "companyId", "userId", "productId"]) {
    assert.ok(Number.isInteger(b[key]) && b[key] > 0);
  }
  assert.ok(p.initialInvoiceState.products.some(v => v.id === b.productId));
  const body = { customerId: b.customerId,
    lines: [{ productId: b.productId, description: "منتج اختبار", quantity: 1,
      unitPrice: 100, discountPct: 0, taxRate: 15 }],
    notes: "Overlapping invoice verification" };
  const hash = s => createHash("sha256").update(s).digest("hex");
  const storageKey = `hasba:financial-request:${hash(`/api/sales/invoices\n${JSON.stringify(body)}`)}`;
  for (const e of p.events) {
    assert.equal(e.dropped, false);
    assert.equal(e.upstreamStatus, 201);
    assert.equal(e.journalCount, 1);
    assert.equal(e.journals.length, 1);
    assert.ok(Number.isInteger(e.journals[0].id) && e.journals[0].id > 0);
    assert.deepEqual(e.body, body);
    assert.equal(e.bodyHash, hash(JSON.stringify(body)));
    assert.equal(e.storageKey, storageKey);
    assert.ok(typeof e.key === "string" && e.key.length > 0);
    assert.equal(e.key, first.key);
    assert.ok(Number.isInteger(e.invoiceId) && e.invoiceId > 0);
    assert.ok(typeof e.reference === "string" && e.reference.length > 0);
    assert.equal(e.invoiceId, first.invoiceId);
    assert.equal(e.reference, first.reference);
    assert.deepEqual(e.counts, { invoices: 1, receipts: 1 });
    assert.equal(e.receipts.length, 1);
    const r = e.receipts[0];
    assert.equal(r.companyId, b.companyId);
    assert.equal(r.userId, b.userId);
    assert.match(r.operation, /^POST:.*:\/sales\/invoices$/);
    assert.equal(r.key, first.key);
    assert.equal(String(r.invoiceId), String(first.invoiceId));
    assert.deepEqual(e.invoiceState.invoices, [{ id: first.invoiceId,
      reference: first.reference, customerId: b.customerId, total: 115 }]);
    for (const key of ["products", "moves", "quants"]) {
      assert.deepEqual(e.invoiceState[key], p.initialInvoiceState[key],
        "Billing must not issue stock (delivery orders own stock issuance)");
    }
  }
  for (const key of ["invoiceState", "receipts", "journals"]) assert.deepEqual(replay[key], first[key]);
  assert.deepEqual(p.finalInvoiceState, first.invoiceState);
  assert.deepEqual(p.finalReceipts, first.receipts);
  assert.deepEqual(p.finalJournals, first.journals);
  assert.deepEqual(p.finalCounts, first.counts);
  assert.equal(p.finalJournalCount, 1);
  assert.ok(p.receiptsObservedAt >= Math.max(...p.events.map(e => e.recordedAt)));
  const pending = b.pending;
  assert.equal(pending.formOpen, true);
  assert.deepEqual(pending.entries, [[storageKey, first.key]]);
  assert.ok(pending.observedAt >= c.arrivedAt && pending.observedAt < firstResponse);
  assert.deepEqual(pending.fields, { customerName: b.customerName, productName: "منتج اختبار",
    quantity: "1", unitPrice: "100", discountPct: "0", notes: body.notes });
  assert.equal(b.clicks.length, 2);
  assert.ok(b.clicks.every(Number.isFinite));
  assert.ok(b.clicks[0] <= b.clicks[1] && b.clicks[1] - b.clicks[0] <= 500);
  assert.ok(b.clicks[1] < firstResponse);
  assert.equal(b.afterSuccess.timeOrigin, pending.timeOrigin);
  assert.ok(Number.isFinite(pending.timeOrigin));
  assert.ok(b.afterSuccess.observedAt >= Math.max(a.responseSentAt, c.responseSentAt));
  assert.equal(b.afterSuccess.formClosed, true);
  assert.deepEqual(b.afterSuccess.entries, []);
  assert.equal(b.afterSuccess.visibleInvoiceCount, 1);
  assert.deepEqual(b.afterSuccess.references, [first.reference]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = "generated-artifacts/verification";
  checkBrowserOverlappingInvoice(
    JSON.parse(readFileSync(`${dir}/browser-retry-proxy.json`)),
    JSON.parse(readFileSync(`${dir}/browser-overlapping-invoice.json`)));
  console.log("PASS: overlapping UI invoice saves, one key/receipt/invoice/journal, unchanged stock and fresh list");
}
