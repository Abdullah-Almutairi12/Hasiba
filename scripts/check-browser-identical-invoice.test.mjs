import { test } from "node:test";
import assert from "node:assert/strict";
import { checkBrowserRetry } from "./check-browser-retry.mjs";
import { checkBrowserIdenticalInvoice } from "./check-browser-identical-invoice.mjs";

function evidence() {
  const storageKey = `hasba:financial-request:${"a".repeat(64)}`;
  const receipt = { companyId: 1, userId: 1, operation: "invoice", key: "first-key", invoiceId: "1" };
  const first = {
    storageKey, key: receipt.key, bodyHash: "same-body", upstreamStatus: 201,
    invoiceId: 1, reference: "SINV-1", counts: { invoices: 1, receipts: 1 },
    receipts: [receipt], replayHeader: null, recordedAt: 100, dropped: true, replayed: false,
  };
  return structuredClone({
    proxy: { runId: "same-run", receiptsObservedAt: 305,
      finalReceipts: [receipt, { ...receipt, key: "second-key", invoiceId: "2" }], events: [
      first,
      { ...first, recordedAt: 200, dropped: false, replayed: true, replayHeader: "true" },
      {
        ...first, key: "second-key", recordedAt: 300, dropped: false,
        invoiceId: 2, reference: "SINV-2", counts: { invoices: 2, receipts: 2 },
        receipts: [receipt, { ...receipt, key: "second-key", invoiceId: "2" }],
      },
    ] },
    browser: {
      runId: "same-run",
      beforeReload: { observedAt: 110, timeOrigin: 1, entries: [[storageKey, first.key]] },
      afterReload: {
        observedAt: 130, timeOrigin: 120, navigationType: "reload", entries: [[storageKey, first.key]],
      },
      afterSuccess: {
        observedAt: 210, timeOrigin: 120, entries: [], formClosed: true,
        visibleInvoiceCount: 1, reference: "SINV-1",
      },
      afterNewForm: { observedAt: 220, timeOrigin: 120, entries: [], formOpen: true },
      afterSecondSuccess: {
        observedAt: 310, timeOrigin: 120, entries: [], formClosed: true,
        visibleInvoiceCount: 2, references: ["SINV-2", "SINV-1"],
      },
    },
  });
}

test("accepts a fresh identical invoice after recovering and clearing the first intent", () => {
  const { proxy, browser } = evidence();
  checkBrowserIdenticalInvoice(proxy, browser);
});

test("the original reload checker still rejects a third submission", () => {
  const { proxy, browser } = evidence();
  assert.throws(() => checkBrowserRetry(proxy, browser), /one form submission and one unchanged retry/);
});

test("a read-only final snapshot can prove links without rewriting earlier event snapshots", () => {
  const { proxy, browser } = evidence();
  // Older captures projected the wrong JSON path. Keep that evidence intact.
  for (const event of proxy.events) {
    event.receipts = event.receipts.map((receipt) => ({ ...receipt, invoiceId: null }));
  }
  checkBrowserIdenticalInvoice(proxy, browser);
});

for (const [name, mutate] of [
  ["only two requests", ({ proxy }) => proxy.events.pop()],
  ["extra request", ({ proxy }) => proxy.events.push(proxy.events[2])],
  ["old key reused", ({ proxy }) => { proxy.events[2].key = "first-key"; }],
  ["changed payload", ({ proxy }) => { proxy.events[2].bodyHash = "different"; }],
  ["different storage slot", ({ proxy }) => { proxy.events[2].storageKey += "b"; }],
  ["replayed second invoice", ({ proxy }) => { proxy.events[2].replayed = true; }],
  ["false replay header still present", ({ proxy }) => { proxy.events[2].replayHeader = "false"; }],
  ["missing header evidence", ({ proxy }) => { delete proxy.events[2].replayHeader; }],
  ["failed new save", ({ proxy }) => { proxy.events[2].upstreamStatus = 500; }],
  ["dropped new success", ({ proxy }) => { proxy.events[2].dropped = true; }],
  ["same invoice id", ({ proxy }) => { proxy.events[2].invoiceId = 1; }],
  ["same reference", ({ proxy }) => { proxy.events[2].reference = "SINV-1"; }],
  ["only one invoice", ({ proxy }) => { proxy.events[2].counts.invoices = 1; }],
  ["only one receipt", ({ proxy }) => { proxy.events[2].counts.receipts = 1; }],
  ["duplicate receipt identity", ({ proxy }) => { proxy.events[2].receipts[1] = proxy.events[2].receipts[0]; }],
  ["receipt linked to wrong invoice", ({ proxy }) => { proxy.finalReceipts[1].invoiceId = "1"; }],
  ["original receipt linked to wrong invoice", ({ proxy }) => { proxy.finalReceipts[0].invoiceId = "2"; }],
  ["missing final receipt", ({ proxy }) => { proxy.finalReceipts.pop(); }],
  ["stale receipt snapshot", ({ proxy }) => { proxy.receiptsObservedAt = 299; }],
  ["different final receipt identity", ({ proxy }) => { proxy.finalReceipts[1].key = "another-key"; }],
  ["original receipt replaced", ({ proxy }) => { proxy.events[2].receipts[0].invoiceId = "99"; }],
  ["replay changes receipt", ({ proxy }) => { proxy.events[1].receipts[0].invoiceId = "99"; }],
  ["receipt for a different tenant", ({ proxy }) => { proxy.events[2].receipts[1].companyId = 2; }],
  ["empty original receipt evidence", ({ proxy }) => { proxy.events[0].receipts = []; }],
  ["new form never opened", ({ browser }) => { browser.afterNewForm.formOpen = false; }],
  ["new form before confirmed success", ({ browser }) => { browser.afterNewForm.observedAt = 205; }],
  ["new form captured after save", ({ browser }) => { browser.afterNewForm.observedAt = 301; }],
  ["new form with pending key", ({ browser }) => { browser.afterNewForm.entries = browser.afterReload.entries; }],
  ["new form in another document", ({ browser }) => { browser.afterNewForm.timeOrigin = 250; }],
  ["new form missing", ({ browser }) => { delete browser.afterNewForm; }],
  ["success captured before save", ({ browser }) => { browser.afterSecondSuccess.observedAt = 299; }],
  ["uncleared second key", ({ browser }) => { browser.afterSecondSuccess.entries = browser.afterReload.entries; }],
  ["second form left open", ({ browser }) => { browser.afterSecondSuccess.formClosed = false; }],
  ["stale final list", ({ browser }) => { browser.afterSecondSuccess.visibleInvoiceCount = 1; }],
  ["duplicate visible reference", ({ browser }) => { browser.afterSecondSuccess.references = ["SINV-1", "SINV-1"]; }],
  ["different run", ({ browser }) => { browser.runId = "stale"; }],
  ["original retry not replayed", ({ proxy }) => { proxy.events[1].replayed = false; }],
]) {
  test(`rejects ${name}`, () => {
    const data = evidence();
    mutate(data);
    assert.throws(() => checkBrowserIdenticalInvoice(data.proxy, data.browser));
  });
}
