# Close and reopen an uncertain sales return

This is a separate browser scenario from `browser-identical-return.md`: there
is no confirmed success before reopening and therefore no new intent. Use
only synthetic disposable data, normal login and real UI save clicks. Do not
reload, inject an unreadable response, change session storage or call create
APIs directly.

1. Run `node scripts/test-isolated.mjs --browser --returns`. After readiness,
   read the synthetic owner and return fixture from
   `/tmp/hasba-browser-state.json` privately; never include credentials in
   evidence. Stop the normal API workflow, then run:

   ```sh
   pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/test/browser-retry-proxy.ts --returns
   ```

   Keep the ERP frontend running. This proxy proves the committed return,
   financial request receipt and stock before dropping the first success.
2. Sign in normally in a fresh browser context. Open `/sales` → إشعارات دائنة
   → إشعار جديد. Select the synthetic customer and source invoice. Remove the
   blank default line (×), then add the linked `Synthetic return ite…` source
   line. Change quantity to 1, keeping price 100, zero tax and إعادة المخزون
   checked. Enter reason `Reopened return verification`. Click حفظ وترحيل once.
3. Wait for the lost response error (the preview proxy may return HTTP 502).
   Capture `afterLostResponse`, including actual rendered fields and pending
   key. Close the dialog via its normal close button and capture `afterClose`
   with `formClosed: true`. Do not save again yet.
4. Click إشعار جديد. Inspect actual fields: the dialog may retain them because
   its owner stays mounted. Keep matching fields unchanged; if fields reset,
   refill exactly the original data including the source-line link, without
   adding a duplicate line. Capture `afterReopen` with the actual fields and
   the same financial storage entry. There must be no success confirmation or
   second POST before this snapshot.
5. Click حفظ وترحيل once in the reopened dialog. Wait for success, closed
   dialog and refreshed list with exactly one return. Capture `afterSuccess`
   with no pending key and the single visible reference.
6. Each snapshot includes `observedAt: Date.now()`,
   `timeOrigin: performance.timeOrigin`, and financial sessionStorage `entries`
   (only keys starting `hasba:financial-request:`). Open-form snapshots include
   `formOpen: true` and `fields: {customerName, invoiceReference, reason,
   restock, description, quantity, unitPrice, taxRate}` with numeric input
   values as strings. Hidden zero tax must be corroborated by the outgoing
   linked-line body. Closed snapshots include `formClosed: true`; success also
   includes `visibleCreditNoteCount: 1` and `references`.
   Write snapshots, proxy `runId`, synthetic `customerId` and `customerName` to
   `generated-artifacts/verification/browser-reopened-return.json`.
7. Before disposal, capture final read-only database evidence and check:

   ```sh
   pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/test/browser-retry-proxy.ts --returns --capture-receipts
   node scripts/check-browser-reopened-return.mjs
   ```

   The guard requires exactly two arrivals with identical bodies and keys,
   `Idempotency-Replayed: true` on the retry, the same issued return/reference,
   tenant/user/operation receipt linked to that return, unchanged journal and
   movement identity, one historical-cost restoration and stock/warehouse
   quantity 1 valued at 50. Closing/reopening must preserve the pending key;
   only confirmed success clears it. Both snapshots must precede replay.
8. Gracefully SIGTERM the proxy, then the isolated runner. Confirm removal of
   their processes, synthetic state file and positively identified temporary
   cluster directory. Restore the normal API workflow and check logs.
   Evidence and screenshots stay in ignored `generated-artifacts/verification`.

Regression checks:

```sh
node --test scripts/check-browser-reopened-return.test.mjs scripts/check-browser-identical-return.test.mjs
```

## Verified browser result

The isolated real-browser run used normal login and exactly two UI saves.
After the dropped committed success, closing and reopening retained all
original rendered fields without refilling or adding another line. The
pending key survived both snapshots; no confirmation occurred before reopen.
The retry returned the same document/reference with
`Idempotency-Replayed: true`, closed the dialog and displayed one list row.
The final read-only receipt capture and guard passed: one issued credit note,
one linked financial request receipt, the same journal and movement, stock
and warehouse quantity 1 at historical unit cost 50. No application data,
reload or unreadable-response scenario was used. No application-code fix was
needed.

The proxy and runner exited gracefully; their processes, synthetic state file
and identified disposable PostgreSQL directory were confirmed removed. The
normal API workflow was restored and both API and ERP startup logs were clean.
The new guard regression tests and existing identical-return guard tests all
passed (115 checks).
