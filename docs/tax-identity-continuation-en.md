# Dated legal-company tax identity — continuation delivery

> Closing update,31 October2026: the archive blocker documented below was
> resolved compatibly on2fdfe868. A new run passed15/15 gates,1123 API tests
> with one conditional case covered by independent upgrade, and349 UI tests,
> plus new native journeys/reconciliations. Current record:
> [meeting readiness](meeting-readiness-en.md). The sections below preserve the
> previous14/15 delivery, not the new run. General tax activation remains gated.

## Outcome
**The scoped tax functionality is verified. Overall completion is blocked by the
dependency-audit gate: 14/15 gates passed, final exit 1. This is not a 15/15 acceptance.**
No subordinate verification is left running. No main change or production release.

Repository: Abdullah-Almutairi12/Hasiba.
Branch: sync/hasiba-erp-20261023.
Previous c06f82d and its accepted sales-order agreement, discount, seller,
summary and document-editor work remain preserved; those features were not rebuilt.
Original requirement IDs remain unchanged: this extends 02.3–02.5,10.4–10.5,
12.2,14.2–14.6, without globally closing those requirements.

## Changes and permanent regression evidence
- Existing authority fence, company row lock and post-wait administrative and
  ownership checks protect the legacy company VAT writer. Once any dated policy
  exists, even a future first policy, that writer cannot change the frozen baseline.
  Company-targeted audit now commits atomically with the update.
- Workspace portal registration, company-list VAT and scoped settings legal identity
  read the effective policy through the original service. Branch settings inherit
  the legal-company identity rather than creating a separate registration.
- Generic tax preference writes/reset and company identity aliases are blocked
  after explicit adoption. Unmigrated legacy companies retain their existing path.
  Existing print/registration guards were reused, not replaced.
- The tax UI distinguishes the current effective revision from the newest saved
  future revision. Effective VAT refresh at the same print revision no longer
  leaves stale VAT in the form or overwrites unrelated unsaved name edits.

Four backend red regressions failed against the pre-fix handlers. Controlled
reversion of the two UI behaviours produced three failing cases and one passing
case. Targeted green results were 26 API and 4 UI tests; these are subsets, not
additional tests to add to the final totals.
Intermediate synthetic-fixture/type errors were corrected before the final source;
raw failures are retained, not silently counted as successful application checks.

A transient change introduced during this slice incorrectly inferred the authority
registration date from the policy revision effective date. A new assertion failed
(1 case,19 filtered) and passed after removing that inference. Existing recorded
registration evidence remains separate from policyEffectiveFrom. The earlier run
on7ead196 was deliberately stopped during API testing after six completed gates.
It has no final exit receipt and is preserved under interrupted-policy-date-review,
not reported as a completed acceptance.

## Actual final verification
API, native fixture and full verification source:
717027e3376a4dcdc3778bc73e89258cce4315cb

Executable fingerprint:
7cbb03c89bdfc9711cf354bbe7c2216137ff19f9eef64847eb56233010aa923a

Start:2026-10-31T06:47:47.735368Z.
End:2026-10-31T07:05:49.470149Z. Exit:1.
- Gates:14 passed,1 failed(dependency-audit),0 bypassed.
- API:1118 passed,0 failed,1 conditional upgrade skip.
- UI:349 passed,0 failed,0 skipped,64 files.
- Independent upgrade:1 passed,38 outside its name filter. This runs the upgrade
  case conditionally skipped in the general API invocation.
- Type checks, API/ERP/docs/deck/sandbox builds and source-unchanged gate passed.
- No historical 26f3bb5 acceptance was reused as a new result.

## Final native journey and independent reconciliation
Fresh browser context:2026-10-31T06:44:12.840Z–06:47:09Z, six screenshots.
Original /settings: login; current VAT; active revision1 versus future revision2
effective2099-01-01; both branch scopes inherit company settings; native publisher
disabled; changing only the print-profile VAT rejects409; reload restores the
original VAT. Authenticated /api/vat/status returned policyEffectiveFrom today
and vatRegistrationDate=null for the missing certificate date.
Tax editing is company-scoped; no independent branch tax screen was claimed.

