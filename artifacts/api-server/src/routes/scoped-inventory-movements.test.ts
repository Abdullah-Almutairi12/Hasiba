import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import {randomUUID} from "node:crypto";
import {db,pool,companiesTable,usersTable,userCompaniesTable,branchesTable,warehousesTable,categoriesTable,
 productsTable,fiscalYearsTable,fiscalPeriodsTable} from "@workspace/db";
import app,{assertApplicationReady} from "../app";

const tag=`moves-${randomUUID()}`,password="Synthetic movement login phrase 2026!";
let company:number,otherCompany:number,branch:number,otherBranch:number,warehouse:number,destination:number,foreignWh:number,product:number,foreignProduct:number;
let owner:request.Agent,ownerId:number;
const ok=(r:request.Response,status=200)=>{expect(r.status,JSON.stringify(r.body)).toBe(status);return r.body;};
const rows=async(q:string,v:unknown[]=[])=> (await pool.query(q,v)).rows;
const actions=["inventory.read","inventory.move.receipt","inventory.move.issue","inventory.transfer.send"];
const grant=(wh=warehouse,b=branch,a=actions,limit:string|null=null)=>({
 resource:"inventory",branchId:b,warehouseIds:[wh],actions:a,amountLimit:limit,startsAt:null,endsAt:null,
});
async function member(a=actions,limit:string|null=null,pair=false){
 const input={creationKey:randomUUID(),name:"مخزون مفوض مصطنع",email:`${randomUUID()}@example.invalid`,loginKinds:["platform"],
  grants:[grant(warehouse,branch,a,limit),...(pair?[grant(destination,otherBranch,a,limit)]:[])],deniedActions:[]};
 const person=ok(await owner.post("/api/team/people").send(input),201);
 const invite=ok(await owner.post(`/api/team/people/${person.personId}/invite`).send({expectedRevision:person.revision}),201);
 ok(await request(app).post("/api/auth/team-activation/accept").send({token:invite.activationToken,password}));
 const agent=request.agent(app);ok(await agent.post("/api/auth/login").send({email:input.email,password}));
 const access=ok(await agent.get("/api/workspace/access"));
 return {agent,person,grants:access.grants as {id:number;branchId:number}[]};
}
type Actor=Awaited<ReturnType<typeof member>>;
const payload=(kind="issue")=>({kind,productId:product,warehouseId:warehouse,quantity:2,notes:"مرجع مخزون مصطنع"});
const send=(a:Actor,body=payload(),key=randomUUID(),path="moves")=>a.agent.post(`/api/inventory/${path}`)
 .set("X-Workspace-Responsibility",String(a.grants[0].id)).set("Idempotency-Key",key).send(body);
const transferBody=(a:Actor)=>({productId:product,quantity:2,fromWarehouseId:warehouse,toWarehouseId:destination,
 destinationResponsibilityId:a.grants.find(g=>g.branchId===otherBranch)?.id,notes:"تحويل مستقل مصطنع"});
