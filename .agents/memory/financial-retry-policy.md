---
name: Financial retry retention policy
description: Why financial retry receipts must not expire like an ordinary cache
---
Do not add age-based expiry or routine cleanup of financial retry receipts without an explicit product policy for late retries and reviewed financial reversals.

**Why:** A receipt is proof that a financial intent already committed, not a performance cache. Deleting it can make a delayed retry create a second invoice or journal entry. Matching payloads alone cannot replace it because users must be able to intentionally create two identical invoices.

**How to apply:** Review retention, user/company deletion, restore/import, and cleanup proposals for loss of replay protection. Keep company/user authorization separate from receipt lookup, and preserve the distinction between retrying an uncertain outcome and starting another legitimate intent.

Committed replays must not re-run one-use business authorizations or regress an issued document when approval policy changes. Current identity, tenant membership and endpoint permissions still run before any replay.

**Why:** An approval is normally consumed by successful checkout. Checking it before receipt lookup rejects a legitimate lost-response retry; resubmitting an issued credit note under new rules can reopen its state and risk a second posting.

**How to apply:** Keep consumable per-intent validation inside the idempotent transaction for new work. In multi-stage approval flows, consult persisted document state and use guarded transitions rather than relying on a draft snapshot.

Treat confirmed server success followed by browser-key cleanup failure as a saved operation awaiting local confirmation, not as an unknown or failed financial write.

**Why:** Completing the dialog while its persisted key remains can make a later intentionally identical operation replay the old document. A generic storage exception also encourages users to repeat an already-committed write without understanding its state.

**How to apply:** Retain the current form and key, explain that the save succeeded, and require same-data recovery after storage is restored. Permit a new identical intent only after confirmation and key cleanup complete.
