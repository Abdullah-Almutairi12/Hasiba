import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { checkBrowserIdenticalReturn } from "./check-browser-identical-return.mjs";

function evidence() {
  const fixture = { id: 10, reference: "SINV-RETURN", lineId: 20, productId: 30,
    warehouseId: 40, issueMoveId: 50, soldQuantity: 4, returnQuantity: 1,
    unitCost: 50, description: "Synthetic return item" };
  const body = { customerId: 60, invoiceId: 10, reason: "Identical return verification",
    restock: true, lines: [{ productId: 30, description: fixture.description,
      quantity: 1, unitPrice: 100, taxRate: 0, invoiceLineId: 20 }] };
  const hash = (s) => createHash("sha256").update(s).digest("hex");
  const storageKey = `hasba:financial-request:${hash(`/api/sales/credit-notes\n${JSON.stringify(body)}`)}`;
  const receipt = { companyId: 1, userId: 2, operation: "POST:1:/sales/credit-notes",
    key: "first-key", creditNoteId: "1" };
  const receipt2 = { ...receipt, key: "second-key", creditNoteId: "2" };
  const note = { id: 1, reference: "CN-1", status: "issued", invoiceId: 10, journalEntryId: 70 };
  const move = { id: 80, productId: 30, noteId: 1, invoiceLineId: 20,
    originalMoveId: 50, warehouseId: 40, quantity: 1, unitCost: 50, state: "done" };
  const returnState = { notes: [note], moves: [move], stock: 1,
    quants: [{ warehouseId: 40, quantity: 1, avgCost: 50 }] };
  const finalReturnState = { notes: [note, { ...note, id: 2, reference: "CN-2", journalEntryId: 71 }],
    moves: [move, { ...move, id: 81, noteId: 2 }], stock: 2,
    quants: [{ warehouseId: 40, quantity: 2, avgCost: 50 }] };
  const first = { storageKey, key: receipt.key, body, bodyHash: hash(JSON.stringify(body)),
    upstreamStatus: 201, creditNoteId: 1, reference: "CN-1",
    counts: { invoices: 1, creditNotes: 1, receipts: 1 }, receipts: [receipt],
    returnState, replayHeader: null, recordedAt: 100, dropped: true, replayed: false };
  const fields = { customerName: "Synthetic", invoiceReference: fixture.reference,
    reason: body.reason, restock: true, description: fixture.description,
    quantity: "1", unitPrice: "100", taxRate: "0" };
  return structuredClone({
    proxy: {
      scenario: "identical-return", runId: "run", returnPostCount: 3, invoicePostCount: 0,
      receiptPostCount: 0, returnFixture: fixture,
      initialCounts: { invoices: 1, creditNotes: 0, receipts: 0 },
      initialReturnState: { notes: [], moves: [], stock: 0,
        quants: [{ warehouseId: 40, quantity: 0, avgCost: 0 }] },
      events: [first, { ...first, recordedAt: 200, dropped: false, replayed: true, replayHeader: "true" },
        { ...first, recordedAt: 300, dropped: false, key: "second-key", creditNoteId: 2,
          reference: "CN-2", counts: { invoices: 1, creditNotes: 2, receipts: 2 },
          receipts: [receipt, receipt2], returnState: finalReturnState }],
      finalReceipts: [receipt, receipt2], receiptsObservedAt: 305, finalReturnState,
    },
    browser: { runId: "run", customerId: 60, customerName: "Synthetic",
      beforeRetry: { observedAt: 110, timeOrigin: 1, entries: [[storageKey, first.key]], formOpen: true, fields },
      afterSuccess: { observedAt: 210, timeOrigin: 1, entries: [], formClosed: true,
        visibleCreditNoteCount: 1, references: ["CN-1"] },
      afterNewForm: { observedAt: 220, timeOrigin: 1, entries: [], formOpen: true, fields },
      afterSecondSuccess: { observedAt: 310, timeOrigin: 1, entries: [], formClosed: true,
        visibleCreditNoteCount: 2, references: ["CN-2", "CN-1"] },
    },
  });
}

test("accepts confirmed recovery then a legitimate identical return with exactly two restorations", () => {
  const { proxy, browser } = evidence();
  checkBrowserIdenticalReturn(proxy, browser);
});

