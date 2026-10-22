# Uncertain customer invoice: unreadable persisted key after reload

This adapts `browser-reloaded-return-read-block.md` to customer invoices.
It is **not** the confirmed-success/removeItem scenario in
`browser-invoice-cleanup-success.md`. Use only disposable fixtures, normal
owner login, and real UI save clicks. Never seed or replace the pending key.

## Reproduce

1. Start `node scripts/test-isolated.mjs --browser`. Wait for browser fixtures
   ready; read the synthetic owner from `/tmp/hasba-browser-state.json`
   privately. Keep credentials out of logs, evidence, and screenshots.
   Stop the normal API workflow if running; keep the ERP frontend running.
   Start the default lost-response proxy (no `--pass-success`):

   ```sh
   pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/test/browser-retry-proxy.ts
   ```

2. Log in normally. Open `/sales` → فواتير العملاء → فاتورة جديدة.
   Choose the synthetic owner's customer and `منتج اختبار`. Use quantity 1,
   price 100, discount 0, VAT 15%, and notes `Reload read block invoice`.
   Click حفظ once. The proxy must prove the invoice, financial request and
   journal committed **before** dropping the successful response. A preview
   HTTP 502 is acceptable only with that independent commit evidence.
3. Capture `afterLostResponse`: actual rendered fields, the persisted financial
   entry, `formOpen: true`, `observedAt: Date.now()` and
   `timeOrigin: performance.timeOrigin`. Actually reload, reopen the invoice
   dialog and refill identical data. Capture `beforeBlockedSave`, including
   `navigationType` from the navigation performance entry (`reload`). Do not
   write to the real financial storage slot.
4. Save original `Storage.prototype.getItem`, `setItem`, `removeItem`, and
   `window.fetch`. Throw `DOMException(..., "SecurityError")` from getItem
   **only** when `this === sessionStorage` and the key starts with
   `hasba:financial-request:`. Passively observe financial writes/removals and
   outgoing POST `/api/sales/invoices`; do not block those operations.
   Prove unrelated storage still works. Enumerate evidence using the saved
   original getter, so the observer does not trigger the fault.
5. In `try/finally`, click حفظ once. Capture `afterBlockedSave`: the open
   unchanged form, original persisted entry and exact visible error:

   > تعذر حفظ مفتاح العملية بأمان. لم يُرسل الطلب؛ فعّل تخزين الجلسة وأعد المحاولة.

   Require exactly one rejected read of the original operation fingerprint,
   zero attempted financial writes/removals, and zero outgoing invoice POSTs.
   Restore all four methods in `finally`, even on failure. With a separate
   synthetic financial-prefixed key, probe write/read/remove; remove the probe
   in a nested `finally`. Capture `restored` with unchanged actual fields/entry,
   timestamps and these flags: `originalGetItemRestored`,
   `originalSetItemRestored`, `originalRemoveItemRestored`,
   `originalFetchRestored`, `financialWriteReadRemoved`.
6. Before recovery, capture read-only database evidence and preserve it:

   ```sh
   pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/test/browser-retry-proxy.ts --capture-receipts
   cp generated-artifacts/verification/browser-retry-proxy.json \
      generated-artifacts/verification/browser-reloaded-invoice-blocked-proxy.json
   ```

   Do not use `--capture-storage-block`: this invoice already committed.
   The snapshot must show only one ingress, one invoice, one financial request,
   the original journal, and unchanged stock/movements/warehouse quantities.
7. Without another reload or edit, observe fetch passively and click حفظ once.
   Restore the observer in `finally`. Require exactly one recovery POST, same
   key/body, HTTP 201 and `Idempotency-Replayed: true`, same invoice/reference.
   Capture `afterSuccess`: closed form, no pending key, one visible invoice row,
   `reference` and `references: [reference]`, timestamps and time origin.
8. Save browser evidence at
   `generated-artifacts/verification/browser-reloaded-invoice-read-block.json`.
   Include proxy `runId`, synthetic `customerId`/`customerName`, the five stage
   snapshots, `faultMethod: "getItem"`, `faultName: "SecurityError"`, actual
   `blockedKeys`, `financialWriteKeys`, `financialRemoveKeys`,
   `unrelatedStorageWorked`, `blockedInvoicePostCount` and
   `recoveryInvoicePostCount`. Open snapshots use `entries: [[storageKey, key]]`
   and actual `fields: {customerName, description, quantity, unitPrice,
   discountPct, taxRate, notes}` (numeric values as strings).
9. Capture final read-only state and validate before disposing:

   ```sh
   pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/test/browser-retry-proxy.ts --capture-receipts
   node scripts/check-browser-reloaded-invoice-read-block.mjs
   node --test scripts/check-browser-reloaded-invoice-read-block.test.mjs \
     scripts/check-browser-reloaded-return-read-block.test.mjs \
     scripts/check-browser-retry.test.mjs \
     scripts/check-browser-invoice-cleanup-success.test.mjs
   ```

   The guard ties the blocked read to the exact payload fingerprint and proves
   real reload, unchanged form/key, no send or storage mutation, restored
   methods, then exactly one replay. Original, blocked, replay and final
   database snapshots must retain the same invoice, receipt and journal IDs.
   Invoice billing must not issue stock (delivery orders own that operation).
10. Gracefully SIGTERM the proxy, then the isolated runner. Verify their
    processes, private synthetic state and positively identified disposable
    database directory are removed. Restore the normal API workflow and check
    startup logs. Keep runtime JSON/screenshots under ignored
    `generated-artifacts/verification`, not in Git.

## Verified result

The isolated normal-login browser run passed. The first UI save committed with
HTTP 201 before its response was dropped. A real reload changed the document time
origin and preserved the original session entry. Refilling identical invoice data
and blocking getItem rejected exactly that fingerprint: the storage-safety error
was visible, the form and key remained unchanged, and there were zero financial
writes, removals or outgoing/additional proxy invoice POSTs.

All four methods were restored in `finally`; the financial-prefixed storage probe
passed. The unchanged recovery sent exactly one POST and returned HTTP 201 with
`Idempotency-Replayed: true`, the same invoice and reference. Confirmation closed
the form, cleared the key and left exactly one visible invoice row. The original,
blocked, replay and final snapshots retained one financial request and the same
single journal ID, with no stock, movement or warehouse-quantity changes.

The real evidence guard passed, alongside 168 guard regression checks using the
command above. The proxy and runner then exited gracefully with code zero; their
processes, private fixture file and identified disposable PostgreSQL directory were
confirmed removed. The normal API workflow was restored. No application business
data or production application behavior was changed.
