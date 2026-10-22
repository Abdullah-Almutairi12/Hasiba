import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { checkReloadedReturnCleanup } from "./check-browser-reloaded-return-cleanup.mjs";

function fixture() {
  const f = { id: 7, reference: "SINV-7", productId: 2, description: "Synthetic return item",
    lineId: 3, issueMoveId: 4, warehouseId: 5, soldQuantity: 2, returnQuantity: 1, unitCost: 50 };
  const body = { customerId: 1, invoiceId: f.id, reason: "Reload cleanup return", restock: true,
    lines: [{ productId: 2, description: f.description, quantity: 1, unitPrice: 100, taxRate: 0, invoiceLineId: 3 }] };
  const requestBody = JSON.stringify(body);
  const hash = (s) => createHash("sha256").update(s).digest("hex");
  const storageKey = `hasba:financial-request:${hash(`/api/sales/credit-notes\n${requestBody}`)}`;
  const receipts = [{ companyId: 1, userId: 1, operation: "POST:1:/sales/credit-notes",
    key: "intent", creditNoteId: "8" }];
  const returnState = { notes: [{ id: 8, reference: "CN-8", invoiceId: 7, journalEntryId: 9, status: "issued" }],
    moves: [{ id: 10, productId: 2, noteId: 8, invoiceLineId: 3, originalMoveId: 4,
      warehouseId: 5, quantity: 1, unitCost: 50, state: "done" }],
    stock: 1, quants: [{ warehouseId: 5, quantity: 1, avgCost: 50 }] };
  const first = { upstreamStatus: 201, dropped: false, replayed: false, replayHeader: null,
    creditNoteId: 8, reference: "CN-8", key: "intent", storageKey, bodyHash: hash(requestBody),
    body, receipts, counts: { invoices: 1, creditNotes: 1, receipts: 1 }, returnState, recordedAt: 10000 };
  // Distinct clocks: a guard must not "correct" browser time to proxy time.
  const proxy = { runId: "run", scenario: "identical-return", returnFixture: f,
    initialCounts: { invoices: 1, creditNotes: 0, receipts: 0 },
    initialReturnState: { notes: [], moves: [], stock: 0, quants: [{ warehouseId: 5, quantity: 0, avgCost: 0 }] },
    returnPostCount: 2, invoicePostCount: 0, receiptPostCount: 0,
    events: [first, { ...structuredClone(first), replayed: true, replayHeader: "true", recordedAt: 11000 }],
    finalReceipts: receipts, finalReturnState: returnState, receiptsObservedAt: 12000 };
  const beforeRetryProxy = { ...structuredClone(proxy), returnPostCount: 1,
    events: [structuredClone(first)], receiptsObservedAt: 10500 };
  const entries = [[storageKey, "intent"]];
  const fields = { customerName: "Synthetic customer", invoiceReference: f.reference,
    reason: body.reason, restock: true, description: f.description, quantity: "1", unitPrice: "100", taxRate: "0" };
  const browser = { runId: "run", customerId: 1, customerName: fields.customerName,
    faultMethod: "removeItem", faultName: "SecurityError", unrelatedStorageWorked: true,
    beforeSave: { formOpen: true, fields, entries: [], observedAt: 100, timeOrigin: 50 },
    afterCleanupFailure: { formOpen: true, fields, entries, observedAt: 120, timeOrigin: 50,
      message: "تم حفظ العملية بالفعل، لكن تعذر تنظيف مفتاحها" },
    afterReload: { formClosed: true, entries, navigationType: "reload", returnPostCount: 0,
      observedAt: 210, timeOrigin: 200, observerInstalledBeforeApp: true, readyStateAtInstall: "loading",
      observerTimeOrigin: 200, observerInstalledAt: 201 },
    beforeRetry: { formOpen: true, fields, entries, returnPostCount: 0, observerInstalledBeforeApp: true,
      observedAt: 220, timeOrigin: 200 },
    afterSuccess: { formClosed: true, entries: [], returnPostCount: 1, visibleCreditNoteCount: 1,
      references: ["CN-8"], observedAt: 240, timeOrigin: 200 },
    restoredBeforeReload: { removeItem: true, fetch: true, probe: true },
    restoredAfterReload: { fetch: true, probe: true, removeItemProbe: true },
    responses: [false, true].map((replayed, i) => ({ status: 201, body: { id: 8, reference: "CN-8" },
      key: "intent", requestBody, replayed, jsonObservedAt: i ? 230 : 110 })),
    removalAttempts: [{ key: storageKey, at: 115 }] };
  return structuredClone({ proxy, browser, beforeRetryProxy });
}

