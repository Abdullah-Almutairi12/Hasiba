import { test } from "node:test";
import assert from "node:assert/strict";
import { checkCleanupIdenticalInvoice } from "./check-browser-cleanup-identical-invoice.mjs";
import { checkInvoiceCleanup } from "./check-browser-invoice-cleanup-success.mjs";

function fixture() {
  const body = { customerId: 1, lines: [{ description: "Test", quantity: 1, unitPrice: 100 }] };
  const receipt = { key: "first", invoiceId: "1", companyId: 1, userId: 1, operation: "invoice" };
  const first = { upstreamStatus: 201, dropped: false, replayed: false, replayHeader: null,
    invoiceId: 1, reference: "SINV-1", key: "first", storageKey: "hasba:financial-request:digest",
    bodyHash: "digest", body, journals: [{ id: 1 }], receipts: [receipt],
    counts: { invoices: 1, receipts: 1 }, recordedAt: 100 };
  const second = { ...first, key: "second", invoiceId: 2, reference: "SINV-2", recordedAt: 300,
    counts: { invoices: 2, receipts: 2 }, journals: [{ id: 1 }, { id: 2 }],
    receipts: [receipt, { ...receipt, key: "second", invoiceId: "2" }] };
  const fields = { customer: "Test", description: "Test", quantity: "1", price: "100" };
  const entries = [{ storageKey: first.storageKey, key: first.key }];
  return structuredClone({
    proxy: { runId: "run", initialCounts: { invoices: 0, receipts: 0 }, initialJournals: [],
      invoicePostCount: 3, events: [first, { ...first, replayed: true, replayHeader: "true", recordedAt: 200 }, second],
      finalCounts: second.counts, finalJournals: second.journals, finalReceipts: second.receipts, receiptsObservedAt: 320 },
    browser: { runId: "run", beforeSave: { fields },
      afterCleanupFailure: { formOpen: true, fields, entries, message: "تم حفظ العملية بالفعل، لكن تعذر تنظيف مفتاحها" },
      beforeRetry: { fields, entries }, removalAttempts: [{ key: first.storageKey, at: 102 }],
      responses: [first, { ...first, replayed: true, recordedAt: 200 }, second].map((e) => ({
        status: 201, body: { id: e.invoiceId, reference: e.reference }, key: e.key,
        requestBody: JSON.stringify(body), replayed: e.replayed, jsonObservedAt: e.recordedAt + 1 })),
      restored: { removeItem: true, probe: true, fetch: true },
      afterSuccess: { formClosed: true, entries: [], visibleInvoiceCount: 1, references: ["SINV-1"], observedAt: 210, timeOrigin: 1 },
      afterNewForm: { formOpen: true, fields, entries: [], observedAt: 220, timeOrigin: 1 },
      afterSecondSuccess: { formClosed: true, entries: [], visibleInvoiceCount: 2,
        references: ["SINV-2", "SINV-1"], observedAt: 310, timeOrigin: 1 } },
  });
}

