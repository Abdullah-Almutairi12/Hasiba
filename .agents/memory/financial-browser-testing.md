---
name: Financial browser fault injection
description: Verify a genuinely lost committed response through the preview proxy without relying on browser request routing
---
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

For overlapping-save tests, do not equate request arrival order with original
transaction or response completion order.

**Why:** In a real double-click run, the request that arrived first received the
replay response. Scheduling can let the second arrival win the transaction,
and the replay response can finish first too.

**How to apply:** Prove overlap using ingress and response timestamps, then
identify original/replay by their headers, requiring exactly one of each with
the same key and document. Do not require the first arrival to be the original.

Compare timing evidence only within its clock domain. Do not infer an offset
from response timestamps merely to make cross-process ordering assertions pass.

**Why:** The remote browser wall clock can lag the API proxy enough that a
received and parsed JSON response appears earlier than its server commit.
The clocks are independent; response matching still proves causality.

**How to apply:** Preserve raw timestamps. Order browser form/JSON/cleanup
observations using browser time and proxy event/database snapshots using proxy
time. Match key, body and document identity across the two evidence sources.
