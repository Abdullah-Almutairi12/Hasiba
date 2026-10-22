# Receipt: readable success, failed key cleanup, then reload before confirmation

This scenario is not a failed key read, lost response, or mounted-dialog retry.
The original receipt must commit and return readable HTTP 201 **before**
`sessionStorage.removeItem` throws. Reload before confirming the saved receipt.
Do not change application behavior or use application data.

## Isolated browser procedure

1. Start `node scripts/test-isolated.mjs --browser --receipts` and wait for
   fixtures ready. Stop the normal API workflow, keep ERP running, and start:
   ```
   pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/test/browser-retry-proxy.ts --receipts --pass-success
   ```
   Sign in normally with the synthetic owner from
   `/tmp/hasba-browser-state.json`. Never copy credentials or environment
   values into evidence.
2. Open `/sales` → سندات القبض → سند قبض. Select the fixture customer,
   amount 50, نقدي, allocation 50 to the fixture invoice. Capture actual
   rendered fields as strings: `customerName`, `amount`, `paymentMethod`,
   `invoiceReference`, `allocation`.
3. Observe receipt POST fetches, preserving raw body bytes, key, HTTP status,
   replay header/boolean, parsed cloned JSON and `jsonObservedAt: Date.now()`.
   Return the original response untouched after observing its cloned JSON.
   Save original fetch and removeItem. Throw `SecurityError` only on
   `Storage.prototype.removeItem` for financial keys on this tab's
   sessionStorage; record `removalAttempts: [{key, at}]`. Do not block reads,
   writes, or unrelated storage.
4. Save once. Capture unchanged open dialog, retained entry and the warning
   beginning `تم حفظ العملية بالفعل، لكن تعذر تنظيف مفتاحها`. Require parsed
   201 JSON before the failed removal. Restore methods in `finally`, proving
   identities and a normal storage-removal probe. Record both
   `restored` and `restoredBeforeReload` as `{removeItem, probe, fetch}`.
5. Preserve first-document observations outside the page. Install a passive
   receipt POST observer via document-start init script **before app loading**,
   then reload the real page. Never seed, replace or remove a financial key.
   Capture `afterReload` before opening a dialog: closed form, same entry,
   navigation type `reload`, newer timeOrigin, zero receipt POSTs.
6. Reopen the receipt dialog and reenter exactly the same values. Capture
   `beforeRetry` with unchanged fields/entry, open form and zero POSTs.
   Before clicking Save, independently capture ingress and database state:
   ```
   pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/test/browser-retry-proxy.ts --receipts --pass-success --capture-receipts
   cp generated-artifacts/verification/browser-identical-receipt-proxy.json generated-artifacts/verification/browser-reloaded-receipt-cleanup-before-retry-proxy.json
   ```
   Require one ingress, customer receipt, financial request, allocation of 50,
   one journal increment and invoice paid balance 50. Do not edit proxy evidence.
7. Click حفظ once. Require 201 with `Idempotency-Replayed: true`, original
   receipt ID/reference and byte-identical request/key. Capture closed dialog,
   cleared key, one visible receipt row/reference, and exactly one POST in this
   new document. Restore the second observer in `finally`; record
   `restoredAfterReload: {fetch, probe, removeItemProbe}`. Remove the init script;
   if no removal handle is exposed, use a one-shot self-disarming nonfinancial
   tab marker and close the isolated tab when finished.

## Evidence contract and guard

Write actual browser observations (never fixture values substituted for DOM
observations) to ignored
`generated-artifacts/verification/browser-reloaded-receipt-cleanup.json`.
Use the shared receipt-cleanup contract plus:

- Current proxy `runId`, synthetic `customerId`, `customerName`,
  `invoiceReference`, `faultMethod: "removeItem"`, `faultName: "SecurityError"`.
- All stages `beforeSave`, `afterCleanupFailure`, `afterReload`, `beforeRetry`,
  `afterSuccess` include raw `observedAt` and `timeOrigin`.
- `entries` are `[{storageKey, key}]`. `afterReload` includes `formClosed`,
  `navigationType`, `receiptPostCount`, `observerInstalledBeforeApp`,
  `readyStateAtInstall`, `observerTimeOrigin`, `observerInstalledAt`.
- `beforeRetry` includes `formOpen`, `fields`, `entries`, `receiptPostCount`,
  `observerInstalledBeforeApp`. `afterSuccess` includes `formClosed`, `entries`,
  `visibleReceiptCount`, `references`, `receiptPostCount`.
- Unlike the older mounted-dialog scenario, `afterReload` is the pending
  pre-confirmation snapshot, not a reload after success.
- Keep browser/proxy clocks independent; never fit timestamp offsets.

While the disposable database is still alive:
```
pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/test/browser-retry-proxy.ts --receipts --pass-success --capture-receipts
node scripts/check-browser-reloaded-receipt-cleanup.mjs
node --test scripts/check-browser-reloaded-receipt-cleanup.test.mjs scripts/check-browser-receipt-cleanup-success.test.mjs
```

The guard checks both snapshots, allocation, invoice balance, financial request
identity, every journal ID and original receipt replay, as well as browser reload,
no automatic send and cleanup. Negative cases reject stale/missing captures,
late observers, wrong faults, altered keys/bodies/forms, duplicate accounting,
wrong rows, and un-restored methods.

Finally gracefully SIGTERM the proxy and then isolated runner. Verify their
processes, positively identified disposable database directory and synthetic
state file are gone. Restore the normal API workflow and inspect startup logs.
Evidence stays ignored; credentials and runtime JSON never belong in Git.

## Verified result

The normal-login isolated browser run passed. Parsed HTTP 201 preceded the
scoped removeItem SecurityError. The unchanged open form and original key
remained with the explicit saved-but-cleanup-failed warning. Methods and storage
probes were restored before reload.

The real reload changed the document time origin and reported navigation type
`reload`. A loading-state document-start observer recorded zero receipt POSTs
through reload, reopening and refilling. The pre-confirmation ingress/database
capture independently retained only the original receipt, financial request,
allocation of 50, paid balance 50 and single new journal.

The one confirmation POST returned the original receipt with HTTP 201 and
`Idempotency-Replayed: true`, identical raw body/key and reference. The dialog
closed, its key disappeared, and exactly one matching receipt row remained.
The final database capture and evidence guard passed. Both documents' methods
were restored and the one-shot observer's isolated tab was closed.

The proxy and runner exited gracefully with code zero. Their processes,
positively identified disposable cluster and private synthetic state file were
verified removed. The normal API workflow was restored. No application runtime
behavior or business data was changed.
