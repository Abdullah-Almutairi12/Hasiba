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

Physical purchase receiving is independently assignable without purchase prices or supplier balances. Automatic stock/GR-IR posting does not grant journal visibility or manual accounting authority.

**Why:** The user explicitly requires a receiving employee to see item quantities, remaining quantities and destination without financial privileges, with explicit grants combinable independently of job title.

**How to apply:** Redact unauthorized financial fields on the server, not with zeros; preserve the original receiving/stock/accounting services and their segregation controls.

Single-operator establishments are supported: separation of creator and receiver must be a configurable company policy, strict by default, not a permanent two-person requirement.

**Why:** The user identified that absolute separation prevents a legitimate one-person business from operating. This is not permission to infer exceptions from an owner title or employee count.

**How to apply:** Require explicitly enabled company policy, identity-confirmed settings authority, and a separate explicit self-receiving grant in addition to ordinary receiving scopes. Recheck under the authority fence; never relax purchase approval or make recovery of an already committed receipt execute again.

Advisory supplier-invoice comparisons are not binding review decisions or approvals; keep their grants distinct when extending the financial workflow.

**Why:** The user requires independently granted actual actions and no automatic expansion of an employee's authority. A read-only discrepancy preview must not silently become financial review power later.

**How to apply:** Reuse the responsibility system but require a separate explicit decision grant and source evidence before a comparison can be accepted as a workflow review.
