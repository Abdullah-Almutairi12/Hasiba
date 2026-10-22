import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkReloadedReturnCleanup } from "./check-browser-reloaded-return-cleanup.mjs";

// Extend the confirmed-cleanup guard, never convert lost-response evidence into
// readable success. All four captures are raw observations of the same run.
export function checkReloadedIdenticalReturn(proxy, browser, beforeRetryProxy, afterSuccessProxy) {
  checkReloadedReturnCleanup(afterSuccessProxy, {
    ...browser, responses: browser.responses.slice(0, 2),
  }, beforeRetryProxy);
  assert.equal(proxy.runId, afterSuccessProxy.runId);
  assert.equal(proxy.scenario, afterSuccessProxy.scenario);
  assert.equal(proxy.returnPostCount, 3);
  assert.equal(proxy.invoicePostCount, 0);
  assert.equal(proxy.receiptPostCount, 0);
  assert.equal(proxy.events.length, 3);
  for (const name of ["initialCounts", "initialReturnState", "returnFixture"]) {
    assert.deepEqual(proxy[name], afterSuccessProxy[name]);
  }
  assert.deepEqual(proxy.events.slice(0, 2), afterSuccessProxy.events);
  const [first, retry, second] = proxy.events;
  const f = proxy.returnFixture;
  assert.ok(f.soldQuantity >= 2 * f.returnQuantity);
  assert.ok(afterSuccessProxy.receiptsObservedAt < second.recordedAt);
  assert.ok(retry.recordedAt <= second.recordedAt);
  assert.equal(second.upstreamStatus, 201);
  assert.equal(second.dropped, false);
  assert.equal(second.replayed, false);
  assert.equal(second.replayHeader, null);
  assert.ok(typeof second.key === "string" && second.key.length > 0);
  assert.notEqual(second.key, first.key);
  assert.ok(Number.isInteger(second.creditNoteId) && second.creditNoteId > 0);
  assert.notEqual(second.creditNoteId, first.creditNoteId);
  assert.match(second.reference, /^CN-/);
  assert.notEqual(second.reference, first.reference);
  for (const name of ["body", "bodyHash", "storageKey"]) {
    assert.deepEqual(second[name], first[name]);
  }
  assert.deepEqual(second.counts, { invoices: 1, creditNotes: 2, receipts: 2 });
  assert.equal(second.receipts.length, 2);
  assert.deepEqual(second.receipts.find((r) => r.key === first.key), first.receipts[0]);
  const receipt = second.receipts.find((r) => r.key === second.key);
  assert.ok(receipt);
  for (const field of ["companyId", "userId", "operation"]) {
    assert.equal(receipt[field], first.receipts[0][field]);
  }
  assert.equal(String(receipt.creditNoteId), String(second.creditNoteId));
  const s = second.returnState;
  assert.equal(s.notes.length, 2);
  assert.equal(s.moves.length, 2);
  const original = first.returnState;
  assert.deepEqual(s.notes.find((n) => n.id === first.creditNoteId), original.notes[0]);
  assert.deepEqual(s.moves.find((m) => m.id === original.moves[0].id), original.moves[0]);
  const note = s.notes.find((n) => n.id === second.creditNoteId);
  assert.ok(note);
  assert.ok(Number.isInteger(note.journalEntryId) && note.journalEntryId > 0);
  assert.notEqual(note.journalEntryId, original.notes[0].journalEntryId);
  assert.deepEqual(note, { id: second.creditNoteId, reference: second.reference,
    invoiceId: f.id, journalEntryId: note.journalEntryId, status: "issued" });
  const move = s.moves.find((m) => m.noteId === second.creditNoteId);
  assert.ok(move);
  assert.ok(Number.isInteger(move.id) && move.id > 0);
  assert.notEqual(move.id, original.moves[0].id);
  assert.deepEqual(move, { id: move.id, productId: f.productId, noteId: second.creditNoteId,
    invoiceLineId: f.lineId, originalMoveId: f.issueMoveId, warehouseId: f.warehouseId,
    quantity: f.returnQuantity, unitCost: f.unitCost, state: "done" });
  assert.equal(s.stock, 2 * f.returnQuantity);
  assert.deepEqual(s.quants, [{ warehouseId: f.warehouseId,
    quantity: 2 * f.returnQuantity, avgCost: f.unitCost }]);
  assert.ok(Number.isFinite(proxy.receiptsObservedAt) && proxy.receiptsObservedAt >= second.recordedAt);
  assert.deepEqual(proxy.finalReceipts, second.receipts);
  assert.deepEqual(proxy.finalReturnState, s);

  assert.equal(browser.responses.length, 3);
  const response = browser.responses[2];
  assert.equal(response.status, 201);
  assert.equal(response.replayed, false);
  assert.equal(response.key, second.key);
  assert.equal(response.requestBody, browser.responses[0].requestBody);
  assert.equal(response.body.id, second.creditNoteId);
  assert.equal(response.body.reference, second.reference);
  const { afterSuccess, afterNewForm, afterSecondSuccess } = browser;
  for (const stage of [afterNewForm, afterSecondSuccess]) {
    assert.equal(stage.timeOrigin, afterSuccess.timeOrigin);
    assert.ok(Number.isFinite(stage.observedAt));
    assert.deepEqual(stage.entries, []);
  }
  assert.ok(afterSuccess.observedAt < afterNewForm.observedAt);
  assert.ok(Number.isFinite(response.jsonObservedAt));
  assert.ok(afterNewForm.observedAt <= response.jsonObservedAt);
  assert.ok(response.jsonObservedAt <= afterSecondSuccess.observedAt);
  assert.ok(afterNewForm.observedAt < afterSecondSuccess.observedAt);
  assert.equal(afterNewForm.formOpen, true);
  assert.deepEqual(afterNewForm.fields, browser.beforeRetry.fields);
  assert.equal(afterNewForm.returnPostCount, 1, "Opening/refilling must not submit");
  assert.equal(afterNewForm.observerInstalledBeforeApp, true);
  assert.equal(afterSecondSuccess.formClosed, true);
  assert.equal(afterSecondSuccess.returnPostCount, 2);
  assert.equal(afterSecondSuccess.visibleCreditNoteCount, 2);
  assert.deepEqual([...afterSecondSuccess.references].sort(), [first.reference, second.reference].sort());
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = new URL("../generated-artifacts/verification/", import.meta.url);
  const load = (suffix) => JSON.parse(readFileSync(new URL(
    `browser-reloaded-identical-return${suffix}.json`, dir), "utf8"));
  checkReloadedIdenticalReturn(load("-proxy"), load(""), load("-before-retry-proxy"),
    load("-after-success-proxy"));
  console.log("PASS: readable success, failed cleanup, reload replay, then fresh identical return; exactly two historical-cost restorations.");
}
