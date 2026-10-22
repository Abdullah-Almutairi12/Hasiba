import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { checkRepeatedReturnCleanup } from "./check-browser-repeated-return-cleanup.mjs";

function fixture(failureCount = 3) {
  const f = { id: 7, reference: "SINV-7", productId: 2, description: "Synthetic return item",
    lineId: 3, issueMoveId: 4, warehouseId: 5, soldQuantity: 2, returnQuantity: 1, unitCost: 50 };
  const body = { customerId: 1, invoiceId: 7, reason: "Repeated cleanup return", restock: true,
    lines: [{ productId: 2, description: f.description, quantity: 1, unitPrice: 100, taxRate: 0, invoiceLineId: 3 }] };
  const requestBody = JSON.stringify(body);
  const hash = (s) => createHash("sha256").update(s).digest("hex");
  const storageKey = `hasba:financial-request:${hash(`/api/sales/credit-notes\n${requestBody}`)}`;
  const receipts = [{ companyId: 1, userId: 1, operation: "POST:/api:/sales/credit-notes",
    key: "intent", creditNoteId: "8" }];
  const returnState = { notes: [{ id: 8, reference: "CN-8", invoiceId: 7, journalEntryId: 9, status: "issued" }],
    moves: [{ id: 10, productId: 2, noteId: 8, invoiceLineId: 3, originalMoveId: 4,
      warehouseId: 5, quantity: 1, unitCost: 50, state: "done" }],
    stock: 1, quants: [{ warehouseId: 5, quantity: 1, avgCost: 50 }] };
  const first = { upstreamStatus: 201, dropped: false, replayed: false, replayHeader: null,
    creditNoteId: 8, reference: "CN-8", key: "intent", storageKey, bodyHash: hash(requestBody),
    body, receipts, counts: { invoices: 1, creditNotes: 1, receipts: 1 }, returnState, recordedAt: 10000,
    responseBody: { id: 8, reference: "CN-8", companyId: 1, createdBy: 1, invoiceId: 7, journalEntryId: 9 } };
  const proxy = { runId: "run", scenario: "identical-return", returnFixture: f,
    initialCounts: { invoices: 1, creditNotes: 0, receipts: 0 },
    initialReturnState: { notes: [], moves: [], stock: 0, quants: [{ warehouseId: 5, quantity: 0, avgCost: 0 }] },
    returnPostCount: failureCount + 1, invoicePostCount: 0, receiptPostCount: 0,
    events: Array.from({ length: failureCount + 1 }, (_, i) => ({
      ...structuredClone(first), replayed: i > 0, replayHeader: i ? "true" : null, recordedAt: 10000 + i * 1000 })),
    finalReceipts: receipts, finalReturnState: returnState, finalJournals: [{ id: 9 }],
    receiptsObservedAt: 20000 };
  const fields = { customerName: "Synthetic customer", invoiceReference: f.reference,
    reason: body.reason, restock: true, description: f.description, quantity: "1", unitPrice: "100", taxRate: "0" };
  const message = "تم حفظ العملية بالفعل، لكن تعذر تنظيف مفتاحها من تخزين الجلسة. فعّل التخزين ثم أعد المحاولة بنفس البيانات لتأكيد النتيجة دون إنشاء عملية مكررة. لا تبدأ عملية جديدة بهذه البيانات قبل اكتمال التأكيد.";
  const entries = [[storageKey, "intent"]];
  const browser = { runId: "run", customerId: 1, customerName: fields.customerName,
    faultMethod: "removeItem", faultName: "SecurityError", unrelatedStorageWorked: true,
    beforeSave: { formOpen: true, fields, entries: [], observedAt: 100, timeOrigin: 50, returnPostCount: 0 },
    afterFailures: Array.from({ length: failureCount }, (_, i) => ({
      formOpen: true, fields: structuredClone(fields), entries: structuredClone(entries),
      message, observedAt: 120 + i * 20, timeOrigin: 50, returnPostCount: i + 1 })),
    beforeRecovery: { formOpen: true, fields: structuredClone(fields), entries: structuredClone(entries),
      message, observedAt: 120 + failureCount * 20, timeOrigin: 50, returnPostCount: failureCount },
    afterSuccess: { formClosed: true, entries: [], returnPostCount: failureCount + 1,
      visibleCreditNoteCount: 1, references: ["CN-8"], cleanupMessageVisible: false,
      observedAt: 150 + failureCount * 20, timeOrigin: 50 },
    storageRestored: { removeItem: true, probe: true },
    restored: { fetch: true, removeItem: true, probe: true },
    responses: Array.from({ length: failureCount + 1 }, (_, i) => ({
      status: 201, body: structuredClone(first.responseBody), key: "intent", requestBody,
      replayed: i > 0, jsonObservedAt: i === failureCount ? 130 + i * 20 : 110 + i * 20 })),
    removalAttempts: Array.from({ length: failureCount }, (_, i) => ({ key: storageKey, at: 115 + i * 20 })) };
  return structuredClone({ proxy, browser });
}

