import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkInvoiceCleanup } from "./check-browser-invoice-cleanup-success.mjs";

// A separate three-request scenario: do not relax the original two-request guard.
export function checkCleanupIdenticalInvoice(proxy, browser) {
  assert.equal(proxy.invoicePostCount, 3);
  assert.equal(proxy.events.length, 3);
  assert.equal(browser.responses.length, 3);
  const [first, retry, second] = proxy.events;
  // Remote browser and API clocks can differ. Compare only within one clock
  // domain; prefer unadjusted observations when an older capture retained both.
  const observedAt = (r) => r.rawJsonObservedAt ?? r.jsonObservedAt;
  const responses = browser.responses.map((r) => ({ ...r, jsonObservedAt: observedAt(r) }));
  const removalAttempts = browser.removalAttempts.map((r) => ({ ...r, at: r.rawAt ?? r.at }));
  // Validate the completed recovery using its own contemporaneous DB snapshot.
  checkInvoiceCleanup({
    ...proxy, invoicePostCount: 2, events: [first, retry],
    finalCounts: retry.counts, finalJournals: retry.journals, finalReceipts: retry.receipts,
  }, { ...browser, responses: responses.slice(0, 2), removalAttempts });
  assert.equal(first.replayHeader, null);
  assert.equal(second.upstreamStatus, 201);
  assert.equal(second.dropped, false);
  assert.equal(second.replayed, false);
  assert.equal(second.replayHeader, null);
  assert.ok(typeof second.key === "string" && second.key.length > 0);
  assert.notEqual(second.key, first.key);
  assert.ok(second.invoiceId);
  assert.ok(second.reference);
  assert.notEqual(second.invoiceId, first.invoiceId);
  assert.notEqual(second.reference, first.reference);
  for (const field of ["body", "bodyHash", "storageKey"]) {
    assert.deepEqual(second[field], first[field], `Identical ${field}`);
  }
  assert.deepEqual(second.counts, { invoices: 2, receipts: 2 });
  assert.deepEqual(proxy.finalCounts, second.counts);
  assert.equal(second.journals.length, 2);
  assert.equal(new Set(second.journals.map((j) => j.id)).size, 2);
  assert.ok(second.journals.some((j) => j.id === first.journals[0].id));
  assert.deepEqual(proxy.finalJournals, second.journals);
  assert.equal(second.receipts.length, 2);
  assert.deepEqual(second.receipts.find((r) => r.key === first.key), first.receipts[0]);
  const receipt = second.receipts.find((r) => r.key === second.key);
  assert.ok(receipt);
  assert.equal(String(receipt.invoiceId), String(second.invoiceId));
  for (const field of ["companyId", "userId", "operation"]) {
    assert.ok(first.receipts[0][field]);
    assert.equal(receipt[field], first.receipts[0][field]);
  }
  assert.deepEqual(proxy.finalReceipts, second.receipts);
  assert.ok(Number.isFinite(proxy.receiptsObservedAt) && proxy.receiptsObservedAt >= second.recordedAt);

  const response = browser.responses[2];
  assert.equal(response.status, 201);
  assert.equal(response.replayed, false);
  assert.equal(response.body.id, second.invoiceId);
  assert.equal(response.body.reference, second.reference);
  assert.equal(response.key, second.key);
  assert.equal(response.requestBody, browser.responses[0].requestBody);
  assert.deepEqual(JSON.parse(response.requestBody), second.body);
  assert.ok(Number.isFinite(observedAt(response)));
  const { afterSuccess, afterNewForm, afterSecondSuccess } = browser;
  for (const stage of [afterSuccess, afterNewForm, afterSecondSuccess]) {
    assert.ok(Number.isFinite(stage.observedAt));
    assert.ok(Number.isFinite(stage.timeOrigin));
    assert.equal(stage.timeOrigin, afterSuccess.timeOrigin, "Use the same tab and document");
    assert.deepEqual(stage.entries, []);
  }
  assert.ok(afterSuccess.observedAt >= observedAt(browser.responses[1]));
  assert.ok(afterSuccess.observedAt < afterNewForm.observedAt);
  assert.ok(afterNewForm.observedAt < observedAt(response));
  assert.ok(afterSecondSuccess.observedAt >= observedAt(response));
  assert.equal(afterNewForm.formOpen, true);
  assert.deepEqual(afterNewForm.fields, browser.beforeSave.fields);
  assert.equal(afterSecondSuccess.formClosed, true);
  assert.equal(afterSecondSuccess.visibleInvoiceCount, 2);
  assert.deepEqual([...afterSecondSuccess.references].sort(), [first.reference, second.reference].sort());
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = "generated-artifacts/verification";
  checkCleanupIdenticalInvoice(
    JSON.parse(readFileSync(`${dir}/browser-retry-proxy.json`, "utf8")),
    JSON.parse(readFileSync(`${dir}/browser-cleanup-identical-invoice.json`, "utf8")),
  );
  console.log("PASS: cleanup recovery replay followed by a fresh identical invoice and independent persisted receipt");
}
