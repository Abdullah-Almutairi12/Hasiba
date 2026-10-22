import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { checkReloadedInvoiceReadBlock as check } from "./check-browser-reloaded-invoice-read-block.mjs";

function evidence() {
  const body = { customerId: 1, lines: [{ productId: 1, description: "منتج اختبار",
    quantity: 1, unitPrice: 100, discountPct: 0, taxRate: 15 }], notes: "Reload read block invoice" };
  const digest = (s) => createHash("sha256").update(s).digest("hex");
  const storageKey = `hasba:financial-request:${digest(`/api/sales/invoices\n${JSON.stringify(body)}`)}`;
  const initialInvoiceState = { invoices: [], products: [{ id: 1, stock: 0 }], moves: [], quants: [] };
  const first = { recordedAt: 100, storageKey, key: "synthetic-intent",
    body, bodyHash: digest(JSON.stringify(body)), upstreamStatus: 201,
    dropped: true, replayed: false, replayHeader: null, invoiceId: 1, reference: "SINV-TEST",
    counts: { invoices: 1, receipts: 1 }, journals: [{ id: 1 }],
    receipts: [{ companyId: 1, userId: 1, operation: "POST:/api:/sales/invoices",
      key: "synthetic-intent", invoiceId: "1" }],
    invoiceState: { ...structuredClone(initialInvoiceState),
      invoices: [{ id: 1, reference: "SINV-TEST", customerId: 1, total: 115 }] } };
  const proxy = { runId: "synthetic-run", initialCounts: { invoices: 0, receipts: 0 },
    initialJournals: [], initialInvoiceState, invoicePostCount: 2,
    events: [first, { ...structuredClone(first), recordedAt: 200, dropped: false,
      replayed: true, replayHeader: "true" }],
    finalCounts: structuredClone(first.counts), finalJournals: structuredClone(first.journals),
    finalReceipts: structuredClone(first.receipts), finalInvoiceState: structuredClone(first.invoiceState),
    receiptsObservedAt: 220 };
  const fields = { customerName: "Synthetic customer", description: "منتج اختبار", quantity: "1",
    unitPrice: "100", discountPct: "0", taxRate: "15", notes: body.notes };
  const stage = (observedAt, timeOrigin = 120) => ({ observedAt, timeOrigin,
    entries: [[storageKey, first.key]], formOpen: true, fields: structuredClone(fields) });
  const browser = { runId: proxy.runId, customerId: 1, customerName: fields.customerName,
    afterLostResponse: stage(110, 1),
    beforeBlockedSave: { ...stage(130), navigationType: "reload" },
    afterBlockedSave: { ...stage(140),
      error: "تعذر حفظ مفتاح العملية بأمان. لم يُرسل الطلب؛ فعّل تخزين الجلسة وأعد المحاولة." },
    restored: { ...stage(150), originalGetItemRestored: true, originalSetItemRestored: true,
      originalRemoveItemRestored: true, originalFetchRestored: true, financialWriteReadRemoved: true },
    afterSuccess: { observedAt: 210, timeOrigin: 120, entries: [], formClosed: true,
      visibleInvoiceCount: 1, reference: first.reference, references: [first.reference] },
    faultMethod: "getItem", faultName: "SecurityError", blockedKeys: [storageKey],
    financialWriteKeys: [], financialRemoveKeys: [], unrelatedStorageWorked: true,
    blockedInvoicePostCount: 0, recoveryInvoicePostCount: 1 };
  const blocked = structuredClone(proxy);
  blocked.events.pop();
  blocked.invoicePostCount = 1;
  blocked.receiptsObservedAt = 160;
  return [proxy, browser, blocked];
}

