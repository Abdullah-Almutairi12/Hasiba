import { db, userCompaniesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

/**
 * Ensure the calling user is actually a member of the company they are
 * trying to link a customer/supplier to. Without this guard the write
 * endpoints would accept any global `companies.id`, which would (a) let
 * a malicious caller wire intercompany mirrors into tenants they don't
 * belong to and (b) leak the target company's name back via the
 * subsequent `linkedCompanyName` join in the listing endpoints.
 *
 * Returns `null` for "no link" inputs (undefined / null) so the caller
 * can short-circuit without special-casing. Throws a tagged Error on
 * unauthorized link attempts — `handleRouteError` maps `code:"forbidden"`
 * to a 403 response.
 *
 * @param userId Caller's session user id.
 * @param linkedCompanyId The candidate sibling company id from the body.
 */
export async function assertLinkedCompanyAllowed(
  userId: number,
  linkedCompanyId: number | null | undefined,
): Promise<number | null> {
  if (linkedCompanyId == null) return null;
  const [row] = await db
    .select({ companyId: userCompaniesTable.companyId })
    .from(userCompaniesTable)
    .where(
      and(
        eq(userCompaniesTable.userId, userId),
        eq(userCompaniesTable.companyId, linkedCompanyId),
      ),
    )
    .limit(1);
  if (!row) {
    const err = new Error("لا يمكن الربط بشركة لا تملك صلاحية الوصول إليها");
    (err as Error & { code?: string; status?: number }).code = "forbidden";
    (err as Error & { code?: string; status?: number }).status = 403;
    throw err;
  }
  return linkedCompanyId;
}
