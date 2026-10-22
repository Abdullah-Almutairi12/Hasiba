import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { checkReloadedReceiptCleanup } from "./check-browser-reloaded-receipt-cleanup.mjs";

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
    counts: { invoices: 1, paymentReceipts: 1, receipts: 1 }, recordedAt: 10000,
    paymentState: {
      payments: [{ id: 1, reference: "RCT-1", customerId: 1, amount: 50, paymentMethod: "cash", journalEntryId: 11 }],
      allocations: [{ receiptId: 1, invoiceId: 1, amount: 50 }],
      invoices: [{ ...invoice, amountPaid: 50, status: "partially_paid" }],
    } };
  const entries = [{ storageKey: first.storageKey, key: first.key }];
  const fields = { customerName: "Test", amount: "50", paymentMethod: "نقدي", invoiceReference: "INV-1", allocation: "50" };
  const proxy = { scenario: "identical-receipt", runId: "run",
    initialCounts: { invoices: 1, paymentReceipts: 0, receipts: 0 }, initialJournals: [{ id: 10 }],
    initialPaymentState: { payments: [], allocations: [], invoices: [invoice] },
    invoicePostCount: 0, receiptPostCount: 2,
    events: [first, { ...structuredClone(first), replayed: true, replayHeader: "true", recordedAt: 11000 }],
    finalCounts: first.counts, finalJournals: first.journals,
    finalReceipts: receipts, finalPaymentState: first.paymentState, receiptsObservedAt: 12000 };
  const beforeRetryProxy = { ...structuredClone(proxy), receiptPostCount: 1,
    events: [structuredClone(first)], receiptsObservedAt: 10500 };
  const restored = { removeItem: true, probe: true, fetch: true };
  // Browser and proxy clocks deliberately differ.
  const browser = { runId: "run", customerId: 1, customerName: "Test", invoiceReference: "INV-1",
    faultMethod: "removeItem", faultName: "SecurityError",
    beforeSave: { fields: structuredClone(fields), observedAt: 100, timeOrigin: 50 },
    afterCleanupFailure: { formOpen: true, fields: structuredClone(fields), entries,
      observedAt: 120, timeOrigin: 50, message: "تم حفظ العملية بالفعل، لكن تعذر تنظيف مفتاحها" },
    afterReload: { formClosed: true, entries, navigationType: "reload", receiptPostCount: 0,
      observedAt: 210, timeOrigin: 200, observerInstalledBeforeApp: true, readyStateAtInstall: "loading",
      observerTimeOrigin: 200, observerInstalledAt: 201 },
    beforeRetry: { formOpen: true, fields: structuredClone(fields), entries, receiptPostCount: 0,
      observerInstalledBeforeApp: true, observedAt: 220, timeOrigin: 200 },
    responses: [false, true].map((replayed, i) => ({ status: 201, body: { id: 1, reference: "RCT-1" },
      key: "intent", requestBody, replayed, jsonObservedAt: i ? 230 : 110 })),
    removalAttempts: [{ key: first.storageKey, at: 115 }],
    restored, restoredBeforeReload: restored,
    restoredAfterReload: { fetch: true, probe: true, removeItemProbe: true },
    afterSuccess: { formClosed: true, entries: [], visibleReceiptCount: 1, references: ["RCT-1"],
      receiptPostCount: 1, observedAt: 240, timeOrigin: 200 } };
  return structuredClone({ proxy, browser, beforeRetryProxy });
}

