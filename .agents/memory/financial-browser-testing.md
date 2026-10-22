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
