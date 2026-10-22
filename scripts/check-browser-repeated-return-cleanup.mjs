import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Keep raw browser/proxy times: they are independent clocks.
export function checkRepeatedReturnCleanup(proxy, browser) {
  assert.equal(proxy.scenario, "identical-return");
  assert.ok(proxy.runId);
  assert.equal(browser.runId, proxy.runId);
  assert.equal(browser.faultMethod, "removeItem");
  assert.equal(browser.faultName, "SecurityError");
  assert.equal(browser.unrelatedStorageWorked, true);
  const failures = browser.afterFailures;
  // Original save AND at least two consecutive confirmations with the fault.
  assert.ok(Array.isArray(failures) && failures.length >= 3);
  const count = failures.length + 1;
  assert.equal(proxy.returnPostCount, count);
  assert.equal(proxy.invoicePostCount, 0);
  assert.equal(proxy.receiptPostCount, 0);
  assert.equal(proxy.events.length, count);
  assert.equal(browser.responses.length, count);
  assert.equal(browser.removalAttempts.length, failures.length);
  assert.deepEqual(proxy.initialCounts, { invoices: 1, creditNotes: 0, receipts: 0 });
  const f = proxy.returnFixture;
  assert.ok(f.soldQuantity >= f.returnQuantity);
  assert.equal(f.returnQuantity, 1);
  assert.equal(f.unitCost, 50);
  assert.deepEqual(proxy.initialReturnState, { notes: [], moves: [], stock: 0,
    quants: [{ warehouseId: f.warehouseId, quantity: 0, avgCost: 0 }] });
  assert.ok(Number.isInteger(browser.customerId) && browser.customerId > 0);
  assert.ok(browser.customerName);
  const first = proxy.events[0];
  const bytes = browser.responses[0].requestBody;
  const hash = (s) => createHash("sha256").update(s).digest("hex");
  assert.deepEqual(first.body, {
    customerId: browser.customerId, invoiceId: f.id, reason: "Repeated cleanup return",
    restock: true, lines: [{ productId: f.productId, description: f.description,
      quantity: 1, unitPrice: 100, taxRate: 0, invoiceLineId: f.lineId }],
  });
  assert.deepEqual(JSON.parse(bytes), first.body);
  assert.equal(first.bodyHash, hash(bytes));
  assert.equal(first.storageKey, `hasba:financial-request:${hash(`/api/sales/credit-notes\n${bytes}`)}`);
  assert.ok(first.key);
  assert.ok(Number.isInteger(first.creditNoteId) && first.creditNoteId > 0);
  assert.match(first.reference, /^CN-/);
  assert.deepEqual(first.counts, { invoices: 1, creditNotes: 1, receipts: 1 });
  assert.equal(first.receipts.length, 1);
  const receipt = first.receipts[0];
  for (const name of ["companyId", "userId"]) {
    assert.ok(Number.isInteger(receipt[name]) && receipt[name] > 0);
  }
  assert.equal(receipt.operation, "POST:/api:/sales/credit-notes");
  assert.equal(receipt.key, first.key);
  assert.equal(String(receipt.creditNoteId), String(first.creditNoteId));
  const state = first.returnState;
  assert.equal(state.notes.length, 1);
  assert.deepEqual(state.notes[0], { id: first.creditNoteId, reference: first.reference,
    invoiceId: f.id, journalEntryId: state.notes[0].journalEntryId, status: "issued" });
  assert.ok(Number.isInteger(state.notes[0].journalEntryId) && state.notes[0].journalEntryId > 0);
  assert.equal(state.moves.length, 1);
  assert.ok(Number.isInteger(state.moves[0].id) && state.moves[0].id > 0);
  assert.deepEqual(state.moves[0], { id: state.moves[0].id, productId: f.productId,
    noteId: first.creditNoteId, invoiceLineId: f.lineId, originalMoveId: f.issueMoveId,
    warehouseId: f.warehouseId, quantity: 1, unitCost: 50, state: "done" });
  assert.equal(state.stock, 1);
  assert.deepEqual(state.quants, [{ warehouseId: f.warehouseId, quantity: 1, avgCost: 50 }]);
  assert.equal(first.responseBody.companyId, receipt.companyId);
  assert.equal(first.responseBody.createdBy, receipt.userId);
  assert.equal(first.responseBody.invoiceId, f.id);
  assert.equal(first.responseBody.journalEntryId, state.notes[0].journalEntryId);

  const fields = { customerName: browser.customerName, invoiceReference: f.reference,
    reason: first.body.reason, restock: true, description: f.description,
    quantity: "1", unitPrice: "100", taxRate: "0" };
  const entries = [[first.storageKey, first.key]];
  const stages = [browser.beforeSave, ...failures, browser.beforeRecovery, browser.afterSuccess];
  for (const [i, stage] of stages.entries()) {
    assert.ok(Number.isFinite(stage.observedAt));
    assert.ok(Number.isFinite(stage.timeOrigin) && stage.timeOrigin > 0);
    assert.equal(stage.timeOrigin, browser.beforeSave.timeOrigin);
    assert.ok(stage.observedAt >= stage.timeOrigin);
    if (i) assert.ok(stage.observedAt > stages[i - 1].observedAt);
  }
  assert.deepEqual(browser.beforeSave.entries, []);
  assert.equal(browser.beforeSave.returnPostCount, 0);
  for (const stage of [browser.beforeSave, ...failures, browser.beforeRecovery]) {
    assert.equal(stage.formOpen, true);
    assert.deepEqual(stage.fields, fields);
  }
  for (const [i, event] of proxy.events.entries()) {
    assert.equal(event.upstreamStatus, 201);
    assert.equal(event.dropped, false);
    assert.equal(event.replayed, i > 0);
    assert.equal(event.replayHeader, i ? "true" : null);
    assert.ok(Number.isFinite(event.recordedAt));
    if (i) assert.ok(event.recordedAt >= proxy.events[i - 1].recordedAt);
    for (const name of ["key", "storageKey", "bodyHash", "body", "creditNoteId",
      "reference", "counts", "receipts", "returnState", "responseBody"]) {
      assert.deepEqual(event[name], first[name], `Every confirmation must preserve ${name}`);
    }
    const response = browser.responses[i];
    assert.equal(response.status, 201);
    assert.equal(response.replayed, i > 0);
    assert.equal(response.body.id, first.creditNoteId);
    assert.equal(response.body.reference, first.reference);
    assert.deepEqual(response.body, event.responseBody);
    assert.equal(response.key, first.key);
    assert.equal(response.requestBody, bytes);
    assert.ok(Number.isFinite(response.jsonObservedAt));
    const before = i ? failures[i - 1] : browser.beforeSave;
    assert.ok(response.jsonObservedAt >= before.observedAt);
    if (i < failures.length) {
      const stage = failures[i];
      const attempt = browser.removalAttempts[i];
      assert.equal(attempt.key, first.storageKey);
      assert.ok(Number.isFinite(attempt.at));
      assert.ok(response.jsonObservedAt <= attempt.at);
      assert.ok(attempt.at <= stage.observedAt);
      assert.deepEqual(stage.entries, entries);
      assert.equal(stage.returnPostCount, i + 1);
      assert.match(stage.message, /تم حفظ العملية بالفعل، لكن تعذر تنظيف مفتاحها/);
      assert.match(stage.message, /أعد المحاولة بنفس البيانات/);
      assert.match(stage.message, /لا تبدأ عملية جديدة/);
      assert.equal(stage.message, failures[0].message);
    }
  }
  assert.deepEqual(browser.beforeRecovery.entries, entries);
  assert.equal(browser.beforeRecovery.returnPostCount, failures.length);
  // Error toasts are transient. Every faulted save above must show the full
  // warning; it may expire while restoring/probing storage before recovery.
  assert.ok(browser.beforeRecovery.message === null ||
    browser.beforeRecovery.message === failures[0].message);
  assert.deepEqual(browser.storageRestored, { removeItem: true, probe: true });
  assert.ok(browser.responses.at(-1).jsonObservedAt >= browser.beforeRecovery.observedAt);
  assert.ok(browser.afterSuccess.observedAt >= browser.responses.at(-1).jsonObservedAt);
  assert.equal(browser.afterSuccess.formClosed, true);
  assert.equal(browser.afterSuccess.returnPostCount, count);
  assert.deepEqual(browser.afterSuccess.entries, []);
  assert.equal(browser.afterSuccess.visibleCreditNoteCount, 1);
  assert.deepEqual(browser.afterSuccess.references, [first.reference]);
  assert.equal(browser.afterSuccess.cleanupMessageVisible, false);
  assert.deepEqual(browser.restored, { fetch: true, removeItem: true, probe: true });
  assert.deepEqual(proxy.finalReceipts, first.receipts);
  assert.deepEqual(proxy.finalReturnState, state);
  // The return fixture has no seeded journals. Checking the whole table also
  // catches an orphan duplicate not referenced by the sole credit-note row.
  assert.deepEqual(proxy.finalJournals, [{ id: state.notes[0].journalEntryId }]);
  assert.ok(Number.isFinite(proxy.receiptsObservedAt));
  assert.ok(proxy.receiptsObservedAt >= proxy.events.at(-1).recordedAt);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = new URL("../generated-artifacts/verification/", import.meta.url);
  const load = (name) => JSON.parse(readFileSync(new URL(name, dir), "utf8"));
  checkRepeatedReturnCleanup(load("browser-identical-return-proxy.json"),
    load("browser-repeated-return-cleanup.json"));
  console.log("PASS: repeated cleanup failures preserve form/key/message; recovery replays one note/receipt/journal/restock.");
}