for (const [name, mutate] of [
  ["missing request", ({ proxy: p }) => p.events.pop()],
  ["extra arrival", ({ proxy: p }) => p.returnPostCount++],
  ["invoice setup POST", ({ proxy: p }) => p.invoicePostCount++],
  ["payment POST", ({ proxy: p }) => p.receiptPostCount++],
  ["stale run", ({ browser: b }) => { b.runId = "old"; }],
  ["insufficient sold quantity", ({ proxy: p }) => { p.returnFixture.soldQuantity = 1; }],
  ["preexisting return", ({ proxy: p }) => p.initialCounts.creditNotes++],
  ["preexisting stock", ({ proxy: p }) => p.initialReturnState.stock++],
  ["first response not dropped", ({ proxy: p }) => { p.events[0].dropped = false; }],
  ["missing replay", ({ proxy: p }) => { p.events[1].replayed = false; }],
  ["missing retry header", ({ proxy: p }) => { p.events[1].replayHeader = null; }],
  ["rotated retry key", ({ proxy: p }) => { p.events[1].key = "wrong"; }],
  ["reused key", ({ proxy: p }) => { p.events[2].key = "first-key"; }],
  ["replayed new intent", ({ proxy: p }) => { p.events[2].replayed = true; }],
  ["false replay header", ({ proxy: p }) => { p.events[2].replayHeader = "false"; }],
  ["missing header evidence", ({ proxy: p }) => { delete p.events[2].replayHeader; }],
  ["new success dropped", ({ proxy: p }) => { p.events[2].dropped = true; }],
  ["failed new save", ({ proxy: p }) => { p.events[2].upstreamStatus = 409; }],
  ["changed body", ({ proxy: p }) => { p.events[2].body.lines[0].quantity = 2; }],
  ["changed hash", ({ proxy: p }) => { p.events[2].bodyHash = "b".repeat(64); }],
  ["wrong storage slot", ({ proxy: p }) => { p.events[2].storageKey += "b"; }],
  ["same return id", ({ proxy: p }) => { p.events[2].creditNoteId = 1; }],
  ["same reference", ({ proxy: p }) => { p.events[2].reference = "CN-1"; }],
  ["only one return", ({ proxy: p }) => { p.events[2].counts.creditNotes = 1; }],
  ["only one receipt", ({ proxy: p }) => { p.events[2].receipts.pop(); }],
  ["duplicate receipt identity", ({ proxy: p }) => { p.events[2].receipts[1] = p.events[2].receipts[0]; }],
  ["wrong receipt document link", ({ proxy: p }) => { p.events[2].receipts[1].creditNoteId = "1"; }],
  ["wrong tenant", ({ proxy: p }) => p.events[2].receipts[1].companyId++],
  ["wrong user", ({ proxy: p }) => p.events[2].receipts[1].userId++],
  ["wrong operation", ({ proxy: p }) => { p.events[2].receipts[1].operation = "invoice"; }],
  ["replay restocks again", ({ proxy: p }) => p.events[1].returnState.stock++],
  ["stock not restored twice", ({ proxy: p }) => { p.events[2].returnState.stock = 1; }],
  ["stock restored three times", ({ proxy: p }) => { p.events[2].returnState.quants[0].quantity = 3; }],
  ["wrong historical cost", ({ proxy: p }) => { p.events[2].returnState.moves[1].unitCost = 100; }],
  ["wrong original move", ({ proxy: p }) => p.events[2].returnState.moves[1].originalMoveId++],
  ["wrong source line", ({ proxy: p }) => p.events[2].returnState.moves[1].invoiceLineId++],
  ["wrong warehouse", ({ proxy: p }) => p.events[2].returnState.moves[1].warehouseId++],
  ["duplicate move", ({ proxy: p }) => { p.events[2].returnState.moves[1].id = 80; }],
  ["unissued return", ({ proxy: p }) => { p.events[2].returnState.notes[1].status = "draft"; }],
  ["same journal", ({ proxy: p }) => { p.events[2].returnState.notes[1].journalEntryId = 70; }],
  ["stale final receipts", ({ proxy: p }) => { p.receiptsObservedAt = 299; }],
  ["missing final link", ({ proxy: p }) => p.finalReceipts.pop()],
  ["wrong final stock", ({ proxy: p }) => p.finalReturnState.stock++],
  ["reload instead of same document", ({ browser: b }) => b.afterNewForm.timeOrigin++],
  ["uncertain key missing", ({ browser: b }) => { b.beforeRetry.entries = []; }],
  ["first key uncleared", ({ browser: b }) => { b.afterSuccess.entries = b.beforeRetry.entries; }],
  ["new form with old key", ({ browser: b }) => { b.afterNewForm.entries = b.beforeRetry.entries; }],
  ["second key uncleared", ({ browser: b }) => { b.afterSecondSuccess.entries = b.beforeRetry.entries; }],
  ["new form not opened", ({ browser: b }) => { b.afterNewForm.formOpen = false; }],
  ["second form not closed", ({ browser: b }) => { b.afterSecondSuccess.formClosed = false; }],
  ["new form before confirmation", ({ browser: b }) => { b.afterNewForm.observedAt = 205; }],
  ["new form captured after save", ({ browser: b }) => { b.afterNewForm.observedAt = 301; }],
  ["success before commit", ({ browser: b }) => { b.afterSecondSuccess.observedAt = 299; }],
  ["different rendered values", ({ browser: b }) => { b.afterNewForm.fields.quantity = "2"; }],
  ["stale list", ({ browser: b }) => { b.afterSecondSuccess.visibleCreditNoteCount = 1; }],
  ["duplicate list reference", ({ browser: b }) => { b.afterSecondSuccess.references = ["CN-1", "CN-1"]; }],
]) {
  test(`rejects ${name}`, () => {
    const data = evidence();
    mutate(data);
    assert.throws(() => checkBrowserIdenticalReturn(data.proxy, data.browser));
  });
}
