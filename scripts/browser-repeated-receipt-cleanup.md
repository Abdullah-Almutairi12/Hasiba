# Receipt: repeated cleanup failures in the same mounted dialog

This is independent of reload, double-click, lost-response and single-failure
tests. Do not weaken their guards or change application behavior for this test.

1. Start `node scripts/test-isolated.mjs --browser --receipts`. Use only its
   disposable database. Stop the normal API workflow, keep the ERP frontend
   running, and start:
   ```
   pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/test/browser-retry-proxy.ts --receipts --pass-success
   ```
   Log in normally using the synthetic owner in `/tmp/hasba-browser-state.json`.
   Never write credentials into evidence.
2. In `/sales` → سندات القبض → سند قبض select the fixture customer, amount 50,
   cash (نقدي), and allocation 50 to the fixture invoice. Record `customerName`,
   `invoiceReference`, and `beforeSave: {fields, observedAt, timeOrigin}`.
   Capture actual rendered fields: `{customerName, amount:"50",
   paymentMethod:"نقدي", invoiceReference, allocation:"50"}`.
3. In this tab only passively observe receipt POST fetch calls: record `key`,
   byte-exact `requestBody`, `status`, `replayed` (header equals `"true"`),
   parsed cloned JSON `body` and `jsonObservedAt: Date.now()`. Return the
   original response. Throw only from `Storage.prototype.removeItem` for
   sessionStorage keys starting `hasba:financial-request:`. Record each
   rejected `{key, at:Date.now()}` in `removalAttempts`. Keep reads/writes working.
4. Save once, then save the same unchanged open dialog three more times
   sequentially. Keep the fault active for all four saves. After each parsed
   201 and rejected cleanup capture `cleanupFailures` entries:
   `{formOpen, fields, entries, message, observedAt, timeOrigin}`.
   Read actual rendered fields and the saved-but-cleanup-failed warning before
   it expires. `entries` is `[{storageKey,key}]` for financial keys only.
   No reload, close/reopen, edits, double-click or overlapping saves.
5. Restore removeItem and prove original identity and a set/remove/get probe.
   Capture `beforeRecovery` with the unchanged open form/key and
   `restored:{removeItem:true,probe:true}`. Save once with working storage:
   same-key/body/document replay, closed dialog, empty entries, one receipt row.
   Capture `afterSuccess:{formClosed,entries,visibleReceiptCount,references,
   observedAt,timeOrigin}`.
6. Open a NEW dialog in the same document. Fill exactly the same data including
   allocation 50, capture `afterNewForm:{formOpen,fields,entries,observedAt,
   timeOrigin}`, and save. Capture `afterSecondSuccess` like `afterSuccess`:
   two distinct references each visible once, no pending key.
7. Restore fetch and removeItem in `finally`, prove method identities and
   storage probe as `restored:{fetch:true,removeItem:true,probe:true}`. Write
   observations with proxy `runId` to ignored
   `generated-artifacts/verification/browser-repeated-receipt-cleanup.json`.
   Never edit proxy evidence or adjust browser/server clocks.
8. While the temporary DB/proxy are alive:
   ```
   pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/test/browser-retry-proxy.ts --receipts --pass-success --capture-receipts
   node scripts/check-browser-repeated-receipt-cleanup.mjs
   node --test scripts/check-browser-repeated-receipt-cleanup.test.mjs scripts/check-browser-receipt-cleanup-success.test.mjs scripts/check-browser-reloaded-receipt-cleanup.test.mjs
   ```
   Expect six POSTs: original, three failed-cleanup replays, recovery replay,
   fresh identical receipt. Every intermediate snapshot must preserve one
   payment/allocation/journal/financial request and invoice paid amount 50.
   Only the new intent raises paid amount to 100 and creates a second linked
   receipt, allocation, journal and financial request with a fresh key/ID/reference.
9. Close the isolated tab. Gracefully SIGTERM proxy then isolated runner,
   verify deletion of the positively identified temporary cluster and synthetic
   state, restore normal API workflow and check startup logs.

## Observed result

The isolated normal-login run passed with six parsed HTTP 201 responses and
four rejected removals: one original save, three sequential successful replays
whose cleanup still failed, a recovery replay after restoring storage, and a
fresh identical receipt in a new dialog. All observations used the same browser
document time origin; there was no reload or overlapping click.

Each of the first five independent proxy snapshots contained the same single
receipt, allocation of 50, journal and linked financial request. Invoice paid
amount stayed 50. All four failed-cleanup stages retained the same rendered
form, pending key and explicit saved-but-cleanup-failed warning. After restoring
storage the recovery closed the dialog, cleared the key and displayed one row.
The new identical operation had a fresh key, document ID and reference, without
a replay header. Final read-only capture contained two receipts, two allocations,
two distinct journals and two linked financial requests; invoice paid amount
was 100 and both references appeared once.

The first stage recorder initially encountered an uninitialized capture array.
No save was repeated to repair the recorder: its already observed JSON response,
rejected removal, unchanged form and immediately visible warning were retained.
Subsequent stages recorded normally. Original methods and a storage probe were
verified, and the isolated browser tab was closed.

The live evidence guard and all 228 related guard regression tests passed.
No application behavior change was needed.
