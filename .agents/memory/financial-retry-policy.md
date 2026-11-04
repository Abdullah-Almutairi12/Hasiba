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

Releasing a confirmed closed intent must also restore its editable display snapshot,
not merely remove its key and assume the currently rendered basket is complete.

**Why:** A native POS recovery showed that identity initialization and restored-basket
effects can run in the same lifecycle cycle; the key and customer survived while a
later reset erased the visible items. Sealing the server intent alone did not recover
the cashier's work.

**How to apply:** Order scope resets before durable restoration, and return the original
basket/customer/name explicitly when confirmed nonexecution permits correction.

**Why:** The original request may still be delayed before its transaction lock.
Deleting local evidence after a read-only absence check lets that delayed request
commit after the employee starts a replacement, duplicating stock or money.

**How to apply:** Under the original identity's lock, recover an existing committed
result or record a permanent closure that later original requests cannot execute.
Recheck present source-read authority after waiting. A denial keeps the local
evidence; a completed result is recovery, not cancellation. A business rejection's
HTTP status alone is not a terminal nonexecution receipt.

## Current cashier work is not a branch activity report

An open shift returned for a branch is not automatically the current employee's shift. Clearing client caches cannot repair a server response that selects a peer's work.

**Why:** A native switch test showed the second employee's read-only permissions correctly enforced while the screen still identified the first cashier and shift. Identity separation must hold in read selection and fresh execution, not just button permissions.

**How to apply:** Keep current-device/current-cashier work separate from explicitly authorized branch-wide reporting. Never infer historical ownership from a cashier name or backfill unknown legacy ownership to make a test pass.

## Device revocation also applies to receipt recovery

Recovery does not exempt a revoked device from present authorization.

**Why:** Financial deduplication is not permission to keep using a revoked authentication context. Both protections must hold together.

**How to apply:** Deny the revoked context without deleting commit evidence; a currently authorized context of the original actor can recover the same result under source-read authority without executing again.

## Expiring quotes are not expiring financial outcomes

Freeze the original review token together with the exact financial body; never refresh its tax or price evidence while that intent is unresolved.

**Why:** A newly signed preview changes the request fingerprint even when its displayed amounts are unchanged. Reconstructing an uncertain request from the current cart can therefore strand its confirmed receipt or create a second sale under a replacement key.

**How to apply:** Recover the saved outcome before applying current quote expiry or changed prices to fresh execution. If no result exists, close under the original financial fence before preparing a newly reviewed intent. Durable storage must not include a manager's password; protected retries need explicit re-entry instead.

## Resuming a draft does not retire its attempt receipt

Keep the outcome evidence for a parked-order attempt after its draft has been resumed or removed.

**Why:** A late original request can arrive after resume. The missing draft is not proof that parking never succeeded; forgetting its receipt can recreate an already-consumed basket.

**How to apply:** Replays return the original saved outcome rather than creating another draft. Treat the draft's lifecycle separately from the attempt's evidence, and never clear an uncertain basket merely because a response was successful but lacked a matching saved identifier.

Claiming a draft also needs durable outcome evidence, even though the claim posts no money. Keep deliberate cancellation distinct from retrieval.

**Why:** A destructive read can transfer the only copy of a cashier's work. Losing its response loses the work just as surely as losing a financial commit response; sharing cancellation semantics makes recovery ambiguous.

**How to apply:** Apply the existing atomic receipt lifecycle to ownership handoffs, not just payment. Repeated delivery of one saved outcome is recovery; competing claims must not each acquire the source.

## A recovered basket has one final sale, not one sale per delivery

Bind a recovered draft to its source shift and allow at most one final sale for that source identity. Re-delivering the same claim is not a new authorization to collect payment.

**Why:** Two tabs can legitimately recover the same claim key, then create different checkout keys. Transport-level idempotency alone accepts both. Deduplicating by products or amounts would instead block legitimate independent sales.

**How to apply:** Preserve the source identity through recovery and checkout; serialize finalization by that source and return its original outcome under current read authority. A shift change must not turn the source basket into a new-shift sale. An intentional independent basket remains a separate sale even with identical items.

## A recovered draft is editable before payment, not after sending it

The cashier may change permitted items, quantities and customer, including removing the customer, after recovering a parked draft. Its original claim is historical handoff evidence, not an agreement freezing those working contents.

**Why:** The user requires the edited basket and customer to survive refresh. Restoring the original claim's contents can silently invoice the wrong quantity or customer; replacing an uncertain financial request with newer edits creates a different, unsafe retry.

**How to apply:** Keep the source identity and shift fixed while preserving the latest permitted working edits. Do not require the final customer or quantities to equal the original resume claim. Once payment is sent, the original financial request remains authoritative until its outcome is safely resolved, even if a newer local working copy exists.

## Local durability is not confirmation of the shared draft version

A newer server-confirmed working version must fence both stale edits and stale checkout under the same source serialization. Compare version and financial contents; guessing the latest version must not authorize older quantities or customer. An older tab must explicitly load and review the newer basket, never silently adopt it and collect payment.

**Why:** A single final sale per draft prevents duplicate sales, but still permits the wrong old tab to win first unless the latest confirmed edit is authoritative. The user explicitly distinguishes a locally saved edit from server confirmation.

**How to apply:** Keep the immutable resume identity and original financial request. Confirm editable contents separately before new checkout; retain unknown save/payment attempts exactly. If checkout won before a late edit, show the original outcome without changing the invoice.
