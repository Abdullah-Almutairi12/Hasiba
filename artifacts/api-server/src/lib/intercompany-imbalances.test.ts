/**
 * Regression tests for cross-tenant access on the persisted
 * intercompany imbalance queue. Verifies setImbalanceStatus refuses
 * to mutate rows whose source/target companies are not in the
 * caller's allowedCompanyIds set (IDOR defense).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, gte, inArray } from "drizzle-orm";
import {
  db,
  companiesTable,
  intercompanyLinksTable,
  intercompanyImbalancesTable,
  alertsTable,
} from "@workspace/db";
import {
  recordImbalancesFromEliminations,
  setImbalanceStatus,
} from "./intercompany-imbalances";
import { initIntercompanyImbalanceFxColumns } from "./intercompany-imbalance-fx-init";
import type { EliminationEntry } from "./consolidated-reports";

const TAG = `vitest-imb-${Date.now()}`;
let coA = 0;
let coB = 0;
let coC = 0;
let linkAB = 0;
let imbId = 0;

beforeAll(async () => {
  // Ensure FX columns added by the Smart Multi-Currency Variance
  // Analysis phase exist before any insert touches the table.
  await initIntercompanyImbalanceFxColumns();
  const [a] = await db.insert(companiesTable).values({ name: `Imb Co A ${TAG}`, baseCurrency: "SAR" }).returning();
  const [b] = await db.insert(companiesTable).values({ name: `Imb Co B ${TAG}`, baseCurrency: "SAR" }).returning();
  const [c] = await db.insert(companiesTable).values({ name: `Imb Co C ${TAG}`, baseCurrency: "SAR" }).returning();
  coA = a.id; coB = b.id; coC = c.id;

  const [link] = await db
    .insert(intercompanyLinksTable)
    .values({
      kind: "sales_invoice",
      sourceCompanyId: coA,
      sourceDocId: 999_000,
      sourceRef: `IMB-SRC-${TAG}`,
      targetCompanyId: coB,
      targetDocId: 999_001,
      targetRef: `IMB-TGT-${TAG}`,
      status: "matched",
    })
    .returning();
  linkAB = link.id;

  const [imb] = await db
    .insert(intercompanyImbalancesTable)
    .values({
      linkId: linkAB,
      basis: "subtotal",
      kind: "sales_invoice",
      sourceCompanyId: coA,
      sourceRef: `IMB-SRC-${TAG}`,
      targetCompanyId: coB,
      targetRef: `IMB-TGT-${TAG}`,
      sourceAmount: "100.0000",
      targetAmount: "90.0000",
      difference: "10.0000",
      status: "open",
    })
    .returning();
  imbId = imb.id;
});

afterAll(async () => {
  if (imbId) await db.delete(intercompanyImbalancesTable).where(eq(intercompanyImbalancesTable.id, imbId));
  if (linkAB) await db.delete(intercompanyLinksTable).where(eq(intercompanyLinksTable.id, linkAB));
  const coIds = [coA, coB, coC].filter((n) => n > 0);
  if (coIds.length > 0) await db.delete(companiesTable).where(inArray(companiesTable.id, coIds));
});

describe("setImbalanceStatus tenant isolation", () => {
  it("rejects ignore when the actor's allowed companies do not include source or target", async () => {
    const ok = await setImbalanceStatus(imbId, "ignored", null, null, [coC]);
    expect(ok).toBe(false);
    const [row] = await db
      .select({ status: intercompanyImbalancesTable.status })
      .from(intercompanyImbalancesTable)
      .where(eq(intercompanyImbalancesTable.id, imbId));
    expect(row.status).toBe("open");
  });

  it("rejects mutation when allowedCompanyIds is empty", async () => {
    const ok = await setImbalanceStatus(imbId, "ignored", null, null, []);
    expect(ok).toBe(false);
  });

  it("allows ignore when the actor has access to the source company", async () => {
    const ok = await setImbalanceStatus(imbId, "ignored", null, null, [coA, coC]);
    expect(ok).toBe(true);
    const [row] = await db
      .select({ status: intercompanyImbalancesTable.status })
      .from(intercompanyImbalancesTable)
      .where(eq(intercompanyImbalancesTable.id, imbId));
    expect(row.status).toBe("ignored");
  });

  it("allows reopen when the actor has access to the target company", async () => {
    const ok = await setImbalanceStatus(imbId, "open", null, null, [coB]);
    expect(ok).toBe(true);
    const [row] = await db
      .select({ status: intercompanyImbalancesTable.status })
      .from(intercompanyImbalancesTable)
      .where(eq(intercompanyImbalancesTable.id, imbId));
    expect(row.status).toBe("open");
  });
});

describe("recordImbalancesFromEliminations finance notifications", () => {
  // A separate link so we can exercise the insert path (the
  // beforeAll-seeded linkAB already has an open imbalance row).
  let link2 = 0;
  let createdImbalanceIds: number[] = [];
  let testStart = new Date();

  beforeAll(async () => {
    testStart = new Date();
    const [l] = await db
      .insert(intercompanyLinksTable)
      .values({
        kind: "sales_invoice",
        sourceCompanyId: coA,
        sourceDocId: 999_100,
        sourceRef: `IMB-N-SRC-${TAG}`,
        targetCompanyId: coB,
        targetDocId: 999_101,
        targetRef: `IMB-N-TGT-${TAG}`,
        status: "matched",
      })
      .returning();
    link2 = l.id;
  });

  afterAll(async () => {
    if (createdImbalanceIds.length > 0) {
      await db
        .delete(intercompanyImbalancesTable)
        .where(inArray(intercompanyImbalancesTable.id, createdImbalanceIds));
    }
    if (link2) {
      await db.delete(intercompanyLinksTable).where(eq(intercompanyLinksTable.id, link2));
    }
    await db
      .delete(alertsTable)
      .where(
        and(
          inArray(alertsTable.companyId, [coA, coB]),
          gte(alertsTable.createdAt, testStart),
        ),
      );
  });

  it("inserts one warning alert per involved company on a brand-new imbalance, and does not re-alert on rescan", async () => {
    const entry: EliminationEntry = {
      linkId: link2,
      sourceCompanyId: coA,
      sourceCompanyName: `Imb Co A ${TAG}`,
      sourceRef: `IMB-N-SRC-${TAG}`,
      targetCompanyId: coB,
      targetCompanyName: `Imb Co B ${TAG}`,
      targetRef: `IMB-N-TGT-${TAG}`,
      sourceAmount: 250,
      targetAmount: 200,
      amount: 250,
      imbalance: true,
    };
    const kindMap = new Map<number, string>([[link2, "sales_invoice"]]);

    const res1 = await recordImbalancesFromEliminations([entry], "subtotal", kindMap);
    expect(res1.recorded).toBe(1);

    const created = await db
      .select({ id: intercompanyImbalancesTable.id })
      .from(intercompanyImbalancesTable)
      .where(eq(intercompanyImbalancesTable.linkId, link2));
    createdImbalanceIds = created.map((r) => r.id);

    const firstAlerts = await db
      .select({
        id: alertsTable.id,
        companyId: alertsTable.companyId,
        type: alertsTable.type,
        message: alertsTable.message,
      })
      .from(alertsTable)
      .where(
        and(
          inArray(alertsTable.companyId, [coA, coB]),
          gte(alertsTable.createdAt, testStart),
        ),
      );
    expect(firstAlerts.length).toBe(2);
    expect(new Set(firstAlerts.map((a) => a.companyId))).toEqual(new Set([coA, coB]));
    for (const a of firstAlerts) {
      expect(a.type).toBe("warning");
      expect(a.message).toContain("/intercompany#tab=imbalances");
      expect(a.message).toContain(`IMB-N-SRC-${TAG}`);
    }

    // Re-detecting the same still-open imbalance must NOT fire more alerts.
    await recordImbalancesFromEliminations([entry], "subtotal", kindMap);
    const secondAlerts = await db
      .select({ id: alertsTable.id })
      .from(alertsTable)
      .where(
        and(
          inArray(alertsTable.companyId, [coA, coB]),
          gte(alertsTable.createdAt, testStart),
        ),
      );
    expect(secondAlerts.length).toBe(2);

    // Finance marks the row 'ignored'. Subsequent rescans must NOT
    // generate additional alerts — ignored is a deliberate mute,
    // not a "still-broken" signal.
    await db
      .update(intercompanyImbalancesTable)
      .set({ status: "ignored" })
      .where(eq(intercompanyImbalancesTable.linkId, link2));
    await recordImbalancesFromEliminations([entry], "subtotal", kindMap);
    const thirdAlerts = await db
      .select({ id: alertsTable.id })
      .from(alertsTable)
      .where(
        and(
          inArray(alertsTable.companyId, [coA, coB]),
          gte(alertsTable.createdAt, testStart),
        ),
      );
    expect(thirdAlerts.length).toBe(2);
  });
});
