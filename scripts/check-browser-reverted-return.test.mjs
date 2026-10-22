import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { checkBrowserRevertedReturn } from "./check-browser-reverted-return.mjs";

function evidence() {
  const fixture = { id: 10, reference: "SINV-RETURN", lineId: 20, productId: 30,
    warehouseId: 40, issueMoveId: 50, soldQuantity: 4, returnQuantity: 1,
    unitCost: 50, description: "Synthetic return item" };
  const body = { customerId: 60, invoiceId: 10, reason: "Reverted return verification",
    restock: true, lines: [{ productId: 30, description: fixture.description,
      quantity: 1, unitPrice: 100, taxRate: 0, invoiceLineId: 20 }] };
  const hash = (s) => createHash("sha256").update(s).digest("hex");
  const storageKey = `hasba:financial-request:${hash(`/api/sales/credit-notes\n${JSON.stringify(body)}`)}`;
  const receipt = { companyId: 1, userId: 2, operation: "POST:1:/sales/credit-notes",
    key: "uncertain-key", creditNoteId: "1" };
  const returnState = {
    notes: [{ id: 1, reference: "CN-1", status: "issued", invoiceId: 10, journalEntryId: 70 }],
    moves: [{ id: 80, productId: 30, noteId: 1, invoiceLineId: 20,
      originalMoveId: 50, warehouseId: 40, quantity: 1, unitCost: 50, state: "done" }],
    stock: 1, quants: [{ warehouseId: 40, quantity: 1, avgCost: 50 }],
  };
  const first = { storageKey, key: receipt.key, body, bodyHash: hash(JSON.stringify(body)),
    upstreamStatus: 201, creditNoteId: 1, reference: "CN-1",
    counts: { invoices: 1, creditNotes: 1, receipts: 1 }, receipts: [receipt],
    returnState, replayHeader: null, recordedAt: 100, dropped: true, replayed: false };
  const fields = { customerName: "Synthetic", invoiceReference: fixture.reference,
    reason: body.reason, restock: true, description: fixture.description,
    quantity: "1", unitPrice: "100", taxRate: "0" };
  const stage = { timeOrigin: 1, entries: [[storageKey, first.key]], formOpen: true,
    outgoingReturnPosts: 1, proxyReturnPostCount: 1 };
  return JSON.parse(JSON.stringify({
    proxy: { scenario: "identical-return", runId: "run", returnPostCount: 2,
      invoicePostCount: 0, receiptPostCount: 0, returnFixture: fixture,
      initialCounts: { invoices: 1, creditNotes: 0, receipts: 0 },
      initialReturnState: { notes: [], moves: [], stock: 0,
        quants: [{ warehouseId: 40, quantity: 0, avgCost: 0 }] },
      events: [first, { ...first, recordedAt: 200, dropped: false, replayed: true, replayHeader: "true" }],
      finalReceipts: [receipt], receiptsObservedAt: 220, finalReturnState: returnState },
    browser: { runId: "run", customerId: 60, customerName: "Synthetic",
      afterLostResponse: { ...stage, observedAt: 110, fields },
      afterEdit: { ...stage, observedAt: 120, fields: { ...fields, reason: "Temporary unsent reason" } },
      afterRevert: { ...stage, observedAt: 130, fields },
      afterSuccess: { timeOrigin: 1, observedAt: 210, entries: [], formClosed: true,
        outgoingReturnPosts: 2, visibleCreditNoteCount: 1, references: ["CN-1"] } },
  }));
}

test("accepts an unsent edit/revert and replay of the same uncertain return", () => {
  const { proxy, browser } = evidence();
  checkBrowserRevertedReturn(proxy, browser);
});

