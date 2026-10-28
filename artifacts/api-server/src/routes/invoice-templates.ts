import { Router, type Request } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";
import { createHash } from "node:crypto";
import QRCode from "qrcode";
import { authorizeSettingsScope } from "../lib/scoped-app-settings";
import { lockApprovalAuthority } from "../lib/approval-authority";
import { FinancialRequestError } from "../lib/financial-transaction";
import { handleRouteError } from "../lib/handle-error";
import { captureIssuer, type IdentityTx } from "../lib/document-identity";
import { printableIssuer } from "../lib/pdf/print-company";
import { buildCustomerInvoicePdf } from "../lib/pdf/business-documents";
import { buildPrintPdf, type PrintDocument } from "../lib/pdf/print-document";
import { defaultInvoiceDesign, invoicePresets, InvoiceDesignSchema, validateDesignAssets, type InvoiceDesign } from "../lib/invoice-design";
import { uploadBufferToPrivateObject } from "./storage";
import { normalizePrintLogo } from "../lib/print-logo-validation";
const router=Router();
const scopeSchema=z.object({expectedCompanyId:z.number().int().positive(),branchId:z.number().int().positive().nullable()});
async function authorized<T>(req:Request,branchId:number|null,expected:number|undefined,operation:(tx:IdentityTx,companyId:number)=>Promise<T>) {
  return db.transaction(async tx=>{
    await lockApprovalAuthority(tx);
    const actor=await authorizeSettingsScope(req,tx,branchId,true);
    if(expected!==undefined&&expected!==actor.companyId)throw new FinancialRequestError("تغيرت المنشأة؛ أعد فتح القوالب",409);
    await tx.execute(sql`SELECT id FROM companies WHERE id=${actor.companyId} FOR SHARE`);
    await authorizeSettingsScope(req,tx,branchId,true);
    return operation(tx,actor.companyId);
  });
}
export async function demoInvoicePdf(tx:IdentityTx,companyId:number,design:InvoiceDesign,sample:"short"|"long",width:"a4"|"80") {
  const issuer=await captureIssuer(tx,companyId);
  issuer.invoiceDesign={schemaVersion:1,layoutVersion:2,design,source:"default",companyRevision:0,branchRevision:0,branchId:null};
  const company=await printableIssuer(issuer);
  const lines=Array.from({length:sample==="long"?80:3},(_,i)=>({
    description:`${i+1} — منتج تجريبي سلام الإقرار / Coffee ABC-2026 — اسم عربي طويل لاختبار التفاف الوصف دون قص`,
    quantity:2,unitPrice:100,taxRate:issuer.vatEnabled?15:0,lineTotal:issuer.vatEnabled?230:200,
  }));
  // Synthetic fixed arithmetic, never from a caller and never persisted.
  const subtotal=lines.length*200,discount=20,vat=issuer.vatEnabled?(subtotal-discount)*0.15:0,total=subtotal-discount+vat;
  const qr=await QRCode.toDataURL("HASIBA-SYNTHETIC-PREVIEW-NOT-A-TAX-INVOICE",{margin:1,width:220});
  if(width==="80") {
    const doc:PrintDocument={title:"معاينة إيصال — بيانات تجريبية",company,invoiceDesign:design,layoutVersion:2,thermalWidth:80,
      metadata:[["المرجع","DEMO — ليس رقم فاتورة"],["العميل","عميل تجريبي / Demo"],["التاريخ","28/10/2026"]],
      headers:["الصنف","العدد","السعر","الإجمالي"],rows:lines.map(l=>[l.description,l.quantity,l.unitPrice,l.lineTotal]),
      totals:[["قبل الضريبة",subtotal],["الخصم",discount],["الضريبة",vat],["الإجمالي",total]],
      notes:["معاينة مصطنعة لا تنشئ فاتورة أو قيدًا أو حركة مخزون"],qr};
    return buildPrintPdf(doc);
  }
  return buildCustomerInvoicePdf({reference:"DEMO — معاينة وليست فاتورة",invoiceDate:"2026-10-28",dueDate:"2026-11-28",
    currencyCode:"SAR",subtotal,discount,vat,total,amountPaid:0,status:"draft",
    notes:"بيانات تجريبية فقط — لا إصدار مالي ولا اعتماد ضريبي. فرق اختباري (-20.00) لا يغير الدفاتر.",
    customer:{name:"عميل تجريبي طويل الاسم / Example Trading",address:"الرياض — عنوان تجريبي",email:"demo@example.invalid",phone:"",vatNumber:null},
    lines,zatcaQrDataUrl:issuer.vatEnabled?qr:null},company);
}
router.get("/print/templates",async(req,res)=>{
  try { res.json(await authorized(req,null,undefined,async()=>({canManage:true,presets:invoicePresets,defaultDesign:defaultInvoiceDesign}))); }
  catch(error){handleRouteError(error,res);}
});
router.post("/print/templates/preview",async(req,res)=>{
  try {
    const body=scopeSchema.extend({design:InvoiceDesignSchema,sample:z.enum(["short","long"]),width:z.enum(["a4","80"])}).strict().parse(req.body);
    const pdf=await authorized(req,body.branchId,body.expectedCompanyId,async(tx,companyId)=>{
      const design=await validateDesignAssets(tx,companyId,body.design);
      return demoInvoicePdf(tx,companyId,design,body.sample,body.width);
    });
    res.set({"Content-Type":"application/pdf","Content-Disposition":"inline; filename=\"invoice-template-demo.pdf\"","Cache-Control":"no-store"}).send(pdf);
  } catch(error){handleRouteError(error,res);}
});
router.post("/print/templates/logo",async(req,res)=>{
  try {
    const body=scopeSchema.extend({contentBase64:z.string().min(4).max(2800000)}).strict().parse(req.body);
    const result=await authorized(req,body.branchId,body.expectedCompanyId,async(tx,companyId)=>{
      const buffer=await normalizePrintLogo(body.contentBase64);
      const {objectKey}=await uploadBufferToPrivateObject({buffer,contentType:"image/png",ext:"png",folder:`company-print/${companyId}`});
      await tx.execute(sql`INSERT INTO company_print_logos(object_key,company_id,digest,content_type)
        VALUES(${objectKey},${companyId},${createHash("sha256").update(buffer).digest("hex")},'image/png')`);
      return {objectKey};
    });
    res.status(201).json(result);
  } catch(error){handleRouteError(error,res);}
});
export default router;
