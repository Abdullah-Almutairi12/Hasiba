import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { checkRepeatedReceiptCleanup } from "./check-browser-repeated-receipt-cleanup.mjs";

function fixture(n = 4) {
  const invoice = { id: 1, customerId: 2, total: 500, amountPaid: 0, status: "open" };
  const body = { customerId: 2, amount: 50, paymentMethod: "cash", allocations: [{ invoiceId: 1, amount: 50 }] };
  const requestBody = JSON.stringify(body);
  const hash = (s) => createHash("sha256").update(s).digest("hex");
  const receipt = { companyId: 1, userId: 2, operation: "POST:1:/sales/receipts", key: "first", paymentReceiptId: "1" };
  const payment = { id: 1, reference: "RCT-1", customerId: 2, amount: 50, paymentMethod: "cash", journalEntryId: 11 };
  const first = { upstreamStatus: 201, dropped: false, replayed: false, replayHeader: null,
    key: "first", paymentReceiptId: 1, reference: "RCT-1", body, bodyHash: hash(requestBody),
    storageKey: `hasba:financial-request:${hash(`/api/sales/receipts\n${requestBody}`)}`,
    counts: { invoices: 1, paymentReceipts: 1, receipts: 1 }, journals: [{ id: 10 }, { id: 11 }],
    receipts: [receipt], paymentState: { payments: [payment],
      allocations: [{ receiptId: 1, invoiceId: 1, amount: 50 }],
      invoices: [{ ...invoice, amountPaid: 50, status: "partially_paid" }] }, recordedAt: 100 };
  const second = { ...first, key: "second", paymentReceiptId: 2, reference: "RCT-2", recordedAt: (n + 2) * 100,
    counts: { invoices: 1, paymentReceipts: 2, receipts: 2 },
    journals: [{ id: 10 }, { id: 11 }, { id: 12 }],
    receipts: [receipt, { ...receipt, key: "second", paymentReceiptId: "2" }],
    paymentState: { payments: [payment, { ...payment, id: 2, reference: "RCT-2", journalEntryId: 12 }],
      allocations: [{ receiptId: 1, invoiceId: 1, amount: 50 }, { receiptId: 2, invoiceId: 1, amount: 50 }],
      invoices: [{ ...invoice, amountPaid: 100, status: "partially_paid" }] } };
  const events = [...Array.from({ length: n + 1 }, (_, i) => ({
    ...first, recordedAt: (i + 1) * 100, replayed: i > 0, replayHeader: i > 0 ? "true" : null,
  })), second];
  const fields = { customerName: "Test", amount: "50", paymentMethod: "نقدي", invoiceReference: "INV-1", allocation: "50" };
  const entries = [{ storageKey: first.storageKey, key: first.key }];
  return structuredClone({
    proxy: { runId: "run", scenario: "identical-receipt",
      initialCounts: { invoices: 1, paymentReceipts: 0, receipts: 0 },
      initialJournals: [{ id: 10 }], initialPaymentState: { payments: [], allocations: [], invoices: [invoice] },
      receiptPostCount: n + 2, invoicePostCount: 0, returnPostCount: 0, events,
      finalCounts: second.counts, finalJournals: second.journals,
      finalPaymentState: second.paymentState, finalReceipts: second.receipts, receiptsObservedAt: second.recordedAt + 20 },
    browser: { runId: "run", customerName: "Test", invoiceReference: "INV-1",
      beforeSave: { fields, observedAt: 50, timeOrigin: 1 },
      cleanupFailures: Array.from({ length: n }, (_, i) => ({
        fields, entries, formOpen: true, observedAt: (i + 1) * 100 + 10, timeOrigin: 1,
        message: "تم حفظ العملية بالفعل، لكن تعذر تنظيف مفتاحها",
      })),
      removalAttempts: Array.from({ length: n }, (_, i) => ({ key: first.storageKey, at: (i + 1) * 100 + 2 })),
      responses: events.map((e) => ({ key: e.key, status: 201, replayed: e.replayed,
        body: { id: e.paymentReceiptId, reference: e.reference }, requestBody, jsonObservedAt: e.recordedAt + 1 })),
      beforeRecovery: { formOpen: true, fields, entries, observedAt: n * 100 + 50,
        timeOrigin: 1, restored: { removeItem: true, probe: true } },
      afterSuccess: { formClosed: true, entries: [], visibleReceiptCount: 1, references: ["RCT-1"],
        observedAt: (n + 1) * 100 + 10, timeOrigin: 1 },
      afterNewForm: { formOpen: true, fields, entries: [], observedAt: (n + 1) * 100 + 20, timeOrigin: 1 },
      afterSecondSuccess: { formClosed: true, entries: [], visibleReceiptCount: 2, references: ["RCT-1", "RCT-2"],
        observedAt: (n + 2) * 100 + 10, timeOrigin: 1 },
      restored: { fetch: true, removeItem: true, probe: true } },
  });
}

