import { Router, type Request } from "express";
import { db, pool } from "@workspace/db";
import { z } from "zod/v4";
import QRCode from "qrcode";
import { handleRouteError } from "../lib/handle-error";
import { FinancialRequestError } from "../lib/financial-transaction";
import { checkDocumentPrint } from "../lib/print-permissions";
import { returnAuthorize } from "../lib/return-access";
import { captureIssuer, documentIssuer, inspectIssuerQr, type DocumentKind } from "../lib/document-identity";
import { printableIssuer } from "../lib/pdf/print-company";
import { sendPrintPdf, type PrintDocument } from "../lib/pdf/print-document";
import { sessionCash } from "./return-settlement";
import { savedSellerLines,sellerLineDescription } from "../lib/seller-ledger";
const router = Router();
const methods: Record<string,string> = { cash:"نقدي",card:"بطاقة",transfer:"تحويل",stc:"STC Pay",credit:"رصيد العميل",mixed:"دفع متعدد",deferred:"آجل" };
const states: Record<string,string> = { paid:"مدفوعة",partially_paid:"مدفوعة جزئيا",open:"غير مسددة",draft:"مسودة",issued:"صادر",cancelled:"ملغى",pending:"قيد اعتماد الفرق",approved:"معتمد",requested:"طلب استرداد — لم يرسل إلى مزود",confirmed:"تسليم نقدي مؤكد",external_confirmed:"استرداد خارجي مسجل يدويا" };
const date = (value: unknown) => value ? new Date(String(value)).toLocaleString("ar-SA",{timeZone:"Asia/Riyadh",calendar:"gregory",hour12:false}) : "غير متاح";
const money = (v: unknown) => `${Number(v).toFixed(2)} ر.س`;
const idOf = (req: Request) => z.coerce.number().int().positive().parse(req.params.id);
function missing(): never { throw new FinancialRequestError("المستند غير موجود في الشركة النشطة",404); }
async function print(req: Request, kind: DocumentKind, id: number, doc: PrintDocument) {
  const issuer = await documentIssuer(req.session.companyId!,kind,id);
  return { ...doc, company:await printableIssuer(issuer), notes:[
    ...(!issuer.verifiedSnapshot?["لا تتوافر هوية الإصدار التاريخية لهذا المستند؛ لا تستخدم بيانات الشركة الحالية لإثبات هويته."]:[]),
    ...(!issuer.vatNumber && issuer.vatEnabled?["الرقم الضريبي للمصدر غير متاح."]:[]),
    ...(!issuer.bankName&&!issuer.bankIban?["بيانات البنك غير متاحة."]:[]),
    ...doc.notes??[],issuer.termsAr,
    ...(issuer.bankName||issuer.bankIban?[`${issuer.bankName} | IBAN ${issuer.bankIban}`]:[]),
  ].filter(Boolean) };
}
router.get("/pos/orders/:id/receipt.pdf", async(req,res)=>{
  try {
    const id=idOf(req), companyId=req.session.companyId!;
    await checkDocumentPrint(req,"pos",id);
    const {rows}=await pool.query(`SELECT o.*,i.id AS invoice_id,i.reference AS invoice_reference,i.zatca_qr,i.status AS invoice_status,i.amount_paid AS invoice_amount_paid,
      s.branch_id,s.cashier_name,b.name AS branch_name
      FROM pos_orders o JOIN pos_sessions s ON s.id=o.session_id
      JOIN branches b ON b.id=s.branch_id AND b.company_id=o.company_id
      JOIN sales_orders so ON so.notes='POS '||o.order_number AND so.source='pos' AND so.company_id=o.company_id
      JOIN customer_invoices i ON i.so_id=so.id AND i.company_id=o.company_id
      WHERE o.id=$1 AND o.company_id=$2 AND o.status='paid' AND i.status<>'cancelled'`,[id,companyId]);
    const o=rows[0]; if(!o) missing();
    const width=z.coerce.number().pipe(z.union([z.literal(58),z.literal(80)])).parse(req.query.width??80);
    const layout=await captureIssuer(db,companyId);
    if(!layout.receiptWidths.includes(width)) throw new FinancialRequestError("عرض الإيصال غير مفعل في إعدادات الطباعة",400);
    const payments=(await pool.query("SELECT method,amount FROM pos_order_payments WHERE order_id=$1 ORDER BY id",[id])).rows;
    const sellers=await savedSellerLines(companyId,Number(o.invoice_id));
    const qr=o.zatca_qr?await QRCode.toDataURL(o.zatca_qr,{margin:1,width:220}):null;
    const doc=await print(req,"pos",id,{title:"إيصال بيع",thermalWidth:width,
      metadata:[["الإيصال",o.order_number],["الفاتورة",o.invoice_reference],["الحالة",states[o.invoice_status]??o.invoice_status],["الفرع",o.branch_name],["التاريخ",date(o.created_at)],["المحصل",o.cashier_name]],
      headers:["الصنف","العدد","السعر","الإجمالي"],
      rows:(o.items as Array<Record<string,unknown>>).map((l,index)=>[sellerLineDescription(String(l.productName??l.name??""),sellers[index]),Number(l.quantity),money(l.unitPrice),money(l.lineTotal??Number(l.quantity)*Number(l.unitPrice))]),
      totals:[["قبل الضريبة",money(o.subtotal)],["الخصم",money(o.discount)],["الضريبة",money(o.tax)],
        ...payments.map(p=>[methods[p.method]??p.method,money(p.amount)] as [string,string]),
        ["المدفوع",money(o.invoice_amount_paid)],["المتبقي",money(Math.max(0,Number(o.total)-Number(o.invoice_amount_paid)))],["الإجمالي",money(o.total)]],
      notes:["إعادة الطباعة لا تنشئ بيعًا أو حركة مالية جديدة.","مطابقة الرمز ليست اعتمادًا رسميًا للمرحلة الثانية."],qr});
    await sendPrintPdf(res,`receipt-${o.order_number}-${width}mm`,doc);
  }catch(error){handleRouteError(error,res);}
});
router.get("/sales/credit-notes/:id/pdf",async(req,res)=>{
  try {
    const id=idOf(req),companyId=req.session.companyId!;
    const {rows}=await pool.query(`SELECT n.*,i.reference AS original_reference,i.branch_id,c.branch_id AS control_branch
      FROM credit_notes n JOIN customer_invoices i ON i.id=n.invoice_id AND i.company_id=n.company_id
      LEFT JOIN return_controls c ON c.note_id=n.id AND c.company_id=n.company_id
      WHERE n.id=$1 AND n.company_id=$2`,[id,companyId]);
    const n=rows[0];if(!n)missing();
    await checkDocumentPrint(req,"invoice",Number(n.invoice_id));
    await returnAuthorize(req.session.userId!,companyId,"view",n.control_branch??n.branch_id??undefined);
    if (!["issued","applied"].includes(n.status) && !(n.status==="cancelled"&&n.journal_entry_id!=null)) {
      throw new FinancialRequestError("المستند لم يصدر ماليًا بعد؛ لا تتوفر طباعة نهائية قبل اكتمال الاعتماد والاستلام والترحيل",409);
    }
    const lines=(await pool.query("SELECT description,quantity,unit_price,tax_rate,line_total,invoice_line_id FROM credit_note_lines WHERE note_id=$1 ORDER BY id",[id])).rows;
    const sellers=new Map((await savedSellerLines(companyId,Number(n.invoice_id))).map(l=>[l.invoice_line_id,l]));
    await sendPrintPdf(res,`credit-${n.reference}`,await print(req,"credit",id,{title:"إشعار دائن",
      metadata:[["المرجع",n.reference],["الفاتورة الأصلية",n.original_reference],["التاريخ",date(n.note_date)],["الحالة",states[n.status]??n.status]],
      headers:["الوصف","الكمية","سعر الوحدة","الإجمالي"],rows:lines.map(l=>[sellerLineDescription(l.description,sellers.get(Number(l.invoice_line_id))),Number(l.quantity),money(l.unit_price),money(l.line_total)]),
      totals:[["قبل الضريبة",money(n.subtotal)],["الضريبة",money(n.vat)],["الإجمالي",money(n.total)]],notes:[n.reason??""]}));
  }catch(error){handleRouteError(error,res);}
});
router.get("/pos/refunds/:id/pdf",async(req,res)=>{
  try {
    const id=idOf(req),companyId=req.session.companyId!;
    const {rows}=await pool.query(`SELECT p.*,n.reference AS note_reference,i.reference AS invoice_reference,c.branch_id,
      r.reference AS receipt_reference,u.name AS operator_name,cu.name AS confirmer_name
      FROM return_payouts p JOIN credit_notes n ON n.id=p.note_id AND n.company_id=p.company_id
      JOIN customer_invoices i ON i.id=p.invoice_id AND i.company_id=p.company_id
      JOIN return_controls c ON c.note_id=n.id AND c.company_id=p.company_id
      LEFT JOIN customer_receipts r ON r.id=p.receipt_id AND EXISTS
        (SELECT 1 FROM customers rc WHERE rc.id=r.customer_id AND rc.company_id=p.company_id)
      LEFT JOIN users u ON u.id=p.created_by LEFT JOIN users cu ON cu.id=p.confirmed_by
      WHERE p.id=$1 AND p.company_id=$2`,[id,companyId]);
    const p=rows[0];if(!p)missing();
    await checkDocumentPrint(req,"invoice",Number(p.invoice_id));
    await returnAuthorize(req.session.userId!,companyId,"view",p.branch_id);
    await sendPrintPdf(res,`refund-${id}`,await print(req,"refund",id,{title:"سند استرداد",
      metadata:[["السند",String(id)],["الفاتورة الأصلية",p.invoice_reference],["الإشعار الدائن",p.note_reference],["مصدر التحصيل الأصلي",p.receipt_reference??"غير متاح"],
        ["الطريقة",methods[p.method]??p.method],["الحالة",states[p.status]??p.status],["المنفذ",p.operator_name??String(p.created_by)],["المؤكد",p.confirmer_name??"غير متاح"],
        ["الإنشاء",date(p.created_at)],["التأكيد",date(p.confirmed_at)],["مرجع الإثبات",p.reference??"غير متاح"]],
      headers:["البيان","المبلغ"],rows:[[states[p.status]??p.status,money(p.amount)]],notes:[p.status==="requested"?"هذا طلب محفوظ فقط؛ لم ينفذ أو يرسل إلى شبكة دفع.":p.status==="external_confirmed"?"تأكيد يدوي بناء على إثبات خارجي؛ ليس تنفيذا عبر مزود داخل النظام.":"لا تنفذ الطباعة أي استرداد جديد."]}));
  }catch(error){handleRouteError(error,res);}
});
router.get("/pos/sessions/:id/closing.pdf",async(req,res)=>{
  try {
    const id=idOf(req),companyId=req.session.companyId!;
    const summary=await db.transaction(tx=>sessionCash(tx,id,companyId));
    await returnAuthorize(req.session.userId!,companyId,"view",Number(summary.branch_id));
    const {rows}=await pool.query(`SELECT c.*,s.session_number,s.cashier_name,s.closed_at,u.name AS approver
      FROM pos_cash_closings c JOIN pos_sessions s ON s.id=c.session_id
      LEFT JOIN users u ON u.id=c.approved_by WHERE c.session_id=$1 AND c.company_id=$2`,[id,companyId]);
    const c=rows[0];if(!c)missing();
    const ownerException=(summary as Record<string,unknown>).closing_owner_exception===true;
    const refunds=(await pool.query("SELECT coalesce(sum(amount),0) AS amount FROM return_payouts WHERE company_id=$1 AND session_id=$2 AND method='cash' AND status='confirmed'",[companyId,id])).rows[0]!;
    await sendPrintPdf(res,`closing-${c.session_number}`,await print(req,"closing",id,{title:"محضر إقفال وردية",
      metadata:[["الوردية",c.session_number],["المحصل",c.cashier_name],["التاريخ",date(c.created_at)],["الحالة",states[c.status]??c.status],["المراجع",c.approver??"لم يعتمد"],["تاريخ المراجعة",date(c.approved_at)],
        ["مسار المراجعة",ownerException?"استثناء مالك موثق — ليس اعتماد شخص مستقل":"المسار المعتاد"]],
      headers:["البيان","المبلغ"],rows:[["رصيد الافتتاح",money(summary.opening)],["النقد المحصل",money(summary.cash_in)],
        ["الاستردادات النقدية المؤكدة",money(refunds.amount)],["المصروف النقدي",money(Number(summary.cash_out)-Number(refunds.amount))],
        ["المتوقع عند الإقفال",money(c.expected)],["المعدود",money(c.counted)],["الفرق",money(c.difference)]],notes:[c.reason??"","المتوقع والمعدود والفرق من سجل الإقفال المحفوظ؛ الطباعة للقراءة فقط."]}));
  }catch(error){handleRouteError(error,res);}
});
router.get("/sales/invoices/:id/identity-check",async(req,res)=>{
  try{
    const id=idOf(req),companyId=req.session.companyId!;await checkDocumentPrint(req,"invoice",id);
    const {rows}=await pool.query("SELECT reference,zatca_qr,total,vat FROM customer_invoices WHERE id=$1 AND company_id=$2",[id,companyId]);
    const i=rows[0];if(!i)missing(); const issuer=await documentIssuer(companyId,"invoice",id);
    res.json({reference:i.reference,hasSnapshot:issuer.verifiedSnapshot,...inspectIssuerQr(i.zatca_qr,issuer,Number(i.total),Number(i.vat)),
      notice:"فحص اتساق داخلي للقراءة فقط، وليس اعتمادًا رسميًا من هيئة الزكاة والضريبة والجمارك"});
  }catch(error){handleRouteError(error,res);}
});
export default router;
