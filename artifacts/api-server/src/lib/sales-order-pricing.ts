import {sql} from "drizzle-orm";
import {salesOrdersTable,salesOrderLinesTable} from "@workspace/db";
import type {Request} from "express";
import type {DbOrTx} from "./journal-posting";
import {FinancialRequestError} from "./financial-transaction";
import {computeTotals,type SalesLineInput} from "./sales-engine";
import {calculatePolicySale,publicTaxContext,riyadhDate,taxContext} from "./vat-policy";
import {getCompanyId} from "./scoped-db";
import {assertDeferredSalesOrderApproval} from "./workflow-engine";
import {returnActor} from "./return-access";

export type OrderPriceBasis={
  version:1;priceIncludesVat:boolean;currencyCode:"SAR";orderDiscount:number;
  source:"explicit_order"|"reviewed_legacy";recordedBy:number;recordedAt:string;
  lines:Array<{productId:number|null;description:string;quantity:number;unitPrice:number;discountPct:number;
    taxRate:number;priceSource:"manual"|"product"|"pricelist"|"reviewed_legacy"}>;
  ruleBudgets?:Array<{id:number;name:string;reasonCode:string|null;accountSystemKey:string;amounts:number[]}>;
};
type Order=typeof salesOrdersTable.$inferSelect;
type Line=typeof salesOrderLinesTable.$inferSelect;
const fail=(message:string,status=422)=>new FinancialRequestError(message,status);
export async function assertOrderInvoiceAccess(tx:DbOrTx,req:Request,orderId:number){
  const cid=getCompanyId(req);
  const [source]=(await tx.execute(sql`SELECT branch_id FROM sales_orders WHERE id=${orderId}
    AND company_id=${cid} FOR SHARE`)).rows;
  if(!source)throw fail("أمر البيع غير متاح في المنشأة",404);
  const actor=await returnActor(req.session.userId!,cid,tx);
  if(actor.branches&&(source.branch_id==null||!actor.branches.includes(Number(source.branch_id))))
    throw fail("أمر البيع خارج نطاق فروع المستخدم",403);
}
const money=(n:number)=>Math.round((n+Number.EPSILON)*100)/100;
function prorate(budget:number,quantity:number,total:number){
  const units=(q:number)=>{
    if(!Number.isFinite(q)||q<0||Math.abs(q*10000-Math.round(q*10000))>1e-6)
      throw fail("الكمية يجب أن تكون غير سالبة وبدقة أربع منازل عشرية");
    return BigInt(q.toFixed(4).replace(".",""));
  };
  const cents=BigInt(budget.toFixed(2).replace(".","")),q=units(quantity),d=units(total);
  if(d<=0n)throw fail("كمية أساس السعر غير صالحة");
  return Number((2n*cents*q+d)/(2n*d))/100;
}

/** Rounding and VAT remain in the original canonical engine. Full-line discount
 * budgets are allocated ONCE there; partials consume cumulative quantities, not
 * a freshly applied promotion. Last partial receives the remaining cents. */
export function orderPortion(basis:OrderPriceBasis,lines:Line[],quantities:Map<number,number>){
  const budget=computeTotals(basis.lines.map(l=>({...l,taxRate:0})),basis.orderDiscount,{priceIncludesVat:false});
  return lines.map((line,index)=>{
    const original=basis.lines[index];
    if(!original||original.productId!==line.productId||original.quantity!==Number(line.quantity)||
      original.unitPrice!==Number(line.unitPrice)||original.discountPct!==Number(line.discountPct))
      throw fail("تغيرت حقائق أسعار الأمر؛ يلزم مراجعة موثقة ولا يُعاد تفسير الاتفاق",409);
    const quantity=quantities.get(line.id)??0,before=Number(line.invoicedQty),after=before+quantity;
    if(!Number.isFinite(quantity)||quantity<0||quantity>Number(line.deliveredQty)-before+1e-8||
      after>original.quantity+1e-8)throw fail("الكمية تتجاوز المتبقي المسلّم القابل للفوترة",409);
    const discountBudget=budget.lines[index]!.lineDiscount;
    const cumulativeDiscount=(q:number)=>prorate(discountBudget,q,original.quantity);
    return {line,original,quantity,before,after,
      discountBefore:cumulativeDiscount(before),discountAfter:cumulativeDiscount(after)};
  }).filter(p=>p.quantity>0);
}

