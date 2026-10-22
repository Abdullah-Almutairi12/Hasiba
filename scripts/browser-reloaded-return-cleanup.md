# Confirmed linked return: cleanup failure followed by a real reload

This covers **readable 201 success**, not a dropped response or failed storage
read. It recovers one issued credit note, not a new identical return. No transfer
between warehouses or repeated cleanup failure is involved.

## Disposable setup

Start `node scripts/test-isolated.mjs --browser --returns` and wait for fixtures.
Stop the normal API workflow, keep the ERP frontend running, then start:

```sh
pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/test/browser-retry-proxy.ts --returns --pass-success
```

Read `/tmp/hasba-browser-state.json` privately for synthetic owner credentials and
the linked return fixture. Sign in through the ordinary login form. Never copy
credentials into evidence, bypass authentication, use application data, seed or
replace a financial key, or create a return through a harness API call.

## Browser journey and evidence

Use `browser-reloaded-invoice-cleanup.md` for document-start observation and
`browser-reloaded-return-read-block.md` for the linked-return form. The executable
contract is `check-browser-reloaded-return-cleanup.mjs`.

1. Open `/sales` → إشعارات دائنة → إشعار جديد. Choose the fixture customer
   and source invoice. Remove the default blank line using ×, add the linked
   `Synthetic return ite…` line, set quantity 1, price 100, zero tax, keep
   إعادة المخزون checked and use reason **`Reload cleanup return`**.
   Capture actual rendered fields in `beforeSave`; financial entries must be empty.
2. Save original fetch and `Storage.prototype.removeItem`. Passively observe
   credit-note POST bytes/key/status/replay header and **await cloned parsed JSON
   before returning the response to the application**, recording `jsonObservedAt`.
   Throw `SecurityError` only for sessionStorage financial-prefixed removals.
   Record each `{key, at}` removal attempt. Leave reads, writes and unrelated
   storage alone; verify an ordinary write/read/remove and record
   `unrelatedStorageWorked`. Click حفظ وترحيل once.
3. Capture `afterCleanupFailure`: open unchanged form, retained original entry,
   exact visible saved-but-cleanup-failed message, readable 201 before the single
   failed removal. Restore both original methods in `finally`, prove identities
   and a normal storage probe. Record
   `restoredBeforeReload: {removeItem, fetch, probe}`.
4. Preserve observations outside the document. Install a passive credit-note
   fetch observer **before application scripts in the next document**, then
   perform a genuine browser reload. If no init-script removal handle is
   available, self-disarm using a nonfinancial tab marker and close the tab
   after the test. Capture `afterReload`: closed dialog, unchanged entry,
   navigation type `reload`, new time origin, zero return POSTs and observer
   metadata (`observerInstalledBeforeApp`, `readyStateAtInstall`,
   `observerTimeOrigin`, `observerInstalledAt`).
5. Reopen and refill exactly the same linked data. Capture `beforeRetry`: open
   form, actual fields, unchanged entry, zero return POSTs and
   `observerInstalledBeforeApp: true`. Before confirmation, capture read-only
   proxy/database evidence:

   ```sh
   pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/test/browser-retry-proxy.ts --returns --pass-success --capture-receipts
   cp generated-artifacts/verification/browser-identical-return-proxy.json generated-artifacts/verification/browser-reloaded-return-cleanup-before-retry-proxy.json
   ```

   Require only the original ingress, issued credit note, financial receipt,
   stock return movement and journal identity. Never rewrite proxy evidence.
6. Click حفظ وترحيل once. Require one POST in this new document, byte-identical
   body and key, parsed 201 with `Idempotency-Replayed: true`, same ID/reference.
   Capture `afterSuccess`: closed form, empty financial entries,
   `returnPostCount: 1`, `visibleCreditNoteCount: 1`, one reference.
   Restore fetch in `finally` and prove ordinary storage and removeItem work.
   Record `restoredAfterReload: {fetch, probe, removeItemProbe}`. Remove the init
   script or close its isolated test tab.

Save browser evidence under ignored
`generated-artifacts/verification/browser-reloaded-return-cleanup.json`.
Include `runId`, synthetic `customerId`/`customerName`,
`faultMethod: "removeItem"`, `faultName: "SecurityError"`,
`unrelatedStorageWorked`, all five stages, both restoration objects,
`removalAttempts` and `responses`.
Each response is `{status, body, key, requestBody, replayed, jsonObservedAt}`.
Each stage includes raw `observedAt`, `timeOrigin` and `entries` as
`[[storageKey, key]]`. Open stages include `formOpen` and actual
`fields: {customerName, invoiceReference, reason, restock, description,
quantity, unitPrice, taxRate}`; numeric input values are strings. Corroborate
hidden zero tax with the actual linked outgoing line. Do not fit offsets
between browser and proxy clocks.

## Check and dispose

```sh
pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/test/browser-retry-proxy.ts --returns --pass-success --capture-receipts
node scripts/check-browser-reloaded-return-cleanup.mjs
node --test scripts/check-browser-reloaded-return-cleanup.test.mjs scripts/check-browser-reloaded-invoice-cleanup.test.mjs scripts/check-browser-reloaded-return-read-block.test.mjs
```

The guard ties tenant/user/operation/key to the same credit note, source invoice,
linked sale line, original issue movement and journal identity. Before and after
confirmation there must be one issued note/receipt/return movement, unchanged
stock and warehouse quantity 1 at historical cost 50. It also rejects automatic
POSTs on reload/open/refill, changed request bytes and late/stale captures.

Gracefully SIGTERM the proxy, then the isolated runner. Verify their processes,
private fixture file and positively identified disposable PostgreSQL directory
are removed. Restore the normal API workflow and check startup logs. Runtime
JSON/screenshots stay ignored; only the recipe, guard and regression tests
belong in Git.

## Verified result

The isolated normal-login browser run passed using exactly two UI saves.
The first save returned parsed 201 JSON before the financial-key-only
`removeItem` SecurityError. The unchanged dialog retained its key and displayed
the explicit saved-but-cleanup-failed message. Both injected methods and the
storage probe were verified restored before reload.

A genuine reload changed the document time origin and reported navigation type
`reload`. The document-start observer recorded zero return POSTs through reload,
reopening and exact linked-field refilling. The separate pre-confirmation
read-only capture still contained only the original arrival, issued credit note,
receipt, movement and journal reference.

The single confirmation returned parsed 201 with `Idempotency-Replayed: true`,
identical bytes/key and the original credit-note ID/reference. The form closed,
its key disappeared and one issued list row remained. Final database evidence
retained the same note, tenant/user/operation receipt, journal reference and
movement, with stock and warehouse quantity 1 at historical unit cost 50.
The observer and storage methods were restored; the isolated test tab was closed
to discard its one-shot init script.

The real evidence guard and 218 regression checks across the three commands'
test files passed. Proxy and runner exited gracefully with code zero. Their
processes, private fixture file and positively identified disposable cluster
directory were removed. The normal API workflow was restored. No application
code or business data was changed.
