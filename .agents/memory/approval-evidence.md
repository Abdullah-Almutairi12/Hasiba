---
name: Approval evidence
description: Historical approval decisions versus currently usable authority and source access
---
Treat an approval decision as historical evidence separately from its present authority to execute. Later invalidation must retain the original approved decision, decision time, policy definition and actions, with a subsequent invalidation/replacement trace.

**Why:** The approved product scope requires preserving financial and policy history while re-reviewing materially changed requests. Rewriting an old decision to make a new review possible destroys the evidence it is meant to protect.

**How to apply:** Keep previously committed financial evidence independent of current policy changes and retries. Do not mistake an intent/amount check on resubmission for complete binding of all source facts; source-edit/execution races need their own proof.

Assignment to a reviewer or temporary delegation does not grant access to the underlying module or branch.

**Why:** An explicit reviewer previously bypassed native branch constraints. Being named to review is not evidence of source access, especially for sensitive or shared identities.

**How to apply:** Check live company membership, module and native source scope before reviewer resolution in lists, detail, notifications and decisions. Configure legitimate cross-branch access explicitly rather than bypassing it through a delegation.

Use the native document header as the shared serialization boundary before reading or locking its approval request. Child writers need that same boundary; review readers must not add inverse child-row locks.

**Why:** Reading a previously pending request before waiting for the source can overwrite a concurrently committed decision. Request-first reviewers versus header-first writers can also deadlock.

**How to apply:** Preserve source-before-request ordering in submission, decisions, financial consumption, imports and database guards. Hash PostgreSQL's canonical fact text before parsing numbers in JavaScript: large decimal distinctions can disappear in a JS number. A published material-fact classification needs a new version when its meaning changes.

Bind retries to an independent decision and step, not just the request or reviewer.

**Why:** One person can legitimately be eligible for successive or parallel steps. A delayed retry of the earlier decision must not approve another step or repeat its financial effect.

**How to apply:** Keep the original step token and decision identity across ambiguous browser failures and polling. Replaying that identity returns the original result; choosing a new step must be explicit. Preserve the original decision even if its review later becomes unusable.

POS review scope and prices come from the persisted till and recalculated server quote, not optional browser branch/price fields. The till opener is not the creator of every subsequent checkout.

**Why:** An omitted branch can choose the wrong review matrix, and identical browser input can produce different financial facts after server prices or costing change. Treating a shift's creator as every sale's creator incorrectly excludes legitimate reviewers.

**How to apply:** Derive review branch from the owned session. Bind the basket and server-calculated prices/cost/tax context together, excluding generated IDs of rolled-back movements. Retain the cashier submitter as POS creator evidence; do not substitute the session opener.

Authority changes and delayed financial acceptance must serialize across the financial commit, including when a custom permission row does not yet exist. A conservative shared decision fence versus exclusive authority-writer fence was chosen while authorization spans legacy sources; it deliberately serializes authority edits across companies.

**Why:** Locks on existing membership rows cannot prevent a concurrent insert of a missing custom denial or limit. Checking a snapshot before entering the financial transaction also leaves a revocation race. Reading a document is not proof that its reviewer may approve it.

**How to apply:** Bring new authority sources into the same synchronization boundary before enabling them. Acquire the authority boundary before source/entity row locks. Per-company optimization requires the same absent-row, revocation-race and receipt-replay evidence; do not claim scalability from the conservative bridge or rewrite historical decisions to repair lost authority.

Live expiry checks must use the actual validation time after waiting for authorization locks, not the transaction's start time.

**Why:** PostgreSQL transaction time stays frozen while a transaction waits. A grant or invitation can expire during that wait yet still look valid against the older timestamp.

**How to apply:** Use the authoritative wall clock for execution-time grant/delegation/token validity. Keep that separate from historical document and decision timestamps, which must remain unchanged.

Deferred execution by a different employee must validate the original reviewer's grant independently of the executor's selected responsibility. Match the historical decision fingerprint against that reviewer's currently valid source-bound candidates; do not union their grants or borrow the receiver's context.

**Why:** Selection belongs to an authenticated request and actor. During independent goods receipt it is the receiver's selection, not proof of the approver's authority. Treating it as the approver's selection either rejects legitimate separation or silently grants the wrong scope.

**How to apply:** Bind the decision to the exact grant, profile revision, financial policy and native source. Revalidate under the authority fence before a new financial effect, retaining old decision evidence on revocation or source changes.

An explicitly configured sole-owner exception is not an independent approval. Identity confirmation must stay bound to its particular operation, purpose, source facts and current policy, never become reusable manager authority or extend to employees.

**Why:** The product's owner-operated workflow needs a transparent exception without falsely claiming separation of duties or weakening mandatory independent review elsewhere.

**How to apply:** Expose only actually supported exception operations and limits; keep their evidence visible after reload and in print. Preserve standard independent approval by default and reject unused confirmations after the policy, ownership or source changes.
