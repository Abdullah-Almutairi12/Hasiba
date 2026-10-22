// Recover in place, confirm success, then start a genuinely new identical return.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export function checkBrowserIdenticalReturn(proxy, browser) {
  assert.equal(proxy.scenario, "identical-return");
  assert.ok(proxy.runId);
  assert.equal(browser.runId, proxy.runId);
  assert.equal(proxy.returnPostCount, 3, "Exactly three return POSTs must arrive");
  assert.equal(proxy.invoicePostCount, 0);
  assert.equal(proxy.receiptPostCount, 0);
  assert.equal(proxy.events.length, 3);
  assert.deepEqual(proxy.initialCounts, { invoices: 1, creditNotes: 0, receipts: 0 });
  const fixture = proxy.returnFixture;
  assert.ok(fixture.soldQuantity >= 2 * fixture.returnQuantity);
  assert.equal(fixture.returnQuantity, 1);
  assert.equal(fixture.unitCost, 50);
  assert.deepEqual(proxy.initialReturnState, {
    notes: [], moves: [], stock: 0,
    quants: [{ warehouseId: fixture.warehouseId, quantity: 0, avgCost: 0 }],
  });
  const [first, retry, second] = proxy.events;
  assert.deepEqual(first.body, {
    customerId: browser.customerId, invoiceId: fixture.id, reason: "Identical return verification",
    restock: true, lines: [{
      productId: fixture.productId, description: fixture.description,
      quantity: fixture.returnQuantity, unitPrice: 100, taxRate: 0, invoiceLineId: fixture.lineId,
    }],
  });
  const hash = (s) => createHash("sha256").update(s).digest("hex");
  assert.equal(first.bodyHash, hash(JSON.stringify(first.body)));
  assert.equal(first.storageKey, `hasba:financial-request:${hash(`/api/sales/credit-notes\n${JSON.stringify(first.body)}`)}`);
  assert.equal(first.dropped, true);
  assert.equal(first.replayed, false);
  assert.equal(first.replayHeader, null);
  assert.equal(retry.dropped, false);
  assert.equal(retry.replayed, true);
  assert.equal(retry.replayHeader, "true");
  assert.equal(second.dropped, false);
  assert.equal(second.replayed, false);
  assert.equal(second.replayHeader, null, "A fresh intent must have no replay header, not even false");
  assert.equal(first.key, retry.key);
  assert.notEqual(first.key, second.key);
  assert.equal(first.creditNoteId, retry.creditNoteId);
  assert.equal(first.reference, retry.reference);
  assert.notEqual(first.creditNoteId, second.creditNoteId);
  assert.notEqual(first.reference, second.reference);
  const identity = (r) => JSON.stringify([r.companyId, r.userId, r.operation, r.key]);
  for (const [index, event] of proxy.events.entries()) {
    const count = index === 2 ? 2 : 1;
    assert.ok(event.upstreamStatus >= 200 && event.upstreamStatus < 300);
    assert.ok(Number.isFinite(event.recordedAt));
    assert.ok(Number.isInteger(event.creditNoteId) && event.creditNoteId > 0);
    assert.match(event.reference, /^CN-/);
    assert.ok(typeof event.key === "string" && event.key.length > 0);
    assert.equal(event.bodyHash, first.bodyHash);
    assert.equal(event.storageKey, first.storageKey);
    assert.deepEqual(event.body, first.body);
    assert.deepEqual(event.counts, { invoices: 1, creditNotes: count, receipts: count });
    assert.equal(event.receipts.length, count);
    assert.equal(new Set(event.receipts.map(identity)).size, count);
    for (const receipt of event.receipts) {
      assert.ok(Number.isInteger(receipt.companyId) && receipt.companyId > 0);
      assert.ok(Number.isInteger(receipt.userId) && receipt.userId > 0);
      assert.match(receipt.operation, /^POST:.*:\/sales\/credit-notes$/);
      for (const field of ["companyId", "userId", "operation"]) {
        assert.equal(receipt[field], first.receipts[0][field]);
      }
    }
    const state = event.returnState;
    assert.equal(state.notes.length, count);
    assert.equal(state.moves.length, count);
    assert.equal(state.stock, count * fixture.returnQuantity);
    assert.deepEqual(state.quants, [{ warehouseId: fixture.warehouseId,
      quantity: count * fixture.returnQuantity, avgCost: fixture.unitCost }]);
    assert.equal(new Set(state.notes.map((n) => n.id)).size, count);
    assert.equal(new Set(state.notes.map((n) => n.journalEntryId)).size, count);
    assert.equal(new Set(state.moves.map((m) => m.id)).size, count);
    for (const note of state.notes) {
      const origin = note.id === first.creditNoteId ? first : second;
      assert.equal(note.id, origin.creditNoteId);
      assert.equal(note.reference, origin.reference);
      assert.equal(note.status, "issued");
      assert.equal(note.invoiceId, fixture.id);
      assert.ok(Number.isInteger(note.journalEntryId) && note.journalEntryId > 0);
      const receipt = event.receipts.find((r) => r.key === origin.key);
      assert.ok(receipt);
      assert.equal(String(receipt.creditNoteId), String(note.id));
      const moves = state.moves.filter((m) => m.noteId === note.id);
      assert.equal(moves.length, 1);
      const { id, ...move } = moves[0];
      assert.ok(Number.isInteger(id) && id > 0);
      assert.deepEqual(move, {
        productId: fixture.productId, noteId: note.id, invoiceLineId: fixture.lineId,
        originalMoveId: fixture.issueMoveId, warehouseId: fixture.warehouseId,
        quantity: fixture.returnQuantity, unitCost: fixture.unitCost, state: "done",
      });
    }
  }
  assert.deepEqual(retry.receipts, first.receipts);
  assert.deepEqual(retry.returnState, first.returnState, "Replay must not restock again");
  assert.deepEqual(second.receipts.find((r) => r.key === first.key), first.receipts[0]);
  assert.ok(Number.isFinite(proxy.receiptsObservedAt) && proxy.receiptsObservedAt >= second.recordedAt);
  assert.deepEqual(proxy.finalReceipts, second.receipts);
  assert.deepEqual(proxy.finalReturnState, second.returnState);

  const { beforeRetry, afterSuccess, afterNewForm, afterSecondSuccess } = browser;
  assert.ok(browser.customerName);
  assert.ok(Number.isInteger(browser.customerId) && browser.customerId > 0);
  for (const stage of [beforeRetry, afterSuccess, afterNewForm, afterSecondSuccess]) {
    assert.ok(stage && Number.isFinite(stage.observedAt));
    assert.ok(Number.isFinite(stage.timeOrigin));
    assert.equal(stage.timeOrigin, beforeRetry.timeOrigin, "No reload in this scenario");
    assert.ok(Array.isArray(stage.entries));
  }
  assert.equal(beforeRetry.formOpen, true);
  assert.deepEqual(beforeRetry.entries, [[first.storageKey, first.key]]);
  assert.ok(first.recordedAt <= beforeRetry.observedAt);
  assert.ok(beforeRetry.observedAt < retry.recordedAt);
  assert.ok(retry.recordedAt <= afterSuccess.observedAt);
  assert.ok(afterSuccess.observedAt < afterNewForm.observedAt);
  assert.ok(afterNewForm.observedAt < second.recordedAt);
  assert.ok(second.recordedAt <= afterSecondSuccess.observedAt);
  for (const stage of [afterSuccess, afterNewForm, afterSecondSuccess]) {
    assert.deepEqual(stage.entries, [], "Confirmed success must clear pending intent storage");
  }
  assert.deepEqual(beforeRetry.fields, {
    customerName: browser.customerName, invoiceReference: fixture.reference,
    reason: first.body.reason, restock: true, description: fixture.description,
    quantity: "1", unitPrice: "100", taxRate: "0",
  });
  assert.equal(afterNewForm.formOpen, true);
  assert.deepEqual(afterNewForm.fields, beforeRetry.fields);
  for (const [stage, refs] of [[afterSuccess, [first.reference]],
    [afterSecondSuccess, [first.reference, second.reference]]]) {
    assert.equal(stage.formClosed, true);
    assert.equal(stage.visibleCreditNoteCount, refs.length);
    assert.deepEqual([...stage.references].sort(), refs.sort());
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = new URL("../generated-artifacts/verification/", import.meta.url);
  checkBrowserIdenticalReturn(
    JSON.parse(readFileSync(new URL("browser-identical-return-proxy.json", dir), "utf8")),
    JSON.parse(readFileSync(new URL("browser-identical-return.json", dir), "utf8")),
  );
  console.log("PASS: confirmed return recovery then fresh identical intent; two returns, distinct retry receipts and exactly two stock restorations.");
}
