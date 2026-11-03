import type { Request } from "express";
import { db, usersTable, userCompaniesTable, companiesTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import type { DbOrTx } from "./journal-posting";
import { FinancialRequestError } from "./financial-transaction";
import { managedProfile, selectedResponsibility } from "./responsibility-context";

/** Directory authority never confers invoice, credit or receipt access. */
export async function customerDirectoryActor(req: Request, write: boolean, tx: DbOrTx = db) {
  const userId = req.session.userId!, companyId = req.session.companyId!;
  const [member] = await tx.select({ role: userCompaniesTable.role })
    .from(userCompaniesTable).innerJoin(usersTable, eq(usersTable.id, userCompaniesTable.userId))
    .innerJoin(companiesTable, eq(companiesTable.id, userCompaniesTable.companyId))
    .where(and(eq(userCompaniesTable.userId, userId), eq(userCompaniesTable.companyId, companyId),
      eq(usersTable.isActive, true), eq(companiesTable.isActive, true))).for("share");
  if (!member) throw new FinancialRequestError("ليس لديك وصول إلى الشركة", 403);
  const profile = await managedProfile(userId, companyId, tx);
  const grant = profile ? await selectedResponsibility(userId, companyId, tx) : null;
  if (profile) {
    if (!grant || grant.resource !== "sales" || !grant.actions.includes("sales.customers.read") ||
      write && !grant.actions.includes("sales.customers.create"))
      throw new FinancialRequestError("يلزم منح صريح لدليل العملاء وإنشائهم؛ عرض الفواتير لا يكفي", 403);
  } else if (!(write ? ["owner", "manager", "sales"] :
    ["owner", "manager", "accountant", "sales", "cashier", "marketing", "auditor"]).includes(member.role)) {
    throw new FinancialRequestError("صلاحية دليل العملاء غير متاحة", 403);
  }
  const owners = await tx.execute(sql`SELECT u.admin_prefs FROM user_companies uc
    JOIN users u ON u.id=uc.user_id WHERE uc.company_id=${companyId} AND uc.role='owner'
    ORDER BY uc.id LIMIT 1 FOR SHARE OF u,uc`);
  const prefs = owners.rows[0]?.admin_prefs as { auditConsent?: { customerPii?: boolean } } | undefined;
  // No hidden customers may be disclosed through matching or replay.
  if (member.role !== "owner" && prefs?.auditConsent?.customerPii === false)
    throw new FinancialRequestError("خصوصية بيانات العملاء تمنع معاينة الدليل واسترجاع بياناته حاليًا", 403);
  return { userId, companyId, grant };
}
