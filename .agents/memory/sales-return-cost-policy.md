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

**How to apply:** Keep schema additions nullable for legacy rows, avoid cost backfills, and require a separately approved financial reconciliation for historical records. Issuance tests do not certify credit-note cancellation or later cash-refund FX treatment.
