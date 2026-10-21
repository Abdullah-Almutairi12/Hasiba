import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, companiesTable, branchesTable, warehousesTable, shiftsTable } from "@workspace/db";
import { initInventory } from "./inventory-init";
import { initHr } from "./hr-init";
import { provisionNewCompany } from "./company-service";

let companyA: number;
let companyB: number;
beforeAll(async () => {
  const tag = `provision-${Date.now()}`;
  const [a, b] = await db.insert(companiesTable).values([{ name: `${tag}-A` }, { name: `${tag}-B` }]).returning();
  companyA = a.id;
  companyB = b.id;
  await db.insert(branchesTable).values([
    { companyId: companyA, name: tag, nameAr: tag, city: "Test" },
    { companyId: companyB, name: tag, nameAr: tag, city: "Test" },
  ]);
});
const shifts = (id: number) => db.select().from(shiftsTable).where(eq(shiftsTable.companyId, id));
const warehouses = (id: number) => db.select().from(warehousesTable).where(eq(warehousesTable.companyId, id));

describe("explicit tenant provisioning, not startup mutation", () => {
  it("initialization without a company ID leaves existing tenant defaults untouched", async () => {
    await initInventory();
    await initHr();
    expect(await shifts(companyA)).toHaveLength(0);
    expect(await shifts(companyB)).toHaveLength(0);
    expect(await warehouses(companyA)).toHaveLength(0);
    expect(await warehouses(companyB)).toHaveLength(0);
  });
  it("provisions only the requested company and is idempotent", async () => {
    await provisionNewCompany(companyA);
    await provisionNewCompany(companyA);
    expect(await shifts(companyA)).toHaveLength(1);
    expect(await warehouses(companyA)).toHaveLength(1);
    expect(await shifts(companyB)).toHaveLength(0);
    expect(await warehouses(companyB)).toHaveLength(0);
  });
});
