# Return safety-key read failure browser check

Follow the isolated setup, normal synthetic-owner login and linked return form
steps in `browser-return-storage-block.md`. Run
`node scripts/test-isolated.mjs --browser --returns`, then stop the normal API
workflow and start the disposable
`artifacts/api-server/src/test/browser-retry-proxy.ts --returns` proxy. Never use
application data, authentication bypasses or direct create API calls.

Use the same form values: fixture customer and source invoice, exactly one linked
product line, quantity `1`, price `100`, zero tax, reason
`Return storage block verification`, and restock checked. Remove the default
empty line before adding the source line.

Unlike the write-failure scenario, save the original `Storage.prototype.getItem`,
`setItem`, `removeItem` and `window.fetch` methods and:

- Wrap `getItem` to record the key and throw `DOMException` with name
  `SecurityError` **only** for `this === window.sessionStorage` and keys beginning
  `hasba:financial-request:`. Delegate all unrelated reads unchanged.
- Wrap `setItem` to record financial-session-key write attempts, but always
  delegate to the original method. No write should be attempted.
- Wrap fetch to count outgoing POSTs to `/api/sales/credit-notes`, delegating
  unchanged. Do not intercept/block requests.
- Prove an unrelated session key can be written/read/removed with the wrapped
  methods. Enumerate financial entries using the saved original getter so
  observation itself does not trigger the injected failure.
- Capture actual rendered fields and financial entries before clicking
  حفظ وترحيل **once**, then capture the still-open dialog, unchanged fields,
  and the visible error:

  > تعذر حفظ مفتاح العملية بأمان. لم يُرسل الطلب؛ فعّل تخزين الجلسة وأعد المحاولة.

In `finally`, restore all four methods. Prove a synthetic financial-prefixed
session key can now be written/read/removed, removing the probe in a nested
finally. Do not submit again. Save actual browser evidence to
`generated-artifacts/verification/browser-return-storage-read-block.json` using
the schema of the existing write checker, with these additional required fields:

```js
{
  faultMethod: "getItem",
  faultName: "SecurityError",
  blockedKeys: [/* actual rejected read key */],
  financialWriteKeys: [], // actual observed writes, not a constant
  restored: {
    // Also include the existing restoration/timestamp/financialEntries fields.
    originalGetItemRestored: true,
    originalRemoveItemRestored: true
  }
}
```

Include the current proxy run ID and synthetic customer ID/name, never login
credentials. The exact rejected read-key digest must match the complete linked
return payload. It proves form validation reached the intended operation.
While proxy and database remain alive, capture the read-only final database state
and run the dedicated guard:

```sh
pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/test/browser-retry-proxy.ts --returns --capture-storage-block
node scripts/check-browser-return-storage-read-block.mjs
node --test scripts/check-browser-return-storage-block.test.mjs scripts/check-browser-storage-block.test.mjs scripts/check-browser-identical-return.test.mjs
```

The guard requires zero browser and proxy POSTs (including failed/in-flight
requests), unchanged `credit_notes` and `financial_requests` counts, no
`return_in` movements and unchanged product stock, warehouse quantity and
valuation. It rejects write-failure evidence.

Gracefully SIGTERM the proxy and then the runner; verify both stopped, the private
synthetic state file and positively identified disposable cluster directory were
removed. Restore the normal API workflow and check its logs. Keep runtime
evidence/screenshots under ignored `generated-artifacts/verification`.

## Verified run

The real-browser check passed with normal synthetic-owner login. One rejected
`getItem` call matched the exact linked-return fingerprint; no financial-key
write was attempted. The open dialog retained every entered field and displayed
the storage-safety message. Browser and proxy return POST counts were both zero.
Final read-only capture showed no credit note, financial receipt or stock
restoration. All original methods were restored in `finally`, and the restored
financial-key write/read/remove probe succeeded. The dedicated evidence guard
and 144 regression assertions passed. Proxy and runner exited gracefully; the
synthetic state file and identified disposable database directory were removed,
and the normal API workflow was restored.
