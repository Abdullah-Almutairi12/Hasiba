---
name: Warehouse alert adoption boundaries
description: Explicit adoption, legacy external-notification fallback and the non-procurement meaning of stock targets.
---

Warehouse low-stock alerts require explicit company-controlled adoption.
Do not automatically activate old companies or historic reorder rules.
Once a product adopts warehouse alerts, disabling those alerts must not
silently restore its old product-wide external low-stock notification path.

**Why:** This feature was authorized for internal alerts only. A disable action
is not consent to external delivery, and old global thresholds must not create
hidden side effects after the user has chosen the warehouse-scoped policy.

**How to apply:** Keep legacy/adopted paths mutually consistent; any future
return to external delivery needs an explicit policy decision, not clearing an
adoption marker as a convenience. Preserve historical cycles when disabling.

Minimum/target quantities describe physical warehouse stock, not an approved
procurement recommendation or stock availability after reservations/inbound.

**Why:** The user authorized warehouse-specific internal warnings, not supplier,
lead-time or purchasing decisions. High stock elsewhere must not hide a local
threshold breach.

**How to apply:** Label physical quantities and targets accurately; do not
infer automatic purchasing, external sends or tracked-parent aggregation.
