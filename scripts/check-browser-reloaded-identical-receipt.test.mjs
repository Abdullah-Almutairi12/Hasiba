import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { checkReloadedIdenticalReceipt } from "./check-browser-reloaded-identical-receipt.mjs";

function fixture() {
  const invoice = { id: 1, customerId: 1, total: 300, amountPaid: 0, status: "open" };
  const body = { customerId: 1, amount: 50, paymentMethod: "cash", allocations: [{ invoiceId: 1, amount: 50 }] };
  const requestBody = JSON.stringify(body);
  const hash = (s) => createHash("sha256").update(s).digest("hex");
  const receipts = [{ companyId: 1, userId: 1, operation: "POST:1:/sales/receipts", key: "old", paymentReceiptId: "1" }];
  const first = { upstreamStatus: 201, dropped: false, replayed: false, replayHeader: null,
    paymentReceiptId: 1, reference: "RCT-1", key: "old", recordedAt: 10000,
    body, bodyHash: hash(requestBody), storageKey: `hasba:financial-request:${hash(`/api/sales/receipts\n${requestBody}`)}`,
    counts: { invoices: 1, paymentReceipts: 1, receipts: 1 }, journals: [{ id: 10 }, { id: 11 }], receipts,
    paymentState: {
      payments: [{ id: 1, reference: "RCT-1", customerId: 1, amount: 50, paymentMethod: "cash", journalEntryId: 11 }],
      allocations: [{ receiptId: 1, invoiceId: 1, amount: 50 }],
      invoices: [{ ...invoice, amountPaid: 50, status: "partially_paid" }],
    } };
  const retry = { ...structuredClone(first), replayed: true, replayHeader: "true", recordedAt: 11000 };
  const recovery = { scenario: "identical-receipt", runId: "run",
    initialCounts: { invoices: 1, paymentReceipts: 0, receipts: 0 }, initialJournals: [{ id: 10 }],
    initialPaymentState: { payments: [], allocations: [], invoices: [invoice] },
    invoicePostCount: 0, receiptPostCount: 2, events: [first, retry],
    finalCounts: first.counts, finalJournals: first.journals,
    finalReceipts: receipts, finalPaymentState: first.paymentState, receiptsObservedAt: 12000 };
  const before = { ...structuredClone(recovery), receiptPostCount: 1,
    events: [structuredClone(first)], receiptsObservedAt: 10500 };
  const second = { ...structuredClone(first), paymentReceiptId: 2, reference: "RCT-2", key: "new", recordedAt: 13000,
    counts: { invoices: 1, paymentReceipts: 2, receipts: 2 }, journals: [{ id: 10 }, { id: 11 }, { id: 12 }],
    receipts: [...receipts, { ...receipts[0], key: "new", paymentReceiptId: "2" }],
    paymentState: {
      payments: [...first.paymentState.payments, { ...first.paymentState.payments[0], id: 2, reference: "RCT-2", journalEntryId: 12 }],
      allocations: [...first.paymentState.allocations, { receiptId: 2, invoiceId: 1, amount: 50 }],
      invoices: [{ ...invoice, amountPaid: 100, status: "partially_paid" }],
    } };
  const proxy = { ...structuredClone(recovery), events: [first, retry, second], receiptPostCount: 3,
    finalCounts: second.counts, finalJournals: second.journals, finalReceipts: second.receipts,
    finalPaymentState: second.paymentState, receiptsObservedAt: 14000 };
  const fields = { customerName: "Test", amount: "50", paymentMethod: "نقدي", invoiceReference: "INV-1", allocation: "50" };
  const entries = [{ storageKey: first.storageKey, key: first.key }];
  const restored = { removeItem: true, fetch: true, probe: true };
  const browser = { runId: "run", customerId: 1, customerName: "Test", invoiceReference: "INV-1",
    faultMethod: "removeItem", faultName: "SecurityError",
    beforeSave: { fields, observedAt: 100, timeOrigin: 50 },
    afterCleanupFailure: { fields, entries, formOpen: true, observedAt: 120, timeOrigin: 50,
      message: "تم حفظ العملية بالفعل، لكن تعذر تنظيف مفتاحها" },
    afterReload: { formClosed: true, entries, observedAt: 210, timeOrigin: 200, navigationType: "reload",
      receiptPostCount: 0, observerInstalledBeforeApp: true, readyStateAtInstall: "loading",
      observerTimeOrigin: 200, observerInstalledAt: 201 },
    beforeRetry: { formOpen: true, fields, entries, receiptPostCount: 0,
      observerInstalledBeforeApp: true, observedAt: 220, timeOrigin: 200 },
    afterSuccess: { formClosed: true, entries: [], visibleReceiptCount: 1, references: ["RCT-1"],
      receiptPostCount: 1, observedAt: 240, timeOrigin: 200 },
    afterNewForm: { formOpen: true, fields, entries: [], receiptPostCount: 1, observedAt: 250, timeOrigin: 200 },
    afterSecondSuccess: { formClosed: true, entries: [], visibleReceiptCount: 2, references: ["RCT-2", "RCT-1"],
      receiptPostCount: 2, observedAt: 280, timeOrigin: 200 },
    responses: [first, retry, second].map((e, i) => ({ status: 201,
      body: { id: e.paymentReceiptId, reference: e.reference }, key: e.key, requestBody,
      replayed: e.replayed, jsonObservedAt: [110, 230, 270][i] })),
    removalAttempts: [{ key: first.storageKey, at: 115 }],
    restored, restoredBeforeReload: restored,
    restoredAfterReload: { fetch: true, probe: true, removeItemProbe: true } };
  return [proxy, browser, before, recovery].map((v) => structuredClone(v));
}