test("accepts parsed-success reload recovery with independent clocks", () => {
  const { proxy, browser, beforeRetryProxy } = fixture();
  checkReloadedReturnCleanup(proxy, browser, beforeRetryProxy);
});
const mutations = {
  "stale run": (p, b) => { b.runId = "old"; },
  "wrong scenario": (p) => { p.scenario = "invoice"; },
  "extra return POST": (p) => { p.returnPostCount++; },
  "invoice POST": (p) => { p.invoicePostCount++; },
  "receipt POST": (p) => { p.receiptPostCount++; },
  "missing replay event": (p) => { p.events.pop(); },
  "preexisting credit note": (p) => { p.initialCounts.creditNotes++; },
  "preexisting movement": (p) => { p.initialReturnState.moves.push({}); },
  "missing customer identity": (p, b) => { delete b.customerId; },
  "mismatched invoice": (p) => { p.events[0].body.invoiceId++; },
  "unlinked line": (p) => { p.events[0].body.lines[0].invoiceLineId = null; },
  "changed quantity": (p) => { p.events[0].body.lines[0].quantity = 2; },
  "wrong tax": (p) => { p.events[0].body.lines[0].taxRate = 15; },
  "wrong fingerprint": (p) => { p.events[0].storageKey = "other"; },
  "wrong hash": (p) => { p.events[0].bodyHash = "other"; },
  "changed retry bytes": (p, b) => { b.responses[1].requestBody += " "; },
  "unparsed success": (p, b) => { b.responses[0].body = null; },
  "unobserved JSON": (p, b) => { delete b.responses[0].jsonObservedAt; },
  "lost success": (p) => { p.events[0].dropped = true; },
  "wrong HTTP status": (p) => { p.events[0].upstreamStatus = 200; },
  "not replay": (p) => { p.events[1].replayed = false; },
  "missing replay header": (p) => { p.events[1].replayHeader = null; },
  "new key": (p) => { p.events[1].key = "new"; },
  "new credit note": (p) => { p.events[1].creditNoteId++; },
  "new journal": (p) => { p.events[1].returnState.notes[0].journalEntryId++; },
  "extra movement": (p) => { p.events[1].returnState.moves.push({}); },
  "restocked twice": (p) => { p.events[1].returnState.stock = 2; },
  "wrong historical cost": (p) => { p.events[0].returnState.moves[0].unitCost = 100; },
  "wrong source issue": (p) => { p.events[0].returnState.moves[0].originalMoveId++; },
  "changed warehouse": (p) => { p.events[0].returnState.moves[0].warehouseId++; },
  "wrong receipt tenant": (p) => { p.events[0].receipts[0].companyId = null; },
  "wrong receipt user": (p) => { p.events[0].receipts[0].userId = null; },
  "wrong receipt operation": (p) => { p.events[0].receipts[0].operation = "POST:1:/sales/invoices"; },
  "unlinked receipt": (p) => { p.events[0].receipts[0].creditNoteId = "99"; },
  "cleanup before JSON": (p, b) => { b.removalAttempts[0].at = 109; },
  "repeated cleanup failure": (p, b) => { b.removalAttempts.push(b.removalAttempts[0]); },
  "wrong blocked key": (p, b) => { b.removalAttempts[0].key = "other"; },
  "read fault": (p, b) => { b.faultMethod = "getItem"; },
  "wrong exception": (p, b) => { b.faultName = "Error"; },
  "unrelated storage blocked": (p, b) => { b.unrelatedStorageWorked = false; },
  "generic failure message": (p, b) => { b.afterCleanupFailure.message = "Error"; },
  "closed failed form": (p, b) => { b.afterCleanupFailure.formOpen = false; },
  "changed rendered reason": (p, b) => { b.beforeRetry.fields.reason = "Other"; },
  "changed rendered restock": (p, b) => { b.beforeSave.fields.restock = false; },
  "key seeded before save": (p, b) => { b.beforeSave.entries.push(["x", "y"]); },
  "same document": (p, b) => { b.afterReload.timeOrigin = 50; },
  "not real reload": (p, b) => { b.afterReload.navigationType = "navigate"; },
  "form open after reload": (p, b) => { b.afterReload.formClosed = false; },
  "lost persisted key": (p, b) => { b.afterReload.entries = []; },
  "replacement key": (p, b) => { b.beforeRetry.entries[0][1] = "replacement"; },
  "auto POST on reload": (p, b) => { b.afterReload.returnPostCount = 1; },
  "auto POST on refill": (p, b) => { b.beforeRetry.returnPostCount = 1; },
  "late observer": (p, b) => { b.afterReload.readyStateAtInstall = "complete"; },
  "missing start observer": (p, b) => { b.afterReload.observerInstalledBeforeApp = false; },
  "missing refill observer": (p, b) => { b.beforeRetry.observerInstalledBeforeApp = false; },
  "old observer": (p, b) => { b.afterReload.observerTimeOrigin = 50; },
  "missing observer timestamp": (p, b) => { delete b.afterReload.observerInstalledAt; },
  "extra reload before retry": (p, b) => { b.beforeRetry.timeOrigin++; },
  "missing timestamp": (p, b) => { delete b.beforeRetry.observedAt; },
  "key not cleared": (p, b) => { b.afterSuccess.entries = [["x", "y"]]; },
  "form not closed": (p, b) => { b.afterSuccess.formClosed = false; },
  "two visible notes": (p, b) => { b.afterSuccess.visibleCreditNoteCount = 2; },
  "wrong visible reference": (p, b) => { b.afterSuccess.references = ["CN-other"]; },
  "two confirmation POSTs": (p, b) => { b.afterSuccess.returnPostCount = 2; },
  "remove not restored": (p, b) => { b.restoredBeforeReload.removeItem = false; },
  "first fetch not restored": (p, b) => { b.restoredBeforeReload.fetch = false; },
  "first probe failed": (p, b) => { b.restoredBeforeReload.probe = false; },
  "second fetch not restored": (p, b) => { b.restoredAfterReload.fetch = false; },
  "second remove probe failed": (p, b) => { b.restoredAfterReload.removeItemProbe = false; },
  "stale pre-confirmation capture": (p, b, c) => { c.runId = "old"; },
  "late pre-confirmation capture": (p, b, c) => { c.receiptsObservedAt = 11001; },
  "early pre-confirmation capture": (p, b, c) => { c.receiptsObservedAt = 9999; },
  "extra ingress before confirmation": (p, b, c) => { c.returnPostCount = 2; },
  "extra event before confirmation": (p, b, c) => { c.events.push({}); },
  "changed journal before confirmation": (p, b, c) => { c.finalReturnState.notes[0].journalEntryId++; },
  "extra stock before confirmation": (p, b, c) => { c.finalReturnState.stock++; },
  "extra receipt before confirmation": (p, b, c) => { c.finalReceipts.push({}); },
  "final extra movement": (p) => { p.finalReturnState.moves.push({}); },
  "final extra receipt": (p) => { p.finalReceipts.push({}); },
  "stale final snapshot": (p) => { p.receiptsObservedAt = 10999; },
};
for (const [name, mutate] of Object.entries(mutations)) {
  test(`rejects ${name}`, () => {
    const { proxy, browser, beforeRetryProxy } = fixture();
    mutate(proxy, browser, beforeRetryProxy);
    assert.throws(() => checkReloadedReturnCleanup(proxy, browser, beforeRetryProxy));
  });
}
