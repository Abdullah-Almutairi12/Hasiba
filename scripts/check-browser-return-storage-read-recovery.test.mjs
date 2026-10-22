import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { checkBrowserReturnStorageReadRecovery as check } from "./check-browser-return-storage-read-recovery.mjs";

function evidence() {
  const fields = { customerName: "Synthetic customer", invoiceReference: "SINV-test",
    reason: "Return storage block verification", restock: true, product: "منتج اختبار",
    description: "Synthetic item", quantity: "1", unitPrice: "100" };
  const body = { customerId: 2, invoiceId: 3, reason: fields.reason, restock: true,
    lines: [{ productId: 4, description: fields.description, quantity: 1,
      unitPrice: 100, taxRate: 0, invoiceLineId: 5 }] };
  const storageKey = "hasba:financial-request:" + createHash("sha256")
    .update(`/api/sales/credit-notes\n${JSON.stringify(body)}`).digest("hex");
  const fixture = { id: 3, lineId: 5, productId: 4, warehouseId: 6, issueMoveId: 7,
    reference: fields.invoiceReference, description: fields.description,
    returnQuantity: 1, soldQuantity: 4, unitCost: 50 };
  const initial = { notes: [], moves: [], stock: 0,
    quants: [{ warehouseId: 6, quantity: 0, avgCost: 0 }] };
  const counts = { invoices: 1, creditNotes: 0, receipts: 0 };
  const blockedProxy = { scenario: "identical-return", runId: "synthetic-run",
    startedAt: 1, capturedAt: 5, returnPostCount: 0, invoicePostCount: 0,
    receiptPostCount: 0, events: [], initialCounts: counts, finalCounts: { ...counts },
    returnFixture: fixture, initialReturnState: initial, finalReturnState: structuredClone(initial) };
  const stage = (observedAt) => ({ observedAt, timeOrigin: 1, formOpen: true,
    fields: { ...fields }, financialEntries: [] });
  const blockedBrowser = { runId: blockedProxy.runId, customerId: 2,
    customerName: fields.customerName, faultMethod: "getItem", faultName: "SecurityError",
    financialWriteKeys: [], returnPostCount: 0, blockedKeys: [storageKey], unrelatedStorageWorked: true,
    beforeSave: stage(2), afterSave: { ...stage(3),
      error: "تعذر حفظ مفتاح العملية بأمان. لم يُرسل الطلب؛ فعّل تخزين الجلسة وأعد المحاولة." },
    restored: { ...stage(4), originalGetItemRestored: true, originalSetItemRestored: true,
      originalRemoveItemRestored: true, originalFetchRestored: true, financialWriteReadRemoved: true } };
  const finalState = { notes: [{ id: 8, invoiceId: 3, status: "issued", journalEntryId: 9 }],
    moves: [{ id: 10, noteId: 8, productId: 4, invoiceLineId: 5, originalMoveId: 7,
      warehouseId: 6, quantity: 1, unitCost: 50, state: "done" }],
    stock: 1, quants: [{ warehouseId: 6, quantity: 1, avgCost: 50 }] };
  const receipts = [{ key: "synthetic-key", creditNoteId: "8" }];
  const proxy = { ...structuredClone(blockedProxy), returnPostCount: 1,
    events: [{ recordedAt: 7, upstreamStatus: 201, dropped: false, replayed: false,
      key: "synthetic-key", storageKey, creditNoteId: 8, reference: "CN-test", body,
      counts: { invoices: 1, creditNotes: 1, receipts: 1 }, receipts,
      returnState: finalState }], finalReceipts: structuredClone(receipts),
    finalReturnState: structuredClone(finalState), receiptsObservedAt: 9 };
  const browser = { runId: proxy.runId, beforeRecovery: stage(6),
    afterRecovery: { observedAt: 8, timeOrigin: 1, formOpen: false,
      financialEntries: [], visibleReference: "CN-test", listRowCount: 1 },
    returnPostCount: 1, originalMethodsRestored: true };
  return [blockedProxy, blockedBrowser, proxy, browser];
}

test("accepts unchanged mounted-form recovery after a proven no-send read failure", () => check(...evidence()));
for (const [name, mutate] of [
  ["request during blocked phase", (a) => { a[0].returnPostCount = 1; }],
  ["write attempted during read fault", (a) => { a[1].financialWriteKeys.push("key"); }],
  ["wrong fault", (a) => { a[1].faultMethod = "setItem"; }],
  ["new proxy run", (a) => { a[2].runId = "other"; }],
  ["new browser run", (a) => { a[3].runId = "other"; }],
  ["extra proxy POST", (a) => { a[2].returnPostCount = 2; }],
  ["no browser POST", (a) => { a[3].returnPostCount = 0; }],
  ["unrelated create", (a) => { a[2].invoicePostCount = 1; }],
  ["changed operation", (a) => { a[2].events[0].storageKey = "other"; }],
  ["replay instead of first create", (a) => { a[2].events[0].replayed = true; }],
  ["lost success", (a) => { a[2].events[0].dropped = true; }],
  ["failed response", (a) => { a[2].events[0].upstreamStatus = 500; }],
  ["duplicate note", (a) => { a[2].events[0].counts.creditNotes = 2; }],
  ["duplicate financial receipt", (a) => { a[2].finalReceipts.push(a[2].finalReceipts[0]); }],
  ["different receipt identity", (a) => { a[2].finalReceipts[0].creditNoteId = "99"; }],
  ["duplicate stock move", (a) => { a[2].finalReturnState.moves.push(a[2].finalReturnState.moves[0]); }],
  ["wrong historical cost", (a) => { a[2].finalReturnState.quants[0].avgCost = 100; }],
  ["reload", (a) => { a[3].beforeRecovery.timeOrigin = 2; }],
  ["edited form", (a) => { a[3].beforeRecovery.fields.reason = "Edited"; }],
  ["retained reservation", (a) => { a[3].afterRecovery.financialEntries = [["key", "value"]]; }],
  ["dialog stuck open", (a) => { a[3].afterRecovery.formOpen = true; }],
  ["duplicate list row", (a) => { a[3].afterRecovery.listRowCount = 2; }],
  ["wrong visible note", (a) => { a[3].afterRecovery.visibleReference = "other"; }],
  ["methods not restored", (a) => { a[3].originalMethodsRestored = false; }],
  ["capture predates confirmation", (a) => { a[2].receiptsObservedAt = 7; }],
]) {
  test(`rejects ${name}`, () => {
    const args = evidence();
    mutate(args);
    assert.throws(() => check(...args));
  });
}
