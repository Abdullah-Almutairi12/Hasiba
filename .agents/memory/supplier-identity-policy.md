---
name: Supplier identity and rollback
description: Legitimate company-local VAT reuse, missing evidence and no name-based VAT replacement.
---

Independent companies may record the same supplier VAT as separate records,
balances and histories. Never force global uniqueness back by renaming,
prefixing, deleting or merging those records.

**Why:** The user explicitly requires company-local supplier identity and preservation
of each company's financial evidence; legitimate reuse makes a forced global
downgrade destructive.

**How to apply:** Preserve references and the forward composite constraint. Review
rollback as a data-policy decision, not an automatic schema reversal. A similar
name alone never authorizes replacing an existing supplier VAT. Missing VAT is
missing evidence, not proof of unregistered tax status.

Supplier import review must include invalid source records and their original
record numbers, separately from the records eligible for insertion. Similar-name
consent remains revocable until sending; restoring it requires a compatible new
review. A sent unknown attempt is not cancelled by changing local consent.

**Why:** The user explicitly requires informed review of the original file.
Omitting invalid records or renumbering only valid ones makes errors and matches
misleading; local controls cannot prove a transaction was not already committed.

**How to apply:** Keep source-row evidence aligned across values/errors/matches,
block whole-batch persistence on any error, and retain original sent intent
identity through recovery or authoritative closure.
