import { test } from "node:test";
import assert from "node:assert/strict";
import { checkRepeatedInvoiceCleanup } from "./check-browser-repeated-invoice-cleanup.mjs";

function fixture(n = 4) {
  const body = { customerId: 1, lines: [{ productId: 1, quantity: 1, unitPrice: 100 }] };
  const receipt = { key: "first", invoiceId: "1", companyId: 1, userId: 1, operation: "invoice" };
  const first = { upstreamStatus: 201, dropped: false, replayed: false, replayHeader: null,
    invoiceId: 1, reference: "SINV-1", key: "first", storageKey: "hasba:financial-request:digest",
    bodyHash: "digest", body, journals: [{ id: 1 }], receipts: [receipt],
    counts: { invoices: 1, receipts: 1 }, recordedAt: 100 };
  const events = Array.from({ length: n + 1 }, (_, i) => ({
    ...first, replayed: i > 0, replayHeader: i > 0 ? "true" : null, recordedAt: 100 + i * 100,
  }));
  const second = { ...first, key: "second", invoiceId: 2, reference: "SINV-2", recordedAt: 200 + n * 100,
    counts: { invoices: 2, receipts: 2 }, journals: [{ id: 1 }, { id: 2 }],
    receipts: [receipt, { ...receipt, key: "second", invoiceId: "2" }] };
  events.push(second);
  const fields = { customer: "Test", product: "Test", quantity: "1", price: "100", discount: "0", notes: "Test" };
  const entries = [{ storageKey: first.storageKey, key: first.key }];
  return structuredClone({
    proxy: { runId: "run", initialCounts: { invoices: 0, receipts: 0 }, initialJournals: [],
      invoicePostCount: events.length, events, finalCounts: second.counts,
      finalJournals: second.journals, finalReceipts: second.receipts, receiptsObservedAt: second.recordedAt + 20 },
    browser: { runId: "run", beforeSave: { fields, observedAt: 50, timeOrigin: 1 },
      cleanupFailures: Array.from({ length: n }, (_, i) => ({
        formOpen: true, fields, entries, message: "تم حفظ العملية بالفعل، لكن تعذر تنظيف مفتاحها",
        observedAt: 110 + i * 100, timeOrigin: 1,
      })),
      beforeRecovery: { formOpen: true, fields, entries, observedAt: n * 100 + 50,
        timeOrigin: 1, restored: { removeItem: true, probe: true } },
      removalAttempts: Array.from({ length: n }, (_, i) => ({ key: first.storageKey, at: 102 + i * 100 })),
      responses: events.map((e) => ({ status: 201, body: { id: e.invoiceId, reference: e.reference },
        key: e.key, requestBody: JSON.stringify(body), replayed: e.replayed, jsonObservedAt: e.recordedAt + 1 })),
      restored: { removeItem: true, probe: true, fetch: true },
      afterSuccess: { formClosed: true, entries: [], visibleInvoiceCount: 1, references: ["SINV-1"],
        observedAt: n * 100 + 110, timeOrigin: 1 },
      afterNewForm: { formOpen: true, fields, entries: [], observedAt: n * 100 + 120, timeOrigin: 1 },
      afterSecondSuccess: { formClosed: true, entries: [], visibleInvoiceCount: 2,
        references: ["SINV-1", "SINV-2"], observedAt: n * 100 + 210, timeOrigin: 1 } },
  });
}

test("accepts four failed cleanups, final replay and an independent identical invoice", () => {
  const { proxy, browser } = fixture();
  checkRepeatedInvoiceCleanup(proxy, browser);
});
test("accepts additional sequential failed confirmations", () => {
  const { proxy, browser } = fixture(6);
  checkRepeatedInvoiceCleanup(proxy, browser);
});
test("does not compare remote browser and proxy clocks or mutate evidence", () => {
  const { proxy, browser } = fixture();
  for (const e of proxy.events) e.recordedAt += 5000;
  proxy.receiptsObservedAt += 5000;
  const before = JSON.stringify({ proxy, browser });
  checkRepeatedInvoiceCleanup(proxy, browser);
  assert.equal(JSON.stringify({ proxy, browser }), before);
});
test("rejects the old single-failure scenario", () => {
  const { proxy, browser } = fixture(1);
  assert.throws(() => checkRepeatedInvoiceCleanup(proxy, browser));
});
const mutations = {
  "missing request arrival": (p) => p.invoicePostCount--,
  "missing event": (p) => p.events.splice(2, 1),
  "missing response": (_, b) => b.responses.splice(2, 1),
  "missing failed removal": (_, b) => b.removalAttempts.pop(),
  "stale run": (_, b) => { b.runId = "old"; },
  "restoration missing": (_, b) => { b.beforeRecovery.restored.probe = false; },
  "recovery fields changed": (_, b) => { b.beforeRecovery.fields = {}; },
  "recovery key lost": (_, b) => { b.beforeRecovery.entries = []; },
  "recovery dialog closed": (_, b) => { b.beforeRecovery.formOpen = false; },
  "recovery captured too early": (_, b) => { b.beforeRecovery.observedAt = 300; },
  "recovery captured too late": (_, b) => { b.beforeRecovery.observedAt = 510; },
  "new intent used old key": (p) => { p.events.at(-1).key = "first"; },
  "final confirmation not replayed": (p) => { p.events.at(-2).replayed = false; },
  "second invoice absent": (p) => { p.finalCounts.invoices = 1; },
  "methods not restored": (_, b) => { b.restored.fetch = false; },
  "stale final rows": (_, b) => { b.afterSecondSuccess.visibleInvoiceCount = 1; },
};
for (let i = 0; i < 4; i++) {
  Object.assign(mutations, {
    [`failure ${i} changed identity`]: (p) => { p.events[i].invoiceId = 9; },
    [`failure ${i} changed key`]: (p) => { p.events[i].key = "different"; },
    [`failure ${i} changed body`]: (_, b) => { b.responses[i].requestBody = "{}"; },
    [`failure ${i} extra receipt`]: (p) => { p.events[i].receipts.push({}); },
    [`failure ${i} extra journal`]: (p) => { p.events[i].journals.push({ id: 9 }); },
    [`failure ${i} extra invoice`]: (p) => { p.events[i].counts.invoices = 2; },
    [`failure ${i} cleanup before JSON`]: (_, b) => { b.removalAttempts[i].at = 0; },
    [`failure ${i} wrong removal key`]: (_, b) => { b.removalAttempts[i].key = "other"; },
    [`failure ${i} closed dialog`]: (_, b) => { b.cleanupFailures[i].formOpen = false; },
    [`failure ${i} edited fields`]: (_, b) => { b.cleanupFailures[i].fields = {}; },
    [`failure ${i} lost pending key`]: (_, b) => { b.cleanupFailures[i].entries = []; },
    [`failure ${i} missing saved warning`]: (_, b) => { b.cleanupFailures[i].message = "generic error"; },
    [`failure ${i} different document`]: (_, b) => { b.cleanupFailures[i].timeOrigin = 2; },
    [`failure ${i} overlapping confirmation`]: (_, b) => { b.cleanupFailures[i].observedAt = 999; },
  });
}
for (const [name, mutate] of Object.entries(mutations)) {
  test(`rejects ${name}`, () => {
    const { proxy, browser } = fixture();
    mutate(proxy, browser);
    assert.throws(() => checkRepeatedInvoiceCleanup(proxy, browser));
  });
}