for (const n of [3, 4, 5]) {
  test(`accepts ${n} consecutive cleanup failures with independent clocks`, () => {
    const { proxy, browser } = fixture(n);
    checkRepeatedReturnCleanup(proxy, browser);
  });
}
test("accepts an expired toast after storage restoration, never during a faulted save", () => {
  const { proxy, browser } = fixture();
  browser.beforeRecovery.message = null;
  checkRepeatedReturnCleanup(proxy, browser);
});
const mutations = {
  "stale run": (p, b) => { b.runId = "old"; },
  "wrong scenario": (p) => { p.scenario = "invoice"; },
  "invoice submitted": (p) => { p.invoicePostCount++; },
  "receipt submitted": (p) => { p.receiptPostCount++; },
  "unobserved ingress": (p) => { p.returnPostCount++; },
  "missing event": (p) => { p.events.pop(); },
  "missing response": (p, b) => { b.responses.pop(); },
  "only one confirmation under fault": (p, b) => { b.afterFailures.pop(); },
  "missing cleanup attempt": (p, b) => { b.removalAttempts.pop(); },
  "extra cleanup attempt": (p, b) => { b.removalAttempts.push(b.removalAttempts[0]); },
  "preexisting note": (p) => { p.initialCounts.creditNotes++; },
  "preexisting return movement": (p) => { p.initialReturnState.moves.push({}); },
  "preexisting stock": (p) => { p.initialReturnState.stock = 1; },
  "missing customer": (p, b) => { b.customerId = null; },
  "wrong source invoice": (p) => { p.events[0].body.invoiceId++; },
  "unlinked sale line": (p) => { p.events[0].body.lines[0].invoiceLineId = null; },
  "wrong quantity": (p) => { p.events[0].body.lines[0].quantity = 2; },
  "tax charged": (p) => { p.events[0].body.lines[0].taxRate = 15; },
  "restock disabled": (p) => { p.events[0].body.restock = false; },
  "wrong digest": (p) => { p.events[0].bodyHash = "bad"; },
  "wrong storage fingerprint": (p) => { p.events[0].storageKey = "other"; },
  "lost response": (p) => { p.events[0].dropped = true; },
  "unknown server status": (p) => { p.events[1].upstreamStatus = 502; },
  "first already replayed": (p) => { p.events[0].replayed = true; },
  "first replay header": (p) => { p.events[0].replayHeader = "true"; },
  "second not replayed": (p) => { p.events[1].replayed = false; },
  "third missing replay header": (p) => { p.events[2].replayHeader = null; },
  "new intermediate key": (p) => { p.events[2].key = "new"; },
  "new intermediate note": (p) => { p.events[2].creditNoteId++; },
  "new intermediate journal": (p) => { p.events[2].returnState.notes[0].journalEntryId++; },
  "extra intermediate receipt": (p) => { p.events[1].receipts.push({}); },
  "extra intermediate movement": (p) => { p.events[2].returnState.moves.push({}); },
  "intermediate stock doubled": (p) => { p.events[1].returnState.stock = 2; },
  "intermediate warehouse doubled": (p) => { p.events[2].returnState.quants[0].quantity = 2; },
  "wrong receipt tenant": (p) => { p.events[0].receipts[0].companyId = null; },
  "wrong receipt user": (p) => { p.events[0].receipts[0].userId = null; },
  "wrong receipt operation": (p) => { p.events[0].receipts[0].operation = "POST:1:/sales/receipts"; },
  "wrong operation namespace": (p) => { p.events[0].receipts[0].operation = "POST:/other:/sales/credit-notes"; },
  "receipt tenant differs from saved note": (p) => { p.events[0].receipts[0].companyId = 2; },
  "receipt user differs from creator": (p) => { p.events[0].receipts[0].userId = 2; },
  "response journal differs from linked journal": (p) => { p.events[0].responseBody.journalEntryId++; },
  "response invoice differs from fixture": (p) => { p.events[0].responseBody.invoiceId++; },
  "wrong receipt key": (p) => { p.events[0].receipts[0].key = "other"; },
  "wrong receipt document": (p) => { p.events[0].receipts[0].creditNoteId = "99"; },
  "wrong historical cost": (p) => { p.events[0].returnState.moves[0].unitCost = 100; },
  "wrong original issue": (p) => { p.events[0].returnState.moves[0].originalMoveId++; },
  "wrong warehouse": (p) => { p.events[0].returnState.moves[0].warehouseId++; },
  "draft note": (p) => { p.events[0].returnState.notes[0].status = "draft"; },
  "missing journal": (p) => { p.events[0].returnState.notes[0].journalEntryId = null; },
  "different exception": (p, b) => { b.faultName = "Error"; },
  "read fault instead": (p, b) => { b.faultMethod = "getItem"; },
  "unrelated storage broken": (p, b) => { b.unrelatedStorageWorked = false; },
  "seeded initial key": (p, b) => { b.beforeSave.entries.push(["key", "value"]); },
  "automatic initial POST": (p, b) => { b.beforeSave.returnPostCount = 1; },
  "changed retry bytes": (p, b) => { b.responses[2].requestBody += " "; },
  "changed final bytes": (p, b) => { b.responses[3].requestBody += " "; },
  "changed browser key": (p, b) => { b.responses[1].key = "new"; },
  "unparsed success": (p, b) => { b.responses[1].body = null; },
  "browser non-replay": (p, b) => { b.responses[2].replayed = false; },
  "browser wrong status": (p, b) => { b.responses[2].status = 500; },
  "browser new reference": (p, b) => { b.responses[2].body.reference = "CN-other"; },
  "browser new note": (p, b) => { b.responses[2].body.id++; },
  "cleanup before JSON": (p, b) => { b.removalAttempts[1].at = 129; },
  "wrong removal target": (p, b) => { b.removalAttempts[2].key = "other"; },
  "missing parsed JSON time": (p, b) => { delete b.responses[1].jsonObservedAt; },
  "unobserved cleanup time": (p, b) => { delete b.removalAttempts[1].at; },
  "stale intermediate capture": (p, b) => { b.afterFailures[1].observedAt = 119; },
  "capture before cleanup": (p, b) => { b.afterFailures[2].observedAt = 154; },
  "generic second error": (p, b) => { b.afterFailures[1].message = "Error"; },
  "missing second warning": (p, b) => { b.afterFailures[1].message = null; },
  "missing same-data guidance": (p, b) => { b.afterFailures[0].message = "تم حفظ العملية بالفعل، لكن تعذر تنظيف مفتاحها"; },
  "lost intermediate key": (p, b) => { b.afterFailures[1].entries = []; },
  "replaced intermediate key": (p, b) => { b.afterFailures[2].entries[0][1] = "new"; },
  "closed intermediate form": (p, b) => { b.afterFailures[1].formOpen = false; },
  "changed intermediate reason": (p, b) => { b.afterFailures[2].fields.reason = "Other"; },
  "changed intermediate quantity": (p, b) => { b.afterFailures[1].fields.quantity = "2"; },
  "changed intermediate restock": (p, b) => { b.afterFailures[1].fields.restock = false; },
  "unobserved intermediate POST": (p, b) => { b.afterFailures[1].returnPostCount++; },
  "reload instead of mounted retry": (p, b) => { b.afterFailures[1].timeOrigin++; },
  "missing stage time": (p, b) => { delete b.beforeRecovery.observedAt; },
  "cleared key before recovery": (p, b) => { b.beforeRecovery.entries = []; },
  "changed recovery fields": (p, b) => { b.beforeRecovery.fields.unitPrice = "101"; },
  "missing recovery message": (p, b) => { b.beforeRecovery.message = ""; },
  "automatic recovery POST": (p, b) => { b.beforeRecovery.returnPostCount++; },
  "remove not restored before recovery": (p, b) => { b.storageRestored.removeItem = false; },
  "probe failed before recovery": (p, b) => { b.storageRestored.probe = false; },
  "final response before restoration stage": (p, b) => { b.responses.at(-1).jsonObservedAt = 175; },
  "final form open": (p, b) => { b.afterSuccess.formClosed = false; },
  "key not removed": (p, b) => { b.afterSuccess.entries = [["key", "value"]]; },
  "cleanup message persists": (p, b) => { b.afterSuccess.cleanupMessageVisible = true; },
  "two visible notes": (p, b) => { b.afterSuccess.visibleCreditNoteCount = 2; },
  "wrong visible reference": (p, b) => { b.afterSuccess.references = ["CN-other"]; },
  "extra final POST": (p, b) => { b.afterSuccess.returnPostCount++; },
  "fetch not restored": (p, b) => { b.restored.fetch = false; },
  "remove not restored": (p, b) => { b.restored.removeItem = false; },
  "final probe failed": (p, b) => { b.restored.probe = false; },
  "final duplicate receipt": (p) => { p.finalReceipts.push({}); },
  "final duplicate movement": (p) => { p.finalReturnState.moves.push({}); },
  "final different journal": (p) => { p.finalReturnState.notes[0].journalEntryId++; },
  "orphan duplicate journal": (p) => { p.finalJournals.push({ id: 11 }); },
  "missing journal table capture": (p) => { delete p.finalJournals; },
  "unlinked final journal": (p) => { p.finalJournals = [{ id: 11 }]; },
  "stale final database snapshot": (p) => { p.receiptsObservedAt = 12999; },
  "missing final database timestamp": (p) => { delete p.receiptsObservedAt; },
};
for (const [name, mutate] of Object.entries(mutations)) {
  test(`rejects ${name}`, () => {
    const { proxy, browser } = fixture();
    mutate(proxy, browser);
    assert.throws(() => checkRepeatedReturnCleanup(proxy, browser));
  });
}
