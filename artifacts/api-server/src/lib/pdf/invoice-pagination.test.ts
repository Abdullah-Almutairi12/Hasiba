import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import QRCode from "qrcode";
import { defaultInvoiceDesign, invoicePresets } from "../invoice-design";
import { buildPrintPdf, printHtml, type PrintDocument } from "./print-document";
import { buildCustomerInvoicePdf } from "./business-documents";

const out=resolve(process.cwd(),"../../generated-artifacts/invoice-pagination-2a/after");
const inspect=String.raw`
import pymupdf,sys,json,re
d=pymupdf.open(sys.argv[1]); result=[]
for p in d:
    blocks=[b for b in p.get_text("blocks") if not re.fullmatch(r"\s*\d+\s*/\s*\d+\s*",b[4])]
    result.append({"widthMm":p.rect.width*25.4/72,"heightMm":p.rect.height*25.4/72,
      "bottomMm":max([b[3] for b in blocks] or [0])*25.4/72,"text":p.get_text()})
print(json.dumps(result))
`;
function record(name:string,pdf:Buffer){
  mkdirSync(out,{recursive:true});const path=resolve(out,`${name}.pdf`);
  writeFileSync(path,pdf);
  const info=JSON.parse(execFileSync("python",["-c",inspect,path],{encoding:"utf8"})) as
    Array<{widthMm:number;heightMm:number;bottomMm:number;text:string}>;
  writeFileSync(resolve(out,`${name}.json`),JSON.stringify(info,null,2));return info;
}
describe("prospective invoice pagination with immutable legacy rendering",()=>{
  it("retains the exact original HTML for unversioned historical designs",()=>{
    const input={title:"سلام الإقرار — Legacy ABC-2026",headers:["الوصف","الكمية","الإجمالي"],
      rows:[["منتج قديم",2,"230.00 SAR"]],invoiceDesign:defaultInvoiceDesign};
    expect(createHash("sha256").update(printHtml(input)).digest("hex"))
      .toBe("3278dfd259fe0aa9eaf099142f3f6153fe0caaaba30688329830a8955f793b3d");
    expect(printHtml(input)).not.toContain("metadata-pair");
    expect(printHtml({...input,layoutVersion:2})).toContain("table.line-items");
  });
  for(const preset of invoicePresets) for(const length of [3,80]) {
    it(`${preset.id} prints ${length} mixed-language lines without orphan short pages`,async()=>{
      const qr=await QRCode.toDataURL("PAGINATION-SYNTHETIC-NOT-TAX-ACCEPTANCE",{margin:2});
      const company={nameAr:"منشأة اختبار قوالب البيع",nameEn:"Test Company",address:"الرياض",
        vatNumber:"310000000000003",phone:"",email:"",bankName:"",bankIban:"",termsAr:"",termsEn:"",
        vatEnabled:true,invoiceDesign:{schemaVersion:1 as const,layoutVersion:2 as const,design:{...defaultInvoiceDesign,preset:preset.id}}};
      const lines=Array.from({length},(_,i)=>({description:`ROW${String(i+1).padStart(3,"0")} — منتج تجريبي سلام الإقرار / Coffee ABC-2026 — اسم عربي طويل لاختبار التفاف الوصف دون قص`,
        quantity:2,unitPrice:100,taxRate:15,lineTotal:230}));
      const pdf=await buildCustomerInvoicePdf({reference:"DEMO — معاينة وليست فاتورة",invoiceDate:"2026-10-28",dueDate:"2026-11-28",
        currencyCode:"SAR",subtotal:length*200,discount:20,vat:(length*200-20)*.15,total:(length*200-20)*1.15,
        amountPaid:0,status:"draft",notes:"بيانات تجريبية فقط — لا إصدار مالي ولا اعتماد ضريبي.",
        customer:{name:"عميل تجريبي طويل الاسم / Example Trading",address:"الرياض — عنوان تجريبي",email:"demo@example.invalid",phone:null,vatNumber:null},
        lines,zatcaQrDataUrl:qr},company);
      const pages=record(`${preset.id}-${length===3?"short":"long"}`,pdf),text=pages.map(p=>p.text).join("\n");
      if(length===3)expect(pages).toHaveLength(1);
      else {expect(pages.length).toBeGreaterThan(1);expect(pages.at(-1)!.bottomMm).toBeGreaterThan(100);}
      expect(text.match(/ROW\d{3}/g)).toHaveLength(length);
      for(let i=1;i<=length;i++)expect(text.match(new RegExp(`ROW${String(i).padStart(3,"0")}`,"g"))).toHaveLength(1);
      expect(text).toContain("سلام");expect(text).toContain("الإقرار");
      for(const p of pages){expect(p.widthMm).toBeCloseTo(210,0);expect(p.bottomMm).toBeLessThan(280);}
    },60000);
  }
  it.each([58,80] as const)("sizes each %dmm thermal sheet to its actual contents",async width=>{
    const doc:PrintDocument={layoutVersion:2,invoiceDesign:defaultInvoiceDesign,thermalWidth:width,
      title:"إيصال تجريبي سلام الإقرار",headers:["الصنف","العدد","السعر","الإجمالي"],
      rows:Array.from({length:80},(_,i)=>[`ROW${String(i+1).padStart(3,"0")} — قهوة عربية / Coffee ABC-2026 وصف طويل دون قص`,2,100,230]),
      totals:[["قبل الضريبة",16000],["ضريبة",2400],["الإجمالي",18400]],
      qr:await QRCode.toDataURL("PAGINATION-SYNTHETIC-NOT-TAX-ACCEPTANCE",{margin:2}),notes:["نهاية الإيصال — End of receipt"]};
    const pages=record(`thermal${width}-long`,await buildPrintPdf(doc)),text=pages.map(p=>p.text).join("\n");
    expect(pages.length).toBeGreaterThan(1);expect(text.match(/ROW\d{3}/g)).toHaveLength(80);
    expect(text).toContain("End of receipt");
    for(const p of pages){
      expect(p.widthMm).toBeCloseTo(width,0);expect(p.heightMm).toBeLessThanOrEqual(1001);
      expect(p.heightMm).toBeLessThanOrEqual(Math.max(61,p.bottomMm+22));
    }
  },60000);
  it("retains supported logo, font and long customization without deleting content",async()=>{
    const text="تخصيص سلام / Custom ABC ".repeat(20);
    const input:PrintDocument={layoutVersion:2,title:"حدود التخصيص",
      invoiceDesign:{...defaultInvoiceDesign,preset:"modern",fontSize:16,logoWidth:48,
        header:text.slice(0,250),footer:text.slice(0,500),note:text.repeat(3).slice(0,1000)},
      company:{nameAr:"منشأة اختبار",nameEn:"Test",address:"الرياض",vatNumber:"",phone:"",email:"",
        bankName:"",bankIban:"",termsAr:"",termsEn:"",logo:{data:await QRCode.toBuffer("LOCAL-TEST-LOGO"),contentType:"image/png"}},
      headers:["الوصف","العدد","المبلغ"],rows:[["سلام الإقرار / Long customization ABC",1,230]],
      totals:[["الإجمالي",230]],notes:["END-OF-SOURCE-NOTE"]};
    const pages=record("maximum-customization",await buildPrintPdf(input)),all=pages.map(p=>p.text).join("\n");
    expect(all).toContain("END-OF-SOURCE-NOTE");expect(all.match(/Custom/g)?.length)
      .toBe((input.invoiceDesign!.header.match(/Custom/g)?.length??0)+(input.invoiceDesign!.footer.match(/Custom/g)?.length??0)+(input.invoiceDesign!.note.match(/Custom/g)?.length??0));
  },60000);
});
