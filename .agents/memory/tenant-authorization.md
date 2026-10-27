---
name: Tenant authorization constraints
description: Security boundaries for global user identities and legacy integration/model state.
---

Tenant administrators may manage only the active company's membership role. They must not reset passwords, disable accounts, or change global profile fields when an identity also belongs to another company. Removing access must not delete that global identity.

**Why:** User identities are shared across companies, so company-local administrative authority cannot safely authorize global changes to shared accounts.

**How to apply:** Check both target membership and whether a requested field affects other companies; never use the global user role as the active company's authorization source.

Company ownership is not platform-wide authority. Managing another legal company requires an explicit owner membership there, and a tenant administrator cannot choose another shared user's default company on their behalf.

**Why:** The user's commercial execution plan explicitly separates the platform operator from customer data; the earlier company administration design treated one company's owner as a cross-tenant administrator.

**How to apply:** Keep target-company authorization on every administration API and list, not just in navigation. Preserve this rule when adding group/headquarters supervision: organizational proximity alone is not a membership grant.

Document directories must enforce live source scope before pagination and before fetching related delivery metadata, not only when a user opens a document.

**Why:** An invoice acceptance check proved that protected detail and PDF endpoints could coexist with a directory exposing another branch's invoice summaries.

**How to apply:** Compare list, detail, print and export scopes together. Preserve evidenced legacy source links, quarantine genuinely unknown scope, and do not open a previously blocked scoped route merely to simplify testing.

Missing company-specific print identity must not fall back to global legacy branding, even if this means omitting bank, logo, or legal profile details until ownership is established.

**Why:** A global configuration can describe another legal entity. A polished invoice with the wrong issuer or bank is worse than an explicitly incomplete profile.

**How to apply:** Apply the same ownership rule to browser prints, downloaded PDFs, and email attachments. Public generic manuals may remain unbranded; tenant financial documents may not borrow another issuer.

Legacy branchless integration configurations have no provable tenant owner. Do not infer ownership or fall back to global secrets for branch-scoped operations.

**Why:** Assigning old global configuration to whichever company requests it would reintroduce cross-company credential and payment access.

**How to apply:** New configuration must resolve to an owned branch. Legacy branchless configuration must be explicitly assigned a verified owner before tenant routes may use it.

Previously shared AI training state must not seed a company's learned parameters; only model descriptions can be reused.

**Why:** Aggregate parameters and recommendations can disclose another company's sales and customer information even after the prediction queries themselves are scoped.

**How to apply:** Keep training state company-specific and start without legacy learned values. Preserve the public model keys when changing internal storage.

Legacy access adoption must narrow into one live policy, never combine the old role's privileges with new responsibilities. Reversion to broader legacy access requires a fresh explicit review, and must not revive a suspended identity.

**Why:** The approved continuation requires reversible conversion without widening access, losing ownership, or erasing intervening restrictions; a stored historical role is not current authorization.

**How to apply:** Keep unsupported roles/custom legacy policies blocked from automatic conversion. End compatibility per resource only after its mapping, UI and scope/concurrency tests are complete; do not claim global unification from one pilot.

Quarantining an unowned policy must not turn a previously required approval or financial restriction into automatic approval or unlimited authority.

**Why:** The user explicitly required preserving legacy restrictions without guessing their company; merely excluding an unknown policy from a query can otherwise remove its protection.

**How to apply:** Require an authorized, audited company configuration when an unknown matching policy could restrict the operation. Preserve historical evidence rather than assigning it from a branch, user, or global role.

Unowned legacy bank accounts and saved reports must remain quarantined until ownership is verified; do not assign them using the first company or a shared user's memberships. Legacy fiscal controls must be copied conservatively, retaining closed states independently for each company.

**Why:** These records were previously global. Membership does not prove who owns historical financial data, and resetting closed fiscal controls to open would weaken posting restrictions.

**How to apply:** Preserve unknown ownership as inaccessible rather than guessing. For calendar migrations, preserve restrictions and reconnect each journal only to its own company's periods.

Historical HR records may carry a company stamp that disagrees with their employee or payroll parent. Treat inconsistent ownership as inaccessible rather than trusting either side alone.

**Why:** Earlier HR writes accepted foreign employee IDs while stamping the caller's company, and payroll computation included employees across companies. Existing rows can therefore remain inconsistent after the write paths are secured.

**How to apply:** Require agreement between child and parent ownership on sensitive reads and actions. Do not automatically reassign historical records to a company as part of an authorization fix.

Historical HR positions cannot be assigned a company from their department reference alone, including positions with a department.

**Why:** Position creation previously accepted arbitrary department IDs. A historical department link could itself have been supplied across tenants and is not evidence of the author's company.

**How to apply:** Keep unowned positions quarantined until explicitly verified; new positions must be stamped with the active company even when no department is selected.

An old approval matrix, request, or delegation does not gain verified ownership merely because it names a branch or a member. Preserve it without activating it for a tenant until independent ownership evidence exists.

**Why:** The earlier workflow accepted cross-company branch/user references and used global role pools. Those links can therefore be evidence of the original defect rather than evidence of the author's company.

**How to apply:** Stamp new approval records from the authenticated company; resolve roles and delegates from its active memberships. Require explicit tenant context at internal service boundaries too, rather than making it optional or inferring it from a looked-up request ID. Do not backfill old workflows from linked branches or whichever company first opens them.

Supply-chain and sales records with mixed-company references must be quarantined as a whole, rather than returning or acting on partially filtered documents. Legacy work centers and routings have no provable owner.

**Why:** Earlier procurement, inventory, manufacturing, and sales credit-note writes accepted foreign references. A foreign product and foreign warehouse can agree with each other while both disagree with the document's company. Trusting only a header stamp or silently omitting foreign children can both expose data and change the meaning of financial or stock operations. Historical routing/BoM links are not evidence of who authored a shared production resource.

**How to apply:** Require agreement across tenant-bearing relationships before reading or acting on a graph, including deferred issuance and cancellation. Compare inventory resources to the authorized document's company, not merely to each other. Apply the same quarantine rule to aggregates, replenishment decisions, allocation, and cached balances as to detail rows; hiding a row in one list is not sufficient. Keep unowned production resources inaccessible until explicitly assigned a verified owner; do not backfill from linked BoMs, operations, or the first active company.

During incremental authorization migration, newly managed staff must default-deny business routes until their resource is covered. Match actions and scope from one bound responsibility per request; never multiply permissions from one job by branches from another.

**Why:** A single company role cannot safely represent different duties in different branches. Assigning a broad legacy role to make a new page work would silently unlock unrelated modules. Preserving old roles is a compatibility bridge, not a security sign-off for every legacy handler.

**How to apply:** Add server policy, row/field scope, usable UI and direct API evidence before enabling another resource. A job title, optional starting template or full subscription is not an independent grant of authority.

Receiving custody of an already-dispatched internal transfer is distinct from issuing stock, revaluing it, approving count differences, or viewing costs. Scope the receiver to the destination, not administrative control of the source branch.

**Why:** Independent branch staff must be able to acknowledge goods without acquiring authority over the sending branch or choosing a new quantity or valuation. The issued movement supplies that evidence; physical receipt is not a new spending approval.

**How to apply:** Keep receipt as an explicit action on an existing movement with fixed source values. Manual receipts, issues, adjustments and stocktake approval still need their own authorization and valuation policies; do not enable a generic inventory-write privilege as a shortcut.
