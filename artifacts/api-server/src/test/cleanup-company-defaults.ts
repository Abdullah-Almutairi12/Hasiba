import { db, shiftsTable, fiscalYearsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

/** Remove only defaults belonging to this suite's synthetic companies. */
export async function cleanupCompanyDefaults(companyIds: number[]): Promise<void> {
  const ids = companyIds.filter((id) => Number.isInteger(id) && id > 0);
  if (ids.length) await db.delete(shiftsTable).where(inArray(shiftsTable.companyId, ids));
  if (ids.length) await db.delete(fiscalYearsTable).where(inArray(fiscalYearsTable.companyId, ids));
}