test("accepts reload recovery followed by fresh identical intent with independent clocks", () => {
  checkReloadedIdenticalReceipt(...fixture());
});

const mutations = {
  "only original flow": (p) => { p.events.pop(); p.receiptPostCount = 2; },
  "extra POST": (p) => { p.receiptPostCount++; },
  "extra invoice POST": (p) => { p.invoicePostCount++; },
  "lost first response": (p) => { p.events[0].dropped = true; },
  "same key": (p) => { p.events[2].key = "old"; },
  "empty new key": (p) => { p.events[2].key = ""; },
  "same ID": (p) => { p.events[2].paymentReceiptId = 1; },
  "same reference": (p) => { p.events[2].reference = "RCT-1"; },
  "second replay": (p) => { p.events[2].replayed = true; },
  "replay header": (p) => { p.events[2].replayHeader = "true"; },
  "lost second response": (p) => { p.events[2].dropped = true; },
  "changed payload": (p) => { p.events[2].body.amount = 100; },
  "changed hash": (p) => { p.events[2].bodyHash = "a".repeat(64); },
  "changed fingerprint": (p) => { p.events[2].storageKey += "x"; },
  "paid only 50": (p) => { p.events[2].paymentState.invoices[0].amountPaid = 50; },
  "paid 150": (p) => { p.events[2].paymentState.invoices[0].amountPaid = 150; },
  "extra allocation": (p) => { p.events[2].paymentState.allocations.push({}); },
  "wrong allocation": (p) => { p.events[2].paymentState.allocations[1].amount = 100; },
  "reused journal": (p) => { p.events[2].paymentState.payments[1].journalEntryId = 11; },
  "extra journal": (p) => { p.events[2].journals.push({ id: 13 }); },
  "missing journal": (p) => { p.events[2].journals.pop(); },
  "changed original payment": (p) => { p.events[2].paymentState.payments[0].amount = 100; },
  "wrong financial link": (p) => { p.events[2].receipts[1].paymentReceiptId = "1"; },
  "wrong tenant": (p) => { p.events[2].receipts[1].companyId = 2; },
  "extra financial request": (p) => { p.events[2].receipts.push({}); },
  "stale final state": (p) => { p.finalPaymentState.invoices[0].amountPaid = 50; },
  "stale final count": (p) => { p.finalCounts.paymentReceipts = 1; },
  "stale final journals": (p) => { p.finalJournals.pop(); },
  "stale final links": (p) => { p.finalReceipts.pop(); },
  "stale final capture": (p) => { p.receiptsObservedAt = 12999; },
  "stale recovery run": (p, b, c, r) => { r.runId = "old"; },
  "missing recovery capture": (p, b, c, r) => { r.events.pop(); },
  "late recovery capture": (p, b, c, r) => { r.receiptsObservedAt = 14000; },
  "changed recovery accounting": (p, b, c, r) => { r.finalPaymentState.invoices[0].amountPaid = 100; },
  "not a real reload": (p, b) => { b.afterReload.timeOrigin = 50; },
  "reload auto send": (p, b) => { b.afterReload.receiptPostCount = 1; },
  "unclean original key": (p, b) => { b.afterSuccess.entries = [{}]; },
  "same open dialog": (p, b) => { b.afterSuccess.formClosed = false; },
  "new dialog closed": (p, b) => { b.afterNewForm.formOpen = false; },
  "new form changed": (p, b) => { b.afterNewForm.fields.amount = "100"; },
  "new form pending key": (p, b) => { b.afterNewForm.entries = [{}]; },
  "refill sends": (p, b) => { b.afterNewForm.receiptPostCount = 2; },
  "new form before recovery": (p, b) => { b.afterNewForm.observedAt = 239; },
  "unrelated new document": (p, b) => { b.afterNewForm.timeOrigin = 300; },
  "missing third browser response": (p, b) => { b.responses.pop(); },
  "third response wrong ID": (p, b) => { b.responses[2].body.id = 1; },
  "third response wrong key": (p, b) => { b.responses[2].key = "old"; },
  "third response different bytes": (p, b) => { b.responses[2].requestBody += " "; },
  "third browser replay": (p, b) => { b.responses[2].replayed = true; },
  "JSON before new form": (p, b) => { b.responses[2].jsonObservedAt = 249; },
  "unreadable JSON": (p, b) => { b.responses[2].body = null; },
  "only one visible row": (p, b) => { b.afterSecondSuccess.visibleReceiptCount = 1; },
  "duplicate visible row": (p, b) => { b.afterSecondSuccess.references = ["RCT-1", "RCT-1"]; },
  "second form stays open": (p, b) => { b.afterSecondSuccess.formClosed = false; },
  "second pending key": (p, b) => { b.afterSecondSuccess.entries = [{}]; },
  "extra browser send": (p, b) => { b.afterSecondSuccess.receiptPostCount = 3; },
  "unrestored observer": (p, b) => { b.restoredAfterReload.fetch = false; },
};
for (const [name, mutate] of Object.entries(mutations)) {
  test(`rejects ${name}`, () => {
    const args = fixture();
    mutate(...args);
    assert.throws(() => checkReloadedIdenticalReceipt(...args));
  });
}
