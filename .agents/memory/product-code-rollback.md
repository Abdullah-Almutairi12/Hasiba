---
name: Product code rollback policy
description: Operational rollback limits after independent companies legitimately reuse product SKUs
---

Never restore global base-product SKU uniqueness by force, automatic code
prefixes, renaming or deletion after companies have legitimately reused a code.
Keep variant-code policy separate until explicitly scoped.

**Why:** The product owner requires independent companies to retain their
agreed literal codes and historical references. A code rollback must not turn
legitimate company-local data into a conflict or silently rewrite identities.

**How to apply:** Before any future down migration or rollback, inspect actual
cross-company reuse and require a separately approved, audited data policy if
the intended database constraint is incompatible. A Git checkpoint alone does
not authorize changing existing catalogue data.
