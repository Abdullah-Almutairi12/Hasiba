import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function checkBrowserOverlappingReturn(p, b) {
  assert.equal(p.scenario, "identical-return");
  assert.ok(p.runId);
  assert.equal(b.runId, p.runId);
  assert.equal(p.overlapReturns, true);
  assert.equal(p.overlapTimedOut, false);
  assert.equal(p.returnPostCount, 2);
  assert.equal(p.invoicePostCount, 0);
  assert.equal(p.receiptPostCount, 0);
  assert.deepEqual(p.initialCounts, { invoices: 1, creditNotes: 0, receipts: 0 });
  assert.equal(p.arrivals.length, 2);
  const [a, c] = p.arrivals;
  for (const v of p.arrivals) {
    for (const key of ["arrivedAt", "forwardedAt", "responseSentAt"]) assert.ok(Number.isFinite(v[key]));
    assert.ok(v.arrivedAt <= v.forwardedAt && v.forwardedAt <= v.responseSentAt);
    assert.ok(c.arrivedAt <= v.forwardedAt, "Both requests must arrive before either is forwarded");
  }
  assert.ok(a.arrivedAt <= c.arrivedAt);
  assert.ok(c.arrivedAt < Math.min(a.responseSentAt, c.responseSentAt), "Actual overlap, not a sequential retry");
  assert.equal(p.events.length, 2);
  assert.deepEqual(p.events.map(e => e.arrivalIndex).sort(), [0, 1]);
  const first = p.events.find(e => !e.replayed);
  const replay = p.events.find(e => e.replayed);
  assert.ok(first && replay);
  assert.equal(first.replayHeader, null);
  assert.equal(replay.replayHeader, "true");
  const f = p.returnFixture;
  assert.equal(f.returnQuantity, 1);
  assert.equal(f.unitCost, 50);
  assert.ok(f.soldQuantity >= 1);
  assert.deepEqual(p.initialReturnState, { notes: [], moves: [], stock: 0,
    quants: [{ warehouseId: f.warehouseId, quantity: 0, avgCost: 0 }] });
  assert.ok(Number.isInteger(b.customerId) && b.customerId > 0);
  const body = { customerId: b.customerId, invoiceId: f.id,
    reason: "Overlapping return verification", restock: true,
    lines: [{ productId: f.productId, description: f.description, quantity: 1,
      unitPrice: 100, taxRate: 0, invoiceLineId: f.lineId }] };
  const hash = s => createHash("sha256").update(s).digest("hex");
  const storageKey = `hasba:financial-request:${hash(`/api/sales/credit-notes\n${JSON.stringify(body)}`)}`;
  assert.ok(Number.isInteger(p.initialJournalCount));
  for (const e of p.events) {
    assert.equal(e.dropped, false);
    assert.equal(e.upstreamStatus, 201);
    assert.equal(e.journalCount, p.initialJournalCount + 1, "Exactly one new journal");
    assert.deepEqual(e.body, body);
    assert.equal(e.bodyHash, hash(JSON.stringify(body)));
    assert.equal(e.storageKey, storageKey);
    assert.ok(typeof e.key === "string" && e.key.length > 0);
    assert.equal(e.key, first.key);
    assert.equal(e.creditNoteId, first.creditNoteId);
    assert.equal(e.reference, first.reference);
    assert.deepEqual(e.counts, { invoices: 1, creditNotes: 1, receipts: 1 });
    assert.equal(e.receipts.length, 1);
    const r = e.receipts[0];
    assert.equal(r.companyId, b.companyId);
    assert.equal(r.userId, b.userId);
    assert.ok(Number.isInteger(r.companyId) && r.companyId > 0);
    assert.ok(Number.isInteger(r.userId) && r.userId > 0);
    assert.match(r.operation, /^POST:.*:\/sales\/credit-notes$/);
    assert.equal(r.key, first.key);
    assert.equal(String(r.creditNoteId), String(first.creditNoteId));
    const s = e.returnState;
    assert.equal(s.notes.length, 1);
    const n = s.notes[0];
    assert.ok(Number.isInteger(n.id) && n.id > 0);
    assert.equal(n.id, first.creditNoteId);
    assert.equal(n.reference, first.reference);
    assert.match(n.reference, /^CN-/);
    assert.equal(n.invoiceId, f.id);
    assert.equal(n.status, "issued");
    assert.ok(Number.isInteger(n.journalEntryId) && n.journalEntryId > 0);
    assert.equal(s.moves.length, 1);
    const { id, ...move } = s.moves[0];
    assert.ok(Number.isInteger(id) && id > 0);
    assert.deepEqual(move, { productId: f.productId, noteId: n.id, invoiceLineId: f.lineId,
      originalMoveId: f.issueMoveId, warehouseId: f.warehouseId, quantity: 1, unitCost: 50, state: "done" });
    assert.equal(s.stock, 1);
    assert.deepEqual(s.quants, [{ warehouseId: f.warehouseId, quantity: 1, avgCost: 50 }]);
  }
  assert.deepEqual(replay.returnState, first.returnState);
  assert.deepEqual(replay.receipts, first.receipts);
  assert.deepEqual(p.finalReturnState, first.returnState);
  assert.deepEqual(p.finalReceipts, first.receipts);
  assert.deepEqual(p.finalCounts, first.counts);
  assert.equal(p.finalJournalCount, p.initialJournalCount + 1);
  assert.ok(p.receiptsObservedAt >= Math.max(...p.events.map(e => e.recordedAt)));
  const pending = b.pending;
  assert.equal(pending.formOpen, true);
  assert.deepEqual(pending.entries, [[storageKey, first.key]]);
  assert.ok(pending.observedAt >= c.arrivedAt);
  assert.ok(pending.observedAt < Math.min(a.responseSentAt, c.responseSentAt));
  assert.deepEqual(pending.fields, { customerName: b.customerName, invoiceReference: f.reference,
    reason: body.reason, restock: true, description: f.description, quantity: "1", unitPrice: "100", taxRate: "0" });
  assert.equal(b.clicks.length, 2);
  assert.ok(b.clicks.every(Number.isFinite));
  assert.ok(b.clicks[0] <= b.clicks[1] && b.clicks[1] - b.clicks[0] <= 500);
  assert.ok(b.clicks[1] < Math.min(a.responseSentAt, c.responseSentAt));
  assert.equal(b.afterSuccess.timeOrigin, pending.timeOrigin);
  assert.ok(Number.isFinite(pending.timeOrigin));
  assert.ok(b.afterSuccess.observedAt >= Math.max(a.responseSentAt, c.responseSentAt));
  assert.equal(b.afterSuccess.formClosed, true);
  assert.deepEqual(b.afterSuccess.entries, []);
  assert.equal(b.afterSuccess.visibleCreditNoteCount, 1);
  assert.deepEqual(b.afterSuccess.references, [first.reference]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = "generated-artifacts/verification";
  checkBrowserOverlappingReturn(
    JSON.parse(readFileSync(`${dir}/browser-identical-return-proxy.json`)),
    JSON.parse(readFileSync(`${dir}/browser-overlapping-return.json`)));
  console.log("PASS: overlapping UI saves share one key, receipt, return, journal and stock movement");
}
