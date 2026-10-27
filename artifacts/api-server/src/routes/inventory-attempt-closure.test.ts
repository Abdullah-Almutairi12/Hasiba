import {beforeAll,beforeEach,expect,it} from "vitest";
import {randomUUID} from "node:crypto";
import {db} from "@workspace/db";
import {sql} from "drizzle-orm";
import {posTemplateFixture,personInput,accepted as ok,fixtureRows as rows} from "../test/pos-template-fixture";
import {teamPeople,updateTeamPerson} from "../lib/team-store";
let f:Awaited<ReturnType<typeof posTemplateFixture>>,p:any,company:number,wh:number;
const all=["inventory.read","inventory.move.receipt","inventory.move.issue","inventory.transfer.send"];
async function access(deniedActions:string[]=[]){
 const current=(await teamPeople(company)).find(x=>x.userId===f.people[0].userId)!;
 await updateTeamPerson(company,f.ownerUser.id,current.personId,current.revision,{
  ...personInput(current),deniedActions,grants:[{resource:"inventory",branchId:f.branches[1].id,
   warehouseIds:[wh],actions:all,amountLimit:"500",startsAt:null,endsAt:null},
  {resource:"inventory",branchId:f.branches[0].id,warehouseIds:[f.warehouses[0].id],
   actions:all,amountLimit:"500",startsAt:null,endsAt:null}]},false);
 p=(await teamPeople(company)).find(x=>x.userId===f.people[0].userId)!;
}
const body=(qty=1)=>({kind:"issue",productId:f.products[0].id,warehouseId:wh,quantity:qty,notes:"محاولة معزولة"});
const headers=(key:string)=>({"Idempotency-Key":key,"X-Workspace-Responsibility":String(p.grants.find((g:any)=>g.branchId===f.branches[1].id).id)});
const send=(b:any,key:string)=>f.actors[0].post(`/api/inventory/${b.fromWarehouseId?"transfers":"moves"}`).set(headers(key)).send(b);
const close=(b:any,key:string)=>f.actors[0].post("/api/workspace/inventory/movement-attempts/close")
 .set(headers(key)).send({transfer:!!b.fromWarehouseId,body:b});
async function proof(key:string){
 const [r]=await rows(`SELECT
 (SELECT count(*)::int FROM stock_moves WHERE product_id IN(SELECT id FROM products WHERE company_id=$1) AND source_ref=$2) AS moves,
 (SELECT count(*)::int FROM financial_requests WHERE company_id=$1 AND user_id=$3 AND request_key=$4) AS receipts,
 (SELECT count(*)::int FROM audit_logs WHERE company_id=$1 AND action='inventory.movement.attempt.closed'
  AND details::jsonb->>'requestKey'=$4) AS closures`,[company,`SCOPED-${key}`,p.userId,key]);
 const [balance]=await rows(`SELECT
 (SELECT coalesce(sum(quantity*avg_cost),0) FROM stock_quants WHERE product_id=$1)::numeric AS physical,
 (SELECT coalesce(sum(quantity*unit_cost),0) FROM stock_moves WHERE product_id=$1 AND state='in_transit')::numeric AS transit,
 (SELECT coalesce(sum(remaining_qty*unit_cost),0) FROM stock_layers WHERE product_id=$1)::numeric AS layers,
 (SELECT coalesce(sum(l.debit-l.credit),0) FROM journal_entry_lines l JOIN accounts a ON a.id=l.account_id
 WHERE a.system_key='inventory' AND l.entry_id IN(SELECT journal_entry_id FROM stock_moves WHERE product_id=$1))::numeric AS ledger`,
 [f.products[0].id]);
 expect(Number(balance.physical)+Number(balance.transit)).toBeCloseTo(Number(balance.ledger),8);
 expect(Number(balance.layers)).toBeCloseTo(Number(balance.physical),8);
 expect(await rows(`SELECT l.entry_id FROM journal_entry_lines l JOIN journal_entries j ON j.id=l.entry_id
 WHERE j.company_id=$1 GROUP BY l.entry_id HAVING sum(l.debit)<>sum(l.credit)`,[company])).toEqual([]);
 return r;
}
async function blocked(n:number){
 for(let i=0;i<150;i++){
  const [r]=await rows("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event='advisory'");
  if(r.n>=n)return;await new Promise(r=>setTimeout(r,20));
 }throw new Error("Financial intent barrier not reached");
}
beforeAll(async()=>{f=await posTemplateFixture();company=f.companies[0].id;wh=f.warehouses[1].id;
 ok(await f.actors[0].post("/api/auth/switch-company").send({companyId:company}));});
