import { test } from "node:test";
import assert from "node:assert/strict";
import { checkBrowserIdenticalReceipt } from "./check-browser-identical-receipt.mjs";

function evidence() {
  const storageKey = `hasba:financial-request:${"a".repeat(64)}`;
  const invoice = { id: 10, customerId: 1, total: 300, amountPaid: 0, status: "open" };
  const receipt = { companyId: 1, userId: 1, operation: "POST:/api:/sales/receipts",
    key: "first-key", paymentReceiptId: "1" };
  const secondReceipt = { ...receipt, key: "second-key", paymentReceiptId: "2" };
  const firstPayment = { id: 1, reference: "RCT-1", customerId: 1, amount: 50,
    paymentMethod: "cash", journalEntryId: 20 };
  const secondPayment = { ...firstPayment, id: 2, reference: "RCT-2", journalEntryId: 21 };
  const paymentState = {
    payments: [firstPayment],
    allocations: [{ receiptId: 1, invoiceId: 10, amount: 50 }],
    invoices: [{ ...invoice, amountPaid: 50, status: "partially_paid" }],
  };
  const finalPaymentState = {
    payments: [firstPayment, secondPayment],
    allocations: [...paymentState.allocations, { receiptId: 2, invoiceId: 10, amount: 50 }],
    invoices: [{ ...invoice, amountPaid: 100, status: "partially_paid" }],
  };
  const first = {
    storageKey, key: receipt.key, bodyHash: "b".repeat(64), upstreamStatus: 201,
    body: { customerId: 1, amount: 50, paymentMethod: "cash", allocations: [{ invoiceId: 10, amount: 50 }] },
    paymentReceiptId: 1, reference: "RCT-1", recordedAt: 100,
    counts: { invoices: 1, paymentReceipts: 1, receipts: 1 }, receipts: [receipt],
    paymentState, dropped: true, replayed: false, replayHeader: null,
  };
  const fields = { customerName: "Synthetic", amount: "50", paymentMethod: "نقدي",
    invoiceReference: "SINV-VERIFY", allocation: "50" };
  return structuredClone({
    proxy: {
      scenario: "identical-receipt", runId: "same-run", receiptPostCount: 3, invoicePostCount: 0,
      initialCounts: { invoices: 1, paymentReceipts: 0, receipts: 0 },
      initialPaymentState: { payments: [], allocations: [], invoices: [invoice] },
      receiptsObservedAt: 305, finalReceipts: [receipt, secondReceipt], finalPaymentState,
      events: [
        first,
        { ...first, recordedAt: 200, dropped: false, replayed: true, replayHeader: "true" },
        { ...first, recordedAt: 300, dropped: false, key: "second-key",
          paymentReceiptId: 2, reference: "RCT-2",
          counts: { invoices: 1, paymentReceipts: 2, receipts: 2 },
          receipts: [receipt, secondReceipt], paymentState: finalPaymentState },
      ],
    },
    browser: {
      runId: "same-run", customerName: "Synthetic", invoiceReference: "SINV-VERIFY",
      beforeRetry: { observedAt: 110, timeOrigin: 1, entries: [[storageKey, receipt.key]], formOpen: true, fields },
      afterSuccess: { observedAt: 210, timeOrigin: 1, entries: [], formClosed: true,
        visibleReceiptCount: 1, references: ["RCT-1"] },
      afterNewForm: { observedAt: 220, timeOrigin: 1, entries: [], formOpen: true, fields },
      afterSecondSuccess: { observedAt: 310, timeOrigin: 1, entries: [], formClosed: true,
        visibleReceiptCount: 2, references: ["RCT-2", "RCT-1"] },
    },
  });
}

test("accepts confirmed recovery followed by a legitimate identical receipt", () => {
  const { proxy, browser } = evidence();
  checkBrowserIdenticalReceipt(proxy, browser);
});