test("accepts cleanup failure, confirmed replay, then a deliberately new identical form", () => {
  const { proxy, browser } = fixture();
  checkCleanupIdenticalInvoice(proxy, browser);
});
test("the original cleanup guard still rejects three requests", () => {
  const { proxy, browser } = fixture();
  assert.throws(() => checkInvoiceCleanup(proxy, browser));
});
test("accepts independent browser and API clocks without normalizing evidence", () => {
  const { proxy, browser } = fixture();
  for (const event of proxy.events) event.recordedAt += 5000;
  proxy.receiptsObservedAt += 5000;
  checkCleanupIdenticalInvoice(proxy, browser);
});
test("uses raw timestamps rather than an adjusted capture timestamp", () => {
  const { proxy, browser } = fixture();
  for (const response of browser.responses) {
    response.rawJsonObservedAt = response.jsonObservedAt;
    response.jsonObservedAt += 5000;
  }
  browser.removalAttempts[0].rawAt = browser.removalAttempts[0].at;
  browser.removalAttempts[0].at += 5000;
  checkCleanupIdenticalInvoice(proxy, browser);
  browser.removalAttempts[0].rawAt = 99;
  assert.throws(() => checkCleanupIdenticalInvoice(proxy, browser));
});
const mutations = {
  "missing request": (p) => { p.events.pop(); },
  "extra request arrival": (p) => { p.invoicePostCount = 4; },
  "missing browser response": (_, b) => { b.responses.pop(); },
  "stale run": (_, b) => { b.runId = "old"; },
  "lost first response": (p) => { p.events[0].dropped = true; },
  "cleanup before parsed success": (_, b) => { b.removalAttempts[0].at = 99; },
  "failure dialog closed": (_, b) => { b.afterCleanupFailure.formOpen = false; },
  "changed retry fields": (_, b) => { b.beforeRetry.fields = {}; },
  "missing restored method": (_, b) => { b.restored.removeItem = false; },
  "missing recovery replay": (p) => { p.events[1].replayed = false; },
  "old key reused": (p) => { p.events[2].key = "first"; },
  "old invoice returned": (p) => { p.events[2].invoiceId = 1; },
  "old reference": (p) => { p.events[2].reference = "SINV-1"; },
  "new response replayed": (p) => { p.events[2].replayed = true; },
  "false replay header": (p) => { p.events[2].replayHeader = "false"; },
  "new response dropped": (p) => { p.events[2].dropped = true; },
  "changed body": (p) => { p.events[2].body = {}; },
  "changed digest": (p) => { p.events[2].bodyHash = "other"; },
  "changed slot": (p) => { p.events[2].storageKey = "other"; },
  "browser old key": (_, b) => { b.responses[2].key = "first"; },
  "browser old document": (_, b) => { b.responses[2].body.id = 1; },
  "browser changed body": (_, b) => { b.responses[2].requestBody = "{}"; },
  "second form not opened": (_, b) => { b.afterNewForm.formOpen = false; },
  "different rendered fields": (_, b) => { b.afterNewForm.fields = {}; },
  "form reopened before confirmation": (_, b) => { b.afterNewForm.observedAt = 205; },
  "form captured after new save": (_, b) => { b.afterNewForm.observedAt = 305; },
  "different document": (_, b) => { b.afterNewForm.timeOrigin = 2; },
  "pending key on new form": (_, b) => { b.afterNewForm.entries = [{}]; },
  "second dialog not closed": (_, b) => { b.afterSecondSuccess.formClosed = false; },
  "second key not cleared": (_, b) => { b.afterSecondSuccess.entries = [{}]; },
  "stale list": (_, b) => { b.afterSecondSuccess.visibleInvoiceCount = 1; },
  "duplicate row": (_, b) => { b.afterSecondSuccess.references = ["SINV-1", "SINV-1"]; },
  "stale DB counts": (p) => { p.finalCounts.invoices = 1; },
  "stale DB receipts": (p) => { p.finalReceipts.pop(); },
  "wrong receipt link": (p) => { p.events[2].receipts[1].invoiceId = "1"; },
  "wrong receipt tenant": (p) => { p.events[2].receipts[1].companyId = 2; },
  "original receipt changed": (p) => { p.events[2].receipts[0].invoiceId = "2"; },
  "duplicate journal": (p) => { p.events[2].journals[1].id = 1; },
  "stale DB journals": (p) => { p.finalJournals.pop(); },
  "stale capture": (p) => { p.receiptsObservedAt = 299; },
};
for (const [name, mutate] of Object.entries(mutations)) {
  test(`rejects ${name}`, () => {
    const { proxy, browser } = fixture();
    mutate(proxy, browser);
    assert.throws(() => checkCleanupIdenticalInvoice(proxy, browser));
  });
}
