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
