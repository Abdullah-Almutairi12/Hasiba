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
