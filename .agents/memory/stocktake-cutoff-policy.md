---
name: Stocktake variance cutoff
description: Do not delegate variance approval merely because count observations are serialized
---
Delegated stocktake variance approval requires separate evidence from counting.
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
count-point evidence for legacy observations. The movement decision alone does
not authorize delegated approval, tracked/variant counts or a global ERP claim.
For the later explicit approval-independence policy, see
`stocktake-approval-separation.md`.

### Financial approval while movements remain allowed

An approval fingerprint must bind the actual cost allocation of the variance,
not unrelated remaining layer balances or current on-hand alone. A later
same-cost movement may still reconcile without another approval; a changed
FIFO allocation cost at unchanged quantity/average must require renewed approval.

**Why:** The approved moving-count policy deliberately separates the observed
variance from later movements. Including all current layer balances invalidates
legitimate same-cost movement; checking only the mean misses heterogeneous FIFO.

**How to apply:** Preview and posting must share native cost allocation and
gross financial limits. Never repair missing historical layer evidence as a
side effect of counting or approval.
