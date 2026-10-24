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
