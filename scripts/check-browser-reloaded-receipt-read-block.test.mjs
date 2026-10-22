import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { checkReloadedReceiptReadBlock as check } from "./check-browser-reloaded-receipt-read-block.mjs";

function evidence() {
  const invoice = { id: 1, customerId: 1, total: 300, amountPaid: 0, status: "open" };
  const body = { customerId: 1, amount: 50, paymentMethod: "cash", allocations: [{ invoiceId: 1, amount: 50 }] };
  const digest = (s) => createHash("sha256").update(s).digest("hex");
  const storageKey = `hasba:financial-request:${digest(`/api/sales/receipts\n${JSON.stringify(body)}`)}`;
  const first = { recordedAt: 100, key: "synthetic-intent", body, storageKey,
    bodyHash: digest(JSON.stringify(body)), upstreamStatus: 201,
    dropped: true, replayed: false, replayHeader: null, paymentReceiptId: 1, reference: "RCT-1",
    counts: { invoices: 1, paymentReceipts: 1, receipts: 1 }, journals: [{ id: 10 }, { id: 11 }],
    receipts: [{ companyId: 1, userId: 1, operation: "POST:/api:/sales/receipts",
      key: "synthetic-intent", paymentReceiptId: "1" }],
    paymentState: {
      payments: [{ id: 1, reference: "RCT-1", customerId: 1, amount: 50, paymentMethod: "cash", journalEntryId: 11 }],
      allocations: [{ receiptId: 1, invoiceId: 1, amount: 50 }],
      invoices: [{ ...invoice, amountPaid: 50, status: "partially_paid" }],
    } };
  const proxy = { runId: "synthetic-run", scenario: "identical-receipt",
    initialCounts: { invoices: 1, paymentReceipts: 0, receipts: 0 }, initialJournals: [{ id: 10 }],
    initialPaymentState: { payments: [], allocations: [], invoices: [invoice] },
    invoicePostCount: 0, returnPostCount: 0, receiptPostCount: 2,
    events: [first, { ...structuredClone(first), recordedAt: 200, dropped: false, replayed: true, replayHeader: "true" }],
    finalCounts: structuredClone(first.counts), finalJournals: structuredClone(first.journals),
    finalReceipts: structuredClone(first.receipts), finalPaymentState: structuredClone(first.paymentState),
    receiptsObservedAt: 220 };
  const fields = { customerName: "Synthetic customer", amount: "50", paymentMethod: "نقدي",
    invoiceReference: "SINV-1", allocation: "50" };
  const stage = (observedAt, timeOrigin = 120) => ({ observedAt, timeOrigin,
    formOpen: true, entries: [[storageKey, first.key]], fields: structuredClone(fields) });
  const browser = { runId: proxy.runId, customerId: 1, customerName: fields.customerName,
    invoiceReference: fields.invoiceReference, afterLostResponse: stage(110, 1),
    beforeBlockedSave: { ...stage(130), navigationType: "reload" },
    afterBlockedSave: { ...stage(140),
      error: "تعذر حفظ مفتاح العملية بأمان. لم يُرسل الطلب؛ فعّل تخزين الجلسة وأعد المحاولة." },
    restored: { ...stage(150), originalGetItemRestored: true, originalSetItemRestored: true,
      originalRemoveItemRestored: true, originalFetchRestored: true, financialWriteReadRemoved: true },
    afterSuccess: { observedAt: 210, timeOrigin: 120, formClosed: true, entries: [],
      visibleReceiptCount: 1, references: ["RCT-1"] },
    faultMethod: "getItem", faultName: "SecurityError", blockedKeys: [storageKey],
    financialWriteKeys: [], financialRemoveKeys: [], unrelatedStorageWorked: true,
    blockedReceiptPostCount: 0, recoveryReceiptPostCount: 1 };
  const blocked = structuredClone(proxy);
  blocked.receiptPostCount = 1;
  blocked.events.pop();
  blocked.receiptsObservedAt = 160;
  return [proxy, browser, blocked];
}

test("accepts real receipt reload, read-only fault, no send and unchanged replay", () => check(...evidence()));

