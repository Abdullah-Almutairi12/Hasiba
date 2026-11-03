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
