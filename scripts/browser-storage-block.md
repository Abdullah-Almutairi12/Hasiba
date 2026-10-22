# Invoice safety-key write failure browser check

Use only disposable fixtures, never application data. No production code or
authentication bypass is required.

1. Run `node scripts/test-isolated.mjs --browser`. Wait for the synthetic
   fixtures in `/tmp/hasba-browser-state.json`. Do not print their credentials.
2. Stop the normal API workflow and start
   `pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/test/browser-retry-proxy.ts`.
   Keep the ERP frontend running. The proxy verifies the disposable loopback
   database identity and captures baseline invoice/financial-receipt counts.
3. In a fresh browser context, log in normally with the synthetic owner account.
   Open `/sales` → فواتير العملاء → فاتورة جديدة. Select the fixture customer
   and product, quantity `2`, price `123.45`, discount `3`, notes
   `synthetic-storage-block`.
4. In this test tab only, save the original `Storage.prototype.setItem`.
   Replace it with a wrapper that throws `QuotaExceededError` and records the
   key **only** when `this === window.sessionStorage` and the key starts with
   `hasba:financial-request:`. Delegate every other write unchanged. Prove an
   unrelated session-storage key can be written/read/removed. Count outgoing
   invoice POSTs without blocking or changing their requests.
5. Capture actual dialog fields before saving, then click حفظ exactly once.
   Capture the visible error immediately, unchanged fields, open dialog,
   blocked keys, outgoing POST count, and financial session-storage entries.
   The expected error is:

   > تعذر حفظ مفتاح العملية بأمان. لم يُرسل الطلب؛ فعّل تخزين الجلسة وأعد المحاولة.

6. In `finally`, restore the original storage method and any fetch wrapper or
   network listener. Prove a synthetic financial-prefixed key can now be
   written/read/removed. **Do not save again.** Do not change permanent browser
   settings. Write actual browser evidence using the schema in
   `check-browser-storage-block.mjs` to
   `generated-artifacts/verification/browser-storage-block.json`, with the
   current run ID from the local `browser-retry-proxy.json`.
7. While the same proxy and disposable database remain alive, run:

   ```sh
   pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/test/browser-retry-proxy.ts --capture-storage-block
   node scripts/check-browser-storage-block.mjs
   ```

   This checks both zero incoming invoice POSTs (including failed/in-flight
   arrivals) and zero invoice/financial-request rows in the disposable database.
8. Gracefully terminate the proxy, then the isolated runner with SIGTERM.
   Verify the runner removed its temporary state and database directory.
   Restart the normal API workflow and check its logs.

Companion regression checks:

```sh
node --test scripts/check-browser-storage-block.test.mjs
pnpm --filter @workspace/api-server exec vitest run test/financial-fetch.test.mjs
```

The real-browser run confirmed the expected error and retained fields, zero
browser/proxy invoice POSTs, zero invoices and financial receipts, unaffected
unrelated storage, and restored financial-key writes. Runtime JSON evidence and
screenshots belong in ignored generated output, not in Git.
