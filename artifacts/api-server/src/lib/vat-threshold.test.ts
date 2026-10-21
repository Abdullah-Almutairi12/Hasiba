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
  simulateVatTrajectory,
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

  // ============================================================
  // Task #259 — simulateVatTrajectory (pure math, no DB)
  // ============================================================
  describe("simulateVatTrajectory", () => {
    it("flat growth keeps the rolling sum constant", () => {
      const r = simulateVatTrajectory({
        baselineRolling12mSales: 240_000,
        monthlyGrowthRate: 0,
        months: 12,
      });
      // With 0% growth, replacing the oldest month with an identical
      // projected month is a no-op: every point stays at the baseline.
      for (const p of r.trajectory) {
        expect(p.rolling12mSales).toBeCloseTo(240_000, 0);
      }
      expect(r.voluntaryCrossedAtMonth).toBe(1); // already over 187.5K
      expect(r.mandatoryCrossedAtMonth).toBeNull();
    });

    it("detects month a growing tenant crosses voluntary line", () => {
      const r = simulateVatTrajectory({
        baselineRolling12mSales: 120_000,
        monthlyGrowthRate: 0.1,
        months: 24,
      });
      // 10% m/m on 10K baseline monthly → grows past 187.5K rolling
      // sum within a few months.
      expect(r.voluntaryCrossedAtMonth).not.toBeNull();
      expect(r.voluntaryCrossedAtMonth!).toBeGreaterThan(0);
      const crossed = r.trajectory.find(
        (p) => p.month === r.voluntaryCrossedAtMonth,
      )!;
      expect(crossed.rolling12mSales).toBeGreaterThanOrEqual(
        VAT_VOLUNTARY_THRESHOLD_SAR,
      );
    });

    it("detects month a fast-growing tenant crosses mandatory line", () => {
      const r = simulateVatTrajectory({
        baselineRolling12mSales: 240_000,
        monthlyGrowthRate: 0.15,
        months: 24,
      });
      expect(r.mandatoryCrossedAtMonth).not.toBeNull();
      const crossed = r.trajectory.find(
        (p) => p.month === r.mandatoryCrossedAtMonth,
      )!;
      expect(crossed.rolling12mSales).toBeGreaterThanOrEqual(
        VAT_MANDATORY_THRESHOLD_SAR,
      );
    });

    it("oneOffBoost lifts month 1 only", () => {
      const baseline = 100_000;
      const noBoost = simulateVatTrajectory({
        baselineRolling12mSales: baseline,
        monthlyGrowthRate: 0,
        months: 3,
        oneOffBoost: 0,
      });
      const boosted = simulateVatTrajectory({
        baselineRolling12mSales: baseline,
        monthlyGrowthRate: 0,
        months: 3,
        oneOffBoost: 50_000,
      });
      // Boost shows up month 1 and propagates into rolling sum.
      expect(boosted.trajectory[0]!.rolling12mSales).toBeGreaterThan(
        noBoost.trajectory[0]!.rolling12mSales,
      );
      // Subsequent months: boost stays in the rolling window (we don't
      // subtract it again until 12+ months pass, which is outside the
      // test horizon).
      expect(boosted.trajectory[2]!.rolling12mSales).toBeGreaterThan(
        noBoost.trajectory[2]!.rolling12mSales,
      );
    });

    it("estimatedMonthlyVatCash scales with cashImpactRate", () => {
      const low = simulateVatTrajectory({
        baselineRolling12mSales: 240_000,
        cashImpactRate: 0.05,
        months: 1,
      });
      const high = simulateVatTrajectory({
        baselineRolling12mSales: 240_000,
        cashImpactRate: 0.15,
        months: 1,
      });
      expect(high.trajectory[0]!.estimatedMonthlyVatCash).toBeGreaterThan(
        low.trajectory[0]!.estimatedMonthlyVatCash,
      );
    });

    it("clamps months to 1-36 and growth/priceChange to [-0.5, 2]", () => {
      const tooMany = simulateVatTrajectory({
        baselineRolling12mSales: 1000,
        months: 999,
      });
      expect(tooMany.trajectory.length).toBe(36);
      const tooFast = simulateVatTrajectory({
        baselineRolling12mSales: 1000,
        monthlyGrowthRate: 5,
        months: 1,
      });
      expect(tooFast.monthlyGrowthRate).toBe(2);
      const tooSteep = simulateVatTrajectory({
        baselineRolling12mSales: 1000,
        priceChangePct: 5,
        months: 1,
      });
      expect(tooSteep.priceChangePct).toBe(2);
    });

    it("uses a true 12-month rolling window beyond month 12", () => {
      // With 0% growth and no boost, the rolling 12m should stay equal
      // to the baseline forever — the window is just replacing baseline
      // slices with identical projected slices.
      const flat = simulateVatTrajectory({
        baselineRolling12mSales: 120_000,
        monthlyGrowthRate: 0,
        months: 24,
      });
      for (const p of flat.trajectory) {
        expect(p.rolling12mSales).toBeCloseTo(120_000, 1);
      }

      // With +10% m/m, by month 24 the window is fully composed of
      // projected months 13..24. Rolling sum = sum_{m=13..24} base*(1.1)^m.
      const base = 100_000 / 12;
      const growing = simulateVatTrajectory({
        baselineRolling12mSales: 100_000,
        monthlyGrowthRate: 0.1,
        months: 24,
      });
      let expected = 0;
      for (let m = 13; m <= 24; m++) expected += base * Math.pow(1.1, m);
      expect(growing.trajectory[23]!.rolling12mSales).toBeCloseTo(expected, 0);
    });

    it("emits per-month date, vatCollected, vatPaid", () => {
      const r = simulateVatTrajectory({
        baselineRolling12mSales: 120_000,
        monthlyGrowthRate: 0.05,
        months: 6,
      });
      for (const p of r.trajectory) {
        expect(p.date).toMatch(/^\d{4}-\d{2}$/);
        expect(typeof p.vatCollected).toBe("number");
        expect(typeof p.vatPaid).toBe("number");
        // collected = projected * 15%, paid = projected * 50% * 15%.
        // Therefore collected should be ~2x paid for every month.
        expect(p.vatCollected).toBeGreaterThanOrEqual(p.vatPaid);
      }
    });

    it("voluntaryRegistrationChoice gates netCashRegisterEarly", () => {
      const off = simulateVatTrajectory({
        baselineRolling12mSales: 240_000,
        monthlyGrowthRate: 0.1,
        months: 24,
        voluntaryRegistrationChoice: false,
      });
      const on = simulateVatTrajectory({
        baselineRolling12mSales: 240_000,
        monthlyGrowthRate: 0.1,
        months: 24,
        voluntaryRegistrationChoice: true,
      });
      expect(off.netCashRegisterEarly).toBe(0);
      // Voluntary choice + mandatory crossing in horizon → non-zero
      // (positive in this scenario because collected > paid).
      expect(on.mandatoryCrossedAtMonth).not.toBeNull();
      expect(on.netCashRegisterEarly).not.toBe(0);
    });

    it("priceChangePct uplifts projected sales multiplicatively", () => {
      const flat = simulateVatTrajectory({
        baselineRolling12mSales: 120_000,
        monthlyGrowthRate: 0,
        months: 6,
        priceChangePct: 0,
      });
      const lifted = simulateVatTrajectory({
        baselineRolling12mSales: 120_000,
        monthlyGrowthRate: 0,
        months: 6,
        priceChangePct: 0.2,
      });
      expect(lifted.trajectory[5]!.rolling12mSales).toBeGreaterThan(
        flat.trajectory[5]!.rolling12mSales,
      );
    });

    it("exposes voluntaryCrossedDate / mandatoryCrossedDate alongside month indices", () => {
      const r = simulateVatTrajectory({
        baselineRolling12mSales: 240_000,
        monthlyGrowthRate: 0.15,
        months: 24,
      });
      if (r.voluntaryCrossedAtMonth !== null) {
        expect(r.voluntaryCrossedDate).toMatch(/^\d{4}-\d{2}$/);
      }
      if (r.mandatoryCrossedAtMonth !== null) {
        expect(r.mandatoryCrossedDate).toMatch(/^\d{4}-\d{2}$/);
      }
    });

    it("baseline 0 → trajectory stays 0, neither threshold ever crossed", () => {
      const r = simulateVatTrajectory({
        baselineRolling12mSales: 0,
        monthlyGrowthRate: 0.2,
        months: 12,
      });
      // 0 * anything is still 0, so the rolling sum cannot grow.
      for (const p of r.trajectory) {
        expect(p.rolling12mSales).toBe(0);
      }
      expect(r.voluntaryCrossedAtMonth).toBeNull();
      expect(r.mandatoryCrossedAtMonth).toBeNull();
    });
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
      companyId,
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
      companyId,
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