beforeEach(async()=>{await access();});
it("seals a real insufficient-stock rollback, audits once, blocks late replay and permits a corrected new identity",async()=>{
 const key=randomUUID(),b=body(999);
 expect((await send(b,key)).status).toBe(400);
 expect(await proof(key)).toMatchObject({moves:0,receipts:0,closures:0});
 expect(ok(await close(b,key))).toEqual({state:"closed_without_execution",requestKey:key});
 expect(ok(await close(b,key))).toMatchObject({state:"closed_without_execution"});
 expect((await send(b,key)).status).toBe(409);
 expect((await send(body(1),key)).status).toBe(409);
 expect(await proof(key)).toEqual({moves:0,receipts:1,closures:1});
 const fresh=randomUUID();ok(await send(body(1),fresh),201);
 expect(await proof(fresh)).toEqual({moves:1,receipts:1,closures:0});
});
it("recovers exact committed evidence after response loss and execution revocation without closing or executing twice",async()=>{
 const key=randomUUID(),b=body(1),result=ok(await send(b,key),201);
 expect(await proof(key)).toMatchObject({moves:1,receipts:1});
 await access(["inventory.move.issue"]);
 expect(ok(await close(b,key))).toEqual({state:"completed",requestKey:key,...result});
 expect(ok(await send(b,key),201)).toEqual(result);
 expect(await proof(key)).toEqual({moves:1,receipts:1,closures:0});
 expect((await send({...b,notes:"جسم مختلف"},key)).status).toBe(409);
 expect((await close({...b,quantity:2},key)).status).toBe(409);
});
it("never treats withdrawn read authority or a foreign source as proof of nonexecution",async()=>{
 const key=randomUUID(),b=body();await access(["inventory.read"]);
 expect((await close(b,key)).status).toBe(403);
 expect(await proof(key)).toMatchObject({moves:0,receipts:0,closures:0});
 await access();
 expect((await close({...b,productId:f.products[1].id},key)).status).toBe(403);
 expect((await close({...b,warehouseId:f.warehouses[2].id},key)).status).toBe(403);
 expect((await close({...b,warehouseId:f.extraWarehouse.id},key)).status).toBe(403);
 expect(ok(await close(b,key))).toMatchObject({state:"closed_without_execution"});
 expect(await proof(key)).toEqual({moves:0,receipts:1,closures:1});
});
for(const first of ["execute","close"] as const)it(`serializes ${first} before its concurrent peer under the ORIGINAL lock`,async()=>{
 const key=randomUUID(),b=body();let release!:()=>void,ready!:()=>void;
 const started=new Promise<void>(r=>ready=r),held=new Promise<void>(r=>release=r);
 const barrier=db.transaction(async tx=>{
  const lock=JSON.stringify([company,p.userId,"POST:/api:/inventory/moves",key]);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lock},0))`);ready();await held;
 });
 await started;
 const one=(first==="execute"?send(b,key):close(b,key)).then(r=>r);
 let two:Promise<any>;
 try{await blocked(1);two=(first==="execute"?close(b,key):send(b,key)).then(r=>r);await blocked(2);}
 finally{release();}
 await barrier;
 const a=await one,c=await two!;
 const execution=first==="execute"?a:c,closure=first==="close"?a:c;
 expect(closure.status).toBe(200);
 if(first==="execute"){
  expect(execution.status).toBe(201);expect(closure.body.state).toBe("completed");
  expect(await proof(key)).toEqual({moves:1,receipts:1,closures:0});
 }else{
  expect(execution.status).toBe(409);expect(closure.body.state).toBe("closed_without_execution");
  expect(await proof(key)).toEqual({moves:0,receipts:1,closures:1});
 }
});
it("rechecks current read authority after waiting for the original lock",async()=>{
 const key=randomUUID(),b=body();let release!:()=>void,ready!:()=>void;
 const started=new Promise<void>(r=>ready=r),held=new Promise<void>(r=>release=r);
 const barrier=db.transaction(async tx=>{const lock=JSON.stringify([company,p.userId,"POST:/api:/inventory/moves",key]);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lock},0))`);ready();await held;});
 await started;const request=close(b,key).then(r=>r);
 try{await blocked(1);await access(["inventory.read"]);}finally{release();}
 await barrier;expect((await request).status).toBe(403);
 expect(await proof(key)).toEqual({moves:0,receipts:0,closures:0});
});
it("uses the original transfer namespace and sanitizes a completed in-transit group",async()=>{
 const key=randomUUID(),b={productId:f.products[0].id,fromWarehouseId:wh,toWarehouseId:f.warehouses[0].id,
  destinationResponsibilityId:p.grants.find((g:any)=>g.branchId===f.branches[0].id).id,quantity:1,notes:"تحويل معزول"};
 const result=ok(await send(b,key),201);
 expect(ok(await close(b,key))).toEqual({state:"completed",requestKey:key,...result});
 expect(await proof(key)).toEqual({moves:1,receipts:1,closures:0});
});
