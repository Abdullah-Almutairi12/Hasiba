// Validate evidence from the real invoice form and disposable API proxy.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function checkBrowserStorageBlock(proxy, browser) {
  assert.ok(proxy.runId);
  assert.equal(browser.runId, proxy.runId, "Use the same disposable run");
  assert.equal(proxy.invoicePostCount, 0, "No invoice POST may reach the proxy");
  assert.deepEqual(proxy.events, []);
  assert.deepEqual(proxy.initialCounts, { invoices: 0, receipts: 0 });
  assert.deepEqual(proxy.finalCounts, proxy.initialCounts, "No invoice or financial receipt may be created");
  const { beforeSave, afterSave, restored } = browser;
  assert.ok(proxy.startedAt <= beforeSave.observedAt);
  assert.ok(beforeSave.observedAt < afterSave.observedAt);
  assert.ok(afterSave.observedAt <= restored.observedAt);
  assert.ok(restored.observedAt <= proxy.capturedAt);
  assert.equal(afterSave.timeOrigin, beforeSave.timeOrigin, "Keep the same tab/document");
  assert.equal(restored.timeOrigin, beforeSave.timeOrigin);
  assert.equal(beforeSave.formOpen, true);
  assert.equal(afterSave.formOpen, true, "Failure must not close the form");
  assert.ok(beforeSave.fields.customer);
  assert.ok(beforeSave.fields.product);
  assert.ok(Number(beforeSave.fields.quantity) > 0);
  assert.ok(Number(beforeSave.fields.price) > 0);
  assert.ok(beforeSave.fields.notes);
  assert.deepEqual(afterSave.fields, beforeSave.fields, "Preserve all entered fields");
  assert.match(afterSave.error, /تعذر حفظ مفتاح العملية بأمان/);
  assert.match(afterSave.error, /لم يُرسل الطلب/);
  assert.match(afterSave.error, /فعّل تخزين الجلسة وأعد المحاولة/);
  assert.ok(browser.blockedKeys.length > 0, "Actually intercept setItem, not just form validation");
  for (const key of browser.blockedKeys) assert.match(key, /^hasba:financial-request:[a-f0-9]{64}$/);
  assert.equal(browser.invoicePostCount, 0, "No outgoing browser invoice POST");
  assert.deepEqual(afterSave.financialEntries, []);
  assert.equal(restored.originalSetItemRestored, true);
  assert.equal(restored.financialWriteReadRemoved, true, "Prove financial storage works again without submitting");
  assert.equal(browser.unrelatedStorageWorked, true, "Do not block unrelated storage");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = new URL("../generated-artifacts/verification/", import.meta.url);
  checkBrowserStorageBlock(
    JSON.parse(readFileSync(new URL("browser-storage-block-proxy.json", dir), "utf8")),
    JSON.parse(readFileSync(new URL("browser-storage-block.json", dir), "utf8")),
  );
  console.log("PASS: storage write rejected in real invoice form; fields retained; no invoice POST, invoice or receipt; tab storage restored.");
}
