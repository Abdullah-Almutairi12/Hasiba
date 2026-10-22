import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkCleanupIdenticalInvoice } from "./check-browser-cleanup-identical-invoice.mjs";

// Keep the original single-failure scenario strict. This evidence contract
// requires an original success AND multiple failed replay cleanups.
export function checkRepeatedInvoiceCleanup(proxy, browser) {
  const failures = browser.cleanupFailures;
  assert.ok(Array.isArray(failures) && failures.length >= 3);
  const n = failures.length;
  assert.equal(proxy.invoicePostCount, n + 2);
  assert.equal(proxy.events.length, n + 2);
  assert.equal(browser.responses.length, n + 2);
  assert.equal(browser.removalAttempts.length, n);
  const first = proxy.events[0];
  const parsedAt = (r) => r.rawJsonObservedAt ?? r.jsonObservedAt;
  const removedAt = (r) => r.rawAt ?? r.at;
  const origin = browser.beforeSave.timeOrigin;
  assert.ok(Number.isFinite(origin));
  assert.ok(Number.isFinite(browser.beforeSave.observedAt));
  assert.ok(browser.beforeSave.observedAt < parsedAt(browser.responses[0]));
  const recovery = browser.beforeRecovery;
  assert.equal(recovery.formOpen, true);
  assert.deepEqual(recovery.fields, browser.beforeSave.fields);
  assert.deepEqual(recovery.entries, [{ storageKey: first.storageKey, key: first.key }]);
  assert.deepEqual(recovery.restored, { removeItem: true, probe: true });
  assert.equal(recovery.timeOrigin, origin);
  assert.ok(Number.isFinite(recovery.observedAt));
  assert.equal(browser.afterSuccess.timeOrigin, origin);

  for (let i = 0; i < n; i++) {
    const event = proxy.events[i];
    const response = browser.responses[i];
    const attempt = browser.removalAttempts[i];
    const stage = failures[i];
    assert.equal(event.upstreamStatus, 201);
    assert.equal(event.dropped, false);
    assert.equal(event.replayed, i > 0);
    assert.equal(event.replayHeader, i > 0 ? "true" : null);
    for (const field of ["invoiceId", "reference", "key", "bodyHash", "storageKey", "body", "counts", "journals", "receipts"]) {
      assert.deepEqual(event[field], first[field], `Failure ${i}: unchanged ${field}`);
    }
    assert.ok(Number.isFinite(event.recordedAt));
    if (i) assert.ok(event.recordedAt >= proxy.events[i - 1].recordedAt);
    assert.equal(response.status, 201);
    assert.equal(response.replayed, i > 0);
    assert.equal(response.key, first.key);
    assert.equal(response.body.id, first.invoiceId);
    assert.equal(response.body.reference, first.reference);
    assert.equal(response.requestBody, browser.responses[0].requestBody);
    assert.deepEqual(JSON.parse(response.requestBody), first.body);
    assert.ok(Number.isFinite(parsedAt(response)));
    assert.equal(attempt.key, first.storageKey);
    assert.ok(Number.isFinite(removedAt(attempt)));
    assert.ok(removedAt(attempt) >= parsedAt(response), "Cleanup follows parsed success");
    assert.equal(stage.formOpen, true);
    assert.deepEqual(stage.fields, browser.beforeSave.fields);
    assert.deepEqual(stage.entries, [{ storageKey: first.storageKey, key: first.key }]);
    assert.match(stage.message, /تم حفظ العملية بالفعل، لكن تعذر تنظيف مفتاحها/);
    assert.equal(stage.timeOrigin, origin);
    assert.ok(Number.isFinite(stage.observedAt) && stage.observedAt >= removedAt(attempt));
    const nextAt = i + 1 < n ? parsedAt(browser.responses[i + 1]) : recovery.observedAt;
    assert.ok(stage.observedAt < nextAt, "Separate sequential confirmations, not overlapping clicks");
  }
  assert.ok(recovery.observedAt < parsedAt(browser.responses[n]));
  assert.ok(proxy.events[n].recordedAt >= proxy.events[n - 1].recordedAt);
  assert.ok(proxy.events[n + 1].recordedAt >= proxy.events[n].recordedAt);
  // Reuse all existing final-replay/new-intent checks on a derived view;
  // never rewrite captured proxy or browser evidence.
  checkCleanupIdenticalInvoice({
    ...proxy, invoicePostCount: 3,
    events: [first, proxy.events[n], proxy.events[n + 1]],
  }, {
    ...browser,
    responses: [browser.responses[0], browser.responses[n], browser.responses[n + 1]],
    removalAttempts: [browser.removalAttempts[0]],
    afterCleanupFailure: failures[0], beforeRetry: recovery,
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = "generated-artifacts/verification";
  checkRepeatedInvoiceCleanup(
    JSON.parse(readFileSync(`${dir}/browser-retry-proxy.json`, "utf8")),
    JSON.parse(readFileSync(`${dir}/browser-repeated-invoice-cleanup.json`, "utf8")),
  );
  console.log("PASS: repeated failed cleanups retain one invoice, final replay recovers, new identical intent is independent");
}
