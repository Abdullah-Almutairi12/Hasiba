import { buildPrintPdf, type PrintDocument } from "./print-document";
import { getCompanyInfoFromEnv, type CompanyInfo, type PoPdfInput } from "./purchase-order";
import type { CustomerInvoicePdfInput } from "./customer-invoice";
import type { SupplierInvoicePdfInput } from "./supplier-invoice";
import type { VatReturn } from "../vat-return";
import type { InvoiceDesign } from "../invoice-design";
import type { InvoiceDesignSnapshot } from "../invoice-design";
import type { EditorSnapshot } from "../invoice-editor-schema";
export { getCompanyInfo, getCompanyInfoFromEnv } from "./purchase-order";
export type { CompanyInfo, PoPdfInput } from "./purchase-order";
export type { CustomerInvoicePdfInput } from "./customer-invoice";
export type { SupplierInvoicePdfInput } from "./supplier-invoice";
const money=(v:number|null,currency="SAR")=>v===null?"غير متاح":`${new Intl.NumberFormat("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}).format(v)} ${currency}`;
const statusLabel=(v:string)=>({partially_paid:"مدفوعة جزئيًا",paid:"مدفوعة",open:"غير مسددة",draft:"مسودة",cancelled:"ملغاة",issued:"صادرة"}[v]??v);
const readableDate=(v:string)=>/^\d{4}-\d{2}-\d{2}$/.test(v)?v.split("-").reverse().join("/"):v;
const langTitle=(ar:string,en:string,language:"ar"|"en")=>language==="ar"?ar:en;
export function buildVatReturnPdf(v:VatReturn,c:CompanyInfo=getCompanyInfoFromEnv(),language:"ar"|"en"="ar") {
  const label=(ar:string,en:string)=>langTitle(ar,en,language);
  return buildPrintPdf({language,company:c,title:label("تقرير ضريبة القيمة المضافة","Value Added Tax Report"),
    metadata:[[label("السنة والربع","Year and quarter"),`${v.year} Q${v.quarter}`],[label("الفترة","Period"),`${v.periodStart} — ${v.periodEnd}`],[label("التوقيت","Time zone"),v.timezone??"UTC"],[label("الفروع","Branches"),label("جميع فروع الشركة","All company branches")]],
    headers:[label("البيان","Description"),label("المبلغ (ريال سعودي)","Amount (SAR)")],
    rows:[[label("توريدات خاضعة بنسبة 15%","Standard rated supplies"),money(v.supplies.standardRated)],[label("توريدات بالنسبة الصفرية","Zero rated supplies"),money(v.supplies.zeroRated)],[label("توريدات معفاة — التصنيف غير متاح","Exempt — classification unavailable"),money(v.supplies.exempt)],[label("ضريبة مخرجات نقاط البيع","POS output VAT"),money(v.outputVat.pos)],[label("ضريبة مخرجات الفواتير الأخرى","Other invoice output VAT"),money(v.outputVat.customerInvoices)],[label("إجمالي ضريبة المخرجات","Total output VAT"),money(v.outputVat.total)],[label("صافي ضريبة المدخلات من القيود المرحلة","Net input VAT from posted journals"),money(v.inputVat.total)]],
    totals:[[label("صافي الضريبة المستحقة / (الرصيد الدائن)","Net VAT payable / (credit)"),money(v.netPayable)]],
    notes:[label("للمراجعة وإعداد الإقرار. ليس ملف رفع رسميًا ولا إثباتًا لتقديم الإقرار أو قبوله.","For review and return preparation. Not an official upload format or evidence of filing or acceptance."),`Generated ${v.generatedAt}`]});
}
function commercial(input:{reference:string;date:string;currency:string;party:string;metadata?:Array<[string,string]>;lines:PoPdfInput["lines"];subtotal?:number;discount?:number;vat?:number;total:number;paid?:number;vatEnabled?:boolean;notes?:string|null;qr?:string|null;design?:InvoiceDesign;layoutVersion?:2|3;editor?:EditorSnapshot},company:CompanyInfo,title:string):Promise<Buffer> {
  const vat=input.vatEnabled!==false;
  const options:PrintDocument={company,title,metadata:[["المرجع",input.reference],["التاريخ",readableDate(input.date)],["الطرف",input.party],["العملة",input.currency],...(input.metadata??[])],headers:["الوصف","الكمية","سعر الوحدة",...(vat?["الضريبة %"]:[]),"الإجمالي"],rows:input.lines.map(l=>[l.description,l.quantity,money(l.unitPrice,input.currency),...(vat?[`${l.taxRate}%`]:[]),money(l.lineTotal,input.currency)]),
    totals:[...(input.subtotal!=null?[["قبل الضريبة",money(input.subtotal,input.currency)] as [string,string]]:[]),...(input.discount?[["الخصم",money(-input.discount,input.currency)] as [string,string]]:[]),...(vat&&input.vat!=null?[["ضريبة القيمة المضافة",money(input.vat,input.currency)] as [string,string]]:[]),["الإجمالي",money(input.total,input.currency)],...(input.paid!=null?[["المدفوع",money(input.paid,input.currency)] as [string,string],["المتبقي",money(Math.max(0,input.total-input.paid),input.currency)] as [string,string]]:[])],
    notes:[input.notes??"",company.termsAr,...(company.bankName||company.bankIban?[`${company.bankName} | IBAN ${company.bankIban}`]:[])].filter(Boolean),qr:vat?input.qr:undefined};
  if (input.design) {
    options.invoiceDesign=input.design;
    options.layoutVersion=input.layoutVersion;
    options.editor=input.editor;
    if(!input.design.showBank) options.notes=options.notes?.filter(n=>!n.includes("| IBAN "));
  }
  return buildPrintPdf(options);
}
function partyMetadata(p:object):Array<[string,string]>{const labels:Record<string,string>={vatNumber:"الرقم الضريبي للطرف",email:"بريد الطرف",phone:"هاتف الطرف",address:"عنوان الطرف"};return Object.entries(p).filter(([k,v])=>labels[k]&&v!=null&&String(v)!=="").map(([k,v])=>[labels[k]!,String(v)]);}
export function buildCustomerInvoicePdf(i:CustomerInvoicePdfInput,c:CompanyInfo=getCompanyInfoFromEnv()) {
  const issuer=c as CompanyInfo&{vatEnabled?:boolean;verifiedSnapshot?:boolean;invoiceDesign?:InvoiceDesignSnapshot};
  const registered=issuer.verifiedSnapshot===false?null:issuer.vatEnabled??true;
  return commercial({editor:issuer.invoiceDesign?.editor,design:issuer.invoiceDesign?.design,layoutVersion:issuer.invoiceDesign?.layoutVersion,reference:i.reference,date:i.invoiceDate,currency:i.currencyCode,party:i.customer.name,metadata:[["الاستحقاق",i.dueDate?readableDate(i.dueDate):"غير متاح"],["الحالة",statusLabel(i.status)],...partyMetadata(i.customer),...i.saleMetadata??[]],lines:i.lines,subtotal:i.subtotal,discount:i.discount,vat:i.vat,total:i.total,paid:i.amountPaid,vatEnabled:registered??true,notes:registered===null?[i.notes,"هوية الإصدار غير محفوظة؛ الأرقام والرمز من المستند الأصلي ولا يعاد توليدهما."].filter(Boolean).join("\n"):i.notes,qr:i.zatcaQrDataUrl},c,registered===true?"فاتورة ضريبية":"فاتورة");
}
export function buildPurchaseOrderPdf(i:PoPdfInput,c:CompanyInfo=getCompanyInfoFromEnv()) {return commercial({reference:i.reference,date:i.orderDate,currency:i.currencyCode,party:i.supplier.name,metadata:[["التسليم المتوقع",i.expectedDate??"—"],...partyMetadata(i.supplier)],lines:i.lines,subtotal:i.subtotal,vat:i.vat,total:i.total,vatEnabled:i.vatEnabled,notes:i.notes},c,"أمر شراء");}
export function buildSupplierInvoicePdf(i:SupplierInvoicePdfInput&{subtotal?:number;vat?:number},c:CompanyInfo=getCompanyInfoFromEnv()) {return commercial({reference:i.invoiceNumber,date:i.invoiceDate??"—",currency:i.currencyCode,party:i.supplier.name,metadata:[["الاستحقاق",i.dueDate??"—"],["الحالة",statusLabel(i.status)],["أمر الشراء",i.poReference??"—"],...partyMetadata(i.supplier)],lines:i.lines.length?i.lines:[{description:i.notes??"ملخص فاتورة المورد",quantity:1,unitPrice:i.amount,taxRate:0,lineTotal:i.amount}],subtotal:i.subtotal,vat:i.vat,total:i.amount,vatEnabled:i.vatEnabled,notes:i.notes,qr:i.zatcaQrDataUrl},c,"فاتورة مورد");}
