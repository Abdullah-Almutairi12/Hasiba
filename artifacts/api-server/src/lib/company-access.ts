import { db, branchesTable } from "@workspace/db";
import { and, eq, inArray, type AnyColumn } from "drizzle-orm";

export class CompanyAccessError extends Error {
  readonly status = 404;
  constructor() {
    super("not_found");
  }
}

export function companyBranches(companyId: number) {
  if (!Number.isSafeInteger(companyId) || companyId <= 0) throw new CompanyAccessError();
  return db.select({ id: branchesTable.id }).from(branchesTable)
    .where(eq(branchesTable.companyId, companyId));
}

export function branchScope(column: AnyColumn, companyId: number) {
  return inArray(column, companyBranches(companyId));
}

// Branchless legacy configuration has no provable tenant owner. Fail closed.
export async function assertCompanyBranch(branchId: number | null | undefined, companyId: number) {
  if (!branchId) throw new CompanyAccessError();
  const [branch] = await db.select({ id: branchesTable.id }).from(branchesTable)
    .where(and(eq(branchesTable.id, branchId), eq(branchesTable.companyId, companyId)));
  if (!branch) throw new CompanyAccessError();
}

export async function resolveCompanyBranch(branchId: number | null | undefined, companyId: number) {
  if (branchId != null) {
    await assertCompanyBranch(branchId, companyId);
    return branchId;
  }
  const [branch] = await db.select({ id: branchesTable.id }).from(branchesTable)
    .where(and(eq(branchesTable.companyId, companyId), eq(branchesTable.isActive, true)))
    .orderBy(branchesTable.id).limit(1);
  if (!branch) throw new CompanyAccessError();
  return branch.id;
}
