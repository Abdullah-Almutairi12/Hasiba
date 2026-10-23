---
name: Product direction and POS requirements
description: User-stated product scope and the distinct retail and food-service experiences
---
The product is intended to combine cashier operations, branch connectivity and flexible ERP functions for employees and administration. Scope includes HR, finance, procurement, CRM and reporting rather than a cashier-only product.

**Why:** The user explicitly described this business direction on 2026-10-23. A feature's presence in a prototype is not evidence of completed operational support.

**How to apply:** Configure modules, roles and activity templates without weakening financial integrity or tenant isolation. Initial setup should select retail versus restaurants/cafés. Retail should provide a barcode-driven cart table; food service should provide main category tiles opening subcategories and products. Show payment-method choices next to the checkout button instead of requiring a fullscreen selection step. Plan for customer displays, supported payment terminals and attendance devices, with real-device acceptance tests before claiming support.

The unified enterprise scope must use one requirements register and bounded batches, not automatically produce more tasks after each repair. Keep legal companies distinct from branches; headquarters is an oversight scope, not evidence that branches are independent legal entities. Begin Saudi-specific support first and never claim another country's compliance without tests.

**Why:** The user explicitly constrained the development scope and delivery process in the enterprise requirements attachment on 2026-10-23.

**How to apply:** Track the original scope and evidence in `docs/enterprise-requirements-ar.md`. Preserve history when grouping overlapping work; do not automatically reopen archived tasks or generate two follow-up tasks after each batch. Distinguish actual payroll disbursement from approval; AI must not determine disciplinary penalties. Track seller separately from cashier, configurable as hidden/optional/required and attributed per invoice or line, including commissions and return effects. Government/customer supply-contract references are manual in this stage; do not add an Etimad integration. Obtain permission before production changes, real payments or external sends.
