import { test } from "node:test";
import assert from "node:assert/strict";
import { checkBrowserRetry } from "./check-browser-retry.mjs";

function evidence() {
  const storageKey = `hasba:financial-request:${"a".repeat(64)}`;
  const event = {
    storageKey, key: "synthetic-request-key", bodyHash: "synthetic-body-digest",
    upstreamStatus: 201, invoiceId: 1, reference: "SINV-SYNTHETIC",
    counts: { invoices: 1, receipts: 1 },
  };
  return {
    proxy: { runId: "synthetic-run", events: [
      { ...structuredClone(event), recordedAt: 100, dropped: true, replayed: false },
      { ...structuredClone(event), recordedAt: 200, dropped: false, replayed: true },
    ] },
    browser: {
      runId: "synthetic-run",
      beforeReload: { observedAt: 110, timeOrigin: 1, entries: [[storageKey, event.key]] },
      afterReload: { observedAt: 130, timeOrigin: 120, navigationType: "reload", entries: [[storageKey, event.key]] },
      afterSuccess: {
        observedAt: 210, timeOrigin: 120, entries: [], formClosed: true,
        visibleInvoiceCount: 1, reference: event.reference,
      },
    },
  };
}

test("accepts an evidenced reload between lost commit and successful replay", () => {
  const { proxy, browser } = evidence();
  checkBrowserRetry(proxy, browser);
});

for (const [name, mutate] of [
  ["retrying the still-open form", ({ browser }) => { browser.afterReload.timeOrigin = 1; }],
  ["SPA navigation instead of reload", ({ browser }) => { browser.afterReload.navigationType = "navigate"; }],
  ["reload only after retry", ({ browser }) => { browser.afterReload.observedAt = 201; }],
  ["missing retained key", ({ browser }) => { browser.afterReload.entries = []; }],
  ["rotated retained key", ({ browser }) => { browser.afterReload.entries[0][1] = "another-key"; }],
  ["uncleared key after success", ({ browser }) => { browser.afterSuccess.entries = browser.afterReload.entries; }],
  ["stale browser evidence", ({ browser }) => { browser.runId = "old-run"; }],
  ["a duplicate invoice", ({ proxy }) => { proxy.events[1].counts.invoices = 2; }],
  ["an extra receipt", ({ proxy }) => { proxy.events[1].counts.receipts = 2; }],
  ["changed form body", ({ proxy }) => { proxy.events[1].bodyHash = "changed"; }],
  ["different invoice", ({ proxy }) => { proxy.events[1].invoiceId = 2; }],
  ["extra submission", ({ proxy }) => { proxy.events.push(proxy.events[1]); }],
  ["no original committed success", ({ proxy }) => { proxy.events[0].upstreamStatus = 500; }],
  ["non-replayed response", ({ proxy }) => { proxy.events[1].replayed = false; }],
  ["duplicate list row", ({ browser }) => { browser.afterSuccess.visibleInvoiceCount = 2; }],
  ["wrong visible reference", ({ browser }) => { browser.afterSuccess.reference = "OTHER"; }],
  ["form left open", ({ browser }) => { browser.afterSuccess.formClosed = false; }],
]) {
  test(`rejects ${name}`, () => {
    const data = evidence();
    mutate(data);
    assert.throws(() => checkBrowserRetry(data.proxy, data.browser));
  });
}
