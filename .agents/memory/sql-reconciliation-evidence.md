---
name: Exact SQL reconciliation evidence
description: Preserve decimal representations when independently reconciling PostgreSQL financial and catalogue evidence
---

For exact decimal comparisons, read numeric columns as SQL `::text`; do not
compare string expectations directly against numbers returned inside JSONB.

**Why:** PostgreSQL `to_jsonb` numeric fields can arrive as JavaScript numbers,
so an exact saved decimal such as `12.30` appears as `12.3`. A strict string
comparison then reports a false application defect, and large values can also
lose precision in JavaScript.

**How to apply:** Keep row-hash reconciliation for unchanged tables, but use a
separate read-only typed query for exact price, cost and quantity assertions.
Validate the real schema before writing diagnostic receipt queries. Treat a
failed diagnostic representation comparison separately from a transactional bug.
