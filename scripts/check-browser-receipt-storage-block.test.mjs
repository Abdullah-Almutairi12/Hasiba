import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { checkReceiptStorageBlock } from "./check-browser-receipt-storage-block.mjs";

function evidence() {
  const invoice = { id: 11, customerId: 4, total: 300, amountPaid: 0, status: "open" };
  const body = { customerId: 4, amount: 50, paymentMethod: "cash", allocations: [{ invoiceId: 11, amount: 50 }] };
  const digest = (s) => createHash("sha256").update(s).digest("hex");
  const storageKey = `hasba:financial-request:${digest(`/api/sales/receipts\n${JSON.stringify(body)}`)}`;
  const fields = { customerName: "Synthetic customer", amount: "50", paymentMethod: "نقدي",
    invoiceReference: "INV-FIXTURE", allocation: "50" };
  const open = (observedAt) => ({ observedAt, timeOrigin: 100, formOpen: true, fields: { ...fields }, entries: [] });
  const blocked = {
    runId: "disposable", scenario: "identical-receipt", startedAt: 1000, capturedAt: 2000,
    receiptPostCount: 0, invoicePostCount: 0, returnPostCount: 0, events: [], arrivals: [],
    initialCounts: { invoices: 1, paymentReceipts: 0, receipts: 0 },
    initialJournals: [{ id: 1 }],
    initialPaymentState: { payments: [], allocations: [], invoices: [invoice] },
  };
  Object.assign(blocked, { finalCounts: structuredClone(blocked.initialCounts),
    finalJournals: structuredClone(blocked.initialJournals), finalReceipts: [],
    finalPaymentState: structuredClone(blocked.initialPaymentState) });
  const event = { body, bodyHash: digest(JSON.stringify(body)), storageKey, key: "synthetic-key",
    upstreamStatus: 201, replayed: false, replayHeader: null, dropped: false, recordedAt: 3001,
    paymentReceiptId: 3, reference: "RCT-FIXTURE",
    counts: { invoices: 1, paymentReceipts: 1, receipts: 1 },
    receipts: [{ companyId: 1, userId: 1, operation: "POST:1:/sales/receipts",
      key: "synthetic-key", paymentReceiptId: "3" }],
    journals: [{ id: 1 }, { id: 2 }],
    paymentState: { payments: [{ id: 3, reference: "RCT-FIXTURE", customerId: 4,
      amount: 50, paymentMethod: "cash", journalEntryId: 2 }],
    allocations: [{ receiptId: 3, invoiceId: 11, amount: 50 }],
    invoices: [{ ...invoice, amountPaid: 50, status: "partially_paid" }] },
  };
  const final = { ...structuredClone(blocked), receiptPostCount: 1, arrivals: [{ arrivedAt: 3000 }],
    events: [event], finalCounts: structuredClone(event.counts), finalJournals: structuredClone(event.journals),
    finalReceipts: structuredClone(event.receipts), finalPaymentState: structuredClone(event.paymentState),
    receiptsObservedAt: 4000 };
  const browser = {
    runId: "disposable", customerId: 4, customerName: fields.customerName, invoiceReference: fields.invoiceReference,
    faultMethod: "setItem", faultName: "SecurityError", blockedKeys: [storageKey],
    blockedReceiptPostCount: 0, recoveryReceiptPostCount: 1, unrelatedStorageWorked: true,
    beforeSave: open(110), afterBlockedSave: { ...open(120),
      error: "تعذر حفظ مفتاح العملية بأمان. لم يُرسل الطلب؛ فعّل تخزين الجلسة وأعد المحاولة." },
    restored: { ...open(130), originalGetItemRestored: true, originalSetItemRestored: true,
      originalRemoveItemRestored: true, originalFetchRestored: true, financialWriteReadRemoved: true },
    afterSuccess: { observedAt: 150, timeOrigin: 100, entries: [], formClosed: true,
      visibleReceiptCount: 1, references: ["RCT-FIXTURE"] },
    responses: [{ status: 201, replayed: false, key: event.key, requestBody: JSON.stringify(body),
      body: { id: 3, reference: event.reference }, jsonObservedAt: 140 }],
    finalRestored: { originalFetchRestored: true, originalSetItemRestored: true },
  };
  return { blocked, browser, final };
}

test("accepts first-write no-send and one normal allocated receipt recovery, with independent clocks", () => {
  const { blocked, browser, final } = evidence();
  checkReceiptStorageBlock(blocked, browser, final);
});

