import { describe,it,expect,vi } from "vitest";
import { randomUUID,createHash } from "node:crypto";
import { mkdirSync,writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { db,pool } from "@workspace/db";
import { sql } from "drizzle-orm";
import { posTemplateFixture,accepted as ok,fixtureRows as rows } from "../test/pos-template-fixture";
import { defaultInvoiceDesign,invoicePresets,InvoiceDesignSchema } from "../lib/invoice-design";
import { captureIssuer,saveIssuer,documentIssuer,issuerLogo } from "../lib/document-identity";
import { printHtml } from "../lib/pdf/print-document";
import { normalizePrintLogo } from "../lib/print-logo-validation";
import { objectStorageClient } from "../lib/objectStorage";
import QRCode from "qrcode";
const out=resolve(process.cwd(),"../../generated-artifacts/invoice-templates-2a");
const design=(preset=defaultInvoiceDesign.preset)=>({...defaultInvoiceDesign,preset});
const payload=(s:any,value:unknown)=>({expectedCompanyId:s.scope.companyId,expectedRevision:s.scope.revision,
  expectedParentRevision:s.scope.parentRevision,templates:{invoiceDesign:value}});
async function save(f:any,value:unknown,branchId?:number){
  const path="/api/settings"+(branchId?`?branchId=${branchId}`:""),state=ok(await f.owner.get(path));
  return ok(await f.owner.patch(path).send(payload(state,value)));
}
async function invariantSnapshot(){
  const result:Record<string,unknown>={};
  for(const name of ["customer_invoices","customer_invoice_lines","stock_quants","stock_moves","stock_layers",
    "journal_entries","journal_entry_lines","financial_requests","document_issuer_snapshots"]){
    const data=await rows(`SELECT row_to_json(t)::text AS data FROM ${name} t ORDER BY row_to_json(t)::text`);
    result[name]={count:data.length,sha256:createHash("sha256").update(JSON.stringify(data)).digest("hex")};
  }
  return result;
}
describe("invoice design 2a using existing settings, issuance and native renderer",()=>{
  it("validates a closed schema, preserves mandatory content and produces five distinct layouts",()=>{
    const html=invoicePresets.map(p=>printHtml({title:"فاتورة ضريبية",company:{nameAr:"سلام",nameEn:"Demo",vatNumber:"310000000000003",
      address:"الرياض",phone:"",email:"",bankName:"",bankIban:"",termsAr:"",termsEn:""},
      headers:["الوصف","الكمية","الضريبة"],rows:[["سلام ABC",2,"15%"]],totals:[["الإجمالي","230.00"]],invoiceDesign:{...design(p.id),header:"<script>alert(1)</script>"}}));
    expect(new Set(html).size).toBe(5);
    for(const text of html){
      expect(text).toContain("310000000000003");expect(text).toContain("230.00");expect(text).toContain("table-header-group");
      expect(text).toContain("&lt;script&gt;");expect(text).not.toContain("<script>alert");
    }
    for(const bad of [{...design(),fontSize:1},{...design(),hideTotals:true},{...design(),accent:"url(https://evil.invalid)"},
      {...design(),logoMode:"custom",logoObjectKey:""},{...design(),font:"https://evil.invalid/font"}])
      expect(InvoiceDesignSchema.safeParse(bad).success).toBe(false);
  });
  it("enforces settings authority, branch/company ownership, optimistic conflicts and inherited reset",async()=>{
    const f=await posTemplateFixture();
    ok(await f.actors[0].get("/api/print/templates"),403);
    const cat=ok(await f.owner.get("/api/print/templates"));expect(cat.presets).toHaveLength(5);
    await save(f,design("commercial"));
    const b=f.branches[0].id,path=`/api/settings?branchId=${b}`,a=ok(await f.owner.get(path));
    expect(a.templates.invoiceDesign.preset).toBe("commercial");
    const saved=ok(await f.owner.patch(path).send(payload(a,design("modern"))));
    expect(saved.scope.overrides.templates).toContain("invoiceDesign");
    ok(await f.owner.patch(path).send(payload(a,design("ink"))),409);
    const competing=await Promise.all([f.owner.patch(path).send(payload(saved,design("simple"))),
      f.owner.patch(path).send(payload(saved,design("formal")))]);
    expect(competing.map(r=>r.status).sort()).toEqual([200,409]);
    const latest=ok(await f.owner.get(path));
    ok(await f.owner.patch(path).send({expectedCompanyId:f.companies[0].id,expectedRevision:latest.scope.revision,
      expectedParentRevision:latest.scope.parentRevision,reset:{templates:["invoiceDesign"]}}));
    const inherited=ok(await f.owner.get(path));
    expect(inherited.templates.invoiceDesign.preset).toBe("commercial");expect(inherited.scope.overrides.templates).not.toContain("invoiceDesign");
    ok(await f.owner.get(`/api/settings?branchId=${f.branches[2].id}`),404);
    ok(await f.owner.post("/api/print/templates/preview").send({expectedCompanyId:f.companies[1].id,branchId:null,
      design:design(),sample:"short",width:"a4"}),409);
    // Revoke the explicit settings responsibility, not merely a job/role label.
    await rows("UPDATE company_administrators SET responsibilities=array_remove(responsibilities,'settings') WHERE company_id=$1 AND user_id=$2",
      [f.companies[0].id,f.ownerUser.id]);
    await rows("UPDATE user_companies SET role='auditor' WHERE company_id=$1 AND user_id=$2",[f.companies[0].id,f.ownerUser.id]);
    ok(await f.owner.get("/api/print/templates"),403);
    ok(await f.owner.patch("/api/settings").send(payload(saved,design())),403);
    ok(await f.owner.post("/api/print/templates/preview").send({expectedCompanyId:f.companies[0].id,branchId:null,
      design:design(),sample:"short",width:"a4"}),403);
  },60000);
  it("rejects foreign logos and malformed image files without external requests",async()=>{
    const valid=await QRCode.toBuffer("SYNTHETIC-LOCAL-LOGO",{type:"png"});
    const normalized=await normalizePrintLogo(valid.toString("base64"));
    expect(normalized.subarray(0,8)).toEqual(Buffer.from([137,80,78,71,13,10,26,10]));
    expect(normalized.length).toBeGreaterThan(30);
    const f=await posTemplateFixture();
    await rows("INSERT INTO company_print_logos(object_key,company_id,digest,content_type) VALUES($1,$2,$3,'image/png')",
      [`other-${randomUUID()}`,f.companies[1].id,"synthetic"]);
    const foreign=(await rows("SELECT object_key FROM company_print_logos WHERE company_id=$1",[f.companies[1].id]))[0].object_key;
    const s=ok(await f.owner.get("/api/settings"));
    ok(await f.owner.patch("/api/settings").send(payload(s,{...design(),logoMode:"custom",logoObjectKey:foreign})),400);
    for(const encoded of [Buffer.from("<svg onload='bad()'/>").toString("base64"),Buffer.from([137,80,78,71,13,10,26,10]).toString("base64")])
      await expect(normalizePrintLogo(encoded)).rejects.toThrow();
  },60000);
  it("captures root/branch design on original issuance and never changes issued/legacy snapshots or financial balances",async()=>{
    const f=await posTemplateFixture(),branch=f.branches[0].id;
    await save(f,design("simple"));await save(f,{...design("modern"),header:"هوية أصلية محفوظة"},branch);
    const customer=ok(await f.owner.post("/api/customers").send({name:"عميل اختبار تاريخ التصميم"}),201);
    const inv=ok(await f.owner.post("/api/sales/invoices").set("Idempotency-Key",randomUUID())
      .send({customerId:customer.id,branchId:branch,lines:[{description:"سلام ABC",quantity:2,unitPrice:100,taxRate:0}]}),201);
    const issuer=await documentIssuer(f.companies[0].id,"invoice",inv.id);
    expect(issuer.invoiceDesign?.source).toBe("branch");expect(issuer.invoiceDesign?.design.preset).toBe("modern");
    const before=await invariantSnapshot();
    await save(f,{...design("ink"),footer:"تذييل جديد"},branch);
    expect(await documentIssuer(f.companies[0].id,"invoice",inv.id)).toEqual(issuer);
    const pdf=await f.owner.get(`/api/sales/invoices/${inv.id}/pdf`);
    ok(pdf);expect(pdf.body.subarray(0,5).toString()).toBe("%PDF-");
    const after=await invariantSnapshot();
    expect(after).toEqual(before);
    // An older issuer without design stays without design when copied/reversed.
    const legacy={...issuer};delete legacy.invoiceDesign;
    await db.transaction(tx=>saveIssuer(tx,"invoice",2140000000,legacy,true));
    expect((await documentIssuer(f.companies[0].id,"invoice",2140000000)).invoiceDesign).toBeUndefined();
    mkdirSync(out,{recursive:true});
    writeFileSync(resolve(out,"financial-reconciliation.json"),JSON.stringify({before,after,identical:true,
      legacyHandling:"A separate synthetic legacy snapshot copy was checked after this reconciliation; no historical design was invented."},null,2));
  },90000);
  it("preserves immutable logo bytes selected at issuance after replacing the default",async()=>{
    const f=await posTemplateFixture(),key=`logo-old-${randomUUID()}`,bytes=Buffer.from("synthetic immutable test image");
    await rows("INSERT INTO company_print_logos(object_key,company_id,digest,content_type) VALUES($1,$2,$3,'image/png')",
      [key,f.companies[0].id,createHash("sha256").update(bytes).digest("hex")]);
    await save(f,{...design("formal"),logoMode:"custom",logoObjectKey:key});
    const customer=ok(await f.owner.post("/api/customers").send({name:"عميل شعار تاريخي"}),201);
    const inv=ok(await f.owner.post("/api/sales/invoices").set("Idempotency-Key",randomUUID())
      .send({customerId:customer.id,branchId:f.branches[0].id,lines:[{description:"اختبار",quantity:1,unitPrice:20,taxRate:0}]}),201);
    const original=await documentIssuer(f.companies[0].id,"invoice",inv.id);
    await save(f,{...design("ink"),logoMode:"none"});
    expect((await documentIssuer(f.companies[0].id,"invoice",inv.id)).invoiceDesign).toEqual(original.invoiceDesign);
    // Isolated storage adapter proves the immutable object selection/digest,
    // not live App Storage acceptance.
    const mock=vi.spyOn(objectStorageClient,"bucket").mockReturnValue({file:()=>({download:async()=>[bytes]})} as never);
    const prior=process.env.PRIVATE_OBJECT_DIR;process.env.PRIVATE_OBJECT_DIR="synthetic-test/private";
    try{expect(await issuerLogo({...original,logoObjectKey:key})).toBe(`data:image/png;base64,${bytes.toString("base64")}`);}
    finally{mock.mockRestore();if(prior===undefined)delete process.env.PRIVATE_OBJECT_DIR;else process.env.PRIVATE_OBJECT_DIR=prior;}
  },60000);
  it("generates five real A4 PDFs, multi-page Arabic/English and thermal80 without issuing anything",async()=>{
    const f=await posTemplateFixture();
    await rows("UPDATE companies SET vat_registration_status='registered',vat_number='310000000000003' WHERE id=$1",[f.companies[0].id]);
    const before=await invariantSnapshot();
    mkdirSync(out,{recursive:true});
    for(const p of invoicePresets){
      const pdf=await f.owner.post("/api/print/templates/preview").send({
        expectedCompanyId:f.companies[0].id,branchId:null,design:design(p.id),sample:"short",width:"a4"});
      ok(pdf);expect(pdf.body.subarray(0,5).toString()).toBe("%PDF-");writeFileSync(resolve(out,`${p.id}.pdf`),pdf.body);
    }
    for(const [name,sample,width] of [["long","long","a4"],["receipt80","short","80"]] as const){
      const pdf=await f.owner.post("/api/print/templates/preview").send({
        expectedCompanyId:f.companies[0].id,branchId:null,design:design("ink"),sample,width});
      ok(pdf);writeFileSync(resolve(out,`${name}.pdf`),pdf.body);
    }
    await rows("UPDATE companies SET vat_registration_status='not_registered' WHERE id=$1",[f.companies[0].id]);
    const noVat=await f.owner.post("/api/print/templates/preview").send({expectedCompanyId:f.companies[0].id,branchId:null,design:design(),sample:"short",width:"a4"});
    ok(noVat);writeFileSync(resolve(out,"unregistered.pdf"),noVat.body);
    expect(await invariantSnapshot()).toEqual(before);
    writeFileSync(resolve(out,"preview-reconciliation.json"),JSON.stringify({before,after:await invariantSnapshot(),identical:true},null,2));
  },180000);
});
