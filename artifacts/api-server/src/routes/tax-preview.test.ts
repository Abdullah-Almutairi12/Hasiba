import {beforeAll,describe,it,expect,vi} from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import {randomUUID} from "node:crypto";
import type {Request} from "express";
import {db,pool,companiesTable,usersTable,userCompaniesTable,branchesTable,warehousesTable,
  categoriesTable,productsTable,customersTable,posSessionsTable,employeesTable} from "@workspace/db";
import app,{assertApplicationReady} from "../app";
import {recordStockMove} from "../lib/stock-engine";
import {seedCompanyFiscalCalendar} from "../lib/fiscal-calendar";
import {riyadhDate} from "../lib/vat-policy";
import {issueTaxPreview,verifyTaxPreview} from "../lib/tax-preview";

const q=async(s:string,p:unknown[]=[]) => (await pool.query(s,p)).rows;
let ip=30;
beforeAll(assertApplicationReady);
async function fixture(status="registered",inclusive=true,category="standard"){
  if(process.env.ACCOUNT_ISOLATED_TEST!=="true")throw new Error("Synthetic isolated PostgreSQL required");
  const tag=randomUUID(),password=`Preview-${tag}`;
  const [c]=await db.insert(companiesTable).values({name:tag,vatRegistrationStatus:"not_registered"}).returning();
  const [u]=await db.insert(usersTable).values({name:"قارئ مصطنع",email:`preview-${tag}@example.invalid`,
    passwordHash:await bcrypt.hash(password,4),role:"owner",isActive:true}).returning();
  await db.insert(userCompaniesTable).values({userId:u.id,companyId:c.id,role:"owner",isDefault:true});
  await seedCompanyFiscalCalendar(c.id);
  const [b]=await db.insert(branchesTable).values({companyId:c.id,name:tag,nameAr:"فرع مصطنع",city:"اختبار"}).returning();
  const [w]=await db.insert(warehousesTable).values({companyId:c.id,branchId:b.id,name:tag,nameAr:"مستودع مصطنع",isDefault:true}).returning();
  const [cat]=await db.insert(categoriesTable).values({name:tag,nameAr:tag}).returning();
  const [p]=await db.insert(productsTable).values({companyId:c.id,categoryId:cat.id,name:tag,nameAr:"صنف معاينة",
    sku:tag,price:"115",costPrice:"50",stock:"0"}).returning();
  const [customer]=await db.insert(customersTable).values({companyId:c.id,name:"عميل معاينة"}).returning();
  await db.transaction(tx=>recordStockMove(tx,{companyId:c.id,productId:p.id,toWarehouseId:w.id,
    quantity:20,unitCost:50,kind:"receipt",createdBy:u.id}));
  const [s]=await db.insert(posSessionsTable).values({branchId:b.id,cashierUserId:u.id,sessionNumber:tag,cashierName:u.name,openingCash:"0"}).returning();
  const rule={category,...(category==="zero"||category==="exempt"?{reason:"تصنيف مصطنع لاختبار الحساب"}:{})};
  await q(`INSERT INTO company_tax_policy_versions(company_id,revision,request_id,request_hash,effective_from,status,
    vat_number,price_includes_vat,product_rules,service_rule,legacy_state,reason,created_by)
    VALUES($1,1,$2,'synthetic-fixture-only',$3,$4,$5,$6,$7,$8,'{}','تهيئة اختبار معزول لا تفتح التفعيل',$9)`,
    [c.id,randomUUID(),riyadhDate(),status,status==="not_registered"?null:"300000000000003",
      inclusive,JSON.stringify([{productId:p.id,rule}]),JSON.stringify(rule),u.id]);
  const a=request.agent(app).set("X-Forwarded-For",`198.51.100.${ip++}`);
  expect((await a.post("/api/auth/login").send({email:u.email,password})).status).toBe(200);
  const pos={sessionId:s.id,items:[{productId:p.id,quantity:1}],discount:0,paymentMethod:"cash"};
  const invoice={customerId:customer.id,branchId:b.id,invoiceDate:riyadhDate(),orderDiscount:0,
    lines:[{productId:p.id,description:p.nameAr,quantity:1,unitPrice:115,taxRate:15}]};
  return {a,c,u,p,b,w,s,pos,invoice};
}
type F=Awaited<ReturnType<typeof fixture>>;
async function sellerFixture(f:F,mode:string,granularity:string){
  const [employee]=await db.insert(employeesTable).values({companyId:f.c.id,branchId:f.b.id,
    employeeNo:randomUUID(),name:"بائع بلا حساب دخول",nameAr:"بائع بلا حساب دخول",hireDate:"2026-01-01"}).returning();
  await q(`INSERT INTO sales_seller_eligibility(company_id,employee_id,enabled,branch_ids,updated_by)
    VALUES($1,$2,true,$3,$4)`,[f.c.id,employee.id,JSON.stringify([f.b.id]),f.u.id]);
  await q(`INSERT INTO sales_seller_policies(company_id,branch_id,inherit,mode,granularity,commission_enabled,effective_from,created_by)
    VALUES($1,0,false,$2,$3,false,now()-interval '1 minute',$4)`,[f.c.id,mode,granularity,f.u.id]);
  return employee;
}
async function counts(f:F){
  return (await q(`SELECT
    (SELECT count(*) FROM customer_invoices WHERE company_id=$1)::int AS invoices,
    (SELECT count(*) FROM stock_moves WHERE product_id=$2)::int AS moves,
    (SELECT count(*) FROM journal_entries WHERE company_id=$1)::int AS journals,
    (SELECT sum(quantity)::text FROM stock_quants WHERE product_id=$2) AS quantity`,[f.c.id,f.p.id]))[0];
}
async function preview(f:F,kind:"pos"|"invoice"){
  const body=kind==="pos"?f.pos:f.invoice;
  const response=await f.a.post(kind==="pos"?"/api/pos/tax-preview":"/api/sales/invoices/tax-preview").send(body);
  expect(response.status,JSON.stringify(response.body)).toBe(200);
  return {...body,taxContextToken:response.body.context.token,taxPreviewToken:response.body.previewToken};
}
describe("classic POS uses the original live seller authority and receipt",()=>{
  for(const mode of ["hidden","optional","required"])for(const granularity of ["invoice","line"]){
    it(`${mode}/${granularity}: original issue engine records the separate seller/cashier`,async()=>{
      const f=await fixture(),e=await sellerFixture(f,mode,granularity);
      const b=await preview(f,"pos");
      const fields=mode==="hidden"?{}:granularity==="line"
        ?{sellerEmployeeId:null,lineSellers:[{lineIndex:0,employeeId:e.id}]}:{sellerEmployeeId:e.id};
      if(mode==="required"){
        const before=await counts(f);
        expect((await f.a.post("/api/pos/orders").set("Idempotency-Key",randomUUID()).send(b)).status).toBe(422);
        expect(await counts(f)).toEqual(before);
      }
      const res=await f.a.post("/api/pos/orders").set("Idempotency-Key",randomUUID()).send({...b,...fields});
      expect(res.status,JSON.stringify(res.body)).toBe(201);
      expect(res.body.sellerAttribution).toHaveLength(1);
      expect(res.body.sellerAttribution[0].employeeId).toBe(mode==="hidden"?null:e.id);
      const identity=(await q(`SELECT issuer->'saleIdentity' AS identity FROM document_issuer_snapshots
        WHERE company_id=$1 AND document_kind='pos' AND document_id=$2`,[f.c.id,res.body.id]))[0].identity;
      expect(identity.cashier).toMatchObject({id:f.u.id,name:f.u.name});
      expect(identity.sellers[0]).toMatchObject({employeeId:mode==="hidden"?null:e.id,visible:mode!=="hidden"});
      expect((await q("SELECT user_id FROM employees WHERE id=$1",[e.id]))[0].user_id).toBeNull();
    });
  }
  it.each(["foreign-company","foreign-branch","revoked"])("rejects %s seller at execution without inventory or GL effects",async(kind)=>{
    const f=await fixture(),e=await sellerFixture(f,"required","line"),b=await preview(f,"pos");
    if(kind==="foreign-company"){
      const other=await fixture();
      await q("UPDATE employees SET company_id=$2,branch_id=$3 WHERE id=$1",[e.id,other.c.id,other.b.id]);
    }else if(kind==="foreign-branch"){
      const [other]=await db.insert(branchesTable).values({companyId:f.c.id,name:randomUUID(),nameAr:"فرع آخر",city:"اختبار"}).returning();
      await q("UPDATE sales_seller_eligibility SET branch_ids=$2 WHERE employee_id=$1",[e.id,JSON.stringify([other.id])]);
    }else await q("UPDATE sales_seller_eligibility SET enabled=false WHERE employee_id=$1",[e.id]);
    const before=await counts(f);
    const res=await f.a.post("/api/pos/orders").set("Idempotency-Key",randomUUID())
      .send({...b,lineSellers:[{lineIndex:0,employeeId:e.id}]});
    expect(res.status,JSON.stringify(res.body)).toBe(403);expect(await counts(f)).toEqual(before);
  });
  it("replays the same saved attribution after eligibility revocation without a second sale",async()=>{
    const f=await fixture(),e=await sellerFixture(f,"required","line"),key=randomUUID();
    const b={...await preview(f,"pos"),lineSellers:[{lineIndex:0,employeeId:e.id}]};
    const first=await f.a.post("/api/pos/orders").set("Idempotency-Key",key).send(b);
    expect(first.status,JSON.stringify(first.body)).toBe(201);
    const after=await counts(f);
    await q("UPDATE sales_seller_eligibility SET enabled=false WHERE employee_id=$1",[e.id]);
    await q("UPDATE employees SET name='اسم جديد بعد الإصدار' WHERE id=$1",[e.id]);
    const replay=await f.a.post("/api/pos/orders").set("Idempotency-Key",key).send(b);
    expect(replay.status).toBe(201);expect(replay.headers["idempotency-replayed"]).toBe("true");
    expect(replay.body.id).toBe(first.body.id);
    expect(replay.body.sellerAttribution).toEqual(first.body.sellerAttribution);
    expect(await counts(f)).toEqual(after);
    expect(Number((await q("SELECT count(*) AS count FROM invoice_seller_lines WHERE company_id=$1",[f.c.id]))[0].count)).toBe(1);
  });
});
describe("trusted tax previews on native issue services / isolated PostgreSQL",()=>{
  for(const kind of ["pos","invoice"] as const){
    it(`${kind}: preserves halala rounding and discount, rejects browser aggregate overrides`,async()=>{
      const f=await fixture();
      await q("UPDATE products SET price=.01 WHERE id=$1",[f.p.id]);
      const input=kind==="pos"?{...f.pos,items:[{productId:f.p.id,quantity:17,unitPrice:500}],discount:.01,total:99999,vat:99999}
        :{...f.invoice,lines:[{...f.invoice.lines[0],quantity:17,unitPrice:.01,taxRate:99}],orderDiscount:.01,total:99999,vat:99999};
      const quote=await f.a.post(kind==="pos"?"/api/pos/tax-preview":"/api/sales/invoices/tax-preview").send(input);
      expect(quote.status,JSON.stringify(quote.body)).toBe(200);
      expect(quote.body.totals).toMatchObject({subtotal:.15,discount:.01,vat:.02,total:.16});
      const issued=await f.a.post(kind==="pos"?"/api/pos/orders":"/api/sales/invoices")
        .set("Idempotency-Key",randomUUID()).send({...input,taxContextToken:quote.body.context.token,taxPreviewToken:quote.body.previewToken});
      expect(issued.status,JSON.stringify(issued.body)).toBe(201);
      const [invoice]=await q("SELECT subtotal,discount,vat,total FROM customer_invoices WHERE company_id=$1",[f.c.id]);
      expect(Object.fromEntries(Object.entries(invoice).map(([k,v])=>[k,Number(v)]))).toEqual({subtotal:.15,discount:.01,vat:.02,total:.16});
    });
    it.each(["execute","close"])(`${kind}: serializes %s first at the original PostgreSQL intent fence`,async(first)=>{
      const f=await fixture(),body=await preview(f,kind),key=randomUUID(),before=await counts(f);
      const path=kind==="pos"?"/pos/orders":"/sales/invoices";
      const close=kind==="pos"?"/api/pos/tax-preview/close-intent":"/api/sales/invoices/tax-preview/close-intent";
      const blocker=await pool.connect();
      try{
        await blocker.query("BEGIN");
        const lock=JSON.stringify([f.c.id,f.u.id,`POST:/api:${path}`,key]);
        await blocker.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[lock]);
        const [{pid}]=(await blocker.query("SELECT pg_backend_pid() AS pid")).rows;
        const execute=()=>f.a.post(`/api${path}`).set("Idempotency-Key",key).send(body).then(r=>r);
        const seal=()=>f.a.post(close).send({requestKey:key,body}).then(r=>r);
        const waitFor=async(n:number)=>{
          for(let i=0;i<100;i++){
            if((await q(`WITH RECURSIVE waiting AS (
              SELECT pid FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))
              UNION SELECT a.pid FROM pg_stat_activity a JOIN waiting w ON w.pid=ANY(pg_blocking_pids(a.pid))
            ) SELECT pid FROM waiting`,[pid])).length>=n)return;
            await new Promise(r=>setTimeout(r,20));
          }
          throw new Error("Expected real PostgreSQL financial fence was not reached");
        };
        const one=first==="execute"?execute():seal();await waitFor(1);
        const two=first==="execute"?seal():execute();await waitFor(2);
        await blocker.query("COMMIT");
        const results=await Promise.all([one,two]);
        expect(results[0]!.status,JSON.stringify(results[0]!.body)).toBe(first==="execute"?201:200);
        expect(results[1]!.status,JSON.stringify(results[1]!.body)).toBe(first==="execute"?200:409);
        expect((await counts(f)).invoices-before.invoices).toBe(first==="execute"?1:0);
        expect((await q("SELECT count(*)::int AS n FROM financial_requests WHERE company_id=$1 AND user_id=$2 AND request_key=$3",[f.c.id,f.u.id,key]))[0].n).toBe(1);
        console.info("[tax-preview-postgres-fence]",JSON.stringify({kind,first,blockerPid:pid,
          queuedRequests:2,statuses:results.map(r=>r.status),invoiceDelta:(await counts(f)).invoices-before.invoices,
          durableReceipts:1,originalOperation:`POST:/api:${path}`}));
      }finally{await blocker.query("ROLLBACK");blocker.release();}
    });
    it.each([
      ["not_registered",false,"standard",115,0],
      ["registered",true,"standard",115,15],
      ["registered",false,"standard",132.25,17.25],
      ["registered",true,"zero",115,0],
      ["registered",true,"exempt",115,0],
    ])(`${kind}: preview is side-effect-free and agrees with issue: %s/%s/%s`,async(status,inclusive,category,total,vat)=>{
      const f=await fixture(String(status),Boolean(inclusive),String(category)),before=await counts(f);
      const path=kind==="pos"?"/api/pos/orders":"/api/sales/invoices";
      const reviewed=await preview(f,kind);
      expect(await counts(f)).toEqual(before);
      const result=await f.a.post(path).set("Idempotency-Key",randomUUID()).send(reviewed);
      expect(result.status,JSON.stringify(result.body)).toBe(201);
      const invoice=(await q("SELECT total,vat AS tax_amount,subtotal,discount FROM customer_invoices WHERE company_id=$1",[f.c.id]))[0];
      expect(Number(invoice.total)).toBe(total);expect(Number(invoice.tax_amount)).toBe(vat);
      expect(Number((Number(invoice.subtotal)-Number(invoice.discount)+Number(invoice.tax_amount)).toFixed(2))).toBe(total);
      const unbalanced=await q(`SELECT e.id FROM journal_entries e JOIN journal_entry_lines l ON l.entry_id=e.id
        WHERE e.company_id=$1 GROUP BY e.id HAVING sum(l.debit-l.credit)<>0`,[f.c.id]);
      expect(unbalanced).toEqual([]);
      expect((await counts(f)).quantity).toBe(kind==="pos"?"19.0000":"20.0000");
    });
    it(`${kind}: rejects drift, seals original intent, and recovers one saved result after lost reply`,async()=>{
      const f=await fixture(),body=await preview(f,kind),before=await counts(f),key=randomUUID();
      const path=kind==="pos"?"/api/pos/orders":"/api/sales/invoices";
      const close=kind==="pos"?"/api/pos/tax-preview/close-intent":"/api/sales/invoices/tax-preview/close-intent";
      // Real server-side product/price drift, not a browser-supplied aggregate.
      if(kind==="pos")await q("UPDATE products SET price=230 WHERE id=$1",[f.p.id]);
      else (body as typeof f.invoice).lines[0]!.quantity=2;
      expect((await f.a.post(path).set("Idempotency-Key",key).send(body)).status).toBe(409);
      expect(await counts(f)).toEqual(before);
      const closed=await f.a.post(close).send({requestKey:key,body});
      expect(closed.status,JSON.stringify(closed.body)).toBe(200);
      expect(closed.body.state).toBe("closed_without_execution");
      expect((await f.a.post(path).set("Idempotency-Key",key).send(body)).status).toBe(409);
      const fresh=await preview(f,kind),freshKey=randomUUID();
      const first=await f.a.post(path).set("Idempotency-Key",freshKey).send(fresh);
      expect(first.status,JSON.stringify(first.body)).toBe(201);
      const after=await counts(f);
      // Pretend the response was lost: exact same identity/body, no repricing.
      const retry=await f.a.post(path).set("Idempotency-Key",freshKey).send(fresh);
      expect(retry.status).toBe(201);expect(retry.body.id).toBe(first.body.id);
      const recovery=await f.a.post(close).send({requestKey:freshKey,body:fresh});
      expect(recovery.status).toBe(200);expect(recovery.body.state).toBe("completed");
      expect(await counts(f)).toEqual(after);
    });
    it(`${kind}: rejects expired quotes and changed tax facts, preserves committed replay after expiry`,async()=>{
      const f=await fixture(),body=await preview(f,kind),before=await counts(f);
      const path=kind==="pos"?"/api/pos/orders":"/api/sales/invoices";
      const clock=vi.spyOn(Date,"now").mockReturnValue(Date.now()+300_001);
      try{expect((await f.a.post(path).set("Idempotency-Key",randomUUID()).send(body)).status).toBe(409);}
      finally{clock.mockRestore();}
      expect(await counts(f)).toEqual(before);
      const fresh=await preview(f,kind),key=randomUUID();
      const saved=await f.a.post(path).set("Idempotency-Key",key).send(fresh);
      expect(saved.status,JSON.stringify(saved.body)).toBe(201);
      const after=await counts(f);
      const late=vi.spyOn(Date,"now").mockReturnValue(Date.now()+300_001);
      try{expect((await f.a.post(path).set("Idempotency-Key",key).send(fresh)).status).toBe(201);}
      finally{late.mockRestore();}
      expect(await counts(f)).toEqual(after);
      const stale=await preview(f,kind);
      await q(`INSERT INTO company_tax_policy_versions(company_id,revision,request_id,request_hash,effective_from,status,
        vat_number,price_includes_vat,product_rules,service_rule,legacy_state,reason,created_by)
        SELECT company_id,revision+1,$2,'synthetic-tax-drift',effective_from,'not_registered',NULL,false,
        product_rules,service_rule,legacy_state,reason,created_by FROM company_tax_policy_versions
        WHERE company_id=$1 ORDER BY revision DESC LIMIT 1`,[f.c.id,randomUUID()]);
      expect((await f.a.post(path).set("Idempotency-Key",randomUUID()).send(stale)).status).toBe(409);
      expect(await counts(f)).toEqual(after);
    });
    it(`${kind}: rejects foreign company/branch and revoked authority without treating denial as nonexecution`,async()=>{
      const f=await fixture(),other=await fixture(),before=await counts(f),body=await preview(f,kind);
      const path=kind==="pos"?"/api/pos/orders":"/api/sales/invoices";
      const foreign=kind==="pos"?{...f.pos,sessionId:other.s.id}:{...f.invoice,branchId:other.b.id};
      const p=await f.a.post(kind==="pos"?"/api/pos/tax-preview":"/api/sales/invoices/tax-preview").send(foreign);
      expect([403,404]).toContain(p.status);
      await q("UPDATE user_companies SET role='auditor' WHERE company_id=$1 AND user_id=$2",[f.c.id,f.u.id]);
      expect((await f.a.post(path).set("Idempotency-Key",randomUUID()).send(body)).status).toBe(403);
      expect(await counts(f)).toEqual(before);
    });
  }
  it("preserves exact inclusive discount rule value in its original GL bucket",async()=>{
    const f=await fixture();
    const [rule]=await q(`INSERT INTO discount_rules(name,name_ar,kind,value,scope,reason_code,account_system_key)
      VALUES('Synthetic tax preview rule','اختبار قاعدة خصم','percent',10,'order','preview-only','sales_discount') RETURNING id`);
    try{
      const body=await preview(f,"invoice");
      const saved=await f.a.post("/api/sales/invoices").set("Idempotency-Key",randomUUID()).send(body);
      expect(saved.status,JSON.stringify(saved.body)).toBe(201);
      expect(Number(saved.body.discount)).toBe(10);
      expect(Number(saved.body.vat)).toBe(13.5);
      expect(Number(saved.body.total)).toBe(103.5);
    }finally{await q("DELETE FROM discount_rules WHERE id=$1",[rule.id]);}
  });
  it("binds expiration, session, actor, company, branch and every monetary fact without trusting a public checksum",()=>{
    const req={sessionID:"synthetic-session",session:{userId:1,companyId:1}} as unknown as Request;
    const facts={branchId:1,quantity:1,price:115,discount:5,context:{revision:1}};
    const {previewToken}=issueTaxPreview(req,"pos",facts,1_000_000);
    expect(()=>verifyTaxPreview(req,"pos",previewToken,facts,1_000_001)).not.toThrow();
    expect(()=>verifyTaxPreview(req,"pos",previewToken,facts,1_300_000)).toThrow();
    for(const altered of [{...facts,branchId:2},{...facts,quantity:2},{...facts,discount:6},{...facts,price:230},
      {...facts,context:{revision:2}}])
      expect(()=>verifyTaxPreview(req,"pos",previewToken,altered,1_000_001)).toThrow();
    for(const other of [{...req,sessionID:"other"},{...req,session:{userId:2,companyId:1}},
      {...req,session:{userId:1,companyId:2}}])
      expect(()=>verifyTaxPreview(other as Request,"pos",previewToken,facts,1_000_001)).toThrow();
    expect(()=>verifyTaxPreview(req,"invoice",previewToken,facts,1_000_001)).toThrow();
    expect(()=>verifyTaxPreview(req,"pos",previewToken+"x",facts,1_000_001)).toThrow();
  });
});
