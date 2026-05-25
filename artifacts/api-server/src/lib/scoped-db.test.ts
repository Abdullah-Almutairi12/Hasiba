/**
 * Tenant-isolation regression tests for `ScopedDb`.
 *
 * These cover the two ways tenant leakage typically appears in
 * practice:
 *   - A route forgets to call `.scope()` on a SELECT and returns
 *     another tenant's rows.
 *   - A route trusts client-supplied `companyId` on an INSERT and
 *     writes into another tenant.
 *
 * We exercise the helpers directly against the live DB rather than
 * the HTTP layer so the test does not depend on session cookies or
 * Express boot. The invariants asserted here are the same ones the
 * Phase-2 architect review flagged as critical.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  companiesTable,
  productsTable,
  categoriesTable,
} from "@workspace/db";
import { ScopedDb } from "./scoped-db";

const RUN_TAG = `vitest-scope-${Date.now()}`;

let companyAId = 0;
let companyBId = 0;
let categoryAId = 0;
let categoryBId = 0;
const createdProductIds: number[] = [];

beforeAll(async () => {
  const [a] = await db
    .insert(companiesTable)
    .values({ name: `Co A ${RUN_TAG}`, baseCurrency: "SAR" })
    .returning();
  const [b] = await db
    .insert(companiesTable)
    .values({ name: `Co B ${RUN_TAG}`, baseCurrency: "SAR" })
    .returning();
  companyAId = a.id;
  companyBId = b.id;

  // Each tenant needs at least one category — products.categoryId is
  // NOT NULL. We create one per company so the FK is satisfied.
  // `categories` is intentionally NOT tenant-scoped (shared lookup
  // table). One shared category satisfies the products FK for both
  // tenants in this test.
  const [catA] = await db
    .insert(categoriesTable)
    .values({ name: `Cat A ${RUN_TAG}`, nameAr: `فئة أ ${RUN_TAG}` })
    .returning();
  const [catB] = await db
    .insert(categoriesTable)
    .values({ name: `Cat B ${RUN_TAG}`, nameAr: `فئة ب ${RUN_TAG}` })
    .returning();
  categoryAId = catA.id;
  categoryBId = catB.id;
});

afterAll(async () => {
  if (createdProductIds.length > 0) {
    await db.delete(productsTable).where(inArray(productsTable.id, createdProductIds));
  }
  const catIds = [categoryAId, categoryBId].filter((n) => n > 0);
  if (catIds.length > 0) {
    await db.delete(categoriesTable).where(inArray(categoriesTable.id, catIds));
  }
  const coIds = [companyAId, companyBId].filter((n) => n > 0);
  if (coIds.length > 0) {
    await db.delete(companiesTable).where(inArray(companiesTable.id, coIds));
  }
});

describe("ScopedDb — constructor invariants", () => {
  it("rejects companyId = 0", () => {
    expect(() => new ScopedDb(0)).toThrow(/invalid companyId/);
  });
  it("rejects negative companyId", () => {
    expect(() => new ScopedDb(-1)).toThrow(/invalid companyId/);
  });
  it("rejects non-integer companyId", () => {
    expect(() => new ScopedDb(1.5)).toThrow(/invalid companyId/);
  });
});

describe("ScopedDb.stamp — override client-supplied tenant", () => {
  it("overrides a client-supplied companyId so a route cannot write into another tenant", () => {
    const scoped = new ScopedDb(companyAId);
    // Simulate a malicious client POST body trying to plant a row in
    // company B by sending companyId in the payload.
    const stamped = scoped.stamp({
      name: "evil",
      categoryId: categoryAId,
      companyId: companyBId, // <- forged
    });
    expect(stamped.companyId).toBe(companyAId);
  });
});

describe("ScopedDb.scope — SELECT filtering", () => {
  it("scope() returns ONLY rows of the bound tenant, never the other", async () => {
    const scopedA = new ScopedDb(companyAId);
    const scopedB = new ScopedDb(companyBId);

    // Insert one product per company, stamped through scoped.stamp
    // so the same code-path that production uses is exercised.
    const [pA] = await db
      .insert(productsTable)
      .values(
        scopedA.stamp({
          name: `Prod A ${RUN_TAG}`,
          nameAr: `منتج أ ${RUN_TAG}`,
          sku: `SKU-A-${RUN_TAG}`,
          categoryId: categoryAId,
          price: "10.00",
          costPrice: "5.00",
        }),
      )
      .returning();
    const [pB] = await db
      .insert(productsTable)
      .values(
        scopedB.stamp({
          name: `Prod B ${RUN_TAG}`,
          nameAr: `منتج ب ${RUN_TAG}`,
          sku: `SKU-B-${RUN_TAG}`,
          categoryId: categoryBId,
          price: "20.00",
          costPrice: "10.00",
        }),
      )
      .returning();
    createdProductIds.push(pA.id, pB.id);

    // Tenant A's scope must see A's product and NEVER B's.
    const aVisible = await db
      .select({ id: productsTable.id })
      .from(productsTable)
      .where(
        and(
          scopedA.scope(productsTable),
          inArray(productsTable.id, [pA.id, pB.id]),
        ),
      );
    expect(aVisible.map((r) => r.id)).toEqual([pA.id]);

    // Tenant B's scope must see B's product and NEVER A's.
    const bVisible = await db
      .select({ id: productsTable.id })
      .from(productsTable)
      .where(
        and(
          scopedB.scope(productsTable),
          inArray(productsTable.id, [pA.id, pB.id]),
        ),
      );
    expect(bVisible.map((r) => r.id)).toEqual([pB.id]);
  });

  it("scoped() composes the tenant filter with extra predicates via AND", async () => {
    const scopedA = new ScopedDb(companyAId);
    // SKU exists only in tenant A — querying it under tenant B's
    // scope must return zero rows, proving the AND is enforced.
    const scopedB = new ScopedDb(companyBId);
    const matchAUnderB = await db
      .select({ id: productsTable.id })
      .from(productsTable)
      .where(scopedB.scoped(productsTable, eq(productsTable.sku, `SKU-A-${RUN_TAG}`)));
    expect(matchAUnderB).toEqual([]);

    const matchAUnderA = await db
      .select({ id: productsTable.id })
      .from(productsTable)
      .where(scopedA.scoped(productsTable, eq(productsTable.sku, `SKU-A-${RUN_TAG}`)));
    expect(matchAUnderA.length).toBe(1);
  });
});
