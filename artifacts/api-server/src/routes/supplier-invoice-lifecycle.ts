import { Router,type Request,type RequestHandler } from "express";
import { db, purchaseOrdersTable, suppliersTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { FinancialRequestError } from "../lib/financial-transaction";
import { handleClosedPeriod } from "../lib/handle-error";
import { supplierInvoiceActor,assertSupplierInvoice } from "../lib/supplier-invoice-access";
import { procurementOrderScope } from "../lib/procurement-authority";
import { saveSupplierDraft,processSupplierInvoice } from "../lib/supplier-invoice-lifecycle";
const router=Router();
const handle=(fn:(req:Request)=>Promise<unknown>):RequestHandler=>async(req,res)=>{
 try {
   if(req.params.id!=null && (!Number.isSafeInteger(Number(req.params.id))||Number(req.params.id)<=0))
     throw new FinancialRequestError("مرجع الفاتورة غير صالح",400);
   if(req.method!=="GET"&&!req.get("Idempotency-Key"))
     throw new FinancialRequestError("يلزم معرف محاولة ثابت للحفظ واستعادة النتيجة المؤكدة",400);
   res.json(await fn(req));
 }
 catch(error) {
   if(handleClosedPeriod(error,res))return;
   if(error instanceof FinancialRequestError){res.status(error.status).json({error:error.message});return;}
   if(error instanceof z.ZodError){res.status(400).json({error:"بيانات الفاتورة غير صالحة",details:error.issues});return;}
   const e=error as {code?:string;cause?:{code?:string}};
   if(e.code==="23505"||e.cause?.code==="23505"){res.status(409).json({error:"تكرار مؤكد: رقم الفاتورة لنفس المورد ونوع المستند موجود في الشركة"});return;}
   req.log.error({error},"supplier invoice lifecycle failed");res.status(500).json({error:"تعذر تنفيذ إجراء الفاتورة"});
 }
};
router.get("/invoices/draft-options",handle(async req=>{
 const actor=req.query.invoiceId
   ?(await assertSupplierInvoice(req,z.coerce.number().int().positive().parse(req.query.invoiceId),"edit")).actor
   :await supplierInvoiceActor(req,"create");
 const suppliers=await db.select({id:suppliersTable.id,name:suppliersTable.name}).from(suppliersTable)
   .where(eq(suppliersTable.companyId,actor.companyId));
 const referenceActor={...actor,grant:actor.grant?{...actor.grant,amountLimit:null}:null};
 const orders=await db.select().from(purchaseOrdersTable).where(procurementOrderScope(referenceActor));
 const source=orders.filter(o=>o.currencyCode==="SAR"&&Number(o.exchangeRate)===1&&
   ["confirmed","partially_received","fully_received"].includes(o.status));
 const result=[];
 for(const order of source) {
   const lines=await db.execute(sql`SELECT l.id,l.description,l.quantity::text,l.unit_price::text AS "unitPrice",
     l.product_id AS "productId",coalesce(to_jsonb(l)->>'unit',p.unit,'piece') AS unit FROM purchase_order_lines l
     LEFT JOIN products p ON p.id=l.product_id AND p.company_id=${actor.companyId} WHERE l.po_id=${order.id}`);
   const wh=await db.execute(sql`SELECT branch_id FROM warehouses WHERE id=${order.warehouseId} AND company_id=${actor.companyId}`);
   if(!wh.rows.length)continue;
   const referenceOnly=actor.grant?.amountLimit!=null&&Number(order.total)>Number(actor.grant.amountLimit);
   result.push({id:order.id,reference:order.reference,supplierId:order.supplierId,branchId:Number(wh.rows[0].branch_id),
     referenceOnly,lines:lines.rows.map(l=>referenceOnly
       ?{id:l.id,description:l.description,productId:l.productId,unit:l.unit}:l)});
 }
 const accounts=await db.execute(sql`SELECT id,name_ar AS name FROM accounts
   WHERE type='expense' AND is_active AND NOT is_group ORDER BY code`);
 const branches=await db.execute(sql`SELECT id,name FROM branches WHERE company_id=${actor.companyId} AND is_active
   ${actor.branches?sql`AND id=ANY(${sql.param(actor.branches)}::integer[])`:sql``}`);
 return {suppliers,orders:result,accounts:accounts.rows,branches:branches.rows};
}));
router.post("/invoices/drafts",handle(req=>saveSupplierDraft(req)));
router.patch("/invoices/:id/draft",handle(req=>saveSupplierDraft(req,Number(req.params.id))));
router.post("/invoices/:id/process",handle(req=>{
 const action=z.enum(["review","submit","post","cancel","reverse"]).parse(req.body.action);
 return processSupplierInvoice(req,Number(req.params.id),action);
}));
export default router;
