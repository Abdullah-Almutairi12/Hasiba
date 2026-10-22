import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { checkBrowserOverlappingReturn } from "./check-browser-overlapping-return.mjs";

function evidence() {
  const f = { id: 10, lineId: 20, productId: 30, warehouseId: 40, issueMoveId: 50,
    reference: "INV-10", description: "Synthetic", returnQuantity: 1, soldQuantity: 2, unitCost: 50 };
  const body = { customerId: 60, invoiceId: 10, reason: "Overlapping return verification",
    restock: true, lines: [{ productId: 30, description: "Synthetic", quantity: 1,
      unitPrice: 100, taxRate: 0, invoiceLineId: 20 }] };
  const hash = s => createHash("sha256").update(s).digest("hex");
  const storageKey = `hasba:financial-request:${hash(`/api/sales/credit-notes\n${JSON.stringify(body)}`)}`;
  const receipts = [{ companyId: 1, userId: 2, operation: "POST:1:/sales/credit-notes",
    key: "key", creditNoteId: "70" }];
  const state = { notes: [{ id: 70, reference: "CN-70", status: "issued", invoiceId: 10, journalEntryId: 80 }],
    moves: [{ id: 90, productId: 30, noteId: 70, invoiceLineId: 20, originalMoveId: 50,
      warehouseId: 40, quantity: 1, unitCost: 50, state: "done" }],
    stock: 1, quants: [{ warehouseId: 40, quantity: 1, avgCost: 50 }] };
  const e = { arrivalIndex: 0, key: "key", creditNoteId: 70, reference: "CN-70",
    storageKey, body, bodyHash: hash(JSON.stringify(body)), journalCount: 2,
    dropped: false, upstreamStatus: 201, replayed: false, replayHeader: null,
    recordedAt: 300, counts: { invoices: 1, creditNotes: 1, receipts: 1 }, receipts, returnState: state };
  return structuredClone({ p: { scenario: "identical-return", runId: "run", overlapReturns: true,
    overlapTimedOut: false, returnPostCount: 2, invoicePostCount: 0, receiptPostCount: 0,
    initialCounts: { invoices: 1, creditNotes: 0, receipts: 0 }, initialJournalCount: 1,
    initialReturnState: { notes: [], moves: [], stock: 0, quants: [{ warehouseId: 40, quantity: 0, avgCost: 0 }] },
    arrivals: [{ arrivedAt: 100, forwardedAt: 250, responseSentAt: 400 },
      { arrivedAt: 110, forwardedAt: 251, responseSentAt: 410 }],
    events: [e, { ...e, arrivalIndex: 1, replayed: true, replayHeader: "true", recordedAt: 310 }],
    returnFixture: f, finalReturnState: state, finalReceipts: receipts, receiptsObservedAt: 500,
    finalCounts: { invoices: 1, creditNotes: 1, receipts: 1 }, finalJournalCount: 2 },
  b: { runId: "run", customerId: 60, customerName: "Synthetic customer", companyId: 1, userId: 2,
    clicks: [90, 95], pending: { observedAt: 200, timeOrigin: 1, formOpen: true, entries: [[storageKey, "key"]],
      fields: { customerName: "Synthetic customer", invoiceReference: "INV-10", reason: body.reason,
        restock: true, description: "Synthetic", quantity: "1", unitPrice: "100", taxRate: "0" } },
    afterSuccess: { observedAt: 600, timeOrigin: 1, formClosed: true, entries: [],
      visibleCreditNoteCount: 1, references: ["CN-70"] } } });
}

test("accepts overlapping saves in either completion order", () => {
  const { p, b } = evidence();
  checkBrowserOverlappingReturn(p, b);
  p.events.reverse();
  checkBrowserOverlappingReturn(p, b);
});

for (const [name, mutate] of [
  ["sequential requests", p => { p.arrivals[1].arrivedAt = 450; }],
  ["timeout", p => { p.overlapTimedOut = true; }],
  ["missing ingress", p => p.arrivals.pop()],
  ["missing response time", p => { delete p.arrivals[0].responseSentAt; }],
  ["forwarded before second click", p => { p.arrivals[0].forwardedAt = 105; }],
  ["extra POST", p => p.returnPostCount++],
  ["missing replay header", p => { p.events[1].replayHeader = null; }],
  ["rotated key", p => { p.events[1].key = "new"; }],
  ["dropped success", p => { p.events[0].dropped = true; }],
  ["changed payload", p => { p.events[1].body = {}; }],
  ["incorrect hash", p => { p.events[0].bodyHash = "bad"; }],
  ["wrong storage key", p => { p.events[0].storageKey = "bad"; }],
  ["duplicate journal", p => p.events[1].journalCount++],
  ["duplicate return", p => p.events[1].counts.creditNotes++],
  ["duplicate receipt", p => p.events[1].receipts.push({})],
  ["wrong tenant", p => p.events[1].receipts[0].companyId++],
  ["wrong user", p => p.events[1].receipts[0].userId++],
  ["wrong receipt link", p => { p.events[1].receipts[0].creditNoteId = "999"; }],
  ["duplicate move", p => p.events[1].returnState.moves.push({})],
  ["wrong cost", p => p.events[1].returnState.moves[0].unitCost++],
  ["wrong stock", p => p.events[1].returnState.stock++],
  ["wrong source line", p => p.events[1].returnState.moves[0].invoiceLineId++],
  ["stale final state", p => { p.finalReturnState = {}; }],
  ["late duplicate journal", p => p.finalJournalCount++],
  ["late duplicate document", p => p.finalCounts.creditNotes++],
  ["stale run", (_, b) => { b.runId = "old"; }],
  ["no pending key", (_, b) => { b.pending.entries = []; }],
  ["late pending snapshot", (_, b) => { b.pending.observedAt = 500; }],
  ["changed visible quantity", (_, b) => { b.pending.fields.quantity = "2"; }],
  ["not double click", (_, b) => { b.clicks[1] = 1000; }],
  ["reload", (_, b) => b.afterSuccess.timeOrigin++],
  ["key not cleared", (_, b) => { b.afterSuccess.entries = [["key", "key"]]; }],
  ["duplicate visible return", (_, b) => b.afterSuccess.visibleCreditNoteCount++],
]) test(`rejects ${name}`, () => {
  const { p, b } = evidence();
  mutate(p, b);
  assert.throws(() => checkBrowserOverlappingReturn(p, b));
});
