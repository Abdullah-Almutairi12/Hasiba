import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { checkBrowserOverlappingReceipt } from "./check-browser-overlapping-receipt.mjs";

function evidence() {
  const invoice = { id: 10, customerId: 20, total: 300, amountPaid: 0, status: "open" };
  const body = { customerId: 20, amount: 50, paymentMethod: "cash",
    allocations: [{ invoiceId: 10, amount: 50 }] };
  const hash = s => createHash("sha256").update(s).digest("hex");
  const storageKey = `hasba:financial-request:${hash(`/api/sales/receipts\n${JSON.stringify(body)}`)}`;
  const receipts = [{ companyId: 1, userId: 2, operation: "POST:1:/sales/receipts",
    key: "key", paymentReceiptId: "30" }];
  const paymentState = { payments: [{ id: 30, reference: "RCT-30", customerId: 20,
    amount: 50, paymentMethod: "cash", journalEntryId: 40 }],
    allocations: [{ receiptId: 30, invoiceId: 10, amount: 50 }],
    invoices: [{ ...invoice, amountPaid: 50, status: "partially_paid" }] };
  const e = { arrivalIndex: 0, key: "key", paymentReceiptId: 30, reference: "RCT-30",
    storageKey, body, bodyHash: hash(JSON.stringify(body)), journalCount: 2,
    journals: [{ id: 1 }, { id: 40 }], dropped: false, upstreamStatus: 201,
    replayed: false, replayHeader: null, recordedAt: 300,
    counts: { invoices: 1, paymentReceipts: 1, receipts: 1 }, receipts, paymentState };
  // JSON copy intentionally removes shared references so negative cases mutate
  // one piece of evidence without silently changing the expected counterpart.
  return JSON.parse(JSON.stringify({ p: { scenario: "identical-receipt", runId: "run",
    overlapReceipts: true, overlapTimedOut: false, receiptPostCount: 2,
    invoicePostCount: 0, returnPostCount: 0,
    initialCounts: { invoices: 1, paymentReceipts: 0, receipts: 0 },
    initialPaymentState: { payments: [], allocations: [], invoices: [invoice] },
    initialJournalCount: 1, initialJournals: [{ id: 1 }],
    arrivals: [{ arrivedAt: 100, forwardedAt: 250, responseSentAt: 400 },
      { arrivedAt: 110, forwardedAt: 251, responseSentAt: 410 }],
    events: [e, { ...e, arrivalIndex: 1, replayed: true, replayHeader: "true", recordedAt: 310 }],
    finalPaymentState: paymentState, finalReceipts: receipts, receiptsObservedAt: 500,
    finalCounts: e.counts, finalJournals: e.journals, finalJournalCount: 2 },
    b: { runId: "run", companyId: 1, userId: 2, customerName: "Synthetic",
      invoiceReference: "INV-10", clicks: [90, 95],
      pending: { observedAt: 200, timeOrigin: 1, formOpen: true, entries: [[storageKey, "key"]],
        fields: { customerName: "Synthetic", amount: "50", paymentMethod: "نقدي",
          invoiceReference: "INV-10", allocation: "50" } },
      afterSuccess: { observedAt: 600, timeOrigin: 1, formClosed: true,
        entries: [], visibleReceiptCount: 1, references: ["RCT-30"] } } }));
}

test("accepts either arrival winning and either response completion order", () => {
  const { p, b } = evidence();
  checkBrowserOverlappingReceipt(p, b);
  p.events.reverse();
  checkBrowserOverlappingReceipt(p, b);
  p.events[0].arrivalIndex = 0;
  p.events[1].arrivalIndex = 1;
  checkBrowserOverlappingReceipt(p, b);
});

for (const [name, mutate] of [
  ["sequential retry", p => { p.arrivals[1].arrivedAt = 450; }],
  ["timeout", p => { p.overlapTimedOut = true; }],
  ["missing ingress", p => p.arrivals.pop()],
  ["missing response timestamp", p => { delete p.arrivals[0].responseSentAt; }],
  ["early forwarding", p => { p.arrivals[0].forwardedAt = 105; }],
  ["extra POST", p => p.receiptPostCount++],
  ["unexpected return", p => p.returnPostCount++],
  ["wrong arrival link", p => { p.events[1].arrivalIndex = 0; }],
  ["missing replay", p => { p.events[1].replayed = false; }],
  ["missing replay header", p => { p.events[1].replayHeader = null; }],
  ["rotated key", p => { p.events[1].key = "new"; }],
  ["dropped response", p => { p.events[0].dropped = true; }],
  ["wrong status", p => { p.events[0].upstreamStatus = 500; }],
  ["changed body", p => { p.events[1].body.amount = 100; }],
  ["wrong hash", p => { p.events[1].bodyHash = "bad"; }],
  ["wrong storage key", p => { p.events[0].storageKey = "bad"; }],
  ["duplicate financial receipt", p => p.events[1].receipts.push({})],
  ["wrong tenant", p => p.events[0].receipts[0].companyId++],
  ["wrong user", p => p.events[0].receipts[0].userId++],
  ["wrong operation", p => { p.events[0].receipts[0].operation = "POST:1:/sales/invoices"; }],
  ["wrong persisted link", p => { p.events[0].receipts[0].paymentReceiptId = "999"; }],
  ["different payment id", p => p.events[1].paymentReceiptId++],
  ["duplicate payment", p => p.events[1].paymentState.payments.push({})],
  ["duplicate journal count", p => p.events[1].journalCount++],
  ["duplicate journal", p => p.events[1].journals.push({ id: 99 })],
  ["wrong journal link", p => p.events[1].paymentState.payments[0].journalEntryId++],
  ["duplicate allocation", p => p.events[1].paymentState.allocations.push({})],
  ["wrong allocation invoice", p => p.events[1].paymentState.allocations[0].invoiceId++],
  ["doubled amountPaid", p => { p.events[1].paymentState.invoices[0].amountPaid = 100; }],
  ["late duplicate", p => p.finalCounts.paymentReceipts++],
  ["late journal", p => p.finalJournalCount++],
  ["stale final state", p => { p.finalPaymentState = {}; }],
  ["stale final receipt", p => { p.finalReceipts = []; }],
  ["stale capture", p => { p.receiptsObservedAt = 200; }],
  ["stale run", (_, b) => { b.runId = "old"; }],
  ["no pending key", (_, b) => { b.pending.entries = []; }],
  ["late pending snapshot", (_, b) => { b.pending.observedAt = 500; }],
  ["changed fields", (_, b) => { b.pending.fields.allocation = "100"; }],
  ["not double click", (_, b) => { b.clicks[1] = 1000; }],
  ["reload", (_, b) => b.afterSuccess.timeOrigin++],
  ["premature success", (_, b) => { b.afterSuccess.observedAt = 405; }],
  ["dialog still open", (_, b) => { b.afterSuccess.formClosed = false; }],
  ["key not cleared", (_, b) => { b.afterSuccess.entries = [["key", "key"]]; }],
  ["duplicate visible payment", (_, b) => b.afterSuccess.visibleReceiptCount++],
  ["wrong visible reference", (_, b) => { b.afterSuccess.references = ["RCT-99"]; }],
]) test(`rejects ${name}`, () => {
  const { p, b } = evidence();
  mutate(p, b);
  assert.throws(() => checkBrowserOverlappingReceipt(p, b));
});
