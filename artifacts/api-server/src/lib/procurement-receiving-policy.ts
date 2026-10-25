import {db} from "@workspace/db";
import {sql} from "drizzle-orm";
import type {DbOrTx} from "./journal-posting";
import {adminRows,requireAdministrative} from "./administration-authority";
import {withAccountProof,type AccountProof} from "./account-security";
import {FinancialRequestError} from "./financial-transaction";
import {teamPolicy} from "./team-store";
import {procurementActor,type ProcurementActor} from "./procurement-authority";
import type {Request} from "express";

export async function receivingPolicy(companyId:number,tx:DbOrTx=db) {
  const [row]=await adminRows(tx,sql`SELECT procurement_receiving_policy AS policy FROM team_access_policy WHERE company_id=${companyId}`);
  return {allowCreator:row?.policy?.allowCreator===true,revision:Number(row?.policy?.revision??0)};
}
export async function changeReceivingPolicy(req:Request,input:{allowCreator:boolean;revision:number;proof:AccountProof}) {
  const companyId=req.session.companyId!,userId=req.session.userId!;
  await requireAdministrative(companyId,userId,"settings");
  return withAccountProof(req,input.proof,async(tx)=>{
    await requireAdministrative(companyId,userId,"settings",tx);
    const before=await receivingPolicy(companyId,tx);
    if(before.revision!==input.revision)throw new FinancialRequestError("تغيرت السياسة؛ أعد تحميلها قبل التأكيد",409);
    const after={allowCreator:input.allowCreator,revision:before.revision+1};
    const existing=await teamPolicy(companyId,tx);
    await tx.execute(sql`INSERT INTO team_access_policy(company_id,enabled_modules,seat_limit,source,updated_by,procurement_receiving_policy)
      VALUES(${companyId},${sql.param(existing.enabledModules)}::text[],${existing.seatLimit},${existing.source},${userId},${JSON.stringify(after)}::jsonb)
      ON CONFLICT(company_id) DO UPDATE SET procurement_receiving_policy=excluded.procurement_receiving_policy,
        updated_by=excluded.updated_by,updated_at=clock_timestamp()`);
    await tx.execute(sql`INSERT INTO audit_logs(company_id,user_id,user_name,action,entity,details)
      SELECT ${companyId},id,name,'procurement.receiving_policy.changed','team_access_policy',
        ${JSON.stringify({before,after,identityConfirmed:true})} FROM users WHERE id=${userId}`);
    return after;
  },true);
}
/** Caller holds the authority reader fence and source-order lock. Policy
 * writers use the same writer fence via account proof, before account rows. */
export async function assertCreatorReceiving(actor:ProcurementActor,createdBy:number|null,tx:DbOrTx) {
  if(createdBy!==actor.userId)return;
  if(!(await receivingPolicy(actor.companyId,tx)).allowCreator)
    throw new FinancialRequestError("لا يمكن استلام بضاعة على أمر شراء قمت بإنشائه (مبدأ فصل المهام). سياسة المنشأة تشترط مستلمًا مختلفًا.",403);
  const explicit=await procurementActor(tx,actor.userId,actor.companyId,"procurement.receipts.receive_self");
  if(!explicit.grant || explicit.grant.id!==actor.grant?.id)
    throw new FinancialRequestError("يلزم إذن صريح لاستلام أوامر الشراء التي أنشأتها ضمن المسؤولية الحالية",403);
}
