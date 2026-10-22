import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { checkReloadedInvoiceCleanup } from "./check-browser-reloaded-invoice-cleanup.mjs";

function fixture() {
  const body = { customerId: 1, notes: "Reload cleanup invoice",
    lines: [{ productId: 2, description: "منتج اختبار", quantity: 1, unitPrice: 100, discountPct: 0, taxRate: 15 }] };
  const requestBody = JSON.stringify(body);
  const hash = (s) => createHash("sha256").update(s).digest("hex");
  const storageKey = `hasba:financial-request:${hash(`/api/sales/invoices\n${requestBody}`)}`;
  const counts = { invoices: 1, receipts: 1 };
  const journals = [{ id: 1 }];
  const receipts = [{ companyId: 1, userId: 1, operation: "POST:1:/sales/invoices", key: "intent", invoiceId: "1" }];
  const initialInvoiceState = { invoices: [], products: [{ id: 2, stock: 20 }], moves: [], quants: [] };
  const invoiceState = { ...initialInvoiceState, invoices: [{ id: 1, reference: "SINV-1", customerId: 1, total: 115 }] };
  const first = { upstreamStatus: 201, dropped: false, replayed: false, replayHeader: null,
    invoiceId: 1, reference: "SINV-1", key: "intent", storageKey, bodyHash: hash(requestBody),
    body, journals, receipts, counts, invoiceState, recordedAt: 10000 };
  const entries = [{ storageKey, key: "intent" }];
  const fields = { customerName: "Customer", description: "منتج اختبار", quantity: "1", unitPrice: "100",
    discountPct: "0", taxRate: "15", notes: body.notes };
  // Deliberately unrelated browser/server wall-clock domains.
  const proxy = { runId: "run", initialCounts: { invoices: 0, receipts: 0 },
    initialJournals: [], initialInvoiceState, invoicePostCount: 2,
    events: [first, { ...structuredClone(first), replayed: true, replayHeader: "true", recordedAt: 11000 }],
    finalCounts: counts, finalJournals: journals, finalReceipts: receipts, finalInvoiceState: invoiceState,
    receiptsObservedAt: 12000 };
  const beforeRetryProxy = { ...structuredClone(proxy), invoicePostCount: 1,
    events: [structuredClone(first)], receiptsObservedAt: 10500 };
  const restored = { removeItem: true, probe: true, fetch: true };
  const browser = { runId: "run", customerId: 1, customerName: "Customer",
    faultMethod: "removeItem", faultName: "SecurityError",
    beforeSave: { fields, observedAt: 100, timeOrigin: 50 },
    afterCleanupFailure: { formOpen: true, fields, entries, observedAt: 120, timeOrigin: 50,
      message: "تم حفظ العملية بالفعل، لكن تعذر تنظيف مفتاحها" },
    afterReload: { formClosed: true, entries, navigationType: "reload", invoicePostCount: 0,
      observedAt: 210, timeOrigin: 200, observerInstalledBeforeApp: true, readyStateAtInstall: "loading",
      observerTimeOrigin: 200, observerInstalledAt: 201 },
    beforeRetry: { formOpen: true, fields, entries, invoicePostCount: 0, observerInstalledBeforeApp: true,
      observedAt: 220, timeOrigin: 200 },
    afterSuccess: { formClosed: true, entries: [], invoicePostCount: 1, visibleInvoiceCount: 1,
      references: ["SINV-1"], observedAt: 240, timeOrigin: 200 },
    restoredBeforeReload: restored, restored,
    restoredAfterReload: { fetch: true, probe: true, removeItemProbe: true },
    responses: [false, true].map((replayed, i) => ({ status: 201, body: { id: 1, reference: "SINV-1" },
      key: "intent", requestBody, replayed, jsonObservedAt: i ? 230 : 110 })),
    removalAttempts: [{ key: storageKey, at: 115 }] };
  return structuredClone({ proxy, browser, beforeRetryProxy });
}

