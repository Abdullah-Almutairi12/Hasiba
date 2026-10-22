# Receipt: definitive server rejection with blocked key removal

This is a real authenticated browser scenario against a disposable PostgreSQL
cluster, not a mocked rejection, authentication bypass, or application dataset.
It exercises the receipt dialog in `artifacts/erp-system/src/pages/sales.tsx`
and `lib/api-client-react/src/financial-fetch.ts`.

## Run

1. Start `node scripts/test-isolated.mjs --browser --receipts`. Wait for
   browser fixtures to be ready. Stop the normal API workflow; keep the ERP
   frontend running. Start:
   ```
   pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/test/browser-retry-proxy.ts --receipts --pass-success
   ```
2. In an isolated browser tab, sign in through the normal login form with the
   synthetic owner from `/tmp/hasba-browser-state.json`. Never copy credentials
   into reports. Open `/sales`, سندات القبض, then سند قبض.
3. Select the fixture customer, amount **50**, نقدي, and allocation **40**
   on the fixture invoice. This passes the dialog's client checks but fails the
   real server's allocation-total validation with HTTP 400 and
   `مجموع التوزيع يجب أن يساوي مبلغ السند`, before `financialTransaction`.
4. Capture actual rendered fields and empty financial-key storage. Wrap fetch
   to observe only receipt POSTs, recording body string, Idempotency-Key,
   status, replay header, cloned parsed JSON and browser timestamp. Return the
   original response untouched. In `try/finally`, override
   `Storage.prototype.removeItem` to throw only for financial keys on this
   tab's session storage. Keep getItem/setItem unchanged; use the saved getter
   for evidence collection.
5. Click حفظ once. Capture the unchanged open dialog, retained storage entry,
   zero receipt rows and actual visible message
   `رفض الخادم العملية، لكن تعذر تنظيف مفتاحها من تخزين الجلسة. فعّل التخزين ثم أعد المحاولة.`
   Do not accept a saved/uncertain-operation warning. Require the observed 400
   JSON before the rejected removal in the browser's clock domain.
6. Restore removeItem in `finally`; verify original method identity and a
   working storage-removal probe. Capture the unchanged form and key, then
   save the same dialog again. Require the same request body and key, another
   400 with the original validation error, open unchanged form, no receipt row,
   and cleared financial key. Restore fetch in an outer `finally`.
7. Save actual browser observations using the schema in
   `check-browser-receipt-rejection-cleanup.mjs` to ignored
   `generated-artifacts/verification/browser-receipt-rejection-cleanup.json`,
   with the proxy's current runId. Do not edit proxy evidence.
8. While the isolated database is alive, take an independent final capture:
   ```
   pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/test/browser-retry-proxy.ts --receipts --pass-success --capture-receipts
   node scripts/check-browser-receipt-rejection-cleanup.mjs
   node --test scripts/check-browser-receipt-rejection-cleanup.test.mjs
   ```
   The guard requires exactly two ingress arrivals/responses, no other financial
   POSTs, the intended mismatched payload, matching body/storage digests, and
   unchanged receipts, retry receipts, allocations, invoice paid balance/status,
   and journal IDs at both response snapshots and the independent final capture.
   Negative cases reject false positives such as an unsent request, a different
   validation, a commit, missing key retention, field changes, and incomplete
   method restoration. Guard regression tests are included in `pnpm run verify`.
9. Close the isolated tab. Gracefully SIGTERM the proxy and runner. Verify the
   identified temporary database directory and synthetic state are removed,
   then restore the normal API workflow.

Do not compare browser timestamps with server timestamps: order within each
clock domain, and match body/key/run identity between them.

## Observed result

The normal-login browser run passed: two real HTTP 400 responses had the same
body and key. The first displayed the explicit server-rejection/cleanup warning
with unchanged fields and retained key. After restoring storage, the retry
displayed the original allocation-total validation message, kept the dialog's
fields, and cleared the key. No saved-success warning or receipt row appeared.
Both response snapshots and the independent final disposable-database capture
showed no customer receipt, financial-request receipt, allocation, journal
change, or invoice balance/status change. The evidence guard passed.

The shared transport regression suite passed 78 tests, the rejection-evidence
guard passed its positive and negative cases, and the canonical root
`pnpm run typecheck` passed. Runtime application changes were unnecessary.
