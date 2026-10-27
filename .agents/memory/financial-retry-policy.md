---
name: Financial retry retention policy
description: Why financial retry receipts must not expire like an ordinary cache
---
Do not add age-based expiry or routine cleanup of financial retry receipts without an explicit product policy for late retries and reviewed financial reversals.

An authorization or session failure while recovering a result is not evidence that its earlier transaction rolled back. Retain the client's original request identity as well as the server receipt.

**Why:** Reading an already committed result may be refused after access is withdrawn. Generating a new key when access returns could duplicate a partial financial operation.

**How to apply:** Distinguish validation/conflict from unavailable recovery authority; keep company, user and source read checks, and never retry an uncertain operation with a new identity.

**Why:** A receipt is proof that a financial intent already committed, not a performance cache. Deleting it can make a delayed retry create a second invoice or journal entry. Matching payloads alone cannot replace it because users must be able to intentionally create two identical invoices.

**How to apply:** Review retention, user/company deletion, restore/import, and cleanup proposals for loss of replay protection. Keep company/user authorization separate from receipt lookup, and preserve the distinction between retrying an uncertain outcome and starting another legitimate intent.

Current monetary authority must cover a pending confirmation or approval, but a lower limit alone must not hide a result that already committed.

**Why:** A reserved refund or pending till difference can outlive the grant that originally allowed its creation. Conversely, treating a committed result as a new spend breaks recovery after policy changes.

**How to apply:** Under the authority and document locks, authorize access to the source, return an existing terminal result without new effects, then enforce the current amount limit before any new posting. Test both an excessive pending amount and replay after the limit is lowered.

Revoking POS execution must not prevent an authorized reader from recovering that actor's already committed sale. Recovery authority belongs to the original invoice's company, branch and issue warehouse, not the branch's current default warehouse.

**Why:** An execution-only route gate rejected an existing financial receipt after sell permission was withdrawn. Allowing any readable POS responsibility instead would disclose the receipt through an unrelated branch or warehouse.

**How to apply:** Separate committed-response recovery from fresh checkout under the live authority fence. Require current source read access before returning the saved result; retain strict sell, tender, discount, amount and time checks for new effects. Template edits replace grant identities, so an obsolete selector is not itself continuing authority.

Committed replays must not re-run one-use business authorizations or regress an issued document when approval policy changes. Current identity, tenant membership and endpoint permissions still run before any replay.

**Why:** An approval is normally consumed by successful checkout. Checking it before receipt lookup rejects a legitimate lost-response retry; resubmitting an issued credit note under new rules can reopen its state and risk a second posting.

**How to apply:** Keep consumable per-intent validation inside the idempotent transaction for new work. In multi-stage approval flows, consult persisted document state and use guarded transitions rather than relying on a draft snapshot.

After an uncertain result, a later authorization or validation denial does not prove that the original request failed to commit.

**Why:** Membership can be revoked or a shift can close after the first transaction committed but before its response reached the client. A later 403 or409 may occur before receipt lookup.

**How to apply:** Preserve the original body/key, authorization selector and reconciliation state after such a denial. A workspace/responsibility change may clear UI caches, but must not retry an uncertain write under a different branch's selector or erase its evidence. Only a confirmed outcome or explicit reconciliation can justify starting a new intent; do not automatically replace the key.

Treat confirmed server success followed by browser-key cleanup failure as a saved operation awaiting local confirmation, not as an unknown or failed financial write.

**Why:** Completing the dialog while its persisted key remains can make a later intentionally identical operation replay the old document. A generic storage exception also encourages users to repeat an already-committed write without understanding its state.

**How to apply:** Retain the current form and key, explain that the save succeeded, and require same-data recovery after storage is restored. Permit a new identical intent only after confirmation and key cleanup complete.

An open shift or a matching document in a branch does not confirm a particular saved financial intent.

**Why:** Multiple cashiers and devices can legitimately create similar operations in the same branch. Treating a peer's open shift as confirmation can erase another request's unresolved evidence.

**How to apply:** Resolve the exact saved key/body/authorization selector through its receipt or explicit reconciliation. Keep that recovery available even when another open shift appears.

## Closing an unexecuted intent needs a durable fence

An absence check is not sufficient permission to erase an uncertain intent.
Serialize with the original execution and persist terminal nonexecution before
allowing correction under a new identity. Never recycle the old identity.

**Why:** The original request may still be delayed before its transaction lock.
Deleting local evidence after a read-only absence check lets that delayed request
commit after the employee starts a replacement, duplicating stock or money.

**How to apply:** Under the original identity's lock, recover an existing committed
result or record a permanent closure that later original requests cannot execute.
Recheck present source-read authority after waiting. A denial keeps the local
evidence; a completed result is recovery, not cancellation.

## Current cashier work is not a branch activity report

An open shift returned for a branch is not automatically the current employee's shift. Clearing client caches cannot repair a server response that selects a peer's work.

**Why:** A native switch test showed the second employee's read-only permissions correctly enforced while the screen still identified the first cashier and shift. Identity separation must hold in read selection and fresh execution, not just button permissions.

**How to apply:** Keep current-device/current-cashier work separate from explicitly authorized branch-wide reporting. Never infer historical ownership from a cashier name or backfill unknown legacy ownership to make a test pass.

## Device revocation also applies to receipt recovery

Recovery does not exempt a revoked device from present authorization.

**Why:** Financial deduplication is not permission to keep using a revoked authentication context. Both protections must hold together.

**How to apply:** Deny the revoked context without deleting commit evidence; a currently authorized context of the original actor can recover the same result under source-read authority without executing again.
