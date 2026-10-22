# Edit and revert an uncertain return without submitting the edit

Independent of `browser-reopened-return.md`; leave that scenario unchanged.
Use only `node scripts/test-isolated.mjs --browser --returns`, normal login
and `artifacts/api-server/src/test/browser-retry-proxy.ts --returns`.
No reload, close/reopen, storage faults, unreadable response, or direct create API.

1. Start the isolated runner, wait for its ready message, and privately read
   the synthetic owner credentials and return fixture from
   `/tmp/hasba-browser-state.json`. Never put credentials in reports.
   Stop the normal API workflow; run:
   `pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/test/browser-retry-proxy.ts --returns`.
   Keep the ERP frontend running.
2. In a fresh browser, sign in normally. Install a passive outgoing request
   counter for POST `/api/sales/credit-notes` before saving (browser request
   events or a transparent fetch observer; never replace responses).
   Open `/sales` → إشعارات دائنة → إشعار جديد. Select the fixture customer
   and invoice, remove the blank line with ×, then add the linked source
   line. Set quantity 1, price 100, zero tax and restock checked. Set reason
   to `Reverted return verification`. Click حفظ وترحيل once.
3. Wait for the failed response and verify the proxy's first event proves a
   committed success was dropped. Capture `afterLostResponse`.
4. In the same open dialog, change only reason to `Temporary unsent reason`.
   Blur the field so React renders the change. Do not save. Capture
   `afterEdit` from actual DOM values; read the live proxy report to attach
   `proxyReturnPostCount`. It and `outgoingReturnPosts` must still be 1.
5. Restore reason exactly to `Reverted return verification`, blur, and
   capture `afterRevert` the same way. No save of the edited payload is
   allowed. The original pending financial storage entry must remain.
6. Click حفظ وترحيل once. Wait for confirmation, dialog closure and refreshed
   list with one return. Capture `afterSuccess`.
7. Write `generated-artifacts/verification/browser-reverted-return.json`:
   top-level `runId` from the proxy, fixture `customerId`, `customerName`,
   and the four snapshots. Each snapshot contains `observedAt: Date.now()`,
   `timeOrigin: performance.timeOrigin`, financial sessionStorage `entries`
   (prefix `hasba:financial-request:` only), and `outgoingReturnPosts`.
   Open snapshots include `formOpen: true`, `proxyReturnPostCount` read
   immediately at that stage and actual `fields: {customerName,
   invoiceReference, reason, restock, description, quantity, unitPrice,
   taxRate}`. Numeric values are strings; hidden zero tax is corroborated
   by outgoing body. Success includes `formClosed: true`,
   `visibleCreditNoteCount` and `references` read from the visible list.
8. Before disposal, run:
   ```
   pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/test/browser-retry-proxy.ts --returns --capture-receipts
   node scripts/check-browser-reverted-return.mjs
   ```
   The guard proves two identical requests/key/digest, original receipt and
   credit note, replay header, unchanged journal/movement identities, one
   restock at historical cost 50, and key removal only after confirmation.
9. Gracefully SIGTERM the proxy and then the runner; verify their processes,
   synthetic state file and identified disposable cluster are removed.
   Restore the normal API workflow and check startup logs.

Regression command: `node --test scripts/check-browser-reverted-return.test.mjs scripts/check-browser-reopened-return.test.mjs`.
Keep runtime evidence and screenshots under ignored `generated-artifacts/verification`.

## Verified result

The real browser run passed with normal login and exactly two UI saves.
After the committed HTTP 201 response was dropped, the dialog stayed open.
Both the temporary reason and the restored reason were observed in the DOM;
browser outgoing and proxy arrival counts stayed at 1 throughout both edits.
The same pending key remained stored. Retrying restored the same document,
receipt, reference and digest with `Idempotency-Replayed: true`; confirmation
cleared the pending key, closed the dialog and displayed one issued return.
Final read-only evidence and the guard passed: one movement, unchanged
journal identity, stock and warehouse quantity 1 at historical cost 50.

The new guard tests plus the unchanged reopened/identical-return guard tests
passed all 184 checks. No application fix was needed. The isolated proxy and
runner exited gracefully; the synthetic state and identified temporary
cluster were removed. Normal API and ERP startup logs were clean.
