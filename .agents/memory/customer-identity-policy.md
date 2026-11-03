---
name: Customer identity is not supplier identity
description: Shared names, phones, emails and tax identifiers do not authorize merging customers.
---

Customers may be individuals or establishments. Shared names, phones, email
addresses or tax identifiers are review signals, not proof of a single identity
or grounds for global uniqueness, automatic updates, merging or historical
identity changes. Missing tax information is not evidence of tax registration
status. Imported customers must not replace the default cash customer.
The cash customer's identity is internal to each legal company: external
directory imports or manual tax-identifier input must not provision or
repurpose it. An ambiguous historical cash-identity collision requires
audited review, not automatic merging, deletion or invoice reassignment.

**Why:** The user explicitly distinguished customer identity from supplier VAT
identity and requires preservation of separate customer histories and POS use.
The user explicitly requires reserved cash-identity protection across import
and manual entry while preserving completed receipts and historical records.

**How to apply:** Review possible matches only within the active legal company,
keep the review consent revocable before sending, and require fresh review if
reviewed matches change. Directory authority does not grant invoice, credit,
collection or intercompany authority.
