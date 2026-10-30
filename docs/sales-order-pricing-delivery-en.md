# Verification evidence closure — 30 October2026,20:02UTC

**Closed successfully within the two discount fixes and sales-summary scope only.**
No executable change, weakened test, production action, or new feature scope.

- The existing verifier has no stage-resume interface. Exactly one complete new run
  started at `2026-10-30T19:41:51.976935+00:00` and finished at
  `2026-10-30T20:02:28.402591+00:00`, with a recorded **exit code0**.
- Tested commit: `c5ced6a42a0478f6474e0022dfc8621264a61441`;
  executable SHA256:
  `27ed596634ac2be9a15909535d792419aa1614ed9deb7ce3479ab5a1b7d2aad5`.
  This matches accepted executable source`e9ca70a`. The working tree was clean
  before and after the run, and source-unchanged passed.
- Actual new results: **15/15 gates; API1110 passed,0 failed,1 skipped;
  UI342 passed,0 failed across62 files**. The API skip requires the separate
  upgrade fixture: that independent gate passed **1 test,0 failed,38 excluded
  by its selection**. Subsets and earlier runs are not added to these totals.
- Type checking, isolated-runner tests, existing invoice/receipt/return cleanup
  evidence tests, migration upgrade, API/UI suites, all five builds, dependency
  audit and source identity passed. Existing return-cleanup checks are mandatory
  project gates, not a new returns feature task. The dependency audit reported
  zero advisories; that is not a claim of whole-system security.
- The interrupted earlier run is preserved unchanged under
  `generated-artifacts/verification-closure/interrupted-mixed-output/`.
  Six stages completed, ending with upgrade around18:30UTC. No final exit code
  or termination timestamp exists. Its cause is **not established**, neither
  application failure nor environment failure. Its retained17:40 summary belongs
  to the older accepted`e9ca70a` run and is not its own result.
- New evidence is separate: `start.json`, `finish.json`, `runner.log` and
  `completed-output/` under`generated-artifacts/verification-closure/`.
  The supervisor preserved start/end/exit evidence and began with an empty result
  directory. A sanitized addendum ZIP with hashes supplements, not replaces,
  the previous acceptance package.
- Permanent discount/summary regressions reran in the complete suites.
  **No new browser journey or database reconciliation was run in this closure.**
  Those earlier acceptance artifacts below remain tied to`e9ca70a`, with the
  same executable hash; they are not relabelled as newly executed.
- No final established failure or acceptance blocker remains within this scope.
  `TAX_POLICY_NOT_READY`, safe legacy blocks and all documented device/paper/mobile
  and order-draft-preview limitations remain. No third scope starts automatically.

# Earlier round — close discount fixes; correct sales summary,30 October2026

## Scope and source identities
The two discount defects are closed within their evidenced scope, not rebuilt.
The additional run actually finished at2026-10-30T17:15:25.631Z with15/15 gates
on377049f and the same tested executable SHA256 as21ec97a:
60030c7a16ef11c24c09db94ed35d89753d9de2548fda7fb0fa79528bc9cbaf2.
Its32 targeted cases are included in1102 API cases, alongside337 UI cases,
not extra tests to add to later totals.

The sales-summary fix source is e9ca70a2766b5fa552a33e9a93469acf261b2414,
SHA25627ed596634ac2be9a15909535d792419aa1614ed9deb7ce3479ab5a1b7d2aad5.
Rollback tag:checkpoint/sales-summary-refresh-start-20261030 at377049f.
History is preserved; no main rewrite, force push, financial migration or new engine.
Changed executable/test files:sales.ts,sales.tsx,sales-summary.test.ts,
sales-summary-refresh.test.tsx and the existing isolated sales-order-browser.ts harness.
Existing requirements05.2,12.2–12.3,14.2–14.6 apply; the73 identifiers are unchanged.

## Metric contract
Monthly invoices are gross issued invoice face values, after discounts and including VAT,
for statuses open/partially_paid/paid within the Riyadh calendar month:
inclusive first day,exclusive first day of next month. This is not net revenue or cash.
The existing report permission covers the current company across all its branches;
this is not a new delegated branch report. Restricted responsibilities cannot read it.
An invoice table with other dates/statuses need not equal this metric.
Outstanding receivables span all periods, using the unchanged existing paid/credit-note
formula. No journal or historical document is recalculated.

## Established faults and limited repair
An acknowledged/recovered order invoice refreshed orders but not summary/invoice caches.
The regression retained114.67 although the source changed to344. Both confirmed-result
paths now invalidate the existing read models, never issue another financial POST.
Direct invoice creation also refreshes the summary; mounted summaries poll every60seconds.
The old month query counted draft/cancelled/next-month invoices and used server month
instead of the shared Riyadh business date. Isolated PostgreSQL proved3430 instead of350,
with individual status/future-month/business-clock regressions. Only read filters changed.
Unauthorized/restricted users no longer request/render report cards, and loading/failure
is distinct from an authoritative zero. Live server authorization remains intact.

