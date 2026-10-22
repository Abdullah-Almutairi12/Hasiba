import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkBrowserReopenedReturn } from "./check-browser-reopened-return.mjs";

export function checkBrowserReloadedReturnReadBlock(proxy, browser, blockedProxy) {
  checkBrowserReopenedReturn(proxy, browser, { reloadReadBlock: true });
  const first = proxy.events[0];
  assert.equal(browser.faultMethod, "getItem");
  assert.equal(browser.faultName, "SecurityError");
  assert.deepEqual(browser.blockedKeys, [first.storageKey]);
  assert.deepEqual(browser.financialWriteKeys, []);
  assert.deepEqual(browser.financialRemoveKeys, []);
  assert.equal(browser.unrelatedStorageWorked, true);
  assert.equal(browser.blockedReturnPostCount, 0);
  assert.equal(browser.recoveryReturnPostCount, 1);
  assert.equal(browser.afterBlockedSave.error,
    "تعذر حفظ مفتاح العملية بأمان. لم يُرسل الطلب؛ فعّل تخزين الجلسة وأعد المحاولة.");
  for (const key of ["originalGetItemRestored", "originalSetItemRestored",
    "originalRemoveItemRestored", "originalFetchRestored", "financialWriteReadRemoved"]) {
    assert.equal(browser.restored[key], true, key);
  }
  assert.equal(blockedProxy.runId, proxy.runId);
  assert.equal(blockedProxy.returnPostCount, 1, "No second ingress during blocked read");
  assert.equal(blockedProxy.invoicePostCount, 0);
  assert.equal(blockedProxy.receiptPostCount, 0);
  assert.deepEqual(blockedProxy.events, [first]);
  assert.deepEqual(blockedProxy.finalReceipts, first.receipts);
  assert.deepEqual(blockedProxy.finalReturnState, first.returnState);
  assert.ok(blockedProxy.receiptsObservedAt >= browser.afterBlockedSave.observedAt);
  assert.ok(blockedProxy.receiptsObservedAt < proxy.events[1].recordedAt);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = new URL("../generated-artifacts/verification/", import.meta.url);
  const load = (name) => JSON.parse(readFileSync(new URL(name, dir), "utf8"));
  checkBrowserReloadedReturnReadBlock(load("browser-identical-return-proxy.json"),
    load("browser-reloaded-return-read-block.json"), load("browser-reloaded-return-blocked-proxy.json"));
  console.log("PASS: reload read failure preserves uncertain key without POST/write/removal; restored retry replays once without restocking.");
}
