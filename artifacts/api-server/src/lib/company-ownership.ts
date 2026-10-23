import { db, userCompaniesTable, usersTable } from "@workspace/db";
import { and, eq, ne } from "drizzle-orm";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Caller must hold the company's row lock while changing its owner roster. */
export async function assertAnotherActiveOwner(tx: Transaction, companyId: number, userId: number) {
  const [other] = await tx.select({ id: userCompaniesTable.id }).from(userCompaniesTable)
    .innerJoin(usersTable, eq(usersTable.id, userCompaniesTable.userId))
    .where(and(eq(userCompaniesTable.companyId, companyId), eq(userCompaniesTable.role, "owner"),
      ne(userCompaniesTable.userId, userId), eq(usersTable.isActive, true))).limit(1);
  if (!other) {
    throw Object.assign(new Error("لا يمكن إزالة أو تخفيض صلاحية آخر مالك نشط للشركة"), { status: 409 });
  }
}
