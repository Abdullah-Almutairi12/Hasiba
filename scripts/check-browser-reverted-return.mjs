// Independent edit/revert scenario; the existing reopened-return guard is unchanged.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export function checkBrowserRevertedReturn(proxy, browser) {
  assert.equal(proxy.scenario, "identical-return");
  assert.ok(proxy.runId);
  assert.equal(browser.runId, proxy.runId);
  assert.equal(proxy.returnPostCount, 2);
  assert.equal(proxy.invoicePostCount, 0);
  assert.equal(proxy.receiptPostCount, 0);
  assert.equal(proxy.events.length, 2);
  assert.deepEqual(proxy.initialCounts, { invoices: 1, creditNotes: 0, receipts: 0 });
  const f = proxy.returnFixture;
  assert.ok(f.soldQuantity >= f.returnQuantity);
  assert.equal(f.returnQuantity, 1);
  assert.equal(f.unitCost, 50);
  assert.deepEqual(proxy.initialReturnState, { notes: [], moves: [], stock: 0,
    quants: [{ warehouseId: f.warehouseId, quantity: 0, avgCost: 0 }] });
  const [first, retry] = proxy.events;
  const hash = (s) => createHash("sha256").update(s).digest("hex");
  assert.ok(Number.isInteger(browser.customerId) && browser.customerId > 0);
  assert.ok(browser.customerName);
  assert.deepEqual(first.body, {
    customerId: browser.customerId, invoiceId: f.id, reason: "Reverted return verification",
    restock: true, lines: [{ productId: f.productId, description: f.description,
      quantity: 1, unitPrice: 100, taxRate: 0, invoiceLineId: f.lineId }],
  });
  assert.equal(first.bodyHash, hash(JSON.stringify(first.body)));
  assert.equal(first.storageKey, `hasba:financial-request:${hash(`/api/sales/credit-notes\n${JSON.stringify(first.body)}`)}`);
  assert.equal(first.dropped, true);
  assert.equal(first.replayed, false);
  assert.equal(first.replayHeader, null);
  assert.equal(retry.dropped, false);
  assert.equal(retry.replayed, true);
  assert.equal(retry.replayHeader, "true");
  for (const event of [first, retry]) {
    assert.ok(event.upstreamStatus >= 200 && event.upstreamStatus < 300);
    assert.ok(Number.isFinite(event.recordedAt));
    assert.ok(typeof event.key === "string" && event.key.length > 0);
    assert.ok(Number.isInteger(event.creditNoteId) && event.creditNoteId > 0);
    assert.match(event.reference, /^CN-/);
    for (const field of ["key", "storageKey", "bodyHash", "creditNoteId", "reference"]) {
      assert.equal(event[field], first[field]);
    }
    assert.deepEqual(event.body, first.body);
    assert.deepEqual(event.counts, { invoices: 1, creditNotes: 1, receipts: 1 });
    assert.equal(event.receipts.length, 1);
    const receipt = event.receipts[0];
    assert.ok(Number.isInteger(receipt.companyId) && receipt.companyId > 0);
    assert.ok(Number.isInteger(receipt.userId) && receipt.userId > 0);
    assert.match(receipt.operation, /^POST:.*:\/sales\/credit-notes$/);
    assert.equal(receipt.key, first.key);
    assert.equal(String(receipt.creditNoteId), String(first.creditNoteId));
    const s = event.returnState;
    assert.equal(s.notes.length, 1);
    assert.equal(s.notes[0].id, first.creditNoteId);
    assert.equal(s.notes[0].reference, first.reference);
    assert.equal(s.notes[0].status, "issued");
    assert.equal(s.notes[0].invoiceId, f.id);
    assert.ok(Number.isInteger(s.notes[0].journalEntryId) && s.notes[0].journalEntryId > 0);
    assert.equal(s.moves.length, 1);
    const { id, ...move } = s.moves[0];
    assert.ok(Number.isInteger(id) && id > 0);
    assert.deepEqual(move, { productId: f.productId, noteId: first.creditNoteId,
      invoiceLineId: f.lineId, originalMoveId: f.issueMoveId,
      warehouseId: f.warehouseId, quantity: 1, unitCost: 50, state: "done" });
    assert.equal(s.stock, 1);
    assert.deepEqual(s.quants, [{ warehouseId: f.warehouseId, quantity: 1, avgCost: 50 }]);
  }
  assert.deepEqual(retry.receipts, first.receipts);
  assert.deepEqual(retry.returnState, first.returnState);
  assert.ok(Number.isFinite(proxy.receiptsObservedAt) && proxy.receiptsObservedAt >= retry.recordedAt);
  assert.deepEqual(proxy.finalReceipts, first.receipts);
  assert.deepEqual(proxy.finalReturnState, first.returnState);
  const { afterLostResponse, afterEdit, afterRevert, afterSuccess } = browser;
  const fields = { customerName: browser.customerName, invoiceReference: f.reference,
    reason: first.body.reason, restock: true, description: f.description,
    quantity: "1", unitPrice: "100", taxRate: "0" };
  let previous = first.recordedAt;
  for (const stage of [afterLostResponse, afterEdit, afterRevert, afterSuccess]) {
    assert.ok(stage && Number.isFinite(stage.observedAt));
    assert.ok(stage.observedAt > previous);
    previous = stage.observedAt;
    assert.ok(Number.isFinite(stage.timeOrigin));
    assert.equal(stage.timeOrigin, afterLostResponse.timeOrigin, "No reload allowed");
  }
  for (const stage of [afterLostResponse, afterEdit, afterRevert]) {
    assert.equal(stage.formOpen, true);
    assert.deepEqual(stage.entries, [[first.storageKey, first.key]]);
    assert.ok(stage.observedAt < retry.recordedAt);
    assert.equal(stage.outgoingReturnPosts, 1, "No send while editing/reverting");
    assert.equal(stage.proxyReturnPostCount, 1, "No second arrival before retry");
  }
  assert.deepEqual(afterLostResponse.fields, fields);
  assert.deepEqual(afterEdit.fields, { ...fields, reason: "Temporary unsent reason" });
  assert.deepEqual(afterRevert.fields, fields);
  assert.ok(retry.recordedAt <= afterSuccess.observedAt);
  assert.equal(afterSuccess.outgoingReturnPosts, 2);
  assert.deepEqual(afterSuccess.entries, []);
  assert.equal(afterSuccess.formClosed, true);
  assert.equal(afterSuccess.visibleCreditNoteCount, 1);
  assert.deepEqual(afterSuccess.references, [first.reference]);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = new URL("../generated-artifacts/verification/", import.meta.url);
  checkBrowserRevertedReturn(
    JSON.parse(readFileSync(new URL("browser-identical-return-proxy.json", dir), "utf8")),
    JSON.parse(readFileSync(new URL("browser-reverted-return.json", dir), "utf8")),
  );
  console.log("PASS: edit/revert without sending preserves the uncertain return key, receipt and single stock restoration.");
}
