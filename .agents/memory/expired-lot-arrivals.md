---
name: Expired lot arrival policy
description: Physical arrival is recorded without making expired stock usable or writing it off
---
Receive a dispatched lot even if it expires in transit, retaining lot identity,
expiry, quantity, historical cost and recipient evidence. Display an explicit
warning. Expired stock is never sellable, issuable, consumable or automatically
allocated and is excluded from usable quantity, but remains physical inventory.

**Why:** The user explicitly selected physical arrival with a real server-side
usage block on 2026-10-27, not a visual-only label or an automatic financial loss.

**How to apply:** Enforce at native stock outflow and availability projections,
not just delegated buttons. No expiry mutation, destruction or write-off as a
side effect of arrival. Returns and destruction require separate authority and
are outside this movement slice.
