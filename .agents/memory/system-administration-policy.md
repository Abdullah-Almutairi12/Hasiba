---
name: Company system administration
description: Explicit primary system owner versus limited administrators; company-local continuity and handover
---
The primary system owner is an explicitly subscriber-appointed account responsibility,
not legal ownership. This one primary role has full administrative and financial
operation access within the company's enabled modules, still subject to immutable
posting, approval separation and tenant isolation. Limited administrators retain
the five independent administrative duties and gain no implied financial access.

**Why:** The user superseded the previous administration-only model on 2026-10-25:
full primary-owner authority is now required, but legacy `owner` holders must not
be mass-promoted. Existing duties persist until an authorized explicit change.

**How to apply:** Distinguish appointing/removing administrators (no departure
consent required) from primary-owner transfer (activated replacement must accept
the exact version). Protect the live primary owner even when other administrators
exist; remove daily-work emphasis on departure and place membership choices in
account settings. Before each major journey, document official guidance from two
or three suitable competitors, separating documentation from actual product tests.

The authorized person who creates and configures a subscriber company may be a
branch manager, IT administrator or owner. Multiple independent administrative
accounts are allowed, with explicit responsibilities.

**Why:** The user explicitly approved this administrative model and rejected
requiring legal ownership. Administration must not implicitly grant financial
approval or access to another company's membership.

**How to apply:** Implement an accepted handover to an activated, eligible
replacement before the last active administrator leaves. Recheck eligibility
atomically against concurrent departures, cancelled invitations and revoked
replacement access. Company-local suspension or termination revokes only that
company's sessions, delegations and access methods, preserving history and other
memberships. Treat single-user operation, legal ownership and system
administration as three separate policies. Do not mass-replace `owner` labels
and assume the authority model has been migrated.

Receipt recovery is a separate credential purpose, never an operational login.
Existing memberships must not silently upgrade it, and it may recover a committed
result but must not initiate an uncommitted handover.

**Why:** The user's 2026-10-25 isolated reproduction showed that “identity only”
was not a security boundary when later middleware could infer a company. Checking
only the departed/no-membership case missed both data disclosure and new execution.

**How to apply:** Evaluate credential purpose before tenant selection, including
routes outside the usual company middleware. Regression cases must include no,
one and multiple memberships and the very first request without a warm-up.

Temporary suspension and terminated membership are different lifecycle decisions.
An authorized restoration may restore approved functional access after entitlement
and seat validation, but must not silently restore management or a terminated
membership.

**Why:** The user requires reversible suspension while preserving identity,
history and other memberships; treating a status toggle as restoration can either
report false success or revive broader historical authority.

**How to apply:** Require explicit departure evidence for restoring a missing
membership; ambiguous legacy states require verification rather than inference.
