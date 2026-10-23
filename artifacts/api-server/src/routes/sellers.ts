import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";
import { returnActor,returnAuthorize } from "../lib/return-access";
import { sellerPolicy,eligibleSellers } from "../lib/seller-policy";
import { correctSellerLines } from "../lib/seller-ledger";
import { sellerReport } from "../lib/seller-report";
import { FinancialRequestError } from "../lib/financial-transaction";
import { handleRouteError } from "../lib/handle-error";
const router=Router(),id=z.coerce.number().int().positive();
const day=z.iso.date();
router.get("/sales/sellers/workspace",async(req,res)=>{
 try{
  const companyId=req.session.companyId!,userId=req.session.userId!;
  const branchId=req.query.branchId==null?undefined:id.parse(req.query.branchId);
  const actor=await returnAuthorize(userId,companyId,"view",branchId);
  const branches=(await db.execute(sql`SELECT id,name_ar AS name FROM branches WHERE company_id=${companyId} ORDER BY id`)).rows
   .filter(b=>actor.branches===null||actor.branches.includes(Number(b.id)));
  const selected=branchId??(actor.branches?.length===1?actor.branches[0]!:null);
  const canConfigure=actor.role==="owner";
  const employees=canConfigure?(await db.execute(sql`SELECT e.id,e.name_ar AS name,e.employee_no AS "employeeNo",e.branch_id AS "branchId",e.status,
    coalesce(s.enabled,false) AS eligible,s.branch_ids AS "branchIds" FROM employees e
    LEFT JOIN sales_seller_eligibility s ON s.employee_id=e.id AND s.company_id=e.company_id WHERE e.company_id=${companyId} ORDER BY e.id`)).rows:[];
  const policies=canConfigure?(await db.execute(sql`SELECT * FROM sales_seller_policies WHERE company_id=${companyId} ORDER BY id DESC LIMIT 100`)).rows:[];
  const plans=canConfigure?(await db.execute(sql`SELECT id,name,rate,quota,bonus_rate FROM commission_plans WHERE company_id=${companyId} AND is_active ORDER BY id`)).rows:[];
  res.json({policy:await sellerPolicy(db,companyId,selected),sellers:await eligibleSellers(db,companyId,selected),branches,employees,policies,commissionPlans:plans,
   canConfigure,permissions:actor.capabilities});
 }catch(e){handleRouteError(e,res);}
});
router.post("/sales/sellers/configure",async(req,res)=>{
 try{
  const companyId=req.session.companyId!,userId=req.session.userId!;
  await returnAuthorize(userId,companyId,"configure");
  const b=z.object({branchId:z.number().int().min(0),inherit:z.boolean(),mode:z.enum(["hidden","optional","required"]),
   granularity:z.enum(["invoice","line"]),commissionEnabled:z.boolean(),commissionPlanId:id.nullable().optional(),
   commissionRatePercent:z.number().min(0).max(100).refine(v=>Math.abs(v*100-Math.round(v*100))<1e-7,"النسبة تدعم منزلتين عشريتين كحد أقصى").optional(),effectiveFrom:z.iso.datetime({offset:true})}).strict().parse(req.body);
  if(b.branchId===0&&b.inherit)throw new FinancialRequestError("سياسة الشركة لا ترث من فرع",400);
  const result=await db.transaction(async tx=>{
   await tx.execute(sql`SELECT id FROM companies WHERE id=${companyId} FOR UPDATE`);
   if(b.branchId)await returnAuthorize(userId,companyId,"configure",b.branchId,tx);
   let planId=b.commissionPlanId??null;
   if(b.commissionEnabled&&!b.inherit){
    if(planId){
     const p=(await tx.execute(sql`SELECT * FROM commission_plans WHERE id=${planId} AND company_id=${companyId} AND is_active`)).rows[0];
     if(!p||Number(p.quota)!==0||Number(p.bonus_rate)!==0||Number(p.rate)<0||Number(p.rate)>100)throw new FinancialRequestError("اختر خطة نسبة صافية بسيطة من 0 إلى 100 بالمئة مملوكة للشركة",422);
    }else{
     if(b.commissionRatePercent===undefined)throw new FinancialRequestError("حدد نسبة العمولة صراحة؛ لا توجد نسبة افتراضية",422);
     const p=(await tx.execute(sql`INSERT INTO commission_plans(company_id,name,rate,quota,bonus_rate)
      VALUES(${companyId},${`عمولة البائع — ${b.effectiveFrom}`},${String(b.commissionRatePercent)},0,0) RETURNING id`)).rows[0]!;
     planId=Number(p.id);
    }
   }else planId=null;
   const p=(await tx.execute(sql`INSERT INTO sales_seller_policies(company_id,branch_id,inherit,mode,granularity,commission_enabled,commission_plan_id,effective_from,created_by)
    VALUES(${companyId},${b.branchId},${b.inherit},${b.mode},${b.granularity},${b.commissionEnabled&&!b.inherit},${planId},${b.effectiveFrom},${userId}) RETURNING *`)).rows[0];
   return p;
  });res.json(result);
 }catch(e){handleRouteError(e,res);}
});
router.post("/sales/sellers/eligibility",async(req,res)=>{
 try{
  const companyId=req.session.companyId!,userId=req.session.userId!;await returnAuthorize(userId,companyId,"configure");
  const b=z.object({employeeId:id,enabled:z.boolean(),branchIds:z.array(id).max(100).nullable()}).strict().parse(req.body);
  const result=await db.transaction(async tx=>{
   await tx.execute(sql`SELECT id FROM companies WHERE id=${companyId} FOR UPDATE`);
   const e=(await tx.execute(sql`SELECT id FROM employees WHERE id=${b.employeeId} AND company_id=${companyId} FOR UPDATE`)).rows[0];
   if(!e)throw new FinancialRequestError("الموظف ليس من الشركة",404);
   for(const branch of b.branchIds??[])await returnAuthorize(userId,companyId,"configure",branch,tx);
   return (await tx.execute(sql`INSERT INTO sales_seller_eligibility(company_id,employee_id,enabled,branch_ids,updated_by)
    VALUES(${companyId},${b.employeeId},${b.enabled},${b.branchIds===null?null:JSON.stringify([...new Set(b.branchIds)])}::jsonb,${userId})
    ON CONFLICT(company_id,employee_id) DO UPDATE SET enabled=excluded.enabled,branch_ids=excluded.branch_ids,updated_by=excluded.updated_by,updated_at=now() RETURNING *`)).rows[0];
  });res.json(result);
 }catch(e){handleRouteError(e,res);}
});
router.get("/sales/sellers/report",async(req,res)=>{
 try{
  const q=z.object({from:day,to:day,branchId:id.optional(),sellerId:z.coerce.number().int().min(0).optional()}).parse(req.query);
  if(q.to<q.from)throw new FinancialRequestError("بداية الفترة بعد نهايتها",400);
  res.json(await sellerReport(req.session.companyId!,req.session.userId!,q.from,q.to,q.branchId,q.sellerId));
 }catch(e){handleRouteError(e,res);}
});
router.post("/sales/invoices/:id/attribution",async(req,res)=>{
 try{
  const companyId=req.session.companyId!,userId=req.session.userId!,invoiceId=id.parse(req.params.id);
  const b=z.object({reason:z.string().trim().min(5).max(1000),sellerEmployeeId:id.nullable(),
   lineSellers:z.array(z.object({invoiceLineId:id,employeeId:id.nullable()})).max(1000)}).strict().parse(req.body);
  const result=await db.transaction(async tx=>{
   const row=(await tx.execute(sql`SELECT branch_id FROM customer_invoices WHERE id=${invoiceId} AND company_id=${companyId}`)).rows[0];
   if(!row)throw new FinancialRequestError("الفاتورة غير متاحة",404);
   const actor=await returnAuthorize(userId,companyId,"seller_edit",row.branch_id==null?undefined:Number(row.branch_id),tx);
   if(row.branch_id==null&&actor.branches!==null)throw new FinancialRequestError("فاتورة دون فرع مثبت؛ لا تدخل في نطاقك",403);
   return correctSellerLines(tx,companyId,invoiceId,userId,b.reason,b.sellerEmployeeId,b.lineSellers);
  });res.json(result);
 }catch(e){handleRouteError(e,res);}
});
router.post("/sales/commissions/:id/state",async(req,res)=>{
 try{
  const companyId=req.session.companyId!,userId=req.session.userId!,eventId=id.parse(req.params.id);
  const b=z.object({action:z.enum(["approve","record_paid"]),reference:z.string().trim().min(5).max(1000)}).strict().parse(req.body);
  const result=await db.transaction(async tx=>{
   const e=(await tx.execute(sql`SELECT * FROM sales_commission_events WHERE id=${eventId} AND company_id=${companyId} FOR UPDATE`)).rows[0];
   if(!e)throw new FinancialRequestError("حركة العمولة غير متاحة",404);
   const actor=await returnAuthorize(userId,companyId,b.action==="approve"?"commission_approve":"commission_paid",e.branch_id==null?undefined:Number(e.branch_id),tx);
   if(e.branch_id==null&&actor.branches!==null)throw new FinancialRequestError("الحركة دون فرع مثبت",403);
   const policy=e.policy as {commissionEnabled:boolean};
   if(!policy.commissionEnabled||e.employee_id==null)throw new FinancialRequestError("لا عمولة مفعلة أو بائع لهذه الحركة",409);
   const next=b.action==="approve"?"approved":"paid";
   if(e.status===next){if(next==="paid"&&e.external_reference!==b.reference)throw new FinancialRequestError("لا تغير إثبات دفع محفوظ",409);return e;}
   if(e.status!==(b.action==="approve"?"calculated":"approved"))throw new FinancialRequestError("انتقال حالة غير مسموح؛ الدفع يحتاج اعتمادا سابقا",409);
   const row=(await tx.execute(b.action==="approve"
    ?sql`UPDATE sales_commission_events SET status='approved',approved_by=${userId},approved_at=now() WHERE id=${eventId} AND company_id=${companyId} RETURNING *`
    :sql`UPDATE sales_commission_events SET status='paid',paid_by=${userId},paid_at=now(),external_reference=${b.reference} WHERE id=${eventId} AND company_id=${companyId} RETURNING *`)).rows[0];
   await tx.execute(sql`INSERT INTO sales_commission_state_audit(company_id,event_id,old_status,new_status,reference,user_id)
    VALUES(${companyId},${eventId},${String(e.status)},${next},${b.reference},${userId})`);
   return {...row,payoutExecuted:false,journalCreated:false};
  });res.json(result);
 }catch(e){handleRouteError(e,res);}
});
export default router;
