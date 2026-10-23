import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { FinancialRequestError } from "./financial-transaction";
import { returnAuthorize } from "./return-access";
export async function sellerReport(companyId:number,userId:number,from:string,to:string,branchId?:number,sellerId?:number){
 const actor=await returnAuthorize(userId,companyId,"reports",branchId);
 const facts=(await db.execute(sql`WITH facts AS (
   SELECT e.invoice_id,e.invoice_line_id,e.branch_id,e.currency_code,e.kind,e.effective_date,e.net_cents,e.discount_cents,i.reference,
    CASE WHEN a.invoice_line_id IS NOT NULL THEN a.employee_id ELSE e.employee_id END AS seller_id,
    coalesce(a.seller_name,e.seller_name) AS seller_name
   FROM sales_commission_events e JOIN customer_invoices i ON i.id=e.invoice_id AND i.company_id=e.company_id
   LEFT JOIN invoice_seller_lines a ON a.invoice_line_id=e.invoice_line_id AND a.company_id=e.company_id
   WHERE e.company_id=${companyId} AND e.kind<>'change'
   UNION ALL
   SELECT i.id,NULL,i.branch_id,i.currency_code,'sale',i.invoice_date,
    round((i.subtotal-i.discount)*100)::bigint,round(i.discount*100)::bigint,i.reference,NULL,'غير منسوب — سجل قديم'
   FROM customer_invoices i WHERE i.company_id=${companyId} AND i.status IN ('open','paid','partially_paid')
    AND NOT EXISTS(SELECT 1 FROM invoice_seller_lines a WHERE a.invoice_id=i.id AND a.company_id=i.company_id)
   UNION ALL
   SELECT i.id,NULL,i.branch_id,i.currency_code,'return',n.note_date,-round(n.subtotal*100)::bigint,0,i.reference,NULL,'غير منسوب — سجل قديم'
   FROM credit_notes n JOIN customer_invoices i ON i.id=n.invoice_id AND i.company_id=n.company_id
   WHERE n.company_id=${companyId} AND n.status='issued'
    AND NOT EXISTS(SELECT 1 FROM invoice_seller_lines a WHERE a.invoice_id=i.id AND a.company_id=i.company_id)
  ) SELECT * FROM facts WHERE effective_date>=${from}::date AND effective_date<=${to}::date
    AND (${branchId??null}::int IS NULL OR branch_id=${branchId??null})
    AND (${actor.branches===null?null:JSON.stringify(actor.branches)}::jsonb IS NULL OR ${actor.branches===null?null:JSON.stringify(actor.branches)}::jsonb @> jsonb_build_array(branch_id))
    AND (${sellerId??null}::int IS NULL OR coalesce(seller_id,0)=${sellerId??null})
    ORDER BY effective_date,invoice_id LIMIT 10001`)).rows
  .filter(f=>actor.branches===null||(f.branch_id!=null&&actor.branches.includes(Number(f.branch_id))))
  .filter(f=>sellerId===undefined||(sellerId===0?f.seller_id==null:Number(f.seller_id)===sellerId));
 if(facts.length>10000)throw new FinancialRequestError("الفترة تتجاوز 10000 حركة؛ ضيق النطاق ولا تستخدم تقريرا مبتورا",422);
 type Group={sellerId:number|null;sellerName:string;currency:string;grossSales:number;discounts:number;returns:number;cancellations:number;net:number;invoiceCount:number;invoices:Set<number>};
 const groups=new Map<string,Group>(),uniqueInvoices=new Set<number>();
 const safe=(v:unknown)=>{const n=Number(v);if(!Number.isSafeInteger(n))throw new FinancialRequestError("مجموع التقرير يتجاوز دقة الهللات المدعومة",422);return n;};
 for(const f of facts){
  const key=`${f.seller_id??"none"}:${f.currency_code}`;
  let g=groups.get(key);
  if(!g){g={sellerId:f.seller_id==null?null:Number(f.seller_id),sellerName:String(f.seller_name),currency:String(f.currency_code),
   grossSales:0,discounts:0,returns:0,cancellations:0,net:0,invoiceCount:0,invoices:new Set()};groups.set(key,g);}
  const net=safe(f.net_cents),discount=safe(f.discount_cents);
  if(f.kind==="sale"){g.grossSales=safe(g.grossSales+net+discount);g.discounts=safe(g.discounts+discount);}
  if(f.kind==="return"||f.kind==="return_cancel")g.returns=safe(g.returns-net);
  if(f.kind==="cancel")g.cancellations=safe(g.cancellations-net);
  g.net=safe(g.net+net);g.invoices.add(Number(f.invoice_id));uniqueInvoices.add(Number(f.invoice_id));
 }
 const commissions=(await db.execute(sql`SELECT id,invoice_id,invoice_line_id,branch_id,employee_id,seller_name,currency_code,event_key,kind,
   effective_date,net_cents,commission_cents,policy,status,created_at,approved_at,paid_at,external_reference
   FROM sales_commission_events WHERE company_id=${companyId} AND effective_date>=${from}::date AND effective_date<=${to}::date
    AND (${branchId??null}::int IS NULL OR branch_id=${branchId??null})
    AND (${actor.branches===null?null:JSON.stringify(actor.branches)}::jsonb IS NULL OR ${actor.branches===null?null:JSON.stringify(actor.branches)}::jsonb @> jsonb_build_array(branch_id))
    AND (${sellerId??null}::int IS NULL OR coalesce(employee_id,0)=${sellerId??null}) ORDER BY id DESC LIMIT 10001`)).rows
   .filter(e=>actor.branches===null||(e.branch_id!=null&&actor.branches.includes(Number(e.branch_id))))
   .filter(e=>sellerId===undefined||(sellerId===0?e.employee_id==null:Number(e.employee_id)===sellerId))
   .map(e=>({...e,amount:safe(e.commission_cents)/100,net:safe(e.net_cents)/100}));
 if(commissions.length>10000)throw new FinancialRequestError("حركات العمولة كثيرة؛ ضيق فترة التقرير",422);
 const rows=[...groups.values()].map(({invoices,...g})=>({...g,invoiceCount:invoices.size,grossSales:g.grossSales/100,discounts:g.discounts/100,
  returns:g.returns/100,cancellations:g.cancellations/100,net:g.net/100}));
 const legacyCancelled=(await db.execute(sql`SELECT count(*)::int AS count FROM customer_invoices i
   WHERE i.company_id=${companyId} AND i.status='cancelled' AND i.reverses_id IS NULL
   AND (${branchId??null}::int IS NULL OR i.branch_id=${branchId??null})
   AND (${actor.branches===null?null:JSON.stringify(actor.branches)}::jsonb IS NULL OR ${actor.branches===null?null:JSON.stringify(actor.branches)}::jsonb @> jsonb_build_array(i.branch_id))
   AND NOT EXISTS(SELECT 1 FROM invoice_seller_lines a WHERE a.invoice_id=i.id AND a.company_id=i.company_id)`)).rows[0];
 return {from,to,branchId:branchId??null,basis:"net_pre_tax",basisDescription:"صافي المصدر قبل الضريبة؛ الخصم موزع بالهللات؛ البائع الحالي بعد التصحيحات الموثقة؛ العمولة بتاريخ سياستها المحفوظة",
   uniqueInvoiceCount:uniqueInvoices.size,rows,commissions,
   sources:facts.map(f=>({invoiceId:Number(f.invoice_id),invoiceLineId:f.invoice_line_id,reference:f.reference,kind:f.kind,date:f.effective_date,currency:f.currency_code,net:safe(f.net_cents)/100})),
   warnings:[...(facts.some(f=>f.invoice_line_id==null)?["السجلات القديمة بلا لقطة إسناد معروضة دون بائع؛ لا يستنتج لها بائع أو مبلغ عمولة تاريخية من إعدادات اليوم."]:[]),
    ...(Number(legacyCancelled?.count)>0?["توجد فواتير قديمة ملغاة بلا تاريخ إلغاء موثق؛ لم يخمن تاريخها في أرقام الإلغاء للفترة."]:[]),
    "لا تجمع عدد الفواتير بين صفوف البائعين: الفاتورة متعددة البائعين محسوبة مرة واحدة في الإجمالي.",
    "المحسوب والمعتمد والمدفوع حالات مستقلة؛ المدفوع توثيق خارجي ولا ينفذ النظام أي صرف."]};
}
