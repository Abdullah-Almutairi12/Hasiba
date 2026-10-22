# Split receipt: repeated cleanup failures in one mounted dialog

This is an independent extension, not a replacement or relaxation of
`browser-repeated-receipt-cleanup.md`. Do not change application behavior.

1. Start `node scripts/test-isolated.mjs --browser --receipts --multi-receipts`.
   Only this fresh loopback database may be used. The optional flag seeds a
   second invoice for the same owner/customer without changing legacy fixtures.
   Stop the normal API workflow, keep ERP running, then start:
   ```
   pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/test/browser-retry-proxy.ts --receipts --pass-success
   ```
   Log in normally with the synthetic owner from `/tmp/hasba-browser-state.json`.
   Never include credentials in evidence. Use `receiptInvoices` in their given
   order (300 and 200 outstanding) and `customerName` from that synthetic state.
2. In `/sales` → سندات القبض → سند قبض choose that customer, cash (نقدي),
   amount 50, allocation **20 to the first invoice and 30 to the second**.
   Follow steps 3–7 of the original plan exactly: four sequential saves with
   tab-scoped financial `sessionStorage.removeItem` rejection; no reload,
   form edits, close/reopen or overlap; restore removal and probe; confirm
   recovery; then open a new identical dialog and submit once.
3. Use the original evidence contract except:
   - `invoiceReferences: [firstReference, secondReference]` replaces the single
     top-level invoice reference.
   - Each actual rendered `fields` snapshot is `{customerName, amount:"50",
     paymentMethod:"نقدي", allocations:[{invoiceReference:firstReference,
     amount:"20"},{invoiceReference:secondReference,amount:"30"}]}`.
   - Write browser evidence to ignored
     `generated-artifacts/verification/browser-multi-receipt-cleanup.json`.
   Preserve exact request bytes, all parsed 201 responses, replay headers,
   rejected removals, actual warnings, pending key entries, method identities,
   storage probes, list rows and document timing as in the original.
4. While the disposable proxy/database remain alive:
   ```
   pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/src/test/browser-retry-proxy.ts --receipts --pass-success --capture-receipts
   node scripts/check-browser-multi-receipt-cleanup.mjs
   node --test scripts/check-browser-multi-receipt-cleanup.test.mjs scripts/check-browser-repeated-receipt-cleanup.test.mjs scripts/check-browser-receipt-cleanup-success.test.mjs scripts/check-browser-reloaded-receipt-cleanup.test.mjs
   ```
   Exactly six POSTs: original, three failed-cleanup replays, recovery replay,
   fresh identical intent. The first five must preserve one receipt of 50,
   **two allocations (20/30)**, invoice paid amounts **20/30** (remaining
   **280/170**), the same journal and financial request. Recovery cleans the
   key and closes the dialog without changing either balance. Only the new
   intent creates another receipt/journal/financial request with a distinct
   key/ID/reference: four allocations total, invoice paid **40/60** (remaining
   **260/140**). Both references must appear once. Every intermediate database
   snapshot, not only final totals, is checked.
5. Restore fetch/removeItem in `finally`, close the isolated tab, gracefully
   SIGTERM the proxy and isolated runner, verify their temporary cluster and
   synthetic state were deleted, then restore the normal API workflow and
   check startup logs. Never adjust raw evidence or cross-process clocks.

## Observed result

The isolated normal-login browser run passed. Exactly six HTTP 201 receipt
responses were parsed in the same document: an original save, three successful
replays with cleanup still failing, a recovery replay with working storage,
and one fresh identical intent. Four removal failures retained the unchanged
rendered 20/30 split, pending key and actual saved-but-cleanup-failed warning.

All first five independent proxy database snapshots contained the same receipt
of 50, exactly two allocations of 20/30, paid balances of 20/30 (remaining
280/170), one unchanged journal and one linked financial request. Recovery
closed the dialog and cleared the pending key without adding an allocation or
changing a balance. The new dialog alone produced a fresh key, ID and reference,
four allocations total and paid balances of 40/60 (remaining 260/140), with two
journals, two linked financial requests and both receipt references visible
once. There were no invoice or return POSTs.

The live split evidence guard and all 341 tests across the four requested
guard suites passed; workspace type checking passed too. Both original method
identities and the storage probe passed. The isolated tab was closed, proxy and
runner exited gracefully with code 0, and deletion of the positively identified
temporary database cluster and synthetic credential state was verified before
restoring the normal API workflow. No application behavior or original
single-allocation test conditions were changed.