const mutations = [
  ["stale run", (p, b) => { b.runId = "old"; }],
  ["edit never rendered", (p, b) => { b.afterEdit.fields.reason = p.events[0].body.reason; }],
  ["reason not restored", (p, b) => { b.afterRevert.fields.reason = "Temporary unsent reason"; }],
  ["financial field edited", (p, b) => { b.afterEdit.fields.quantity = "2"; }],
  ["extra outgoing request even without arrival", (p, b) => { b.afterEdit.outgoingReturnPosts++; }],
  ["extra ingress even without success event", (p, b) => { b.afterEdit.proxyReturnPostCount++; }],
  ["wrong total outgoing count", (p, b) => { b.afterSuccess.outgoingReturnPosts++; }],
  ["key not cleared after success", (p, b) => { b.afterSuccess.entries = b.afterRevert.entries; }],
  ["success dialog still open", (p, b) => { b.afterSuccess.formClosed = false; }],
  ["stale list", (p, b) => { b.afterSuccess.visibleCreditNoteCount = 0; }],
  ["wrong visible reference", (p, b) => { b.afterSuccess.references = ["CN-2"]; }],
  ["third arrival", (p) => { p.returnPostCount++; }],
  ["unexpected invoice", (p) => { p.invoicePostCount++; }],
  ["unexpected payment", (p) => { p.receiptPostCount++; }],
  ["preexisting return", (p) => { p.initialCounts.creditNotes++; }],
  ["preexisting stock", (p) => { p.initialReturnState.stock++; }],
  ["first success not dropped", (p) => { p.events[0].dropped = false; }],
  ["first request replayed", (p) => { p.events[0].replayed = true; }],
  ["failed retry", (p) => { p.events[1].upstreamStatus = 409; }],
  ["dropped retry", (p) => { p.events[1].dropped = true; }],
  ["no replay", (p) => { p.events[1].replayed = false; }],
  ["missing replay header", (p) => { delete p.events[1].replayHeader; }],
  ["rotated key", (p) => { p.events[1].key = "new"; }],
  ["temporary payload sent", (p) => { p.events[1].body.reason = "Temporary unsent reason"; }],
  ["wrong digest", (p) => { p.events[1].bodyHash = "wrong"; }],
  ["wrong storage slot", (p) => { p.events[1].storageKey += "bad"; }],
  ["new return", (p) => { p.events[1].creditNoteId++; }],
  ["new reference", (p) => { p.events[1].reference = "CN-2"; }],
  ["duplicate return", (p) => { p.events[1].counts.creditNotes++; }],
  ["duplicate receipt", (p) => { p.events[1].receipts.push(p.events[1].receipts[0]); }],
  ["wrong receipt return", (p) => { p.events[1].receipts[0].creditNoteId = "2"; }],
  ["wrong tenant", (p) => { p.events[1].receipts[0].companyId++; }],
  ["wrong user", (p) => { p.events[1].receipts[0].userId++; }],
  ["wrong operation", (p) => { p.events[1].receipts[0].operation = "invoice"; }],
  ["draft return", (p) => { p.events[1].returnState.notes[0].status = "draft"; }],
  ["second journal", (p) => { p.events[1].returnState.notes[0].journalEntryId++; }],
  ["second movement", (p) => { p.events[1].returnState.moves[0].id++; }],
  ["wrong source line", (p) => { p.events[1].returnState.moves[0].invoiceLineId++; }],
  ["wrong original movement", (p) => { p.events[1].returnState.moves[0].originalMoveId++; }],
  ["wrong historical cost", (p) => { p.events[1].returnState.moves[0].unitCost++; }],
  ["double stock", (p) => { p.events[1].returnState.stock++; }],
  ["double warehouse stock", (p) => { p.events[1].returnState.quants[0].quantity++; }],
  ["wrong valuation", (p) => { p.events[1].returnState.quants[0].avgCost++; }],
  ["stale final evidence", (p) => { p.receiptsObservedAt = 199; }],
  ["missing final receipt", (p) => { p.finalReceipts = []; }],
  ["changed final stock", (p) => { p.finalReturnState.stock++; }],
];
for (const stage of ["afterLostResponse", "afterEdit", "afterRevert"]) {
  mutations.push(
    [`missing ${stage}`, (p, b) => { delete b[stage]; }],
    [`closed ${stage}`, (p, b) => { b[stage].formOpen = false; }],
    [`key removed ${stage}`, (p, b) => { b[stage].entries = []; }],
    [`key rotated ${stage}`, (p, b) => { b[stage].entries[0][1] = "new"; }],
    [`missing origin ${stage}`, (p, b) => { delete b[stage].timeOrigin; }],
    [`snapshot before commit ${stage}`, (p, b) => { b[stage].observedAt = 90; }],
    [`snapshot after retry ${stage}`, (p, b) => { b[stage].observedAt = 205; }],
  );
}
mutations.push(["reload during edit", (p, b) => { b.afterEdit.timeOrigin++; }]);
for (const [name, mutate] of mutations) {
  test(`rejects ${name}`, () => {
    const { proxy, browser } = evidence();
    mutate(proxy, browser);
    assert.throws(() => checkBrowserRevertedReturn(proxy, browser));
  });
}
