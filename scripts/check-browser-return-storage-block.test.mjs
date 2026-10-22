import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { checkBrowserReturnStorageBlock } from "./check-browser-return-storage-block.mjs";

function evidence() {
  const fields = { customerName: "Synthetic customer", invoiceReference: "SINV-RETURN-test",
    reason: "Return storage block verification", restock: true, product: "منتج اختبار",
    description: "Synthetic return item", quantity: "1", unitPrice: "100" };
  const body = { customerId: 2, invoiceId: 3, reason: fields.reason, restock: true,
    lines: [{ productId: 4, description: fields.description, quantity: 1, unitPrice: 100,
      taxRate: 0, invoiceLineId: 5 }] };
  const hash = createHash("sha256").update(`/api/sales/credit-notes\n${JSON.stringify(body)}`).digest("hex");
  const initialReturnState = { notes: [], moves: [], stock: 0,
    quants: [{ warehouseId: 6, quantity: 0, avgCost: 0 }] };
  return {
    proxy: { scenario: "identical-return", runId: "isolated", startedAt: 1, capturedAt: 5,
      returnPostCount: 0, invoicePostCount: 0, receiptPostCount: 0, events: [],
      initialCounts: { invoices: 1, creditNotes: 0, receipts: 0 },
      finalCounts: { invoices: 1, creditNotes: 0, receipts: 0 },
      returnFixture: { id: 3, lineId: 5, productId: 4, warehouseId: 6,
        reference: fields.invoiceReference, description: fields.description, returnQuantity: 1, soldQuantity: 4 },
      initialReturnState, finalReturnState: structuredClone(initialReturnState) },
    browser: { runId: "isolated", customerId: 2, customerName: fields.customerName,
      returnPostCount: 0, unrelatedStorageWorked: true,
      blockedKeys: [`hasba:financial-request:${hash}`],
      beforeSave: { observedAt: 2, timeOrigin: 1, formOpen: true, fields, financialEntries: [] },
      afterSave: { observedAt: 3, timeOrigin: 1, formOpen: true, fields: { ...fields }, financialEntries: [],
        error: "تعذر حفظ مفتاح العملية بأمان. لم يُرسل الطلب؛ فعّل تخزين الجلسة وأعد المحاولة." },
      restored: { observedAt: 4, timeOrigin: 1, originalSetItemRestored: true,
        originalFetchRestored: true, financialWriteReadRemoved: true, financialEntries: [] } },
  };
}

test("accepts blocked return storage with retained form, no send or restock, and restored methods", () => {
  const { proxy, browser } = evidence();
  checkBrowserReturnStorageBlock(proxy, browser);
});
for (const [name, mutate] of [
  ["return arrived without successful response", (p) => { p.returnPostCount = 1; }],
  ["return left browser but never arrived", (_p, b) => { b.returnPostCount = 1; }],
  ["unrelated invoice POST", (p) => { p.invoicePostCount = 1; }],
  ["unrelated receipt POST", (p) => { p.receiptPostCount = 1; }],
  ["successful event", (p) => { p.events = [{}]; }],
  ["return created", (p) => { p.finalCounts.creditNotes = 1; }],
  ["financial receipt created", (p) => { p.finalCounts.receipts = 1; }],
  ["existing return baseline", (p) => { p.initialCounts.creditNotes = 1; }],
  ["stock restoration movement", (p) => { p.finalReturnState.moves.push({ id: 1 }); }],
  ["stock changed", (p) => { p.finalReturnState.stock = 1; }],
  ["quant changed", (p) => { p.finalReturnState.quants[0].quantity = 1; }],
  ["valuation changed", (p) => { p.finalReturnState.quants[0].avgCost = 50; }],
  ["stale run", (_p, b) => { b.runId = "old"; }],
  ["wrong scenario", (p) => { p.scenario = "invoice"; }],
  ["form closed", (_p, b) => { b.afterSave.formOpen = false; }],
  ["reason lost", (_p, b) => { b.afterSave.fields.reason = ""; }],
  ["restock disabled", (_p, b) => { b.beforeSave.fields.restock = false; }],
  ["wrong invoice", (_p, b) => { b.beforeSave.fields.invoiceReference = "other"; }],
  ["no blocked write", (_p, b) => { b.blockedKeys = []; }],
  ["wrong operation fingerprint", (_p, b) => { b.blockedKeys = [`hasba:financial-request:${"0".repeat(64)}`]; }],
  ["multiple save attempts", (_p, b) => { b.blockedKeys.push(b.blockedKeys[0]); }],
  ["prior pending intent", (_p, b) => { b.beforeSave.financialEntries = [["key", "value"]]; }],
  ["key persisted", (_p, b) => { b.afterSave.financialEntries = [["key", "value"]]; }],
  ["unhelpful error", (_p, b) => { b.afterSave.error = "HTTP 500"; }],
  ["storage not restored", (_p, b) => { b.restored.originalSetItemRestored = false; }],
  ["fetch not restored", (_p, b) => { b.restored.originalFetchRestored = false; }],
  ["storage still broken", (_p, b) => { b.restored.financialWriteReadRemoved = false; }],
  ["probe key retained", (_p, b) => { b.restored.financialEntries = [["key", "probe"]]; }],
  ["unrelated storage blocked", (_p, b) => { b.unrelatedStorageWorked = false; }],
  ["reload", (_p, b) => { b.afterSave.timeOrigin = 2; }],
  ["evidence after database capture", (_p, b) => { b.restored.observedAt = 6; }],
  ["missing timestamp", (_p, b) => { delete b.afterSave.observedAt; }],
]) {
  test(`rejects ${name}`, () => {
    const { proxy, browser } = evidence();
    mutate(proxy, browser);
    assert.throws(() => checkBrowserReturnStorageBlock(proxy, browser));
  });
}
