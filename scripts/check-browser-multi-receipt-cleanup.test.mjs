import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { checkMultiReceiptCleanup } from "./check-browser-multi-receipt-cleanup.mjs";

function fixture() {
  const invoices = [1, 2].map((id) => ({ id, customerId: 3, total: 300, amountPaid: 0, status: "open" }));
  const body = { customerId: 3, amount: 50, paymentMethod: "cash",
    allocations: [{ invoiceId: 1, amount: 20 }, { invoiceId: 2, amount: 30 }] };
  const requestBody = JSON.stringify(body);
  const hash = (s) => createHash("sha256").update(s).digest("hex");
  const storageKey = `hasba:financial-request:${hash(`/api/sales/receipts\n${requestBody}`)}`;
  const events = Array.from({ length: 6 }, (_, i) => {
    const count = i === 5 ? 2 : 1;
    const payments = Array.from({ length: count }, (_, j) => ({ id: j + 1, reference: `RCT-${j + 1}`,
      customerId: 3, amount: 50, paymentMethod: "cash", journalEntryId: j + 11 }));
    return { upstreamStatus: 201, dropped: false, replayed: i > 0 && i < 5,
      replayHeader: i > 0 && i < 5 ? "true" : null, key: count === 2 ? "second" : "first",
      paymentReceiptId: count, reference: `RCT-${count}`, body, bodyHash: hash(requestBody), storageKey,
      recordedAt: (i + 1) * 100, counts: { invoices: 2, paymentReceipts: count, receipts: count },
      journals: [{ id: 10 }, ...payments.map((p) => ({ id: p.journalEntryId }))],
      receipts: payments.map((p) => ({ companyId: 1, userId: 2, operation: "POST:1:/sales/receipts",
        key: p.id === 1 ? "first" : "second", paymentReceiptId: String(p.id) })),
      paymentState: { payments, allocations: payments.flatMap((p) => body.allocations.map((a) => ({ receiptId: p.id, ...a }))),
        invoices: invoices.map((invoice, j) => ({ ...invoice, amountPaid: count * (j === 0 ? 20 : 30), status: "partially_paid" })) } };
  });
  const fields = { customerName: "Synthetic", amount: "50", paymentMethod: "نقدي",
    allocations: [{ invoiceReference: "INV-1", amount: "20" }, { invoiceReference: "INV-2", amount: "30" }] };
  const entries = [{ storageKey, key: "first" }];
  const stage = (observedAt, extra) => ({ observedAt, timeOrigin: 1, ...extra });
  return structuredClone({
    proxy: { runId: "run", scenario: "identical-receipt", initialCounts: { invoices: 2, paymentReceipts: 0, receipts: 0 },
      initialPaymentState: { payments: [], allocations: [], invoices }, initialJournals: [{ id: 10 }],
      receiptPostCount: 6, invoicePostCount: 0, returnPostCount: 0, events,
      finalCounts: events[5].counts, finalPaymentState: events[5].paymentState,
      finalJournals: events[5].journals, finalReceipts: events[5].receipts, receiptsObservedAt: 620 },
    browser: { runId: "run", customerName: "Synthetic", invoiceReferences: ["INV-1", "INV-2"],
      beforeSave: stage(50, { fields }),
      cleanupFailures: Array.from({ length: 4 }, (_, i) => stage((i + 1) * 100 + 10,
        { fields, entries, formOpen: true, message: "تم حفظ العملية بالفعل، لكن تعذر تنظيف مفتاحها" })),
      removalAttempts: Array.from({ length: 4 }, (_, i) => ({ key: storageKey, at: (i + 1) * 100 + 2 })),
      responses: events.map((e) => ({ key: e.key, status: 201, replayed: e.replayed, requestBody,
        body: { id: e.paymentReceiptId, reference: e.reference }, jsonObservedAt: e.recordedAt + 1 })),
      beforeRecovery: stage(450, { formOpen: true, fields, entries, restored: { removeItem: true, probe: true } }),
      afterSuccess: stage(510, { formClosed: true, entries: [], visibleReceiptCount: 1, references: ["RCT-1"] }),
      afterNewForm: stage(520, { formOpen: true, fields, entries: [] }),
      afterSecondSuccess: stage(610, { formClosed: true, entries: [], visibleReceiptCount: 2, references: ["RCT-1", "RCT-2"] }),
      restored: { fetch: true, removeItem: true, probe: true } },
  });
}

