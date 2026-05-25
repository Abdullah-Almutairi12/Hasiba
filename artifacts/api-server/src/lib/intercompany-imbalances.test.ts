/**
 * Regression tests for cross-tenant access on the persisted
 * intercompany imbalance queue. Verifies setImbalanceStatus refuses
 * to mutate rows whose source/target companies are not in the
 * caller's allowedCompanyIds set (IDOR defense).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  companiesTable,
  intercompanyLinksTable,
  intercompanyImbalancesTable,
} from "@workspace/db";
import { setImbalanceStatus } from "./intercompany-imbalances";

const TAG = `vitest-imb-${Date.now()}`;
let coA = 0;
let coB = 0;
let coC = 0;
let linkAB = 0;
let imbId = 0;

beforeAll(async () => {
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
