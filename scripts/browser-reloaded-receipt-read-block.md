# Uncertain receipt: unreadable persisted key after reload

Adapt `browser-reloaded-return-read-block.md` to receipts using the synthetic
300 invoice in `browser-identical-receipt.md`. This is neither a double-click
test nor a confirmed-success/removeItem cleanup failure.

1. Start `node scripts/test-isolated.mjs --browser --receipts` and wait for
   **Browser fixtures ready**. Stop the normal API workflow if running; keep
   the ERP frontend running. Start the default lost-success proxy:

   ```sh
   pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/test/browser-retry-proxy.ts --receipts
   ```

   Do not use `--pass-success`. Use only normal synthetic-owner login from
   `/tmp/hasba-browser-state.json`, read privately. Never use application data,
   an authentication bypass, or credentials in logs/evidence.
2. Open `/sales` → سندات القبض → سند قبض. Choose the fixture customer, amount
   50, نقدي, allocate 50 to its fixture invoice, and click حفظ السند once.
   The proxy proves upstream HTTP 201 and committed payment, allocation,
   financial request and journal **before** cutting the successful response.
   A preview 502 is acceptable only with this independent commit evidence.
3. Capture `afterLostResponse`. Actually reload, reopen and refill the same
   receipt (the invoice is now partially paid, but still eligible). Capture
   `beforeBlockedSave` with navigation performance entry type `reload`.
   Preserve the financial sessionStorage entry; never seed or replace it.
4. Save `Storage.prototype.getItem`, `setItem`, `removeItem`, and `window.fetch`.
   Throw `DOMException(..., "SecurityError")` from getItem only when
   `this === sessionStorage` and key starts `hasba:financial-request:`.
   Passively record financial writes/removals and outgoing POST
   `/api/sales/receipts`; do not block them. Prove unrelated storage works.
   Enumerate stored evidence with the saved original getter, not the faulty one.
5. In `try/finally`, click حفظ السند once and capture `afterBlockedSave`,
   including unchanged rendered fields, original entry, and exact visible error:

   > تعذر حفظ مفتاح العملية بأمان. لم يُرسل الطلب؛ فعّل تخزين الجلسة وأعد المحاولة.

   Require exactly one rejected read of the original fingerprint and no attempted
   financial writes, removals or outgoing receipt POSTs. In `finally` restore all
   four methods even on failure. Probe write/read/remove with a separate synthetic
   financial-prefixed key, removing it in nested `finally`. Capture `restored`
   with method identity/probe flags and unchanged form/key.
6. Before recovery, capture independent read-only database state:

   ```sh
   pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/test/browser-retry-proxy.ts --receipts --capture-receipts
   cp generated-artifacts/verification/browser-identical-receipt-proxy.json \
      generated-artifacts/verification/browser-reloaded-receipt-blocked-proxy.json
   ```

   This must show only the original ingress/commit, one financial request, same
   journal and allocation, and invoice paid 50. Do not use `--capture-storage-block`.
7. Without editing or reloading, passively observe fetch and click save once.
   Restore the observer in `finally`. Capture `afterSuccess` after the dialog
   closes, the pending key clears and exactly one actual receipt reference appears.
   Repeat the read-only capture command above for final state.
8. Save `generated-artifacts/verification/browser-reloaded-receipt-read-block.json`.
   Include `runId`, `customerId`, `customerName`, `invoiceReference`, the five stage
   snapshots, `faultMethod: "getItem"`, `faultName: "SecurityError"`, `blockedKeys`,
   `financialWriteKeys`, `financialRemoveKeys`, `unrelatedStorageWorked`,
   `blockedReceiptPostCount: 0`, and `recoveryReceiptPostCount: 1`.

   Every snapshot has `observedAt: Date.now()`, `timeOrigin:
   performance.timeOrigin`, and `entries: [[storageKey, key]]` (empty on success).
   Open stages have `formOpen: true` and actual rendered `fields: {customerName,
   amount: "50", paymentMethod: "نقدي", invoiceReference, allocation: "50"}`.
   `beforeBlockedSave.navigationType` comes from the navigation performance entry.
   `afterBlockedSave.error` is the actual error. `restored` additionally includes
   `originalGetItemRestored`, `originalSetItemRestored`, `originalRemoveItemRestored`,
   `originalFetchRestored`, `financialWriteReadRemoved`. `afterSuccess` has
   `formClosed`, `visibleReceiptCount: 1`, and `references: [actualReference]`.

   ```sh
   node scripts/check-browser-reloaded-receipt-read-block.mjs
   node --test scripts/check-browser-reloaded-receipt-read-block.test.mjs \
     scripts/check-browser-reloaded-return-read-block.test.mjs \
     scripts/check-browser-reloaded-invoice-read-block.test.mjs \
     scripts/check-browser-identical-receipt.test.mjs \
     scripts/check-browser-receipt-cleanup-success.test.mjs
   ```

   The guard requires exactly one recovery POST, same body fingerprint and key,
   HTTP 201 with `Idempotency-Replayed: true`, same receipt/reference/retry receipt,
   and unchanged journal/allocation/collected amount in original, blocked, replay
   and final database snapshots.
9. Gracefully SIGTERM proxy then runner. Verify removal of their processes,
   private state and positively identified disposable database directory. Restore
   the normal API workflow and check startup logs. Runtime evidence/screenshots
   remain in ignored `generated-artifacts/verification`, never Git.

## Verified result

The isolated normal-login browser run passed. The first UI save committed with
HTTP 201 before its response was dropped. A real reload changed the document time
origin and retained the original financial entry. Refilling identical receipt
data and blocking getItem rejected exactly that fingerprint. The storage-safety
message was visible, the form/key remained unchanged, and there were no financial
writes, removals or outgoing/additional proxy receipt POSTs.

All four methods were restored in `finally`; the synthetic financial-prefixed
storage probe passed. The unchanged recovery sent exactly one POST, returning
HTTP 201 with `Idempotency-Replayed: true` and the same receipt/reference. The form
closed, the key cleared, and one receipt row appeared. Original, blocked, replay
and final database snapshots retained one financial request and the same journal
and allocation; invoice amount paid remained 50, not 100.

The real evidence guard passed, alongside 354 regression checks using the command
above. The proxy and runner exited gracefully with code zero; their processes,
private fixture state and positively identified disposable PostgreSQL directory
were confirmed removed. The normal API workflow was restored and its subsystems
initialized cleanly. No application runtime code was changed, and no application
business data was used for the test. Runtime evidence and screenshots remain
ignored under `generated-artifacts/verification`.
