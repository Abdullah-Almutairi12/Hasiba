import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { administrativeRights, adminRows, LEGACY_ADMIN_RESPONSIBILITIES, initializeLegacyAdministration } from "./administration-authority";
import { lockApprovalAuthorityWrite } from "./approval-authority";
import { FinancialRequestError } from "./financial-transaction";

/** Never infer this responsibility from a legacy role, a session, or global identity. */
export async function isPrimarySystemOwner(companyId:number,userId:number,tx:Pick<typeof db,"execute">=db) {
  const result=await tx.execute(sql`SELECT 1 FROM company_administrators ca
    JOIN user_companies uc ON uc.company_id=ca.company_id AND uc.user_id=ca.user_id AND uc.role='owner'
    JOIN users u ON u.id=uc.user_id AND u.is_active JOIN companies c ON c.id=uc.company_id AND c.is_active
    WHERE ca.company_id=${companyId} AND ca.user_id=${userId} AND ca.primary_owner AND ca.active
    AND NOT EXISTS(SELECT 1 FROM employee_access a LEFT JOIN employees e ON e.id=a.employee_id
      WHERE a.company_id=ca.company_id AND a.user_id=ca.user_id
      AND (a.status<>'active' OR e.user_id IS DISTINCT FROM u.id
        OR e.status NOT IN ('active','on_leave','probation','preboarding')))`);
  return result.rows.length>0;
}
export async function primaryOwnerStatus(companyId:number,userId:number) {
  const [owner]=await adminRows(db,sql`SELECT user_id FROM company_administrators WHERE company_id=${companyId} AND primary_owner`);
  const [actor]=await adminRows(db,sql`SELECT uc.role,ca.may_appoint_primary_owner FROM user_companies uc
    LEFT JOIN company_administrators ca ON ca.company_id=uc.company_id AND ca.user_id=uc.user_id
    WHERE uc.company_id=${companyId} AND uc.user_id=${userId}`);
  const rights=await administrativeRights(companyId,userId);
  return {primaryOwnerId:owner?.user_id??null,isPrimaryOwner:await isPrimarySystemOwner(companyId,userId),
    canAppointPrimaryOwner:!owner&&!!actor&&(actor.role==="owner"||actor.may_appoint_primary_owner===true)&&
      LEGACY_ADMIN_RESPONSIBILITIES.every(r=>rights.includes(r))};
}
export async function appointFirstPrimaryOwner(companyId:number,userId:number) {
  return db.transaction(async tx=>{
    await lockApprovalAuthorityWrite(tx);
    await tx.execute(sql`SELECT id FROM companies WHERE id=${companyId} FOR UPDATE`);
    await initializeLegacyAdministration(tx,companyId);
    const [owner]=await adminRows(tx,sql`SELECT user_id FROM company_administrators WHERE company_id=${companyId} AND primary_owner`);
    if(owner) {
      if(owner.user_id===userId&&await isPrimarySystemOwner(companyId,userId,tx))return {ok:true};
      throw new FinancialRequestError("يوجد مالك نظام؛ استخدم نقل المسؤولية المقبول من البديل",409);
    }
    const [actor]=await adminRows(tx,sql`SELECT uc.role,ca.may_appoint_primary_owner FROM user_companies uc
      LEFT JOIN company_administrators ca ON ca.company_id=uc.company_id AND ca.user_id=uc.user_id
      WHERE uc.company_id=${companyId} AND uc.user_id=${userId}`);
    const rights=await administrativeRights(companyId,userId,tx);
    if(!actor||(actor.role!=="owner"&&!actor.may_appoint_primary_owner)||!LEGACY_ADMIN_RESPONSIBILITIES.every(r=>rights.includes(r)))
      throw new FinancialRequestError("يلزم تعيين صريح من الجهة المشتركة المخوّلة؛ لم يُستنتج مالك من الدور القديم",403);
    await tx.execute(sql`UPDATE user_companies SET role='owner' WHERE company_id=${companyId} AND user_id=${userId}`);
    await tx.execute(sql`UPDATE company_administrators SET primary_owner=true,may_appoint_primary_owner=false,
      revision=revision+1,updated_at=now() WHERE company_id=${companyId} AND user_id=${userId} AND active`);
    await tx.execute(sql`INSERT INTO audit_logs(company_id,user_id,user_name,entity,action,details)
      SELECT ${companyId},id,name,'company_administrator','system_owner.appointed',
      '{"explicitAcceptance":true,"legalOwnershipClaim":false}' FROM users WHERE id=${userId}`);
    return {ok:true};
  });
}
