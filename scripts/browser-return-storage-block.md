# Return safety-key write failure browser check

Use only the disposable runner and proxy, normal login, and synthetic fixtures.
Never use application rows, login bypasses, direct create API calls or permanent
browser settings. No production code change is needed.

1. Run `node scripts/test-isolated.mjs --browser --returns`. Wait for fixture
   readiness in `/tmp/hasba-browser-state.json`. Do not print its credentials.
2. Stop the normal API workflow and start
   `pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/test/browser-retry-proxy.ts --returns`.
   Keep the ERP frontend running. The proxy validates the disposable database,
   records POST arrivals (including failed/in-flight requests) and captures
   the baseline: one source invoice, zero returns/financial receipts, stock zero.
3. In a fresh browser context sign in normally as the synthetic owner. Open
   `/sales` → إشعارات دائنة → إشعار جديد. Select the fixture customer and
   reference invoice. Remove the empty default line (×), then click the
   invoice's `Synthetic return ite…` link to add its linked product line.
   Set quantity to `1`, retain price `100` and tax `0`, set reason to
   `Return storage block verification`, and keep إعادة المخزون checked.
4. In this test tab save `Storage.prototype.setItem` and `window.fetch`.
   Wrap setItem to record the attempted key and throw `QuotaExceededError`
   **only** for `this === window.sessionStorage` and keys starting with
   `hasba:financial-request:`. Delegate other writes unchanged. Prove an
   unrelated session key can be written/read/removed. Wrap fetch to count
   outgoing POSTs to `/api/sales/credit-notes`, delegating unchanged; do not
   intercept/block requests. Capture financial entries and actual rendered
   fields before saving. Click حفظ وترحيل exactly once.
5. Capture the still-open dialog, unchanged fields and the visible error:

   > تعذر حفظ مفتاح العملية بأمان. لم يُرسل الطلب؛ فعّل تخزين الجلسة وأعد المحاولة.

   Capture the zero browser POST count, failed key and empty financial entries.
   The guard verifies the exact attempted key fingerprint, proving the linked
   invoice line and zero tax were included without sending the request,
   even when the tax field is hidden by the VAT setting.
6. In `finally`, restore the original setItem/fetch and prove a synthetic
   financial-prefixed key can now be written/read/removed (remove it in a
   nested finally). Record restored method identities and empty financial
   entries. Do not save again. Write actual browser evidence matching
   `check-browser-return-storage-block.mjs` to
   `generated-artifacts/verification/browser-return-storage-block.json`.
   Use the current run ID from `browser-identical-return-proxy.json`; include
   only synthetic customer ID/name, never credentials.
7. While the proxy and disposable database remain alive, run:

   ```sh
   pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/test/browser-retry-proxy.ts --returns --capture-storage-block
   node scripts/check-browser-return-storage-block.mjs
   ```

   This requires zero browser/proxy POSTs, unchanged credit_notes and
   financial_requests counts, no return_in movements and unchanged stock,
   warehouse quantity and valuation. Zero successful events alone cannot pass.
8. Gracefully SIGTERM the proxy, then the isolated runner. Confirm their
   processes, temporary state file and identified disposable cluster directory
   are gone. Restore the normal API workflow and check logs. Runtime evidence
   and screenshots remain in ignored `generated-artifacts/verification`.

Regression checks:

```sh
node --test scripts/check-browser-return-storage-block.test.mjs scripts/check-browser-storage-block.test.mjs scripts/check-browser-identical-return.test.mjs
```

The real-browser run confirmed the expected error, unchanged open return form,
one rejected operation-key write, zero browser/proxy return POSTs, unchanged
credit-note/financial-request counts and return stock state. The original
setItem/fetch methods were restored in finally and a financial-key storage
probe succeeded afterward. Final read-only proxy capture and the evidence
guard passed before graceful shutdown. The synthetic state file, disposable
cluster directory and all three test processes were confirmed removed/stopped;
the normal API workflow was restored.
