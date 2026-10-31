# Hasiba — meeting demonstration readiness and archive-audit closure

Delivery: 31 October 2026. Acceptance is limited to this slice, not commercial readiness of the whole ERP or production tax approval.

## Actual final result

- The preview, original login/pages and API work against a separate synthetic PostgreSQL database. Demonstration services intentionally remain running; no full verifier remains pending.
- New full run: **08:37:22–08:56:16 UTC**, **11:37:22–11:56:16 Riyadh**, exit **0**.
- **15/15 gates passed**, including type checks, all configured builds, dependency audit and source-unchanged.
- API: **1123 passed, 0 failed, 1 skipped out of1124**, across91 files. The conditional pinned-previous-installation upgrade test passed in the independent upgrade gate:1 passed and38 outside that gate's selection. These are not added to the API total.
- UI: **349 passed, 0 failed, 0 skipped**, across64 files.
- Final dependency audit reports **zero findings**, without advisory ignores or weakened gates. This does not establish absence of all application vulnerabilities.

Tested source: `2fdfe868cddb28fd7bfffa851d29687c79780c1b`, clean at start and finish.
Execution fingerprint: `ed75fffaabb13f778feac2605c17801ff240db1d85a6c1ccdd7afcde182309ad`.
This new run is separate from the26f3bb5 sales acceptance and the earlier717 run with its unresolved audit gate.

## Proven remediation

Official advisory: https://github.com/advisories/GHSA-g3hv-75wg-m249
It describes attacker-controlled glob-pattern amplification in firstPhasePreProcess at optimizationLevel>=2 and marks versions below11.0.1. Exploitability through a public application input, or applicability of those exact conditions to legacy3/5 consumers, was not demonstrated. The installed graph nevertheless failed the required audit; it was not waived.

- Did not forceMinimatch11 into legacyglob7 again. Migrated the ZIP writer consumer toArchiver8 with a small adapter preserving ExcelJS's factory and legacy pipe-only stream contract.
- Upgradedunzipper to0.12.5 to remove the remainingfstream/rimraf/glob7 reader chain. The scoped11.0.3 matcher is for compatible readdir-glob3, notglob7.
- Larger workbook tests exposed a real additional ExcelJS streaming-reader defect: stateless per-chunk UTF-8 decoding corrupts Arabic across chunk boundaries. A declared, locked pnpm patch preserves decoder state per XML stream; no hidden node_modules edit.
- Five permanent tests pass: real ZIP traversal and seven exact synthetic attachment names/contents, hidden/ignored files and brace/globstar, buffered/streaming XLSX writers and readers with602 rows and long Arabic strings, numeric values, and byte-boundary UTF-8 splitting.
- Retained pre-fix and rejected-experiment logs. Despite its filename, archive-bulk-green.log contains two failures; utf8-before.log contains one failure and four filtered cases; archive-final-green.log contains five passes. The five are included within1123, not added to it.
- The authorized original HTTP product-export route returned200 and a real6933-byte XLSX. Independent import verified Arabic, RTL and quantity17. No native XLSX button was available in observed pages, so browser download completion is not claimed. An initialcustomers probe returned400 because that generic exporter does not support that report type.

Tested onLinux/Node24.22.1. The archive adapter requiresNode>=22.12. No ExcelJS major-version migration, financial-engine rewrite or database migration was introduced.

## New native sale and independent reconciliation

Original UI:3×115 VAT-inclusive, clearly unconfirmed345 estimate, persisted344 draft due to a fixed1 line rule. Agreement review exposed0.2899%, its source and VAT44.87 before acknowledgment/confirmation. Delivered3 once; invoiced one unit114.67 and the remaining two229.33.

The second invoice committed before its response was deliberately dropped. The original intent survived reload and native recovery replayed the same key/body and invoice result. Exactly two invoices and one issue movement remain. Order/invoice/AR summaries show344; both invoices are unpaid and unsent.

Independent SQL:17 FIFO units×50=850; layers850 and inventory GL850; COGS150; AR344; output VAT44.87; revenue credit300 and discount debit0.87; no unbalanced journal. Gross invoiced sales are not collections or net revenue; AR happens to match here because nothing was paid.

## Identity journey and source boundaries

A separate synthetic company showed current revision1 effective2026-10-31 and future revision2 effective2099-01-01 as not_registered. Policy effective date is not the authority's registration date: vatRegistrationDate remainednull and registration was declared_unverified. Both branches inherited the company identity. The original print-identity VAT edit returned409; reload restored the current VAT number. Publishing was disabled and the browser did not try to publish.

Nine financial/inventory/document/attempt tables were identical before and after: both historical issuer snapshots retained, inventory value850 unchanged. The sales demonstration company retained legacy configuration without automatic adoption.

The financial journey started onAPI85d988a before the ExcelJS decoding fix. Identity, final invoice reads, original HTTP XLSX and full gates used2fdfe868 after restarting the isolatedAPI. Git comparison proves application financial/tax handlers and frontend source are identical; the dependency and fixture differences are explicit. The issue journey itself was NOT repeated on2fd. UTF-8-decoded sourcemaps matchedsales.tsx andcompany-tax-policy.tsx. The first source alarm was a Latin-1 measurement mistake, not stale application code.

## Safe meeting path and unproved capabilities

- Open a fresh private window; use only synthetic credentials from localprivate-demo-access.txt. Do not clear normal-browser pending intents or enter real data. Credentials are excluded fromGit and evidence.
- Sales→SO-2026-00001→two invoices and344 summaries; then the separate identity account→Settings/Tax/branch inheritance. Use saved screenshots for historical steps; do not issue again merely for demonstration.
- TAX_POLICY_NOT_READY remains. Other tax consumers, including purchases/returns/reports and XML/QR/signing/reporting/clearance production acceptance, are not closed. Delivered document editor, seller selection and sales summary are not rebuilt.
- No live email/payment, device, physical printing, Windows or native XLSX-download acceptance. Demonstrated sign-in uses the seeded account, not the visibly disabledGoogle/Apple providers.
- Kept-alive synthetic services are not publication or guaranteed availability after container shutdown. The ordinaryAPI connected to normal development data was intentionally not started.

## Files, evidence and continuation

Core files: lib/excel-archive-compat, patches/exceljs@4.4.0.patch, pnpm-workspace.yaml, pnpm-lock.yaml andexcel-archive-compat.test.ts. Changes tosales-order-browser.ts andtax-identity-browser.ts only prepare isolated evidence.

Evidence: generated-artifacts/meeting-readiness/verify-start.json, verify-finish.json, final-verification, browser-sales andidentity reports/screenshots/reconciliations, source-equivalence.json and actual XLSX. git-final.json records synchronization when packaging. Generated outputs are intentionally excluded fromGit and delivered separately.

Same repository/branch: https://github.com/Abdullah-Almutairi12/Hasiba/tree/sync/hasiba-erp-20261023
No main changes, production publication, external messages or disbursements. This meeting/archive slice is closed within the recorded evidence; no third scope starts automatically.
