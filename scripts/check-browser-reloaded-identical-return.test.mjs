import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { checkReloadedIdenticalReturn } from "./check-browser-reloaded-identical-return.mjs";

function evidence() {
  const f = { id: 7, reference: "SINV-7", productId: 2, description: "Synthetic return item",
    lineId: 3, issueMoveId: 4, warehouseId: 5, soldQuantity: 4, returnQuantity: 1, unitCost: 50 };
  const body = { customerId: 1, invoiceId: f.id, reason: "Reload cleanup return", restock: true,
    lines: [{ productId: 2, description: f.description, quantity: 1, unitPrice: 100, taxRate: 0, invoiceLineId: 3 }] };
  const requestBody = JSON.stringify(body);
  const hash = (s) => createHash("sha256").update(s).digest("hex");
  const storageKey = `hasba:financial-request:${hash(`/api/sales/credit-notes\n${requestBody}`)}`;
  const receipt = { companyId: 1, userId: 1, operation: "POST:1:/sales/credit-notes",
    key: "first", creditNoteId: "8" };
  const returnState = { notes: [{ id: 8, reference: "CN-8", invoiceId: 7, journalEntryId: 9, status: "issued" }],
    moves: [{ id: 10, productId: 2, noteId: 8, invoiceLineId: 3, originalMoveId: 4,
      warehouseId: 5, quantity: 1, unitCost: 50, state: "done" }],
    stock: 1, quants: [{ warehouseId: 5, quantity: 1, avgCost: 50 }] };
  const first = { upstreamStatus: 201, dropped: false, replayed: false, replayHeader: null,
    creditNoteId: 8, reference: "CN-8", key: "first", storageKey, bodyHash: hash(requestBody),
    body, receipts: [receipt], counts: { invoices: 1, creditNotes: 1, receipts: 1 },
    returnState, recordedAt: 10000 };
  const retry = { ...structuredClone(first), replayed: true, replayHeader: "true", recordedAt: 11000 };
  const secondState = { notes: [returnState.notes[0],
    { id: 11, reference: "CN-11", invoiceId: 7, journalEntryId: 12, status: "issued" }],
    moves: [returnState.moves[0], { ...returnState.moves[0], id: 13, noteId: 11 }],
    stock: 2, quants: [{ warehouseId: 5, quantity: 2, avgCost: 50 }] };
  const receipts = [receipt, { ...receipt, key: "second", creditNoteId: "11" }];
  const second = { ...first, key: "second", creditNoteId: 11, reference: "CN-11",
    counts: { invoices: 1, creditNotes: 2, receipts: 2 }, receipts,
    returnState: secondState, recordedAt: 13000 };
  const base = { runId: "run", scenario: "identical-return", returnFixture: f,
    initialCounts: { invoices: 1, creditNotes: 0, receipts: 0 },
    initialReturnState: { notes: [], moves: [], stock: 0, quants: [{ warehouseId: 5, quantity: 0, avgCost: 0 }] },
    invoicePostCount: 0, receiptPostCount: 0 };
  const snapshot = (events, observedAt) => structuredClone({ ...base,
    returnPostCount: events.length, events, finalReceipts: events.at(-1).receipts,
    finalReturnState: events.at(-1).returnState, receiptsObservedAt: observedAt });
  const fields = { customerName: "Synthetic", invoiceReference: f.reference, reason: body.reason,
    restock: true, description: f.description, quantity: "1", unitPrice: "100", taxRate: "0" };
  const entries = [[storageKey, "first"]];
  const browser = { runId: "run", customerId: 1, customerName: "Synthetic",
    faultMethod: "removeItem", faultName: "SecurityError", unrelatedStorageWorked: true,
    beforeSave: { formOpen: true, fields, entries: [], observedAt: 100, timeOrigin: 50 },
    afterCleanupFailure: { formOpen: true, fields, entries, observedAt: 120, timeOrigin: 50,
      message: "تم حفظ العملية بالفعل، لكن تعذر تنظيف مفتاحها" },
    afterReload: { formClosed: true, entries, navigationType: "reload", returnPostCount: 0,
      observedAt: 210, timeOrigin: 200, observerInstalledBeforeApp: true, readyStateAtInstall: "loading",
      observerTimeOrigin: 200, observerInstalledAt: 201 },
    beforeRetry: { formOpen: true, fields, entries, returnPostCount: 0,
      observerInstalledBeforeApp: true, observedAt: 220, timeOrigin: 200 },
    afterSuccess: { formClosed: true, entries: [], returnPostCount: 1, visibleCreditNoteCount: 1,
      references: ["CN-8"], observedAt: 240, timeOrigin: 200 },
    afterNewForm: { formOpen: true, fields, entries: [], returnPostCount: 1,
      observerInstalledBeforeApp: true, observedAt: 250, timeOrigin: 200 },
    afterSecondSuccess: { formClosed: true, entries: [], returnPostCount: 2, visibleCreditNoteCount: 2,
      references: ["CN-11", "CN-8"], observedAt: 280, timeOrigin: 200 },
    restoredBeforeReload: { removeItem: true, fetch: true, probe: true },
    restoredAfterReload: { fetch: true, probe: true, removeItemProbe: true },
    responses: [first, retry, second].map((event, i) => ({ status: 201,
      body: { id: event.creditNoteId, reference: event.reference }, key: event.key,
      requestBody, replayed: event.replayed, jsonObservedAt: [110, 230, 270][i] })),
    removalAttempts: [{ key: storageKey, at: 115 }] };
  return structuredClone({ proxy: snapshot([first, retry, second], 14000), browser,
    before: snapshot([first], 10500), confirmed: snapshot([first, retry], 12000) });
}

