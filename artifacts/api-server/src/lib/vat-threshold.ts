import {
  db,
  companiesTable,
  customerInvoicesTable,
  customersTable,
  posOrdersTable,
} from "@workspace/db";
import { and, eq, gte, sql } from "drizzle-orm";

/**
 * ZATCA SMB thresholds (SAR / rolling 12 months):
 *   - ≥ 375,000  → MANDATORY VAT registration
 *   - ≥ 187,500  → may register VOLUNTARILY
 *   - <  187,500 → cannot register
 */
export const VAT_MANDATORY_THRESHOLD_SAR = 375_000;
export const VAT_VOLUNTARY_THRESHOLD_SAR = 187_500;

export type VatRegistrationStatus = "registered" | "voluntary" | "not_registered";

export interface VatThresholdSnapshot {
  /** Persisted registration status. */
  status: VatRegistrationStatus;
  /** Rolling-12-month taxable sales (POS net + customer invoices net), SAR. */
  rolling12mSales: number;
  /** % of the mandatory threshold (0–∞). */
  percentOfMandatory: number;
  /** Crossed the 80% near-mandatory line — should consider registration. */
  near80: boolean;
  /** Crossed mandatory threshold — registration is legally required. */
  crossedMandatory: boolean;
  /** Eligible for voluntary registration (≥ 187.5K). */
  eligibleVoluntary: boolean;
  /** SAR remaining until mandatory threshold (≥ 0; 0 when crossed). */
  remainingToMandatory: number;
  /** UTC ISO timestamp of the calculation. */
  computedAt: string;
  vatNumber: string | null;
  vatRegistrationDate: string | null;
}

/**
 * Compute the rolling 12-month taxable sales for a single tenant by
 * summing (1) POS order totals net of POS tax line, and (2) issued
 * customer invoice subtotals (i.e. net of VAT). Returns 0 on a fresh
 * tenant with no sales history.
 */
export async function computeRolling12mSales(companyId: number): Promise<number> {
  const oneYearAgo = new Date();
  oneYearAgo.setUTCFullYear(oneYearAgo.getUTCFullYear() - 1);

  const [posRow] = await db
    .select({
      net: sql<string>`COALESCE(SUM(${posOrdersTable.subtotal} - ${posOrdersTable.discount}), 0)::text`,
    })
    .from(posOrdersTable)
    .where(
      and(
        eq(posOrdersTable.companyId, companyId),
        gte(posOrdersTable.createdAt, oneYearAgo),
      ),
    );

  // customer_invoices has no direct companyId column. Scope through
  // customers.companyId (rather than branches) because manual invoices
  // are created with branchId=null and a branch-join would drop them.
  // Statuses to include match the AR lifecycle in lib/db/src/schema/sales.ts:
  // draft → open → (partially_paid | paid). `cancelled` is excluded.
  const [invRow] = await db
    .select({
      net: sql<string>`COALESCE(SUM(${customerInvoicesTable.subtotal} - ${customerInvoicesTable.discount}), 0)::text`,
    })
    .from(customerInvoicesTable)
    .innerJoin(customersTable, eq(customersTable.id, customerInvoicesTable.customerId))
    .where(
      and(
        eq(customersTable.companyId, companyId),
        gte(customerInvoicesTable.createdAt, oneYearAgo),
        sql`${customerInvoicesTable.status} IN ('open','partially_paid','paid')`,
      ),
    );

  const pos = Number(posRow?.net ?? "0");
  const inv = Number(invRow?.net ?? "0");
  return pos + inv;
}

/** Compute the full VAT threshold snapshot for a tenant. */
export async function getVatThresholdSnapshot(companyId: number): Promise<VatThresholdSnapshot> {
  const [company] = await db
    .select({
      vatRegistrationStatus: companiesTable.vatRegistrationStatus,
      vatNumber: companiesTable.vatNumber,
      vatRegistrationDate: companiesTable.vatRegistrationDate,
    })
    .from(companiesTable)
    .where(eq(companiesTable.id, companyId))
    .limit(1);

  if (!company) {
    throw new Error(`vat-threshold: company #${companyId} not found`);
  }

  const sales = await computeRolling12mSales(companyId);
  const status = isVatStatus(company.vatRegistrationStatus)
    ? company.vatRegistrationStatus
    : "registered";

  return {
    status,
    rolling12mSales: round2(sales),
    percentOfMandatory: round2((sales / VAT_MANDATORY_THRESHOLD_SAR) * 100),
    near80: sales >= VAT_MANDATORY_THRESHOLD_SAR * 0.8,
    crossedMandatory: sales >= VAT_MANDATORY_THRESHOLD_SAR,
    eligibleVoluntary: sales >= VAT_VOLUNTARY_THRESHOLD_SAR,
    remainingToMandatory: Math.max(0, round2(VAT_MANDATORY_THRESHOLD_SAR - sales)),
    computedAt: new Date().toISOString(),
    vatNumber: company.vatNumber ?? null,
    vatRegistrationDate: company.vatRegistrationDate
      ? company.vatRegistrationDate.toISOString()
      : null,
  };
}

/** Returns true when the tenant is registered (mandatory OR voluntary). */
export function isVatEnabled(status: string | null | undefined): boolean {
  return status === "registered" || status === "voluntary";
}

function isVatStatus(v: string): v is VatRegistrationStatus {
  return v === "registered" || v === "voluntary" || v === "not_registered";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
