import {describe,it,expect} from "vitest";
import {randomUUID} from "node:crypto";
import {accepted as ok,posTemplateFixture,fixtureRows as rows} from "../test/pos-template-fixture";

async function fixture(){
  const f=await posTemplateFixture();
  const session=ok(await f.owner.post("/api/pos/sessions").set("Idempotency-Key",randomUUID()).send({
    branchId:f.branches[0].id,cashierName:"مالك الاختبار",openingCash:100}),201);
  const park=ok(await f.owner.post("/api/pos/orders/park").set("Idempotency-Key",randomUUID()).send({
    sessionId:session.id,items:[{productId:f.products[0].id,quantity:1}],subtotal:10,total:10,label:"مسودة اختبار التحصيل"}),201);
  const requestId=randomUUID();
  const resume=()=>f.owner.post(`/api/pos/orders/${park.id}/resume`).set("Idempotency-Key",requestId).send({sessionId:session.id});
  ok(await resume());
  return {...f,session,park,resume,source:{id:park.id,sessionId:session.id,requestId}};
}
const sale=(f:Awaited<ReturnType<typeof fixture>>,patch:object={},key=randomUUID())=>
  f.owner.post("/api/pos/orders").set("Idempotency-Key",key).send({
    sessionId:f.session.id,items:[{productId:f.products[0].id,quantity:1}],paymentMethod:"cash",
    resumedDraft:f.source,...patch});

describe("resumed basket single final sale on PostgreSQL",()=>{
  it("rejects binding a recovered source to another open shift without any effects",async()=>{
    const f=await fixture();
    const other=ok(await f.owner.post("/api/pos/sessions").set("Idempotency-Key",randomUUID()).send({
      branchId:f.branches[0].id,cashierName:"مالك الاختبار",openingCash:0}),201);
    const before=await rows("SELECT quantity::text FROM stock_quants WHERE product_id=$1 AND warehouse_id=$2",[f.products[0].id,f.warehouses[0].id]);
    expect(ok(await f.owner.post(`/api/pos/orders/${f.source.id}/resumed-sale`).send({
      sessionId:f.source.sessionId,requestId:f.source.requestId})).state).toBe("not_finalized");
    ok(await sale(f,{sessionId:other.id}),409);
    expect(await rows("SELECT quantity::text FROM stock_quants WHERE product_id=$1 AND warehouse_id=$2",[f.products[0].id,f.warehouses[0].id])).toEqual(before);
    expect(await rows("SELECT id FROM customer_invoices WHERE company_id=$1",[f.companies[0].id])).toHaveLength(0);
  });
  it("same resume key in cloned tabs and different concurrent payment keys yield one sale; identical independent sale remains legitimate",async()=>{
    const f=await fixture();
    const replay=ok(await f.resume());expect(replay.id).toBe(f.park.id);
    const aKey=randomUUID(),bKey=randomUUID();
    const [a,b]=await Promise.all([sale(f,{},aKey),sale(f,{},bKey)]);
    const first=ok(a,201),second=ok(b,201);
    expect(second.id).toBe(first.id);
    expect([first.alreadyFinalized,second.alreadyFinalized]).toContain(true);
    expect(ok(await sale(f,{},aKey),201).id).toBe(first.id);
    const evidence=(await rows(`SELECT
      (SELECT count(*)::int FROM pos_orders WHERE company_id=$1 AND status='paid') sales,
      (SELECT count(*)::int FROM customer_invoices WHERE company_id=$1) invoices,
      (SELECT count(*)::int FROM pos_order_payments p JOIN pos_orders o ON o.id=p.order_id WHERE o.company_id=$1) payments,
      (SELECT quantity::text FROM stock_quants WHERE product_id=$2 AND warehouse_id=$3) quantity,
      (SELECT count(*)::int FROM stock_moves WHERE product_id=$2 AND kind='issue') issues,
      (SELECT count(*)::int FROM journal_entries j WHERE j.company_id=$1 AND
        (SELECT coalesce(sum(l.debit-l.credit),0) FROM journal_entry_lines l WHERE l.entry_id=j.id)<>0) unbalanced`,
      [f.companies[0].id,f.products[0].id,f.warehouses[0].id]))[0];
    expect(evidence).toEqual({sales:1,invoices:1,payments:1,quantity:"19.0000",issues:1,unbalanced:0});
    const independent=ok(await sale(f,{resumedDraft:undefined}),201);
    expect(independent.id).not.toBe(first.id);
    expect((await rows("SELECT quantity::text FROM stock_quants WHERE product_id=$1 AND warehouse_id=$2",[f.products[0].id,f.warehouses[0].id]))[0].quantity).toBe("18.0000");
  });
  it("recovers a committed final sale even after source closure; never reopens or charges the replacement shift",async()=>{
    const f=await fixture(),paid=ok(await sale(f),201);
    await rows("UPDATE pos_sessions SET status='closed' WHERE id=$1 RETURNING id",[f.session.id]);
    const other=ok(await f.owner.post("/api/pos/sessions").set("Idempotency-Key",randomUUID()).send({
      branchId:f.branches[0].id,cashierName:"مالك الاختبار",openingCash:0}),201);
    const lookup=ok(await f.owner.post(`/api/pos/orders/${f.source.id}/resumed-sale`).send({
      sessionId:f.source.sessionId,requestId:f.source.requestId}));
    expect(lookup.state).toBe("completed");expect(lookup.order.id).toBe(paid.id);
    expect(ok(await sale(f),201).id).toBe(paid.id);
    ok(await sale(f,{sessionId:other.id}),409);
    expect(await rows("SELECT id FROM pos_orders WHERE session_id=$1",[other.id])).toHaveLength(0);
    expect((await rows("SELECT status FROM pos_sessions WHERE id=$1",[f.session.id]))[0].status).toBe("closed");
  });
  it("cannot forge the resume identity or use another company's draft proof",async()=>{
    const f=await fixture();
    ok(await sale(f,{resumedDraft:{...f.source,requestId:randomUUID()}}),409);
    const impostor=f.actors[1];
    const response=await impostor.post("/api/pos/orders").set("X-Workspace-Responsibility",String(f.people[1].grants[0].id))
      .set("Idempotency-Key",randomUUID()).send({sessionId:f.session.id,items:[{productId:f.products[0].id,quantity:1}],paymentMethod:"cash",resumedDraft:f.source});
    expect([403,409]).toContain(response.status);
    const foreign=await posTemplateFixture();
    ok(await foreign.owner.post(`/api/pos/orders/${f.source.id}/resumed-sale`).send({
      sessionId:f.source.sessionId,requestId:f.source.requestId}),403);
    expect(await rows("SELECT id FROM customer_invoices WHERE company_id=$1",[f.companies[0].id])).toHaveLength(0);
  });
});
