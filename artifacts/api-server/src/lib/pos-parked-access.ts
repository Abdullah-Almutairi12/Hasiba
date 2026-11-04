import type {Request} from "express";
import {db,posSessionsTable} from "@workspace/db";
import {eq} from "drizzle-orm";
import {lockApprovalAuthority} from "./approval-authority";
import {assertPosDeviceAuthority} from "./pos-device-authority";
import {posIntentRead} from "./pos-tax-preview";
import {returnAuthorize} from "./return-access";
import {FinancialRequestError} from "./financial-transaction";
type Tx=Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Same source policy for listing, claiming and recovering a parked basket. */
export async function authorizeParkedSource(tx:Tx,req:Request,sessionId:number){
  await lockApprovalAuthority(tx);
  await assertPosDeviceAuthority(tx);
  await posIntentRead(tx,req,{sessionId},null);
  const [shift]=await tx.select().from(posSessionsTable).where(eq(posSessionsTable.id,sessionId)).limit(1);
  if(!shift)throw new FinancialRequestError("الوردية غير متاحة",403);
  const actor=await returnAuthorize(req.session.userId!,req.session.companyId!,"view",shift.branchId,tx);
  if(!["owner","manager"].includes(actor.role)&&shift.cashierUserId!==req.session.userId)
    throw new FinancialRequestError("هذه الوردية ليست للكاشير الحالي",403);
  return shift;
}
