---
name: Stocktake variance cutoff
description: Do not delegate variance approval merely because count observations are serialized
---
New delegated stocktake variance approval must remain unavailable until an explicit
movement cutoff or reconciliation policy is proven. Counting and financial
variance approval are different authorities.

**Why:** Applying counted quantity minus an opening snapshot to today's quantity
can double-count an intervening sale or receipt. Two overlapping counts of one
warehouse can have the same problem. Serializing edits within one count does not
prove that its eventual adjustment is correct.

**How to apply:** When extending inventory permissions or completing stocktake
cycles, choose and test a freeze/cutoff or movement reconciliation policy. Include
sales and receipts after the snapshot and overlapping warehouse counts. Do not
silently grant variance approval with a count permission or replace the existing
financial engine without separate evidence.

A narrow guard that blocks newly delegated movements during an open count is
not evidence of a global stocktake cutoff.

**Why:** Legacy sales, receipts and other writers can still move stock during a
count. Serializing a count opening with selected new movement types does not
reconcile those other writers or authorize variance approval.

**How to apply:** Preserve that guard, but keep delegated count creation/variance
closure and unsupported adjustments unavailable until the complete movement and
overlapping-count policy is proven. Do not expand its acceptance claim.
