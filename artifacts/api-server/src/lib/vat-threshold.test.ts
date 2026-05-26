import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  db,
  companiesTable,
  posSessionsTable,
  posOrdersTable,
  posOrderPaymentsTable,
  branchesTable,
  customersTable,
  customerInvoicesTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import {
  computeRolling12mSales,
  getVatThresholdSnapshot,
  isVatEnabled,
  VAT_MANDATORY_THRESHOLD_SAR,
  VAT_VOLUNTARY_THRESHOLD_SAR,
} from "./vat-threshold";

const TAG = `vitest-vat-${Date.now()}`;

let companyId: number;
let branchId: number;
let sessionId: number;

beforeAll(async () => {
  const [c] = await db
    .insert(companiesTable)
    .values({
      name: `${TAG}-co`,
      baseCurrency: "SAR",
      vatRegistrationStatus: "not_registered",
    })
    .returning({ id: companiesTable.id });
  companyId = c.id;

  const [b] = await db
    .insert(branchesTable)
    .values({
      name: `${TAG}-branch`,
      nameAr: `${TAG}-فرع`,
      city: "Riyadh",
      companyId,
    })
    .returning({ id: branchesTable.id });
  branchId = b.id;

  const [s] = await db
    .insert(posSessionsTable)
    .values({
      branchId,
      sessionNumber: `${TAG}-sess`,
      cashierName: TAG,
    })
    .returning({ id: posSessionsTable.id });
  sessionId = s.id;
});

afterAll(async () => {
  await db.delete(posOrdersTable).where(eq(posOrdersTable.sessionId, sessionId));
  await db.delete(posSessionsTable).where(eq(posSessionsTable.id, sessionId));
  await db
    .delete(customerInvoicesTable)
    .where(inArray(customerInvoicesTable.reference, [`${TAG}-inv-pos`, `${TAG}-inv-man`]));
  await db.delete(customersTable).where(eq(customersTable.companyId, companyId));
  await db.delete(branchesTable).where(inArray(branchesTable.id, [branchId]));
  await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
});

/** Helper: insert a POS order with a matching cash payment (DB trigger
 * `pos_order_total_matches_payments` requires sum(payments) === total). */
async function seedOrder(
  ord: { number: string; subtotal: number; tax?: number; discount?: number },
) {
  const tax = ord.tax ?? 0;
  const discount = ord.discount ?? 0;
  const total = ord.subtotal + tax - discount;
  await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(posOrdersTable)
      .values({
        orderNumber: ord.number,
        sessionId,
        subtotal: String(ord.subtotal),
        discount: String(discount),
        tax: String(tax),
        total: String(total),
        paymentMethod: "cash",
        companyId,
      })
      .returning({ id: posOrdersTable.id });
    await tx.insert(posOrderPaymentsTable).values({
      orderId: row.id,
      method: "cash",
      amount: String(total),
    });
  });
}

describe("vat-threshold service", () => {
  it("returns zero rolling sales on a fresh tenant", async () => {
    const sales = await computeRolling12mSales(companyId);
    expect(sales).toBe(0);
  });

  it("sums POS subtotals minus discount for rolling 12m", async () => {
    await seedOrder({ number: `${TAG}-o1`, subtotal: 200_000, tax: 30_000 });
    const sales = await computeRolling12mSales(companyId);
    expect(sales).toBe(200_000);
  });

  it("crosses near80 when ≥ 80% of mandatory threshold", async () => {
    await seedOrder({ number: `${TAG}-o2`, subtotal: 110_000 }); // → 310K, 82.6%
    const snap = await getVatThresholdSnapshot(companyId);
    expect(snap.near80).toBe(true);
    expect(snap.crossedMandatory).toBe(false);
    expect(snap.percentOfMandatory).toBeGreaterThanOrEqual(80);
    expect(snap.status).toBe("not_registered");
    expect(snap.remainingToMandatory).toBeGreaterThan(0);
  });

  it("crosses mandatory when ≥ 375K", async () => {
    await seedOrder({ number: `${TAG}-o3`, subtotal: 100_000 }); // → 410K
    const snap = await getVatThresholdSnapshot(companyId);
    expect(snap.crossedMandatory).toBe(true);
    expect(snap.remainingToMandatory).toBe(0);
    expect(snap.rolling12mSales).toBeGreaterThanOrEqual(VAT_MANDATORY_THRESHOLD_SAR);
  });

  it("isVatEnabled treats only registered/voluntary as enabled", () => {
    expect(isVatEnabled("registered")).toBe(true);
    expect(isVatEnabled("voluntary")).toBe(true);
    expect(isVatEnabled("not_registered")).toBe(false);
    expect(isVatEnabled(null)).toBe(false);
    expect(isVatEnabled(undefined)).toBe(false);
  });

  it("exports correct threshold constants", () => {
    expect(VAT_MANDATORY_THRESHOLD_SAR).toBe(375_000);
    expect(VAT_VOLUNTARY_THRESHOLD_SAR).toBe(187_500);
  });

  it("snapshot echoes mandatory + voluntary thresholds per OpenAPI", async () => {
    const snap = await getVatThresholdSnapshot(companyId);
    expect(snap.mandatoryThreshold).toBe(VAT_MANDATORY_THRESHOLD_SAR);
    expect(snap.voluntaryThreshold).toBe(VAT_VOLUNTARY_THRESHOLD_SAR);
  });

  it("does NOT double-count POS-mirrored customer_invoices (source='pos')", async () => {
    // POS-origin invoices are mirrors of pos_orders and must be excluded
    // from the customer_invoices half of the sum, else the same revenue
    // would inflate the rolling counter twice.
    const baseline = await computeRolling12mSales(companyId);
    const [cust] = await db
      .insert(customersTable)
      .values({ name: `${TAG}-cust`, companyId })
      .returning({ id: customersTable.id });
    await db.insert(customerInvoicesTable).values({
      reference: `${TAG}-inv-pos`,
      customerId: cust.id,
      customerName: `${TAG}-cust`,
      branchId,
      invoiceDate: new Date().toISOString().slice(0, 10),
      subtotal: "50000",
      discount: "0",
      vat: "7500",
      total: "57500",
      status: "open",
      source: "pos",
    });
    const after = await computeRolling12mSales(companyId);
    expect(after).toBe(baseline);

    // Sanity: a non-POS (manual) invoice IS included.
    await db.insert(customerInvoicesTable).values({
      reference: `${TAG}-inv-man`,
      customerId: cust.id,
      customerName: `${TAG}-cust`,
      branchId,
      invoiceDate: new Date().toISOString().slice(0, 10),
      subtotal: "10000",
      discount: "0",
      vat: "1500",
      total: "11500",
      status: "open",
      source: "manual",
    });
    const afterManual = await computeRolling12mSales(companyId);
    expect(afterManual).toBe(baseline + 10_000);
  });
});