export async function prepareOrderInvoice(tx:DbOrTx,req:Request,so:Order,lines:Line[],body:{
  invoiceDate?:string;orderDiscount:number;soQuantities?:Array<{soLineId:number;quantity:number}>;
  lines?:Array<{productId?:number|null;quantity:number;unitPrice?:number;discountPct:number}>;
}){
  const cid=getCompanyId(req),basis=so.pricingBasis as OrderPriceBasis|null;
  if(!basis||basis.version!==1||typeof basis.priceIncludesVat!=="boolean")
    throw fail("أساس سعر الأمر القديم غير مثبت؛ يلزم مراجعة صريحة ومدققة قبل التحويل");
  if(so.currencyCode!=="SAR"||basis.currencyCode!=="SAR")
    throw fail("هذه الشريحة تدعم SAR فقط؛ لم تُنفذ فاتورة بعملة مفترضة");
  if(!["confirmed","partially_delivered","fully_delivered","invoiced"].includes(so.status))
    throw fail("أمر البيع غير مؤكد أو بانتظار اعتماد أو مكتمل الفوترة",409);
  await assertOrderInvoiceAccess(tx,req,so.id);
  if(body.orderDiscount!==0)throw fail("خصم التحويل يؤخذ من الاتفاق المحفوظ ولا يسمح بخصم إضافي");
  if(so.branchId!=null&&!(await tx.execute(sql`SELECT id FROM branches WHERE id=${so.branchId} AND company_id=${cid}`)).rows.length)
    throw fail("فرع الأمر خارج المنشأة",403);
  if(so.warehouseId!=null&&!(await tx.execute(sql`SELECT id FROM warehouses WHERE id=${so.warehouseId} AND company_id=${cid}
    AND (${so.branchId}::integer IS NULL OR branch_id=${so.branchId})`)).rows.length)
    throw fail("مستودع الأمر خارج نطاق الفرع أو المنشأة",403);
  const quantities=new Map<number,number>();
  if(body.soQuantities){
    for(const p of body.soQuantities){
      if(quantities.has(p.soLineId)||!lines.some(l=>l.id===p.soLineId))throw fail("بند مكرر أو لا يخص الأمر");
      quantities.set(p.soLineId,p.quantity);
    }
  }else if(body.lines?.length){
    for(const p of body.lines){
      const candidates=lines.filter(l=>l.productId===p.productId);
      if(candidates.length!==1)throw fail("حدد معرف بند الأمر صراحةً للأصناف المكررة");
      const l=candidates[0]!;
      if(quantities.has(l.id)||p.unitPrice!==undefined&&p.unitPrice!==Number(l.unitPrice)||
        p.discountPct!==Number(l.discountPct))throw fail("لا يسمح بتغيير سعر أو خصم الأمر من طلب التحويل");
      quantities.set(l.id,p.quantity);
    }
  }else for(const l of lines)quantities.set(l.id,Number(l.deliveredQty)-Number(l.invoicedQty));
  const portions=orderPortion(basis,lines,quantities);
  if(!portions.length)throw fail("لا توجد كميات مسلّمة متبقية للفوترة",409);
  const invoiceAt=body.invoiceDate??riyadhDate();
  // Ordinary delivered goods: earlier invoice/delivery is the tax point, not
  // the contract date. Mixed tax periods need delivery-line allocation rather
  // than silently treating all deliveries as today's supply.
  const deliveries=(await tx.execute(sql`SELECT DISTINCT d.delivery_date::text AS at
    FROM delivery_orders d WHERE d.so_id=${so.id} AND d.status='delivered' ORDER BY at`)).rows as {at:string}[];
  const at=deliveries.reduce((earliest,d)=>d.at.slice(0,10)<earliest?d.at.slice(0,10):earliest,invoiceAt);
  const context=await taxContext(cid,at,tx);
  const treatment=(c:Awaited<ReturnType<typeof taxContext>>)=>JSON.stringify({
    status:c.status,vatNumber:c.vatNumber,productRules:c.productRules,serviceRule:c.serviceRule});
  for(const delivery of deliveries){
    const supply=await taxContext(cid,delivery.at.slice(0,10)<invoiceAt?delivery.at.slice(0,10):invoiceAt,tx);
    if(treatment(supply)!==treatment(context))
      throw fail("تسليمات الأمر تقع في معاملات ضريبية مختلفة؛ يلزم تخصيص البنود إلى أدلة التسليم قبل إصدار هذه الفاتورة",409);
  }
  const enriched:SalesLineInput[]=portions.map(p=>({...p.original,quantity:p.quantity,discountPct:0,
    discountAmount:money(p.discountAfter-p.discountBefore),taxRate:context.registered?p.original.taxRate:0}));
  const calculate=async(input:SalesLineInput[])=>{
    const policy=await calculatePolicySale(tx,cid,at,input,0,basis);
    return {policy,totals:policy?.totals??computeTotals(input,0,basis)};
  };
  // Discount budgets are cumulative; VAT is grouped and rounded for this
  // actual invoice by the original engine, not frozen from the order estimate.
  const calculation=await calculate(enriched),totals=calculation.totals;
  const totalsList=totals.lines,classified=calculation.policy?.snapshot.lines??totalsList;
  const budgets=basis.ruleBudgets??[];
  const allocations=budgets.map(rule=>portions.map(p=>{
    const index=lines.findIndex(l=>l.id===p.line.id),budget=rule.amounts[index]??0;
    return money(prorate(budget,p.after,p.original.quantity)-prorate(budget,p.before,p.original.quantity));
  }));
  const stage=enriched.map((l,i)=>({...l,discountAmount:money((l.discountAmount??0)-allocations.reduce((s,a)=>s+a[i]!,0))}));
  let previous=(await calculate(stage)).totals.discount;
  const applied:Array<{id:number;name:string;reasonCode:string|null;accountSystemKey:string;amount:number}>=[];
  for(let i=0;i<budgets.length;i++){
    stage.forEach((l,j)=>{l.discountAmount=money((l.discountAmount??0)+allocations[i]![j]!);});
    const next=(await calculate(stage)).totals.discount;
    applied.push({...budgets[i]!,amount:money(next-previous)});previous=next;
  }
  const fullPolicy=await calculatePolicySale(tx,cid,at,basis.lines,basis.orderDiscount,basis);
  const fullTotal=fullPolicy?.totals.total??computeTotals(basis.lines.map(l=>({...l,taxRate:context.registered?l.taxRate:0})),
    basis.orderDiscount,basis).total;
  await assertDeferredSalesOrderApproval(cid,so.id,Number(so.total),so.branchId,tx,fullTotal);
  const [credit]=(await tx.execute(sql`SELECT c.credit_limit,
    (SELECT coalesce(sum(i.total-i.amount_paid),0) FROM customer_invoices i WHERE i.company_id=${cid}
      AND i.customer_id=c.id AND i.status IN ('open','partially_paid')) AS outstanding,
    EXISTS(SELECT 1 FROM approval_requests a WHERE a.company_id=${cid} AND a.doc_type='sales_order'
      AND a.record_id=${so.id} AND a.status='approved' AND a.review_invalidated_at IS NULL) AS reviewed
    FROM customers c WHERE c.id=${so.customerId} AND c.company_id=${cid}`)).rows as Record<string,any>[];
  if(credit&&Number(credit.credit_limit)>0&&Number(credit.outstanding)+totals.total>Number(credit.credit_limit)&&!credit.reviewed)
    throw fail("إصدار الفاتورة يتجاوز حد ائتمان العميل ويحتاج اعتماد الأمر",409);
  const savedRules=(so.appliedDiscounts??[]) as Array<{id:number;name:string;reasonCode:string|null;accountSystemKey:string;amount:number}>;
  // Historical rule amounts lack the marginal net-tax evidence needed for
  // mixed/inclusive allocations. Keep this unsupported case fail-closed; never
  // silently move named discounts into the manual discount account.
  if(savedRules.length&&!basis.ruleBudgets)
    throw fail("الأمر يحمل خصومات قواعد ذات حسابات مستقلة؛ يلزم إثبات توزيعها الضريبي على الفواتير الجزئية قبل التحويل");
  if(applied.some(r=>r.amount<0)||money(applied.reduce((s,r)=>s+r.amount,0))>totals.discount)
    throw fail("توزيع تقريب خصومات القواعد يحتاج مراجعة؛ لم تُرحّل حسابات غير متوازنة",409);
  const snapshot={context:publicTaxContext(context),agreedBasis:basis,lines:totalsList.map((l,i)=>({...classified[i],...l})),
    totals:{subtotal:totals.subtotal,discount:totals.discount,vat:totals.vat,total:totals.total}};
  const [issued]=(await tx.execute(sql`SELECT coalesce(sum(total),0) AS total FROM customer_invoices
    WHERE so_id=${so.id} AND company_id=${cid} AND status NOT IN ('cancelled','draft')`)).rows;
  const remaining=money(lines.reduce((s,l)=>s+Number(l.quantity)-Number(l.invoicedQty),0)-portions.reduce((s,p)=>s+p.quantity,0));
  const totalIssuedAfter=money(Number(issued?.total??0)+totals.total);
  return {enriched,totals,context:{...publicTaxContext(context),priceIncludesVat:basis.priceIncludesVat,
      currentDefaultIncludesVat:context.priceIncludesVat,supplyDate:at},
    policySale:{context:publicTaxContext(context),totals,snapshot},
    lineRules:{applied},
    ruleResult:{discountAmount:0,applied:[] as Array<{id:number;name:string;reasonCode:string|null;accountSystemKey:string;amount:number}>},
    soLineIds:portions.map(p=>p.line.id),
    facts:{companyId:cid,orderId:so.id,order:so,sourceLines:lines,basis,portions,at,invoiceAt,deliveries,context:publicTaxContext(context),totals},
    comparison:{orderTotal:Number(so.total),invoiceTotal:totals.total,priceIncludesVat:basis.priceIncludesVat,
      currentDefaultIncludesVat:context.priceIncludesVat,currencyCode:basis.currencyCode,
       totalIssuedAfter,finalDifferenceFromOrder:remaining===0?money(totalIssuedAfter-Number(so.total)):null,
       explanation:"سعر الاتفاق ثابت؛ الضريبة تُحسب لكل فاتورة فعلية وقد يختلف مجموعها عن تقدير الأمر بسبب المعاملة أو تقريب الهللات. المبلغ المعروض يخص الكميات المختارة فقط."}};
}