test("accepts receipt recovery after reload with independent clock domains", () => {
  const { proxy, browser, beforeRetryProxy } = fixture();
  checkReloadedReceiptCleanup(proxy, browser, beforeRetryProxy);
});
const mutations = {
  "stale run": (p, b) => { b.runId = "old"; },
  "lost success": (p) => { p.events[0].dropped = true; },
  "unreadable JSON": (p, b) => { b.responses[0].body = null; },
  "cleanup before JSON": (p, b) => { b.removalAttempts[0].at = 109; },
  "wrong removal key": (p, b) => { b.removalAttempts[0].key = "other"; },
  "read fault": (p, b) => { b.faultMethod = "getItem"; },
  "wrong exception": (p, b) => { b.faultName = "Error"; },
  "generic error": (p, b) => { b.afterCleanupFailure.message = "Failed"; },
  "closed failed form": (p, b) => { b.afterCleanupFailure.formOpen = false; },
  "same document retry": (p, b) => { b.afterReload.timeOrigin = 50; },
  "not reload": (p, b) => { b.afterReload.navigationType = "navigate"; },
  "lost key": (p, b) => { b.afterReload.entries = []; },
  "replaced key": (p, b) => { b.afterReload.entries[0].key = "new"; },
  "reload POST": (p, b) => { b.afterReload.receiptPostCount = 1; },
  "refill POST": (p, b) => { b.beforeRetry.receiptPostCount = 1; },
  "late observer": (p, b) => { b.afterReload.readyStateAtInstall = "complete"; },
  "missing observer": (p, b) => { b.afterReload.observerInstalledBeforeApp = false; },
  "unobserved refill": (p, b) => { b.beforeRetry.observerInstalledBeforeApp = false; },
  "old observer": (p, b) => { b.afterReload.observerTimeOrigin = 50; },
  "missing install timestamp": (p, b) => { delete b.afterReload.observerInstalledAt; },
  "closed refilled form": (p, b) => { b.beforeRetry.formOpen = false; },
  "changed amount": (p, b) => { b.beforeRetry.fields.amount = "100"; },
  "changed allocation": (p, b) => { b.beforeRetry.fields.allocation = "0"; },
  "changed payment method": (p, b) => { b.beforeSave.fields.paymentMethod = "تحويل"; },
  "wrong customer": (p, b) => { b.customerId = 2; },
  "changed retry bytes": (p, b) => { b.responses[1].requestBody += " "; },
  "wrong fingerprint": (p) => { p.events[0].storageKey = "wrong"; },
  "new receipt": (p) => { p.events[1].paymentReceiptId = 2; },
  "new intent": (p) => { p.events[1].key = "new"; },
  "not replay": (p) => { p.events[1].replayed = false; },
  "missing replay header": (p) => { p.events[1].replayHeader = null; },
  "wrong financial link": (p) => { p.finalReceipts[0].paymentReceiptId = "2"; },
  "double payment": (p) => { p.finalPaymentState.invoices[0].amountPaid = 100; },
  "duplicate allocation": (p) => { p.finalPaymentState.allocations.push({}); },
  "extra journal": (p) => { p.finalJournals.push({ id: 12 }); },
  "extra ingress": (p, b, c) => { c.receiptPostCount = 2; },
  "unexpected invoice ingress": (p, b, c) => { c.invoicePostCount = 1; },
  "extra pre-confirmation event": (p, b, c) => { c.events.push(c.events[0]); },
  "stale capture run": (p, b, c) => { c.runId = "old"; },
  "wrong capture scenario": (p, b, c) => { c.scenario = "identical-return"; },
  "duplicate before confirmation": (p, b, c) => { c.finalCounts.paymentReceipts = 2; },
  "extra financial request before confirmation": (p, b, c) => { c.finalReceipts.push({}); },
  "changed allocation before confirmation": (p, b, c) => { c.finalPaymentState.allocations[0].amount = 100; },
  "changed journal before confirmation": (p, b, c) => { c.finalJournals[0].id = 20; },
  "late capture": (p, b, c) => { c.receiptsObservedAt = 11001; },
  "stale capture": (p, b, c) => { c.receiptsObservedAt = 9999; },
  "stale final capture": (p) => { p.receiptsObservedAt = 10999; },
  "multiple confirmation POSTs": (p, b) => { b.afterSuccess.receiptPostCount = 2; },
  "key remains": (p, b) => { b.afterSuccess.entries = [{}]; },
  "form remains": (p, b) => { b.afterSuccess.formClosed = false; },
  "duplicate row": (p, b) => { b.afterSuccess.visibleReceiptCount = 2; },
  "wrong row": (p, b) => { b.afterSuccess.references = ["RCT-2"]; },
  "unrestored removal before reload": (p, b) => { b.restoredBeforeReload.removeItem = false; },
  "unrestored fetch after reload": (p, b) => { b.restoredAfterReload.fetch = false; },
  "failed storage probe": (p, b) => { b.restored.probe = false; },
};
for (const [name, mutate] of Object.entries(mutations)) {
  test(`rejects ${name}`, () => {
    const { proxy, browser, beforeRetryProxy } = fixture();
    mutate(proxy, browser, beforeRetryProxy);
    assert.throws(() => checkReloadedReceiptCleanup(proxy, browser, beforeRetryProxy));
  });
}
