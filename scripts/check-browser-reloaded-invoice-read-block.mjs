import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkBrowserRetry } from "./check-browser-retry.mjs";

export function checkReloadedInvoiceReadBlock(proxy, browser, blockedProxy) {
  const { afterLostResponse, beforeBlockedSave, afterBlockedSave, restored, afterSuccess } = browser;
  checkBrowserRetry(proxy, {
    ...browser, beforeReload: afterLostResponse, afterReload: beforeBlockedSave,
  });
  const [first, retry] = proxy.events;
  assert.deepEqual(proxy.initialCounts, { invoices: 0, receipts: 0 });
  assert.deepEqual(proxy.initialJournals, []);
  assert.deepEqual(proxy.initialInvoiceState.invoices, []);
  assert.equal(proxy.invoicePostCount, 2);
  assert.equal(first.upstreamStatus, 201);
  assert.equal(retry.upstreamStatus, 201);
  assert.equal(first.replayHeader, null);
  assert.equal(retry.replayHeader, "true");
  assert.equal(first.bodyHash, createHash("sha256").update(JSON.stringify(first.body)).digest("hex"));
  assert.equal(first.storageKey, `hasba:financial-request:${createHash("sha256")
    .update(`/api/sales/invoices\n${JSON.stringify(first.body)}`).digest("hex")}`);
  assert.equal(first.body.customerId, browser.customerId);
  assert.ok(Number.isInteger(browser.customerId) && browser.customerId > 0);
  assert.ok(typeof browser.customerName === "string" && browser.customerName.length > 0);
  assert.equal(first.body.notes, "Reload read block invoice");
  assert.equal(first.body.lines.length, 1);
  const line = first.body.lines[0];
  assert.ok(Number.isInteger(line.productId) && line.productId > 0);
  assert.equal(line.description, "منتج اختبار");
  assert.equal(line.quantity, 1);
  assert.equal(line.unitPrice, 100);
  assert.equal(line.discountPct, 0);
  assert.equal(line.taxRate, 15);
  for (const field of ["key", "body", "bodyHash", "storageKey", "invoiceId", "reference",
    "journals", "receipts", "invoiceState"]) {
    assert.deepEqual(retry[field], first[field], `Replay preserves ${field}`);
  }
  assert.equal(first.journals.length, 1);
  assert.ok(Number.isInteger(first.journals[0].id) && first.journals[0].id > 0);
  assert.equal(first.receipts.length, 1);
  const receipt = first.receipts[0];
  assert.ok(Number.isInteger(receipt.companyId) && receipt.companyId > 0);
  assert.ok(Number.isInteger(receipt.userId) && receipt.userId > 0);
  assert.match(receipt.operation, /^POST:.*:\/sales\/invoices$/);
  assert.equal(receipt.key, first.key);
  assert.equal(String(receipt.invoiceId), String(first.invoiceId));
  assert.equal(first.invoiceState.invoices.length, 1);
  assert.deepEqual(first.invoiceState.invoices[0], {
    id: first.invoiceId, reference: first.reference, customerId: browser.customerId, total: 115,
  });
  for (const name of ["products", "moves", "quants"]) {
    assert.ok(Array.isArray(proxy.initialInvoiceState[name]));
    assert.deepEqual(first.invoiceState[name], proxy.initialInvoiceState[name], `No ${name} effects`);
  }
  assert.deepEqual(proxy.finalCounts, first.counts);
  assert.deepEqual(proxy.finalJournals, first.journals);
  assert.deepEqual(proxy.finalReceipts, first.receipts);
  assert.deepEqual(proxy.finalInvoiceState, first.invoiceState);
  assert.ok(Number.isFinite(proxy.receiptsObservedAt) && proxy.receiptsObservedAt >= afterSuccess.observedAt);

  let previous = first.recordedAt;
  const fields = { customerName: browser.customerName, description: line.description,
    quantity: "1", unitPrice: "100", discountPct: "0", taxRate: "15", notes: first.body.notes };
  for (const stage of [afterLostResponse, beforeBlockedSave, afterBlockedSave, restored, afterSuccess]) {
    assert.ok(Number.isFinite(stage.observedAt) && stage.observedAt > previous);
    previous = stage.observedAt;
    assert.ok(Number.isFinite(stage.timeOrigin));
    if (stage !== afterLostResponse) assert.equal(stage.timeOrigin, beforeBlockedSave.timeOrigin);
    if (stage !== afterSuccess) {
      assert.equal(stage.formOpen, true);
      assert.deepEqual(stage.fields, fields, "Read actual unchanged form fields");
      assert.deepEqual(stage.entries, [[first.storageKey, first.key]]);
      assert.ok(stage.observedAt < retry.recordedAt, "No replay before storage restoration");
    }
  }
  assert.deepEqual(afterSuccess.references, [first.reference]);
  assert.equal(browser.faultMethod, "getItem");
  assert.equal(browser.faultName, "SecurityError");
  assert.deepEqual(browser.blockedKeys, [first.storageKey]);
  assert.deepEqual(browser.financialWriteKeys, []);
  assert.deepEqual(browser.financialRemoveKeys, []);
  assert.equal(browser.unrelatedStorageWorked, true);
  assert.equal(browser.blockedInvoicePostCount, 0);
  assert.equal(browser.recoveryInvoicePostCount, 1);
  assert.equal(afterBlockedSave.error,
    "تعذر حفظ مفتاح العملية بأمان. لم يُرسل الطلب؛ فعّل تخزين الجلسة وأعد المحاولة.");
  for (const flag of ["originalGetItemRestored", "originalSetItemRestored",
    "originalRemoveItemRestored", "originalFetchRestored", "financialWriteReadRemoved"]) {
    assert.equal(restored[flag], true, flag);
  }
  assert.equal(blockedProxy.runId, proxy.runId);
  assert.equal(blockedProxy.invoicePostCount, 1, "No new ingress during read fault");
  assert.deepEqual(blockedProxy.events, [first]);
  assert.deepEqual(blockedProxy.initialCounts, proxy.initialCounts);
  assert.deepEqual(blockedProxy.initialJournals, proxy.initialJournals);
  assert.deepEqual(blockedProxy.initialInvoiceState, proxy.initialInvoiceState);
  assert.deepEqual(blockedProxy.finalCounts, first.counts);
  assert.deepEqual(blockedProxy.finalJournals, first.journals);
  assert.deepEqual(blockedProxy.finalReceipts, first.receipts);
  assert.deepEqual(blockedProxy.finalInvoiceState, first.invoiceState);
  assert.ok(Number.isFinite(blockedProxy.receiptsObservedAt));
  assert.ok(blockedProxy.receiptsObservedAt >= restored.observedAt);
  assert.ok(blockedProxy.receiptsObservedAt < retry.recordedAt);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = new URL("../generated-artifacts/verification/", import.meta.url);
  const load = (name) => JSON.parse(readFileSync(new URL(name, dir), "utf8"));
  checkReloadedInvoiceReadBlock(load("browser-retry-proxy.json"),
    load("browser-reloaded-invoice-read-block.json"), load("browser-reloaded-invoice-blocked-proxy.json"));
  console.log("PASS: reload read fault prevents invoice POST/write/removal; recovery replays the same invoice/receipt/journal without stock effects.");
}
