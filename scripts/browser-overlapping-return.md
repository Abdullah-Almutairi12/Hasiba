# Double-click a return before either response

Use only synthetic data and normal login. This is NOT lost-response recovery:
do not close/reopen, reload, alter storage, or send financial requests directly.

1. Start `node scripts/test-isolated.mjs --browser --returns`. Privately read
   `/tmp/hasba-browser-state.json` for synthetic login and fixture data.
   Stop the normal API workflow; keep the ERP frontend running. Start:
   ```
   pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/test/browser-retry-proxy.ts --returns --pass-success --overlap-returns
   ```
2. Login normally, open `/sales` → إشعارات دائنة → إشعار جديد. Choose the
   fixture customer and invoice. Remove the default blank line, add the linked
   synthetic invoice line, quantity 1, price 100, zero tax, restock checked.
   Reason: `Overlapping return verification`.
3. Double-click حفظ وترحيل within 500 ms (two real DOM click events, not direct
   API calls or React handler invocation). Record click timestamps. The proxy
   waits for BOTH request arrivals, then delays forwarding by 1500 ms. A 15 s
   timeout fails the evidence guard instead of pretending overlap happened.
4. During the pending interval capture actual rendered fields and financial
   sessionStorage entries. Await both successes, closed dialog and one list
   row. Write `generated-artifacts/verification/browser-overlapping-return.json`:
   `runId`, synthetic `customerId`, `customerName`, authenticated `companyId`,
   `userId`, `clicks: [timestamp,timestamp]`, `pending: { observedAt, timeOrigin,
   formOpen:true, entries, fields:{customerName,invoiceReference,reason,restock,
   description,quantity,unitPrice,taxRate} }`, `afterSuccess:{observedAt,
   timeOrigin, formClosed:true, entries:[], visibleCreditNoteCount:1,references}`.
   Input numbers in fields are strings. Capture only financial storage entries;
   never record passwords or session cookies. Hidden zero tax is corroborated
   by the actual outgoing payload.
5. While the isolated DB is live, run:
   ```
   pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/test/browser-retry-proxy.ts --returns --capture-receipts
   node scripts/check-browser-overlapping-return.mjs
   ```
   The guard checks ingress/forward/response timing, matching key and payload,
   one original plus one `Idempotency-Replayed: true` response, tenant/user
   receipt identity, one issued return, one new journal, one linked historical
   cost movement, stock/warehouse quantity 1 at cost 50, and browser success.
6. Gracefully SIGTERM proxy then runner; verify disposable state, cluster and
   processes removed. Restore the normal API workflow and inspect startup logs.
   Keep evidence/screenshots in ignored `generated-artifacts/verification`.

Regression command: `node --test scripts/check-browser-overlapping-return.test.mjs`.

## Verified result

The isolated browser run passed using normal login and two DOM save clicks
1 ms apart. Both requests arrived 1 ms apart, before either was forwarded or
answered. The pending dialog retained one key and the original linked-line
fields. Both HTTP 201 responses identified the same return; one carried the
replay header. The first arrival happened to be the replay, so the guard
deliberately checks response roles rather than assuming arrival order is
transaction order.

The final read-only capture confirmed one financial receipt, one issued return,
one new journal and one return movement at historical cost 50; stock and
warehouse quantity were 1. The dialog closed, the key cleared, and one list row
was visible. The new and existing return evidence guards passed 149 checks;
API typechecking also passed. No application code change was needed.
Disposable processes, synthetic state and cluster were removed gracefully, and
the normal API workflow was restored.