for (const [name, mutate] of [
  ["missing request", ({ proxy }) => proxy.events.pop()],
  ["extra request arrival", ({ proxy }) => { proxy.receiptPostCount++; }],
  ["unrelated invoice POST", ({ proxy }) => { proxy.invoicePostCount++; }],
  ["stale run", ({ browser }) => { browser.runId = "old"; }],
  ["no initial balance", ({ proxy }) => { proxy.initialPaymentState.invoices[0].total = 50; }],
  ["existing payment", ({ proxy }) => { proxy.initialCounts.paymentReceipts = 1; }],
  ["first response not dropped", ({ proxy }) => { proxy.events[0].dropped = false; }],
  ["retry not replayed", ({ proxy }) => { proxy.events[1].replayed = false; }],
  ["retry missing header", ({ proxy }) => { proxy.events[1].replayHeader = null; }],
  ["retry key rotated", ({ proxy }) => { proxy.events[1].key = "rotated"; }],
  ["new key reused", ({ proxy }) => { proxy.events[2].key = "first-key"; }],
  ["new result replayed", ({ proxy }) => { proxy.events[2].replayed = true; }],
  ["false header is still a header", ({ proxy }) => { proxy.events[2].replayHeader = "false"; }],
  ["no header evidence", ({ proxy }) => { delete proxy.events[2].replayHeader; }],
  ["failed new save", ({ proxy }) => { proxy.events[2].upstreamStatus = 500; }],
  ["changed data", ({ proxy }) => { proxy.events[2].body.allocations[0].amount = 40; }],
  ["changed hash", ({ proxy }) => { proxy.events[2].bodyHash = "c".repeat(64); }],
  ["changed slot", ({ proxy }) => { proxy.events[2].storageKey += "b"; }],
  ["same receipt", ({ proxy }) => { proxy.events[2].paymentReceiptId = 1; }],
  ["same reference", ({ proxy }) => { proxy.events[2].reference = "RCT-1"; }],
  ["only one document", ({ proxy }) => { proxy.events[2].counts.paymentReceipts = 1; }],
  ["only one retry receipt", ({ proxy }) => { proxy.events[2].counts.receipts = 1; }],
  ["duplicate identity", ({ proxy }) => { proxy.events[2].receipts[1] = proxy.events[2].receipts[0]; }],
  ["wrong tenant", ({ proxy }) => { proxy.events[2].receipts[1].companyId = 2; }],
  ["wrong user", ({ proxy }) => { proxy.events[2].receipts[1].userId = 2; }],
  ["wrong operation", ({ proxy }) => { proxy.events[2].receipts[1].operation += "/wrong"; }],
  ["wrong saved document link", ({ proxy }) => { proxy.finalReceipts[1].paymentReceiptId = "1"; }],
  ["missing saved receipt", ({ proxy }) => { proxy.finalReceipts.pop(); }],
  ["stale snapshot", ({ proxy }) => { proxy.receiptsObservedAt = 299; }],
  ["replay applied twice", ({ proxy }) => { proxy.events[1].paymentState.invoices[0].amountPaid = 100; }],
  ["extra final allocation", ({ proxy }) => { proxy.finalPaymentState.allocations.push({}); }],
  ["wrong new allocation", ({ proxy }) => { proxy.events[2].paymentState.allocations[1].amount = 40; }],
  ["journal reused", ({ proxy }) => { proxy.events[2].paymentState.payments[1].journalEntryId = 20; }],
  ["missing original key", ({ browser }) => { browser.beforeRetry.entries = []; }],
  ["uncertain dialog closed", ({ browser }) => { browser.beforeRetry.formOpen = false; }],
  ["confirmation before replay", ({ browser }) => { browser.afterSuccess.observedAt = 199; }],
  ["new form before confirmation", ({ browser }) => { browser.afterNewForm.observedAt = 205; }],
  ["new form after save", ({ browser }) => { browser.afterNewForm.observedAt = 301; }],
  ["new form missing", ({ browser }) => { delete browser.afterNewForm; }],
  ["new form not open", ({ browser }) => { browser.afterNewForm.formOpen = false; }],
  ["different new fields", ({ browser }) => { browser.afterNewForm.fields.amount = "40"; }],
  ["key not cleared", ({ browser }) => { browser.afterSuccess.entries = browser.beforeRetry.entries; }],
  ["new form retained key", ({ browser }) => { browser.afterNewForm.entries = browser.beforeRetry.entries; }],
  ["second key retained", ({ browser }) => { browser.afterSecondSuccess.entries = browser.beforeRetry.entries; }],
  ["reload instead of in-place retry", ({ browser }) => { browser.afterSuccess.timeOrigin = 120; }],
  ["second form not closed", ({ browser }) => { browser.afterSecondSuccess.formClosed = false; }],
  ["stale final list", ({ browser }) => { browser.afterSecondSuccess.visibleReceiptCount = 1; }],
  ["duplicate final reference", ({ browser }) => { browser.afterSecondSuccess.references = ["RCT-1", "RCT-1"]; }],
]) {
  test(`rejects ${name}`, () => {
    const data = evidence();
    mutate(data);
    assert.throws(() => checkBrowserIdenticalReceipt(data.proxy, data.browser));
  });
}