test("accepts real reload recovery with independent clocks", () => {
  const { proxy, browser, beforeRetryProxy } = fixture();
  checkReloadedInvoiceCleanup(proxy, browser, beforeRetryProxy);
});
const mutations = {
  "mismatched run": (p, b) => { b.runId = "stale"; },
  "lost success response": (p) => { p.events[0].dropped = true; },
  "unparsed response": (p, b) => { b.responses[0].body = null; },
  "cleanup before JSON": (p, b) => { b.removalAttempts[0].at = 109; },
  "wrong removal key": (p, b) => { b.removalAttempts[0].key = "other"; },
  "read fault instead": (p, b) => { b.faultMethod = "getItem"; },
  "wrong exception": (p, b) => { b.faultName = "Error"; },
  "generic save error": (p, b) => { b.afterCleanupFailure.message = "Failed"; },
  "closed failed form": (p, b) => { b.afterCleanupFailure.formOpen = false; },
  "same document": (p, b) => { b.afterReload.timeOrigin = 50; },
  "not reload navigation": (p, b) => { b.afterReload.navigationType = "navigate"; },
  "lost key on reload": (p, b) => { b.afterReload.entries = []; },
  "changed key on reload": (p, b) => { b.afterReload.entries[0].key = "replacement"; },
  "automatic POST on reload": (p, b) => { b.afterReload.invoicePostCount = 1; },
  "automatic POST on open": (p, b) => { b.beforeRetry.invoicePostCount = 1; },
  "observer installed too late": (p, b) => { b.beforeRetry.observerInstalledBeforeApp = false; },
  "observer absent on reload": (p, b) => { b.afterReload.observerInstalledBeforeApp = false; },
  "observer after load": (p, b) => { b.afterReload.readyStateAtInstall = "complete"; },
  "observer from old document": (p, b) => { b.afterReload.observerTimeOrigin = 50; },
  "missing observer install time": (p, b) => { delete b.afterReload.observerInstalledAt; },
  "closed refilled form": (p, b) => { b.beforeRetry.formOpen = false; },
  "changed quantity": (p, b) => { b.beforeRetry.fields.quantity = "2"; },
  "changed note": (p, b) => { b.beforeRetry.fields.notes = "Other"; },
  "synthetic fields instead of payload": (p, b) => { b.beforeSave.fields.quantity = "2"; },
  "missing quantity": (p, b) => { delete b.beforeSave.fields.quantity; },
  "changed retry bytes": (p, b) => { b.responses[1].requestBody += " "; },
  "wrong fingerprint": (p) => { p.events.forEach((e) => { e.storageKey = "wrong"; }); },
  "not a replay": (p) => { p.events[1].replayed = false; },
  "missing replay header": (p) => { p.events[1].replayHeader = null; },
  "new document identity": (p) => { p.events[1].invoiceId = 2; },
  "new key": (p) => { p.events[1].key = "new"; },
  "missing pre-confirmation capture": (p, b, c) => { c.runId = "old"; },
  "extra ingress before confirmation": (p, b, c) => { c.invoicePostCount = 2; },
  "extra pre-confirmation event": (p, b, c) => { c.events.push(c.events[0]); },
  "pre-confirmation duplicate invoice": (p, b, c) => { c.finalCounts.invoices = 2; },
  "pre-confirmation extra receipt": (p, b, c) => { c.finalReceipts.push({}); },
  "pre-confirmation journal changed": (p, b, c) => { c.finalJournals[0].id = 2; },
  "late pre-confirmation capture": (p, b, c) => { c.receiptsObservedAt = 11001; },
  "stale pre-confirmation capture": (p, b, c) => { c.receiptsObservedAt = 9999; },
  "stale final capture": (p) => { p.receiptsObservedAt = 10999; },
  "changed stock": (p) => { p.events[0].invoiceState.products[0].stock = 19; },
  "changed invoice after retry": (p) => { p.events[1].invoiceState.invoices[0].total = 230; },
  "final duplicate invoice": (p) => { p.finalCounts.invoices = 2; },
  "final duplicate receipt": (p) => { p.finalReceipts.push({}); },
  "multiple recovery POSTs": (p, b) => { b.afterSuccess.invoicePostCount = 2; },
  "pending key retained": (p, b) => { b.afterSuccess.entries = [{}]; },
  "form still open": (p, b) => { b.afterSuccess.formClosed = false; },
  "two visible rows": (p, b) => { b.afterSuccess.visibleInvoiceCount = 2; },
  "wrong row": (p, b) => { b.afterSuccess.references = ["SINV-2"]; },
  "removeItem not restored before reload": (p, b) => { b.restoredBeforeReload.removeItem = false; },
  "fetch not restored after reload": (p, b) => { b.restored.fetch = false; },
  "new document fetch still replaced": (p, b) => { b.restoredAfterReload.fetch = false; },
  "storage probe fails": (p, b) => { b.restored.probe = false; },
};
for (const [name, mutate] of Object.entries(mutations)) {
  test(`rejects ${name}`, () => {
    const { proxy, browser, beforeRetryProxy } = fixture();
    mutate(proxy, browser, beforeRetryProxy);
    assert.throws(() => checkReloadedInvoiceCleanup(proxy, browser, beforeRetryProxy));
  });
}
