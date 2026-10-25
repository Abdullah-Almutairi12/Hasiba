---
name: Company system administration
description: Authorized administrators are not necessarily legal owners; handover must preserve company-specific access boundaries
---
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
