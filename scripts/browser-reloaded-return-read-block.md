# Uncertain return: unreadable persisted key after reload

Use `node scripts/test-isolated.mjs --browser --returns` and
`artifacts/api-server/src/test/browser-retry-proxy.ts --returns` exactly as in
`browser-reopened-return.md`. Use normal synthetic-owner login, never application
data or an authentication bypass. Use that recipe's exact linked line, quantity
1, price 100, zero tax, restock true and reason `Reopened return verification`.
Do not use `--pass-success`.

1. Save once through the UI. The proxy must prove commit before dropping success.
   Capture `afterLostResponse` with actual fields, pending entries, observedAt
   and performance.timeOrigin as in the reopened-return recipe.
2. Actually reload the page, reopen the dialog and refill identical linked data.
   Preserve sessionStorage; never seed/replace its financial key. Capture
   `beforeBlockedSave`. Its newer timeOrigin proves in-memory state was discarded.
3. Save the original getItem/setItem/removeItem/fetch methods. Inject getItem
   SecurityError only for sessionStorage keys starting `hasba:financial-request:`.
   Observe but do not block writes, removals or outgoing return POSTs. Check an
   unrelated storage key still works. Enumerate evidence through the original
   getter so observation cannot trigger the fault.
4. Click حفظ وترحيل once. Capture `afterBlockedSave` with actual unchanged fields,
   retained entries and the visible storage-safety error. In finally restore all
   four methods. Probe write/read/remove using a synthetic financial-prefixed key
   with removal in nested finally. Capture `restored`, including fields, entries,
   timestamps and the five restoration flags used by the checker.
5. Before retry, run the proxy with `--returns --capture-receipts`, then copy
   `browser-identical-return-proxy.json` to
   `browser-reloaded-return-blocked-proxy.json` under generated-artifacts/verification.
   This snapshot must show exactly the original arrival/commit, unchanged receipt
   and stock. Do not use --capture-storage-block: this operation already committed.
6. Without editing or reloading again, save once. Observe the outgoing retry
   (restore the observer in finally). Capture `afterSuccess` with cleared entries,
   closed form and exactly one visible reference. Capture final receipts again.
7. Save `browser-reloaded-return-read-block.json` with the proxy runId, customerId,
   customerName, five stage snapshots, faultMethod/getItem, faultName/SecurityError,
   actual blockedKeys, financialWriteKeys, financialRemoveKeys, unrelatedStorageWorked,
   blockedReturnPostCount and recoveryReturnPostCount. Never include credentials.
   Run `node scripts/check-browser-reloaded-return-read-block.mjs`.

The guard requires one rejected read for the original fingerprint, zero writes,
removals or POSTs during the fault, the same persisted key through restoration,
and exactly one replay of the same issued return/receipt/journal/movement with
stock and warehouse quantity 1 at historical cost 50.

Finally gracefully terminate proxy then runner, verify removal of their processes,
private state and positively identified disposable cluster, restore the normal API
workflow and check startup logs. Keep runtime evidence/screenshots ignored.

## Verified result

The isolated browser run passed using normal synthetic-owner login. The first
save committed before its success response was dropped. A real reload changed
the document time origin and preserved the original financial entry. Refilling
identical linked data and blocking its read produced the storage-safety error,
with the dialog and stored entry unchanged: one rejected read, no financial
writes or removals, and zero outgoing or additional proxy POSTs.

All methods were restored in finally and the storage probe passed. The unchanged
retry returned the same issued credit note with `Idempotency-Replayed: true`,
closed the dialog, cleared the key and displayed one list row. The blocked and
final read-only captures confirmed the same receipt, journal and movement, with
stock and warehouse quantity 1 at historical unit cost 50.

The evidence guard passed, as did 213 regression checks:

```sh
node --test scripts/check-browser-reloaded-return-read-block.test.mjs \
  scripts/check-browser-return-storage-block.test.mjs \
  scripts/check-browser-identical-return.test.mjs
```

The proxy and runner exited gracefully with code zero. Their processes, private
fixture state and identified disposable database directory were removed. The
normal API workflow was restored and initialized cleanly. No application code
change was necessary and no application business data was used.
