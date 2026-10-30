---
name: Financial browser fault injection
description: Verify a genuinely lost committed response through the preview proxy without relying on browser request routing
---

## Browser notebook loss is not an application reload

An expired testing notebook can create a new browser context and lose cookies/sessionStorage. Do not call this a reload or recovery of the original saved financial intent.

**Why:** A committed invoice survived in PostgreSQL after its response was dropped, but the automation context expired before native recovery. A server receipt proved the commit, not the missing browser journey.

**How to apply:** Keep the disposable database alive, preserve the partial run separately, and inspect receipts read-only. Never reconstruct an original financial body, silently replace its key, or delete an unresolved intent to continue. Start a fresh coherent isolated acceptance fixture when the original browser state cannot be recovered.

## Bind browser proof to the loaded runtime

A clean working-tree fingerprint and passing gates do not prove a long-running browser server loaded that build.

**Why:** A native invoice captured new metadata while its receipt route still used an older in-memory bundle. The final source and direct rendering tests were correct, but those first browser PDFs were not final-source evidence.

**How to apply:** After the coherent source batch, restart the relevant test service from the verified build before native acceptance. Bind its loaded artifact digest to the source receipt. Preserve stale-run results separately; reprint the same confirmed documents, without creating replacement sales, then reconcile.

## A completed verifier does not refresh every retained artifact

Select evidence belonging to the actual run and source; do not relabel every file in a shared output directory as freshly executed.

**Why:** A fully passing verification left unrelated earlier browser/security reports beside its new gate logs. Copying the whole directory into a new acceptance archive would silently mix sources and dates.

**How to apply:** Bind gate outputs to the recorded source and run boundary, preserve prior evidence explicitly as historical, and verify native artifacts separately. If a gate emits only a text log, derive its totals from that raw log rather than assuming an adjacent machine-readable report exists.

An interrupted verifier without a persisted exit record is incomplete evidence,
not an application failure. Preserve its outputs before a replacement run.

**Why:** A stopped run retained six successful stages beside a prior run's final
summary; neither its termination cause nor an overall result could be established.

**How to apply:** Capture start/source/end/exit status with an external supervisor,
use a fresh output directory, and wait for actual completion. Do not claim stage
resumption unless the verifier implements it, or rerun again after a successful closure.

## Evidence database lifetime

Keep the isolated browser database alive until independent financial reconciliation has been captured, then stop it explicitly.

**Why:** A fixed fixture timeout previously removed the synthetic database after UI evidence but before SQL reconciliation. Screenshots alone cannot replace that missing evidence.

**How to apply:** Check the fixture lifetime before long multi-actor journeys; arrange an explicit monitored stop and cleanup rather than depending on a short expiry. Never fall back to customer data to recover missing test evidence.
Keep the full PDF-heavy verification run separate from deliberate service
rebuilds and additional preview/browser workloads on the shared workspace.

**Why:** A Chromium launch exceeded its existing 20-second limit during a full
run that overlapped service restarts/builds and a screenshot. Contention is a
plausible contributor, not proven to be the sole cause; the failed gate remains
a failure even when all financial assertions outside that launch passed.

**How to apply:** Preserve the failed evidence, avoid overlapping those extra
workloads in the next run, and do not raise timeouts or skip native-PDF tests
just to report success.

Use disposable test infrastructure for committed-response-loss checks, not a production fault endpoint or an authentication bypass. Confirm the upstream success and committed database state before dropping the response, then compare the real browser retry's key, body digest, replay header, and document identity.

**Why:** The browser testing environment did not expose request routing. Destroying the test proxy's response socket surfaced as HTTP 502 through the shared preview proxy rather than a raw browser network error. A generic failed request alone does not prove that the original transaction committed.

**How to apply:** Keep application data out of fault tests. Treat a proxy-generated 502 as a valid lost-success simulation only when independent upstream evidence proves commit before the cut. Verify visible list freshness and persistence separately from transport replay evidence; restore the normal API workflow after shutting down the test proxy.

Do not assume stopping a background test task executes its JavaScript cleanup.

**Why:** Stopping the disposable runner through the background-task stop action terminated its processes but left the temporary database directory and synthetic credential state on disk.

**How to apply:** Prefer graceful termination of the runner and verify disposal afterwards. If interrupted forcibly, remove only the positively identified disposable cluster and synthetic state; never infer that a database is disposable from the inherited application environment.

For no-send checks, collect request-arrival evidence as well as database state;
an empty successful-response event log is not sufficient.

**Why:** An outgoing invoice request can fail or remain in flight without ever
producing a successful response event or a committed invoice. That would falsely
pass a test intended to prove the browser never sent financial data.

**How to apply:** Pair a browser outgoing-request counter with a proxy ingress
counter and unchanged disposable invoice/financial-receipt counts. Scope storage
fault injection to the test tab and restore the original methods in `finally`.