test("accepts real reload, blocked read with no send or storage mutation, then same-invoice replay", () => {
  check(...evidence());
});
for (const [name, mutate] of [
  ["no reload", ([, b]) => { b.beforeBlockedSave.timeOrigin = 1; }],
  ["SPA navigation", ([, b]) => { b.beforeBlockedSave.navigationType = "navigate"; }],
  ["missing original key", ([, b]) => { b.afterLostResponse.entries = []; }],
  ["replaced key", ([, b]) => { b.restored.entries[0][1] = "replacement"; }],
  ["different fingerprint", ([, b]) => { b.blockedKeys[0] = "other"; }],
  ["observation triggers another fault", ([, b]) => { b.blockedKeys.push(b.blockedKeys[0]); }],
  ["different fault method", ([, b]) => { b.faultMethod = "removeItem"; }],
  ["different exception", ([, b]) => { b.faultName = "Error"; }],
  ["storage write attempted", ([, b]) => { b.financialWriteKeys.push("key"); }],
  ["storage removal attempted", ([, b]) => { b.financialRemoveKeys.push("key"); }],
  ["unrelated storage blocked", ([, b]) => { b.unrelatedStorageWorked = false; }],
  ["browser POST during fault", ([, b]) => { b.blockedInvoicePostCount = 1; }],
  ["proxy POST during fault", ([,, p]) => { p.invoicePostCount = 2; }],
  ["no recovery POST", ([, b]) => { b.recoveryInvoicePostCount = 0; }],
  ["generic error", ([, b]) => { b.afterBlockedSave.error = "Network error"; }],
  ["form closed on blocked read", ([, b]) => { b.afterBlockedSave.formOpen = false; }],
  ["changed refilled form", ([, b]) => { b.beforeBlockedSave.fields.quantity = "2"; }],
  ["changed blocked form", ([, b]) => { b.afterBlockedSave.fields.unitPrice = "200"; }],
  ["changed restored form", ([, b]) => { b.restored.fields.notes = "changed"; }],
  ...["originalGetItemRestored", "originalSetItemRestored", "originalRemoveItemRestored",
    "originalFetchRestored", "financialWriteReadRemoved"].map((flag) =>
    [`failed restoration ${flag}`, ([, b]) => { b.restored[flag] = false; }]),
  ["stale blocked capture", ([,, p]) => { p.receiptsObservedAt = 149; }],
  ["blocked capture after replay", ([,, p]) => { p.receiptsObservedAt = 201; }],
  ["foreign blocked run", ([,, p]) => { p.runId = "other"; }],
  ["extra blocked receipt", ([,, p]) => { p.finalCounts.receipts++; }],
  ["changed blocked journal", ([,, p]) => { p.finalJournals[0].id++; }],
  ["changed blocked stock", ([,, p]) => { p.finalInvoiceState.products[0].stock++; }],
  ["changed blocked receipt link", ([,, p]) => { p.finalReceipts[0].invoiceId = "2"; }],
  ["new recovery key", ([p]) => { p.events[1].key = "new"; }],
  ["changed recovery body", ([p]) => { p.events[1].body.notes = "new"; }],
  ["no replay header", ([p]) => { p.events[1].replayHeader = null; }],
  ["original response not dropped", ([p]) => { p.events[0].dropped = false; }],
  ["extra invoice", ([p]) => { p.finalCounts.invoices++; }],
  ["extra journal", ([p]) => { p.finalJournals.push({ id: 2 }); }],
  ["extra financial receipt", ([p]) => { p.finalReceipts.push({}); }],
  ["extra stock movement", ([p]) => { p.finalInvoiceState.moves.push({ id: 2 }); }],
  ["changed final stock", ([p]) => { p.finalInvoiceState.products[0].stock++; }],
  ["stale final capture", ([p]) => { p.receiptsObservedAt = 209; }],
  ["wrong list reference", ([, b]) => { b.afterSuccess.references = ["other"]; }],
  ["duplicate list row", ([, b]) => { b.afterSuccess.visibleInvoiceCount = 2; }],
  ["uncleared key", ([, b]) => { b.afterSuccess.entries = b.restored.entries; }],
  ["wrong body fingerprint", ([p]) => { p.events[0].bodyHash = "other"; }],
  ["wrong customer", ([, b]) => { b.customerId = 2; }],
  ["blank customer label", ([, b]) => { b.customerName = ""; }],
  ["wrong receipt operation", ([p]) => { p.events[0].receipts[0].operation = "POST:/api:/sales/receipts"; }],
]) {
  test(`rejects ${name}`, () => {
    const args = evidence();
    mutate(args);
    assert.throws(() => check(...args));
  });
}
