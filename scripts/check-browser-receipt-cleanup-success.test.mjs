import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { checkReceiptCleanup } from "./check-browser-receipt-cleanup-success.mjs";

function fixture() {
  const invoice = { id: 1, customerId: 1, total: 300, amountPaid: 0, status: "open" };
  const body = { customerId: 1, amount: 50, paymentMethod: "cash", allocations: [{ invoiceId: 1, amount: 50 }] };
  const requestBody = JSON.stringify(body);
  const hash = (s) => createHash("sha256").update(s).digest("hex");
  const receipts = [{ companyId: 1, userId: 1, operation: "POST:1:/sales/receipts", key: "intent", paymentReceiptId: "1" }];
  const first = { upstreamStatus: 201, dropped: false, replayed: false, replayHeader: null,
    paymentReceiptId: 1, reference: "RCT-1", key: "intent",
    storageKey: `hasba:financial-request:${hash(`/api/sales/receipts\n${requestBody}`)}`,
    bodyHash: hash(requestBody), body, journals: [{ id: 10 }, { id: 11 }], receipts,
    counts: { invoices: 1, paymentReceipts: 1, receipts: 1 },
    paymentState: {
      payments: [{ id: 1, reference: "RCT-1", customerId: 1, amount: 50, paymentMethod: "cash", journalEntryId: 11 }],
      allocations: [{ receiptId: 1, invoiceId: 1, amount: 50 }],
      invoices: [{ ...invoice, amountPaid: 50, status: "partially_paid" }],
    } };
  const entries = [{ storageKey: first.storageKey, key: first.key }];
  const fields = { customerName: "Test", amount: "50", paymentMethod: "نقدي", invoiceReference: "INV-1", allocation: "50" };
  const success = { formClosed: true, entries: [], visibleReceiptCount: 1, references: ["RCT-1"], timeOrigin: 100 };
  return structuredClone({
    proxy: { scenario: "identical-receipt", runId: "run",
      initialCounts: { invoices: 1, paymentReceipts: 0, receipts: 0 }, initialJournals: [{ id: 10 }],
      initialPaymentState: { payments: [], allocations: [], invoices: [invoice] },
      invoicePostCount: 0, receiptPostCount: 2,
      events: [first, { ...structuredClone(first), replayed: true, replayHeader: "true" }],
      finalCounts: structuredClone(first.counts), finalJournals: structuredClone(first.journals),
      finalReceipts: structuredClone(receipts), finalPaymentState: structuredClone(first.paymentState) },
    browser: { runId: "run", customerName: "Test", invoiceReference: "INV-1",
      beforeSave: { fields: structuredClone(fields) },
      afterCleanupFailure: { formOpen: true, fields: structuredClone(fields), entries,
        message: "تم حفظ العملية بالفعل، لكن تعذر تنظيف مفتاحها" },
      beforeRetry: { formOpen: true, fields: structuredClone(fields), entries },
      responses: [false, true].map((replayed) => ({ status: 201, body: { id: 1, reference: "RCT-1" },
        key: "intent", requestBody, replayed, jsonObservedAt: 100 })),
      removalAttempts: [{ key: first.storageKey, at: 101 }],
      restored: { removeItem: true, probe: true, fetch: true },
      afterSuccess: success, afterReload: { ...success, timeOrigin: 200 } },
  });
}
test("accepts confirmed receipt cleanup failure and unchanged replay", () => {
  const { proxy, browser } = fixture();
  checkReceiptCleanup(proxy, browser);
});
const mutations = {
  "different run": (p) => { p.runId = "other"; },
  "lost response": (p) => { p.events[0].dropped = true; },
  "not replay": (p) => { p.events[1].replayed = false; },
  "new key": (p) => { p.events[1].key = "new"; },
  "changed body": (p) => { p.events[1].body = {}; },
  "extra POST": (p) => { p.receiptPostCount++; },
  "duplicate receipt": (p) => { p.finalCounts.paymentReceipts++; },
  "duplicate financial request": (p) => { p.finalReceipts.push({}); },
  "extra allocation": (p) => { p.finalPaymentState.allocations.push({}); },
  "double payment": (p) => { p.finalPaymentState.invoices[0].amountPaid = 100; },
  "extra journal": (p) => { p.finalJournals.push({ id: 12 }); },
  "orphan journal during replay": (p) => { p.events[1].journals.push({ id: 12 }); },
  "wrong document link": (p) => { p.events[1].receipts[0].paymentReceiptId = "2"; },
  "unreadable JSON": (_, b) => { b.responses[0].body = null; },
  "early removal": (_, b) => { b.removalAttempts[0].at = 99; },
  "wrong storage key": (_, b) => { b.removalAttempts[0].key = "other"; },
  "generic error": (_, b) => { b.afterCleanupFailure.message = "Error"; },
  "closed on error": (_, b) => { b.afterCleanupFailure.formOpen = false; },
  "changed form": (_, b) => { b.beforeRetry.fields.amount = "100"; },
  "missing retained key": (_, b) => { b.afterCleanupFailure.entries = []; },
  "removeItem not restored": (_, b) => { b.restored.removeItem = false; },
  "fetch not restored": (_, b) => { b.restored.fetch = false; },
  "failed probe": (_, b) => { b.restored.probe = false; },
  "key remains": (_, b) => { b.afterSuccess.entries = [{}]; },
  "missing reload": (_, b) => { b.afterReload.timeOrigin = b.afterSuccess.timeOrigin; },
  "duplicate reload row": (_, b) => { b.afterReload.visibleReceiptCount = 2; },
  "wrong reload reference": (_, b) => { b.afterReload.references = ["RCT-2"]; },
};
for (const [name, mutate] of Object.entries(mutations)) {
  test(`rejects ${name}`, () => {
    const { proxy, browser } = fixture();
    mutate(proxy, browser);
    assert.throws(() => checkReceiptCleanup(proxy, browser));
  });
}
