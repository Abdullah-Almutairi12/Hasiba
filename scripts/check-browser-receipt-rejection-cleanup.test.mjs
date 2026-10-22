import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { checkReceiptRejectionCleanup } from "./check-browser-receipt-rejection-cleanup.mjs";

function fixture() {
  const invoice = { id: 1, customerId: 1, total: 300, amountPaid: 0, status: "open" };
  const body = { customerId: 1, amount: 50, paymentMethod: "cash", allocations: [{ invoiceId: 1, amount: 40 }] };
  const requestBody = JSON.stringify(body);
  const hash = (s) => createHash("sha256").update(s).digest("hex");
  const storageKey = `hasba:financial-request:${hash(`/api/sales/receipts\n${requestBody}`)}`;
  const counts = { invoices: 1, paymentReceipts: 0, receipts: 0 };
  const paymentState = { payments: [], allocations: [], invoices: [invoice] };
  const journals = [{ id: 10 }];
  const error = { error: "مجموع التوزيع يجب أن يساوي مبلغ السند" };
  const event = { key: "intent", body, bodyHash: hash(requestBody), storageKey,
    upstreamStatus: 400, responseBody: error, dropped: false, replayed: false, replayHeader: null,
    counts, paymentState, journals, receipts: [], recordedAt: 15 };
  const fields = { customerName: "Synthetic customer", amount: "50", paymentMethod: "نقدي",
    invoiceReference: "INV-TEST", allocation: "40" };
  const retained = { formOpen: true, fields, entries: [{ storageKey, key: "intent" }], visibleReceiptCount: 0 };
  return JSON.parse(JSON.stringify({
    proxy: { scenario: "identical-receipt", runId: "run", initialCounts: counts,
      initialPaymentState: paymentState, initialJournals: journals,
      invoicePostCount: 0, returnPostCount: 0, receiptPostCount: 2,
      events: [{ ...event, arrivalIndex: 0 }, { ...event, arrivalIndex: 1 }],
      arrivals: [0, 1].map(() => ({ arrivedAt: 10, responseSentAt: 20 })),
      finalCounts: counts, finalPaymentState: paymentState, finalJournals: journals,
      finalReceipts: [], capturedAt: 30 },
    browser: { runId: "run", customerName: fields.customerName, invoiceReference: fields.invoiceReference,
      beforeSave: { formOpen: true, fields, entries: [] },
      afterCleanupFailure: { ...retained, message: "رفض الخادم العملية، لكن تعذر تنظيف مفتاحها من تخزين الجلسة." },
      beforeRetry: retained,
      afterRetry: { ...retained, entries: [], message: error.error },
      responses: [0, 1].map(() => ({ status: 400, body: error, key: "intent", requestBody,
        replayed: false, jsonObservedAt: 100 })),
      removalAttempts: [{ key: storageKey, at: 101 }],
      faultScope: { sessionStorageOnly: true, financialKeysOnly: true, getItemUnchanged: true, setItemUnchanged: true },
      restored: { removeItem: true, probe: true, fetch: true } },
  }));
}

test("accepts definitive rejection with failed cleanup and rejected same-key retry", () => {
  const { proxy, browser } = fixture();
  checkReceiptRejectionCleanup(proxy, browser);
});

const mutations = {
  "different run": (p) => { p.runId = "other"; },
  "missing ingress": (p) => { p.arrivals = []; },
  "extra POST": (p) => { p.receiptPostCount++; },
  "wrong endpoint activity": (p) => { p.invoicePostCount++; },
  "missing retry": (p) => { p.events.pop(); },
  "new retry key": (p) => { p.events[1].key = "new"; },
  "changed retry body": (p) => { p.events[1].body = {}; },
  "success": (p) => { p.events[0].upstreamStatus = 201; },
  "uncertain rejection": (p) => { p.events[0].upstreamStatus = 429; },
  "wrong validation": (p) => { p.events[0].responseBody = { error: "unauthorized" }; },
  "dropped response": (p) => { p.events[0].dropped = true; },
  "replayed success": (p) => { p.events[1].replayed = true; },
  "unmatched digest": (p) => { p.events[0].bodyHash = "wrong"; },
  "unmatched storage key": (p) => { p.events[0].storageKey = "wrong"; },
  "reserialized retry": (p, b) => {
    b.responses[1].requestBody = JSON.stringify(JSON.parse(b.responses[1].requestBody), null, 2);
    p.events[1].bodyHash = createHash("sha256").update(b.responses[1].requestBody).digest("hex");
    p.events[1].storageKey = `hasba:financial-request:${createHash("sha256").update(`/api/sales/receipts\n${b.responses[1].requestBody}`).digest("hex")}`;
  },
  "receipt created": (p) => { p.events[0].counts.paymentReceipts++; },
  "allocation created": (p) => { p.events[0].paymentState.allocations.push({}); },
  "invoice paid": (p) => { p.events[1].paymentState.invoices[0].amountPaid = 50; },
  "journal posted": (p) => { p.events[0].journals.push({ id: 11 }); },
  "financial intent committed": (p) => { p.events[0].receipts.push({}); },
  "late receipt": (p) => { p.finalCounts.paymentReceipts++; },
  "late journal": (p) => { p.finalJournals.push({ id: 11 }); },
  "early capture": (p) => { p.capturedAt = 0; },
  "missing browser response": (_, b) => { b.responses.pop(); },
  "browser wrong error": (_, b) => { b.responses[0].body = {}; },
  "closed dialog": (_, b) => { b.afterCleanupFailure.formOpen = false; },
  "cleared fields": (_, b) => { b.afterCleanupFailure.fields = {}; },
  "changed retry fields": (_, b) => { b.beforeRetry.fields = {}; },
  "lost retained key": (_, b) => { b.afterCleanupFailure.entries = []; },
  "unclean retry key": (_, b) => { b.afterRetry.entries = [{}]; },
  "saved warning": (_, b) => { b.afterCleanupFailure.message = "تم حفظ العملية بالفعل"; },
  "success mixed with rejection": (_, b) => { b.afterRetry.message += " تم تسجيل سند القبض"; },
  "wrong removal key": (_, b) => { b.removalAttempts[0].key = "other"; },
  "early removal": (_, b) => { b.removalAttempts[0].at = 99; },
  "read also blocked": (_, b) => { b.faultScope.getItemUnchanged = false; },
  "write also blocked": (_, b) => { b.faultScope.setItemUnchanged = false; },
  "failed restoration": (_, b) => { b.restored.removeItem = false; },
  "failed probe": (_, b) => { b.restored.probe = false; },
  "fetch not restored": (_, b) => { b.restored.fetch = false; },
};
for (const [name, mutate] of Object.entries(mutations)) {
  test(`rejects ${name}`, () => {
    const { proxy, browser } = fixture();
    mutate(proxy, browser);
    assert.throws(() => checkReceiptRejectionCleanup(proxy, browser));
  });
}
