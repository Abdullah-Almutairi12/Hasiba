import type {Request} from "express";
import {sql} from "drizzle-orm";
import {z} from "zod";
import {closedFinancialIntent,financialTransaction,isClosedFinancialIntent} from "./financial-transaction";
import {lockApprovalAuthority} from "./approval-authority";
import {getCompanyId} from "./scoped-db";
import type {DbOrTx} from "./journal-posting";

const inputSchema=z.object({requestKey:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$/),
  body:z.record(z.string(),z.unknown())}).strict();
/** Reuse the ORIGINAL engine, fingerprint, receipt and transaction fence.
 * No absence-only "cancel", new ledger, changed body or expiring tombstone. */
export async function closeSaleIntent(req:Request,path:"/pos/orders"|"/sales/invoices",
  authorize:(tx:DbOrTx,body:Record<string,unknown>,saved:unknown)=>Promise<void>){
  const input=inputSchema.parse(req.body);
  const original=Object.create(req) as Request;
  Object.defineProperties(original,{
    body:{value:input.body},route:{value:{path}},params:{value:{}},query:{value:{}},
    headers:{value:{...req.headers,"idempotency-key":input.requestKey}},
  });
  const saved=await financialTransaction<unknown>(original,async tx=>{
    await lockApprovalAuthority(tx);
    await authorize(tx,input.body,null);
    await tx.execute(sql`INSERT INTO audit_logs(company_id,user_id,user_name,action,entity,details)
      SELECT ${getCompanyId(req)},id,name,'sale.intent.closed','financial_request',
      ${JSON.stringify({requestKey:input.requestKey,operation:path})} FROM users WHERE id=${req.session.userId!}`);
    return closedFinancialIntent;
  },async(tx,result)=>{
    await lockApprovalAuthority(tx);
    await authorize(tx,input.body,isClosedFinancialIntent(result)?null:result);
  },{acceptClosedReceipt:true});
  return isClosedFinancialIntent(saved)?{state:"closed_without_execution" as const}:
    {state:"completed" as const,result:saved};
}
