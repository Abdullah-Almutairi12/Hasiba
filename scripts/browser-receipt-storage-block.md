# Receipt: first financial key write fails before any request

This is independent of failed cleanup after server success/rejection, and of
reading a retained intent after reload. Use the actual completed receipt form.

1. Start `node scripts/test-isolated.mjs --browser --receipts`. Once fixtures
   are ready, stop the normal API workflow (if running), keep ERP running, and
   start the disposable proxy:
   ```
   pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/test/browser-retry-proxy.ts --receipts --pass-success
   ```
   Read synthetic owner credentials privately from `/tmp/hasba-browser-state.json`.
   Sign in normally in an isolated tab; do not use application business data,
   an auth bypass, or include credentials in evidence.
2. Open `/sales` → سندات القبض → سند قبض. Select the fixture customer,
   amount 50, نقدي, allocation 50 to its fixture invoice. Do not save yet.
   Capture `beforeSave` from actual rendered controls, with no financial entries.
3. Save original `Storage.prototype.getItem`, `setItem`, `removeItem` and
   `window.fetch`. Throw `DOMException(..., "SecurityError")` only on
   `setItem` when `this === sessionStorage` and the key starts
   `hasba:financial-request:`. Record attempted keys. Prove unrelated storage
   still works. Passively observe outgoing POST `/api/sales/receipts`, distinguishing
   the blocked phase from later recovery; never block network requests.
4. In `try/finally`, click حفظ السند exactly once and capture `afterBlockedSave`:
   unchanged open form, empty financial entries and the visible message:
   > تعذر حفظ مفتاح العملية بأمان. لم يُرسل الطلب؛ فعّل تخزين الجلسة وأعد المحاولة.

   Require exactly one blocked key, fingerprinted from endpoint plus complete
   intended JSON (customer, amount, cash method and invoice allocation), and
   zero outgoing browser receipt POSTs. Capture a screenshot.
5. Restore all methods in `finally`, verify their identities, and probe a
   separate synthetic financial-prefixed key by writing/reading/removing it
   with cleanup in a nested `finally`. Capture `restored` with the same fields,
   no financial entries, and all restoration/probe flags.
6. **Before recovery**, independently query the disposable database:
   ```
   pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/test/browser-retry-proxy.ts --receipts --capture-receipt-storage-block
   ```
   This writes `browser-receipt-storage-block-proxy.json` with zero proxy
   ingress/arrivals/events, no receipt, allocation, new journal or financial
   request, and unchanged invoice amount paid. Do not edit proxy evidence.
7. Without editing/reloading the form, observe fetch passively, click save once,
   parse a cloned response and restore fetch in `finally`. Require one normal
   HTTP 201 (not replayed), a closed form, cleared key and one visible reference.
   Capture `afterSuccess`, then independently query final database state:
   ```
   pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/test/browser-retry-proxy.ts --receipts --capture-receipts
   ```
8. Save ignored `generated-artifacts/verification/browser-receipt-storage-block.json`.
   See `check-browser-receipt-storage-block.mjs` for the full schema:
   `runId`, `customerId`, `customerName`, `invoiceReference`, `faultMethod:
   "setItem"`, `faultName: "SecurityError"`, `blockedKeys`,
   `blockedReceiptPostCount: 0`, `recoveryReceiptPostCount: 1`,
   `unrelatedStorageWorked`, `beforeSave`, `afterBlockedSave`, `restored`,
   `afterSuccess`, `responses`, `finalRestored`.

   Snapshots include `observedAt`, `timeOrigin`, `entries: []`. Open stages have
   `formOpen: true` and rendered `fields: {customerName, amount: "50",
   paymentMethod: "نقدي", invoiceReference, allocation: "50"}`.
   `afterBlockedSave.error` is the exact visible message. `restored` includes
   `originalGetItemRestored`, `originalSetItemRestored`,
   `originalRemoveItemRestored`, `originalFetchRestored`,
   `financialWriteReadRemoved`. `afterSuccess` has `formClosed`,
   `visibleReceiptCount`, `references`. `responses` records `status`, `replayed`,
   `key`, exact `requestBody`, parsed `body`, `jsonObservedAt`.
   `finalRestored` confirms original fetch/setItem identities after recovery.
   Keep browser and proxy timing assertions within their respective clocks.
   ```
   node scripts/check-browser-receipt-storage-block.mjs
   node --test scripts/check-browser-receipt-storage-block.test.mjs \
     scripts/check-browser-storage-block.test.mjs \
     scripts/check-browser-receipt-cleanup-success.test.mjs \
     scripts/check-browser-reloaded-receipt-read-block.test.mjs
   ```
9. Restore methods even on failure and close the isolated tab. Gracefully
   SIGTERM proxy then runner; verify their processes, private fixture file and
   positively identified disposable PostgreSQL directory are gone. Restore
   the normal API workflow and verify clean startup logs. Runtime evidence and
   screenshots belong only under ignored `generated-artifacts/verification`.

## Verified result

The isolated normal-login browser run passed. The completed receipt had amount
50, cash payment, and allocation 50 to the fixture invoice. Exactly one attempted
financial key write raised `SecurityError`, matching the complete intended
payload fingerprint. The exact storage-safety message appeared and the rendered
fields remained unchanged in the open dialog. Unrelated session/local storage
worked. Browser observation and proxy ingress both recorded zero receipt POSTs.
The independent blocked-state database capture showed no receipt, allocation,
journal or financial request; invoice amount paid remained zero.

After restoring all four method identities and passing the financial-prefixed
write/read/remove probe, the unchanged form sent exactly one normal POST.
HTTP 201 was not a replay. The dialog closed, the key cleared and one receipt
reference appeared. Independent final database evidence showed exactly one
receipt, allocation, financial request and journal; invoice amount paid was 50.

The real evidence checker and all 240 related guard regression checks passed.
Both disposable processes exited gracefully with code zero; their processes,
private fixture file and positively identified PostgreSQL directory were
confirmed removed. The isolated tab was closed and the normal API workflow was
restored with clean subsystem startup logs. No application runtime code was
changed, and no application business data was used. Runtime evidence and
screenshots remain outside Git.