Preview-origin Vite inline sourcesContent matched disk byte-for-byte:
35388 bytes, SHA256
c0cba0a94012a2948328acb27bf8b269c5cfc1eb329310ef04daaf07c312115e.
See browser-testing/final-717027e/report.md. An earlier browser run is retained
separately under first-native-a50dc03, not substituted for this final journey.

Independent read-only PostgreSQL capture compared all rows of nine financial,
inventory, invoice, issuer-snapshot and financial-receipt tables exactly.
Before/after digest:
5a167c351978c943667388ae18d8cf205066746107bc66f1ede2bcf6e4ee1d06.
Twenty average-cost units at50 retained inventory value1000 and inventory GL1000;
one nonempty historical issuer snapshot remained unchanged. No FIFO layers are
required for that average-cost fixture. The evidence helper's earlier incorrect
universal FIFO-layer assertion was corrected, not the product's valuation method.
This proves no setting-change financial effect, not a newly executed sales cycle.

## Outstanding audit blocker and rejected upgrade
Audit reported GHSA-g3hv-75wg-m249 / CVE-2026-118764: one moderate advisory in
two installed paths, minimatch3.1.5 and5.1.9 through exceljs4.4.0. No high/critical
findings in this audit; that is not a whole-system security guarantee.
No application exploit was demonstrated. Absence of the described method in the
old sources was not used to suppress the version-range advisory.
ExcelJS4.4.0 was still the latest parent release; no patched3/5 line was available.

An isolated compatibility experiment upgraded only the transitive dependency to
11.0.3, respecting the release-age policy. Audit became clean and the real ExcelJS
Arabic/decimal/date/formula XLSX round-trip passed. However, the actual legacy
glob7 consumer returned an empty file list instead of three expected files.
This could silently lose archive contents. The upgrade was rejected; manifest,
lockfile and frozen installation were restored exactly. The original executable
fingerprint and old dependency versions were reconfirmed; restored audit still
fails. No gate was weakened or waived.
The rejected experimental test source and raw results are retained in the ZIP;
they were not merged as a new product feature or hidden to manufacture acceptance.

Closure requires a compatible archive-consumer remediation, real file enumeration
and XLSX round-trip coverage, a clean audit, and the affected release checks.
There is no remaining demonstrated functional failure in the scoped tax slice,
but this unresolved audit prevents closing the whole assignment successfully.

## Limits, files and references
Core files: vat-policy.ts,scoped-app-settings.ts,companies.ts,team.ts,
company-settings-tab.tsx,company-tax-policy.tsx. Permanent coverage:
vat-policy-requests.test.ts,company-tax-policy.test.tsx,
settings-print-profile.test.tsx; isolated host:tax-identity-browser.ts.
No new DB migration, parallel tax/approval engine or parent-library replacement.
The erroneous transient vat.ts date change was removed; that file has no net
diff against c06f82d.

Service publication uses real account proof and explicit rights only in disposable
PostgreSQL. Live HTTP publication still returns TAX_POLICY_NOT_READY/503.
No live ZATCA acceptance, certificate verification, physical device or paper-print
acceptance, financial payment, external mail or production migration was performed.
Historical documents, prices and legal identities were not automatically migrated.
Other tax consumers, including procurement/quotations and remaining issuance,
returns and reports, remain outside this slice and block general activation.
No penetration test or whole-ERP clean-bill claim.

Official sources reviewed31October2026:
- Retail guideline§3.4: branches belong to the same taxable legal person:
  https://zatca.gov.sa/en/HelpCenter/guidelines/Documents/Guideline-For-Retail-Sector-under-VAT-Provisions.pdf
- VAT implementing regulations: authority registration/certificate and effective dates:
  https://zatca.gov.sa/en/RulesRegulations/Taxes/Documents/Implmenting%20Regulations%20of%20the%20VAT%20Law_EN.pdf
- Registration service:
  https://zatca.gov.sa/en/eServices/Pages/eServices-001.aspx

An application policy's effective date is a reviewed declaration, not proof of an
authority certificate date. Application no-backdating safeguards are evidence
protection, not a claim that the authority cannot approve an earlier legal date.

AR report:tax-identity-continuation-ar.md.
Raw/sanitized evidence:generated-artifacts/tax-identity-continuation.
Generated evidence is deliberately Git-ignored and delivered as an actual ZIP
with per-file SHA256 manifest. git-sync.json records the confirmed push at packaging;
the delivery message also identifies the final confirmed GitHub commit.
