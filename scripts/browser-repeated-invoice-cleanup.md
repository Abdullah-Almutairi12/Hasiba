# Repeated cleanup failure, including after successful replays

This extends `browser-cleanup-identical-invoice.md`, not double-click or
getItem-failure testing. Keep both existing guards unchanged.

## Isolated browser procedure

1. Use `node scripts/test-isolated.mjs --browser`, the normal ERP frontend,
   and the disposable API proxy `--pass-success`. Stop the normal API workflow
   while the proxy owns its port. Log in normally with the synthetic owner
   from `/tmp/hasba-browser-state.json`; do not put credentials in evidence.
2. Open Sales → customer invoices → new invoice. Choose the fixture customer,
   `منتج اختبار`, quantity 1, price 100, discount 0, default VAT, notes
   `Repeated cleanup invoice`. Record `beforeSave` with actual rendered `fields`,
   `observedAt: Date.now()` and `timeOrigin: performance.timeOrigin`.
3. In this tab only, wrap fetch passively to observe each invoice POST's
   `key`, byte-exact `requestBody`, `status`, `replayed` (header equals `true`),
   parsed cloned JSON `body` and `jsonObservedAt`. Return the original response.
   Wrap Storage.prototype.removeItem to throw ONLY when `this === sessionStorage`
   and the key starts `hasba:financial-request:`. Record `{key, at}` in
   `removalAttempts` on every throw. Leave reads and writes working.
4. Save once, then save the **same open unchanged dialog three more times**,
   sequentially. Keep the removal fault enabled throughout all FOUR saves.
   After each parsed 201 and rejected removal capture a `cleanupFailures`
   snapshot: `{formOpen, fields, entries, message, observedAt, timeOrigin}`.
   `entries` is `[{storageKey, key}]` for financial entries only; `message` is
   the actual displayed saved-but-cleanup-failed toast text (capture before
   it expires). Never close/reopen or change the form between confirmations.
   Each replay must still show the saved warning and preserve the original key.
5. Restore removeItem; prove original identity and an ordinary set/remove/get
   probe. Capture `beforeRecovery` with the same snapshot fields (message
   optional) and `restored: {removeItem:true, probe:true}`. Keep fetch observation.
   Save once: require same-key/body/document replay, dialog closed, no pending
   key, and one visible invoice row. Capture `afterSuccess` per the original
   identical-invoice contract, with browser timestamp and document time origin.
6. Open a NEW invoice dialog in the same document, fill exactly the same data,
   capture `afterNewForm`, save once and capture `afterSecondSuccess` per the
   existing contract. Require a new key/ID/reference, no replay, two rows,
   and empty financial session entries.
7. Restore fetch and removeItem in `finally` even on failure, record identities
   and probe as `restored: {fetch:true, removeItem:true, probe:true}`. Save the
   observations plus proxy `runId` to ignored
   `generated-artifacts/verification/browser-repeated-invoice-cleanup.json`.
   A passing run has six proxy events/responses and four failed removals.
8. While the proxy and temporary DB are alive:
   ```
   pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/test/browser-retry-proxy.ts --pass-success --capture-receipts
   node scripts/check-browser-repeated-invoice-cleanup.mjs
   node --test scripts/check-browser-repeated-invoice-cleanup.test.mjs scripts/check-browser-cleanup-identical-invoice.test.mjs scripts/check-browser-invoice-cleanup-success.test.mjs
   ```
   The guard checks every intermediate DB snapshot (same single invoice,
   journal and receipt), browser identity/form/message/key, final recovery,
   and the independent new invoice. Never modify proxy evidence or fit clocks.
9. Gracefully SIGTERM proxy then isolated runner; verify the known temporary
   cluster and synthetic state are removed. Restore normal API workflow and
   check startup logs. Close the isolated tab to discard its session.

## Observed result

The isolated normal-login browser run passed with six invoice POSTs and four
rejected removals: original success, three sequential successful replays whose
cleanup still failed, final recovery replay with working storage, then a new
identical invoice. Each of the first five proxy snapshots contained the same
single invoice, journal ID and financial receipt. All four failed-cleanup
snapshots retained the unchanged rendered form, original pending key and
explicit saved-but-cleanup-failed warning. No request body or document identity
changed during confirmation.

After restoration, the final replay closed the dialog and removed the key.
The newly opened identical form used a fresh key and produced a different
invoice/reference without a replay header. Final read-only capture contained
two invoices, two distinct journals and two independently linked receipts;
both references appeared once in the UI. Browser methods were restored and
the isolated tab was closed. The live evidence guard and all 138 related
guard regression tests passed. No application behavior change was necessary.
