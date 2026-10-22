import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { checkBrowserOverlappingInvoice as check } from "./check-browser-overlapping-invoice.mjs";

function evidence() {
  const body = { customerId: 3, lines: [{ productId: 4, description: "منتج اختبار",
    quantity: 1, unitPrice: 100, discountPct: 0, taxRate: 15 }],
    notes: "Overlapping invoice verification" };
  const hash = s => createHash("sha256").update(s).digest("hex");
  const storageKey = `hasba:financial-request:${hash(`/api/sales/invoices\n${JSON.stringify(body)}`)}`;
  const initialInvoiceState = { invoices: [], products: [{ id: 4, stock: 0 }], moves: [], quants: [] };
  const invoiceState = { ...initialInvoiceState,
    invoices: [{ id: 5, reference: "SINV-5", customerId: 3, total: 115 }] };
  const receipts = [{ companyId: 1, userId: 2, operation: "POST:1:/sales/invoices", key: "key", invoiceId: "5" }];
  const e = { arrivalIndex: 0, key: "key", invoiceId: 5, reference: "SINV-5", storageKey,
    body, bodyHash: hash(JSON.stringify(body)), journalCount: 1, journals: [{ id: 6 }],
    dropped: false, upstreamStatus: 201, replayed: false, replayHeader: null,
    recordedAt: 300, counts: { invoices: 1, receipts: 1 }, receipts, invoiceState };
  return JSON.parse(JSON.stringify({ p: { scenario: "overlapping-invoice", runId: "run",
    overlapInvoices: true, overlapTimedOut: false, invoicePostCount: 2, receiptPostCount: 0, returnPostCount: 0,
    initialCounts: { invoices: 0, receipts: 0 }, initialJournals: [], initialJournalCount: 0, initialInvoiceState,
    arrivals: [{ arrivedAt: 100, forwardedAt: 250, responseSentAt: 400 },
      { arrivedAt: 110, forwardedAt: 251, responseSentAt: 410 }],
    events: [e, { ...e, arrivalIndex: 1, replayed: true, replayHeader: "true", recordedAt: 310 }],
    finalInvoiceState: invoiceState, finalReceipts: receipts, finalJournals: [{ id: 6 }],
    receiptsObservedAt: 500, finalCounts: e.counts, finalJournalCount: 1 },
    b: { runId: "run", customerId: 3, productId: 4, customerName: "Synthetic", companyId: 1, userId: 2,
      clicks: [90, 95], pending: { observedAt: 200, timeOrigin: 1, formOpen: true,
        entries: [[storageKey, "key"]], fields: { customerName: "Synthetic", productName: "منتج اختبار",
          quantity: "1", unitPrice: "100", discountPct: "0", notes: body.notes } },
      afterSuccess: { observedAt: 600, timeOrigin: 1, formClosed: true, entries: [],
        visibleInvoiceCount: 1, references: ["SINV-5"] } } }));
}

test("accepts either arrival winning and either response completion order", () => {
  const { p, b } = evidence();
  check(p, b);
  p.events.reverse();
  check(p, b);
  p.events[0].arrivalIndex = 0;
  p.events[1].arrivalIndex = 1;
  check(p, b);
});

for (const [name, mutate] of [
  ["sequential saves", p => { p.arrivals[1].arrivedAt = 450; }],
  ["timeout", p => { p.overlapTimedOut = true; }],
  ["missing ingress", p => p.arrivals.pop()],
  ["missing response timestamp", p => { delete p.arrivals[0].responseSentAt; }],
  ["early forwarding", p => { p.arrivals[0].forwardedAt = 105; }],
  ["extra POST", p => p.invoicePostCount++],
  ["other financial operation", p => p.receiptPostCount++],
  ["missing replay header", p => { p.events[1].replayHeader = null; }],
  ["two originals", p => { p.events[1].replayed = false; }],
  ["rotated key", p => { p.events[1].key = "new"; }],
  ["lost response", p => { p.events[0].dropped = true; }],
  ["failed response", p => { p.events[0].upstreamStatus = 500; }],
  ["changed payload", p => { p.events[1].body = {}; }],
  ["incorrect digest", p => { p.events[0].bodyHash = "bad"; }],
  ["wrong storage key", p => { p.events[0].storageKey = "bad"; }],
  ["duplicate journal", p => p.events[1].journalCount++],
  ["duplicate invoice", p => p.events[1].counts.invoices++],
  ["duplicate receipt", p => p.events[1].receipts.push({})],
  ["wrong tenant", p => p.events[1].receipts[0].companyId++],
  ["wrong user", p => p.events[1].receipts[0].userId++],
  ["wrong receipt link", p => { p.events[1].receipts[0].invoiceId = "999"; }],
  ["stock mutation", p => p.events[1].invoiceState.products[0].stock++],
  ["unexpected move", p => p.events[1].invoiceState.moves.push({ id: 10 })],
  ["unexpected quant", p => p.events[1].invoiceState.quants.push({ id: 10 })],
  ["stale final state", p => { p.finalInvoiceState = {}; }],
  ["late duplicate journal", p => p.finalJournalCount++],
  ["late duplicate invoice", p => p.finalCounts.invoices++],
  ["stale run", (_, b) => { b.runId = "old"; }],
  ["missing pending key", (_, b) => { b.pending.entries = []; }],
  ["late pending snapshot", (_, b) => { b.pending.observedAt = 500; }],
  ["changed field", (_, b) => { b.pending.fields.quantity = "2"; }],
  ["not double click", (_, b) => { b.clicks[1] = 1000; }],
  ["reload", (_, b) => b.afterSuccess.timeOrigin++],
  ["key remains", (_, b) => { b.afterSuccess.entries = [["key", "key"]]; }],
  ["duplicate visible invoice", (_, b) => b.afterSuccess.visibleInvoiceCount++],
  ["wrong visible reference", (_, b) => { b.afterSuccess.references = ["other"]; }],
]) test(`rejects ${name}`, () => {
  const { p, b } = evidence();
  mutate(p, b);
  assert.throws(() => check(p, b));
});
