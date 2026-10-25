---
name: Credential evidence and historical exposure
description: Keep authentication challenge cleanup separate from financial evidence retention and from incident recovery claims.
---
Removing an unsafe authentication artifact from the live database does not revoke copies that may already exist in backups or an unauthorized reader's possession.

**Why:** A short employee PIN can remain guessable from an old fast verifier after the challenge expires or the live row is deleted, even when the primary credential uses a slow password hash.

**How to apply:** Distinguish prevention of new artifacts, scoped cleanup of ephemeral login challenges, and authorized incident response (restrict old copies and rotate affected credentials). Never erase financial retry receipts as part of login-challenge cleanup, or claim historical exposure is repaired by expiry alone. Do not rotate production credentials without the appropriate operational authorization.
