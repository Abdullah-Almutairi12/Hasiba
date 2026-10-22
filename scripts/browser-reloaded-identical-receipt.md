# New identical receipt after reload recovery

Extend `browser-reloaded-receipt-cleanup.md` in a single isolated browser run.
Use its exact setup, readable 201/removeItem SecurityError, real reload,
document-start observer, no-send capture, and unchanged replay procedure.
Start the proxy with `--receipts --pass-success`; never drop the first response.
No application runtime changes, business data, credential output, API-created
receipts, or manufactured browser observations.

After confirming the replay and capturing `afterSuccess` (one row, cleared key):

1. Prefer keeping the post-reload passive fetch observer installed until the
   second success. If restoring and reattaching it, do so before opening the
   new dialog, preserve its accumulated observations, and use proxy ingress to
   independently exclude additional POSTs during the interval. Capture the
   actual database state before starting a new intent:
   ```
   pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/test/browser-retry-proxy.ts --receipts --pass-success --capture-receipts
   cp generated-artifacts/verification/browser-identical-receipt-proxy.json generated-artifacts/verification/browser-reloaded-identical-receipt-after-recovery-proxy.json
   ```
2. Open a NEW سند قبض dialog. Reenter the same customer, amount 50, نقدي
   and invoice allocation 50. Record `afterNewForm` with actual rendered
   `fields`, `formOpen`, `entries`, `observedAt`, `timeOrigin`, and
   `receiptPostCount: 1` (count in this post-reload document). Do not touch keys.
3. Save once through the UI. Record the third parsed response in `responses`
   using the existing raw body/key/status/JSON/time/replayed contract. Require
   201, a new key and receipt ID/reference, and no replay header.
4. Record `afterSecondSuccess` with `formClosed`, empty `entries`, two actual
   visible rows/references, `receiptPostCount: 2`, `observedAt`, `timeOrigin`.
   Then restore fetch/storage methods and probes, recording
   `restoredAfterReload`. Close the isolated tab to discard its one-shot init
   script. Keep all prior reload scenario snapshots and restoration evidence.
5. Save the combined browser evidence to
   `generated-artifacts/verification/browser-reloaded-identical-receipt.json`.
   While the disposable database is alive:
   ```
   pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/test/browser-retry-proxy.ts --receipts --pass-success --capture-receipts
   node scripts/check-browser-reloaded-identical-receipt.mjs
   node --test scripts/check-browser-reloaded-identical-receipt.test.mjs
   ```

The guard validates the original reload scenario against the independent
after-recovery capture, then requires exactly three ingresses: first success,
original replay, fresh identical success. It checks two financial-request
identities, preserved original links, two receipt documents, two allocations
of 50, paid balance 100 (not 50 or 150), exactly two new distinct journal IDs,
and both refreshed list rows. Browser/proxy clock domains stay independent.

Finally gracefully stop proxy then runner, verify disposal of the positively
identified temporary cluster and synthetic state, restore the normal API
workflow, and check logs. Runtime evidence remains ignored.

## Verified result

The isolated real-browser run passed. The first parsed 201 preceded the scoped
cleanup failure. Reload retained the original key and the document-start
observer saw no receipt POST through reload/refill. Confirmation replayed the
original receipt, cleared its key and showed one row. The freshly opened
identical form then created a second receipt with a distinct key, ID and
reference, no replay header, and two visible rows.

Independent before-confirmation, after-recovery and final database captures
passed the guard: two financial requests/documents, two allocations of 50,
invoice paid 100, and exactly two new journals. The observer was restored after
replay and reattached before the new dialog; proxy evidence contains exactly
the three expected POSTs. All storage/fetch probes passed and the isolated tab
was closed. The guard's 58 regression cases passed; the complete browser-evidence
guard suite passed 1357 cases. The new guard is included in normal verification.
