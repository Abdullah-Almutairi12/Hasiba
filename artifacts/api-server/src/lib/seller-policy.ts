import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";
import { FinancialRequestError } from "./financial-transaction";
import { returnActor } from "./return-access";
export type SellerTx = Pick<typeof db,"execute">;
export type SellerMode = "hidden"|"optional"|"required";
export interface SellerPolicy {
  version:number;branchId:number;inherited:boolean;mode:SellerMode;granularity:"invoice"|"line";
  commissionEnabled:boolean;planId:number|null;ratePercent:number|null;effectiveFrom:string|null;
  basis:"net_before_vat";
}
export const defaultSellerPolicy:SellerPolicy={version:0,branchId:0,inherited:true,mode:"hidden",granularity:"invoice",
  commissionEnabled:false,planId:null,ratePercent:null,effectiveFrom:null,basis:"net_before_vat"};
export const sellerSelection=z.object({
  sellerEmployeeId:z.number().int().positive().nullable().optional(),
  lineSellers:z.array(z.object({lineIndex:z.number().int().min(0),employeeId:z.number().int().positive().nullable()})).max(1000).default([]),
});
export interface SellerIdentity {id:number|null;name:string;employeeNo:string|null}
export const unassignedSeller:SellerIdentity={id:null,name:"غير منسوب",employeeNo:null};
export async function resolveSellerBranch(tx:SellerTx,companyId:number,userId:number,requested:number|null){
  const actor=await returnActor(userId,companyId,tx);
  let branchId=requested;
  if(actor.branches!==null){
    if(branchId===null&&actor.branches.length===1)branchId=actor.branches[0]!;
    if(branchId===null||!actor.branches.includes(branchId))throw new FinancialRequestError("حدد فرعا متاحا ضمن نطاقك؛ لا يسمح بتجاوز سياسة الفرع بفاتورة بلا فرع",403);
  }
  if(branchId!==null&&!(await tx.execute(sql`SELECT id FROM branches WHERE id=${branchId} AND company_id=${companyId}`)).rows.length)
    throw new FinancialRequestError("الفرع ليس ضمن الشركة",403);
  return branchId;
}
export async function sellerPolicy(tx:SellerTx,companyId:number,branchId:number|null):Promise<SellerPolicy>{
  const result=await tx.execute(sql`SELECT p.*,c.rate,c.quota,c.bonus_rate,c.is_active FROM sales_seller_policies p
    LEFT JOIN commission_plans c ON c.id=p.commission_plan_id AND c.company_id=p.company_id
    WHERE p.company_id=${companyId} AND p.branch_id IN (0,${branchId??0}) AND p.effective_from<=now()
    ORDER BY p.branch_id DESC,p.effective_from DESC,p.id DESC`);
  const latest=new Map<number,typeof result.rows[number]>();
  for(const row of result.rows) if(!latest.has(Number(row.branch_id)))latest.set(Number(row.branch_id),row);
  const local=branchId?latest.get(branchId):undefined;
  const row=local&&!local.inherit?local:latest.get(0);
  if(!row)return {...defaultSellerPolicy};
  if(row.commission_enabled && (row.rate==null||!row.is_active||Number(row.quota)!==0||Number(row.bonus_rate)!==0||Number(row.rate)<0||Number(row.rate)>100))
    throw new FinancialRequestError("خطة العمولة غير متاحة للشركة أو ليست نسبة صافية بسيطة؛ لا تحسب عمولة تخمينية",422);
  return {version:Number(row.id),branchId:Number(row.branch_id),inherited:Number(row.branch_id)!==branchId,
    mode:row.mode as SellerMode,granularity:row.granularity as "invoice"|"line",commissionEnabled:!!row.commission_enabled,
    planId:row.commission_plan_id==null?null:Number(row.commission_plan_id),ratePercent:row.commission_enabled?Number(row.rate):null,
    effectiveFrom:new Date(String(row.effective_from)).toISOString(),basis:"net_before_vat"};
}
export async function eligibleSellers(tx:SellerTx,companyId:number,branchId:number|null) {
  const result=await tx.execute(sql`SELECT e.id,e.name,e.name_ar,e.employee_no,e.branch_id,s.branch_ids
    FROM employees e JOIN sales_seller_eligibility s ON s.employee_id=e.id AND s.company_id=e.company_id
    WHERE e.company_id=${companyId} AND e.status='active' AND s.enabled
    AND (s.branch_ids IS NULL OR (${branchId}::int IS NOT NULL AND s.branch_ids @> jsonb_build_array(${branchId}::int)))
    ORDER BY e.name_ar,e.id FOR SHARE OF e,s`);
  return result.rows.map(e=>({id:Number(e.id),name:String(e.name_ar||e.name),employeeNo:String(e.employee_no),branchId:e.branch_id}));
}
export async function selectSellers(tx:SellerTx,companyId:number,branchId:number|null,input:unknown,count:number,policy?:SellerPolicy,preserved?:SellerIdentity[]){
  if(branchId!=null){
    const b=await tx.execute(sql`SELECT id FROM branches WHERE id=${branchId} AND company_id=${companyId}`);
    if(!b.rows.length)throw new FinancialRequestError("الفرع ليس ضمن الشركة",403);
  }
  const p=policy??await sellerPolicy(tx,companyId,branchId),selection=sellerSelection.parse(input);
  const overrides=new Map<number,number|null>();
  for(const l of selection.lineSellers){
    if(l.lineIndex>=count||overrides.has(l.lineIndex))throw new FinancialRequestError("تكرار أو رقم سطر بائع غير صالح",400);
    overrides.set(l.lineIndex,l.employeeId);
  }
  if(p.granularity==="invoice"&&overrides.size)throw new FinancialRequestError("سياسة الفرع تختار بائعا واحدا للفاتورة",400);
  const ids=Array.from({length:count},(_,i)=>overrides.has(i)?overrides.get(i)!:selection.sellerEmployeeId??null);
  if(p.mode==="hidden"&&ids.some(id=>id!==null))throw new FinancialRequestError("نسبة البيع للبائع غير مفعلة في هذا النطاق",400);
  if(p.mode==="required"&&ids.some(id=>id===null))throw new FinancialRequestError("يجب اختيار بائع مؤهل لكل سطر",422);
  const eligible=await eligibleSellers(tx,companyId,branchId);
  const byId=new Map(eligible.map(e=>[e.id,e]));
  const sellers=ids.map((id,index)=>{
    if(id===null)return {...unassignedSeller};
    const e=byId.get(id);
    if(!e&&preserved?.[index]?.id===id)return preserved[index]!;
    if(!e)throw new FinancialRequestError("البائع غير نشط أو غير مؤهل لهذا الفرع والشركة",403);
    return {id:e.id,name:e.name,employeeNo:e.employeeNo};
  });
  return {policy:p,sellers};
}
export function cents(value:unknown){const n=Math.round(Number(value)*100);if(!Number.isSafeInteger(n))throw new FinancialRequestError("المبلغ خارج دقة حساب النسبة المدعومة",422);return n;}
/** Stored plans have two decimal percentage places; round symmetrically in integer cents. */
export function commissionCents(net:number,rate:number){
  if(!Number.isSafeInteger(net)||!Number.isFinite(rate)||rate<0||rate>100)throw new FinancialRequestError("أساس العمولة أو نسبتها غير صالح",422);
  const units=BigInt(Math.round(rate*100)),amount=BigInt(net)*units,sign=amount<0n?-1n:1n;
  return Number(sign*((amount*sign+5000n)/10000n));
}
/** Largest-remainder allocation preserves the exact source-document cents. */
export function allocateCents(total:number,weights:number[]){
  if(!weights.length)return [];
  const sum=weights.reduce((a,b)=>a+b,0);
  if(sum<=0){if(total!==0)throw new FinancialRequestError("تعذر توزيع صافي المستند على سطوره",422);return weights.map(()=>0);}
  const values=weights.map((w,i)=>({i,exact:total*w/sum,whole:Math.floor(total*w/sum)}));
  let remaining=total-values.reduce((s,x)=>s+x.whole,0);
  for(const v of [...values].sort((a,b)=>(b.exact-b.whole)-(a.exact-a.whole)||a.i-b.i)){
    if(remaining--<=0)break;v.whole++;
  }
  return values.map(v=>v.whole);
}
/** Do not round every small weight to zero before allocating the source cents. */
export function saleLineCents(netTotal:number,grossWeights:number[],netWeights:number[]){
  const net=allocateCents(netTotal,netWeights),gross=allocateCents(cents(grossWeights.reduce((a,b)=>a+b,0)),grossWeights);
  if(gross.reduce((a,b)=>a+b,0)<netTotal)throw new FinancialRequestError("صافي الفاتورة لا يتفق مع إجمالي مصدر سطورها",422);
  let donor=0;
  // Reconcile rare half-cent allocations without reporting a fictitious negative discount.
  for(let i=0;i<net.length;i++)while(gross[i]!<net[i]!){
    while(donor<gross.length&&gross[donor]!<=net[donor]!)donor++;
    if(donor===gross.length)throw new FinancialRequestError("تعذر توزيع فرق التقريب",422);
    const transfer=Math.min(net[i]!-gross[i]!,gross[donor]!-net[donor]!);
    gross[i]!+=transfer;gross[donor]!-=transfer;
  }
  return {net,gross};
}
