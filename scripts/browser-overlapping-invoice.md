# Double-click a customer invoice before either response

Use synthetic data and normal owner login only. Do not reload, reopen the form,
drop responses, patch storage, call financial APIs directly, or invoke React handlers.

1. Start `node scripts/test-isolated.mjs --browser`. Privately read
   `/tmp/hasba-browser-state.json` for synthetic login. Stop the normal API
   workflow, keep the ERP frontend running, then start:
   ```
   pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/test/browser-retry-proxy.ts --pass-success --overlap-invoices
   ```
2. Log in normally. In `/sales`, open the customer invoices tab and new invoice.
   Select the fixture customer and product `منتج اختبار`; quantity 1, price 100,
   discount 0, default tax 15% (fixture companies inherit registered VAT status).
   Notes: `Overlapping invoice verification`.
3. Dispatch two real DOM save clicks within 500 ms. Record timestamps. The proxy
   waits for both arrivals, then holds forwarding for 1500 ms for pending-state
   capture. A 15 s timeout invalidates the run, rather than fabricating overlap.
4. Save browser evidence to
   `generated-artifacts/verification/browser-overlapping-invoice.json`:
   `runId`, `customerId`, `customerName`, `productId`, authenticated `companyId`,
   `userId`, `clicks:[timestamp,timestamp]`,
   `pending:{observedAt,timeOrigin,formOpen:true,entries,fields:{customerName,
   productName,quantity,unitPrice,discountPct,notes}}`,
   `afterSuccess:{observedAt,timeOrigin,formClosed:true,entries:[],
   visibleInvoiceCount:1,references}`.
   Capture rendered number fields as strings; storage entries are `[key,value]`
   pairs filtered to `hasba:financial-request:` only. Never save credentials or
   cookies in evidence. Read IDs from the normal authenticated responses.
5. Wait for both successes and verify the closed dialog and exactly one actual
   rendered invoice row. While the disposable database is live, run:
   ```
   pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/test/browser-retry-proxy.ts --capture-receipts
   node scripts/check-browser-overlapping-invoice.mjs
   ```
   The guard requires identical payload/key, one original and one replay header,
   two arrivals before either response, one invoice, one financial request receipt,
   one journal, correct tenant/user, normal key cleanup and refreshed list.
   Invoice creation bills goods but does not issue inventory: the guard checks
   unchanged product balances, warehouse quants and stock moves, not a fictitious
   stock deduction (delivery orders own that operation).
6. Gracefully SIGTERM proxy and runner; confirm disposable cluster, state and
   processes are gone. Restore the normal API workflow and inspect its logs.

Regression: `node --test scripts/check-browser-overlapping-invoice.test.mjs`.

## Verified result

Normal owner login and two DOM clicks 2 ms apart produced two arrivals 2 ms
apart, both held before forwarding. The pending snapshot was 13 ms after the
second arrival and before either response. Both responses were HTTP 201, one
original and one replay, with the same key and invoice. Final capture confirmed
one invoice, one financial receipt, one journal and unchanged inventory.
The dialog closed, the key cleared, and exactly one invoice row appeared.

The first guard run exposed an incorrect test assumption of zero VAT: the
fixture company inherits `registered` status, so the actual form correctly sent
15% and displayed 115. The guard and these instructions now explicitly require
that payload and total. No application change or second invoice submission was
needed; the original browser evidence passes the corrected guard.
