# Sales-order agreed pricing and trusted partial invoice conversion

## Scope and source identity
Existing Hasiba project, repository `Abdullah-Almutairi12/Hasiba`, branch
`sync/hasiba-erp-20261023`. Both accepted `c9d314f` and later initial `1e5119a`
remain ancestors. No main replacement, production deployment, external payment,
email or production ZATCA submission is part of this delivery.

Final test source: `7df46faa9b7b92c408241ccdc2aaf5f6b959d125`.
Source SHA-256: `bfa356d14f38a0e9ef4bdf1df969791d429a40e980196e13b13ceedf400cf3b7`.

Final native browser source: `7df46faa9b7b92c408241ccdc2aaf5f6b959d125`.
Browser source SHA-256: `bfa356d14f38a0e9ef4bdf1df969791d429a40e980196e13b13ceedf400cf3b7`.
The final native run matches the final gate source. Its Git dirty flag reflects only
two draft Markdown reports, not executable differences. An intermediate accepted
run at `a37d12e` is retained separately. After fixing branch enforcement for legacy
review and prior approval reuse when NET/VAT changes at equal gross, the native
journey was repeated on the final source, not merely attributed to it.

## Implemented using existing services
- An additive nullable `pricing_basis` column, without automatic historical backfill,
  records agreed inclusivity, SAR currency, quantities, prices, discounts and evidenced
  price source. Later catalogue prices or company defaults do not silently reprice it.
- Gross commercial discount budgets are allocated cumulatively across partial
  quantities, leaving residual cents for the final portion. Named discount account
  allocations retain their marginal NET amounts rather than becoming manual discounts.
- The existing canonical VAT engine calculates and groups VAT for each actual invoice.
  It does not freeze the order estimate's VAT or pretend all partial invoices must
  reproduce the full-order VAT rounding. Final differences are disclosed.
- The server preview is bound to current source facts, remaining delivered quantities,
  tax context and totals. Issue requires explicit confirmation and rejects stale facts.
  The original identity, seller policy, issuer snapshot and attribution services remain.
- Source locks, the existing authority fence and durable financial-request mechanism
  protect quantity caps, execution, replay and safe closure. Replays retain the exact
  original key/body; withdrawn access is not treated as proof of non-execution.
- Current executor scope, applicable source approval and approver eligibility are
  checked during execution. Old approval cannot authorize changed financial tax facts,
  including a constant gross amount with a different NET/VAT split.
- Invoicing previously delivered goods allocates their existing historical issue cost.
  It does not issue stock again or create a parallel inventory/commission ledger.
- Unknown legacy price bases require an audited reason and existing account proof.
  Branch authorization is required in addition to valid identity proof. Historical
  totals are not silently rewritten.

## Executed acceptance evidence
Final source-bound project gates: **15/15 passed**, zero failed.
Full API suite: **1087 passed, zero failed, one intentionally skipped** upgrade-only
case. That case ran in the independent upgrade gate: **1 passed**, with 38 unrelated
cases deselected in the dedicated invocation. ERP UI suite: **337 passed**, zero
failed or skipped. These are final-source results, not historical release totals.

The focused isolated PostgreSQL suite passed **17 tests, zero failures, zero skips**.
It covers inclusive/exclusive prices, changed settings/catalogue prices, partial
allocation, grouped tiny-line rounding, named discounts, stale previews, original
approver withdrawal, source/tax changes, branch withdrawal, exact replay, distinct-key
concurrency, and execute/close races behind real PostgreSQL advisory-lock barriers.

The native original UI created an inclusive 3 x 115 SAR order, delivered all 3,
issued quantity 1, lost the first committed response, reloaded the frozen saved
quantity and seller, recovered the same invoice, and issued the remaining 2 after a
fresh confirmed preview. No direct API bypass was used for that browser journey.

Independent read-only reconciliation of the isolated database found:

| Evidence | Result |
| --- | --- |
| Saved invoices | 115 + 230 = 345 SAR |
| Output VAT | 15 + 30 = 45 SAR |
| Delivered / invoiced quantities | 3 / 3 |
| Physical and FIFO remaining | 17 units at cost 50 |
| Inventory carrying value and GL | 850 SAR |
| COGS | 150 SAR |
| Accounts receivable / NET sales | 345 / 300 SAR |
| Durable invoice receipts | 2; three requests were commit/drop, exact replay, remainder |

The final comprehensive gate result is the source-bound
`verification/summary.json` in the evidence bundle, not earlier release counts.
The historical independent upgrade gate exercises the pinned previous installation;
the ordinary suite's deliberately skipped upgrade-only case must not be confused
with an unexecuted upgrade acceptance test.

## Failures reproduced and corrected
The first browser attempt completed ordinary partial invoicing, but the injector
looked for the invoice at the wrong receipt location and did not drop a response.
It is explicitly **not** lost-response acceptance evidence. Its artifacts are retained.
The corrected injector proved a durable invoice commit before returning the fault;
the repeated native flow and independent reconciliation then passed.

An unconditional recovery warning was corrected to require an actual saved attempt.
After reload, the dialog now shows its saved quantity instead of today's remaining
quantity and does not require reselecting a seller for replay.

Two focused red-before-fix tests reproduced real authorization/approval defects:
legacy basis review accepted valid identity proof outside the branch scope, and
inclusive gross totals could remain constant while an old NET/VAT approval was reused.
Both now reject without financial side effects.

One final-source browser startup failed externally with Browserbase/OpenInt HTTP503,
before private state read, login or ERP actions. A single bounded retry completed the
final-source journey. The startup failure is neither application-failure evidence
nor a successful browser test.

UTC default document dates were aligned with Riyadh policy dates. Synthetic test
fixtures were corrected to explicitly use FIFO when asserting FIFO layers and to
populate required responsibility columns; no existing company's costing method was
changed. The additive migration was added to the exact historical upgrade expectation,
without deleting existing preservation assertions or weakening financial checks.

Evidence packaging initially assumed every gate had a shell stdout log. The final
source-unchanged check is an in-process comparison recorded in the raw JSON summary;
its actual record is now included, without inventing a shell log or changing a gate.

The additive nullable migration `0070_sales_order_pricing_basis.sql` passed fresh
installation and the historical independent upgrade. The normal development API
startup applied that additive migration when restored; it did not backfill legacy
agreements. Financial tests and browser journeys used separate PostgreSQL databases,
not write tests against the normal development data. No production migration ran.

## Limits and deliberately blocked cases
`TAX_POLICY_NOT_READY` remains in place for general activation. This is not general
tax-phase, live ZATCA, production device/payment, return or reporting acceptance.
Only SAR conversion is supported here. Unknown partly billed legacy bases, legacy
named discounts without allocations, and deliveries with different tax treatments
remain blocked rather than guessed. Advances, continuous contracts and special
government cases are not established acceptance for this ordinary delivered-goods
path. A recorded delivery date is not independent proof of physical dispatch.

Changed approval facts block issue pending a documented review; preview confirmation
is not a replacement approval or an exception. No broader approval bypass is added.
Paper printing, payment devices and invoice-PDF download were not tested here.
The browser's nonblocking dialog-description warning is recorded, not hidden.

Official ZATCA VAT regulation/e-commerce guidance extracts, URLs and review date are
in `official-tax-references.json`. Reading those relevant extracts is not a claim to
have validated every special tax case or completed authority certification.

The invoice editor 2A/2B was delivered previously; stale instructions to start it
were identified as historical, not restarted. Original requirement identifiers remain.
No follow-on implementation scope is started automatically.

The final delivery record identifies the actual pushed commit separately from the
tested source. Generated evidence is Git-ignored and is delivered as a real download,
not described as already synchronized into GitHub. This report does not claim the
whole ERP is free of defects.