test("accepts four failures, recovery and a fresh identical allocated receipt", () => {
  const { proxy, browser } = fixture();
  checkRepeatedReceiptCleanup(proxy, browser);
});
test("accepts more failed sequential confirmations", () => {
  const { proxy, browser } = fixture(6);
  checkRepeatedReceiptCleanup(proxy, browser);
});
test("does not mutate evidence or compare independent browser/proxy clocks", () => {
  const { proxy, browser } = fixture();
  for (const e of proxy.events) e.recordedAt += 100000;
  proxy.receiptsObservedAt += 100000;
  const before = JSON.stringify({ proxy, browser });
  checkRepeatedReceiptCleanup(proxy, browser);
  assert.equal(JSON.stringify({ proxy, browser }), before);
});
const mutations = {
  "single failure": () => fixture(1),
  "only two replay failures": () => fixture(3),
  "wrong run": (p) => { p.runId = "stale"; },
  "wrong scenario": (p) => { p.scenario = "invoice"; },
  "extra arrival": (p) => { p.receiptPostCount++; },
  "invoice setup POST": (p) => { p.invoicePostCount++; },
  "unrelated return POST": (p) => { p.returnPostCount++; },
  "missing response": (_, b) => { b.responses.pop(); },
  "missing event": (p) => { p.events.pop(); },
  "missing removal": (_, b) => { b.removalAttempts.pop(); },
  "dirty initial state": (p) => { p.initialPaymentState.allocations.push({}); },
  "initial paid balance": (p) => { p.initialPaymentState.invoices[0].amountPaid = 50; },
  "final duplicate payment": (p) => { p.finalCounts.paymentReceipts++; },
  "final orphan journal": (p) => { p.finalJournals.push({ id: 99 }); },
  "missing final receipt": (p) => { p.finalReceipts.pop(); },
  "final allocation lost": (p) => { p.finalPaymentState.allocations.pop(); },
  "stale final capture": (p) => { p.receiptsObservedAt = 0; },
  "new intent reused key": (p) => { p.events.at(-1).key = "first"; },
  "new intent reused ID": (p) => { p.events.at(-1).paymentReceiptId = 1; },
  "new intent reused reference": (p) => { p.events.at(-1).reference = "RCT-1"; },
  "new intent replayed": (p) => { p.events.at(-1).replayed = true; },
  "recovery not replayed": (p) => { p.events.at(-2).replayed = false; },
  "recovery fields edited": (_, b) => { b.beforeRecovery.fields = {}; },
  "recovery key lost": (_, b) => { b.beforeRecovery.entries = []; },
  "recovery dialog closed": (_, b) => { b.beforeRecovery.formOpen = false; },
  "recovery probe failed": (_, b) => { b.beforeRecovery.restored.probe = false; },
  "recovery too late": (_, b) => { b.beforeRecovery.observedAt = 9999; },
  "recovery list stale": (_, b) => { b.afterSuccess.visibleReceiptCount = 0; },
  "recovery key remains": (_, b) => { b.afterSuccess.entries = [{}]; },
  "new form differs": (_, b) => { b.afterNewForm.fields = {}; },
  "new form not opened": (_, b) => { b.afterNewForm.formOpen = false; },
  "new form too late": (_, b) => { b.afterNewForm.observedAt = 9999; },
  "duplicate final row": (_, b) => { b.afterSecondSuccess.references = ["RCT-1", "RCT-1"]; },
  "missing final row": (_, b) => { b.afterSecondSuccess.visibleReceiptCount = 1; },
  "fetch not restored": (_, b) => { b.restored.fetch = false; },
  "storage not restored": (_, b) => { b.restored.removeItem = false; },
  "probe not restored": (_, b) => { b.restored.probe = false; },
};
for (let i = 0; i < 6; i++) {
  Object.assign(mutations, {
    [`response ${i} wrong key`]: (_, b) => { b.responses[i].key = "bad"; },
    [`response ${i} wrong body bytes`]: (_, b) => { b.responses[i].requestBody += " "; },
    [`response ${i} missing parsed JSON`]: (_, b) => { b.responses[i].body = null; },
    [`response ${i} wrong status`]: (_, b) => { b.responses[i].status = 502; },
    [`event ${i} double allocation`]: (p) => { p.events[i].paymentState.allocations.push({}); },
    [`event ${i} double payment`]: (p) => { p.events[i].paymentState.invoices[0].amountPaid += 50; },
    [`event ${i} orphan journal`]: (p) => { p.events[i].journals.push({ id: 99 }); },
    [`event ${i} extra financial receipt`]: (p) => { p.events[i].receipts.push({}); },
    [`event ${i} lost success`]: (p) => { p.events[i].dropped = true; },
    [`event ${i} wrong financial link`]: (p) => { p.events[i].receipts[0].paymentReceiptId = "99"; },
  });
}
for (let i = 0; i < 4; i++) {
  Object.assign(mutations, {
    [`failure ${i} changed ID`]: (p) => { p.events[i].paymentReceiptId = 99; },
    [`failure ${i} changed key`]: (p) => { p.events[i].key = "bad"; },
    [`failure ${i} removal before JSON`]: (_, b) => { b.removalAttempts[i].at = 0; },
    [`failure ${i} wrong removal key`]: (_, b) => { b.removalAttempts[i].key = "bad"; },
    [`failure ${i} closed dialog`]: (_, b) => { b.cleanupFailures[i].formOpen = false; },
    [`failure ${i} changed form`]: (_, b) => { b.cleanupFailures[i].fields = {}; },
    [`failure ${i} missing key`]: (_, b) => { b.cleanupFailures[i].entries = []; },
    [`failure ${i} generic error`]: (_, b) => { b.cleanupFailures[i].message = "failed"; },
    [`failure ${i} reload`]: (_, b) => { b.cleanupFailures[i].timeOrigin = 2; },
    [`failure ${i} overlapping confirmation`]: (_, b) => { b.cleanupFailures[i].observedAt = 9999; },
  });
}
for (const name of ["beforeRecovery", "afterSuccess", "afterNewForm", "afterSecondSuccess"]) {
  mutations[`${name} reload`] = (_, b) => { b[name].timeOrigin = 2; };
}
for (const [name, mutate] of Object.entries(mutations)) {
  test(`rejects ${name}`, () => {
    let { proxy, browser } = fixture();
    const replacement = mutate(proxy, browser);
    if (replacement) ({ proxy, browser } = replacement);
    assert.throws(() => checkRepeatedReceiptCleanup(proxy, browser));
  });
}