test("accepts split receipts with four cleanup failures, recovery and fresh identical intent without mutating evidence", () => {
  const { proxy, browser } = fixture();
  const before = JSON.stringify({ proxy, browser });
  checkMultiReceiptCleanup(proxy, browser);
  assert.equal(JSON.stringify({ proxy, browser }), before);
});
test("does not compare independent browser/proxy clocks", () => {
  const { proxy, browser } = fixture();
  for (const event of proxy.events) event.recordedAt += 100000;
  proxy.receiptsObservedAt += 100000;
  checkMultiReceiptCleanup(proxy, browser);
});
const mutations = {
  "one invoice only": (p) => { p.initialPaymentState.invoices.pop(); },
  "different customer": (p) => { p.initialPaymentState.invoices[1].customerId++; },
  "dirty second balance": (p) => { p.initialPaymentState.invoices[1].amountPaid = 1; },
  "wrong initial count": (p) => { p.initialCounts.invoices = 1; },
  "wrong final invoice count": (p) => { p.finalCounts.invoices = 1; },
  "final second balance changed": (p) => { p.finalPaymentState.invoices[1].amountPaid++; },
  "final missing second allocation": (p) => { p.finalPaymentState.allocations.pop(); },
  "not enough failures": (_, b) => { b.cleanupFailures.pop(); },
  "wrong run": (_, b) => { b.runId = "other"; },
  "method not restored": (_, b) => { b.restored.removeItem = false; },
  "missing final capture": (p) => { p.finalReceipts.pop(); },
  "new key reused": (p) => { p.events[5].key = "first"; },
  "recovery pending key changed": (_, b) => { b.beforeRecovery.entries[0].key = "bad"; },
};
for (let i = 0; i < 6; i++) Object.assign(mutations, {
  [`${i} missing second allocation`]: (p) => { p.events[i].paymentState.allocations.splice(1, 1); },
  [`${i} duplicated second allocation`]: (p) => { p.events[i].paymentState.allocations.push(p.events[i].paymentState.allocations[1]); },
  [`${i} redistributed total`]: (p) => {
    p.events[i].paymentState.allocations[0].amount = 30;
    p.events[i].paymentState.allocations[1].amount = 20;
  },
  [`${i} wrong second invoice`]: (p) => { p.events[i].paymentState.allocations[1].invoiceId = 99; },
  [`${i} doubled second balance`]: (p) => { p.events[i].paymentState.invoices[1].amountPaid *= 2; },
  [`${i} missing invoice`]: (p) => { p.events[i].paymentState.invoices.pop(); },
  [`${i} extra journal`]: (p) => { p.events[i].journals.push({ id: 99 }); },
  [`${i} extra financial record`]: (p) => { p.events[i].receipts.push({}); },
  [`${i} wrong body digest`]: (p) => { p.events[i].bodyHash = "wrong"; },
  [`${i} wrong storage fingerprint`]: (p) => { p.events[i].storageKey = "wrong"; },
  [`${i} request bytes differ`]: (_, b) => { b.responses[i].requestBody += " "; },
  [`${i} wrong browser key`]: (_, b) => { b.responses[i].key = "wrong"; },
  [`${i} dropped response`]: (p) => { p.events[i].dropped = true; },
});
for (let i = 0; i < 4; i++) Object.assign(mutations, {
  [`${i} changed rendered split`]: (_, b) => { b.cleanupFailures[i].fields.allocations[1].amount = "20"; },
  [`${i} reload`]: (_, b) => { b.cleanupFailures[i].timeOrigin = 2; },
  [`${i} missing pending key`]: (_, b) => { b.cleanupFailures[i].entries = []; },
  [`${i} generic failure`]: (_, b) => { b.cleanupFailures[i].message = "failed"; },
  [`${i} overlapping confirmation`]: (_, b) => { b.cleanupFailures[i].observedAt = 99999; },
});
for (const [name, mutate] of Object.entries(mutations)) test(`rejects ${name}`, () => {
  const { proxy, browser } = fixture();
  mutate(proxy, browser);
  assert.throws(() => checkMultiReceiptCleanup(proxy, browser));
});
