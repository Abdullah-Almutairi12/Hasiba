import {beforeAll,describe,it,expect,vi} from "vitest";
import {randomUUID} from "node:crypto";
import {pool,db} from "@workspace/db";
import {ensureAdministrativePerson} from "../lib/administration-enrollment";
import {appointFirstPrimaryOwner} from "../lib/primary-system-owner";
import {posTemplateFixture,personInput,accepted as ok,type PosTemplateFixture,fixtureRows as rows} from "../test/pos-template-fixture";

let f:PosTemplateFixture,people:any[];
const base=["inventory.read"],approve="inventory.stocktake.approve",post="inventory.stocktake.post",self="inventory.stocktake.approve_self",count="inventory.stocktake.count";
async function configure(i:number,actions:string[],cap:string|null="100",extra:Record<string,unknown>={}){
  const p=(ok(await f.owner.get("/api/team/people")) as any[]).find(p=>p.personId===people[i].personId);
  people[i]=ok(await f.owner.put(`/api/team/people/${p.personId}/access`).send({
    expectedRevision:p.revision,suspended:false,person:{...personInput(p),deniedActions:[],grants:[{
      resource:"inventory",branchId:f.branches[1].id,warehouseIds:[f.warehouses[1].id],
      actions:[...base,...actions],amountLimit:cap,startsAt:new Date(Date.now()-3600000).toISOString(),
      endsAt:new Date(Date.now()+86400000).toISOString(),...extra}]},
  }));
}
function call(i:number,method:"get"|"post"|"patch",suffix:string){
  return f.actors[i][method](`/api/inventory/stock-takes${suffix?`/${suffix}`:""}`).set("X-Workspace-Responsibility",String(people[i].grants[0].id));
}
const close=(i:number,id:number)=>call(i,"post",`${id}/complete`).send({});
const review=(i:number,id:number,body:Record<string,unknown>={reason:"مراجعة فروق مصطنعة"})=>call(i,"post",`${id}/approve`).send(body);
async function open(){
  return ok(await f.owner.post("/api/inventory/stock-takes").send({warehouseId:f.warehouses[1].id}),201).id as number;
}
async function observe(id:number,delta=-1){
  const p=ok(await call(0,"post",`${id}/checkpoint`).send({productId:f.products[0].id}));
  ok(await call(0,"patch",`${id}/lines/${p.lineId}`).set("Idempotency-Key",randomUUID()).send({
    countedQty:p.expectedQty+delta,checkpointId:p.checkpointId,expectedRevision:p.expectedRevision}));
}
async function evidence(id:number){
  return {take:await rows("SELECT status,variance_review,closure_result FROM stock_takes WHERE id=$1",[id]),
    moves:await rows("SELECT id,quantity::text,unit_cost::text,journal_entry_id FROM stock_moves WHERE source_type='stocktake' AND source_id=$1 ORDER BY id",[id]),
    quants:await rows("SELECT quantity::text,avg_cost::text FROM stock_quants WHERE warehouse_id=$1 AND product_id=$2",[f.warehouses[1].id,f.products[0].id]),
    journals:await rows("SELECT id FROM journal_entries WHERE company_id=$1 ORDER BY id",[f.companies[0].id])};
}
async function policy(allowParticipant:boolean){
  const current=ok(await f.owner.get("/api/team/stocktake-policy"));
  return f.owner.put("/api/team/stocktake-policy").send({allowParticipant,revision:current.revision,
    reason:"سياسة تشغيل منشأة مصطنعة",proof:{currentPassword:f.password}});
}
beforeAll(async()=>{
  f=await posTemplateFixture();people=[...f.people];
  await configure(0,[count],null);await configure(1,[approve]);await configure(2,[post]);
});
describe("delegated native stocktake review, post and explicit company exception",()=>{
  it("defaults to independent reviewer, keeps count/read cost-blind, and approval itself has no stock/GL effect",async()=>{
    const id=await open();await observe(id);
    expect(ok(await f.owner.get("/api/team/stocktake-policy")).allowParticipant).toBe(false);
    ok(await review(0,id),403);ok(await close(0,id),403);ok(await close(2,id),409);
    const before=await evidence(id);
    ok(await review(1,id));
    const after=await evidence(id);
    expect(after.quants).toEqual(before.quants);expect(after.moves).toEqual(before.moves);expect(after.journals).toEqual(before.journals);
    ok(await close(1,id),403);ok(await close(2,id));
    const counter=ok(await call(0,"get",String(id)));
    expect(counter.varianceValue).toBeNull();
    const list=ok(await call(0,"get",""));
    expect(list.find((t:any)=>t.id===id)?.varianceReview).toBeUndefined();
    expect(counter.varianceReview).toBeUndefined();expect(counter.review).toEqual({approved:true,approvedBy:people[1].userId});
    expect(counter.lines.every((l:any)=>l.unitCost===undefined&&l.avgCost===undefined)).toBe(true);
  });
  it("binds equal-total recount revisions, current cost and policy revision; no old approval may post",async()=>{
    const id=await open();await observe(id);ok(await review(1,id));
    expect(ok(await call(1,"get",String(id))).varianceValue).toEqual({amount:"3",currency:"SAR"});
    await observe(id);ok(await close(2,id),409);
    ok(await review(1,id));
    await rows("UPDATE stock_quants SET avg_cost=avg_cost+1 WHERE warehouse_id=$1 AND product_id=$2",[f.warehouses[1].id,f.products[0].id]);
    ok(await close(2,id),409);
    await rows("UPDATE stock_quants SET avg_cost=avg_cost-1 WHERE warehouse_id=$1 AND product_id=$2",[f.warehouses[1].id,f.products[0].id]);
    ok(await policy(false));ok(await close(2,id),409);ok(await review(1,id));ok(await close(2,id));
  });
  it("enforces server-valued gross caps for reviewer and poster, period and current suspended/denied grants on an open login",async()=>{
    const id=await open();await observe(id);
    await configure(1,[approve],"1");ok(await review(1,id),403);
    await configure(1,[approve]);ok(await review(1,id));
    const p=(ok(await f.owner.get("/api/team/people")) as any[]).find(p=>p.personId===people[1].personId);
    ok(await f.owner.put(`/api/team/people/${p.personId}/access`).send({expectedRevision:p.revision,suspended:false,
      person:{...personInput(p),deniedActions:[approve]}}));
    const before=await evidence(id);ok(await close(2,id),403);expect(await evidence(id)).toEqual(before);
    await configure(1,[approve]);ok(await review(1,id));
    await configure(2,[post],"1");ok(await close(2,id),403);await configure(2,[post]);
    await rows(`UPDATE fiscal_periods SET status='closed' WHERE fiscal_year_id IN
      (SELECT id FROM fiscal_years WHERE company_id=$1)`,[f.companies[0].id]);
    expect((await close(2,id)).status).toBeGreaterThanOrEqual(400);
    expect((await evidence(id)).moves).toHaveLength(0);
    await rows(`UPDATE fiscal_periods SET status='open' WHERE fiscal_year_id IN
      (SELECT id FROM fiscal_years WHERE company_id=$1)`,[f.companies[0].id]);
    ok(await close(2,id));
  });
  it("enforces company, branch, warehouse, expired grants, and rejects client financial facts",async()=>{
    const id=await open();await observe(id);
    ok(await review(1,id,{reason:"طلب مزور",amount:"0",fingerprint:"x"}),400);
    await configure(1,[approve],"100",{warehouseIds:[f.extraWarehouse.id],branchId:f.branches[0].id});
    ok(await review(1,id),403);await configure(1,[approve]);
    const foreign=ok(await f.owner.post("/api/inventory/stock-takes").send({warehouseId:f.extraWarehouse.id}),201).id;
    ok(await review(1,foreign),403);
    await rows("UPDATE responsibility_grants SET ends_at=clock_timestamp()-interval '1 second' WHERE id=$1",[people[1].grants[0].id]);
    ok(await review(1,id),403);await configure(1,[approve]);
    const other=ok(await f.owner.post("/api/auth/switch-company").send({companyId:f.companies[1].id}));
    expect(other).toBeTruthy();
    expect((await f.owner.get(`/api/inventory/stock-takes/${id}`)).status).toBeGreaterThanOrEqual(400);
    ok(await f.owner.post("/api/auth/switch-company").send({companyId:f.companies[0].id}));
  });
  it("leaves count writers blocked by default, no owner/manager-name exception; enabling needs current identity and audit",async()=>{
    await configure(0,[count,approve,post,self]);
    const id=await open();await observe(id);
    ok(await review(0,id,{reason:"عد شخص واحد",proof:{currentPassword:f.password}}),403);
    const p=ok(await f.owner.get("/api/team/stocktake-policy"));
    ok(await f.owner.put("/api/team/stocktake-policy").send({allowParticipant:true,revision:p.revision,reason:"سياسة مصطنعة",proof:{currentPassword:"wrong"}}),401);
    expect(ok(await f.owner.get("/api/team/stocktake-policy")).allowParticipant).toBe(false);
    ok(await policy(true));
    ok(await review(0,id),403);
    await configure(0,[count,approve,post],null);
    ok(await review(0,id,{reason:"عد شخص واحد",proof:{currentPassword:f.password}}),403);
    await configure(0,[count,approve,post,self],null);
    ok(await review(0,id,{reason:"عد شخص واحد",proof:{currentPassword:f.password}}),403);
    await configure(0,[count,approve,post,self]);
    ok(await review(0,id,{reason:"عد شخص واحد",proof:{currentPassword:"wrong"}}),401);
    ok(await review(0,id,{reason:"عد شخص واحد",proof:{currentPassword:f.password}}));
    ok(await close(0,id));
    const audit=await rows(`SELECT details::jsonb AS d FROM audit_logs WHERE action='inventory.stocktake.closed'
      AND company_id=$1 AND (details::jsonb->>'takeId')::int=$2`,[f.companies[0].id,id]);
    expect(audit[0].d.independentOfCount).toBe(false);expect(audit[0].d.review.exception).toBe(true);
    expect(audit[0].d.review.identityConfirmed).toBe(true);expect(JSON.stringify(audit)).not.toContain(f.password);
    await configure(0,[count],null);ok(await policy(false));
  });
  it("a revoked exception stops an already approved session; missing historical actor can never use the exception",async()=>{
    ok(await policy(true));await configure(0,[count,approve,post,self]);
    const id=await open();await observe(id);
    ok(await review(0,id,{reason:"استثناء مصطنع",proof:{currentPassword:f.password}}));
    await configure(0,[count,approve,post]);
    ok(await close(0,id),403);
    await configure(0,[count,approve,post,self]);
    await rows("UPDATE stock_takes SET count_participation_incomplete=true WHERE id=$1",[id]);
    expect(ok(await review(0,id,{reason:"استثناء مصطنع",proof:{currentPassword:f.password}}),403).error).toContain("تاريخي");
    expect(ok(await close(0,id),403).error).toContain("تاريخي");
    expect((await evidence(id)).moves).toHaveLength(0);
    ok(await policy(false));await configure(0,[count],null);
  });
  it("concurrent execution and confirmed-result retry after grant removal create exactly one reconciliation, move and balanced native JE",async()=>{
    const id=await open();await observe(id);ok(await review(1,id));
    const before=await evidence(id);
    const results=await Promise.all([close(2,id),close(2,id),close(2,id)]);
    for(const r of results)expect(ok(r)).toEqual({adjustments:1});
    await configure(2,[],null);
    expect(ok(await close(2,id))).toEqual({adjustments:1}); // first confirmed response intentionally ignored
    const after=await evidence(id);
    expect(after.moves).toHaveLength(1);expect(after.journals.length-before.journals.length).toBe(1);
    expect(Number(after.quants[0].quantity)).toBe(Number(before.quants[0].quantity)-1);
    const balances=await rows("SELECT sum(debit)::text AS debit,sum(credit)::text AS credit FROM journal_entry_lines WHERE entry_id=$1",[after.moves[0].journal_entry_id]);
    expect(Number(balances[0].debit)).toBe(Number(balances[0].credit));
    const audit=await rows(`SELECT action FROM audit_logs WHERE company_id=$1 AND action LIKE 'inventory.stocktake.%'
      AND details::jsonb->>'takeId'=$2`,[f.companies[0].id,String(id)]);
    expect(audit.filter(a=>a.action==="inventory.stocktake.closed")).toHaveLength(1);
    expect(audit.filter(a=>a.action==="inventory.stocktake.reconciled")).toHaveLength(1);
    await configure(2,[post]);
  });
  it("rechecks reviewer expiry after waiting for the native stock lock, without a single financial write",async()=>{
    const expires=Date.now()+5000;
    await configure(1,[approve],"100",{endsAt:new Date(expires).toISOString()});
    const id=await open();await observe(id);ok(await review(1,id));
    const before=await evidence(id),lock=await pool.connect();
    let pending:Promise<any>|undefined;
    try{
      await lock.query("BEGIN");
      await lock.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[
        `${f.products[0].id}-${f.warehouses[1].id}-0-0`]);
      const [{pid}]=(await lock.query("SELECT pg_backend_pid() AS pid")).rows;
      pending=close(2,id).then(r=>r);
      await vi.waitFor(async()=>expect(Number((await rows(`SELECT count(*) n FROM pg_stat_activity
        WHERE $1=ANY(pg_blocking_pids(pid))`,[pid]))[0].n)).toBeGreaterThan(0),{timeout:5000,interval:20});
      // Let the clock expire the already-issued grant. Administrative changes
      // correctly wait on the writer fence; do not deadlock that fence with a
      // synthetic direct UPDATE while holding the native stock lock.
      await vi.waitFor(()=>expect(Date.now()).toBeGreaterThan(expires),{timeout:7000,interval:30});
      await lock.query("COMMIT");ok(await pending,403);expect(await evidence(id)).toEqual(before);
    }finally{await lock.query("ROLLBACK");lock.release();}
    await configure(1,[approve]);ok(await review(1,id));ok(await close(2,id));
  });
  it("does not give an ungranted legacy owner a count-participant exception merely because policy allows it",async()=>{
    ok(await policy(true));
    const id=await open(),p=ok(await f.owner.post(`/api/inventory/stock-takes/${id}/checkpoint`).send({productId:f.products[0].id}));
    ok(await f.owner.patch(`/api/inventory/stock-takes/${id}/lines/${p.lineId}`).set("Idempotency-Key",randomUUID())
      .send({countedQty:p.expectedQty,checkpointId:p.checkpointId,expectedRevision:p.expectedRevision}));
    ok(await f.owner.post(`/api/inventory/stock-takes/${id}/approve`).send({reason:"مالك بلا إذن استثناء",
      proof:{currentPassword:f.password}}),403);
    expect((await evidence(id)).moves).toHaveLength(0);ok(await policy(false));
  });
  it("reconciles native stock movement after approval without repeating that movement or treating it as a variance",async()=>{
    const id=await open();await observe(id);ok(await review(1,id));
    const before=await evidence(id);
    ok(await f.owner.post("/api/inventory/moves").set("Idempotency-Key",randomUUID()).send({
      productId:f.products[0].id,warehouseId:f.warehouses[1].id,kind:"issue",quantity:2}),201);
    ok(await close(2,id));
    const after=await evidence(id);
    expect(after.moves).toHaveLength(1);
    expect(Number(after.moves[0].quantity)).toBe(1);
    expect(Number(after.quants[0].quantity)).toBe(Number(before.quants[0].quantity)-3);
  });
  it("lets a primary subscriber owner operate alone only after explicit scoped grants, bounded exception and identity proof",async()=>{
    await appointFirstPrimaryOwner(f.companies[0].id,f.ownerUser.id);
    await db.transaction(tx=>ensureAdministrativePerson(tx,f.companies[0].id,f.ownerUser.id));
    const p=(ok(await f.owner.get("/api/team/people")) as any[]).find(p=>p.userId===f.ownerUser.id);
    const changed=ok(await f.owner.put(`/api/team/people/${p.personId}/access`).send({
      expectedRevision:p.revision,suspended:false,person:{...personInput(p),grants:[{
        resource:"inventory",branchId:f.branches[1].id,warehouseIds:[f.warehouses[1].id],
        actions:[...base,approve,post,self],amountLimit:"10",startsAt:null,endsAt:null}]}}));
    const header={"X-Workspace-Responsibility":String(changed.grants[0].id)};
    ok(await policy(true));const id=await open();
    const point=ok(await f.owner.post(`/api/inventory/stock-takes/${id}/checkpoint`).send({productId:f.products[0].id}));
    ok(await f.owner.patch(`/api/inventory/stock-takes/${id}/lines/${point.lineId}`).set("Idempotency-Key",randomUUID())
      .send({countedQty:point.expectedQty-1,checkpointId:point.checkpointId,expectedRevision:point.expectedRevision}));
    ok(await f.owner.post(`/api/inventory/stock-takes/${id}/approve`).send({
      reason:"مالك النظام بلا اختيار منحة صريحة",proof:{currentPassword:f.password}}),403);
    ok(await f.owner.post(`/api/inventory/stock-takes/${id}/approve`).set(header).send({
      reason:"تشغيل فردي بمنحة صريحة",proof:{currentPassword:f.password}}));
    ok(await f.owner.post(`/api/inventory/stock-takes/${id}/complete`).set(header).send({}));
    expect((await evidence(id)).moves).toHaveLength(1);
    ok(await policy(false));
  });
});
