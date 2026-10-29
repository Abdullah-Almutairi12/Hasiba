import {sql} from "drizzle-orm";
import type {Request} from "express";
import {FinancialRequestError} from "./financial-transaction";
import {getCompanyId} from "./scoped-db";
import type {DbOrTx} from "./journal-posting";
import {applyDiscountRules,applyLineDiscountRules,computeTotals,resolvePrice,type SalesLineInput} from "./sales-engine";
import {calculatePolicySale,publicTaxContext,riyadhDate,taxContext} from "./vat-policy";
import {managedProfile} from "./responsibility-context";
import {returnActor} from "./return-access";

export async function directInvoiceTaxAuthority(req:Request,tx:DbOrTx){
  const cid=getCompanyId(req),uid=req.session.userId!;
  const actor=await returnActor(uid,cid,tx);
  if(await managedProfile(uid,cid,tx)||!["owner","manager","accountant"].includes(actor.role))
    throw new FinancialRequestError("سُحبت صلاحية إصدار الفاتورة؛ لم تنفذ العملية",403);
}
export async function prepareDirectInvoiceTax(tx:DbOrTx,req:Request,body:{
  customerId?:number;branchId?:number|null;invoiceDate?:string;orderDiscount:number;
  lines?:Array<{productId?:number|null;description:string;quantity:number;unitPrice?:number;discountPct:number;taxRate:number}>;
}){
  const cid=getCompanyId(req);
  const customer=(await tx.execute(sql`SELECT id FROM customers WHERE id=${body.customerId??-1} AND company_id=${cid}`)).rows[0];
  if(!customer)throw new FinancialRequestError("العميل غير متاح للمنشأة",404);
  if(body.branchId!=null&&!(await tx.execute(sql`SELECT id FROM branches WHERE id=${body.branchId} AND company_id=${cid}`)).rows.length)
    throw new FinancialRequestError("الفرع غير متاح للمنشأة",404);
  if(!body.lines?.length)throw new FinancialRequestError("يجب إدخال بنود الفاتورة",422);
  const enriched:SalesLineInput[]=[];
  for(const ln of body.lines){
    if(ln.productId!=null&&!(await tx.execute(sql`SELECT id FROM products WHERE id=${ln.productId} AND company_id=${cid}`)).rows.length)
      throw new FinancialRequestError("أحد الأصناف غير متاح للمنشأة",404);
    let unitPrice=ln.unitPrice??0;
    if(unitPrice===0&&ln.productId)unitPrice=(await resolvePrice(tx,{productId:ln.productId,pricelistId:null,quantity:ln.quantity})).unitPrice;
    enriched.push({...ln,unitPrice});
  }
  const beforeRules=enriched.map(l=>({...l}));
  const lineSteps:Array<{id:number;lines:SalesLineInput[]}>=[];
  const lineRules=await applyLineDiscountRules(tx,enriched,(r,lines)=>lineSteps.push({id:r.id,lines}));
  const baseNet=enriched.reduce((a,l)=>a+l.quantity*l.unitPrice*(1-(l.discountPct??0)/100),0);
  const ruleResult=await applyDiscountRules(tx,{baseNet:Math.max(0,baseNet-body.orderDiscount),scope:"order"});
  const at=body.invoiceDate??riyadhDate(),context=await taxContext(cid,at,tx);
  if(!context.registered)for(const ln of enriched)ln.taxRate=0;
  const discount=body.orderDiscount+ruleResult.discountAmount;
  const policySale=await calculatePolicySale(tx,cid,at,enriched,discount);
  const totals=policySale?.totals??computeTotals(enriched,discount);
  if(policySale){
    // Inclusive discounts are gross inputs, not gross GL debits. Replay the
    // existing rule steps through the SAME canonical engine. Each marginal
    // net discount belongs to its original account; manual discounts remain
    // the residual. This preserves grouped rounding and mixed categories.
    const options={priceIncludesVat:context.priceIncludesVat};
    const taxLines=(ls:SalesLineInput[])=>ls.map((l,i)=>({...l,
      taxRate:policySale.totals.lines[i]!.taxRate,
      taxCategory:policySale.totals.lines[i]!.taxCategory}));
    let previous=computeTotals(taxLines(beforeRules),0,options).discount;
    const netLine=new Map<number,number>();
    for(const step of lineSteps){
      const next=computeTotals(taxLines(step.lines),0,options).discount;
      netLine.set(step.id,+(next-previous).toFixed(2));previous=next;
    }
    lineRules.applied=lineRules.applied.map(r=>({...r,amount:netLine.get(r.id)??0}));
    let grossOrder=body.orderDiscount;
    previous=computeTotals(taxLines(enriched),grossOrder,options).discount;
    ruleResult.applied=ruleResult.applied.map(r=>{
      grossOrder=+(grossOrder+r.amount).toFixed(2);
      const next=computeTotals(taxLines(enriched),grossOrder,options).discount;
      const amount=+(next-previous).toFixed(2);previous=next;
      return {...r,amount};
    });
  }
  return {enriched,lineRules,ruleResult,policySale,totals,context:publicTaxContext(context),
    facts:{companyId:cid,branchId:body.branchId??null,customerId:body.customerId,at,
      context:publicTaxContext(context),enriched,discount,totals,lineRules:lineRules.applied,orderRules:ruleResult.applied}};
}
