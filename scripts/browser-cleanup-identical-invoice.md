# A deliberately new identical invoice after cleanup-failure recovery

For persistent cleanup failure across multiple confirmed replays, use the
separate scenario and evidence guard in `browser-repeated-invoice-cleanup.md`.
This original three-request guard remains strict.

Use the disposable setup and normal login from
`browser-invoice-cleanup-success.md`, with proxy `--pass-success`. No
application behavior or authentication bypass is needed.

1. Follow that scenario through the first parsed 201, scoped sessionStorage
   `removeItem` failure, unchanged open form, restored method/probe, and
   unchanged replay. Capture all its existing evidence fields.
2. Keep the passive fetch observer installed. After the replay closes the
   dialog and the list shows exactly one reference, record `afterSuccess`
   with `observedAt: Date.now()` and `timeOrigin: performance.timeOrigin`.
3. In the same tab/document, click **فاتورة جديدة** again. Fill the exact
   original customer, product, quantities, price, discount, VAT, date and notes.
   Do not retry the previous dialog or double-click Save.
   Record `afterNewForm` with `formOpen`, rendered `fields` in the same format
   as `beforeSave.fields`, empty financial `entries`, `observedAt`, `timeOrigin`.
4. Save once with storage working. Record the third parsed response using
   the existing observer contract. Require a fresh key, byte-identical
   request body, no replay header, a different invoice ID and reference.
   Capture `afterSecondSuccess` with `formClosed`, empty `entries`,
   `visibleInvoiceCount: 2`, both `references`, `observedAt`, `timeOrigin`.
5. Restore fetch and removeItem in `finally`, including on failure. Write
   browser evidence with the current proxy `runId` to ignored
   `generated-artifacts/verification/browser-cleanup-identical-invoice.json`.
6. Before stopping the proxy or disposing the DB, run:
   ```
   pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/test/browser-retry-proxy.ts --pass-success --capture-receipts
   node scripts/check-browser-cleanup-identical-invoice.mjs
   node --test scripts/check-browser-cleanup-identical-invoice.test.mjs scripts/check-browser-invoice-cleanup-success.test.mjs
   ```
   The new guard checks the first two event snapshots with the unchanged
   cleanup guard, then independently checks final counts, journals and receipt
   identities/links. Never rewrite proxy event evidence to fit the old guard.
7. Gracefully SIGTERM proxy then isolated runner; verify disposable cluster
   and synthetic state removal. Restore the normal API workflow and check logs.

Record browser timestamps unchanged. Browser and proxy wall clocks may differ;
the guard orders browser UI/JSON observations in the browser clock domain and
database captures in the proxy clock domain. It does not need a fitted offset.

## Observed result

The isolated normal-login browser run passed: a parsed 201 preceded the failed
cleanup, the unchanged form replayed the original invoice, and only then a newly
opened identical form produced a fresh key and a different invoice/reference.
The requests were byte-identical; the third response had no replay header.
Final read-only database capture contained two invoices, two linked financial
receipts and two distinct journals. Both references appeared once in the UI,
the final dialog closed, and no pending session key remained. Injected methods
were restored. No application code fix was necessary.
