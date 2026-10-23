import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db, companiesTable, customersTable } from "@workspace/db";
import { ensurePosWalkinCustomer } from "./pos-walkin-customer";

let companyA: number;
let companyB: number;
const defaults = (companyId: number) => db.select().from(customersTable).where(and(
  eq(customersTable.companyId, companyId), eq(customersTable.taxNumber, "POS-WALKIN"),
));
beforeAll(async () => {
  const stamp = Date.now();
  const companies = await db.insert(companiesTable).values([
    { name: `POS default A ${stamp}` }, { name: `POS default B ${stamp}` },
  ]).returning();
  [companyA, companyB] = companies.map((company) => company.id);
});
afterAll(async () => {
  const ids = [companyA, companyB].filter(Boolean);
  await db.delete(customersTable).where(inArray(customersTable.companyId, ids));
  await db.delete(companiesTable).where(inArray(companiesTable.id, ids));
});
describe("POS walk-in defaults follow explicit tenant scope", () => {
  it("rolls default creation back with its enclosing financial transaction", async () => {
    await expect(db.transaction(async (tx) => {
      await ensurePosWalkinCustomer(tx, companyA);
      throw new Error("Synthetic checkout rollback");
    })).rejects.toThrow("Synthetic checkout rollback");
    expect(await defaults(companyA)).toHaveLength(0);
  });
  it("creates exactly one customer for concurrent first checkouts", async () => {
    const results = await Promise.all(Array.from({ length: 4 }, () =>
      db.transaction((tx) => ensurePosWalkinCustomer(tx, companyA))));
    expect(new Set(results.map((row) => row.id)).size).toBe(1);
    expect(await defaults(companyA)).toHaveLength(1);
    expect(await defaults(companyB)).toHaveLength(0);
  });
  it("never reuses another company's walk-in customer", async () => {
    const own = await db.transaction((tx) => ensurePosWalkinCustomer(tx, companyB));
    const other = await defaults(companyA);
    expect(own.id).not.toBe(other[0].id);
    expect(await defaults(companyB)).toHaveLength(1);
  });
  it("rejects missing or invalid tenant scope", async () => {
    await expect(db.transaction((tx) => ensurePosWalkinCustomer(tx, 0))).rejects.toThrow("Invalid company scope");
  });
});
