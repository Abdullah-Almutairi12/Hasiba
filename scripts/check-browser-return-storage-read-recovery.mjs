import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkBrowserReturnStorageReadBlock } from "./check-browser-return-storage-read-block.mjs";

export function checkBrowserReturnStorageReadRecovery(blockedProxy, blockedBrowser, proxy, browser) {
  checkBrowserReturnStorageReadBlock(blockedProxy, blockedBrowser);
  assert.equal(proxy.runId, blockedProxy.runId);
  assert.equal(browser.runId, proxy.runId);
  assert.equal(proxy.scenario, "identical-return");
  assert.deepEqual(proxy.returnFixture, blockedProxy.returnFixture);
  assert.deepEqual(proxy.initialCounts, blockedProxy.initialCounts);
  assert.deepEqual(proxy.initialReturnState, blockedProxy.initialReturnState);
  assert.equal(proxy.returnPostCount, 1);
  assert.equal(browser.returnPostCount, 1);
  assert.equal(proxy.invoicePostCount, 0);
  assert.equal(proxy.receiptPostCount, 0);
  assert.equal(proxy.events.length, 1);
  const event = proxy.events[0];
  assert.equal(event.upstreamStatus, 201);
  assert.equal(event.dropped, false);
  assert.equal(event.replayed, false);
  assert.equal(event.storageKey, blockedBrowser.blockedKeys[0], "Retry the exact blocked operation");
  assert.ok(event.key);
  assert.deepEqual(event.counts, { invoices: 1, creditNotes: 1, receipts: 1 });
  assert.equal(proxy.finalReceipts.length, 1);
  assert.deepEqual(proxy.finalReceipts, event.receipts);
  assert.equal(proxy.finalReceipts[0].key, event.key);
  assert.equal(String(proxy.finalReceipts[0].creditNoteId), String(event.creditNoteId));
  assert.deepEqual(proxy.finalReturnState, event.returnState);
  const state = proxy.finalReturnState;
  const fixture = proxy.returnFixture;
  assert.equal(state.notes.length, 1);
  assert.equal(state.notes[0].id, event.creditNoteId);
  assert.equal(state.notes[0].invoiceId, fixture.id);
  assert.equal(state.notes[0].status, "issued");
  assert.ok(state.notes[0].journalEntryId);
  assert.equal(state.moves.length, 1);
  const move = state.moves[0];
  assert.equal(move.noteId, event.creditNoteId);
  assert.equal(move.productId, fixture.productId);
  assert.equal(move.invoiceLineId, fixture.lineId);
  assert.equal(move.originalMoveId, fixture.issueMoveId);
  assert.equal(move.state, "done");
  assert.equal(move.warehouseId, fixture.warehouseId);
  assert.equal(move.quantity, 1);
  assert.equal(move.unitCost, fixture.unitCost);
  assert.equal(state.stock, 1);
  assert.deepEqual(state.quants, [{ warehouseId: fixture.warehouseId, quantity: 1, avgCost: fixture.unitCost }]);
  const { beforeRecovery: before, afterRecovery: after } = browser;
  for (const stage of [before, after]) {
    assert.ok(Number.isFinite(stage.observedAt));
    assert.equal(stage.timeOrigin, blockedBrowser.beforeSave.timeOrigin, "No reload or new document");
    assert.deepEqual(stage.financialEntries, []);
  }
  assert.equal(before.formOpen, true);
  assert.deepEqual(before.fields, blockedBrowser.beforeSave.fields, "No editing or replacing the form");
  assert.ok(blockedProxy.capturedAt <= before.observedAt);
  assert.ok(before.observedAt < event.recordedAt);
  assert.ok(event.recordedAt <= after.observedAt);
  assert.ok(after.observedAt <= proxy.receiptsObservedAt);
  assert.equal(after.formOpen, false);
  assert.equal(after.visibleReference, event.reference);
  assert.equal(after.listRowCount, 1);
  assert.equal(browser.originalMethodsRestored, true);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = new URL("../generated-artifacts/verification/", import.meta.url);
  const load = (name) => JSON.parse(readFileSync(new URL(name, dir), "utf8"));
  checkBrowserReturnStorageReadRecovery(
    load("browser-return-storage-block-proxy.json"),
    load("browser-return-storage-read-block.json"),
    load("browser-identical-return-proxy.json"),
    load("browser-return-storage-read-recovery.json"),
  );
  console.log("PASS: same return form recovered after rejected storage read; one POST, credit note, financial receipt and stock restoration; methods restored.");
}
