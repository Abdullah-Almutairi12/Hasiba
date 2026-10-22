import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkReceiptCleanup } from "./check-browser-receipt-cleanup-success.mjs";

// Preserve the mounted-dialog scenario while sharing its accounting, response,
// payload-fingerprint and visible-row assertions.
export function checkReloadedReceiptCleanup(proxy, browser, beforeRetryProxy) {
  checkReceiptCleanup(proxy, browser, { reloadBeforeRetry: true });
  const [first, retry] = proxy.events;
  const { beforeSave, afterCleanupFailure, afterReload, beforeRetry, afterSuccess } = browser;
  assert.equal(browser.faultMethod, "removeItem");
  assert.equal(browser.faultName, "SecurityError");
  assert.equal(browser.customerId, first.body.customerId);
  assert.ok(Number.isInteger(browser.customerId) && browser.customerId > 0);
  assert.equal(browser.responses[0].requestBody, browser.responses[1].requestBody);
  for (const stage of [beforeSave, afterCleanupFailure, afterReload, beforeRetry, afterSuccess]) {
    assert.ok(Number.isFinite(stage.observedAt));
    assert.ok(Number.isFinite(stage.timeOrigin) && stage.timeOrigin > 0);
  }
  assert.equal(beforeSave.timeOrigin, afterCleanupFailure.timeOrigin);
  assert.ok(beforeSave.observedAt <= browser.responses[0].jsonObservedAt);
  assert.ok(browser.removalAttempts[0].at <= afterCleanupFailure.observedAt);
  assert.ok(afterCleanupFailure.timeOrigin < afterReload.timeOrigin, "Require a new transport document");
  assert.ok(afterCleanupFailure.observedAt < afterReload.observedAt);
  assert.equal(afterReload.navigationType, "reload");
  assert.equal(afterReload.formClosed, true);
  assert.deepEqual(afterReload.entries, [{ storageKey: first.storageKey, key: first.key }]);
  assert.equal(afterReload.receiptPostCount, 0);
  assert.equal(afterReload.observerInstalledBeforeApp, true);
  assert.equal(afterReload.readyStateAtInstall, "loading");
  assert.equal(afterReload.observerTimeOrigin, afterReload.timeOrigin);
  assert.ok(Number.isFinite(afterReload.observerInstalledAt));
  assert.ok(afterReload.observerInstalledAt >= afterReload.timeOrigin);
  assert.ok(afterReload.observerInstalledAt <= afterReload.observedAt);
  assert.equal(beforeRetry.receiptPostCount, 0, "Reopening/refilling must not send");
  assert.equal(beforeRetry.observerInstalledBeforeApp, true);
  assert.equal(beforeRetry.timeOrigin, afterReload.timeOrigin);
  assert.ok(beforeRetry.observedAt > afterReload.observedAt);
  assert.ok(browser.responses[1].jsonObservedAt >= beforeRetry.observedAt);
  assert.equal(afterSuccess.timeOrigin, afterReload.timeOrigin);
  assert.ok(afterSuccess.observedAt >= browser.responses[1].jsonObservedAt);
  assert.equal(afterSuccess.receiptPostCount, 1);
  assert.deepEqual(browser.restoredBeforeReload, { removeItem: true, probe: true, fetch: true });
  assert.deepEqual(browser.restoredAfterReload, { fetch: true, probe: true, removeItemProbe: true });

  assert.equal(beforeRetryProxy.runId, proxy.runId);
  assert.equal(beforeRetryProxy.scenario, proxy.scenario);
  assert.equal(beforeRetryProxy.invoicePostCount, 0);
  assert.equal(beforeRetryProxy.receiptPostCount, 1, "No ingress before explicit confirmation");
  assert.deepEqual(beforeRetryProxy.events, [first]);
  for (const name of ["initialCounts", "initialJournals", "initialPaymentState"]) {
    assert.deepEqual(beforeRetryProxy[name], proxy[name]);
  }
  for (const evidence of [beforeRetryProxy, proxy]) {
    assert.deepEqual(evidence.finalCounts, first.counts);
    assert.deepEqual(evidence.finalJournals, first.journals);
    assert.deepEqual(evidence.finalReceipts, first.receipts);
    assert.deepEqual(evidence.finalPaymentState, first.paymentState);
    assert.ok(Number.isFinite(evidence.receiptsObservedAt));
  }
  // Never compare remote browser wall time with proxy/DB wall time.
  assert.ok(first.recordedAt <= beforeRetryProxy.receiptsObservedAt);
  assert.ok(beforeRetryProxy.receiptsObservedAt < retry.recordedAt);
  assert.ok(retry.recordedAt <= proxy.receiptsObservedAt);
  for (const name of ["companyId", "userId"]) {
    assert.ok(Number.isInteger(first.receipts[0][name]) && first.receipts[0][name] > 0);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = new URL("../generated-artifacts/verification/", import.meta.url);
  const load = (name) => JSON.parse(readFileSync(new URL(name, dir), "utf8"));
  checkReloadedReceiptCleanup(load("browser-identical-receipt-proxy.json"),
    load("browser-reloaded-receipt-cleanup.json"), load("browser-reloaded-receipt-cleanup-before-retry-proxy.json"));
  console.log("PASS: readable receipt success, failed cleanup, real reload without POST, original replay and one receipt/allocation/journal.");
}
