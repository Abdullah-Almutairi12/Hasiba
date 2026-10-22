import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkRepeatedReceiptCleanup } from "./check-browser-repeated-receipt-cleanup.mjs";

// Validate every split before projecting onto the unchanged single-invoice
// lifecycle guard. Projection only reuses transport/storage/UI timing checks;
// no original evidence is mutated and no split or invoice can be omitted.
export function checkMultiReceiptCleanup(proxy, browser) {
  const invoices = proxy.initialPaymentState.invoices;
  assert.equal(invoices.length, 2);
  assert.notEqual(invoices[0].id, invoices[1].id);
  assert.equal(invoices[0].customerId, invoices[1].customerId);
  assert.deepEqual(proxy.initialCounts, { invoices: 2, paymentReceipts: 0, receipts: 0 });
  for (const invoice of invoices) {
    assert.equal(invoice.amountPaid, 0);
    assert.equal(invoice.status, "open");
    assert.ok(invoice.total > 100);
  }
  assert.equal(browser.invoiceReferences.length, 2);
  assert.equal(new Set(browser.invoiceReferences).size, 2);
  assert.ok(browser.invoiceReferences.every((r) => typeof r === "string" && r.length));
  const fields = { customerName: browser.customerName, amount: "50", paymentMethod: "نقدي",
    allocations: browser.invoiceReferences.map((invoiceReference, i) => ({
      invoiceReference, amount: String(i === 0 ? 20 : 30),
    })) };
  const stages = [browser.beforeSave, ...browser.cleanupFailures, browser.beforeRecovery, browser.afterNewForm];
  for (const stage of stages) assert.deepEqual(stage.fields, fields);
  const expectedBody = { customerId: invoices[0].customerId, amount: 50, paymentMethod: "cash",
    allocations: invoices.map((invoice, i) => ({ invoiceId: invoice.id, amount: i === 0 ? 20 : 30 })) };
  const n = browser.cleanupFailures.length;
  function checkState(state, count) {
    assert.equal(state.payments.length, count);
    assert.equal(state.allocations.length, count * 2);
    assert.deepEqual(state.invoices, invoices.map((invoice, i) => ({
      ...invoice, amountPaid: count * (i === 0 ? 20 : 30), status: "partially_paid",
    })));
    for (const payment of state.payments) {
      assert.equal(payment.amount, 50);
      assert.deepEqual(state.allocations.filter((a) => a.receiptId === payment.id),
        invoices.map((invoice, i) => ({ receiptId: payment.id, invoiceId: invoice.id, amount: i === 0 ? 20 : 30 })));
    }
  }
  for (const [i, event] of proxy.events.entries()) {
    assert.deepEqual(event.body, expectedBody);
    assert.equal(event.counts.invoices, 2);
    checkState(event.paymentState, i === n + 1 ? 2 : 1);
    assert.equal(browser.responses[i].requestBody, browser.responses[0].requestBody);
    assert.deepEqual(JSON.parse(browser.responses[i].requestBody), expectedBody);
    const hash = (s) => createHash("sha256").update(s).digest("hex");
    assert.equal(event.bodyHash, hash(browser.responses[i].requestBody));
    assert.equal(event.storageKey, `hasba:financial-request:${hash(`/api/sales/receipts\n${browser.responses[i].requestBody}`)}`);
  }
  assert.equal(proxy.finalCounts.invoices, 2);
  checkState(proxy.finalPaymentState, 2);
  assert.deepEqual(proxy.finalPaymentState, proxy.events.at(-1).paymentState);
  // Independent raw snapshot equality proves that neither split, balance,
  // journal nor linked financial request changes on any confirmation.
  for (const event of proxy.events.slice(1, n + 1)) {
    for (const key of ["paymentState", "journals", "receipts"]) {
      assert.deepEqual(event[key], proxy.events[0][key]);
    }
  }
  const p = structuredClone(proxy);
  const b = structuredClone(browser);
  const projectState = (state) => ({
    ...state,
    invoices: [{ ...state.invoices[0], amountPaid: state.invoices.reduce((s, i) => s + i.amountPaid, 0) }],
    allocations: state.payments.map((payment) => ({ receiptId: payment.id, invoiceId: invoices[0].id, amount: 50 })),
  });
  p.initialCounts.invoices = 1;
  p.initialPaymentState = projectState(p.initialPaymentState);
  p.finalCounts.invoices = 1;
  p.finalPaymentState = projectState(p.finalPaymentState);
  const legacyBody = { ...expectedBody, allocations: [{ invoiceId: invoices[0].id, amount: 50 }] };
  const requestBody = JSON.stringify(legacyBody);
  const hash = (s) => createHash("sha256").update(s).digest("hex");
  const storageKey = `hasba:financial-request:${hash(`/api/sales/receipts\n${requestBody}`)}`;
  for (const event of p.events) {
    event.counts.invoices = 1;
    event.paymentState = projectState(event.paymentState);
    event.body = legacyBody;
    event.bodyHash = hash(requestBody);
    event.storageKey = storageKey;
  }
  for (const response of b.responses) response.requestBody = requestBody;
  b.invoiceReference = browser.invoiceReferences[0];
  for (const stage of [b.beforeSave, ...b.cleanupFailures, b.beforeRecovery, b.afterNewForm]) {
    stage.fields = { customerName: b.customerName, amount: "50", paymentMethod: "نقدي",
      invoiceReference: b.invoiceReference, allocation: "50" };
  }
  // Verify raw key identity before replacing just the payload fingerprint.
  for (const stage of [...b.cleanupFailures, b.beforeRecovery]) {
    assert.deepEqual(stage.entries, [{ storageKey: proxy.events[0].storageKey, key: proxy.events[0].key }]);
    stage.entries = [{ storageKey, key: proxy.events[0].key }];
  }
  for (const attempt of b.removalAttempts) {
    assert.equal(attempt.key, proxy.events[0].storageKey);
    attempt.key = storageKey;
  }
  checkRepeatedReceiptCleanup(p, b);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = "generated-artifacts/verification";
  checkMultiReceiptCleanup(
    JSON.parse(readFileSync(`${dir}/browser-identical-receipt-proxy.json`, "utf8")),
    JSON.parse(readFileSync(`${dir}/browser-multi-receipt-cleanup.json`, "utf8")),
  );
  console.log("PASS: both receipt allocations and invoice balances remain stable through repeated cleanup failures and recovery");
}
