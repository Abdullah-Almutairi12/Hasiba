---
name: Sales return cost policy
description: Historical sale cost, partial FIFO returns, foreign currency and legacy evidence boundaries
---
Restore a physical sales return at the recorded original base-currency issue cost, never the current product price or current FX rate. Within a multi-layer weighted FIFO issue, partial returns share that issue's recorded unit cost; across issue movements, allocate returns oldest first.

**Why:** A balanced return journal can still invent profit when purchase costs change. Choosing the original weighted issue cost is an explicit accounting policy, not a claim that a returned unit identifies an individual purchase batch.

**How to apply:** Keep movement valuation and COGS reversal based on the same evidenced sale cost. Reverse foreign commercial amounts at the original invoice posting rate; inventory costs are already in SAR, so do not convert them twice. Confirm GL inventory, movement value, quants, FIFO layers and profit together.

Allocate delivery quantity and cost to the individual invoice line when partial SO invoices are created. A return must use that invoice's allocation, not the oldest unused delivery across the SO line.

**Why:** Two deliveries at different costs can be invoiced separately. Returning the second invoice against the first delivery's cost balances the journal but misstates both inventory and profit.

**How to apply:** Reserve billing capacity per original issue movement, support several invoices sharing one movement, and preserve those allocations as audit evidence. Explicit invoice reversal can release billing capacity; a physical return alone cannot justify re-invoicing old delivered units without a new delivery.

Do not infer missing historical issue links or automatically repair old inventory/GL balances. A physical return without verifiable original issue evidence must fail explicitly; a commercial credit without restocking remains possible.

**Why:** The assigned financial scope explicitly excludes automatic historical corrections, and using today's cost would disguise missing evidence rather than solve it.

**How to apply:** Keep schema additions nullable for legacy rows, avoid cost backfills, and require a separately approved financial reconciliation for historical records. Issuance tests alone do not certify cancellation; later cash-refund FX treatment remains separate.

Cancellation is not a forced removal of the original return layer: reverse the exact original journal and recognize the difference between actual current depletion and originally restored value in COGS, in base currency. For standard-cost products, cancellation uses carrying value rather than a newly edited standard price; this is not a general standard-cost revaluation.

**Why:** Returned stock can be resold before cancellation, and replenishment may cost more or less. Removing historical value while consuming today's FIFO layers creates a hidden inventory/GL difference even when the reversal balances. A changed standard price can likewise invent a residual value.

**How to apply:** Require matching return-movement and original-journal evidence, keep historical FX for commercial reversal, and reconcile actual depletion, remaining inventory and profit atomically. Reject missing evidence or unavailable tracked stock instead of repairing history or borrowing another serial number.

Keep physical inventory costs at higher precision than journal cents. Allocate rounding remainders cumulatively across an invoice's active physical returns, subtracting amounts actually posted rather than rounding each new return independently.

**Why:** A weighted FIFO cost between 10 and 10.0001 can lose SAR 100 on two million units when stored at four decimals. Even an accurately stored unit cost can leave a cent after consecutive partial returns if each reversal rounds independently.

**How to apply:** Test large-quantity fractional-cost sales and both consecutive and one-shot full returns, including foreign currency and delivery allocations. Reconcile movements, quants, FIFO layers, GL and profit; raising precision must preserve existing recorded values, not reconstruct historical costs.

Cancellation must accept an explicitly evidenced cumulative cent allocation, not require every credit's journal to equal its independently rounded physical value. Preserve the cent belonging to remaining stock, and carry cancellation-only rounding into later returns separately from economic depletion differences.

**Why:** The second of two equal partial returns can legitimately receive one cent less than the first. Rejecting it by a half-cent physical-value comparison blocks a valid cancellation; rounding the removed slice alone can also move that cent away from remaining inventory.

**How to apply:** Check cancellation of both the first and second fractional slices, then re-return the released quantity through full restitution in SAR and foreign currency. Keep strict evidence checks for legacy notes without a recorded allocation; do not backfill them.
