import {describe,it,expect} from "vitest";
import {randomUUID} from "node:crypto";
import {pool} from "@workspace/db";
import {accepted as ok,posTemplateFixture,fixtureRows as rows} from "../test/pos-template-fixture";

async function fixture(){
  const f=await posTemplateFixture(),companyId=f.companies[0].id;
  const customers=await rows("INSERT INTO customers(company_id,name) VALUES($1,'أ'),($1,'ب') RETURNING id",[companyId]);
  const shift=ok(await f.owner.post("/api/pos/sessions").set("Idempotency-Key",randomUUID()).send({
    branchId:f.branches[0].id,cashierName:"اختبار النسخ",openingCash:100}),201);
  const parked=ok(await f.owner.post("/api/pos/orders/park").set("Idempotency-Key",randomUUID()).send({
    sessionId:shift.id,customerId:customers[0].id,items:[{productId:f.products[0].id,quantity:2}],subtotal:20,total:20}),201);
  const source={id:parked.id,sessionId:shift.id,requestId:randomUUID(),version:0};
  ok(await f.owner.post(`/api/pos/orders/${source.id}/resume`).set("Idempotency-Key",source.requestId).send({sessionId:shift.id}));
  const initial={items:[{productId:f.products[0].id,quantity:2}],customerId:customers[0].id};
  const latest={items:[{productId:f.products[0].id,quantity:3}],customerId:customers[1].id};
  const edit=(version=0,body=latest,key=randomUUID())=>f.owner.post(`/api/pos/orders/${source.id}/resumed-basket`)
    .set("Idempotency-Key",key).send({...source,version,action:"save",...body});
  const sale=(version=0,body=initial,key=randomUUID())=>f.owner.post("/api/pos/orders")
    .set("Idempotency-Key",key).send({sessionId:shift.id,paymentMethod:"cash",resumedDraft:{...source,version},...body});
  const evidence=async()=> (await rows(`SELECT
    (SELECT count(*)::int FROM customer_invoices WHERE company_id=$1) invoices,
    (SELECT count(*)::int FROM pos_order_payments p JOIN pos_orders o ON o.id=p.order_id WHERE o.company_id=$1) payments,
    (SELECT count(*)::int FROM stock_moves WHERE product_id IN(SELECT id FROM products WHERE company_id=$1) AND kind='issue') issues`,
    [companyId]))[0];
  return {...f,companyId,source,initial,latest,edit,sale,evidence};
}
describe("server-confirmed resumed basket revisions on PostgreSQL",()=>{
  for(const savedFirst of [false,true])it(`reconciles the exact edit after source closure; saved first=${savedFirst}`,async()=>{
    const f=await fixture(),key=randomUUID();
    const body={...f.source,action:"save",...f.latest};
    const resolve=()=>f.owner.post(`/api/pos/orders/${f.source.id}/resumed-basket/resolve`).send({requestKey:key,body});
    if(savedFirst)expect(ok(await f.edit(0,f.latest,key)).version).toBe(1);
    // Isolated state transition only; the browser exercises the native shift close.
    await rows("UPDATE pos_sessions SET status='closed',closed_at=now() WHERE id=$1",[f.source.sessionId]);
    if(!savedFirst)ok(await f.edit(0,f.latest,key),409);
    const outcome=ok(await resolve());
    expect(outcome.state).toBe(savedFirst?"current":"closed_without_execution");
    if(savedFirst){
      expect(outcome.cart[0].quantity).toBe(3);expect(outcome.customer.id).toBe(f.latest.customerId);
    }
    expect(ok(await resolve())).toEqual(outcome); // Lost resolution reply is recoverable.
    const late=await f.edit(0,f.latest,key);
    if(savedFirst)expect(ok(late).version).toBe(1);
    else ok(late,409); // A late original request is permanently fenced.
    expect(await f.evidence()).toEqual({invoices:0,payments:0,issues:0});
    const next=ok(await f.owner.post("/api/pos/sessions").set("Idempotency-Key",randomUUID()).send({
      branchId:f.branches[0].id,cashierName:"وردية جديدة",openingCash:100}),201);
    const payKey=randomUUID(),pay=()=>f.owner.post("/api/pos/orders").set("Idempotency-Key",payKey).send({
      sessionId:next.id,paymentMethod:"cash",...f.latest});
    const paid=ok(await pay(),201);expect(ok(await pay(),201).id).toBe(paid.id);
    expect(paid.sessionId).toBe(next.id);
    expect(await f.evidence()).toEqual({invoices:1,payments:1,issues:1});
    expect((await rows("SELECT count(*)::int n FROM pos_orders WHERE session_id=$1 AND status='paid'",[f.source.sessionId]))[0].n).toBe(0);
  });
  for(const first of ["save","resolve"] as const)it(`serializes edit resolution and original save: ${first} first`,async()=>{
    const f=await fixture(),key=randomUUID();
    const body={...f.source,action:"save",...f.latest};
    const lock=JSON.stringify([f.companyId,f.ownerUser.id,"POST:/api:/pos/orders/:id/resumed-basket",key]);
    const blocker=await pool.connect();
    const wait=async(n:number)=>{
      for(let i=0;i<150;i++){
        if((await rows("SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND wait_event='advisory'"))[0].n>=n)return;
        await new Promise(r=>setTimeout(r,20));
      }throw Error("Expected real PostgreSQL intent waiters");
    };
    const resolve=()=>f.owner.post(`/api/pos/orders/${f.source.id}/resumed-basket/resolve`).send({requestKey:key,body});
    let a:Promise<any>|undefined,b:Promise<any>|undefined;
    try{
      await blocker.query("SELECT pg_advisory_lock(hashtextextended($1,0))",[lock]);
      a=(first==="save"?f.edit(0,f.latest,key):resolve()).then(r=>r);await wait(1);
      b=(first==="save"?resolve():f.edit(0,f.latest,key)).then(r=>r);await wait(2);
    }finally{await blocker.query("SELECT pg_advisory_unlock(hashtextextended($1,0))",[lock]);blocker.release();}
    const [one,two]=await Promise.all([a!,b!]);
    if(first==="save"){expect(ok(one).state).toBe("current");expect(ok(two)).toEqual(one.body);}
    else{expect(ok(one).state).toBe("closed_without_execution");ok(two,409);}
    expect(await f.evidence()).toEqual({invoices:0,payments:0,issues:0});
  });
  it("rejects stale payment FIRST and stale edits, then invoices exactly the reviewed 3/B revision once",async()=>{
    const f=await fixture(),key=randomUUID();
    expect(ok(await f.edit(0,f.latest,key)).version).toBe(1);
    expect(ok(await f.edit(0,f.latest,key)).version).toBe(1);
    ok(await f.edit(0,f.initial,key),409);
    expect(ok(await f.edit(0,f.initial)).state).toBe("conflict");
    ok(await f.sale(),409);
    ok(await f.sale(1,f.initial),409); // Guessing the revision cannot authorize different contents.
    expect(await f.evidence()).toEqual({invoices:0,payments:0,issues:0});
    const payKey=randomUUID(),paid=ok(await f.sale(1,f.latest,payKey),201);
    expect(paid.customerId).toBe(f.latest.customerId);expect(paid.items[0].quantity).toBe(3);
    expect(ok(await f.sale(1,f.latest,payKey),201).id).toBe(paid.id);
    expect(ok(await f.sale(),201).id).toBe(paid.id);
    expect(await f.evidence()).toEqual({invoices:1,payments:1,issues:1});
    expect((await rows("SELECT quantity::text FROM stock_quants WHERE product_id=$1 AND warehouse_id=$2",
      [f.products[0].id,f.warehouses[0].id]))[0].quantity).toBe("17.0000");
    expect((await rows(`SELECT count(*)::int n FROM journal_entries j WHERE company_id=$1
      AND (SELECT coalesce(sum(debit-credit),0) FROM journal_entry_lines WHERE entry_id=j.id)<>0`,[f.companyId]))[0].n).toBe(0);
    expect((await rows("SELECT customer_id FROM customer_invoices WHERE company_id=$1",[f.companyId]))[0].customer_id).toBe(f.latest.customerId);
    // Same contents without this source are a legitimate independent sale.
    ok(await f.owner.post("/api/pos/orders").set("Idempotency-Key",randomUUID()).send({
      sessionId:f.source.sessionId,paymentMethod:"cash",...f.latest}),201);
    expect(await f.evidence()).toEqual({invoices:2,payments:2,issues:2});
  });
  for(const first of ["edit","sale"] as const)it(`real PostgreSQL source barrier: ${first} reaches the source lock first`,async()=>{
    const f=await fixture(),blocker=await pool.connect();
    const lock=JSON.stringify(["pos-resumed-sale",f.companyId,f.source.id]);
    const waiting=async(n:number)=>{
      for(let i=0;i<100;i++){
        const r=await rows("SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND wait_event='advisory' AND query LIKE '%pg_advisory_xact_lock%'");
        if(r[0].n>=n)return;
        await new Promise(r=>setTimeout(r,20));
      }
      throw Error(`Expected ${n} native PostgreSQL lock waiters`);
    };
    let a:Promise<any>|undefined,b:Promise<any>|undefined;
    try{
      await blocker.query("SELECT pg_advisory_lock(hashtextextended($1,0))",[lock]);
      a=(first==="edit"?f.edit():f.sale()).then(r=>r);await waiting(1);
      b=(first==="edit"?f.sale():f.edit()).then(r=>r);await waiting(2);
    }finally{await blocker.query("SELECT pg_advisory_unlock(hashtextextended($1,0))",[lock]);blocker.release();}
    const [one,two]=await Promise.all([a!,b!]);
    if(first==="edit"){
      expect(ok(one).state).toBe("current");ok(two,409);
      expect(await f.evidence()).toEqual({invoices:0,payments:0,issues:0});
      ok(await f.sale(1,f.latest),201);
    }else{
      const paid=ok(one,201);expect(ok(two).state).toBe("completed");
      expect(two.body.order.id).toBe(paid.id);
      const invoice=(await rows("SELECT customer_id,total::text FROM customer_invoices WHERE company_id=$1",[f.companyId]))[0];
      expect(invoice.customer_id).toBe(f.initial.customerId);expect(invoice.total).toBe("20.00");
      expect(ok(await f.sale(1,f.latest),201).id).toBe(paid.id);
    }
    expect(await f.evidence()).toEqual({invoices:1,payments:1,issues:1});
  });
});
