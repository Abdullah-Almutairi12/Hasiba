---
name: Tenant authorization constraints
description: Security boundaries for global user identities and legacy integration/model state.
---

Tenant administrators may manage only the active company's membership role. They must not reset passwords, disable accounts, or change global profile fields when an identity also belongs to another company. Removing access must not delete that global identity.

**Why:** User identities are shared across companies, so company-local administrative authority cannot safely authorize global changes to shared accounts.

**How to apply:** Check both target membership and whether a requested field affects other companies; never use the global user role as the active company's authorization source.

Legacy branchless integration configurations have no provable tenant owner. Do not infer ownership or fall back to global secrets for branch-scoped operations.

**Why:** Assigning old global configuration to whichever company requests it would reintroduce cross-company credential and payment access.

**How to apply:** New configuration must resolve to an owned branch. Legacy branchless configuration must be explicitly assigned a verified owner before tenant routes may use it.

Previously shared AI training state must not seed a company's learned parameters; only model descriptions can be reused.

**Why:** Aggregate parameters and recommendations can disclose another company's sales and customer information even after the prediction queries themselves are scoped.

**How to apply:** Keep training state company-specific and start without legacy learned values. Preserve the public model keys when changing internal storage.

Unowned legacy bank accounts and saved reports must remain quarantined until ownership is verified; do not assign them using the first company or a shared user's memberships. Legacy fiscal controls must be copied conservatively, retaining closed states independently for each company.

**Why:** These records were previously global. Membership does not prove who owns historical financial data, and resetting closed fiscal controls to open would weaken posting restrictions.

**How to apply:** Preserve unknown ownership as inaccessible rather than guessing. For calendar migrations, preserve restrictions and reconnect each journal only to its own company's periods.
