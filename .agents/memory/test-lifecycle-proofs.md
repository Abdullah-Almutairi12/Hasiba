---
name: Isolated test lifecycle evidence
description: Baseline timing and real listener checks when restarting synthetic application hosts.
---

Capture reconciliation baselines after all application initializers and fixture
setup have completed. If a synthetic host must restart later, separately prove
any initialization-only additions while comparing every original row exactly.

**Why:** Restarting an application after creating new synthetic tenants can add
empty fiscal metadata before the first tested business action. A whole-table
hash then changes without an import posting anything. Ignoring the table would
weaken the proof; reconstructing the original-row hash preserves it.

**How to apply:** Retain the initial mismatch, identify additions by ownership
and timestamps, compare original counts/hashes and disclose initialization
effects separately from tested business writes. Never label an unexplained
delta harmless.

Allocate an available loopback port for isolated transport targets rather than
guessing a neighboring port; check both listener errors and a real app response.

**Why:** Managed artifact services can already occupy adjacent ports. Express
listen callbacks may receive an error; ignoring that argument can falsely
announce readiness while requests reach another service.

**How to apply:** Use ephemeral internal target ports, keep the configured
preview proxy port stable, and verify the intended service before testing.

A guessed internal target can be the managed preview gateway itself, producing
recursive forwarding and431/502 rather than reaching the intended test app.
Preserve that as infrastructure evidence, not an application-login failure.

Use a supervised, bounded background task for browser fault controllers; do not
assume a shell child launched with `&` by the browser tester stays alive.

**Why:** A tester shell returned after starting a release controller, but its
child terminated before observing the held response. The application correctly
timed out; the intended automatic-release evidence was therefore incomplete.

**How to apply:** Verify controller liveness before arming. If it dies, retain
its incomplete receipt, capture actual read-only state, release explicitly and
record the real timeout/retry path instead of inventing the planned timing.
