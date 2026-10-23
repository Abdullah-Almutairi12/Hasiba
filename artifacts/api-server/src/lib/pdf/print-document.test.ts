import {describe,it,expect,vi} from "vitest";
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {execFileSync} from "node:child_process";
import {runInNewContext} from "node:vm";
import ts from "typescript";
import {createRequire} from "node:module";
import QRCode from "qrcode";
import jsQR from "jsqr";
import {buildPrintPdf,printHtml,printBrowserHtml} from "./print-document";
describe("offline Arabic printing and download integrity",()=>{
  it.each([58,80] as const)("prints long searchable Arabic on a true %d mm thermal roll",async width=>{
    const dir=mkdtempSync(join(tmpdir(),"thermal-arabic-"));
    try{
      const pdf=await buildPrintPdf({title:"إيصال بيع تجريبي",thermalWidth:width,headers:["الصنف","الكمية","المبلغ"],
        rows:Array.from({length:32},(_,i)=>[`قهوة عربية مع الهيل — وصف عربي طويل لاختبار الالتفاف سلام ${i+1}`,1,"115.00 SAR"])});
      const path=join(dir,"receipt.pdf");writeFileSync(path,pdf);
      const result=JSON.parse(execFileSync("python",["-c","import pymupdf,sys,json; d=pymupdf.open(sys.argv[1]); print(json.dumps({'width':d[0].rect.width*25.4/72,'pages':len(d),'text':' '.join(p.get_text() for p in d)}))",path],{encoding:"utf8"}));
      expect(result.width).toBeCloseTo(width,0);
      expect(result.text.match(/قهوة عربية/g)).toHaveLength(32);
      expect(result.text).toMatch(/\b32\b/);
      expect(result.text.match(/سلام/g)).toHaveLength(32);
    }finally{rmSync(dir,{recursive:true,force:true});}
  },30000);
  it("isolates signed amounts in Arabic notes without reversing ISO dates",()=>{
    const html=printHtml({title:"فحص الأرقام",headers:["البيان"],rows:[["سالب (-125.50) وموجب +50.25 بتاريخ 2026-09-30"] ]});
    expect(html).toContain('<bdi class="numeric-ltr" dir="ltr">(-125.50)</bdi>');
    expect(html).toContain('<bdi class="numeric-ltr" dir="ltr">+50.25</bdi>');
    expect(html).toContain("2026-09-30");
    expect(html).not.toContain('dir="ltr">-09');
  });
  it("keeps the invoice QR decodable after the actual PDF has been rasterized",async()=>{
    const dir=mkdtempSync(join(tmpdir(),"hasba-qr-"));
    try{
      const payload="SYNTHETIC-INVOICE-QR-2026-001";
      const pdf=await buildPrintPdf({title:"اختبار رمز مصطنع — ليس قبولًا رسميًا",headers:["البيان","القيمة"],rows:[["الإجمالي","1,150.00 SAR"]],qr:await QRCode.toDataURL(payload,{margin:2,errorCorrectionLevel:"M"})});
      const path=join(dir,"qr.pdf");writeFileSync(path,pdf);
      const png=execFileSync("python",["-c","import pymupdf,sys; d=pymupdf.open(sys.argv[1]); sys.stdout.buffer.write(d[0].get_pixmap(matrix=pymupdf.Matrix(2,2),alpha=True).tobytes('png'))",path]);
      const require=createRequire(import.meta.url);
      const {PNG}=createRequire(require.resolve("qrcode/package.json"))("pngjs");
      const image=PNG.sync.read(png);
      expect(jsQR(new Uint8ClampedArray(image.data),image.width,image.height)?.data).toBe(payload);
    }finally{rmSync(dir,{recursive:true,force:true});}
  },30000);
  it("embeds Tajawal, preserves Arabic ligature text, mixed numbers, and repeated multi-page headers",async()=>{
    const dir=mkdtempSync(join(tmpdir(),"hasba-print-"));
    try{
      const pdf=await buildPrintPdf({title:"سلام لا لأ لإ لآ — الإقرار والإيرادات",headers:["الوصف","المرجع","المبلغ"],rows:Array.from({length:80},(_,i)=>[`بند ${i} — الأصول والإيرادات واسم طويل للتحقق من التفاف السطور بدون أي تداخل بين الأسطر`,"INV-2026-001","-1,234.56 SAR"])});
      const path=join(dir,"sample.pdf");writeFileSync(path,pdf);
      expect(pdf.subarray(0,5).toString()).toBe("%PDF-");
      const fonts=execFileSync("pdffonts",[path],{encoding:"utf8"});
      expect(fonts).toContain("Tajawal-Regular");expect(fonts).toContain("Tajawal-Bold");
      for(const row of fonts.split("\n").filter(r=>r.includes("Tajawal")))expect(row).toMatch(/yes\s+yes\s+yes/);
      const result=JSON.parse(execFileSync("python",["-c","import pymupdf,sys,json; d=pymupdf.open(sys.argv[1]); print(json.dumps([p.get_text() for p in d]))",path],{encoding:"utf8"})) as string[];
      expect(result.length).toBeGreaterThan(1);
      expect(result[0]).toContain("سلام");expect(result[0]).toContain("الإقرار");expect(result[0]).toContain("الإيرادات");
      expect(result.join("")).toContain("INV-2026-001");expect(result.join("")).toContain("-1,234.56 SAR");
      for(const page of result){expect(page).toContain("الوصف");expect(page).toContain("المرجع");}
    }finally{rmSync(dir,{recursive:true,force:true});}
  },30000);
  it("escapes document data and permits only the fixed browser-print script",()=>{
    const input={title:'<script>fetch("https://invalid.example")</script>',headers:["<img>"],rows:[['"><svg onload=x>']]};
    const html=printHtml(input);expect(html).toContain("&lt;script&gt;");expect(html).not.toContain("<svg onload");
    expect(html).not.toContain("fonts.googleapis");expect(html).toContain("font-feature-settings");
    const browser=printBrowserHtml(input);expect(browser).toContain("script-src 'sha256-");expect(browser.match(/<script>/g)).toHaveLength(1);
  });
  function downloader(fetch:ReturnType<typeof vi.fn>){
    const click=vi.fn(),a={href:"",download:"",target:"",rel:"",click,remove:vi.fn()};
    const exports:Record<string,any>={};
    const source=readFileSync(new URL("../../../../erp-system/src/lib/download-file.ts",import.meta.url),"utf8");
    const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    runInNewContext(js,{exports,fetch,Error,Set,AbortController,document:{body:{append:vi.fn()},createElement:()=>a},
      URL:{createObjectURL:()=> "blob:synthetic",revokeObjectURL:vi.fn()},setTimeout:()=>0,clearTimeout:()=>{}});
    return {download:exports.downloadPdf as (url:string,name:string)=>Promise<void>,click,a};
  }
  it("does not save JSON/error/invalid bytes as PDF and preserves a copyable diagnostic",async()=>{
    const f=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({error:"خطأ مصطنع",diagnosticRef:"PRINT-TEST-REF"}),{status:500,headers:{"content-type":"application/json"}}))
      .mockResolvedValueOnce(new Response("not a PDF",{headers:{"content-type":"application/pdf"}}));
    const d=downloader(f);
    await expect(d.download("/synthetic","a.pdf")).rejects.toMatchObject({diagnosticRef:"PRINT-TEST-REF"});
    await expect(d.download("/synthetic","a.pdf")).rejects.toMatchObject({diagnosticRef:"INVALID_PDF_RESPONSE"});
    expect(d.click).not.toHaveBeenCalled();
  });
  it("deduplicates the same pending link and uses the validated server filename",async()=>{
    let resolve!:(r:Response)=>void;
    const f=vi.fn(()=>new Promise<Response>(r=>{resolve=r;})),d=downloader(f);
    const p=d.download("/synthetic","fallback.pdf"),second=d.download("/synthetic","fallback.pdf");
    resolve(new Response("%PDF-1.7 synthetic",{headers:{"content-type":"application/pdf","content-disposition":'inline; filename="VAT-2026-Q3.pdf"'}}));
    await Promise.all([p,second]);expect(f).toHaveBeenCalledTimes(1);expect(d.click).toHaveBeenCalledTimes(1);expect(d.a.download).toBe("VAT-2026-Q3.pdf");
  });
});
