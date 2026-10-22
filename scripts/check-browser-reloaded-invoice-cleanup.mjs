import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkInvoiceCleanup } from "./check-browser-invoice-cleanup-success.mjs";

// Keep the existing mounted-dialog contract intact; add actual reload and
// pre-confirmation ingress evidence, without comparing browser/server clocks.
export function checkReloadedInvoiceCleanup(proxy, browser, beforeRetryProxy) {
  checkInvoiceCleanup(proxy, browser);
  const [first, retry] = proxy.events;
  assert.equal(first.replayHeader, null);
  assert.equal(browser.faultMethod, "removeItem");
  assert.equal(browser.faultName, "SecurityError");
  assert.equal(browser.responses[0].requestBody, browser.responses[1].requestBody);
  const digest = (value) => createHash("sha256").update(value).digest("hex");
  const body = browser.responses[0].requestBody;
  assert.equal(first.bodyHash, digest(body));
  assert.equal(first.storageKey, `hasba:financial-request:${digest(`/api/sales/invoices\n${body}`)}`);
  assert.ok(Number.isInteger(browser.customerId) && browser.customerId > 0);
  assert.equal(first.body.customerId, browser.customerId);
  assert.ok(browser.customerName);
  assert.equal(first.body.notes, "Reload cleanup invoice");
  assert.equal(first.body.lines.length, 1);
  const line = first.body.lines[0];
  assert.ok(Number.isInteger(line.productId) && line.productId > 0);
  assert.equal(line.description, "منتج اختبار");
  assert.equal(line.quantity, 1);
  assert.equal(line.unitPrice, 100);
  assert.equal(line.discountPct, 0);
  assert.equal(line.taxRate, 15);
  const fields = {
    customerName: browser.customerName, description: line.description,
    quantity: "1", unitPrice: "100", discountPct: "0", taxRate: "15",
    notes: first.body.notes,
  };
  const { beforeSave, afterCleanupFailure, afterReload, beforeRetry, afterSuccess } = browser;
  const entries = [{ storageKey: first.storageKey, key: first.key }];
  for (const stage of [beforeSave, afterCleanupFailure, afterReload, beforeRetry, afterSuccess]) {
    assert.ok(Number.isFinite(stage.observedAt));
    assert.ok(Number.isFinite(stage.timeOrigin) && stage.timeOrigin > 0);
  }
  assert.deepEqual(beforeSave.fields, fields);
  assert.equal(beforeSave.timeOrigin, afterCleanupFailure.timeOrigin);
  assert.ok(beforeSave.observedAt <= browser.responses[0].jsonObservedAt);
  assert.ok(browser.removalAttempts[0].at <= afterCleanupFailure.observedAt);
  assert.ok(afterCleanupFailure.timeOrigin < afterReload.timeOrigin, "New document, not a dialog retry");
  assert.ok(afterCleanupFailure.observedAt < afterReload.observedAt);
  assert.equal(afterReload.navigationType, "reload");
  assert.equal(afterReload.formClosed, true);
  assert.deepEqual(afterReload.entries, entries);
  assert.equal(afterReload.invoicePostCount, 0);
  assert.equal(afterReload.observerInstalledBeforeApp, true);
  assert.equal(afterReload.readyStateAtInstall, "loading");
  assert.equal(afterReload.observerTimeOrigin, afterReload.timeOrigin);
  assert.ok(Number.isFinite(afterReload.observerInstalledAt));
  assert.ok(afterReload.observerInstalledAt >= afterReload.timeOrigin);
  assert.ok(afterReload.observerInstalledAt <= afterReload.observedAt);
  assert.equal(beforeRetry.formOpen, true);
  assert.equal(beforeRetry.invoicePostCount, 0, "Opening/refilling must not submit");
  assert.equal(beforeRetry.observerInstalledBeforeApp, true);
  assert.equal(beforeRetry.timeOrigin, afterReload.timeOrigin);
  assert.ok(beforeRetry.observedAt > afterReload.observedAt);
  assert.ok(browser.responses[1].jsonObservedAt >= beforeRetry.observedAt);
  assert.equal(afterSuccess.timeOrigin, afterReload.timeOrigin);
  assert.ok(afterSuccess.observedAt >= browser.responses[1].jsonObservedAt);
  assert.equal(afterSuccess.invoicePostCount, 1);
  assert.equal(browser.restoredBeforeReload.removeItem, true);
  assert.equal(browser.restoredBeforeReload.fetch, true);
  assert.equal(browser.restoredBeforeReload.probe, true);
  assert.equal(browser.restoredAfterReload.fetch, true);
  assert.equal(browser.restoredAfterReload.probe, true);
  assert.equal(browser.restoredAfterReload.removeItemProbe, true);

  assert.equal(beforeRetryProxy.runId, proxy.runId);
  assert.equal(beforeRetryProxy.invoicePostCount, 1, "No automatic POST reaches proxy before confirmation");
  assert.deepEqual(beforeRetryProxy.events, [first]);
  for (const name of ["initialCounts", "initialJournals", "initialInvoiceState"]) {
    assert.deepEqual(beforeRetryProxy[name], proxy[name]);
  }
  assert.deepEqual(proxy.initialInvoiceState.invoices, []);
  assert.deepEqual(first.invoiceState.invoices, [{
    id: first.invoiceId, reference: first.reference, customerId: browser.customerId, total: 115,
  }]);
  for (const name of ["products", "moves", "quants"]) {
    assert.ok(Array.isArray(proxy.initialInvoiceState[name]));
    assert.deepEqual(first.invoiceState[name], proxy.initialInvoiceState[name]);
  }
  assert.deepEqual(retry.invoiceState, first.invoiceState);
  for (const evidence of [proxy, beforeRetryProxy]) {
    assert.deepEqual(evidence.finalInvoiceState, first.invoiceState);
    assert.deepEqual(evidence.finalCounts, first.counts);
    assert.deepEqual(evidence.finalJournals, first.journals);
    assert.deepEqual(evidence.finalReceipts, first.receipts);
    assert.ok(Number.isFinite(evidence.receiptsObservedAt));
  }
  assert.ok(first.recordedAt <= beforeRetryProxy.receiptsObservedAt);
  assert.ok(beforeRetryProxy.receiptsObservedAt < retry.recordedAt);
  assert.ok(retry.recordedAt <= proxy.receiptsObservedAt);
  const receipt = first.receipts[0];
  for (const name of ["companyId", "userId"]) assert.ok(Number.isInteger(receipt[name]) && receipt[name] > 0);
  assert.match(receipt.operation, /^POST:.*:\/sales\/invoices$/);
  assert.ok(Number.isInteger(first.journals[0].id) && first.journals[0].id > 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = new URL("../generated-artifacts/verification/", import.meta.url);
  const load = (name) => JSON.parse(readFileSync(new URL(name, dir), "utf8"));
  checkReloadedInvoiceCleanup(load("browser-retry-proxy.json"),
    load("browser-reloaded-invoice-cleanup.json"), load("browser-reloaded-invoice-cleanup-before-retry-proxy.json"));
  console.log("PASS: parsed success, cleanup failure, real reload without POST, same-invoice replay and one final row/receipt/journal.");
}
