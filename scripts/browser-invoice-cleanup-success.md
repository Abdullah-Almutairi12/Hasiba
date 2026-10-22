# Customer invoice: confirmed success followed by key-cleanup failure

This is not a lost-response or unreadable-response scenario. Exercise the
real `sales.tsx` invoice dialog and shared `financial-fetch.ts`, without
changing application behavior or bypassing normal authentication.

## Reproduce

1. Start `node scripts/test-isolated.mjs --browser`; wait for fixtures ready.
   Stop the normal API workflow, keep the ERP frontend running, and start:
   ```
   pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/test/browser-retry-proxy.ts --pass-success
   ```
   Use only the disposable database. Read synthetic owner credentials from
   `/tmp/hasba-browser-state.json` privately; never copy them into evidence.
2. Log in through the normal UI. Open `/sales` → فواتير العملاء →
   فاتورة جديدة. Choose the fixture customer and product `منتج اختبار`.
   Set quantity 1, price 100, discount 0, default 15% VAT, and notes
   `Cleanup success invoice`. Capture the actual rendered form values.
3. Install a passive fetch observer for POST `/api/sales/invoices` that
   records request body/key, status, replay header and parsed cloned JSON
   with its observation timestamp. Return the original response untouched.
   Save the original `Storage.prototype.removeItem`; throw only for
   `this === sessionStorage` and `hasba:financial-request:` keys. Record the
   rejected key and timestamp. Do not block reads or writes.
4. Inside `try/finally`, save once and capture the open unchanged dialog,
   retained financial key, and exact message beginning
   `تم حفظ العملية بالفعل، لكن تعذر تنظيف مفتاحها`.
   Require parsed HTTP 201 JSON before the attempted removal. Restore the
   original method in `finally`, including when any assertion fails.
5. Prove restored method identity and a successful ordinary storage removal
   probe. Capture unchanged fields/key before retry. Save the same open form
   once more. Require 201, `Idempotency-Replayed: true`, same document/body/key,
   closed dialog, removed key, and one visible invoice row. Restore fetch in
   an outer `finally`.
6. Store browser observations using the contract in
   `check-browser-invoice-cleanup-success.mjs`, under ignored
   `generated-artifacts/verification/browser-invoice-cleanup-success.json`.
   Include the current proxy `runId`. Never edit proxy evidence.
7. Before disposing the database:
   ```
   pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/test/browser-retry-proxy.ts --pass-success --capture-receipts
   node scripts/check-browser-invoice-cleanup-success.mjs
   node --test scripts/check-browser-invoice-cleanup-success.test.mjs scripts/check-browser-retry.test.mjs
   ```
8. Gracefully SIGTERM the proxy then isolated runner. Verify the identified
   disposable cluster and synthetic state are removed, restore the normal
   API workflow, and check startup logs.

## Observed result

The isolated normal-login browser run passed. The first valid 201 response
preceded the rejected removal; the original form and key remained alongside
the explicit saved-but-cleanup-failed message. The unchanged retry replayed
the same invoice and receipt. Both response snapshots and final database
capture contained one customer invoice, one financial request and the same
single journal ID (the baseline was empty). The dialog closed and exactly
one invoice appeared after recovery. Both injected methods were restored.
The evidence guard and its negative-case tests passed. No production
application fix was necessary.
