import { sql, type SQL } from "drizzle-orm";
import { db } from "@workspace/db";
import type { DbOrTx } from "./journal-posting";
import { FinancialRequestError } from "./financial-transaction";

export const ADMIN_RESPONSIBILITIES = ["users","administrators","settings","subscription","contact","tax"] as const;
export const LEGACY_ADMIN_RESPONSIBILITIES = ADMIN_RESPONSIBILITIES.filter(r=>r!=="tax");
export type AdminResponsibility = typeof ADMIN_RESPONSIBILITIES[number];
export async function adminRows<T = Record<string, any>>(tx: DbOrTx, query: SQL): Promise<T[]> {
  return (await tx.execute(query)).rows as T[];
}
export async function administrativeRights(companyId: number, userId: number, tx: DbOrTx = db): Promise<string[]> {
  const [row] = await adminRows(tx, sql`
    SELECT uc.role,a.active,a.responsibilities,
      EXISTS(SELECT 1 FROM company_administrators ca WHERE ca.company_id=uc.company_id) AS roster_initialized,
      EXISTS(SELECT 1 FROM employee_access e WHERE e.company_id=uc.company_id AND e.user_id=u.id) AS managed,
      NOT EXISTS(SELECT 1 FROM employee_access a JOIN employees e ON e.id=a.employee_id
        WHERE a.company_id=uc.company_id AND a.user_id=u.id AND
          (a.status<>'active' OR e.user_id IS DISTINCT FROM u.id OR e.status NOT IN ('active','on_leave','probation','preboarding'))) AS enabled
    FROM user_companies uc JOIN users u ON u.id=uc.user_id AND u.is_active
    JOIN companies c ON c.id=uc.company_id AND c.is_active
    LEFT JOIN company_administrators a ON a.company_id=uc.company_id AND a.user_id=u.id
    WHERE uc.company_id=${companyId} AND u.id=${userId}`);
  if (!row?.enabled) return [];
  // An explicit disabled row overrides legacy owner administration, not finance.
  if (row.active != null) return row.active ? row.responsibilities : [];
  return !row.roster_initialized && row.role === "owner" && !row.managed ? [...LEGACY_ADMIN_RESPONSIBILITIES] : [];
}
/** Compatibility for old company-creation/import flows, before its FIRST roster.
 * Once explicit administration exists, a new owner role never implies administration. */
export async function initializeLegacyAdministration(tx:DbOrTx,companyId:number) {
  await tx.execute(sql`INSERT INTO company_administrators(company_id,user_id,responsibilities)
    SELECT uc.company_id,uc.user_id,${sql.param([...LEGACY_ADMIN_RESPONSIBILITIES])}::text[] FROM user_companies uc
    WHERE uc.company_id=${companyId} AND uc.role='owner'
    AND NOT EXISTS(SELECT 1 FROM company_administrators ca WHERE ca.company_id=${companyId})
    AND NOT EXISTS(SELECT 1 FROM employee_access a WHERE a.company_id=uc.company_id AND a.user_id=uc.user_id)`);
}
export async function requireAdministrative(companyId: number, userId: number, responsibility: AdminResponsibility, tx: DbOrTx = db) {
  if (!(await administrativeRights(companyId,userId,tx)).includes(responsibility))
    throw new FinancialRequestError("المسؤولية الإدارية غير ممنوحة أو لم تعد فعالة في هذه المنشأة",403);
  const [actor] = await adminRows<{name:string}>(tx,sql`SELECT name FROM users WHERE id=${userId}`);
  return actor;
}
/** Narrow adapter for old role-gated administration. Preserve unmigrated
 * non-owner role behavior; an explicit roster/override must never be bypassed
 * merely because a legacy financial owner/manager role was retained. */
export async function checkLegacyAdministrativeBoundary(companyId:number,userId:number,capability:AdminResponsibility,tx:DbOrTx=db) {
  const [row]=await adminRows(tx,sql`SELECT uc.role,a.user_id FROM user_companies uc
    LEFT JOIN company_administrators a ON a.company_id=uc.company_id AND a.user_id=uc.user_id
    WHERE uc.company_id=${companyId} AND uc.user_id=${userId}`);
  if(row && (row.role==="owner"||row.user_id!=null)) await requireAdministrative(companyId,userId,capability,tx);
}
/** Call under authority writer fence + company row lock before ANY membership/access downgrade. */
export async function protectLastAdministrator(tx: DbOrTx, companyId: number, userId: number) {
  const [primary]=await adminRows(tx,sql`SELECT user_id FROM company_administrators
    WHERE company_id=${companyId} AND user_id=${userId} AND primary_owner`);
  if(primary)throw new FinancialRequestError("لا يمكن تعطيل أو إزالة مالك النظام الرئيسي؛ انقل مسؤوليته إلى بديل مفعّل يقبل الاستلام أولًا",409);
  if (!(await administrativeRights(companyId,userId,tx)).includes("administrators")) return;
  const candidates = await adminRows<{user_id:number}>(tx,sql`SELECT user_id FROM user_companies
    WHERE company_id=${companyId} AND user_id<>${userId}`);
  for(const candidate of candidates) {
    if ((await administrativeRights(companyId,candidate.user_id,tx)).includes("administrators")) return;
  }
  throw new FinancialRequestError("لا يمكن إزالة أو تعليق آخر مدير نظام نشط؛ يلزم بديل مفعّل ومخوّل",409);
}
