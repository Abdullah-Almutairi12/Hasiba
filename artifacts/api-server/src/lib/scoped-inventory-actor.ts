import type { Request } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { FinancialRequestError } from "./financial-transaction";
import { getCompanyId } from "./scoped-db";
import { managedProfile, requireResponsibility, type Responsibility } from "./responsibility-context";
import { teamRows } from "./team-store";

export type InventoryConnection=Pick<typeof db,"execute">;
export type InventoryActor={userId:number;companyId:number;name:string;role:string;grant:Responsibility|null};

/** For writes, call after the shared authority fence and before source/stock locks. */
export async function inventoryActor(connection:InventoryConnection,req:Request,action:string|null):Promise<InventoryActor> {
  const companyId=getCompanyId(req),userId=req.session.userId!;
  const denied=()=>new FinancialRequestError("الحساب أو المنحة الحالية غير مؤهلين لفعل المخزون المطلوب",403);
  const [actor]=await teamRows<{name:string;role:string}>(connection,sql`
    SELECT u.name,uc.role FROM users u JOIN user_companies uc ON uc.user_id=u.id AND uc.company_id=${companyId}
    JOIN companies c ON c.id=uc.company_id AND c.is_active
    WHERE u.id=${userId} AND u.is_active
    ${action?sql`FOR SHARE OF u,uc,c`:sql``}`);
  if(!actor)throw denied();
  const profile=await managedProfile(userId,companyId,connection);
  const grant=profile?await requireResponsibility(action??"inventory.read",connection):null;
  if(grant&&grant.resource!=="inventory")throw denied();
  if(action&&!grant&&!["owner","manager","inventory"].includes(actor.role))throw denied();
  return {userId,companyId,name:actor.name,role:actor.role,grant};
}

/** Record identity/source only; never copy an arbitrary request body into audit. */
export async function auditInventoryMutation(connection:InventoryConnection,actor:InventoryActor,action:string,entity:string,id:number){
 await connection.execute(sql`INSERT INTO audit_logs(user_id,user_name,company_id,action,entity,details)
  VALUES(${actor.userId},${actor.name},${actor.companyId},${action},${entity},
   jsonb_build_object('id',${id}::integer,'membershipRole',${actor.role}::text,
    'responsibilityId',${actor.grant?.id??null}::integer)::text)`);
}