for (const [name, mutate] of [
  ["stale blocked capture", (p) => { p.runId = "other"; }],
  ["stale final capture", (_p, _b, f) => { f.runId = "other"; }],
  ["receipt ingress even without event", (p) => { p.receiptPostCount = 1; }],
  ["invoice ingress", (p) => { p.invoicePostCount = 1; }],
  ["return ingress", (p) => { p.returnPostCount = 1; }],
  ["pending arrival", (p) => { p.arrivals.push({ arrivedAt: 1500 }); }],
  ["successful event before recovery", (p) => { p.events.push({}); }],
  ["receipt created during block", (p) => { p.finalCounts.paymentReceipts = 1; }],
  ["financial request created during block", (p) => { p.finalReceipts.push({}); }],
  ["new journal during block", (p) => { p.finalJournals.push({ id: 3 }); }],
  ["allocation during block", (p) => { p.finalPaymentState.allocations.push({}); }],
  ["invoice collection during block", (p) => { p.finalPaymentState.invoices[0].amountPaid = 50; }],
  ["browser sent blocked POST", (_p, b) => { b.blockedReceiptPostCount = 1; }],
  ["no recovery POST", (_p, b) => { b.recoveryReceiptPostCount = 0; }],
  ["duplicate recovery POST", (_p, b) => { b.recoveryReceiptPostCount = 2; }],
  ["validation only", (_p, b) => { b.blockedKeys = []; }],
  ["wrong operation fingerprint", (_p, b) => { b.blockedKeys = [`hasba:financial-request:${"a".repeat(64)}`]; }],
  ["duplicate failed attempts", (_p, b) => { b.blockedKeys.push(b.blockedKeys[0]); }],
  ["read fault instead", (_p, b) => { b.faultMethod = "getItem"; }],
  ["wrong fault name", (_p, b) => { b.faultName = "Error"; }],
  ["unrelated storage blocked", (_p, b) => { b.unrelatedStorageWorked = false; }],
  ["pre-existing intent", (_p, b) => { b.beforeSave.entries.push(["key", "value"]); }],
  ["intent persisted despite failure", (_p, b) => { b.afterBlockedSave.entries.push(["key", "value"]); }],
  ["form closed", (_p, b) => { b.afterBlockedSave.formOpen = false; }],
  ["lost amount", (_p, b) => { b.afterBlockedSave.fields.amount = "0"; }],
  ["lost allocation", (_p, b) => { b.restored.fields.allocation = ""; }],
  ["unhelpful error", (_p, b) => { b.afterBlockedSave.error = "بيانات ناقصة"; }],
  ["reload instead of same form", (_p, b) => { b.restored.timeOrigin = 125; }],
  ["unordered browser evidence", (_p, b) => { b.restored.observedAt = 115; }],
  ...["originalGetItemRestored", "originalSetItemRestored", "originalRemoveItemRestored",
    "originalFetchRestored", "financialWriteReadRemoved"].map((flag) =>
    [`missing restored ${flag}`, (_p, b) => { b.restored[flag] = false; }]),
  ["recovery before DB check", (_p, _b, f) => { f.arrivals[0].arrivedAt = 1900; }],
  ["replay instead of new save", (_p, _b, f) => { f.events[0].replayed = true; }],
  ["response dropped", (_p, _b, f) => { f.events[0].dropped = true; }],
  ["upstream rejection", (_p, _b, f) => { f.events[0].upstreamStatus = 400; }],
  ["wrong recovery allocation", (_p, _b, f) => { f.events[0].body.allocations[0].amount = 25; }],
  ["duplicate financial request", (_p, _b, f) => { f.events[0].receipts.push({}); }],
  ["wrong journal", (_p, _b, f) => { f.events[0].journals.push({ id: 9 }); }],
  ["wrong collected amount", (_p, _b, f) => { f.finalPaymentState.invoices[0].amountPaid = 100; }],
  ["wrong response body", (_p, b) => { b.responses[0].body.id = 99; }],
  ["wrong response key", (_p, b) => { b.responses[0].key = "other"; }],
  ["wrong response request", (_p, b) => { b.responses[0].requestBody = "{}"; }],
  ["browser replay", (_p, b) => { b.responses[0].replayed = true; }],
  ["duplicate responses", (_p, b) => { b.responses.push(b.responses[0]); }],
  ["pending key after success", (_p, b) => { b.afterSuccess.entries.push(["key", "value"]); }],
  ["dialog stays open after recovery", (_p, b) => { b.afterSuccess.formClosed = false; }],
  ["duplicate list rows", (_p, b) => { b.afterSuccess.visibleReceiptCount = 2; }],
  ["wrong visible reference", (_p, b) => { b.afterSuccess.references = ["RCT-OTHER"]; }],
  ["observer not restored", (_p, b) => { b.finalRestored.originalFetchRestored = false; }],
]) {
  test(`rejects ${name}`, () => {
    const { blocked, browser, final } = evidence();
    mutate(blocked, browser, final);
    assert.throws(() => checkReceiptStorageBlock(blocked, browser, final));
  });
}
