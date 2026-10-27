---
name: Standard issue valuation
description: Accounting decision for existing stock when the standard price changes
---
Treat edits to the standard price prospectively. For ordinary sales/issues, realize the difference between the current standard and the source stock's carrying cost within net COGS; do not automatically revalue existing stock or introduce a separate variance account.

**Why:** A new standard price is not evidence of a posted inventory revaluation. Issuing at that price against historical receipt value can create negative remaining value or strand a GL balance on depletion. Net carrying-cost expense preserves both inventory and profit without rewriting history.

**How to apply:** Use the same carrying value for movement evidence, physical depletion and sale COGS, including caller-posted journals. Explicit receipt costs remain authoritative; a new standard supplies the default for future receipts. Ordinary issue callers cannot override valuation with a quoted cost. Return cancellation retains its separate existing policy; transfers and stocktake policy were deliberately excluded. Any future revaluation feature needs an explicit authorized journal and independent reconciliation, not a product-price edit or historical backfill. See docs/standard-issue-cost-policy-ar.md for examples.

For the separately authorized untracked-variant movement slice, a standard-cost
variant transfer carries the source quant's historical cost through transit and
arrival. A changed variant catalog cost applies to future default receipts,
with parent cost inherited only when the variant has no override.

**Why:** The user required the same variant quantity and cost at source, in
transit and at destination. Repricing a transfer from today's catalog would
change stock value without a corresponding inventory revaluation.

**How to apply:** Keep this addition limited to untracked variants; it does not
change the previously excluded ordinary-product transfer or stocktake policy.

Selecting a physical serial does not select its original purchase cost as the
accounting issue cost. Keep the company's existing FIFO/average/standard
valuation; a transfer retains the value resolved at dispatch through arrival.

**Why:** The user explicitly required serial movement integrity without changing
the approved valuation method or revaluing historical transactions.

**How to apply:** Test pieces purchased at different costs and issue a named
newer piece under FIFO. Reconcile native layers, aggregate carrying value and
GL separately from the physical serial's state. Do not introduce specific-
identification costing merely because a serial is selected.