const mutations = [
  ["wrong scenario", ([p]) => { p.scenario = "identical-return"; }],
  ["missing run", ([p]) => { p.runId = ""; }],
  ["browser from another run", ([, b]) => { b.runId = "other"; }],
  ["nonempty initial receipts", ([p]) => { p.initialCounts.receipts++; }],
  ["initial payment exists", ([p]) => { p.initialPaymentState.payments.push({}); }],
  ["initial allocation exists", ([p]) => { p.initialPaymentState.allocations.push({}); }],
  ["initial invoice paid", ([p]) => { p.initialPaymentState.invoices[0].amountPaid = 50; }],
  ["extra initial invoice", ([p]) => { p.initialPaymentState.invoices.push({}); }],
  ["wrong fixture total", ([p]) => { p.initialPaymentState.invoices[0].total = 100; }],
  ["wrong customer", ([, b]) => { b.customerId = 2; }],
  ["blank customer", ([, b]) => { b.customerName = ""; }],
  ["blank invoice reference", ([, b]) => { b.invoiceReference = ""; }],
  ["invoice setup POST", ([p]) => { p.invoicePostCount++; }],
  ["unrelated return POST", ([p]) => { p.returnPostCount++; }],
  ["extra receipt POST", ([p]) => { p.receiptPostCount++; }],
  ["missing replay event", ([p]) => { p.events.pop(); }],
  ["wrong payload", ([p]) => { p.events[0].body.amount = 100; }],
  ["wrong digest", ([p]) => { p.events[0].bodyHash = "bad"; }],
  ["wrong fingerprint", ([p]) => { p.events[0].storageKey = "bad"; }],
  ["empty key", ([p]) => { p.events[0].key = ""; }],
  ["invalid receipt id", ([p]) => { p.events[0].paymentReceiptId = 0; }],
  ["wrong reference", ([p]) => { p.events[0].reference = "SINV-1"; }],
  ["success not dropped", ([p]) => { p.events[0].dropped = false; }],
  ["first was replay", ([p]) => { p.events[0].replayed = true; }],
  ["first replay header", ([p]) => { p.events[0].replayHeader = "true"; }],
  ["retry dropped", ([p]) => { p.events[1].dropped = true; }],
  ["retry not replayed", ([p]) => { p.events[1].replayed = false; }],
  ["retry missing replay header", ([p]) => { p.events[1].replayHeader = null; }],
  ["failed upstream", ([p]) => { p.events[0].upstreamStatus = 502; }],
  ["invalid commit timestamp", ([p]) => { p.events[0].recordedAt = null; }],
  ["wrong financial operation", ([p]) => { p.events[0].receipts[0].operation = "POST:/api:/sales/invoices"; }],
  ["orphan financial receipt", ([p]) => { p.events[0].receipts[0].paymentReceiptId = "2"; }],
  ["missing tenant identity", ([p]) => { p.events[0].receipts[0].companyId = 0; }],
  ["missing user identity", ([p]) => { p.events[0].receipts[0].userId = 0; }],
  ["wrong financial key", ([p]) => { p.events[0].receipts[0].key = "other"; }],
  ["missing journal link", ([p]) => { p.events[0].paymentState.payments[0].journalEntryId = null; }],
  ["journal already existed", ([p]) => { p.initialJournals.push({ id: 11 }); }],
  ["double invoice payment", ([p]) => { p.events[0].paymentState.invoices[0].amountPaid = 100; }],
  ["duplicate allocation", ([p]) => { p.events[0].paymentState.allocations.push({}); }],
  ["duplicate payment", ([p]) => { p.events[0].paymentState.payments.push({}); }],
  ["extra receipt", ([p]) => { p.events[0].receipts.push({}); }],
  ["extra journal", ([p]) => { p.events[0].journals.push({ id: 12 }); }],
  ["extra document count", ([p]) => { p.events[0].counts.paymentReceipts++; }],
  ["same time origin", ([, b]) => { b.afterLostResponse.timeOrigin = b.beforeBlockedSave.timeOrigin; }],
  ["reload before loss", ([, b]) => { b.beforeBlockedSave.timeOrigin = 105; }],
  ["not reload navigation", ([, b]) => { b.beforeBlockedSave.navigationType = "navigate"; }],
  ["snapshot before commit", ([, b]) => { b.afterLostResponse.observedAt = 99; }],
  ["out of order snapshots", ([, b]) => { b.restored.observedAt = 139; }],
  ["early replay", ([p]) => { p.events[1].recordedAt = 149; }],
  ["success before response", ([, b]) => { b.afterSuccess.observedAt = 199; }],
  ["stale final capture", ([p]) => { p.receiptsObservedAt = 209; }],
  ["wrong fault method", ([, b]) => { b.faultMethod = "setItem"; }],
  ["wrong exception", ([, b]) => { b.faultName = "Error"; }],
  ["wrong rejected key", ([, b]) => { b.blockedKeys = ["other"]; }],
  ["multiple rejected reads", ([, b]) => { b.blockedKeys.push(b.blockedKeys[0]); }],
  ["financial write attempted", ([, b]) => { b.financialWriteKeys.push("other"); }],
  ["financial removal attempted", ([, b]) => { b.financialRemoveKeys.push("other"); }],
  ["unrelated storage broken", ([, b]) => { b.unrelatedStorageWorked = false; }],
  ["outgoing POST while blocked", ([, b]) => { b.blockedReceiptPostCount = 1; }],
  ["no recovery POST", ([, b]) => { b.recoveryReceiptPostCount = 0; }],
  ["generic validation error", ([, b]) => { b.afterBlockedSave.error = "بيانات ناقصة"; }],
  ["dialog remains open", ([, b]) => { b.afterSuccess.formClosed = false; }],
  ["duplicate visible receipt", ([, b]) => { b.afterSuccess.visibleReceiptCount = 2; }],
  ["wrong list reference", ([, b]) => { b.afterSuccess.references = ["RCT-2"]; }],
  ["uncleared key", ([, b]) => { b.afterSuccess.entries = b.restored.entries; }],
  ["blocked capture from another run", ([,, p]) => { p.runId = "other"; }],
  ["blocked wrong scenario", ([,, p]) => { p.scenario = "other"; }],
  ["additional ingress while blocked", ([,, p]) => { p.receiptPostCount++; }],
  ["invoice ingress while blocked", ([,, p]) => { p.invoicePostCount++; }],
  ["return ingress while blocked", ([,, p]) => { p.returnPostCount++; }],
  ["blocked capture before restore", ([,, p]) => { p.receiptsObservedAt = 149; }],
  ["blocked capture after retry", ([,, p]) => { p.receiptsObservedAt = 201; }],
  ["blocked capture missing timestamp", ([,, p]) => { delete p.receiptsObservedAt; }],
  ["blocked extra response", ([,, p]) => { p.events.push({}); }],
];
for (const field of ["key", "body", "bodyHash", "storageKey", "paymentReceiptId", "reference",
  "counts", "receipts", "paymentState", "journals"]) {
  mutations.push([`replay changes ${field}`, ([p]) => { p.events[1][field] = null; }]);
}
for (const field of ["finalCounts", "finalJournals", "finalReceipts", "finalPaymentState"]) {
  mutations.push([`final changes ${field}`, ([p]) => { p[field] = null; }]);
  mutations.push([`blocked changes ${field}`, ([,, p]) => { p[field] = null; }]);
}
for (const field of ["initialCounts", "initialJournals", "initialPaymentState"]) {
  mutations.push([`blocked changes ${field}`, ([,, p]) => { p[field] = null; }]);
}
for (const stage of ["afterLostResponse", "beforeBlockedSave", "afterBlockedSave", "restored"]) {
  for (const field of ["formOpen", "fields", "entries", "timeOrigin", "observedAt"]) {
    mutations.push([`${stage} invalid ${field}`, ([, b]) => { b[stage][field] = null; }]);
  }
  mutations.push([`${stage} replaced key`, ([, b]) => { b[stage].entries[0][1] = "replacement"; }]);
  for (const field of ["customerName", "amount", "paymentMethod", "invoiceReference", "allocation"]) {
    mutations.push([`${stage} changed ${field}`, ([, b]) => { b[stage].fields[field] = "changed"; }]);
  }
}
for (const flag of ["originalGetItemRestored", "originalSetItemRestored", "originalRemoveItemRestored",
  "originalFetchRestored", "financialWriteReadRemoved"]) {
  mutations.push([`failed ${flag}`, ([, b]) => { b.restored[flag] = false; }]);
}
for (const [name, mutate] of mutations) {
  test(`rejects ${name}`, () => {
    const args = evidence();
    mutate(args);
    assert.throws(() => check(...args));
  });
}
