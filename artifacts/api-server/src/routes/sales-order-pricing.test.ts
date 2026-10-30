import {beforeAll,describe,it,expect} from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import {randomUUID} from "node:crypto";
import {db,pool,companiesTable,usersTable,userCompaniesTable,branchesTable,warehousesTable,
  categoriesTable,productsTable,customersTable,discountRulesTable} from "@workspace/db";
import app,{assertApplicationReady} from "../app";
import {seedCompanyFiscalCalendar} from "../lib/fiscal-calendar";
import {recordStockMove} from "../lib/stock-engine";
import {riyadhDate} from "../lib/vat-policy";
import {submitForApproval,actOnApproval} from "../lib/workflow-engine";
const q=async(s:string,p:unknown[]=[]) => (await pool.query(s,p)).rows;
beforeAll(assertApplicationReady);
let ip=145;
async function fixture(inclusive:boolean,price=115,quantity=3,discount=1,namedRule=false,lineCount=1,
  options:{lineFixed?:number;linePercent?:number;orderRules?:number[];distinctRuleAccounts?:boolean}={}){
  if(process.env.ACCOUNT_ISOLATED_TEST!=="true")throw new Error("Isolated PostgreSQL required");
  const tag=randomUUID(),password=`Synthetic-${tag}`;
  const [c]=await db.insert(companiesTable).values({name:tag,vatRegistrationStatus:"not_registered"}).returning();
  const [u]=await db.insert(usersTable).values({name:"مصطنع",email:`so-${tag}@example.invalid`,
    passwordHash:await bcrypt.hash(password,4),role:"owner",isActive:true}).returning();
  await db.insert(userCompaniesTable).values({companyId:c.id,userId:u.id,role:"owner",isDefault:true});
  await seedCompanyFiscalCalendar(c.id);
  const [b]=await db.insert(branchesTable).values({companyId:c.id,name:tag,nameAr:tag,city:"اختبار"}).returning();
  const [w]=await db.insert(warehousesTable).values({companyId:c.id,branchId:b.id,name:tag,nameAr:tag,isDefault:true}).returning();
  const [cat]=await db.insert(categoriesTable).values({name:tag,nameAr:tag}).returning();
  const [p]=await db.insert(productsTable).values({companyId:c.id,categoryId:cat.id,name:tag,nameAr:tag,
    sku:tag,price:String(price),costPrice:"50",stock:"0",costingMethod:"fifo"}).returning();
  const [customer]=await db.insert(customersTable).values({companyId:c.id,name:"عميل مصطنع"}).returning();
  await db.transaction(tx=>recordStockMove(tx,{companyId:c.id,productId:p.id,toWarehouseId:w.id,
    quantity:20,unitCost:50,kind:"receipt",createdBy:u.id}));
  await q(`INSERT INTO company_tax_policy_versions(company_id,revision,request_id,request_hash,effective_from,status,
    vat_number,price_includes_vat,product_rules,service_rule,legacy_state,reason,created_by)
    VALUES($1,1,$2,'synthetic',$3,'registered','300000000000003',$4,$5,'{"category":"standard"}','{}','synthetic fixture only',$6)`,
    [c.id,randomUUID(),riyadhDate(),inclusive,JSON.stringify([{productId:p.id,rule:{category:"standard"}}]),u.id]);
  const a=request.agent(app).set("X-Forwarded-For",`198.51.100.${ip++}`);
  expect((await a.post("/api/auth/login").send({email:u.email,password})).status).toBe(200);
  const extraRules:Array<typeof discountRulesTable.$inferSelect>=[];
  for(const [scope,kind,value] of [
    ...(options.lineFixed!=null?[["line","fixed",options.lineFixed] as const]:[]),
    ...(options.linePercent!=null?[["line","percent",options.linePercent] as const]:[]),
    ...(options.orderRules??[]).map(v=>["order","fixed",v] as const),
  ]){
    const accountSystemKey=options.distinctRuleAccounts?`test_discount_${tag}_${extraRules.length}`:"sales_discount";
    if(options.distinctRuleAccounts)await q(`INSERT INTO accounts(code,name,name_ar,type,system_key)
      VALUES($1,'Synthetic rule discount','خصم قاعدة مصطنع','expense',$1)`,[accountSystemKey]);
    const [r]=await db.insert(discountRulesTable).values({name:`${tag}-${extraRules.length}`,nameAr:`قاعدة ${extraRules.length}`,
      kind,scope,value:String(value),reasonCode:"test",accountSystemKey}).returning();
    extraRules.push(r);
  }
  const rule=namedRule?(await db.insert(discountRulesTable).values({name:tag,nameAr:tag,kind:"fixed",scope:"order",
    value:"11.50",reasonCode:"test",accountSystemKey:"sales_discount"}).returning())[0]:null;
  const created=await a.post("/api/sales/orders").send({customerId:customer.id,branchId:b.id,warehouseId:w.id,
    priceIncludesVat:inclusive,orderDiscount:discount,lines:Array.from({length:lineCount},()=>({productId:p.id,description:"صنف اتفاق",
      quantity,unitPrice:price,discountPct:0,taxRate:15}))});
  expect(created.status,JSON.stringify(created.body)).toBe(201);
  if(rule)await q("UPDATE discount_rules SET is_active=false WHERE id=$1",[rule.id]);
  for(const r of extraRules)await q("UPDATE discount_rules SET is_active=false WHERE id=$1",[r.id]);
  const order=created.body;
  const delivery=await a.post("/api/sales/deliveries").send({soId:order.id});
  expect(delivery.status,JSON.stringify(delivery.body)).toBe(201);
  const lines=await q("SELECT * FROM sales_order_lines WHERE so_id=$1 ORDER BY id",[order.id]);
  return {a,c,u,b,w,p,customer,order,line:lines[0],lines,password,rule,extraRules};
}
type F=Awaited<ReturnType<typeof fixture>>;
async function quote(f:F,quantity:number){
  const body={soId:f.order.id,soQuantities:[{soLineId:f.line.id,quantity}]};
  const res=await f.a.post("/api/sales/invoices/tax-preview").send(body);
  expect(res.status,JSON.stringify(res.body)).toBe(200);
  return {body:{...body,taxPreviewToken:res.body.previewToken,taxContextToken:res.body.context.token},preview:res.body};
}
async function state(f:F){
  return (await q(`SELECT
    (SELECT count(*)::int FROM customer_invoices WHERE company_id=$1) AS invoices,
    (SELECT count(*)::int FROM stock_moves WHERE product_id=$2) AS moves,
    (SELECT sum(quantity)::text FROM stock_quants WHERE product_id=$2) AS quantity,
    (SELECT count(*)::int FROM journal_entries WHERE company_id=$1) AS journals,
    (SELECT count(*)::int FROM financial_requests WHERE company_id=$1) AS receipts`,[f.c.id,f.p.id]))[0];
}
describe("sales order fixed commercial basis, trusted partial invoice",()=>{
  it("legacy precision needs explicit identity-proved evidence; never rewrites source rows or issued history",async()=>{
    const f=await fixture(true,115,3,0,false,1,{lineFixed:1});
    await q("UPDATE sales_orders SET pricing_basis=jsonb_set(pricing_basis,'{version}','1') WHERE id=$1",[f.order.id]);
    await q("UPDATE sales_order_lines SET discount_pct=round(discount_pct,2) WHERE so_id=$1",[f.order.id]);
    const before=await state(f),source=await q("SELECT * FROM sales_order_lines WHERE so_id=$1",[f.order.id]);
    expect((await f.a.post("/api/sales/invoices/tax-preview").send({soId:f.order.id})).status).toBe(409);
    const review={priceIncludesVat:true,currencyCode:"SAR",orderDiscount:0,confirmStoredPrecision:true,
      reason:"دليل مصطنع لمراجعة فرق دقة التخزين دون تغيير الاتفاق",proof:{currentPassword:"wrong"}};
    expect((await f.a.post(`/api/sales/orders/${f.order.id}/review-price-basis`).send(review)).status).toBeGreaterThanOrEqual(400);
    expect((await f.a.post(`/api/sales/orders/${f.order.id}/review-price-basis`).send({
      ...review,orderDiscount:1,proof:{currentPassword:f.password}})).status).toBe(409);
    const result=await f.a.post(`/api/sales/orders/${f.order.id}/review-price-basis`).send({
      ...review,proof:{currentPassword:f.password}});
    expect(result.status,JSON.stringify(result.body)).toBe(200);
    expect(await q("SELECT * FROM sales_order_lines WHERE so_id=$1",[f.order.id])).toEqual(source);
    expect(await state(f)).toEqual(before);
    expect((await q("SELECT count(*)::int AS n FROM audit_logs WHERE company_id=$1 AND action='sales_order.stored_precision_reviewed'",[f.c.id]))[0].n).toBe(1);
    for(const quantity of [1,2]){
      const v=await quote(f,quantity),r=await f.a.post("/api/sales/invoices").set("Idempotency-Key",randomUUID()).send(v.body);
      expect(r.status,JSON.stringify(r.body)).toBe(201);
    }
    expect((await f.a.post(`/api/sales/orders/${f.order.id}/review-price-basis`).send({
      ...review,proof:{currentPassword:f.password}})).status).toBe(409);
    expect(Number((await q("SELECT sum(total) AS n FROM customer_invoices WHERE so_id=$1",[f.order.id]))[0].n)).toBe(344);
  });
  it("a pre-fix partly invoiced rule allocation stays blocked without source evidence",async()=>{
    const f=await fixture(false,1,3,0,false,1,{orderRules:[.01,.01]});
    await q("UPDATE sales_orders SET pricing_basis=jsonb_set(pricing_basis,'{version}','1') WHERE id=$1",[f.order.id]);
    const first=await quote(f,1);
    const r=await f.a.post("/api/sales/invoices").set("Idempotency-Key",randomUUID()).send(first.body);
    expect(r.status).toBe(201);
    // Reproduce the old issued snapshot, which never stored gross-source allocation.
    await q(`UPDATE document_issuer_snapshots SET issuer=issuer #- '{taxCalculation,discountAllocation}'
      WHERE document_kind='invoice' AND document_id=$1 AND company_id=$2`,[r.body.id,f.c.id]);
    const before=await state(f);
    const next=await f.a.post("/api/sales/invoices/tax-preview").send({soId:f.order.id,soQuantities:[{soLineId:f.line.id,quantity:1}]});
    expect(next.status).toBe(409);expect(next.body.error).toContain("مصالحة");expect(await state(f)).toEqual(before);
  });
  it("four-decimal storage and legacy review never authorize true commercial tampering",async()=>{
    const f=await fixture(false,115,3,0,false,1,{lineFixed:1}),before=await state(f);
    for(const [column,value] of [["discount_pct",.2900],["unit_price",116],["quantity",4]] as const){
      const old=f.line[column];
      await q(`UPDATE sales_order_lines SET ${column}=$2 WHERE id=$1`,[f.line.id,value]);
      expect((await f.a.post("/api/sales/invoices/tax-preview").send({soId:f.order.id})).status).toBe(409);
      await q(`UPDATE sales_order_lines SET ${column}=$2 WHERE id=$1`,[f.line.id,old]);
    }
    expect(await state(f)).toEqual(before);
  });
  for(const inclusive of [true,false])
    it(`stacked line rules, manual discount and two order rules reconcile fractional portions (inclusive=${inclusive})`,async()=>{
      const f=await fixture(inclusive,115,3,.07,false,1,{lineFixed:1,linePercent:2.5,orderRules:[.01,.02]});
      const before=await state(f);
      for(const quantity of [.5,1,1.5]){
        const v=await quote(f,quantity),r=await f.a.post("/api/sales/invoices").set("Idempotency-Key",randomUUID()).send(v.body);
        expect(r.status,JSON.stringify(r.body)).toBe(201);
      }
      const rows=await q(`SELECT i.id,i.subtotal,i.total,i.discount,i.vat,i.applied_discounts,
        d.issuer->'taxCalculation'->'discountAllocation' AS allocation
        FROM customer_invoices i JOIN document_issuer_snapshots d ON d.document_kind='invoice' AND d.document_id=i.id
        AND d.company_id=i.company_id WHERE i.so_id=$1 ORDER BY i.id`,[f.order.id]);
      const rawSources=new Map(f.extraRules.map(r=>[r.id,0]));let manual=0,total=0,vat=0,netDiscount=0;
      const roundRatio=(n:number,d:number)=>Math.floor((2*n+d)/(2*d));
      for(const r of rows){
        const l=r.allocation.lines[0],gross=Math.round(l.quantity*11500);
        const rawBase=inclusive?roundRatio(gross*100,115):gross;
        manual+=Math.round(l.manualGrossDiscount*100);
        let payable=gross-Math.round(l.manualGrossDiscount*100);
        let prev=inclusive?roundRatio(payable*100,115):payable;
        let namedNet=0;
        for(const a of l.rules){
          expect(a.grossDiscount).toBeGreaterThanOrEqual(0);
          rawSources.set(a.id,rawSources.get(a.id)!+Math.round(a.grossDiscount*100));
          payable-=Math.round(a.grossDiscount*100);
          const next=inclusive?roundRatio(payable*100,115):payable;
          const saved=r.applied_discounts.find((x:{id:number})=>x.id===a.id);
          expect(Math.round(saved.amount*100)).toBe(prev-next);namedNet+=prev-next;prev=next;
        }
        const expectedVat=inclusive?payable-prev:roundRatio(prev*15,100);
        expect(Math.round(Number(r.subtotal)*100)).toBe(rawBase);
        expect(Math.round(Number(r.vat)*100)).toBe(expectedVat);
        expect(Math.round(Number(r.discount)*100)).toBe(rawBase-prev);
        expect(namedNet).toBeLessThanOrEqual(rawBase-prev);
        expect(Math.round(Number(r.total)*100)).toBe(prev+expectedVat);
        total+=prev+expectedVat;vat+=expectedVat;netDiscount+=rawBase-prev;
      }
      expect([...rawSources.values()]).toEqual([100,860,1,2]);expect(manual).toBe(7);
      const ledger=await q(`SELECT a.system_key,sum(l.debit-l.credit) AS balance FROM journal_entries e
        JOIN journal_entry_lines l ON l.entry_id=e.id JOIN accounts a ON a.id=l.account_id
        WHERE e.company_id=$1 GROUP BY a.system_key`,[f.c.id]);
      const balance=(key:string)=>Math.round(Number(ledger.find(r=>r.system_key===key)?.balance??0)*100);
      expect(balance("ar")).toBe(total);expect(balance("vat_output")).toBe(-vat);expect(balance("sales_discount")).toBe(netDiscount);
      expect(balance("inventory")).toBe(85000);expect(balance("cogs")).toBe(15000);
      expect((await state(f)).moves).toBe(before.moves);
      expect(ledger.reduce((s,r)=>s+Math.round(Number(r.balance)*100),0)).toBe(0);
      console.info("[stacked-independent-reconciliation]",JSON.stringify({inclusive,rawSources:[...rawSources],manual,total,vat,netDiscount,ledger}));
    });
  for(const inclusive of [true,false])for(const partial of [true,false])
    it(`fixed line discount survives PostgreSQL storage and conversion (inclusive=${inclusive},partial=${partial})`,async()=>{
      const f=await fixture(inclusive,115,3,0,false,1,{lineFixed:1});
      const [saved]=await q("SELECT pricing_basis FROM sales_orders WHERE id=$1",[f.order.id]);
      expect(saved.pricing_basis.lines[0].discountPct).toBe(.2899);
      console.info("[precision-storage-evidence]",JSON.stringify({agreed:saved.pricing_basis.lines[0].discountPct,stored:f.line.discount_pct}));
      await quote(f,partial?1:3);
      expect(Number(f.line.discount_pct)).toBe(saved.pricing_basis.lines[0].discountPct);
      const before=await state(f),ids=[];
      for(const quantity of partial?[1,2]:[3]){
        const v=await quote(f,quantity);
        const r=await f.a.post("/api/sales/invoices").set("Idempotency-Key",randomUUID()).send(v.body);
        expect(r.status,JSON.stringify(r.body)).toBe(201);ids.push(r.body.id);
      }
      const invoices=await q("SELECT total,discount,applied_discounts FROM customer_invoices WHERE so_id=$1",[f.order.id]);
      expect(invoices).toHaveLength(partial?2:1);
      expect(Math.round(invoices.reduce((s,i)=>s+Number(i.total),0)*100)).toBe(inclusive?34400:39560);
      expect(invoices.every(i=>i.applied_discounts.every((a:{amount:number})=>a.amount>=0))).toBe(true);
      expect((await state(f)).moves).toBe(before.moves);
      const [balance]=await q(`SELECT sum(l.debit-l.credit) AS n FROM journal_entry_lines l
        JOIN journal_entries e ON e.id=l.entry_id WHERE e.company_id=$1`,[f.c.id]);
      expect(Number(balance.n)).toBe(0);
    });
  for(const inclusive of [true,false])for(const manual of [0,.01])
    it(`two penny rules retain sources through three actual invoices (inclusive=${inclusive},manual=${manual})`,async()=>{
      const f=await fixture(inclusive,1,3,manual,false,1,{orderRules:[.01,.01],distinctRuleAccounts:true});
      const results=[];
      for(let part=0;part<3;part++){
        const v=await quote(f,1);
        const r=await f.a.post("/api/sales/invoices").set("Idempotency-Key",randomUUID()).send(v.body);
        expect(r.status,JSON.stringify(r.body)).toBe(201);results.push(r.body.id);
      }
      const invoices=await q("SELECT total,vat,discount,applied_discounts FROM customer_invoices WHERE so_id=$1 ORDER BY id",[f.order.id]);
      const byRule=new Map(f.extraRules.map(r=>[r.id,0]));
      let actualManual=0;
      for(const inv of invoices){
        const named=inv.applied_discounts.reduce((sum:number,r:{id:number;amount:number})=>{
          expect(r.amount).toBeGreaterThanOrEqual(0);expect(byRule.has(r.id)).toBe(true);
          byRule.set(r.id,byRule.get(r.id)!+Math.round(r.amount*100));return sum+Math.round(r.amount*100);
        },0);
        const manualPart=Math.round(Number(inv.discount)*100)-named;
        expect(manualPart).toBeGreaterThanOrEqual(0);actualManual+=manualPart;
      }
      expect([...byRule.values()]).toEqual([1,1]);expect(actualManual).toBe(Math.round(manual*100));
      const total=invoices.reduce((s,i)=>s+Math.round(Number(i.total)*100),0);
      const vat=invoices.reduce((s,i)=>s+Math.round(Number(i.vat)*100),0);
      const discount=invoices.reduce((s,i)=>s+Math.round(Number(i.discount)*100),0);
      expect(discount).toBe(2+Math.round(manual*100));expect(total).toBe(inclusive?300-discount:345-discount);
      expect(vat).toBe(inclusive?39:45);
      const ledger=await q(`SELECT a.system_key,sum(l.debit-l.credit) AS balance FROM journal_entries e
        JOIN journal_entry_lines l ON l.entry_id=e.id JOIN accounts a ON a.id=l.account_id
        WHERE e.company_id=$1 GROUP BY a.system_key`,[f.c.id]);
      const cents=(key:string)=>Math.round(Number(ledger.find(a=>a.system_key===key)?.balance??0)*100);
      expect(cents("ar")).toBe(total);expect(cents("vat_output")).toBe(-vat);
      expect(cents("sales_discount")).toBe(actualManual);
      for(const rule of f.extraRules)expect(cents(rule.accountSystemKey)).toBe(byRule.get(rule.id));
      expect(ledger.reduce((s,a)=>s+Math.round(Number(a.balance)*100),0)).toBe(0);
      console.info("[discount-independent-reconciliation]",JSON.stringify({inclusive,manual,byRule:[...byRule],actualManual,total,vat,discount,ledger}));
    });
  it("multiple tiny lines use grouped invoice VAT and disclose the final rounding difference",async()=>{
    const f=await fixture(false,.01,1,0,false,4);
    for(const ids of [f.lines.slice(0,2),f.lines.slice(2)]){
      const input={soId:f.order.id,soQuantities:ids.map(l=>({soLineId:l.id,quantity:1}))};
      const preview=await f.a.post("/api/sales/invoices/tax-preview").send(input);
      expect(preview.status,JSON.stringify(preview.body)).toBe(200);
      expect(preview.body.totals.total).toBe(.02);expect(preview.body.totals.vat).toBe(0);
      if(ids[0].id===f.lines[2].id)expect(preview.body.comparison.finalDifferenceFromOrder).toBe(-.01);
      const issued=await f.a.post("/api/sales/invoices").set("Idempotency-Key",randomUUID()).send({...input,
        taxContextToken:preview.body.context.token,taxPreviewToken:preview.body.previewToken});
      expect(issued.status,JSON.stringify(issued.body)).toBe(201);
    }
    expect(Number((await q("SELECT sum(total) AS total FROM customer_invoices WHERE company_id=$1",[f.c.id]))[0].total)).toBe(.04);
  });
  it("named discounts preserve their marginal NET account amounts across partials",async()=>{
    const f=await fixture(true,115,3,1,true);
    for(const quantity of [1,2]){
      const v=await quote(f,quantity);
      const r=await f.a.post("/api/sales/invoices").set("Idempotency-Key",randomUUID()).send(v.body);
      expect(r.status,JSON.stringify(r.body)).toBe(201);
    }
    const invoices=await q("SELECT total,applied_discounts FROM customer_invoices WHERE company_id=$1",[f.c.id]);
    expect(invoices.reduce((s,i)=>s+Number(i.total),0)).toBe(332.5);
    expect(Math.round(invoices.reduce((s,i)=>s+Number(i.applied_discounts[0].amount),0)*100)/100).toBe(10);
    expect(invoices.every(i=>i.applied_discounts[0].id===f.rule!.id)).toBe(true);
  });
  for(const inclusive of [true,false])it(`partial + remainder + exact committed replay (${inclusive?"inclusive":"exclusive"})`,async()=>{
    const f=await fixture(inclusive),before=await state(f);
    const first=await quote(f,1),key=randomUUID();
    const r=await f.a.post("/api/sales/invoices").set("Idempotency-Key",key).send(first.body);
    expect(r.status,JSON.stringify(r.body)).toBe(201);
    const committed=await state(f);
    const recovered=await f.a.post("/api/sales/invoices").set("Idempotency-Key",key).send(first.body);
    expect(recovered.status,JSON.stringify(recovered.body)).toBe(201);
    expect(recovered.body.id).toBe(r.body.id);expect(await state(f)).toEqual(committed);
    const remainder=await quote(f,2);
    const last=await f.a.post("/api/sales/invoices").set("Idempotency-Key",randomUUID()).send(remainder.body);
    expect(last.status,JSON.stringify(last.body)).toBe(201);
    const invoices=await q("SELECT total,vat,discount FROM customer_invoices WHERE company_id=$1 ORDER BY id",[f.c.id]);
    const sum=(field:string)=>Math.round(invoices.reduce((s,i)=>s+Number(i[field]),0)*100)/100;
    expect(sum("total")).toBe(inclusive?344:395.6);
    expect(sum("discount")).toBe(inclusive?0.87:1);
    expect(sum("vat")).toBe(inclusive?44.87:51.6);
    const [inventory]=await q(`SELECT
      (SELECT sum(quantity) FROM stock_quants WHERE product_id=$1) AS quantity,
      (SELECT sum(quantity*avg_cost) FROM stock_quants WHERE product_id=$1) AS value,
      (SELECT sum(remaining_qty) FROM stock_layers WHERE product_id=$1) AS layer_quantity,
      (SELECT sum(remaining_qty*unit_cost) FROM stock_layers WHERE product_id=$1) AS layer_value`,[f.p.id]);
    expect(Object.fromEntries(Object.entries(inventory).map(([k,v])=>[k,Number(v)])))
      .toEqual({quantity:17,value:850,layer_quantity:17,layer_value:850});
    const ledger=await q(`SELECT a.system_key,sum(l.debit-l.credit) AS balance FROM journal_entries e
      JOIN journal_entry_lines l ON l.entry_id=e.id JOIN accounts a ON a.id=l.account_id
      WHERE e.company_id=$1 GROUP BY a.system_key`,[f.c.id]);
    const accountBalance=(key:string)=>Number(ledger.find(r=>r.system_key===key)?.balance??0);
    expect(accountBalance("inventory")).toBe(850);expect(accountBalance("cogs")).toBe(150);
    expect(accountBalance("ar")).toBe(inclusive?344:395.6);expect(accountBalance("vat_output")).toBe(inclusive?-44.87:-51.6);
    console.info("[so-independent-reconciliation]",JSON.stringify({inclusive,inventory,ledger}));
    const end=await state(f);expect(end.moves).toBe(before.moves);expect(end.quantity).toBe("17.0000");
    expect(end.invoices).toBe(2);
    const balance=(await q(`SELECT round(sum(l.debit::numeric-l.credit::numeric),2)::text AS balance
      FROM journal_entry_lines l JOIN journal_entries j ON j.id=l.entry_id WHERE j.company_id=$1`,[f.c.id]))[0];
    expect(Number(balance.balance)).toBe(0);
  });
  it("catalogue/default pricing changes do not mutate the agreement",async()=>{
    const f=await fixture(true),first=await quote(f,1);
    await q("UPDATE products SET price=900 WHERE id=$1",[f.p.id]);
    await q(`INSERT INTO company_tax_policy_versions(company_id,revision,request_id,request_hash,effective_from,status,vat_number,
      price_includes_vat,product_rules,service_rule,legacy_state,reason,created_by)
      SELECT company_id,2,$2,'synthetic-change',effective_from,status,vat_number,false,product_rules,service_rule,legacy_state,'synthetic',created_by
      FROM company_tax_policy_versions WHERE company_id=$1 AND revision=1`,[f.c.id,randomUUID()]);
    const changed=await quote(f,1);
    expect(changed.preview.totals).toEqual(first.preview.totals);
    expect(changed.preview.context.priceIncludesVat).toBe(true);
    const old=await f.a.post("/api/sales/invoices").set("Idempotency-Key",randomUUID()).send(first.body);
    expect(old.status).toBe(409);
    const ok=await f.a.post("/api/sales/invoices").set("Idempotency-Key",randomUUID()).send(changed.body);
    expect(ok.status,JSON.stringify(ok.body)).toBe(201);
  });
  it("concurrent partials cannot exceed delivered remaining; a single reviewed body commits once",async()=>{
    const f=await fixture(false),v=await quote(f,3),key=randomUUID(),before=await state(f);
    const rs=await Promise.all([f.a.post("/api/sales/invoices").set("Idempotency-Key",key).send(v.body),
      f.a.post("/api/sales/invoices").set("Idempotency-Key",key).send(v.body)]);
    expect(rs.map(r=>r.status)).toEqual([201,201]);expect(rs[0].body.id).toBe(rs[1].body.id);
    expect((await state(f)).moves).toBe(before.moves);
    const extra=await f.a.post("/api/sales/invoices/tax-preview").send({soId:f.order.id,soQuantities:[{soLineId:f.line.id,quantity:1}]});
    expect(extra.status).toBe(409);
  });
  it("legacy evidence is not inferred; invalid/mutated/foreign quantities and prices have no effect",async()=>{
    const f=await fixture(false),before=await state(f);
    const foreign=await fixture(false);
    for(const body of [
      {soId:f.order.id,soQuantities:[{soLineId:foreign.line.id,quantity:1}]},
      {soId:f.order.id,soQuantities:[{soLineId:f.line.id,quantity:4}]},
      {soId:f.order.id,lines:[{productId:f.p.id,description:"tamper",quantity:1,unitPrice:1,discountPct:0,taxRate:15}]},
    ])expect((await f.a.post("/api/sales/invoices/tax-preview").send(body)).status).toBeGreaterThanOrEqual(400);
    await q("UPDATE sales_orders SET pricing_basis=NULL WHERE id=$1",[f.order.id]);
    expect((await f.a.post("/api/sales/invoices/tax-preview").send({soId:f.order.id})).status).toBe(422);
    expect(await state(f)).toEqual(before);
  });
  it("withdrawal of current authority cannot issue or replay under a denied membership",async()=>{
    const f=await fixture(false),v=await quote(f,1),before=await state(f);
    await q("UPDATE user_companies SET role='employee' WHERE company_id=$1 AND user_id=$2",[f.c.id,f.u.id]);
    const r=await f.a.post("/api/sales/invoices").set("Idempotency-Key",randomUUID()).send(v.body);
    expect(r.status).toBeGreaterThanOrEqual(400);expect(await state(f)).toEqual(before);
  });
  it("branch withdrawal denies committed replay and close without treating denial as absence",async()=>{
    const f=await fixture(false),v=await quote(f,1),key=randomUUID();
    const issued=await f.a.post("/api/sales/invoices").set("Idempotency-Key",key).send(v.body);
    expect(issued.status).toBe(201);const before=await state(f);
    await q("UPDATE user_companies SET role='accountant' WHERE company_id=$1 AND user_id=$2",[f.c.id,f.u.id]);
    await q(`INSERT INTO return_access(company_id,user_id,template,capabilities,branches,updated_by)
      VALUES($1,$2,'branch_accountant','["view"]'::jsonb,'[]'::jsonb,$2) ON CONFLICT(company_id,user_id) DO UPDATE SET branches='[]'::jsonb`,[f.c.id,f.u.id]);
    expect((await f.a.post("/api/sales/invoices").set("Idempotency-Key",key).send(v.body)).status).toBe(403);
    expect((await f.a.post("/api/sales/invoices/tax-preview/close-intent").send({requestKey:key,body:v.body})).status).toBe(403);
    expect(await state(f)).toEqual(before);
    await q("UPDATE return_access SET branches=$3::jsonb WHERE company_id=$1 AND user_id=$2",[f.c.id,f.u.id,JSON.stringify([f.b.id])]);
    const recovered=await f.a.post("/api/sales/invoices").set("Idempotency-Key",key).send(v.body);
    expect(recovered.status,JSON.stringify(recovered.body)).toBe(201);expect(recovered.body.id).toBe(issued.body.id);
    expect(await state(f)).toEqual(before);
  });
  it("legacy review requires fresh account proof and records evidence without rewriting totals",async()=>{
    const f=await fixture(false),before=await state(f);
    await q("UPDATE sales_orders SET pricing_basis=NULL WHERE id=$1",[f.order.id]);
    const body={priceIncludesVat:false,currencyCode:"SAR",orderDiscount:1,
      reason:"مراجعة أصل اتفاق مصطنع مستقل",proof:{currentPassword:"incorrect"}};
    expect((await f.a.post(`/api/sales/orders/${f.order.id}/review-price-basis`).send(body)).status).toBeGreaterThanOrEqual(400);
    const r=await f.a.post(`/api/sales/orders/${f.order.id}/review-price-basis`).send({...body,proof:{currentPassword:f.password}});
    expect(r.status,JSON.stringify(r.body)).toBe(200);
    expect(await state(f)).toEqual(before);
    const [saved]=await q("SELECT pricing_basis,total FROM sales_orders WHERE id=$1",[f.order.id]);
    expect(Number(saved.total)).toBe(Number(f.order.total));
    expect(saved.pricing_basis.source).toBe("reviewed_legacy");
    expect((await q("SELECT details FROM audit_logs WHERE company_id=$1 AND action='sales_order.price_basis_reviewed'",[f.c.id]))).toHaveLength(1);
    await quote(f,1);
  });
  it("legacy basis review cannot cross a withdrawn branch scope even with valid account proof",async()=>{
    const f=await fixture(false);
    await q("UPDATE sales_orders SET pricing_basis=NULL WHERE id=$1",[f.order.id]);
    await q("UPDATE user_companies SET role='accountant' WHERE company_id=$1 AND user_id=$2",[f.c.id,f.u.id]);
    await q(`INSERT INTO return_access(company_id,user_id,template,capabilities,branches,updated_by)
      VALUES($1,$2,'branch_accountant','["view"]'::jsonb,'[]'::jsonb,$2)`,[f.c.id,f.u.id]);
    const r=await f.a.post(`/api/sales/orders/${f.order.id}/review-price-basis`).send({priceIncludesVat:false,
      currencyCode:"SAR",orderDiscount:1,reason:"مراجعة مصطنعة لا تمنح نطاقًا",proof:{currentPassword:f.password}});
    expect(r.status,JSON.stringify(r.body)).toBe(403);
    expect((await q("SELECT pricing_basis FROM sales_orders WHERE id=$1",[f.order.id]))[0].pricing_basis).toBe(null);
  });
  it("changed fulfilment facts invalidate review, and distinct concurrent keys do not overbill",async()=>{
    const f=await fixture(false),v=await quote(f,2);
    const rs=await Promise.all([f.a.post("/api/sales/invoices").set("Idempotency-Key",randomUUID()).send(v.body),
      f.a.post("/api/sales/invoices").set("Idempotency-Key",randomUUID()).send(v.body)]);
    expect(rs.map(r=>r.status).sort()).toEqual([201,409]);
    expect((await state(f)).invoices).toBe(1);
    expect(Number((await q("SELECT invoiced_qty FROM sales_order_lines WHERE id=$1",[f.line.id]))[0].invoiced_qty)).toBe(2);
  });
  it("the original independent approver must remain eligible at invoice execution",async()=>{
    const f=await fixture(false),tag=randomUUID();
    const [reviewer]=await db.insert(usersTable).values({name:"مراجع مصطنع مستقل",email:`so-review-${tag}@example.invalid`,
      passwordHash:await bcrypt.hash(`Synthetic-${tag}`,4),role:"manager",isActive:true}).returning();
    await db.insert(userCompaniesTable).values({companyId:f.c.id,userId:reviewer.id,role:"manager"});
    const submission=await submitForApproval({companyId:f.c.id,docType:"sales_order",recordId:f.order.id,
      recordRef:f.order.reference,amount:Number(f.order.total),branchId:f.b.id,submittedByUserId:f.u.id,
      forceRoles:["manager"],forceReason:"مصطنع لإثبات أهلية المعتمد الأصلي"});
    expect(submission.required).toBe(true);
    await actOnApproval(submission.requestId!,reviewer.id,reviewer.name,"approve",f.c.id);
    const v=await quote(f,1),before=await state(f);
    await q("UPDATE users SET is_active=false WHERE id=$1",[reviewer.id]);
    const r=await f.a.post("/api/sales/invoices").set("Idempotency-Key",randomUUID()).send(v.body);
    expect(r.status,JSON.stringify(r.body)).toBe(403);expect(await state(f)).toEqual(before);
  });
  it.each(["executor","approver"] as const)("withdrawn %s wins while conversion waits behind a real PostgreSQL fence",async(who)=>{
    const f=await fixture(false),tag=randomUUID();
    const [reviewer]=await db.insert(usersTable).values({name:"مراجع انتظار مصطنع",email:`waiting-${tag}@example.invalid`,
      passwordHash:await bcrypt.hash(`Synthetic-${tag}`,4),role:"manager",isActive:true}).returning();
    await db.insert(userCompaniesTable).values({companyId:f.c.id,userId:reviewer.id,role:"manager"});
    const submitted=await submitForApproval({companyId:f.c.id,docType:"sales_order",recordId:f.order.id,
      recordRef:f.order.reference,amount:Number(f.order.total),branchId:f.b.id,submittedByUserId:f.u.id,forceRoles:["manager"]});
    await actOnApproval(submitted.requestId!,reviewer.id,reviewer.name,"approve",f.c.id);
    const v=await quote(f,1),key=randomUUID(),before=await state(f),blocker=await pool.connect();
    try{
      await blocker.query("BEGIN");
      await blocker.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [JSON.stringify([f.c.id,f.u.id,"POST:/api:/sales/invoices",key])]);
      const [{pid}]=(await blocker.query("SELECT pg_backend_pid() AS pid")).rows;
      const pending=f.a.post("/api/sales/invoices").set("Idempotency-Key",key).send(v.body).then(r=>r);
      let observed=false;
      for(let i=0;i<150;i++){
        const [r]=await q("SELECT count(*)::int AS n FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))",[pid]);
        if(r.n>0){observed=true;break;}await new Promise(r=>setTimeout(r,10));
      }
      expect(observed).toBe(true);
      if(who==="executor")await q("UPDATE user_companies SET role='employee' WHERE company_id=$1 AND user_id=$2",[f.c.id,f.u.id]);
      else await q("UPDATE users SET is_active=false WHERE id=$1",[reviewer.id]);
      await blocker.query("COMMIT");
      const result=await pending;expect(result.status,JSON.stringify(result.body)).toBe(403);
      expect(await state(f)).toEqual(before);
      console.info("[order-waiting-revocation]",JSON.stringify({who,blockerPid:pid,waiterObserved:observed,status:result.status,noFinancialEffect:true}));
    }finally{await blocker.query("ROLLBACK");blocker.release();}
  });
  it.each([false,true])("a material source/tax change invalidates old approval (inclusive=%s)",async(inclusive)=>{
    const f=await fixture(inclusive),tag=randomUUID();
    const [reviewer]=await db.insert(usersTable).values({name:"مراجع مصطنع",email:`material-${tag}@example.invalid`,
      passwordHash:await bcrypt.hash(`Synthetic-${tag}`,4),role:"manager",isActive:true}).returning();
    await db.insert(userCompaniesTable).values({companyId:f.c.id,userId:reviewer.id,role:"manager"});
    const submission=await submitForApproval({companyId:f.c.id,docType:"sales_order",recordId:f.order.id,
      recordRef:f.order.reference,amount:Number(f.order.total),branchId:f.b.id,submittedByUserId:f.u.id,forceRoles:["manager"]});
    await actOnApproval(submission.requestId!,reviewer.id,reviewer.name,"approve",f.c.id);
    await expect(q("UPDATE sales_orders SET notes='material amendment requires independent review' WHERE id=$1",[f.order.id]))
      .rejects.toThrow("Material edits of an executed reviewed document");
    // Keep that existing protection. Change the effective tax evidence in the
    // isolated fixture instead; the agreed order itself is not rewritten.
    await q(`INSERT INTO company_tax_policy_versions(company_id,revision,request_id,request_hash,effective_from,status,
      vat_number,price_includes_vat,product_rules,service_rule,legacy_state,reason,created_by)
      SELECT company_id,2,$2,'test-policy-change',effective_from,'not_registered',NULL,price_includes_vat,
        product_rules,service_rule,legacy_state,'Synthetic changed financial facts',created_by
      FROM company_tax_policy_versions WHERE company_id=$1 AND revision=1`,[f.c.id,randomUUID()]);
    const before=await state(f);
    const r=await f.a.post("/api/sales/invoices/tax-preview").send({soId:f.order.id});
    expect(r.status).toBe(409);expect(await state(f)).toEqual(before);
  });
  it.each(["execute","close"] as const)("PostgreSQL financial fence: %s queues first",async(first)=>{
    const f=await fixture(false),v=await quote(f,1),key=randomUUID(),blocker=await pool.connect();
    const before=await state(f);
    try{
      await blocker.query("BEGIN");
      await blocker.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [JSON.stringify([f.c.id,f.u.id,"POST:/api:/sales/invoices",key])]);
      const [{pid}]=(await blocker.query("SELECT pg_backend_pid() AS pid")).rows;
      const execute=()=>f.a.post("/api/sales/invoices").set("Idempotency-Key",key).send(v.body).then(r=>r);
      const close=()=>f.a.post("/api/sales/invoices/tax-preview/close-intent").send({requestKey:key,body:v.body}).then(r=>r);
      const waiting=async(n:number)=>{
        for(let i=0;i<100;i++){
          const rows=await q(`WITH RECURSIVE waiting AS (
            SELECT pid FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))
            UNION SELECT a.pid FROM pg_stat_activity a JOIN waiting w ON w.pid=ANY(pg_blocking_pids(a.pid)))
            SELECT count(*)::int AS n FROM waiting`,[pid]);
          if(rows[0].n>=n)return;
          await new Promise(r=>setTimeout(r,10));
        }
        throw new Error("Expected PostgreSQL lock waiter did not arrive");
      };
      const a=first==="execute"?execute():close();await waiting(1);
      const b=first==="execute"?close():execute();await waiting(2);
      await blocker.query("COMMIT");const results=await Promise.all([a,b]);
      if(first==="execute"){
        expect(results[0].status).toBe(201);expect(results[1].body.state).toBe("completed");
        expect((await state(f)).invoices).toBe(before.invoices+1);
      }else{
        expect(results[0].body.state).toBe("closed_without_execution");expect(results[1].status).toBe(409);
        expect((await state(f)).invoices).toBe(before.invoices);
      }
      expect((await state(f)).moves).toBe(before.moves);
      console.info("[so-postgres-fence]",JSON.stringify({first,blockerPid:pid,waiters:2,statuses:results.map(r=>r.status),
        deltaInvoices:(await state(f)).invoices-before.invoices,stockMovesUnchanged:true}));
    }finally{await blocker.query("ROLLBACK");blocker.release();}
  });
});