async function snapshot(){
 return {quants:await rows("SELECT warehouse_id,quantity::text,avg_cost::text FROM stock_quants WHERE product_id=$1 ORDER BY warehouse_id",[product]),
  moves:await rows("SELECT id,state,quantity::text,unit_cost::text FROM stock_moves WHERE product_id=$1 ORDER BY id",[product]),
  journals:await rows("SELECT j.id,sum(l.debit)::text AS total_debit,sum(l.credit)::text AS total_credit FROM journal_entries j JOIN journal_entry_lines l ON l.entry_id=j.id WHERE j.company_id=$1 GROUP BY j.id ORDER BY j.id",[company]),
  audits:await rows("SELECT id FROM audit_logs WHERE company_id=$1 AND action LIKE 'inventory.%' ORDER BY id",[company])};
}
beforeAll(async()=>{
 await assertApplicationReady();
 const cs=await db.insert(companiesTable).values([{name:tag,vatRegistrationStatus:"not_registered"},{name:tag+"-other",vatRegistrationStatus:"not_registered"}]).returning();
 [company,otherCompany]=cs.map(c=>c.id);
 const [u]=await db.insert(usersTable).values({name:"مالك مصطنع",email:`${tag}@example.invalid`,passwordHash:bcrypt.hashSync(password,4),role:"owner",isActive:true}).returning();
 ownerId=u.id;
 await db.insert(userCompaniesTable).values({userId:u.id,companyId:company,role:"owner",isDefault:true});
 owner=request.agent(app);ok(await owner.post("/api/auth/login").send({email:u.email,password}));
 const bs=await db.insert(branchesTable).values([company,company,otherCompany].map((companyId,i)=>({companyId,name:tag+i,nameAr:`فرع مصطنع ${i}`,city:"الرياض"}))).returning();
 [branch,otherBranch]=bs.map(b=>b.id);
 const ws=await db.insert(warehousesTable).values(bs.map((b,i)=>({companyId:b.companyId,branchId:b.id,name:tag+i,nameAr:`مستودع مصطنع ${i}`}))).returning();
 [warehouse,destination,foreignWh]=ws.map(w=>w.id);
 const [cat]=await db.insert(categoriesTable).values({name:tag,nameAr:tag}).returning();
 const ps=await db.insert(productsTable).values([company,otherCompany].map((companyId,i)=>({companyId,name:tag+i,nameAr:`صنف حركة ${i}`,sku:tag+i,
  categoryId:cat.id,price:"50",costPrice:"7",stock:"200",unit:"pcs",minStock:0}))).returning();
 [product,foreignProduct]=ps.map(p=>p.id);
 await pool.query("INSERT INTO stock_quants(warehouse_id,product_id,quantity,avg_cost) VALUES($1,$2,200,7)",[warehouse,product]);
 const year=new Date().getUTCFullYear();
 const [fy]=await db.insert(fiscalYearsTable).values({companyId:company,name:tag,startDate:`${year}-01-01`,endDate:`${year}-12-31`}).returning();
 await db.insert(fiscalPeriodsTable).values({fiscalYearId:fy.id,name:tag,startDate:`${year}-01-01`,endDate:`${year}-12-31`,status:"open"});
});
describe("three explicitly scoped inventory movements",()=>{
 it("receives and issues without returning cost, and reconciles exact stock/GL/audit effects",async()=>{
  const a=await member(),before=await snapshot();
  const receipt=ok(await send(a,payload("receipt")),201),issue=ok(await send(a),201);
  expect(Object.keys(receipt).sort()).toEqual(["moveId","moveIds"]);
  expect(Object.keys(issue).sort()).toEqual(["moveId","moveIds"]);
  const after=await snapshot();
  expect(after.quants).toEqual(before.quants);
  expect(after.moves.length-before.moves.length).toBe(2);expect(after.journals.length-before.journals.length).toBe(2);
  for(const j of after.journals)expect(j.total_debit).toBe(j.total_credit);
  expect(after.audits.length-before.audits.length).toBe(2);
 });
 it("requires the exact action, forbids forged cost/adjustment, foreign product and foreign warehouse",async()=>{
  const a=await member(["inventory.read"]),before=await snapshot();
  ok(await send(a),403);ok(await send(a,payload("receipt")),403);ok(await send(a,transferBody(a) as never,randomUUID(),"transfers"),403);
  const b=await member();
  ok(await send(b,{...payload(),unitCost:0} as never),400);
  ok(await send(b,payload("adjustment_out")),400);
  ok(await send(b,{...payload(),productId:foreignProduct}),404);
  ok(await send(b,{...payload(),warehouseId:foreignWh}),404);
  ok(await send(b,{...payload(),warehouseId:destination}),403);
  for(const quantity of [0,0.00000001,1.12345,-1])ok(await send(b,{...payload(),quantity}),400);
  expect(await snapshot()).toEqual(before);
 });
 it("needs both explicit grants for cross-branch sending, does not grant receive, and replays without extra transit",async()=>{
  const sourceOnly=await member(),before=await snapshot();
  ok(await send(sourceOnly,transferBody(sourceOnly) as never,randomUUID(),"transfers"),403);
  const a=await member(actions,null,true),key=randomUUID();
  const first=ok(await send(a,transferBody(a) as never,key,"transfers"),201);
  const after=await snapshot();
  const again=await send(a,transferBody(a) as never,key,"transfers");
  expect(ok(again,201)).toEqual(first);expect(again.headers["idempotency-replayed"]).toBe("true");
  expect(await snapshot()).toEqual(after);
  expect(after.moves.length-before.moves.length).toBe(1);expect(after.journals).toEqual(before.journals);
  ok(await a.agent.post(`/api/inventory/transfers/${first.moveId}/receive`).set("X-Workspace-Responsibility",String(a.grants[1].id))
   .set("Idempotency-Key",randomUUID()).send({receiptReference:"لا إذن استلام"}),403);
 });
 it("computes limits from actual stored movement cost, rolls back all effects, and enforces destination cap too",async()=>{
  const a=await member(actions,"1",true),before=await snapshot();
  ok(await send(a),403);ok(await send(a,payload("receipt")),403);
  ok(await send(a,transferBody(a) as never,randomUUID(),"transfers"),403);
  expect(await snapshot()).toEqual(before);
  await rows("UPDATE responsibility_grants SET amount_limit=100 WHERE id=$1",[a.grants[0].id]);
  ok(await send(a,transferBody(a) as never,randomUUID(),"transfers"),403);expect(await snapshot()).toEqual(before);
 });
 it("deduplicates concurrent requests and a lost response; rejects a changed body with the same key",async()=>{
  const a=await member(),key=randomUUID(),before=await snapshot();
  const replies=await Promise.all([send(a,payload(),key),send(a,payload(),key)]);
  replies.forEach(r=>ok(r,201));expect(replies[0].body).toEqual(replies[1].body);
  const after=await snapshot();expect(after.moves.length-before.moves.length).toBe(1);expect(after.journals.length-before.journals.length).toBe(1);
  ok(await send(a,payload(),key),201);expect(await snapshot()).toEqual(after);
  ok(await send(a,{...payload(),quantity:3},key),409);
 });
 it("recovers the confirmed cost-free receipt after execution permission is removed, but not after source read is removed",async()=>{
  const a=await member(),key=randomUUID(),first=ok(await send(a,payload(),key),201),after=await snapshot();
  await rows("UPDATE responsibility_grants SET actions=ARRAY['inventory.read'] WHERE id=$1",[a.grants[0].id]);
  // Execution preflight must not preclude a read-authorized committed replay.
  expect(ok(await send(a,payload(),key),201)).toEqual(first);expect(await snapshot()).toEqual(after);
  await rows("UPDATE responsibility_grants SET revoked_at=now() WHERE id=$1",[a.grants[0].id]);
  ok(await send(a,payload(),key),403);
 });
 it("withholds cost and unrelated warehouse metadata; does not expose destination from a receipt-only grant",async()=>{
  const a=await member(["inventory.read","inventory.move.issue"]),r=ok(await a.agent.get("/api/workspace/inventory/movement-options")
   .set("X-Workspace-Responsibility",String(a.grants[0].id)));
  expect(r.destinations).toEqual([]);expect(r.sources.map((s:{id:number})=>s.id)).toEqual([warehouse]);
  expect(JSON.stringify(r)).not.toMatch(/unitCost|avgCost|costPrice|totalValue/);
 });
 it("blocks delegated moves during an active count without changing or closing that count",async()=>{
  const a=await member(),take=ok(await owner.post("/api/inventory/stock-takes").send({warehouseId:warehouse}),201),before=await snapshot();
  try{ok(await send(a),409);ok(await send(a,payload("receipt")),409);expect(await snapshot()).toEqual(before);}
  finally{await rows("UPDATE stock_takes SET status='cancelled' WHERE id=$1",[take.id]);}
 });
 it("does not bypass a higher individual deny, an inventory module ceiling, or a closed fiscal period",async()=>{
  const a=await member(),before=await snapshot();
  await rows("UPDATE employee_access SET denied_actions=ARRAY['inventory.move.issue'] WHERE employee_id=$1",[a.person.personId]);
  ok(await send(a),403);expect(await snapshot()).toEqual(before);
  await rows("UPDATE employee_access SET denied_actions='{}' WHERE employee_id=$1",[a.person.personId]);
  const policy=await rows("SELECT enabled_modules FROM team_access_policy WHERE company_id=$1",[company]);
  await rows("INSERT INTO team_access_policy(company_id,enabled_modules,updated_by) VALUES($1,ARRAY['pos','procurement'],$2) ON CONFLICT(company_id) DO UPDATE SET enabled_modules=EXCLUDED.enabled_modules",[company,ownerId]);
  try{ok(await send(a),403);}
  finally{if(policy.length)await rows("UPDATE team_access_policy SET enabled_modules=$2 WHERE company_id=$1",[company,policy[0].enabled_modules]);
   else await rows("DELETE FROM team_access_policy WHERE company_id=$1",[company]);}
  await rows("UPDATE fiscal_periods SET status='closed' WHERE fiscal_year_id IN(SELECT id FROM fiscal_years WHERE company_id=$1)",[company]);
  try{ok(await send(a),400);expect(await snapshot()).toEqual(before);}
  finally{await rows("UPDATE fiscal_periods SET status='open' WHERE fiscal_year_id IN(SELECT id FROM fiscal_years WHERE company_id=$1)",[company]);}
 });
 it("rolls back quantity, cost layers, ledger and receipt if the atomic audit fails",async()=>{
  const a=await member(),before=await snapshot(),fn=`reject_scoped_movement_${company}`;
  await pool.query(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.company_id=${company} AND NEW.action='inventory.move.issue' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$`);
  await pool.query(`CREATE TRIGGER ${fn} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${fn}()`);
  const key=randomUUID();
  try{ok(await send(a,payload(),key),400);expect(await snapshot()).toEqual(before);}
  finally{await pool.query(`DROP TRIGGER ${fn} ON audit_logs`);await pool.query(`DROP FUNCTION ${fn}()`);}
  const done=ok(await send(a,payload(),key),201);expect(done.moveId).toBeTruthy();
 });
 it("serializes a count opening snapshot ahead of a waiting delegated move, without granting count close",async()=>{
  const a=await member(),lock=await pool.connect(),before=await snapshot();
  await lock.query("BEGIN");await lock.query("SELECT id FROM warehouses WHERE id=$1 FOR UPDATE",[warehouse]);
  const opening=owner.post("/api/inventory/stock-takes").send({warehouseId:warehouse}).then(r=>r);
  try{
   let blocked=false;
   for(let i=0;i<100&&!blocked;i++){blocked=(await rows("SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%FROM warehouses WHERE id=%'")).length>0;if(!blocked)await new Promise(r=>setTimeout(r,10));}
   expect(blocked).toBe(true);
   const movement=send(a).then(r=>r);
   await lock.query("COMMIT");
   const take=ok(await opening,201);
   try{ok(await movement,409);expect(await snapshot()).toEqual(before);}
   finally{await rows("UPDATE stock_takes SET status='cancelled' WHERE id=$1",[take.id]);}
  }finally{await lock.query("ROLLBACK");lock.release();}
 });
 it("rechecks expiry after the actual stock-cost lock wait and rolls back the engine result",async()=>{
  const a=await member(),before=await snapshot(),lock=await pool.connect();
  await lock.query("BEGIN");await lock.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`${product}-${warehouse}-0-0`]);
  await rows("UPDATE responsibility_grants SET ends_at=clock_timestamp()+interval '2 seconds' WHERE id=$1",[a.grants[0].id]);
  const response=send(a).then(r=>r);
  try{
   let seen=false;
   for(let i=0;i<100&&!seen;i++){seen=(await rows("SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%pg_advisory_xact_lock(hashtextextended%'")).length>0;if(!seen)await new Promise(r=>setTimeout(r,10));}
   expect(seen).toBe(true);await new Promise(r=>setTimeout(r,2100));
   await lock.query("COMMIT");ok(await response,403);expect(await snapshot()).toEqual(before);
  }finally{await lock.query("ROLLBACK");lock.release();}
 });
 for(const change of ["revoked","suspended","expired"]){
  it(`rechecks ${change} after a real authority lock wait with an already-open session`,async()=>{
   const a=await member(),before=await snapshot(),lock=await pool.connect();
   await lock.query("BEGIN");await lock.query("SELECT pg_advisory_xact_lock(174223,35)");
   const response=send(a).then(r=>r);
   try{
    let seen=false;
    for(let i=0;i<100&&!seen;i++){seen=(await rows("SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%pg_advisory_xact_lock_shared(174223,35)%'")).length>0;if(!seen)await new Promise(r=>setTimeout(r,10));}
    expect(seen).toBe(true);
    if(change==="revoked")await lock.query("UPDATE responsibility_grants SET revoked_at=now() WHERE id=$1",[a.grants[0].id]);
    if(change==="expired")await lock.query("UPDATE responsibility_grants SET ends_at=clock_timestamp() WHERE id=$1",[a.grants[0].id]);
    if(change==="suspended")await lock.query("UPDATE employee_access SET status='suspended' WHERE employee_id=$1",[a.person.personId]);
    await lock.query("COMMIT");ok(await response,403);expect(await snapshot()).toEqual(before);
   }finally{await lock.query("ROLLBACK");lock.release();}
  });
 }
});
