import { db, userCompaniesTable, usersTable, companiesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { isRole } from "../middlewares/require-role";
import type { DbOrTx } from "./journal-posting";

export async function workflowMember(companyId: number, userId: number, connection: DbOrTx = db) {
  const [member] = await connection.select({ id: usersTable.id, role: userCompaniesTable.role, branchId: usersTable.branchId })
    .from(userCompaniesTable)
    .innerJoin(usersTable, eq(usersTable.id, userCompaniesTable.userId))
    .innerJoin(companiesTable, eq(companiesTable.id, userCompaniesTable.companyId))
    .where(and(eq(userCompaniesTable.companyId, companyId), eq(userCompaniesTable.userId, userId),
      eq(usersTable.isActive, true), eq(companiesTable.isActive, true))).limit(1);
  return member && isRole(member.role) ? member : null;
}

export async function assertWorkflowMember(companyId: number, userId: number, connection: DbOrTx = db) {
  const member = await workflowMember(companyId, userId, connection);
  if (!member) throw Object.assign(new Error("العضو غير متاح في الشركة"), { status: 404 });
  return member;
}
