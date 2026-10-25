---
name: Procurement authorization boundaries
description: Why a directory/order responsibility must not imply supplier finance or intercompany authority.
---

Supplier-directory access is not access to balances, invoices, payments or stock receipts. Supplier records belong to the company; do not invent branch ownership for them. A purchase order uses its evidenced warehouse branch.

**Why:** The user explicitly required separate actual actions and preservation of legacy access without implicit financial powers.

**How to apply:** Extend the existing responsibility/template system. Before enabling an order action, consider side effects on agreements, requisitions and intercompany mirrors; an order grant alone is not approval for those separate workflows.

A monetary cap cannot be bypassed by switching currency or supplying an exchange rate from the client. The initial restricted procurement slice deliberately permits SAR at rate1 only.

**Why:** No independently approved FX policy exists for this grant's ceiling; comparing raw foreign amounts or client-selected conversion would misrepresent the authorized limit.

**How to apply:** Keep other currencies explicitly blocked until an approved cap-currency/source-of-rate policy and separate tests replace that boundary. Do not silently infer conversion support from a currency selector.

Physical purchase receiving is independently assignable without purchase prices or supplier balances. Automatic stock/GR-IR posting does not grant manual accounting authority.

**Why:** The user explicitly requires a receiving employee to see item quantities, remaining amounts and destination without financial privileges, with explicit grants combinable independently of job title.

**How to apply:** Redact unauthorized financial fields on the server, not with zeros; preserve the original receiving/stock/accounting services and their segregation controls.
