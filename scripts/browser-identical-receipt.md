# New identical receipt after confirmed recovery

No application data, auth bypass, production routes, or permanent settings.
This independent scenario retries the first dialog in place; it does not
substitute for the separate reload or unreadable-response checks.

1. Start `node scripts/test-isolated.mjs --browser --receipts`. It creates
   synthetic owner/sales users and one open owner invoice for 300, with no
   customer receipts or financial retry receipts. The extra fixture flag does
   not change the original empty invoice scenarios.
2. Stop the normal API workflow. Start:

   ```sh
   pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/test/browser-retry-proxy.ts --receipts
   ```

   Keep the normal ERP frontend. The proxy checks the disposable database
   identity before importing the app. Its first receipt success is dropped only
   after upstream commit and read-only snapshots of the payment, allocation,
   invoice balance, and financial request. Other routes pass through unchanged.
3. In a fresh browser context, sign in normally using the synthetic owner from
   `/tmp/hasba-browser-state.json` (never print or commit the credentials).
   Open `/sales` → سندات القبض → سند قبض. Choose the fixture customer,
   amount 50, cash, and allocate 50 to the fixture invoice. Save once.
4. After the lost success (the preview proxy may return 502), capture
   `beforeRetry`: `observedAt: Date.now()`, `timeOrigin: performance.timeOrigin`,
   financial sessionStorage `entries` only, `formOpen`, and `fields`:
   `{customerName, amount: "50", paymentMethod: "نقدي", invoiceReference,
   allocation: "50"}`. Read actual rendered fields, not expected constants.
5. Without reloading, changing values, or touching storage, click حفظ السند
   once again. Wait for success, closed dialog and refreshed list. Capture
   `afterSuccess`: timestamp, time origin, entries, `formClosed`,
   `visibleReceiptCount: 1`, and actual table `references`.
6. Reopen a **new** سند قبض dialog. Fill the same customer, amount, cash and
   allocation. Capture `afterNewForm`: timestamp, time origin, entries,
   `formOpen`, and actual `fields`. Save once, then capture
   `afterSecondSuccess` with the same schema as `afterSuccess` and both visible
   references. Do not submit via API/evaluate or manufacture evidence.
7. Save browser snapshots with the proxy's current `runId`, `customerName`,
   and `invoiceReference` to
   `generated-artifacts/verification/browser-identical-receipt.json`.
   While the disposable database is alive, capture final read-only links:

   ```sh
   pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/test/browser-retry-proxy.ts --receipts --capture-receipts
   node scripts/check-browser-identical-receipt.mjs
   ```

   The guard requires exactly three POST arrivals: first committed/dropped,
   unchanged replay with `Idempotency-Replayed: true`, then identical new data
   with a different key and **no** replay header. It verifies two receipt IDs,
   references, financial-request identities and persisted document links,
   separate journals/allocations, invoice paid 50 then 100 (never 150), cleared
   pending keys after confirmation, a new form, and two refreshed list rows.
8. Gracefully SIGTERM the proxy and then isolated runner; verify removal of
   temporary database/state. Restart the normal API workflow and check logs.
   Runtime JSON/screenshots stay in ignored `generated-artifacts/verification`.

Guard regression tests (no database needed):

```sh
node --test scripts/check-browser*.test.mjs
```

The real-browser run passed: the unchanged retry returned the first receipt,
the freshly opened identical form created a second receipt with no replay
header, and read-only snapshots confirmed two persisted retry receipts and an
invoice paid balance of 100. The guard regression suite (121 tests) and API
TypeScript check also passed. No application runtime code was changed.