## Evidence status
Before fix:UI0 passed/5 failed; API3 passed/5 failed.
After targeted repair:UI5/5,API8/8; API and ERP type checks passed.
These are subsets,not additions to final gate totals.
Initial synthetic fixture mistakes (missing foreign-company customer, assuming stock_moves
has company_id) and test-only TypeScript alias errors are retained as diagnostics,
not represented as production defects.
Final verification completed at2026-10-30T17:40:55.310Z on e9ca70a/SHA27ed5966 above:
15/15 gates;1110 API passed/0 failed/1 upgrade-environment-only skipped;
342 UI passed/0 failed. The independent upgrade gate passed its selected1 case,
with38 outside that gate's selection. Do not add selected/targeted runs to aggregate totals.
Accepted discount regression tests were rerun within the full API gate; no established
final failure remains in those two fixes or the summary-card scope.
The UI total is parsed from its raw erp-ui-tests.log; that gate does not emit JSON.
Shared verifier directories retain historical browser/security files; only source/time-bound
current outputs are packaged as fresh execution, with historical evidence labelled separately.
The Vite-served sales.tsx inline original source matches exactly:
52654a01dbe07065c65e220c5b2375d5fb1ade441f1d625249e1866f2b510429.

## Actual original-UI journey and independent reconciliation
A fresh synthetic PostgreSQL fixture and e9ca70a-loaded API were used. The order form
has no branch/warehouse selectors; the native branches page proved the unique active
branch/default warehouse used by this company. Separate API tests cover two companies
and two branches in the first company.
Native SO-2026-00001:3×115 VAT-inclusive,delivered once. The draft form displayed345
before automatic pricing; the existing server line rule1 made the saved agreement344.
This round does not establish a server-rule preview in the order-creation draft form.
The first quantity1 preview/normal issue was114.67:SINV-2026-00001.
Both monthly invoices and receivables refreshed to114.67 without reload,before invoice2.
Remaining quantity2 preview229.33:the proxy dropped its201 only after committed evidence.
The UI retained uncertainty; after reload,the original recovery returned SINV-2026-00002
with the same request key/body digest/document identity. After recovery and tab navigation,
summary344 and exactly two table invoices persisted. The post-reload server read may
already show344 before recovery; we do not attribute every refresh to the replay callback.

Independent read-only SQL passed:opening20 units at50,one delivery3,remaining17;
FIFO/carrying-stock GL850,COGS150,receivables344,VAT44.87,gross revenue account300,
discount-account debit0.87,net revenue299.13. Journals balance; no cash collection occurred.
Two invoices/two durable financial receipts; financial snapshots after dropped success
and its replay are identical. Scoped/month/status-matched summary API and SQL agree.
Existing seller selection and issuance identity remain intact.
Fifteen screenshots,UTC step report,source/proxy records and reconciliation are under
browser-testing/final-run. Historical346.98 belongs to five invoices in the prior
discount acceptance;344 is this new two-invoice fixture,not a hardcoded display target.
The test proxy was stopped and normal API restored:0 new migrations applied,72 skipped.
No remaining blocker in this slice; no third scope starts automatically.

## Reproduction and handoff
Run node scripts/test-isolated.mjs src/routes/sales-summary.test.ts,
pnpm --filter @workspace/erp-system exec vitest run src/pages/sales-summary-refresh.test.tsx,
then pnpm run verify. Native fixtures use --browser --pos --tax-preview --hold-browser;
the existing sales-order-browser.ts --summary-refresh proxy performs fault injection
and --capture performs independent reads. Pause/restore the normal API around isolated
browser work; never point these tools at operating data.
The bilingual Word report and actual ZIP include sanitized raw results and a SHA manifest.
delivery-state.json records the verified code/report push at packaging time;
later asset-registration-only commits are not a newly tested executable source.
Generated outputs are ignored by Git and delivered separately,not claimed present in GitHub.

## Boundaries
TAX_POLICY_NOT_READY and safe legacy evidence blocks remain. No historical rewrite,
returns expansion,other reports,ZATCA production integration,deployment,external sending,
payment or physical device acceptance. The invoice editor was previously delivered;
it is not a next phase to restart. No third scope starts automatically.
API/native writes use separate synthetic PostgreSQL only. The user's independently
reported41743 arithmetic cases are not tests executed by us or added to our counts.
The three-invoice penny-discount browser journey was not repeated this round;
its accepted historical evidence is retained and its permanent API regressions reran.
No separate native direct-invoice-form/device/paper/mobile acceptance is claimed.
This is not a claim that the entire ERP is defect-free.

---
## Historical discount delivery — retained; not the new summary-fix source

# Sales-order agreed pricing and trusted partial invoice conversion

## Two-regression fix delivery — 30 October 2026

Tested executable and native-browser source:
`21ec97a790e6f86453f611c565d00c2298d0aae5`

Source SHA-256:
`60030c7a16ef11c24c09db94ed35d89753d9de2548fda7fb0fa79528bc9cbaf2`