const check = ({ proxy, browser, before, confirmed }) =>
  checkReloadedIdenticalReturn(proxy, browser, before, confirmed);
test("accepts readable cleanup recovery across reload then a new identical intent with independent clocks", () => {
  check(evidence());
});

const mutations = {
  "lost response instead of readable success": ({ confirmed: c, proxy: p, before: b }) => {
    c.events[0].dropped = p.events[0].dropped = b.events[0].dropped = true;
  },
  "no real reload": ({ browser: b }) => { b.afterReload.navigationType = "navigate"; },
  "same document": ({ browser: b }) => { b.afterReload.timeOrigin = 50; },
  "unparsed first success": ({ browser: b }) => { b.responses[0].body = null; },
  "cleanup before JSON": ({ browser: b }) => { b.removalAttempts[0].at = 109; },
  "synthetic preseeded key": ({ browser: b }) => { b.beforeSave.entries = [["fake", "fake"]]; },
  "automatic POST after reload": ({ browser: b }) => { b.afterReload.returnPostCount++; },
  "late observer": ({ browser: b }) => { b.afterReload.readyStateAtInstall = "complete"; },
  "unrestored fault": ({ browser: b }) => { b.restoredBeforeReload.removeItem = false; },
  "extra cleanup failure": ({ browser: b }) => { b.removalAttempts.push(b.removalAttempts[0]); },
  "missing before-retry capture": (d) => { d.before = null; },
  "missing confirmed capture": (d) => { d.confirmed = null; },
  "late confirmed capture": ({ confirmed: c }) => { c.receiptsObservedAt = 13000; },
  "stock duplicated on confirmation": ({ confirmed: c }) => { c.finalReturnState.stock++; },
  "stale final run": ({ proxy: p }) => { p.runId = "old"; },
  "different scenario": ({ proxy: p }) => { p.scenario = "invoice"; },
  "insufficient source quantity": ({ proxy: p }) => { p.returnFixture.soldQuantity = 1; },
  "extra return ingress": ({ proxy: p }) => { p.returnPostCount++; },
  "invoice ingress": ({ proxy: p }) => { p.invoicePostCount++; },
  "receipt ingress": ({ proxy: p }) => { p.receiptPostCount++; },
  "extra event": ({ proxy: p }) => { p.events.push(p.events[2]); },
  "changed replay evidence": ({ proxy: p }) => { p.events[1].key = "rotated"; },
  "reused new key": ({ proxy: p }) => { p.events[2].key = "first"; },
  "empty new key": ({ proxy: p }) => { p.events[2].key = ""; },
  "same note": ({ proxy: p }) => { p.events[2].creditNoteId = 8; },
  "same reference": ({ proxy: p }) => { p.events[2].reference = "CN-8"; },
  "replayed new intent": ({ proxy: p }) => { p.events[2].replayed = true; },
  "false replay header": ({ proxy: p }) => { p.events[2].replayHeader = "false"; },
  "missing replay header": ({ proxy: p }) => { delete p.events[2].replayHeader; },
  "new response dropped": ({ proxy: p }) => { p.events[2].dropped = true; },
  "failed new response": ({ proxy: p }) => { p.events[2].upstreamStatus = 409; },
  "different body": ({ proxy: p }) => { p.events[2].body.reason = "changed"; },
  "different digest": ({ proxy: p }) => { p.events[2].bodyHash = "other"; },
  "different storage slot": ({ proxy: p }) => { p.events[2].storageKey = "other"; },
  "third committed return": ({ proxy: p }) => { p.events[2].counts.creditNotes++; },
  "missing new receipt": ({ proxy: p }) => { p.events[2].receipts.pop(); },
  "wrong receipt user": ({ proxy: p }) => { p.events[2].receipts[1].userId++; },
  "wrong receipt tenant": ({ proxy: p }) => { p.events[2].receipts[1].companyId++; },
  "wrong receipt operation": ({ proxy: p }) => { p.events[2].receipts[1].operation = "invoice"; },
  "wrong receipt document": ({ proxy: p }) => { p.events[2].receipts[1].creditNoteId = "8"; },
  "changed original note": ({ proxy: p }) => { p.events[2].returnState.notes[0].journalEntryId++; },
  "changed original move": ({ proxy: p }) => { p.events[2].returnState.moves[0].unitCost++; },
  "same journal": ({ proxy: p }) => { p.events[2].returnState.notes[1].journalEntryId = 9; },
  "same move": ({ proxy: p }) => { p.events[2].returnState.moves[1].id = 10; },
  "current price instead of sale cost": ({ proxy: p }) => { p.events[2].returnState.moves[1].unitCost = 100; },
  "wrong source line": ({ proxy: p }) => { p.events[2].returnState.moves[1].invoiceLineId++; },
  "wrong source move": ({ proxy: p }) => { p.events[2].returnState.moves[1].originalMoveId++; },
  "wrong warehouse": ({ proxy: p }) => { p.events[2].returnState.moves[1].warehouseId++; },
  "extra movement": ({ proxy: p }) => { p.events[2].returnState.moves.push({}); },
  "wrong stock": ({ proxy: p }) => { p.events[2].returnState.stock++; },
  "wrong valuation": ({ proxy: p }) => { p.events[2].returnState.quants[0].avgCost = 100; },
  "stale final capture": ({ proxy: p }) => { p.receiptsObservedAt = 12999; },
  "wrong final state": ({ proxy: p }) => { p.finalReturnState.stock++; },
  "missing final receipt": ({ proxy: p }) => { p.finalReceipts.pop(); },
  "missing browser response": ({ browser: b }) => { b.responses.pop(); },
  "changed new request bytes": ({ browser: b }) => { b.responses[2].requestBody += " "; },
  "wrong response identity": ({ browser: b }) => { b.responses[2].body.id = 8; },
  "unobserved new JSON": ({ browser: b }) => { delete b.responses[2].jsonObservedAt; },
  "JSON before new form": ({ browser: b }) => { b.responses[2].jsonObservedAt = 249; },
  "new form before confirmation": ({ browser: b }) => { b.afterNewForm.observedAt = 239; },
  "new form reload": ({ browser: b }) => { b.afterNewForm.timeOrigin++; },
  "form not opened": ({ browser: b }) => { b.afterNewForm.formOpen = false; },
  "different rendered values": ({ browser: b }) => { b.afterNewForm.fields.quantity = "2"; },
  "retained key in new form": ({ browser: b }) => { b.afterNewForm.entries = [["x", "y"]]; },
  "automatic new form submit": ({ browser: b }) => { b.afterNewForm.returnPostCount++; },
  "missing new form observer": ({ browser: b }) => { b.afterNewForm.observerInstalledBeforeApp = false; },
  "uncleared new key": ({ browser: b }) => { b.afterSecondSuccess.entries = [["x", "y"]]; },
  "extra browser POST": ({ browser: b }) => { b.afterSecondSuccess.returnPostCount++; },
  "form left open": ({ browser: b }) => { b.afterSecondSuccess.formClosed = false; },
  "stale list": ({ browser: b }) => { b.afterSecondSuccess.visibleCreditNoteCount = 1; },
  "duplicate reference": ({ browser: b }) => { b.afterSecondSuccess.references = ["CN-8", "CN-8"]; },
};
for (const [name, mutate] of Object.entries(mutations)) {
  test(`rejects ${name}`, () => {
    const d = evidence();
    mutate(d);
    assert.throws(() => check(d));
  });
}
