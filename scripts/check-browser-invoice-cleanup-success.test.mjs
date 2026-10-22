import { test } from "node:test";
import assert from "node:assert/strict";
import { checkInvoiceCleanup } from "./check-browser-invoice-cleanup-success.mjs";

function fixture() {
  const body = { customerId: 1, lines: [{ description: "Test", quantity: 1, unitPrice: 100 }] };
  const receipts = [{ key: "intent", invoiceId: "1" }];
  const first = { upstreamStatus: 201, dropped: false, replayed: false, replayHeader: null,
    invoiceId: 1, reference: "SINV-1", key: "intent", storageKey: "hasba:financial-request:digest",
    bodyHash: "digest", body, journals: [{ id: 1 }], receipts, counts: { invoices: 1, receipts: 1 } };
  const entries = [{ storageKey: first.storageKey, key: first.key }];
  const fields = { customer: "Test", description: "Test", quantity: "1", price: "100" };
  return {
    proxy: { runId: "run", initialCounts: { invoices: 0, receipts: 0 }, initialJournals: [], invoicePostCount: 2,
      events: [first, { ...structuredClone(first), replayed: true, replayHeader: "true" }],
      finalCounts: first.counts, finalJournals: first.journals, finalReceipts: receipts },
    browser: { runId: "run", beforeSave: { fields },
      afterCleanupFailure: { formOpen: true, fields, entries,
        message: "تم حفظ العملية بالفعل، لكن تعذر تنظيف مفتاحها" },
      beforeRetry: { fields, entries },
      responses: [false, true].map((replayed) => ({ status: 201, body: { id: 1, reference: "SINV-1" },
        key: "intent", requestBody: JSON.stringify(body), replayed, jsonObservedAt: 100 })),
      removalAttempts: [{ key: first.storageKey, at: 101 }],
      restored: { removeItem: true, probe: true, fetch: true },
      afterSuccess: { formClosed: true, entries: [], visibleInvoiceCount: 1, references: ["SINV-1"] } },
  };
}
test("accepts complete cleanup-success evidence", () => {
  const { proxy, browser } = fixture();
  checkInvoiceCleanup(proxy, browser);
});
const mutations = {
  "lost response": (p) => { p.events[0].dropped = true; },
  "not a replay": (p) => { p.events[1].replayed = false; },
  "new key": (p) => { p.events[1].key = "new"; },
  "changed payload": (p) => { p.events[1].body = {}; },
  "duplicate invoice": (p) => { p.finalCounts = { invoices: 2, receipts: 1 }; },
  "duplicate receipt": (p) => { p.finalReceipts = [...p.finalReceipts, {}]; },
  "extra journal": (p) => { p.finalJournals = [{ id: 1 }, { id: 2 }]; },
  "premature close": (_, b) => { b.afterCleanupFailure.formOpen = false; },
  "generic error": (_, b) => { b.afterCleanupFailure.message = "Error"; },
  "changed form": (_, b) => { b.beforeRetry.fields = {}; },
  "early cleanup": (_, b) => { b.removalAttempts[0].at = 99; },
  "wrong fault key": (_, b) => { b.removalAttempts[0].key = "unrelated"; },
  "unreadable JSON": (_, b) => { b.responses[0].body = null; },
  "method not restored": (_, b) => { b.restored.removeItem = false; },
  "storage probe failed": (_, b) => { b.restored.probe = false; },
  "key not cleared": (_, b) => { b.afterSuccess.entries = [{}]; },
  "duplicate visible row": (_, b) => { b.afterSuccess.visibleInvoiceCount = 2; },
};
for (const [name, mutate] of Object.entries(mutations)) {
  test(`rejects ${name}`, () => {
    const { proxy, browser } = fixture();
    mutate(proxy, browser);
    assert.throws(() => checkInvoiceCleanup(proxy, browser));
  });
}