Actual starting HEAD was `ad3dbb34fbfd4cf5b60b4d6bd224a573c2a2f05f`, not an
assumption that remote `639c9a8` was the newest local work. Local safety tag:
`checkpoint/sales-order-discount-fixes-start-20261030`. Earlier deliveries remain
ancestors; no hard reset, force push or main replacement. Original 73 requirement
identifiers remain: this is detail under 05.2, 05.9, 08.4, 12.2 and 14.2–14.6.

### Implemented changes
- Migration `0071_sales_order_discount_precision.sql` widens **sales-order line**
  discount storage to `numeric(7,4)`, matching the existing engine. It neither
  recalculates old rows nor reconstructs a historical agreement.
- New agreement version2; input beyond four decimal places is rejected rather
  than silently rounded. Actual price, quantity and discount tampering still fails.
- Joint monotone cumulative cent allocation conserves the manual and each named
  source budget. No negative clamping, dropped rule or reassignment to manual.
  Issuance retains allocation-method/source evidence and uses the original tax
  calculator, posting services, approval authority and financial-attempt engine.
- Unbilled legacy version1 agreements need explicit identity-proved, reasoned,
  audited acknowledgement of the evidenced old two-decimal projection. All other
  source facts must match. Original rows and historical totals stay unchanged;
  the original invoice dialog exposes this route, not a parallel approval system.

### Newly executed evidence
- Final gates on the source above: **15/15**; API: **1102 passed,0 failed,1 upgrade-only
  case skipped in the ordinary run and executed separately**; UI: **337 passed,0 failed/skipped**.
- Before-fix: **8 expected failures**, plus a focused rerun of the four precision
  cases proving actual409 after PostgreSQL persistence/read-back. Not12 distinct cases.
- Final targeted suite: **32/32**, inclusive/exclusive, full/partial/fractional,
  stacked line rules, manual discount with multiple order rules, and independent
  reconciliation of two separate rule accounts plus the manual account.
  These are a subset, never added to the full-suite total.
- Dedicated historical upgrade:1 passed;38 unrelated cases deselected.
  The upgrade-only case skipped in ordinary API execution ran in this separate gate.
- Real PostgreSQL waiting barriers proved executor and original-approver revocation
  after queueing returns403 with no financial effect. Existing facts-change,
  concurrency, remaining-quantity and committed replay protections remain covered.
- Initial TypeScript errors and an additional synthetic account-fixture error
  (assuming a nonexistent column) are retained with their corrections. They are
  diagnostics, not unresolved final failures or customer-data defects.
  Full final counts come from the attached `acceptance-metrics.json` and
  `verification/summary.json`, not historical results or summed targeted runs.

### Original-UI journeys and independent reconciliation
1. Inclusive3×115, fixed line discount1: saved344 and effective percentage0.2899.
   Native delivery3, quantity1 invoice114.67, reply dropped only after a verified
   committed PostgreSQL receipt, reload and recovery of the SAME invoice, then
   remainder2 invoice229.33. No replacement intent or duplicate issuance.
2. Inclusive3×1 with two one-cent order rules: order2.98, native delivery3, then
   invoices0.99,1.00,0.99. Middle discount0, final one cent per named rule, manual0,
   no negative-money exception. The between-flow CLI only arranged synthetic rules;
   creation, delivery, previews and issuance used the original UI.
3. Separate read-only reconciliation:2 orders,5 unique invoices,6 success events
   including the first replay,5 issuance receipts,2 delivery issues only; stock14,
   FIFO700, COGS300, AR346.98, VAT45.26, discount-ledger0.89, no unbalanced journals.
   Browser/API source identities matched. Actual Vite module source-map content
   matched the frozen component, rather than assuming the browser used current code.
4. Normal API/frontend restored. Development migration only widened precision,
   without recalculating financial history. All business test writes used isolated
   PostgreSQL fixtures, not ordinary customer data.

### Precise limits and stop point
- **Both reported regression criteria are evidenced within the tested cases.**
  General `TAX_POLICY_NOT_READY` remains; no general tax rollout, returns,
  functional reporting expansion, production ZATCA, or invoice-editor restart.
- Legacy partly invoiced source allocations without issuance evidence stay blocked
  for audited reconciliation. No guessed historical allocation or rewritten invoice/GL.
- Legacy precision identity review was API-tested, not a separate native journey.
  Browser evidence is the two inclusive flows; exclusive/full/fractional/manual-plus-
  multiple-rule cases are PostgreSQL tests, not claims of physical-device journeys.
- Out-of-scope observation: the sales summary tile stayed114.67 while invoice rows
  and reconciliation totaled346.98. Metric semantics/cause were not investigated;
  this is an observed UI discrepancy, not proof of incorrect posting.
- No paper printing, payment, PDF or invoice-download acceptance in this round.
  No production deployment or external sending/payment. No next scope starts.
- Sanitized raw results, bilingual Word report and evidence ZIP are actual
  downloadable, Git-ignored outputs. The attached `delivery-state.json` records
  verified push identity separately from the tested executable source.

## Historical prior delivery — not current-run results
All identities, counts and browser diagnostics below this boundary are retained
historical evidence. They are not added to this run; prior downloadable assets
have not been overwritten.

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
