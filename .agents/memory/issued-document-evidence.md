---
name: Issued document and seller evidence
description: Why legal issuer, employee seller, commission policy and retry metadata must not be reconstructed from current profiles.
---

Issued identity and the employee seller are historical evidence, not live presentation defaults. Missing historical identity or attribution must remain explicitly unknown; global settings, today's tenant profile, current cashier and the first available commission plan are not evidence.

**Why:** The product requires employee sellers without login, independent collectors, prospective profile/rate edits, and retention of approved or paid history. A valid retry can arrive after the original employee was renamed or suspended.

**How to apply:** Capture company and seller/policy evidence in the original financial transaction. Keep selected sellers in the saved retry body and fingerprint. Replay committed results rather than revalidating a new sale against today's eligibility. Corrections require permission, reason and before/after evidence; paid history needs append-only adjustments, not overwritten amounts. Never silently assign unowned historical commission plans to a company.

Old logo versions are retained evidence when issued documents still reference them.

**Why:** Replacing or deleting a mutable logo at the same object key would change a historical reprint without changing its saved issuer data.

**How to apply:** Use company-owned immutable object versions and retain referenced objects; do not clean them up simply because the current profile selects a different logo.

Do not infer a historical commission entitlement from an assignment that does not cover the legacy report period.

**Why:** Older per-user summaries lack invoice-time policy evidence; widening a partial-period assignment into a full-period rate manufactures historical authority. Explicit ownership alone does not prove temporal applicability.

**How to apply:** Keep the legacy calculation conservative and the new snapshot-based seller ledger separate. Use fixtures with genuinely applicable dates rather than relaxing ownership or period checks to make old expected amounts pass.

Historical reprint evidence must compare a freshly requested PDF's logical text and rendered pages, not require binary equality.

**Why:** Regenerated PDFs legitimately change creation/modification metadata. Conversely, a browser may reuse an already-generated preview blob, so identical downloaded bytes alone do not prove that the current server preserved history.

**How to apply:** Identify the actual print endpoint, obtain a fresh server response after the configuration change, compare text and page pixels, and reconcile financial evidence separately. Distinguish cached-browser evidence from fresh re-render evidence in acceptance reports.

Printer configuration is not tax registration. An unregistered company must be able to choose paper widths and save its profile without inventing a VAT number or commercial registration.

**Why:** Unconditional identity-field requirements blocked 58mm setup for an explicitly unregistered test company and encouraged fabricated identifiers.

**How to apply:** Use authoritative company registration status for conditional VAT validation; editing a number must not activate registration. Preserve original document evidence after any profile edit.

Invoice design is issuance evidence, not a reference to today's company or branch default.

**Why:** A later preset, logo or branch-inheritance edit must not change an already issued invoice. A reversal of a legacy document must not manufacture a historical design that was never captured.

**How to apply:** Retain the captured design schema and immutable asset references with the original transaction. Preserve the old renderer/assets when introducing a future schema version; do not silently reinterpret saved presets. Keep legacy reprints explicit rather than applying today's default retrospectively.

An agreed sales-order price basis is distinct from the legal tax treatment.

**Why:** The user requires agreed prices, inclusivity and discounts to survive catalogue/default changes, but explicitly does not authorize freezing VAT treatment forever or guessing an old agreement from today's settings.

**How to apply:** Preserve evidence of the commercial agreement and determine tax using evidenced supply facts. Round each actual invoice with the canonical calculator; disclose differences from an order's estimate. Unknown legacy agreements require explicit audited review, not automatic historical backfilling.

Partial discount totals and their named/manual sources must use a joint monotone cumulative allocation, not independently rounded quotas.

**Why:** Two valid one-halalah rule budgets can independently claim two halalahs in a portion whose total discount is zero. Reassigning the difference to manual discount changes financial attribution rather than fixing it.

**How to apply:** Preserve each full source budget, allocate only the cumulative total actually available, and retain allocation-method/source evidence at issuance. Do not retrospectively apply a new schedule to already-issued portions without evidence of their original source allocations.

Output retries and deliberate reprints are different logical requests.

**Why:** A lost response must not duplicate the audit event, but retaining the same identity after acknowledged success silently collapses a later intentional print into the first event. Neither event proves paper output.

**How to apply:** Retain the request identity until a successful body is acknowledged; release only that same identity after confirmation, and give the next deliberate request a new identity. Keep generation, print requests and export requests distinct, without introducing financial effects.
