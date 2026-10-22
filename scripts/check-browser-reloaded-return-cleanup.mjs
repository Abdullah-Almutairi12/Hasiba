import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Browser and proxy clocks are independent. Match bytes/identities between
// them; order observations only within their own clock domain.
export function checkReloadedReturnCleanup(proxy, browser, beforeRetryProxy) {
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
  assert.ok(Number.isInteger(browser.customerId) && browser.customerId > 0);
  assert.ok(browser.customerName);
  const [first, retry] = proxy.events;
  assert.deepEqual(first.body, {
    customerId: browser.customerId, invoiceId: f.id, reason: "Reload cleanup return",
    restock: true, lines: [{ productId: f.productId, description: f.description,
      quantity: 1, unitPrice: 100, taxRate: 0, invoiceLineId: f.lineId }],
  });
  assert.equal(browser.responses.length, 2);
  const bytes = browser.responses[0].requestBody;
  assert.equal(bytes, browser.responses[1].requestBody);
  assert.deepEqual(JSON.parse(bytes), first.body);
  const hash = (s) => createHash("sha256").update(s).digest("hex");
  assert.equal(first.bodyHash, hash(bytes));
  assert.equal(first.storageKey, `hasba:financial-request:${hash(`/api/sales/credit-notes\n${bytes}`)}`);
  assert.ok(first.key);
  assert.ok(Number.isInteger(first.creditNoteId) && first.creditNoteId > 0);
  assert.match(first.reference, /^CN-/);
  for (const [i, event] of proxy.events.entries()) {
    assert.equal(event.upstreamStatus, 201);
    assert.equal(event.dropped, false);
    assert.equal(event.replayed, i === 1);
    assert.equal(event.replayHeader, i ? "true" : null);
    assert.ok(Number.isFinite(event.recordedAt));
    for (const name of ["key", "storageKey", "bodyHash", "body", "creditNoteId",
      "reference", "counts", "receipts", "returnState"]) {
      assert.deepEqual(event[name], first[name], `Replay must preserve ${name}`);
    }
    const response = browser.responses[i];
    assert.equal(response.status, 201);
    assert.equal(response.replayed, i === 1);
    assert.equal(response.body.id, first.creditNoteId);
    assert.equal(response.body.reference, first.reference);
    assert.equal(response.key, first.key);
    assert.ok(Number.isFinite(response.jsonObservedAt));
  }
  assert.ok(first.recordedAt <= retry.recordedAt);
  assert.deepEqual(first.counts, { invoices: 1, creditNotes: 1, receipts: 1 });
  assert.equal(first.receipts.length, 1);
  const receipt = first.receipts[0];
  for (const name of ["companyId", "userId"]) {
    assert.ok(Number.isInteger(receipt[name]) && receipt[name] > 0);
  }
  assert.match(receipt.operation, /^POST:.*:\/sales\/credit-notes$/);
  assert.equal(receipt.key, first.key);
  assert.equal(String(receipt.creditNoteId), String(first.creditNoteId));
  const s = first.returnState;
  assert.equal(s.notes.length, 1);
  assert.deepEqual(s.notes[0], { id: first.creditNoteId, reference: first.reference,
    invoiceId: f.id, journalEntryId: s.notes[0].journalEntryId, status: "issued" });
  assert.ok(Number.isInteger(s.notes[0].journalEntryId) && s.notes[0].journalEntryId > 0);
  assert.equal(s.moves.length, 1);
  assert.ok(Number.isInteger(s.moves[0].id) && s.moves[0].id > 0);
  assert.deepEqual(s.moves[0], { id: s.moves[0].id, productId: f.productId,
    noteId: first.creditNoteId, invoiceLineId: f.lineId, originalMoveId: f.issueMoveId,
    warehouseId: f.warehouseId, quantity: 1, unitCost: 50, state: "done" });
  assert.equal(s.stock, 1);
  assert.deepEqual(s.quants, [{ warehouseId: f.warehouseId, quantity: 1, avgCost: 50 }]);

  const { beforeSave, afterCleanupFailure, afterReload, beforeRetry, afterSuccess } = browser;
  const stages = [beforeSave, afterCleanupFailure, afterReload, beforeRetry, afterSuccess];
  for (const [i, stage] of stages.entries()) {
    assert.ok(Number.isFinite(stage.observedAt));
    assert.ok(Number.isFinite(stage.timeOrigin) && stage.timeOrigin > 0);
    assert.ok(stage.observedAt >= stage.timeOrigin);
    if (i) assert.ok(stage.observedAt > stages[i - 1].observedAt);
  }
  const entries = [[first.storageKey, first.key]];
  const fields = { customerName: browser.customerName, invoiceReference: f.reference,
    reason: first.body.reason, restock: true, description: f.description,
    quantity: "1", unitPrice: "100", taxRate: "0" };
  assert.deepEqual(beforeSave.entries, []);
  for (const stage of [beforeSave, afterCleanupFailure, beforeRetry]) {
    assert.equal(stage.formOpen, true);
    assert.deepEqual(stage.fields, fields);
  }
  for (const stage of [afterCleanupFailure, afterReload, beforeRetry]) {
    assert.deepEqual(stage.entries, entries);
  }
  assert.equal(browser.faultMethod, "removeItem");
  assert.equal(browser.faultName, "SecurityError");
  assert.equal(browser.unrelatedStorageWorked, true);
  assert.match(afterCleanupFailure.message, /تم حفظ العملية بالفعل، لكن تعذر تنظيف مفتاحها/);
  assert.equal(browser.removalAttempts.length, 1);
  assert.equal(browser.removalAttempts[0].key, first.storageKey);
  assert.ok(beforeSave.observedAt <= browser.responses[0].jsonObservedAt);
  assert.ok(browser.responses[0].jsonObservedAt <= browser.removalAttempts[0].at);
  assert.ok(browser.removalAttempts[0].at <= afterCleanupFailure.observedAt);
  assert.equal(afterCleanupFailure.timeOrigin, beforeSave.timeOrigin);
  assert.ok(afterReload.timeOrigin > afterCleanupFailure.timeOrigin);
  assert.equal(afterReload.navigationType, "reload");
  assert.equal(afterReload.formClosed, true);
  assert.equal(afterReload.returnPostCount, 0);
  assert.equal(afterReload.observerInstalledBeforeApp, true);
  assert.equal(afterReload.readyStateAtInstall, "loading");
  assert.equal(afterReload.observerTimeOrigin, afterReload.timeOrigin);
  assert.ok(Number.isFinite(afterReload.observerInstalledAt));
  assert.ok(afterReload.observerInstalledAt >= afterReload.timeOrigin);
  assert.ok(afterReload.observerInstalledAt <= afterReload.observedAt);
  assert.equal(beforeRetry.timeOrigin, afterReload.timeOrigin);
  assert.equal(beforeRetry.observerInstalledBeforeApp, true);
  assert.equal(beforeRetry.returnPostCount, 0);
  assert.ok(browser.responses[1].jsonObservedAt >= beforeRetry.observedAt);
  assert.ok(afterSuccess.observedAt >= browser.responses[1].jsonObservedAt);
  assert.equal(afterSuccess.timeOrigin, afterReload.timeOrigin);
  assert.equal(afterSuccess.returnPostCount, 1);
  assert.equal(afterSuccess.formClosed, true);
  assert.deepEqual(afterSuccess.entries, []);
  assert.equal(afterSuccess.visibleCreditNoteCount, 1);
  assert.deepEqual(afterSuccess.references, [first.reference]);
  assert.deepEqual(browser.restoredBeforeReload, { removeItem: true, fetch: true, probe: true });
  assert.deepEqual(browser.restoredAfterReload, { fetch: true, probe: true, removeItemProbe: true });

  assert.equal(beforeRetryProxy.runId, proxy.runId);
  assert.equal(beforeRetryProxy.scenario, proxy.scenario);
  assert.equal(beforeRetryProxy.returnPostCount, 1, "No automatic POST before confirmation");
  assert.equal(beforeRetryProxy.invoicePostCount, 0);
  assert.equal(beforeRetryProxy.receiptPostCount, 0);
  assert.deepEqual(beforeRetryProxy.events, [first]);
  for (const name of ["initialCounts", "initialReturnState", "returnFixture"]) {
    assert.deepEqual(beforeRetryProxy[name], proxy[name]);
  }
  for (const capture of [beforeRetryProxy, proxy]) {
    assert.deepEqual(capture.finalReceipts, first.receipts);
    assert.deepEqual(capture.finalReturnState, first.returnState);
    assert.ok(Number.isFinite(capture.receiptsObservedAt));
  }
  assert.ok(first.recordedAt <= beforeRetryProxy.receiptsObservedAt);
  assert.ok(beforeRetryProxy.receiptsObservedAt < retry.recordedAt);
  assert.ok(proxy.receiptsObservedAt >= retry.recordedAt);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = new URL("../generated-artifacts/verification/", import.meta.url);
  const load = (name) => JSON.parse(readFileSync(new URL(name, dir), "utf8"));
  checkReloadedReturnCleanup(load("browser-identical-return-proxy.json"),
    load("browser-reloaded-return-cleanup.json"), load("browser-reloaded-return-cleanup-before-retry-proxy.json"));
  console.log("PASS: readable 201, cleanup failure, reload without POST, same issued return/receipt/journal/movement and one historical-cost restock.");
}
