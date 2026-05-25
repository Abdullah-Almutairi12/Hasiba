/**
 * Phase 3 — compliance summary loader used by the
 * weekly/monthly cleanup PDF report.
 *
 * Aggregates `compliance_alerts` rows raised inside the same window
 * the cleanup PDF already covers, plus the list of currently-active
 * intercompany agreement PDFs so auditors can cross-reference each
 * transfer-pricing finding against the master agreement on file.
 *
 * Cross-tenant: the cleanup PDF is system-wide (admin scope), so this
 * helper does NOT filter by companyId — it returns rows across every
 * tenant and tags each one with its company name.
 */

import { and, desc, gte, lte, eq } from "drizzle-orm";
import {
  db,
  complianceAlertsTable,
  intercompanyAgreementsTable,
  companiesTable,
} from "@workspace/db";

export interface ComplianceAlertRowForPdf {
  id: number;
  createdAt: Date;
  companyName: string;
  kind: string;
  severity: string;
  ref: string | null;
  message: string;
  deviationPct: string | null;
  status: string;
}

export interface ComplianceAgreementRowForPdf {
  id: number;
  companyName: string;
  counterpartyName: string;
  title: string;
  pdfUrl: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface ComplianceReportSummary {
  alerts: ComplianceAlertRowForPdf[];
  agreements: ComplianceAgreementRowForPdf[];
  counts: {
    transferPricing: number;
    agreementMissing: number;
    zakat: number;
    openTotal: number;
  };
}

/**
 * Loads alerts created between `from` and `to` (inclusive on the
 * lower bound) and every active agreement currently on file.
 */
export async function loadComplianceReportSummary(window: {
  from: Date | null;
  to: Date | null;
}): Promise<ComplianceReportSummary> {
  const conds = [];
  if (window.from) conds.push(gte(complianceAlertsTable.createdAt, window.from));
  if (window.to) conds.push(lte(complianceAlertsTable.createdAt, window.to));

  const alertRows = await db
    .select({
      id: complianceAlertsTable.id,
      createdAt: complianceAlertsTable.createdAt,
      companyName: companiesTable.name,
      kind: complianceAlertsTable.kind,
      severity: complianceAlertsTable.severity,
      ref: complianceAlertsTable.ref,
      message: complianceAlertsTable.message,
      deviationPct: complianceAlertsTable.deviationPct,
      status: complianceAlertsTable.status,
    })
    .from(complianceAlertsTable)
    .innerJoin(
      companiesTable,
      eq(companiesTable.id, complianceAlertsTable.companyId),
    )
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(complianceAlertsTable.createdAt))
    .limit(200);

  const companiesAliasSrc = companiesTable;
  const agreementRows = await db
    .select({
      id: intercompanyAgreementsTable.id,
      companyName: companiesAliasSrc.name,
      counterpartyCompanyId:
        intercompanyAgreementsTable.counterpartyCompanyId,
      title: intercompanyAgreementsTable.title,
      pdfUrl: intercompanyAgreementsTable.pdfUrl,
      effectiveFrom: intercompanyAgreementsTable.effectiveFrom,
      effectiveTo: intercompanyAgreementsTable.effectiveTo,
    })
    .from(intercompanyAgreementsTable)
    .innerJoin(
      companiesAliasSrc,
      eq(companiesAliasSrc.id, intercompanyAgreementsTable.companyId),
    )
    .where(eq(intercompanyAgreementsTable.isActive, true))
    .orderBy(desc(intercompanyAgreementsTable.uploadedAt));

  // Second pass to label counterparty names.
  const counterpartyIds = Array.from(
    new Set(agreementRows.map((a) => a.counterpartyCompanyId)),
  );
  const counterpartyMap = new Map<number, string>();
  if (counterpartyIds.length > 0) {
    const labels = await db
      .select({ id: companiesTable.id, name: companiesTable.name })
      .from(companiesTable);
    for (const c of labels) counterpartyMap.set(c.id, c.name);
  }

  const counts = {
    transferPricing: 0,
    agreementMissing: 0,
    zakat: 0,
    openTotal: 0,
  };
  for (const a of alertRows) {
    if (a.kind === "transfer_pricing") counts.transferPricing++;
    else if (a.kind === "agreement_missing") counts.agreementMissing++;
    else if (a.kind === "zakat") counts.zakat++;
    if (a.status === "open") counts.openTotal++;
  }

  return {
    alerts: alertRows,
    agreements: agreementRows.map((a) => ({
      id: a.id,
      companyName: a.companyName,
      counterpartyName:
        counterpartyMap.get(a.counterpartyCompanyId) ??
        `Company #${a.counterpartyCompanyId}`,
      title: a.title,
      pdfUrl: a.pdfUrl,
      effectiveFrom: a.effectiveFrom,
      effectiveTo: a.effectiveTo,
    })),
    counts,
  };
}
