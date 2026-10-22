# Double-click a customer receipt before either response

Use synthetic data and normal login only. This is not a cleanup-failure or
lost-response scenario: do not modify storage/fetch, reload, reopen the dialog,
invoke React handlers, or submit financial requests directly.

1. Start `node scripts/test-isolated.mjs --browser --receipts`. Privately read
   `/tmp/hasba-browser-state.json` for the synthetic owner and invoice fixture.
   Stop the normal API workflow, keep the ERP frontend running, and start:
   ```
   pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/test/browser-retry-proxy.ts --receipts --pass-success --overlap-receipts
   ```
2. Login normally. Open `/sales` → سندات القبض → سند قبض. Choose the fixture
   customer, amount 50, cash, and allocation 50 to the open invoice for 300.
3. Click حفظ السند twice within 500 ms using two actual DOM click events.
   Record timestamps; never manually call the API or application handlers.
   The proxy waits for both arrivals before forwarding either request, then
   delays 1500 ms to allow a pending snapshot. A 15-second timeout fails the
   checker, rather than counting a sequential retry as overlap.
4. Capture actual rendered fields and financial sessionStorage entries during
   the pending interval. After both successes, capture the closed dialog and
   refreshed receipt table. Write
   `generated-artifacts/verification/browser-overlapping-receipt.json`:
   ```
   {
     runId, companyId, userId, customerName, invoiceReference,
     clicks: [timestamp, timestamp],
     pending: {
       observedAt, timeOrigin, formOpen: true, entries: [[storageKey, key]],
       fields: {customerName, amount: "50", paymentMethod: "نقدي",
         invoiceReference, allocation: "50"}
     },
     afterSuccess: {
       observedAt, timeOrigin, formClosed: true, entries: [],
       visibleReceiptCount: 1, references: [reference]
     }
   }
   ```
   Use the proxy's current runId and authenticated synthetic identity. Read
   fields from the UI, not expected constants. Do not record login secrets.
5. While the disposable database remains live:
   ```
   pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/test/browser-retry-proxy.ts --receipts --capture-receipts
   node scripts/check-browser-overlapping-receipt.mjs
   ```
   This checks actual ingress/forward/response overlap, the same payload/key,
   one original and one `Idempotency-Replayed: true` response regardless of
   completion order, one tenant/user financial_requests receipt, one payment,
   one new linked journal and one allocation. The invoice must be paid 50,
   not 100; one receipt must appear in the list, and its pending key must clear.
6. Gracefully SIGTERM the proxy then runner, verify disposable processes,
   cluster and synthetic state are removed, and restore the normal API workflow.
   Evidence stays in ignored `generated-artifacts/verification`.

Regression command: `node --test scripts/check-browser-overlapping-receipt.test.mjs`.

## Verified result

The isolated browser run passed with normal login and two DOM save clicks
2 ms apart. Both requests arrived before forwarding, and the pending snapshot
was taken after both arrivals but before either response. Both responses were
201 with the same key and receipt identity; exactly one had the replay header.
Read-only database capture confirmed one financial request, one payment, one
linked journal and one allocation, with amountPaid 50 rather than 100.
The dialog closed, the pending key cleared and one receipt appeared in the list.

The overlap checker passed against the captured browser/proxy evidence. The
receipt, invoice and return overlap checker regression suites passed 117 tests,
and API typechecking passed. No application behavior was changed. Disposable
processes, database cluster and synthetic login state were removed gracefully;
the normal API workflow was restored and initialized successfully.
