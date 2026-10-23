import { db, customersTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Explicit tenant-owned default, never a customer borrowed from another tenant. */
export async function ensurePosWalkinCustomer(tx: Transaction, companyId: number) {
  if (!Number.isSafeInteger(companyId) || companyId <= 0) throw new Error("Invalid company scope");
  const find = () => tx.select({ id: customersTable.id, name: customersTable.name })
    .from(customersTable)
    .where(and(eq(customersTable.companyId, companyId), eq(customersTable.taxNumber, "POS-WALKIN")))
    .orderBy(customersTable.id).limit(1);
  const [existing] = await find();
  if (existing) return existing;
  // Multiple tills may be the first sale for this company. Serialize creation
  // without imposing a globally unique "tax number" on unrelated customers.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`pos-walkin:${companyId}`}, 0))`);
  const [createdByAnotherTill] = await find();
  if (createdByAnotherTill) return createdByAnotherTill;
  const [created] = await tx.insert(customersTable).values({
    companyId, name: "عميل نقدي - نقطة بيع", taxNumber: "POS-WALKIN",
    segment: "retail", paymentTermsDays: 0, creditLimit: "0",
  }).returning({ id: customersTable.id, name: customersTable.name });
  return created;
}
