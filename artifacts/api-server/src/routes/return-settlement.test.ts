import { beforeAll, describe, expect, it,vi } from "vitest";
import * as vatService from "../lib/vat-return";
import request from "supertest";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { db, pool, companiesTable, usersTable, userCompaniesTable, branchesTable, warehousesTable,
  categoriesTable, productsTable, posSessionsTable, fiscalYearsTable, fiscalPeriodsTable, employeesTable } from "@workspace/db";
import app, { assertApplicationReady } from "../app";
import { recordStockMove } from "../lib/stock-engine";

beforeAll(assertApplicationReady);
let address = 90;
const action = (agent: ReturnType<typeof request.agent>, name: string, payload: Record<string, unknown>) =>
  agent.post("/api/pos/returns/actions").send({ action: name, payload });
function ok(r: request.Response, status = 200) { expect(r.status, JSON.stringify(r.body)).toBe(status); return r.body; }
async function fixture(method: "cash" | "card" = "cash", vatNumber?: string) {
  const tag = randomUUID(), password = "Synthetic-only-Returns-123!";
  const [company] = await db.insert(companiesTable).values({ name: vatNumber?`شركة اختبار المستندات ${tag}`:tag,
    vatNumber:vatNumber??null,vatRegistrationStatus:vatNumber?"registered":"not_registered" }).returning();
  const [branch] = await db.insert(branchesTable).values({ companyId: company.id, name: tag, nameAr: tag, city: "Test" }).returning();
  const [otherBranch] = await db.insert(branchesTable).values({ companyId: company.id, name: `${tag}-other`, nameAr: "فرع ثان", city: "Test" }).returning();
  const [warehouse] = await db.insert(warehousesTable).values({ companyId: company.id, branchId: branch.id, name: tag, nameAr: tag, isDefault: true }).returning();
  const year = new Date().getUTCFullYear();
  const [fy] = await db.insert(fiscalYearsTable).values({ companyId: company.id, name: tag, startDate: `${year}-01-01`, endDate: `${year}-12-31` }).returning();
  await db.insert(fiscalPeriodsTable).values({ fiscalYearId: fy.id, name: tag, startDate: `${year}-01-01`, endDate: `${year}-12-31`, status: "open" });
  const [category] = await db.insert(categoriesTable).values({ name: tag, nameAr: tag }).returning();
  const [product] = await db.insert(productsTable).values({ companyId: company.id, categoryId: category.id, sku: tag,
    name: tag, nameAr: "منتج اختبار", price: "100", costPrice: "10", stock: "0", costingMethod: "fifo" }).returning();
  await db.transaction(tx => recordStockMove(tx, { companyId: company.id, productId: product.id,
    toWarehouseId: warehouse.id, quantity: 20, unitCost: 10, kind: "receipt", sourceRef: tag }));
  const [session] = await db.insert(posSessionsTable).values({ sessionNumber: tag, branchId: branch.id, cashierName: tag, openingCash: "0" }).returning();
  const agents = [];
  for (const role of ["owner", "cashier", "manager"] as const) {
    const [user] = await db.insert(usersTable).values({ name: `${role}-${tag}`, email: `${role}-${tag}@example.invalid`,
      role, branchId: branch.id, passwordHash: await bcrypt.hash(password, 4) }).returning();
    await db.insert(userCompaniesTable).values({ userId: user.id, companyId: company.id, role, isDefault: true });
    const agent = request.agent(app);
    ok(await agent.post("/api/auth/login").set("X-Forwarded-For", `192.0.2.${++address}`).send({ email: user.email, password }), 200);
    agents.push({ agent, user });
  }
  const [owner, cashier, manager] = agents;
  const sale = ok(await cashier.agent.post("/api/pos/orders").set("Idempotency-Key", randomUUID()).send({
    sessionId: session.id, paymentMethod: method, discount: 0,
    items: [{ productId: product.id, productName: product.nameAr, quantity: 4, unitPrice: 100 }],
  }), 201);
  const workspace = ok(await cashier.agent.get("/api/pos/returns/workspace"));
  expect(workspace.invoices, JSON.stringify({ sale, invoices: workspace.invoices })).toHaveLength(1);
  const invoice = workspace.invoices[0];
  expect(invoice).toBeTruthy();
  const noteBody = (quantity = 1) => ({ invoiceId: invoice.id, customerId: invoice.customer_id, warehouseId: warehouse.id,
    reason: "طلب مرتجع تجريبي", disposition: "no_goods", settlementMethod: method, restock: false,
    proofRef: `إثبات الفاتورة ${invoice.reference}`, idempotencyKey: randomUUID(),
    lines: [{ invoiceLineId: invoice.lines[0].id, productId: product.id, description: product.nameAr,
      quantity, unitPrice: 100, taxRate: 0 }] });
  async function note(quantity = 1) {
    const created = ok(await action(cashier.agent, "request", noteBody(quantity)), 202);
    ok(await action(manager.agent, "approve", { noteId: created.id, comment: "تم التحقق من مصدر الاستحقاق" }));
    return created;
  }
  const payment = (noteId: number, value = 100) => ({ noteId, receiptId: invoice.receipts[0].id, sessionId: session.id,
    amount: value, method, reference: "تسليم لصاحب السند", delivered: method === "cash", idempotencyKey: randomUUID() });
  return { company, branch, otherBranch, warehouse, product, session, owner, cashier, manager, invoice, sale, noteBody, note, payment };
}
const evidenceDir=fileURLToPath(new URL("../../../../generated-artifacts/document-evidence/",import.meta.url));
async function sellerFixture(granularity:"invoice"|"line"="invoice",commission=false){
 const f=await fixture(),sellers=[];
 for(const label of ["ألف","باء"]){
  const [e]=await db.insert(employeesTable).values({companyId:f.company.id,employeeNo:randomUUID(),name:`Seller ${label}`,nameAr:`البائع ${label}`,
    branchId:f.branch.id,hireDate:"2026-01-01"}).returning();
  ok(await f.owner.agent.post("/api/sales/sellers/eligibility").send({employeeId:e.id,enabled:true,branchIds:[f.branch.id]}));
  sellers.push(e);
 }
 const configure=async(mode:"hidden"|"optional"|"required",branchId=0,inherit=false,rate?:number)=>{
  return ok(await f.owner.agent.post("/api/sales/sellers/configure").send({branchId,inherit,mode,granularity,
   commissionEnabled:rate!==undefined,commissionRatePercent:rate,effectiveFrom:new Date(Date.now()-1).toISOString()}));
 };
 await configure("optional",0,false,commission?10:undefined);
 const body=(selection:Record<string,unknown>={},items?:Array<{productId:number;quantity:number}>)=>({
   sessionId:f.session.id,paymentMethod:"cash",discount:0,items:items??[{productId:f.product.id,quantity:1}],...selection});
 const sell=(payload:ReturnType<typeof body>,key=randomUUID())=>f.cashier.agent.post("/api/pos/orders").set("Idempotency-Key",key).send(payload);
 const report=()=>f.owner.agent.get("/api/sales/sellers/report?from=2026-01-01&to=2026-12-31");
 return {...f,sellers,configure,body,sell,report};
}
function savePdf(response:request.Response,name:string){
  ok(response);expect(response.headers["content-type"]).toContain("application/pdf");
  expect(response.body.subarray(0,5).toString()).toBe("%PDF-");
  mkdirSync(evidenceDir,{recursive:true});const path=`${evidenceDir}/${name}.pdf`;writeFileSync(path,response.body);
  return execFileSync("python",["-c","import pymupdf,sys; print('\\n'.join(p.get_text() for p in pymupdf.open(sys.argv[1])))",path],{encoding:"utf8"});
}
describe("persisted issuer and operational print documents",()=>{
  it("uses two real tenant identities for new QR; freezes issued identity across profile edits; reprints are read-only",async()=>{
    const a=await fixture("cash","300000000000003"),b=await fixture("cash","311111111111113");
    for(const f of [a,b]){
      const check=ok(await f.owner.agent.get(`/api/sales/invoices/${f.invoice.id}/identity-check`));
      expect(check.status).toBe("matched");expect(check.officialValidation).toBe(false);
      const saved=(await pool.query("SELECT issuer FROM document_issuer_snapshots WHERE company_id=$1 AND document_kind='invoice' AND document_id=$2",[f.company.id,f.invoice.id])).rows[0]!.issuer;
      expect(saved.nameAr).toBe(f.company.name);expect(saved.vatNumber).toBe(f.company.vatNumber);
    }
    const p=ok(await a.owner.agent.get("/api/print/profile")).profile;
    const payload={revision:p.revision,nameAr:"شركة الاسم الجديد المصطنعة",nameEn:"Synthetic changed company",vatNumber:"322222222222223",
      crNumber:"1010101010",address:{city:"الرياض"},phone:"0110000000",email:"synthetic@example.invalid",bankName:"بنك مصطنع",bankIban:"",
      termsAr:"شروط اختبار فقط",termsEn:"Synthetic only",logoObjectKey:null,receiptWidths:[58,80]};
    expect((await a.cashier.agent.patch("/api/print/profile").send(payload)).status).toBe(403);
    ok(await a.owner.agent.patch("/api/print/profile").send(payload));
    expect((await a.owner.agent.patch("/api/print/profile").send(payload)).status).toBe(409);
    const state=ok(await a.owner.agent.get("/api/print/profile"));
    expect(state.history[0].changedFields).toContain("nameAr");expect(state.history[0].before.nameAr).toBe(a.company.name);
    const registered=ok(await b.owner.agent.get("/api/print/profile")).profile;
    expect((await b.owner.agent.patch("/api/print/profile").send({...payload,revision:registered.revision,vatNumber:""})).status).toBe(400);
    expect(ok(await b.owner.agent.get("/api/print/profile")).profile.revision).toBe(registered.revision);
    const unregistered=await fixture();
    const draft=ok(await unregistered.owner.agent.get("/api/print/profile")).profile;
    expect(draft.vatEnabled).toBe(false);
    const configured=ok(await unregistered.owner.agent.patch("/api/print/profile").send({
      ...payload,revision:draft.revision,vatNumber:"",crNumber:"",nameAr:"شركة غير مسجلة مصطنعة",
    }));
    expect(configured.vatEnabled).toBe(false);expect(configured.receiptWidths).toEqual([58,80]);
    expect((await pool.query("SELECT vat_registration_status,vat_number,cr_number FROM companies WHERE id=$1",[unregistered.company.id])).rows)
      .toEqual([{vat_registration_status:"not_registered",vat_number:null,cr_number:null}]);
    expect((await pool.query("SELECT issuer->>'nameAr' AS name FROM document_issuer_snapshots WHERE company_id=$1 AND document_kind='invoice' AND document_id=$2",
      [unregistered.company.id,unregistered.invoice.id])).rows[0]?.name).toBe(unregistered.company.name);
    savePdf(await unregistered.owner.agent.get(`/api/pos/orders/${unregistered.sale.id}/receipt.pdf?width=58`),"receipt-unregistered-58");
    savePdf(await unregistered.owner.agent.get(`/api/sales/invoices/${unregistered.invoice.id}/pdf`),"invoice-unregistered-a4");
    const before=(await pool.query(`SELECT
      (SELECT count(*) FROM customer_invoices WHERE company_id=$1) invoices,
      (SELECT count(*) FROM journal_entries WHERE company_id=$1) journals,
      (SELECT count(*) FROM stock_moves m JOIN products p ON p.id=m.product_id WHERE p.company_id=$1) moves`,[a.company.id])).rows[0];
    const text=savePdf(await a.owner.agent.get(`/api/sales/invoices/${a.invoice.id}/pdf`),"invoice-a4");
    expect(text).toContain(a.company.vatNumber!);expect(text).not.toContain(payload.nameAr);expect(text).not.toContain(payload.vatNumber);
    savePdf(await a.owner.agent.get(`/api/pos/orders/${a.sale.id}/receipt.pdf?width=80`),"receipt-80");
    // Printer layout may change; legal identity remains the original saved one.
    savePdf(await a.owner.agent.get(`/api/pos/orders/${a.sale.id}/receipt.pdf?width=58`),"receipt-58");
    expect((await b.owner.agent.get(`/api/pos/orders/${a.sale.id}/receipt.pdf`)).status).toBe(404);
    const after=(await pool.query(`SELECT
      (SELECT count(*) FROM customer_invoices WHERE company_id=$1) invoices,
      (SELECT count(*) FROM journal_entries WHERE company_id=$1) journals,
      (SELECT count(*) FROM stock_moves m JOIN products p ON p.id=m.product_id WHERE p.company_id=$1) moves`,[a.company.id])).rows[0];
    expect(after).toEqual(before);
    expect(ok(await a.owner.agent.get(`/api/sales/invoices/${a.invoice.id}/identity-check`)).status).toBe("matched");
    const qr=(await pool.query("SELECT zatca_qr FROM customer_invoices WHERE id=$1",[a.invoice.id])).rows[0]!.zatca_qr;
    // Synthetic legacy case: diagnostics must not fill a missing historical identity or rewrite its QR.
    await pool.query("DELETE FROM document_issuer_snapshots WHERE company_id=$1 AND document_kind='invoice' AND document_id=$2",[a.company.id,a.invoice.id]);
    expect(ok(await a.owner.agent.get(`/api/sales/invoices/${a.invoice.id}/identity-check`)).status).toBe("unverifiable");
    expect((await pool.query("SELECT zatca_qr FROM customer_invoices WHERE id=$1",[a.invoice.id])).rows[0]!.zatca_qr).toBe(qr);
  },60000);
  it("prints credit, confirmed cash, requested/external electronic refund, and saved shift approval states",async()=>{
    const f=await fixture(),note=await f.note(),p=ok(await action(f.cashier.agent,"payout",f.payment(note.id)));
    const noteText=savePdf(await f.cashier.agent.get(`/api/sales/credit-notes/${note.id}/pdf`),"credit-note");
    expect(noteText).toContain(f.invoice.reference);
    expect(savePdf(await f.cashier.agent.get(`/api/pos/refunds/${p.id}/pdf`),"refund-cash")).toContain("تسليم نقدي مؤكد");
    ok(await action(f.cashier.agent,"close",{sessionId:f.session.id,counted:299,reason:"فرق تجريبي للمراجعة",unresolvedSalesCleared:true}));
    expect(savePdf(await f.owner.agent.get(`/api/pos/sessions/${f.session.id}/closing.pdf`),"closing-pending")).toContain("قيد اعتماد الفرق");
    ok(await action(f.owner.agent,"approve_close",{sessionId:f.session.id}));
    expect(savePdf(await f.owner.agent.get(`/api/pos/sessions/${f.session.id}/closing.pdf`),"closing-approved")).toContain("معتمد");
    const e=await fixture("card"),en=await e.note(),ep=ok(await action(e.cashier.agent,"payout",e.payment(en.id)));
    expect(savePdf(await e.cashier.agent.get(`/api/pos/refunds/${ep.id}/pdf`),"refund-request")).toContain("لم ينفذ أو يرسل");
    ok(await action(e.owner.agent,"confirm_external",{payoutId:ep.id,reference:"إثبات خارجي مصطنع"}));
    expect(savePdf(await e.owner.agent.get(`/api/pos/refunds/${ep.id}/pdf`),"refund-external")).toContain("مسجل يدوي");
    expect((await e.owner.agent.get(`/api/pos/refunds/${p.id}/pdf`)).status).toBe(404);
    expect((await e.owner.agent.get(`/api/pos/sessions/${f.session.id}/closing.pdf`)).status).toBe(404);
  },60000);
});
describe("employee seller attribution independent of collector",()=>{
 it("enforces hidden/optional/required and branch inheritance; freezes seller and retries across disable/policy changes",async()=>{
  const f=await sellerFixture(),[a,b]=f.sellers;
  await f.configure("hidden");
  expect((await f.sell(f.body({sellerEmployeeId:a!.id}))).status).toBe(400);
  await f.configure("optional");
  ok(await f.sell(f.body()),201);
  await f.configure("required",f.branch.id);
  expect(ok(await f.cashier.agent.get(`/api/sales/sellers/workspace?branchId=${f.branch.id}`)).policy.mode).toBe("required");
  expect(ok(await f.owner.agent.get(`/api/sales/sellers/workspace?branchId=${f.otherBranch.id}`)).policy.mode).toBe("optional");
  expect((await f.sell(f.body())).status).toBe(422);
  const key=randomUUID(),payload=f.body({sellerEmployeeId:a!.id}),sale=ok(await f.sell(payload,key),201);
  expect((await f.sell(f.body({sellerEmployeeId:b!.id}),key)).status).toBe(409);
  await pool.query("UPDATE employees SET name_ar='اسم جديد',status='suspended' WHERE id=$1",[a!.id]);
  expect((await f.sell(payload)).status).toBe(403);
  const replay=await f.sell(payload,key);ok(replay,201);expect(replay.headers["idempotency-replayed"]).toBe("true");expect(replay.body.id).toBe(sale.id);
  const names=(await pool.query("SELECT a.* FROM invoice_seller_lines a JOIN customer_invoices i ON i.id=a.invoice_id WHERE i.company_id=$1 AND i.source_ref=$2",[f.company.id,sale.orderNumber])).rows;
  expect(names).toHaveLength(1);expect(names[0]!.seller_name).toBe(a!.nameAr);expect(names[0]!.employee_id).toBe(a!.id);
  expect((await f.cashier.agent.get("/api/sales/sellers/report?from=2026-01-01&to=2026-12-31")).status).toBe(403);
  const other=await sellerFixture();
  expect((await f.sell(f.body({sellerEmployeeId:other.sellers[0]!.id}))).status).toBe(403);
  expect((await other.owner.agent.post("/api/sales/invoices/"+names[0]!.invoice_id+"/attribution").send({reason:"سبب مصطنع واضح",sellerEmployeeId:b!.id,lineSellers:[]})).status).toBe(404);
  await f.configure("hidden",f.branch.id,true);
  expect(ok(await f.owner.agent.get(`/api/sales/sellers/workspace?branchId=${f.branch.id}`)).policy.mode).toBe("optional");
 });
 it("allocates discounts exactly, counts a multi-seller invoice once, and keeps unassigned separate",async()=>{
  const f=await sellerFixture("line"),[a,b]=f.sellers;
  const sale=ok(await f.sell(f.body({discount:9.99,sellerEmployeeId:a!.id,lineSellers:[{lineIndex:1,employeeId:b!.id}]},
   [{productId:f.product.id,quantity:1},{productId:f.product.id,quantity:1}])),201);
  const report=ok(await f.report()),rows=report.rows.filter((r:{sellerId:number|null})=>r.sellerId!==null);
  expect(rows).toHaveLength(2);
  for(const row of rows){expect(row.grossSales).toBe(100);expect(row.invoiceCount).toBe(1);}
  expect(rows.map((r:{net:number})=>r.net).sort((x:number,y:number)=>x-y)).toEqual([95,95.01]);
  expect(rows.reduce((s:number,r:{discounts:number})=>s+r.discounts,0)).toBe(9.99);
  expect(report.uniqueInvoiceCount).toBe(2); // baseline unassigned + the one multi-seller invoice
  expect(report.rows.reduce((sum:number,r:{invoiceCount:number})=>sum+r.invoiceCount,0)).toBe(3);
  expect(report.rows.find((r:{sellerId:number|null})=>r.sellerId===null).net).toBe(400);
  expect(report.commissions.every((e:{amount:number})=>e.amount===0)).toBe(true); // default off, never invent a rate
  const invoice=(await pool.query("SELECT id FROM customer_invoices WHERE company_id=$1 AND source_ref=$2",[f.company.id,sale.orderNumber])).rows[0]!;
  expect((await f.owner.agent.post(`/api/sales/invoices/${invoice.id}/attribution`).send({reason:"",sellerEmployeeId:a!.id,lineSellers:[]})).status).toBe(400);
 });
 it("restores a cancelled credit and reverses an unpaid invoice without losing seller or counting the reversal twice",async()=>{
  const f=await sellerFixture("invoice",true),seller=f.sellers[0]!;
  const manual=ok(await f.owner.agent.post("/api/sales/invoices").set("Idempotency-Key",randomUUID()).send({
   customerId:f.invoice.customer_id,branchId:f.branch.id,sellerEmployeeId:seller.id,
   lines:[{productId:f.product.id,description:"بيع يدوي تجريبي",quantity:1,unitPrice:100,taxRate:0}]}),201);
  ok(await f.owner.agent.post(`/api/sales/invoices/${manual.id}/reverse`).set("Idempotency-Key",randomUUID()).send({reason:"إلغاء مصطنع موثق"}));
  const cancelled=ok(await f.report()).rows.find((r:{sellerId:number})=>r.sellerId===seller.id);
  expect(cancelled.grossSales).toBe(100);expect(cancelled.cancellations).toBe(100);expect(cancelled.net).toBe(0);expect(cancelled.invoiceCount).toBe(1);
  const sale=ok(await f.sell(f.body({sellerEmployeeId:seller.id})),201);
  const invoice=ok(await f.owner.agent.get("/api/pos/returns/workspace")).invoices.find((i:{id:number;total:string})=>Number(i.total)===100&&i.id!==manual.id);
  const note=ok(await action(f.cashier.agent,"request",{...f.noteBody(),invoiceId:invoice.id,customerId:invoice.customer_id,
   idempotencyKey:randomUUID(),lines:[{invoiceLineId:invoice.lines[0].id,productId:f.product.id,description:"إرجاع مصطنع",quantity:1,unitPrice:100,taxRate:0}]}),202);
  ok(await action(f.manager.agent,"approve",{noteId:note.id,comment:"اعتماد مصطنع"}));
  ok(await f.owner.agent.post(`/api/sales/credit-notes/${note.id}/cancel`).send({reason:"إلغاء المرتجع قبل أي صرف"}));
  const events=(await pool.query("SELECT * FROM sales_commission_events WHERE company_id=$1 AND invoice_id=$2 ORDER BY id",[f.company.id,invoice.id])).rows;
  expect(events.map(e=>e.kind)).toEqual(["sale","return","return_cancel"]);
  expect(events.reduce((sum,e)=>sum+Number(e.net_cents),0)).toBe(10000);
  expect(events.reduce((sum,e)=>sum+Number(e.commission_cents),0)).toBe(1000);
 });
 it("preserves paid commissions and original policy; partial/full returns and audited reassignment append corrections without payout or GL",async()=>{
  const f=await sellerFixture("line",true),[a,b]=f.sellers;
  const sale=ok(await f.sell(f.body({sellerEmployeeId:a!.id,lineSellers:[{lineIndex:1,employeeId:b!.id}]},
   [{productId:f.product.id,quantity:2},{productId:f.product.id,quantity:1}])),201);
  const invoice=ok(await f.owner.agent.get("/api/pos/returns/workspace")).invoices.find((i:{total:string})=>Number(i.total)===300);
  expect(invoice).toBeTruthy();
  const events=(await pool.query("SELECT * FROM sales_commission_events WHERE company_id=$1 AND invoice_id=$2 AND kind='sale' ORDER BY id",[f.company.id,invoice.id])).rows;
  expect(events.map(e=>Number(e.commission_cents))).toEqual([2000,1000]);
  const stateUrl=`/api/sales/commissions/${events[0]!.id}/state`;
  expect((await f.owner.agent.post(stateUrl).send({action:"record_paid",reference:"مصطنع بلا دفع فعلي"})).status).toBe(409);
  ok(await f.owner.agent.post(stateUrl).send({action:"approve",reference:"اعتماد مصطنع للاختبار"}));
  const marked=ok(await f.owner.agent.post(stateUrl).send({action:"record_paid",reference:"إثبات تسوية خارجية مصطنع"}));
  expect(marked.payoutExecuted).toBe(false);expect(marked.journalCreated).toBe(false);
  await f.configure("optional",0,false,20); // prospectively only, old sale remains at 10%
  async function returnLines(lines:Array<{index:number;quantity:number}>){
   const response=ok(await action(f.cashier.agent,"request",{...f.noteBody(),invoiceId:invoice.id,customerId:invoice.customer_id,
    proofRef:`مصدر ${invoice.reference}`,idempotencyKey:randomUUID(),
    lines:lines.map(l=>({invoiceLineId:invoice.lines[l.index].id,productId:f.product.id,description:f.product.nameAr,
      quantity:l.quantity,unitPrice:100,taxRate:0}))}),202);
   ok(await action(f.manager.agent,"approve",{noteId:response.id,comment:"مراجعة اختبار مصطنعة"}));return response;
  }
  await returnLines([{index:0,quantity:1}]);
  let report=ok(await f.report());
  expect(report.rows.find((r:{sellerId:number})=>r.sellerId===a!.id).net).toBe(100);
  const before=(await pool.query("SELECT count(*) count FROM journal_entries WHERE company_id=$1",[f.company.id])).rows[0]!.count;
  const correction=ok(await f.owner.agent.post(`/api/sales/invoices/${invoice.id}/attribution`).send({reason:"تصحيح موثق بعد استرداد جزئي",
    sellerEmployeeId:b!.id,lineSellers:[]}));
  expect(correction.financialEffects).toBe(false);
  expect((await pool.query("SELECT count(*) count FROM journal_entries WHERE company_id=$1",[f.company.id])).rows[0]!.count).toBe(before);
  const audit=(await pool.query("SELECT * FROM invoice_seller_audit WHERE company_id=$1 AND invoice_id=$2",[f.company.id,invoice.id])).rows;
  expect(audit).toHaveLength(1);expect(audit[0]!.before_value[0].employee_id).toBe(a!.id);expect(audit[0]!.after_value[0].employee_id).toBe(b!.id);
  await returnLines([{index:0,quantity:1},{index:1,quantity:1}]);
  report=ok(await f.report());
  expect(report.rows.find((r:{sellerId:number})=>r.sellerId===b!.id).net).toBe(0);
  const ledger=(await pool.query("SELECT * FROM sales_commission_events WHERE company_id=$1 AND invoice_id=$2",[f.company.id,invoice.id])).rows;
  expect(ledger.reduce((s,e)=>s+Number(e.commission_cents),0)).toBe(0);
  expect(ledger.find(e=>e.id===events[0]!.id)).toMatchObject({status:"paid",commission_cents:"2000"});
  expect(ledger.filter(e=>e.kind==="return").every(e=>Number(e.policy.ratePercent)===10)).toBe(true);
  expect(ledger.some(e=>e.kind==="change"&&Number(e.commission_cents)<0&&e.status==="calculated")).toBe(true);
 });
});
describe("branch-authorized return / approval / refund / till lifecycle", () => {
  it("print links keep company/branch boundaries and never turn fetch failures into zero PDFs",async()=>{
    const f=await fixture(),other=await fixture();
    const pdf=await f.owner.agent.get(`/api/sales/invoices/${f.invoice.id}/pdf`);
    ok(pdf);expect(pdf.headers["content-type"]).toContain("application/pdf");expect(pdf.body.subarray(0,5).toString()).toBe("%PDF-");
    expect(pdf.headers["cache-control"]).toContain("no-store");
    expect((await other.owner.agent.get(`/api/sales/invoices/${f.invoice.id}/pdf`)).status).toBe(404);
    await db.update(usersTable).set({branchId:f.otherBranch.id}).where((await import("drizzle-orm")).eq(usersTable.id,f.cashier.user.id));
    expect((await f.cashier.agent.get(`/api/sales/invoices/${f.invoice.id}/pdf`)).status).toBe(403);
    const query="/api/vat/return?year=2026&quarter=3";
    const empty=ok(await f.owner.agent.get(query));expect(empty.netPayable).toBe(0);
    expect((await f.owner.agent.get(query+"&branchId="+f.branch.id)).status).toBe(422);
    const spy=vi.spyOn(vatService,"computeVatReturn").mockRejectedValueOnce(new Error("SYNTHETIC_READ_FAILURE"));
    try{
      const failed=await f.owner.agent.get(query+"&format=pdf");
      expect(failed.status).toBe(500);expect(failed.headers["content-type"]).toContain("application/json");
      expect(failed.body.diagnosticRef).toBeTruthy();expect(failed.body.error).not.toContain("SYNTHETIC_READ_FAILURE");expect(failed.body.netPayable).toBeUndefined();
    }finally{spy.mockRestore();}
    const bad=await f.owner.agent.get("/api/vat/return?year=2026&quarter=0&format=pdf");
    expect(bad.status).toBe(400);expect(bad.body.diagnosticRef).toBeTruthy();
  },30000);
  it("noncash remains requested and reserved until authorized external evidence; blocks closing and posts only once on confirmation", async () => {
    const f = await fixture("card"), note = await f.note();
    const p = ok(await action(f.cashier.agent, "payout", f.payment(note.id)));
    expect(p.status).toBe("requested"); expect(p.journal_id).toBeNull();
    expect((await action(f.cashier.agent, "close", { sessionId: f.session.id, counted: 0, unresolvedSalesCleared: true })).status).toBe(409);
    expect((await action(f.cashier.agent, "confirm_external", { payoutId: p.id, reference: "بنك خارجي" })).status).toBe(403);
    const confirmed = ok(await action(f.owner.agent, "confirm_external", { payoutId: p.id, reference: "إثبات خارجي مصطنع" }));
    expect(confirmed.status).toBe("external_confirmed"); expect(confirmed.journal_id).toBeTruthy();
    const replay = ok(await action(f.owner.agent, "confirm_external", { payoutId: p.id, reference: "إثبات خارجي مصطنع" }));
    expect(replay.journal_id).toBe(confirmed.journal_id);
    const workspace = ok(await f.owner.agent.get("/api/pos/returns/workspace"));
    expect(workspace.sessions[0].expected).toBe(0);
    ok(await action(f.cashier.agent, "close", { sessionId: f.session.id, counted: 0, unresolvedSalesCleared: true }));
  });
  it("records a till expense once and posts the approved cash shortage without erasing the counted difference", async () => {
    const f = await fixture(), note = await f.note();
    ok(await action(f.cashier.agent, "payout", f.payment(note.id)));
    const workspace = ok(await f.owner.agent.get("/api/pos/returns/workspace"));
    expect(workspace.accounts.length).toBeGreaterThan(0);
    const body = { sessionId: f.session.id, accountId: workspace.accounts[0].id, amount: 20,
      reference: "مصروف موثق تجريبي", delivered: true, idempotencyKey: randomUUID() };
    const exp = ok(await action(f.manager.agent, "expense", body));
    expect(ok(await action(f.manager.agent, "expense", body)).id).toBe(exp.id);
    const closing = ok(await action(f.cashier.agent, "close", { sessionId: f.session.id, counted: 275,
      reason: "عجز خمسة موثق", unresolvedSalesCleared: true }));
    expect(Number(closing.expected)).toBe(280); expect(Number(closing.difference)).toBe(-5);
    ok(await action(f.manager.agent, "approve_close", { sessionId: f.session.id }));
    const balance = await pool.query(`SELECT sum(l.debit-l.credit) AS cash FROM journal_entry_lines l
      JOIN journal_entries j ON j.id=l.entry_id JOIN accounts a ON a.id=l.account_id
      WHERE j.company_id=$1 AND a.system_key='cash'`, [f.company.id]);
    expect(Number(balance.rows[0].cash)).toBe(275);
  });
  it("400 collected, approved return 100, one cash voucher, original receipt preserved, expected cash 300 and closed accurately", async () => {
    const f = await fixture(), note = await f.note();
    const body = f.payment(note.id);
    const paid = ok(await action(f.cashier.agent, "payout", body));
    const replay = ok(await action(f.cashier.agent, "payout", body));
    expect(replay.id).toBe(paid.id);
    const receipt = await pool.query("SELECT amount FROM customer_receipts WHERE id=$1", [body.receiptId]);
    expect(Number(receipt.rows[0].amount)).toBe(400);
    const count = await pool.query("SELECT count(*)::int AS n FROM return_payouts WHERE note_id=$1", [note.id]);
    expect(count.rows[0].n).toBe(1);
    const workspace = ok(await f.cashier.agent.get("/api/pos/returns/workspace"));
    expect(workspace.sessions.find((s: { id: number }) => s.id === f.session.id).expected).toBe(300);
    expect(Number((await pool.query("SELECT stock FROM products WHERE id=$1", [f.product.id])).rows[0].stock)).toBe(16);
    const gl = await pool.query("SELECT sum(debit)-sum(credit) AS delta FROM journal_entry_lines WHERE entry_id=$1", [paid.journal_id]);
    expect(Number(gl.rows[0].delta)).toBe(0);
    ok(await action(f.cashier.agent, "close", { sessionId: f.session.id, counted: 300, reason: "متطابق", unresolvedSalesCleared: true }));
    expect((await pool.query("SELECT status FROM pos_sessions WHERE id=$1", [f.session.id])).rows[0].status).toBe("closed");
    expect((await action(f.cashier.agent, "payout", f.payment(note.id, 1))).status).toBe(409);
  });
  it("serializes competing payouts, allows partial then remainder and prevents overpayment or reuse after credit settlement", async () => {
    const f = await fixture(), note = await f.note();
    const results = await Promise.all([action(f.cashier.agent, "payout", f.payment(note.id, 70)),
      action(f.cashier.agent, "payout", f.payment(note.id, 70))]);
    expect(results.map(r => r.status).sort()).toEqual([200, 409]);
    ok(await action(f.cashier.agent, "payout", f.payment(note.id, 30)));
    expect((await action(f.cashier.agent, "payout", f.payment(note.id, 0.01))).status).toBe(409);
    const used = await f.note();
    await pool.query("UPDATE credit_notes SET status='applied' WHERE id=$1", [used.id]);
    expect((await action(f.cashier.agent, "payout", f.payment(used.id))).status).toBe(409);
    const total = await pool.query("SELECT sum(amount) AS amount FROM return_payouts WHERE note_id=$1", [note.id]);
    expect(Number(total.rows[0].amount)).toBe(100);
  });
  it("enforces refreshed capability and branch restrictions, owner-only configuration, no self-grant and foreign company rejection", async () => {
    const f = await fixture(), foreign = await fixture(), note = await f.note();
    expect((await action(f.cashier.agent, "approve", { noteId: note.id, comment: "غير مسموح" })).status).toBe(403);
    expect((await action(f.cashier.agent, "configure_access", { userId: f.cashier.user.id, template: "finance_manager",
      capabilities: ["approve"], branches: [f.branch.id] })).status).toBe(403);
    expect((await action(f.owner.agent, "configure_access", { userId: f.owner.user.id, template: "finance_manager",
      capabilities: ["approve"], branches: [f.branch.id] })).status).toBe(403);
    ok(await action(f.owner.agent, "configure_access", { userId: f.cashier.user.id, template: "cashier",
      capabilities: ["view", "payout"], branches: [f.otherBranch.id] }));
    expect((await action(f.cashier.agent, "payout", f.payment(note.id))).status).toBe(403);
    expect(ok(await f.cashier.agent.get("/api/pos/returns/workspace")).notes).toHaveLength(0);
    expect((await f.cashier.agent.get(`/api/sales/invoices/${f.invoice.id}`)).status).toBe(403);
    expect((await f.cashier.agent.get(`/api/sales/invoices/${f.invoice.id}/pdf`)).status).toBe(403);
    expect((await f.cashier.agent.get("/api/pos/orders")).body).toHaveLength(0);
    expect((await action(f.cashier.agent, "export", {})).status).toBe(403);
    expect((await action(foreign.owner.agent, "payout", f.payment(note.id))).status).toBe(404);
    ok(await action(f.owner.agent, "configure_access", { userId: f.manager.user.id, template: "branch_manager",
      capabilities: ["view", "request", "approve", "payout", "close"], branches: [f.branch.id] }));
    expect((await f.manager.agent.get("/api/hr/employees")).status).toBe(403);
  });
  it("rejects a changed approved document, self-approval, bad disposition and cross-invoice use of anonymous cash entitlement", async () => {
    const f = await fixture();
    ok(await action(f.owner.agent, "configure_policy", { branchId: f.branch.id, approvalAbove: 0, allowResale: false }));
    const self = ok(await action(f.manager.agent, "request", f.noteBody()), 202);
    expect((await action(f.manager.agent, "approve", { noteId: self.id, comment: "اعتماد نفسي" })).status).toBeGreaterThanOrEqual(400);
    const wrong = { ...f.noteBody(), disposition: "resale", restock: true };
    expect((await action(f.cashier.agent, "request", wrong)).status).toBe(400);
    ok(await action(f.owner.agent, "configure_policy", { branchId: f.branch.id, approvalAbove: 0, allowResale: true }));
    await pool.query("UPDATE companies SET business_type='fb' WHERE id=$1", [f.company.id]);
    expect((await action(f.cashier.agent, "request", wrong)).status).toBe(400);
    const changed = ok(await action(f.cashier.agent, "request", f.noteBody()), 202);
    await pool.query("UPDATE credit_notes SET reason='تغيرت بيانات مؤثرة' WHERE id=$1", [changed.id]);
    expect((await action(f.manager.agent, "approve", { noteId: changed.id, comment: "محاولة اعتماد" })).status).toBeGreaterThanOrEqual(400);
    const valid = await f.note();
    const sale = ok(await f.cashier.agent.post("/api/pos/orders").set("Idempotency-Key", randomUUID()).send({
      sessionId: f.session.id, paymentMethod: "cash", items: [{ productId: f.product.id, productName: "اختبار", quantity: 1, unitPrice: 100 }],
    }), 201);
    const workspace = ok(await f.cashier.agent.get("/api/pos/returns/workspace"));
    const other = workspace.invoices.find((i: { id: number }) => i.id !== f.invoice.id);
    const body = { ...f.payment(valid.id), receiptId: other.receipts[0].id };
    expect((await action(f.cashier.agent, "payout", body)).status).toBe(400);
    expect((await action(f.cashier.agent, "payout", { ...f.payment(valid.id), delivered: false })).status).toBe(400);
    ok(await action(f.cashier.agent, "payout", f.payment(valid.id)));
    expect((await f.owner.agent.post(`/api/sales/credit-notes/${valid.id}/cancel`).send({})).status).toBe(409);
  });
  it("preserves nonzero till difference and requires another authorized approver; never silently zeroes it", async () => {
    const f = await fixture();
    const close = ok(await action(f.cashier.agent, "close", { sessionId: f.session.id, counted: 390,
      reason: "عجز نقدي موثق", unresolvedSalesCleared: true }));
    expect(Number(close.difference)).toBe(-10);
    expect(close.status).toBe("pending");
    expect((await action(f.cashier.agent, "approve_close", { sessionId: f.session.id })).status).toBe(403);
    ok(await action(f.manager.agent, "approve_close", { sessionId: f.session.id }));
    const row = (await pool.query("SELECT * FROM pos_cash_closings WHERE session_id=$1", [f.session.id])).rows[0];
    expect(Number(row.expected)).toBe(400); expect(Number(row.counted)).toBe(390); expect(Number(row.difference)).toBe(-10);
    expect(row.created_by).toBe(f.cashier.user.id); expect(row.approved_by).toBe(f.manager.user.id);
  });
});
