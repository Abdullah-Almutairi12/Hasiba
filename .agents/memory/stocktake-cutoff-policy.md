---
name: Stocktake variance cutoff
description: Do not delegate variance approval merely because count observations are serialized
---
New delegated stocktake variance approval remains unavailable in this slice.
Counting and financial variance approval are different authorities.

**Why:** Applying counted quantity minus an opening snapshot to today's quantity
can double-count an intervening sale or receipt. Two overlapping counts of one
warehouse can have the same problem. Serializing edits within one count does not
prove that its eventual adjustment is correct.

**How to apply:** When extending inventory permissions or completing stocktake
cycles, choose and test a freeze/cutoff or movement reconciliation policy. Include
sales and receipts after the snapshot and overlapping warehouse counts. Do not
silently grant variance approval with a count permission or replace the existing
financial engine without separate evidence.

The user explicitly chose continued stock movement with a documented per-product
count point, not a warehouse freeze. Do not restore the former narrow freeze on
delegated moves or impose a new operational freeze on existing companies.

**Why:** On 2026-10-26 the user selected this policy after being shown the two
options. A physical count interval must be explicit: capturing a cutoff only
after a cashier has counted/scanned a unit cannot establish when that unit
was physically observed.

**How to apply:** Establish the count point before physical counting. Require
recount if stock moves during the interval; reconcile subsequent movements
without applying them twice. A later completion, even with zero variance,
must invalidate older observations of the same product/location. Never invent
count-point evidence for legacy observations. This decision does not authorize
delegated variance approval, tracked/variant counts or a global ERP claim.