A no-send storage test must prove it reached the intended financial operation,
not merely a form-validation failure. Verify the rejected storage key against
the complete intended payload, including source-line links and zero tax.

**Why:** There is intentionally no outgoing request body to inspect in a
successful no-send test. An arbitrary blocked key and empty database do not
prove the completed linked-return form exercised the intended submission.

**How to apply:** Compare the captured attempted key's digest with the expected
endpoint and payload, alongside actual before/after rendered fields and the
specific storage-safety message.

Observe storage-read failures without triggering the fault from the evidence
collector itself. Read stored entries through the saved original getter and
separately observe writes without blocking them.

**Why:** Enumerating entries through an injected getter can inflate the rejected
read count or interrupt cleanup. A write-failure test does not establish that a
failed read prevents key replacement and request transmission.

**How to apply:** Scope the exception to financial keys in the test tab's session
storage; require the exact rejected operation fingerprint, zero attempted
financial writes, restored method identities and a successful storage probe.

For reload recovery checks, discard the form, query cache, and transport module's
in-memory state while preserving the tab's session storage. Do not treat retrying
in a mounted dialog as evidence of reload safety.

**Why:** An in-memory intent map can make retries pass even when the persisted key
cannot recover an uncertain operation after a real reload.

**How to apply:** Verify the fresh transport instance, unchanged request body and
key, no automatic POST on remount, and a single list row after confirmation.

Install no-send observers at document start when verifying reloads. A wrapper
may register an init script without returning a removable handle.

**Why:** Installing fetch observation after navigation leaves automatic startup
requests unobserved; an unremoved init script can also leak into later tests.

**How to apply:** Record the observer's loading-state installation and new document
time origin, pair browser counters with proxy ingress, and use a one-shot,
self-disarming script if no removal handle exists. Restore methods in `finally`
and close the isolated test tab to discard its page-scoped registration.

For overlapping-save tests, do not equate request arrival order with original
transaction or response completion order.

**Why:** In a real double-click run, the request that arrived first received the
replay response. Scheduling can let the second arrival win the transaction,
and the replay response can finish first too.

**How to apply:** Prove overlap using ingress and response timestamps, then
identify original/replay by their headers, requiring exactly one of each with
the same key and document. Do not require the first arrival to be the original.

A replay can retain the original HTTP201 status. Make committed-response fault
injection one-shot per original intent, not conditional on status201 alone.

**Why:** A transport harness matched a successful replay as if it were another
new execution and dropped its response too, obscuring an otherwise correct
native recovery. That is a harness failure, not proof of a business duplicate.

**How to apply:** Pair the response with the durable receipt and replay evidence,
disarm the fault after its intended drop, and preserve unexpected harness errors
in the report instead of attributing them to the application.

Compare timing evidence only within its clock domain. Do not infer an offset
from response timestamps merely to make cross-process ordering assertions pass.

**Why:** The remote browser wall clock can lag the API proxy enough that a
received and parsed JSON response appears earlier than its server commit.
The clocks are independent; response matching still proves causality.

**How to apply:** Preserve raw timestamps. Order browser form/JSON/cleanup
observations using browser time and proxy event/database snapshots using proxy
time. Match key, body and document identity across the two evidence sources.

Wait for the current disposable runner's explicit fixture-readiness event,
not merely the existence of its credential-state file.

**Why:** An interrupted runner can leave the previous cluster's state file
behind. Reading it while the next runner initializes connected the browser
fixture helper to a stopped PostgreSQL port rather than the new clone.

**How to apply:** Match readiness to the current run before loading its private
state, keep those credentials out of reports, and verify the normal API is
restored after every disposable server is shut down.

Keep disposable financial fixtures alive until independent reconciliation of
that same database is finished, and take multi-table evidence in one read-only
consistent snapshot. Explicitly stop the fixture after evidence is saved.

**Why:** UI proof cannot replace reconciliation of the committed database.
Fixture expiry loses that evidence; separate reads can mix pre-commit and
post-commit states and falsely report a financial mismatch.

**How to apply:** Give the fixture an explicit evidence lifetime rather than
assuming a fixed browser timeout covers reconciliation, and use a repeatable
read-only snapshot for the stock, document and ledger comparison.

Native POS acceptance must include a branch-assigned cashier starting without
an open shift, not only fixtures with a shift already prepared.

**Why:** A working shift-creation service and successful checkout tests can
still hide a missing entry control for an existing account type.

**How to apply:** Exercise the original shift-opening control before checkout
for the affected legacy or responsibility-based account. Reuse the existing
safe shift intent and server authorization instead of creating shifts by API
to bypass a native UI blocker.

A successful replay after reload does not prove the initial submit-to-pending
transition worked.

**Why:** A native picker can be reparented by browser integration and crash
the client when it freezes, while the server commit and later replay remain valid.

**How to apply:** Observe both the initial unknown-result state and same-tab
recovery. Reproduce the observed DOM ownership condition, and keep the failed
native trace separate from acceptance evidence for the corrected source.
