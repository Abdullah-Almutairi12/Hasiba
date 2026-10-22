// Real CreditNoteFormDialog evidence; never accepts simulated browser results.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function checkBrowserReturnStorageBlock(proxy, browser) {
  assert.equal(proxy.scenario, "identical-return");
  assert.ok(proxy.runId);
  assert.equal(browser.runId, proxy.runId, "Use the same disposable run");
  for (const count of ["returnPostCount", "invoicePostCount", "receiptPostCount"]) {
    assert.equal(proxy[count], 0, `No ${count} may reach the proxy, even if rejected or in flight`);
  }
  assert.equal(browser.returnPostCount, 0, "No outgoing browser return POST");
  assert.deepEqual(proxy.events, []);
  assert.deepEqual(proxy.initialCounts, { invoices: 1, creditNotes: 0, receipts: 0 });
  assert.deepEqual(proxy.finalCounts, proxy.initialCounts, "No credit_notes or financial_requests rows");
  const fixture = proxy.returnFixture;
  assert.ok(Number.isInteger(fixture.id) && fixture.id > 0);
  assert.ok(Number.isInteger(fixture.lineId) && fixture.lineId > 0);
  assert.ok(Number.isInteger(fixture.productId) && fixture.productId > 0);
  assert.equal(fixture.returnQuantity, 1);
  assert.ok(fixture.soldQuantity >= fixture.returnQuantity);
  assert.deepEqual(proxy.initialReturnState, {
    notes: [], moves: [], stock: 0,
    quants: [{ warehouseId: fixture.warehouseId, quantity: 0, avgCost: 0 }],
  });
  assert.deepEqual(proxy.finalReturnState, proxy.initialReturnState, "No return moves, stock or valuation changes");

  const { beforeSave, afterSave, restored } = browser;
  for (const stage of [beforeSave, afterSave, restored]) {
    assert.ok(Number.isFinite(stage.observedAt));
    assert.ok(Number.isFinite(stage.timeOrigin));
    assert.equal(stage.timeOrigin, beforeSave.timeOrigin, "Keep the same test tab/document");
  }
  assert.ok(Number.isFinite(proxy.startedAt) && Number.isFinite(proxy.capturedAt));
  assert.ok(proxy.startedAt <= beforeSave.observedAt);
  assert.ok(beforeSave.observedAt < afterSave.observedAt);
  assert.ok(afterSave.observedAt <= restored.observedAt);
  assert.ok(restored.observedAt <= proxy.capturedAt);
  assert.equal(beforeSave.formOpen, true);
  assert.equal(afterSave.formOpen, true, "Failure must not close the return form");
  assert.ok(browser.customerName);
  assert.ok(Number.isInteger(browser.customerId) && browser.customerId > 0);
  assert.deepEqual(beforeSave.fields, {
    customerName: browser.customerName, invoiceReference: fixture.reference,
    reason: "Return storage block verification", restock: true,
    product: "منتج اختبار", description: fixture.description, quantity: "1", unitPrice: "100",
  });
  assert.deepEqual(afterSave.fields, beforeSave.fields, "Preserve every entered return field");
  assert.match(afterSave.error, /تعذر حفظ مفتاح العملية بأمان/);
  assert.match(afterSave.error, /لم يُرسل الطلب/);
  assert.match(afterSave.error, /فعّل تخزين الجلسة وأعد المحاولة/);
  assert.deepEqual(beforeSave.financialEntries, [], "Start with no pending intent");
  assert.deepEqual(afterSave.financialEntries, [], "No key persisted after the failed write");
  // Exact fingerprint proves the source line, product and hidden zero tax are
  // included in the attempted operation, without sending a POST to inspect it.
  const body = {
    customerId: browser.customerId, invoiceId: fixture.id,
    reason: beforeSave.fields.reason, restock: true,
    lines: [{ productId: fixture.productId, description: fixture.description,
      quantity: 1, unitPrice: 100, taxRate: 0, invoiceLineId: fixture.lineId }],
  };
  const hash = createHash("sha256").update(`/api/sales/credit-notes\n${JSON.stringify(body)}`).digest("hex");
  assert.deepEqual(browser.blockedKeys, [`hasba:financial-request:${hash}`],
    "Exactly one save must reach the financial storage write for this linked return");
  assert.equal(browser.unrelatedStorageWorked, true);
  assert.equal(restored.originalSetItemRestored, true);
  assert.equal(restored.originalFetchRestored, true);
  assert.equal(restored.financialWriteReadRemoved, true, "Prove storage works again without resubmitting");
  assert.deepEqual(restored.financialEntries, []);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = new URL("../generated-artifacts/verification/", import.meta.url);
  checkBrowserReturnStorageBlock(
    JSON.parse(readFileSync(new URL("browser-return-storage-block-proxy.json", dir), "utf8")),
    JSON.parse(readFileSync(new URL("browser-return-storage-block.json", dir), "utf8")),
  );
  console.log("PASS: return key storage rejected; form retained; zero browser/proxy return POSTs; no return, financial receipt or stock restoration; storage restored.");
}
