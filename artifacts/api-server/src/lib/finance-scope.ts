import { db, fiscalYearsTable, reportDefinitionsTable, userCompaniesTable, usersTable } from "@workspace/db";
import { and, eq, or, sql } from "drizzle-orm";

export function fiscalPeriodScope(companyId: number) {
  return sql`fiscal_year_id in (select id from ${fiscalYearsTable} where ${fiscalYearsTable.companyId} = ${companyId})`;
}

export function readableReport(companyId: number, userId: number, role: string | undefined) {
  return and(
    eq(reportDefinitionsTable.companyId, companyId),
    or(
      eq(reportDefinitionsTable.ownerUserId, userId),
      eq(reportDefinitionsTable.sharedWithRole, "all"),
      role ? eq(reportDefinitionsTable.sharedWithRole, role) : sql`false`,
    ),
  );
}

// Workers have no request/session: resolve a current membership in the report's
// company, not the user's global role or whichever company they last selected.
export async function reportMemberRole(companyId: number, userId: number) {
  const [member] = await db.select({ role: userCompaniesTable.role }).from(userCompaniesTable)
    .innerJoin(usersTable, eq(usersTable.id, userCompaniesTable.userId))
    .where(and(eq(userCompaniesTable.companyId, companyId), eq(userCompaniesTable.userId, userId), eq(usersTable.isActive, true)));
  return member?.role;
}
