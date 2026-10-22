import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { checkBrowserReopenedReturn } from "./check-browser-reopened-return.mjs";

function evidence() {
  const fixture = { id: 10, reference: "SINV-RETURN", lineId: 20, productId: 30,
    warehouseId: 40, issueMoveId: 50, soldQuantity: 4, returnQuantity: 1,
    unitCost: 50, description: "Synthetic return item" };
  const body = { customerId: 60, invoiceId: 10, reason: "Reopened return verification",
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
  const stage = { timeOrigin: 1, entries: [[storageKey, first.key]] };
  // Independent snapshots, like separately captured runtime JSON.
  return JSON.parse(JSON.stringify({
    proxy: { scenario: "identical-return", runId: "run", returnPostCount: 2,
      invoicePostCount: 0, receiptPostCount: 0, returnFixture: fixture,
      initialCounts: { invoices: 1, creditNotes: 0, receipts: 0 },
      initialReturnState: { notes: [], moves: [], stock: 0,
        quants: [{ warehouseId: 40, quantity: 0, avgCost: 0 }] },
      events: [first, { ...first, recordedAt: 200, dropped: false, replayed: true, replayHeader: "true" }],
      finalReceipts: [receipt], receiptsObservedAt: 220, finalReturnState: returnState },
    browser: { runId: "run", customerId: 60, customerName: "Synthetic",
      afterLostResponse: { ...stage, observedAt: 110, formOpen: true, fields },
      afterClose: { ...stage, observedAt: 120, formClosed: true },
      afterReopen: { ...stage, observedAt: 130, formOpen: true, fields },
      afterSuccess: { timeOrigin: 1, observedAt: 210, entries: [], formClosed: true,
        visibleCreditNoteCount: 1, references: ["CN-1"] } },
  }));
}

test("accepts close and reopen of the same uncertain intent with one restoration", () => {
  const { proxy, browser } = evidence();
  checkBrowserReopenedReturn(proxy, browser);
});

for (const [name, mutate] of [
  ["stale run", ({ browser: b }) => { b.runId = "old"; }],
  ["missing close evidence", ({ browser: b }) => { delete b.afterClose; }],
  ["form never closed", ({ browser: b }) => { b.afterClose.formClosed = false; }],
  ["form never reopened", ({ browser: b }) => { b.afterReopen.formOpen = false; }],
  ["lost-response dialog absent", ({ browser: b }) => { b.afterLostResponse.formOpen = false; }],
  ["key cleared on close", ({ browser: b }) => { b.afterClose.entries = []; }],
  ["key cleared on reopen", ({ browser: b }) => { b.afterReopen.entries = []; }],
  ["rotated stored key", ({ browser: b }) => { b.afterReopen.entries[0][1] = "new"; }],
  ["key not cleared after success", ({ browser: b }) => { b.afterSuccess.entries = b.afterReopen.entries; }],
  ["reloaded document", ({ browser: b }) => { b.afterReopen.timeOrigin++; }],
  ["missing time origin", ({ browser: b }) => { delete b.afterClose.timeOrigin; }],
  ["reopen after confirmation", ({ browser: b }) => { b.afterReopen.observedAt = 205; }],
  ["reopen before close", ({ browser: b }) => { b.afterReopen.observedAt = 115; }],
  ["capture before commit", ({ browser: b }) => { b.afterLostResponse.observedAt = 90; }],
  ["capture success before replay", ({ browser: b }) => { b.afterSuccess.observedAt = 199; }],
  ["changed reopened fields", ({ browser: b }) => { b.afterReopen.fields.quantity = "2"; }],
  ["unconfirmed success dialog", ({ browser: b }) => { b.afterSuccess.formClosed = false; }],
  ["stale list", ({ browser: b }) => { b.afterSuccess.visibleCreditNoteCount = 0; }],
  ["wrong visible reference", ({ browser: b }) => { b.afterSuccess.references = ["CN-2"]; }],
  ["third arrival", ({ proxy: p }) => { p.returnPostCount++; }],
  ["missing event", ({ proxy: p }) => { p.events.pop(); }],
  ["unexpected invoice POST", ({ proxy: p }) => { p.invoicePostCount++; }],
  ["unexpected payment POST", ({ proxy: p }) => { p.receiptPostCount++; }],
  ["preexisting return", ({ proxy: p }) => { p.initialCounts.creditNotes++; }],
  ["preexisting stock", ({ proxy: p }) => { p.initialReturnState.stock++; }],
  ["first success not dropped", ({ proxy: p }) => { p.events[0].dropped = false; }],
  ["replayed first save", ({ proxy: p }) => { p.events[0].replayed = true; }],
  ["failed retry", ({ proxy: p }) => { p.events[1].upstreamStatus = 409; }],
  ["dropped retry", ({ proxy: p }) => { p.events[1].dropped = true; }],
  ["not replayed", ({ proxy: p }) => { p.events[1].replayed = false; }],
  ["missing replay header", ({ proxy: p }) => { delete p.events[1].replayHeader; }],
  ["false replay header", ({ proxy: p }) => { p.events[1].replayHeader = "false"; }],
  ["fresh key on reopen", ({ proxy: p }) => { p.events[1].key = "new"; }],
  ["changed body", ({ proxy: p }) => { p.events[1].body.lines[0].quantity = 2; }],
  ["changed body digest", ({ proxy: p }) => { p.events[1].bodyHash = "bad"; }],
  ["wrong persisted slot", ({ proxy: p }) => { p.events[1].storageKey += "bad"; }],
  ["new document", ({ proxy: p }) => { p.events[1].creditNoteId++; }],
  ["new reference", ({ proxy: p }) => { p.events[1].reference = "CN-2"; }],
  ["duplicate return", ({ proxy: p }) => { p.events[1].counts.creditNotes++; }],
  ["duplicate receipt", ({ proxy: p }) => { p.events[1].receipts.push(p.events[1].receipts[0]); }],
  ["wrong receipt link", ({ proxy: p }) => { p.events[1].receipts[0].creditNoteId = "2"; }],
  ["changed receipt tenant", ({ proxy: p }) => { p.events[1].receipts[0].companyId++; }],
  ["changed receipt user", ({ proxy: p }) => { p.events[1].receipts[0].userId++; }],
  ["changed receipt operation", ({ proxy: p }) => { p.events[1].receipts[0].operation = "invoice"; }],
  ["draft return", ({ proxy: p }) => { p.events[1].returnState.notes[0].status = "draft"; }],
  ["wrong source invoice", ({ proxy: p }) => { p.events[1].returnState.notes[0].invoiceId++; }],
  ["second journal", ({ proxy: p }) => { p.events[1].returnState.notes[0].journalEntryId++; }],
  ["second move identity", ({ proxy: p }) => { p.events[1].returnState.moves[0].id++; }],
  ["wrong source line", ({ proxy: p }) => { p.events[1].returnState.moves[0].invoiceLineId++; }],
  ["wrong original move", ({ proxy: p }) => { p.events[1].returnState.moves[0].originalMoveId++; }],
  ["wrong historical cost", ({ proxy: p }) => { p.events[1].returnState.moves[0].unitCost = 100; }],
  ["double restock", ({ proxy: p }) => { p.events[1].returnState.stock++; }],
  ["wrong warehouse quantity", ({ proxy: p }) => { p.events[1].returnState.quants[0].quantity++; }],
  ["wrong stock valuation", ({ proxy: p }) => { p.events[1].returnState.quants[0].avgCost++; }],
  ["stale final capture", ({ proxy: p }) => { p.receiptsObservedAt = 199; }],
  ["missing final receipt", ({ proxy: p }) => { p.finalReceipts = []; }],
  ["changed final stock", ({ proxy: p }) => { p.finalReturnState.stock++; }],
]) {
  test(`rejects ${name}`, () => {
    const data = evidence();
    mutate(data);
    assert.throws(() => checkBrowserReopenedReturn(data.proxy, data.browser));
  });
}
