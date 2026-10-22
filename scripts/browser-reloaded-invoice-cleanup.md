# Confirmed invoice success: cleanup failure followed by a real reload

This is distinct from both a lost/unreadable response and a failed storage read.
Use the existing disposable setup in `browser-invoice-cleanup-success.md` and
`browser-cleanup-identical-invoice.md`, but **reload before confirmation**.
Do not alter application data, bypass login, or seed/replace a financial key.

1. Start `node scripts/test-isolated.mjs --browser`; wait for fixtures ready.
   Stop the normal API workflow, keep ERP running, then start:
   ```
   pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/test/browser-retry-proxy.ts --pass-success
   ```
   Read synthetic credentials privately from `/tmp/hasba-browser-state.json`;
   log in normally. Never copy credentials into evidence.
2. Open `/sales` → فواتير العملاء → فاتورة جديدة. Choose the fixture customer
   and `منتج اختبار`, quantity 1, price 100, discount 0, VAT 15%, notes
   `Reload cleanup invoice`. Capture actual rendered fields. The invoice dialog
   has no date input; do not invent one or add a date to the request.
3. Passively observe invoice fetches (request body/key, HTTP status, replay
   header and cloned parsed JSON with `jsonObservedAt: Date.now()`).
   Save original fetch and `Storage.prototype.removeItem`. Throw SecurityError
   only for sessionStorage financial-prefixed removals; record key/time.
   Reads/writes and unrelated storage remain unblocked.
4. Click حفظ once. Capture the open unchanged form, original financial entry,
   and exact saved-but-cleanup-failed message. Require parsed 201 JSON before
   the failed removal. Restore removeItem/fetch in `finally`, prove identities
   and a successful ordinary write/remove probe. Record `restoredBeforeReload`.
5. Preserve first-document observations outside the page. Install a passive
   invoice fetch observer **before app scripts in the next document** (browser
   init script), then perform a genuine browser reload. No API calls by the
   harness may create invoices. Capture `afterReload` before opening the form:
   closed dialog, same stored entry, navigation type `reload`, new timeOrigin,
   zero outgoing invoice POSTs. Reopen and refill the exact original values,
   Capture `beforeRetry`: same fields/entry, zero outgoing
   POSTs, `observerInstalledBeforeApp: true`. Never edit the pending key.
6. Before clicking Save, capture read-only proxy/database evidence:
   ```
   pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/test/browser-retry-proxy.ts --pass-success --capture-receipts
   cp generated-artifacts/verification/browser-retry-proxy.json generated-artifacts/verification/browser-reloaded-invoice-cleanup-before-retry-proxy.json
   ```
   Require one ingress, invoice, financial receipt and journal; no extra request
   on reload/open/refill. Never edit proxy evidence.
7. Click حفظ once. Require exactly one POST in this new document, byte-identical
   body/key, 201 with `Idempotency-Replayed: true` and original ID/reference.
   Capture closed form, removed key and exactly one visible row/reference.
   Restore the new document's observer in `finally` and remove the init script.
   If the browser wrapper returns no removal handle, make the script one-shot
   (self-disarm using a nonfinancial tab marker) and close the test tab afterwards.
   Prove original methods and ordinary storage probe work.
8. Save browser observations to ignored
   `generated-artifacts/verification/browser-reloaded-invoice-cleanup.json`.
   Use `check-browser-invoice-cleanup-success.mjs`'s existing contract
   (`entries: [{storageKey, key}]`, responses, removalAttempts, restored).
   Add `faultMethod: "removeItem"`, `faultName: "SecurityError"`, synthetic
   `customerId`/`customerName`, `restoredBeforeReload: {removeItem, fetch, probe}`,
   and `afterReload`. All stages (`beforeSave`, `afterCleanupFailure`,
   `afterReload`, `beforeRetry`, `afterSuccess`) include raw `observedAt` and
   `timeOrigin`. Actual form `fields` use customerName, description, quantity,
   unitPrice, discountPct, taxRate, notes (strings). Verify the default VAT from
   the rendered tax-inclusive total (115) and the actual outgoing line (15%).
   `afterReload` adds formClosed, entries, navigationType, invoicePostCount;
   also capture observerInstalledBeforeApp, readyStateAtInstall,
   observerTimeOrigin, observerInstalledAt from the document-start observer.
   `beforeRetry` adds formOpen, entries, fields, invoicePostCount,
   observerInstalledBeforeApp; `afterSuccess` adds invoicePostCount.
   Include `restoredAfterReload: {fetch, probe, removeItemProbe}`.
   Do not fit offsets between independent browser and proxy clocks.
9. Before disposal:
   ```
   pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/test/browser-retry-proxy.ts --pass-success --capture-receipts
   node scripts/check-browser-reloaded-invoice-cleanup.mjs
   node --test scripts/check-browser-reloaded-invoice-cleanup.test.mjs scripts/check-browser-invoice-cleanup-success.test.mjs scripts/check-browser-cleanup-identical-invoice.test.mjs
   ```
10. Gracefully SIGTERM proxy then isolated runner. Verify the positively
    identified disposable cluster, processes and private fixture file are gone.
    Restore the normal API workflow and check startup logs. Evidence stays under
    ignored `generated-artifacts/verification`; no credentials or runtime JSON
    belong in Git.

## Verified result

The isolated normal-login browser run passed. The first Save returned readable
201 JSON before the scoped removeItem SecurityError. The unchanged dialog and
financial key remained with the explicit saved-but-cleanup-failed message.
Original methods and a storage probe were verified restored before reload.

A genuine reload changed the document time origin and reported navigation type
`reload`. The same key survived. A document-start observer recorded zero invoice
POSTs through reload, reopening and refilling; the separate pre-confirmation proxy
capture still showed only the original ingress, invoice, financial receipt and
journal. No key was seeded or replaced.

One confirmation Save returned 201 with `Idempotency-Replayed: true`, the exact
original request bytes/key and original invoice identity/reference. The form
closed, its key disappeared and one invoice row remained. Final read-only capture
retained one invoice, receipt and journal with no inventory effects. Both
documents' injected methods were restored. The one-shot init script was discarded
by closing its test tab because the browser wrapper provided no removal handle.

The real evidence guard and regression cases passed. The proxy and isolated
runner exited gracefully with code zero; their processes, private fixture file
and positively identified disposable database directory were removed. The normal
API workflow was restored. No application code or business data was changed.
