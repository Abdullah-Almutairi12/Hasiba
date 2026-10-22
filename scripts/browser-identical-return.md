# New identical sales return after confirmed recovery

Use only disposable infrastructure; never copy application data or bypass login.
This scenario retries in place then starts a new intent after confirmed success.
It does not replace the reload or unreadable-response tests.

1. Run `node scripts/test-isolated.mjs --browser --returns`. Wait for readiness.
   Synthetic owner credentials and fixture metadata are written to
   `/tmp/hasba-browser-state.json`; never print, commit or include credentials
   in evidence. The invoice has four units at 100 (zero tax), with evidenced
   historical issue cost of 50 and zero remaining stock. Return one unit twice.
2. Stop the normal API workflow, then run:

   ```sh
   pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/test/browser-retry-proxy.ts --returns
   ```

   Keep the normal ERP frontend. The proxy validates the disposable database,
   captures committed return/receipt/stock state, then drops only the first
   successful return response. All other routes pass through unchanged.
3. In a fresh browser context sign in normally as the synthetic owner.
   Open `/sales` → إشعارات دائنة → إشعار جديد. Choose fixture customer
   and invoice. Remove the empty default line (×), then click the source
   invoice's `Synthetic return ite…` line-link button. Change its quantity
   from 4 to **1**, retaining product, description, price 100, tax 0 and source
   line link. Set reason to `Identical return verification`; keep إعادة المخزون
   checked. Save with حفظ وترحيل.
4. After the lost success (possibly HTTP 502), capture `beforeRetry`:
   `observedAt: Date.now()`, `timeOrigin: performance.timeOrigin`, financial
   sessionStorage `entries` only, `formOpen`, and actual rendered `fields`:
   `{customerName, invoiceReference, reason, restock, description, quantity,
   unitPrice, taxRate}`. Tax is zero from the linked invoice, even if hidden
   because VAT is disabled; corroborate it with the captured outgoing body.
5. Without reload, field edits, or storage manipulation, save again. Wait for
   success, closed form, and refreshed credit-note list. Capture `afterSuccess`:
   timestamps, entries, `formClosed`, `visibleCreditNoteCount: 1`, `references`.
6. Open a new dialog and fill exactly the same values, including source line.
   If the dialog retains its last values, keep them unchanged rather than
   adding a duplicate linked line; read and verify the actual rendered values.
   Capture `afterNewForm` with timestamps, entries, `formOpen` and `fields`.
   Save once. Capture `afterSecondSuccess` like `afterSuccess`, with both rows.
   All creates/retries must be real UI clicks, not API calls or script submits.
7. Save these browser snapshots, proxy `runId`, synthetic `customerId` and
   `customerName` to `generated-artifacts/verification/browser-identical-return.json`.
   Before shutting down the disposable database:

   ```sh
   pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/test/browser-retry-proxy.ts --returns --capture-receipts
   node scripts/check-browser-identical-return.mjs
   ```

   The guard requires three arrivals, equal bodies/digests/session slots, replay
   of the first key, a fresh second key with no replay header, two distinct
   issued returns and financial-request links, separate journals, two original
   cost return movements, stock 1 after first/retry then 2 after second, cleared
   pending keys and both references in the refreshed list. Existing invoice and
   reload guards remain unchanged.
8. Gracefully SIGTERM the proxy, then the isolated runner. Confirm temporary
   state/database disposal, restore the normal API workflow and check logs.
   Runtime evidence stays in ignored `generated-artifacts/verification`.

Guard regression tests: `node --test scripts/check-browser-identical-return.test.mjs`.
