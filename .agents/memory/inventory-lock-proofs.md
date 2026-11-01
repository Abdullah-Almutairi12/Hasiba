---
name: Inventory lock proofs
description: Why stock concurrency checks must include foreign-key compatibility and lock conversion, not only quantity lock order
---

Inventory lock-order acceptance must include native INSERT foreign-key checks
and subsequent metadata writes, not only advisory locks and quant UPDATEs.
Metadata protection should remain compatible with referencing rows where that
does not weaken ownership or active-state checks; all resource keys need one
deterministic order before conflicting product locks.

**Why:** A native inbound insertion may retain KEY SHARE on a product while
waiting for a quantity key. A quantity-first caller that then requests UPDATE
can still cycle against it. Conversely, two SHARE holders may deadlock when
both upgrade to write the product aggregate. Stocktake fence insertions also
participate in foreign-key locking, even before any adjustment is recorded.

**How to apply:** Use controlled PostgreSQL barriers and observed blocking
graphs in both start orders. Cover inbound inserts, close fences, variant
receipts and opposite warehouse operations; drain all promises and reconcile
the independent financial and stock facts. A separate failed valuation check
must stay failed rather than being counted as a successful lock test.

## Authority-writer barriers

Do not await a permission writer while retaining the resource blocker that an
already-authorized execution needs to finish.

**Why:** The database authority trigger correctly waits for the execution's shared
fence. A harness that holds the resource lock while awaiting that writer creates
its own cycle and can misdiagnose the authority protection as an application bug.

**How to apply:** Observe both PostgreSQL wait edges. For execution-first, release
the resource blocker before awaiting revocation; for writer-first, hold the writer
fence until the execution is visibly waiting. Drain promises and reconcile both
outcomes rather than bypassing the trigger or assuming revocation wins every race.
