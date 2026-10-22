# Return recovery after session-storage read failure

Use the isolated setup in `browser-return-storage-read-block.md`, with one
important proxy option:

```sh
node scripts/test-isolated.mjs --browser --returns
# Once fixtures are ready, stop the normal API workflow.
pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/test/browser-retry-proxy.ts --returns --pass-success
```

The successful response must reach the browser: this is not a response-loss,
double-click, reload, or key-removal-failure scenario. Use normal synthetic-owner
login and the same linked return fields as the read-block recipe.

1. Inject the scoped `getItem` SecurityError and observe financial writes and
   outgoing requests. Capture actual rendered fields before and after one save.
2. Restore getItem/setItem/removeItem/fetch in `finally`, including the successful
   storage probe and its nested-finally removal. Keep the same dialog mounted.
3. Save `browser-return-storage-read-block.json`. Before any retry, run the
   proxy's `--returns --capture-storage-block` and the existing read-block guard.
   This independently proves zero requests, rows, or stock changes.
4. Capture `beforeRecovery` with observedAt, timeOrigin, formOpen, fields and
   financialEntries. Without editing, closing, reconstructing or reloading the
   form, click حفظ وترحيل once. Observe network traffic without blocking it;
   restore any additional observer in `finally`.
5. Capture `afterRecovery` with observedAt, timeOrigin, formOpen,
   financialEntries, visibleReference and listRowCount. Record the actual outgoing
   returnPostCount, runId and originalMethodsRestored in
   `browser-return-storage-read-recovery.json`. Never save login credentials.
6. While the disposable database/proxy remain alive, run:

```sh
pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/test/browser-retry-proxy.ts --returns --capture-receipts
node scripts/check-browser-return-storage-read-recovery.mjs
```

The combined guard links the no-send snapshot and recovery to the same run,
document, unchanged fields and operation fingerprint. It requires one successful
non-replay POST, one issued credit note, one financial receipt, one linked return
movement and stock/warehouse quantity of one at historical cost. Success on the
unchanged mounted form also proves no failed in-memory reservation blocked retry.

Keep runtime evidence and screenshots under ignored
`generated-artifacts/verification`. Gracefully SIGTERM proxy then runner,
verify their processes, synthetic state file and positively identified temporary
cluster are gone, then restore the normal API workflow and check its logs.

## Verified run

The isolated real-browser run passed with normal synthetic-owner login. The
blocked phase had one rejected read, no attempted financial writes, zero browser
or proxy return POSTs and unchanged database/stock state. All methods were
restored in `finally`, and the storage probe succeeded.

The same mounted dialog, with the same document time origin and unchanged fields,
then saved successfully on one click. The dialog closed and the list displayed
one credit note. The combined evidence guard confirmed one non-replayed POST,
one issued note, one financial request and one completed stock restoration at
the original cost. No pending session entry remained.

The 170 assertions across the recovery, return-storage-block,
invoice-storage-block and identical-return guard suites passed:

```sh
node --test scripts/check-browser-return-storage-read-recovery.test.mjs \
  scripts/check-browser-return-storage-block.test.mjs \
  scripts/check-browser-storage-block.test.mjs \
  scripts/check-browser-identical-return.test.mjs
```

Both disposable processes exited gracefully with code zero. The synthetic
credential state and identified temporary database directory were removed; the
normal API service was restored and initialized successfully. No application
code or real business data was changed.
