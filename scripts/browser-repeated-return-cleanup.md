# Linked return: repeated cleanup failures after readable success

This is one mounted dialog, not reload recovery or a new identical intent.
No warehouse transfer or payment receipt is involved.

## Setup

Follow `browser-reloaded-return-cleanup.md` for disposable setup and ordinary
login. Start `node scripts/test-isolated.mjs --browser --returns`, stop the
normal API workflow, keep ERP running, and start:

```sh
pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/test/browser-retry-proxy.ts --returns --pass-success
```

Read synthetic credentials/fixture privately from `/tmp/hasba-browser-state.json`.
Never put credentials in evidence, use application data, seed/replace a financial
key, bypass login, or POST the return outside the UI.

## Browser journey

1. Open `/sales` → إشعارات دائنة → إشعار جديد. Select fixture customer/invoice,
   remove the blank line, add the linked synthetic sold line, quantity 1,
   price 100, zero tax, إعادة المخزون checked, reason `Repeated cleanup return`.
   Capture actual rendered fields and empty financial sessionStorage entries
   in `beforeSave`.
2. Save original fetch and `Storage.prototype.removeItem`. Observe only
   credit-note POSTs, recording original bytes/key and awaiting cloned parsed
   JSON **before returning the response to the app**. Throw `SecurityError`
   only on financial-prefixed removals from this tab's sessionStorage, recording
   `{key, at}` for every attempt. Do not fault reads/writes or unrelated storage.
   Verify an unrelated storage write/read/remove works.
3. Click حفظ وترحيل once; capture the unchanged open dialog, retained key and
   actual visible saved-but-cleanup-failed message after parsed 201 success.
   Click the same button **twice more**, waiting for each response and error
   before the next click. Do not dismiss/reopen/refill/reload. Capture each
   failure separately in `afterFailures`. All three POSTs must have identical
   bytes/key; confirmations are 201 replays of the original note. Each attempt
   must leave identical fields, entry and explicit message visible.
4. Restore removeItem only. Verify method identity and a normal storage probe.
   Capture `storageRestored: {removeItem, probe}` and `beforeRecovery`, with the
   same open form/key and still exactly three POSTs. Record the current message
   (null if its toast has expired during restoration; never reuse an old
   captured message). Click once more.
   Require one replay, same document identity/bytes/key, closed dialog, zero
   financial entries, no cleanup message and exactly one visible issued note.
   In `finally` restore fetch/removeItem, verify identities plus ordinary
   storage, and close the isolated tab.
5. Capture final read-only proxy/database state:

   ```sh
   pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/test/browser-retry-proxy.ts --returns --pass-success --capture-receipts
   node scripts/check-browser-repeated-return-cleanup.mjs
   node --test scripts/check-browser-repeated-return-cleanup.test.mjs scripts/check-browser-reloaded-return-cleanup.test.mjs
   ```

## Evidence contract

Save ignored `generated-artifacts/verification/browser-repeated-return-cleanup.json`:
`runId`, synthetic `customerId/customerName`, `faultMethod: "removeItem"`,
`faultName: "SecurityError"`, `unrelatedStorageWorked`, `beforeSave`,
`afterFailures` (three or more), `beforeRecovery`, `afterSuccess`,
`storageRestored`, `restored: {fetch, removeItem, probe}`, `responses`,
`removalAttempts`.

Each stage has raw `observedAt`, `timeOrigin`, `entries: [[storageKey, key]]`,
and cumulative `returnPostCount`. Open stages have `formOpen: true` and actual
`fields: {customerName, invoiceReference, reason, restock, description, quantity,
unitPrice, taxRate}` (numbers as input strings). Corroborate hidden zero tax
with the actual outgoing linked line. Failure stages require the full visible
`message`; recovery records that message or null if the transient toast expired.
Success has `formClosed`, `cleanupMessageVisible: false`,
`visibleCreditNoteCount: 1`, `references: [originalReference]`.

Each response has `{status, body, key, requestBody, replayed, jsonObservedAt}`.
All browser stages must use the same document time origin; no clock offsets.
The guard checks every intermediate proxy snapshot, not only final totals:
one issued note, original tenant/user/operation receipt, same journal ID,
same linked historical-cost movement, product and warehouse quantity 1/cost 50.
The read-only final capture also includes the entire journal-ID list
(`finalJournals`): the fixture seeds none, so exactly the note's one journal
must exist, including no unlinked duplicates.

Gracefully SIGTERM proxy then runner; verify processes, private state file and
positively identified disposable cluster are gone. Restore normal API workflow
and inspect startup logs. Keep runtime evidence/screenshots ignored.

## Verified result

The isolated ordinary-login browser run completed four UI saves in one mounted
dialog. The first readable, parsed 201 created the note; the next two returned
201 replays while financial-key removal still threw SecurityError. All three
failure captures showed identical actual fields, the same persisted entry and
the full saved-but-cleanup-failed warning. Every failed removal followed parsed
JSON, including both confirmations. Unrelated storage remained usable.

After restoring removeItem, the storage probe passed and the unchanged key/form
remained with exactly three POSTs. The transient warning toast had expired by
this separate pre-recovery capture (recorded as null, not copied from an earlier
stage). The fourth save replayed the original note with identical bytes/key,
closed the dialog, cleared its key and displayed one issued row.

The evidence checker initially assumed the operation namespace contained a
company ID. The server actually uses method, Express base URL and route;
the checker now requires `POST:/api:/sales/credit-notes` and separately binds
receipt company/user to the returned note's company/creator. No browser or
proxy evidence was rewritten to resolve this test-contract mistake.

The real evidence guard passed, including one final receipt, the same issued
note/journal and historical-cost movement, product/warehouse quantity 1 at cost
50, and an entire journal table containing exactly that one journal. All 189
regression checks across the new and existing reload-cleanup suites passed.
The new suite is included in `pnpm run verify`.

Both injected methods and storage probes were restored and the isolated tab
closed. Proxy and runner exited gracefully with code zero; their processes,
private synthetic state file and positively identified disposable cluster were
removed. The normal API workflow was restored and initialized cleanly. No
application behavior or business data was changed.
