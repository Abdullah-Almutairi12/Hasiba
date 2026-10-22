# Receipt: confirmed success followed by session key cleanup failure

This scenario exercises the real receipt dialog and shared financial transport,
not a request blocked before sending or a dropped/unreadable response.

1. Start `node scripts/test-isolated.mjs --browser --receipts`. After fixtures
   are ready, stop the normal API workflow and start:
   ```
   pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/test/browser-retry-proxy.ts --receipts --pass-success
   ```
   Keep the ERP frontend running. Sign in normally with the synthetic owner
   from `/tmp/hasba-browser-state.json`; never include credentials in evidence.
2. Open `/sales` → سندات القبض → سند قبض. Select the fixture customer,
   amount 50, نقدي, and allocation 50 to the fixture invoice.
3. Capture actual rendered fields. Observe receipt POST fetch calls, recording
   request body/key, status, replay header, parsed cloned JSON and its timestamp.
   Return the original successful response untouched. Throw from
   `Storage.prototype.removeItem` only for financial keys on `sessionStorage`.
   Record the rejected key and timestamp; do not block reads or writes.
4. Save once inside `try/finally`. Before restoring the method in `finally`,
   capture the open unchanged dialog, retained key, and explicit message
   beginning `تم حفظ العملية بالفعل، لكن تعذر تنظيف مفتاحها`.
   Require parsed 201 JSON before the attempted removal.
5. Prove restored method identity and a normal storage-removal probe. Capture
   the unchanged form/key, then save the same dialog again. Require 201 replay,
   same request body/key/document, closed dialog, cleared key and one list row.
   Restore fetch in an outer `finally`. Reload the actual page, select receipts
   again if necessary, and capture one row with the same reference.
6. Write browser observations matching `check-browser-receipt-cleanup-success.mjs`
   to ignored `generated-artifacts/verification/browser-receipt-cleanup-success.json`,
   with the current proxy runId. Do not edit proxy evidence. While the disposable
   database is alive, independently capture final state and validate:
   ```
   pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/test/browser-retry-proxy.ts --receipts --pass-success --capture-receipts
   node scripts/check-browser-receipt-cleanup-success.mjs
   node --test scripts/check-browser-receipt-cleanup-success.test.mjs
   ```
   The guard compares customer receipts, financial requests, allocations,
   invoice paid balance (50, never 100), and all journal IDs against both
   response snapshots and the final database. It also verifies a real reload.
7. Gracefully SIGTERM the proxy then the runner; verify removal of the identified
   disposable database and synthetic state. Restore the normal API workflow.

## Observed result

The normal-login browser run passed. Parsed 201 JSON preceded the rejected
removal, with unchanged fields and the confirmed-save warning. Restoring storage
and retrying returned the same receipt with `Idempotency-Replayed: true`.
Independent final capture confirmed one customer receipt, one financial request,
one allocation of 50, invoice amount paid 50, and exactly one new journal.
The same single receipt remained after a real reload. Both injected methods
were restored. The guard and its negative-case tests passed; no application
runtime behavior needed changing.
