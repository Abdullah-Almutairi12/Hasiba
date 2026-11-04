import type {Request} from "express";
import {and,eq,sql} from "drizzle-orm";
import {db,financialRequestsTable} from "@workspace/db";
import {FinancialRequestError,restore,snapshot} from "./financial-transaction";
import {getCompanyId} from "./scoped-db";
import {authorizeParkedSource} from "./pos-parked-access";
import {posIntentRead} from "./pos-tax-preview";
import {assertCurrentBasket,currentBasket,type BasketFacts} from "./pos-resumed-basket";

type Tx=Parameters<Parameters<typeof db.transaction>[0]>[0];
export type ResumedDraft={id:number;sessionId:number;requestId:string;version?:number};
// Uses the existing permanent outcome store, not a second sale engine. The
// source lock is independent of BOTH transport keys, so cloned tabs serialize.
export async function lockResumedSale<T>(tx:Tx,req:Request,source:ResumedDraft|undefined,sessionId:number){
  if(!source)return null;
  const companyId=getCompanyId(req),userId=req.session.userId!;
  await authorizeParkedSource(tx,req,source.sessionId);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(["pos-resumed-sale",companyId,source.id])},0))`);
  await authorizeParkedSource(tx,req,source.sessionId);
  const [claim]=await tx.select().from(financialRequestsTable).where(and(
    eq(financialRequestsTable.companyId,companyId),eq(financialRequestsTable.userId,userId),
    eq(financialRequestsTable.operation,`POST:${req.baseUrl}:/pos/orders/:id/resume`),
    eq(financialRequestsTable.requestKey,source.requestId)));
  const result=claim?restore<{id:number;sessionId:number;requestId:string;state:string}&BasketFacts>(claim.result as Parameters<typeof restore>[0]):null;
  if(!result||result.state!=="resumed"||result.id!==source.id||result.sessionId!==source.sessionId||result.requestId!==source.requestId)
    throw new FinancialRequestError("تعذر إثبات استرجاع هذه المسودة؛ احتفظ بالمحاولة الأصلية وتحقق منها.",409);
  if(sessionId!==source.sessionId)
    throw new FinancialRequestError(`المسودة تخص الوردية #${source.sessionId}؛ لا يمكن تحصيلها على وردية أخرى.`,409);
  const operation="pos:resumed-sale:v1",requestKey=`draft:${source.id}`;
  const [sale]=await tx.select().from(financialRequestsTable).where(and(
    eq(financialRequestsTable.companyId,companyId),eq(financialRequestsTable.operation,operation),
    eq(financialRequestsTable.requestKey,requestKey)));
  const previous=sale?restore<T>(sale.result as Parameters<typeof restore>[0]):null;
  if(previous)await posIntentRead(tx,req,{sessionId:source.sessionId},previous);
  return {
    previous,
    current:()=>currentBasket(tx,req,source,result),
    save:async(value:T)=>{
      await tx.insert(financialRequestsTable).values({companyId,userId,operation,requestKey,
        requestHash:source.requestId,result:snapshot(value)});
      await tx.execute(sql`INSERT INTO audit_logs(company_id,user_id,user_name,action,entity,details)
        SELECT ${companyId},id,name,'pos.park.finalized',${`pos_order#${source.id}`},
        ${JSON.stringify({source,orderId:(value as {order?:{id?:number}})?.order?.id})}
        FROM users WHERE id=${userId}`);
    },
  };
}

export async function withResumedSale<T>(tx:Tx,req:Request,source:ResumedDraft|undefined,sessionId:number,work:()=>Promise<T>,facts:BasketFacts):Promise<T>{
  const claim=await lockResumedSale<T>(tx,req,source,sessionId);
  if(claim?.previous){
    req.res?.setHeader("Idempotency-Replayed","true");
    req.res?.setHeader("X-POS-Already-Finalized","true");
    return claim.previous;
  }
  if(claim&&source)assertCurrentBasket(source,await claim.current(),facts);
  const result=await work();
  await claim?.save(result);
  return result;
}
