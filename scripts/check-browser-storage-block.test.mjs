import { test } from "node:test";
import assert from "node:assert/strict";
import { checkBrowserStorageBlock } from "./check-browser-storage-block.mjs";

function evidence() {
  const fields = { customer: "Synthetic customer", product: "Synthetic product", quantity: "2", price: "123.45", discount: "3", notes: "synthetic-storage-block" };
  return {
    proxy: { runId: "isolated", startedAt: 1, capturedAt: 5, invoicePostCount: 0, events: [],
      initialCounts: { invoices: 0, receipts: 0 }, finalCounts: { invoices: 0, receipts: 0 } },
    browser: { runId: "isolated", invoicePostCount: 0, unrelatedStorageWorked: true,
      blockedKeys: [`hasba:financial-request:${"a".repeat(64)}`],
      beforeSave: { observedAt: 2, timeOrigin: 1, formOpen: true, fields },
      afterSave: { observedAt: 3, timeOrigin: 1, formOpen: true, fields: { ...fields }, financialEntries: [],
        error: "تعذر حفظ مفتاح العملية بأمان. لم يُرسل الطلب؛ فعّل تخزين الجلسة وأعد المحاولة." },
      restored: { observedAt: 4, timeOrigin: 1, originalSetItemRestored: true, financialWriteReadRemoved: true } },
  };
}

test("accepts a blocked write with preserved form and restored storage", () => {
  const { proxy, browser } = evidence();
  checkBrowserStorageBlock(proxy, browser);
});
for (const [name, mutate] of [
  ["POST reached proxy", (p) => { p.invoicePostCount = 1; }],
  ["POST left browser", (_p, b) => { b.invoicePostCount = 1; }],
  ["invoice exists", (p) => { p.finalCounts.invoices = 1; }],
  ["receipt exists", (p) => { p.finalCounts.receipts = 1; }],
  ["different run", (_p, b) => { b.runId = "stale"; }],
  ["form closed", (_p, b) => { b.afterSave.formOpen = false; }],
  ["fields lost", (_p, b) => { b.afterSave.fields.notes = ""; }],
  ["validation instead of blocked storage", (_p, b) => { b.blockedKeys = []; }],
  ["unhelpful error", (_p, b) => { b.afterSave.error = "HTTP 500"; }],
  ["storage not restored", (_p, b) => { b.restored.originalSetItemRestored = false; }],
  ["storage still broken", (_p, b) => { b.restored.financialWriteReadRemoved = false; }],
  ["unrelated storage blocked", (_p, b) => { b.unrelatedStorageWorked = false; }],
  ["evidence after DB capture", (_p, b) => { b.restored.observedAt = 6; }],
]) {
  test(`rejects ${name}`, () => {
    const { proxy, browser } = evidence();
    mutate(proxy, browser);
    assert.throws(() => checkBrowserStorageBlock(proxy, browser));
  });
}
