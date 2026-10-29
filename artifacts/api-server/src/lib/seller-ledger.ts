import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { allocateCents,cents,commissionCents,saleLineCents,selectSellers,resolveSellerBranch,type SellerTx,type SellerPolicy } from "./seller-policy";
import { FinancialRequestError } from "./financial-transaction";
export interface SellerLine {
 company_id:number;invoice_id:number;invoice_line_id:number;branch_id:number|null;employee_id:number|null;
 seller_name:string;employee_no:string|null;currency_code:string;quantity:string;gross_cents:string;
 discount_cents:string;net_cents:string;policy:SellerPolicy;revision:number;
}
export async function savedSellerLines(companyId:number,invoiceId:number,tx:SellerTx=db){
 return (await tx.execute(sql`SELECT * FROM invoice_seller_lines WHERE company_id=${companyId} AND invoice_id=${invoiceId} ORDER BY invoice_line_id`)).rows as unknown as SellerLine[];
}
export function sellerLineDescription(description:string,line?:SellerLine){
 return !line||line.policy.mode==="hidden"?description:`${description} — البائع: ${line.seller_name}${line.revision>1?` (تصحيح ${line.revision-1})`:""}`;
}
type EventInput={kind:"sale"|"return"|"return_cancel"|"cancel"|"change";key:string;date:string;net:number;discount?:number;commission?:number};
export async function appendSellerEvent(tx:SellerTx,line:SellerLine,userId:number|null,event:EventInput){
 const p=line.policy;
 const commission=event.commission??(p.commissionEnabled&&line.employee_id!=null?commissionCents(event.net,p.ratePercent!):0);
 await tx.execute(sql`INSERT INTO sales_commission_events(company_id,invoice_id,invoice_line_id,branch_id,employee_id,seller_name,employee_no,
   currency_code,event_key,kind,effective_date,net_cents,discount_cents,commission_cents,policy,created_by)
   VALUES(${line.company_id},${line.invoice_id},${line.invoice_line_id},${line.branch_id},${line.employee_id},${line.seller_name},${line.employee_no},
   ${line.currency_code},${event.key},${event.kind},${event.date},${event.net},${event.discount??0},${commission},${JSON.stringify(p)}::jsonb,${userId})
   ON CONFLICT(company_id,event_key) DO NOTHING`);
}
export async function recordSaleSellers(tx:SellerTx,companyId:number,invoiceId:number,userId:number,selection:unknown,posOrderId?:number){
 const result=await tx.execute(sql`SELECT * FROM customer_invoices WHERE id=${invoiceId} AND company_id=${companyId} FOR UPDATE`);
 const i=result.rows[0];if(!i)throw new FinancialRequestError("الفاتورة غير متاحة",404);
 const branchId=i.branch_id==null?null:Number(i.branch_id);
 if(await resolveSellerBranch(tx,companyId,userId,branchId)!==branchId)
  throw new FinancialRequestError("لم يثبت فرع الفاتورة قبل إصدارها",403);
 const lines=(await tx.execute(sql`SELECT * FROM customer_invoice_lines WHERE invoice_id=${invoiceId} ORDER BY id`)).rows;
 const {policy,sellers}=await selectSellers(tx,companyId,i.branch_id==null?null:Number(i.branch_id),selection,lines.length);
 const grossWeights=lines.map(l=>Number(l.quantity)*Number(l.unit_price));
 const weights=lines.map((l,n)=>grossWeights[n]!*(1-Number(l.discount_pct??0)/100));
 const {net,gross:grossAmounts}=saleLineCents(cents(i.subtotal)-cents(i.discount),grossWeights,weights);
 for(let n=0;n<lines.length;n++){
  const l=lines[n]!,s=sellers[n]!,gross=grossAmounts[n]!;
  const result=await tx.execute(sql`INSERT INTO invoice_seller_lines(company_id,invoice_id,invoice_line_id,branch_id,employee_id,seller_name,employee_no,currency_code,
   quantity,gross_cents,discount_cents,net_cents,policy,updated_by)
   VALUES(${companyId},${invoiceId},${Number(l.id)},${i.branch_id},${s.id},${s.name},${s.employeeNo},${String(i.currency_code)},
   ${String(l.quantity)},${gross},${gross-net[n]!},${net[n]!},${JSON.stringify(policy)}::jsonb,${userId})
   ON CONFLICT(invoice_line_id) DO NOTHING RETURNING *`);
  const line=result.rows[0] as unknown as SellerLine|undefined;
  if(line)await appendSellerEvent(tx,line,userId,{kind:"sale",key:`sale:${l.id}`,date:String(i.invoice_date),net:net[n]!,discount:gross-net[n]!});
 }
 const saved = await savedSellerLines(companyId,invoiceId,tx);
 // Capture only in the original issuance transaction. Corrections keep this
 // evidence intact; no backfill from today's employee names for old invoices.
 const actors=(await tx.execute(sql`SELECT id,name FROM users WHERE id=${userId} OR id=${i.created_by == null ? userId : Number(i.created_by)}`)).rows;
 const creator=actors.find(a=>Number(a.id)===Number(i.created_by));
 const collector=actors.find(a=>Number(a.id)===userId);
 const identity={version:1,creator:{id:i.created_by==null?null:Number(i.created_by),name:creator?String(creator.name):null},
   cashier:i.source==="pos"&&collector?{id:userId,name:String(collector.name)}:null,
   sellers:saved.map(l=>({invoiceLineId:l.invoice_line_id,employeeId:l.employee_id,name:l.seller_name,visible:l.policy.mode!=="hidden"}))};
 await tx.execute(sql`UPDATE document_issuer_snapshots SET issuer=jsonb_set(issuer,'{saleIdentity}',${JSON.stringify(identity)}::jsonb)
   WHERE company_id=${companyId} AND ((document_kind='invoice' AND document_id=${invoiceId})
     OR (document_kind='pos' AND document_id=${posOrderId??null}))
   AND NOT issuer ? 'saleIdentity'`);
 return saved;
}
async function lineBalance(tx:SellerTx,companyId:number,lineId:number){
 const r=(await tx.execute(sql`SELECT coalesce(sum(net_cents),0) net,coalesce(sum(commission_cents),0) commission
   FROM sales_commission_events WHERE company_id=${companyId} AND invoice_line_id=${lineId}`)).rows[0]!;
 return {net:Number(r.net),commission:Number(r.commission)};
}
export async function recordReturnSellers(tx:SellerTx,companyId:number,noteId:number,userId:number|null,cancel=false){
 const note=(await tx.execute(sql`SELECT * FROM credit_notes WHERE id=${noteId} AND company_id=${companyId}`)).rows[0];
 if(!note||!note.invoice_id)return;
 const items=(await tx.execute(sql`SELECT l.*,a.* ,l.id AS return_line_id,l.invoice_line_id AS source_line_id,l.line_total AS return_line_total,l.tax_rate AS return_tax_rate
   FROM credit_note_lines l LEFT JOIN invoice_seller_lines a ON a.invoice_line_id=l.invoice_line_id AND a.company_id=${companyId}
   WHERE l.note_id=${noteId} ORDER BY l.id`)).rows;
 const allocations=allocateCents(cents(note.subtotal),items.map(l=>Number(l.return_line_total)/(1+Number(l.return_tax_rate)/100)));
 for(let n=0;n<items.length;n++){
  const row=items[n]!;
  // Never invent an employee link for a legacy/unmatched source.
  if(!row.company_id||!row.source_line_id)continue;
  const line=row as unknown as SellerLine;
  const key=`${cancel?"return_cancel":"return"}:${noteId}:${row.return_line_id}`;
  if((await tx.execute(sql`SELECT id FROM sales_commission_events WHERE company_id=${companyId} AND event_key=${key}`)).rows.length)continue;
  const balance=await lineBalance(tx,companyId,line.invoice_line_id),net=allocations[n]!*(cancel?1:-1);
  const expected=line.policy.commissionEnabled&&line.employee_id!=null?commissionCents(balance.net+net,line.policy.ratePercent!):0;
  await appendSellerEvent(tx,line,userId,{kind:cancel?"return_cancel":"return",key,date:cancel?new Date().toISOString().slice(0,10):String(note.note_date),
   net,commission:expected-balance.commission});
 }
}
export async function cancelSellerInvoice(tx:SellerTx,companyId:number,invoiceId:number,userId:number){
 const rows=(await tx.execute(sql`SELECT * FROM invoice_seller_lines WHERE company_id=${companyId} AND invoice_id=${invoiceId} ORDER BY invoice_line_id FOR UPDATE`)).rows;
 for(const row of rows){
  const line=row as unknown as SellerLine,b=await lineBalance(tx,companyId,line.invoice_line_id);
  await appendSellerEvent(tx,line,userId,{kind:"cancel",key:`cancel:${invoiceId}:${line.invoice_line_id}`,date:new Date().toISOString().slice(0,10),net:-b.net,commission:-b.commission});
 }
}
export async function correctSellerLines(tx:SellerTx,companyId:number,invoiceId:number,userId:number,reason:string,
 sellerEmployeeId:number|null,overrides:Array<{invoiceLineId:number;employeeId:number|null}>){
 const invoice=(await tx.execute(sql`SELECT * FROM customer_invoices WHERE id=${invoiceId} AND company_id=${companyId} FOR UPDATE`)).rows[0];
 if(!invoice)throw new FinancialRequestError("الفاتورة غير متاحة",404);
 if(invoice.status==="cancelled")throw new FinancialRequestError("لا تصحح نسبة فاتورة ملغاة",409);
 const before=(await tx.execute(sql`SELECT * FROM invoice_seller_lines WHERE company_id=${companyId} AND invoice_id=${invoiceId} ORDER BY invoice_line_id FOR UPDATE`)).rows as unknown as SellerLine[];
 if(!before.length)throw new FinancialRequestError("هذه فاتورة تاريخية بلا نسبة محفوظة؛ لا يعاد بناء عمولتها أو تخمين بائعها تلقائيا",422);
 const indexById=new Map(before.map((l,n)=>[l.invoice_line_id,n]));
 if(new Set(overrides.map(l=>l.invoiceLineId)).size!==overrides.length||overrides.some(l=>!indexById.has(l.invoiceLineId)))
  throw new FinancialRequestError("سطر لا يتبع الفاتورة أو مكرر",400);
 const policy={...before[0]!.policy};
 const chosen=await selectSellers(tx,companyId,invoice.branch_id==null?null:Number(invoice.branch_id),
  {sellerEmployeeId,lineSellers:overrides.map(l=>({lineIndex:indexById.get(l.invoiceLineId)!,employeeId:l.employeeId}))},before.length,policy,
  before.map(l=>({id:l.employee_id,name:l.seller_name,employeeNo:l.employee_no})));
 for(let n=0;n<before.length;n++){
  const old=before[n]!,s=chosen.sellers[n]!;
  if(old.employee_id===s.id)continue;
  const balance=await lineBalance(tx,companyId,old.invoice_line_id),revision=old.revision+1;
  const after={...old,employee_id:s.id,seller_name:s.name,employee_no:s.employeeNo,revision};
  await appendSellerEvent(tx,old,userId,{kind:"change",key:`change:${old.invoice_line_id}:${revision}:old`,date:new Date().toISOString().slice(0,10),net:-balance.net,commission:-balance.commission});
  const recalculated=after.policy.commissionEnabled&&s.id!=null?commissionCents(balance.net,after.policy.ratePercent!):0;
  await appendSellerEvent(tx,after,userId,{kind:"change",key:`change:${old.invoice_line_id}:${revision}:new`,date:new Date().toISOString().slice(0,10),net:balance.net,commission:recalculated});
  await tx.execute(sql`UPDATE invoice_seller_lines SET employee_id=${s.id},seller_name=${s.name},employee_no=${s.employeeNo},
   revision=${revision},updated_by=${userId},updated_at=now() WHERE invoice_line_id=${old.invoice_line_id} AND company_id=${companyId}`);
 }
 const after=(await tx.execute(sql`SELECT * FROM invoice_seller_lines WHERE company_id=${companyId} AND invoice_id=${invoiceId} ORDER BY invoice_line_id`)).rows;
 await tx.execute(sql`INSERT INTO invoice_seller_audit(company_id,invoice_id,user_id,reason,before_value,after_value)
   VALUES(${companyId},${invoiceId},${userId},${reason},${JSON.stringify(before)}::jsonb,${JSON.stringify(after)}::jsonb)`);
 return {invoiceId,lines:after,reason,financialEffects:false};
}
