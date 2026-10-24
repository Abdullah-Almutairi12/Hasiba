import { beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { db, pool, companiesTable, usersTable, userCompaniesTable, branchesTable, warehousesTable,
  categoriesTable, productsTable, fiscalYearsTable, fiscalPeriodsTable, employeesTable } from "@workspace/db";
import app, { assertApplicationReady } from "../app";

const tag=`inventory-receipt-${randomUUID()}`,password="Synthetic inventory receipt phrase 2026!";
let company:number,foreignCompany:number,source:number,destination:number,foreignSource:number,foreignDestination:number;
let sourceBranch:number,destinationBranch:number,product:number,foreignProduct:number;
let owner:request.Agent,foreignOwner:request.Agent;
const ok=(r:request.Response,status=200)=>{expect(r.status,JSON.stringify(r.body)).toBe(status);return r.body;};
const rows=async(text:string,values:unknown[]=[])=> (await pool.query(text,values)).rows;
const grant=(actions=["inventory.read","inventory.transfer.receive"],warehouse=destination,branch=destinationBranch)=>({
  resource:"inventory",branchId:branch,warehouseIds:[warehouse],actions,amountLimit:null,startsAt:null,endsAt:null,
});
async function member(actions=["inventory.read","inventory.transfer.receive"],warehouse=destination,branch=destinationBranch) {
  const input={creationKey:randomUUID(),name:"مستلم تحويل مصطنع",email:`${randomUUID()}@example.invalid`,loginKinds:["platform"],
    grants:[grant(actions,warehouse,branch)],deniedActions:[]};
  const person=ok(await owner.post("/api/team/people").send(input),201);
  const invite=ok(await owner.post(`/api/team/people/${person.personId}/invite`).send({expectedRevision:person.revision}),201);
  ok(await request(app).post("/api/auth/team-activation/accept").send({token:invite.activationToken,password}));
  const agent=request.agent(app);ok(await agent.post("/api/auth/login").send({email:input.email,password}));
  const access=ok(await agent.get("/api/workspace/access"));
  return {agent,person,input,grantId:access.grants.find((g:{resource:string})=>g.resource==="inventory").id as number};
}
const receive=(actor:{agent:request.Agent;grantId:number},id:number,key=randomUUID(),reference="SYNTHETIC-RECEIPT")=>
  actor.agent.post(`/api/inventory/transfers/${id}/receive`).set("X-Workspace-Responsibility",String(actor.grantId))
    .set("Idempotency-Key",key).send({receiptReference:reference});
const listing=(actor:Awaited<ReturnType<typeof member>>)=>
  actor.agent.get("/api/workspace/inventory/transfers").set("X-Workspace-Responsibility",String(actor.grantId));
async function transfer(foreign=false) {
  const result=ok(await (foreign?foreignOwner:owner).post("/api/inventory/transfers").send({
    productId:foreign?foreignProduct:product,quantity:2,fromWarehouseId:foreign?foreignSource:source,
    toWarehouseId:foreign?foreignDestination:destination,notes:"تحويل مصطنع لاختبار إذن الوجهة",
  }),201);
  expect(Number.isInteger(result.moveId)).toBe(true);
  return {id:result.moveId as number};
}
async function evidence(id:number) {
  return {
    move:(await rows("SELECT state,quantity::text,unit_cost::text,from_warehouse_id,to_warehouse_id FROM stock_moves WHERE id=$1",[id]))[0],
    quants:await rows("SELECT warehouse_id,quantity::text,avg_cost::text,(quantity*avg_cost)::text AS carrying_value FROM stock_quants WHERE product_id=$1 ORDER BY warehouse_id",[product]),
    audit:await rows("SELECT details FROM audit_logs WHERE company_id=$1 AND action='inventory.transfer.received' AND (details::jsonb->>'moveId')::integer=$2",[company,id]),
    journals:(await rows("SELECT count(*)::int n FROM journal_entries WHERE company_id=$1",[company]))[0],
  };
}
beforeAll(async()=>{
  await assertApplicationReady();
  const cs=await db.insert(companiesTable).values([{name:tag,vatRegistrationStatus:"not_registered"},
    {name:`${tag}-foreign`,vatRegistrationStatus:"not_registered"}]).returning();
  [company,foreignCompany]=cs.map(c=>c.id);
  const accounts=await db.insert(usersTable).values([0,1].map(n=>({
    name:"مالك اختبار مخزون",email:`${tag}-${n}@example.invalid`,passwordHash:bcrypt.hashSync(password,4),role:"owner",isActive:true,
  }))).returning();
  await db.insert(userCompaniesTable).values(accounts.map((u,i)=>({userId:u.id,companyId:cs[i].id,role:"owner",isDefault:true})));
  [owner,foreignOwner]=[request.agent(app),request.agent(app)];
  for(const [i,agent] of [owner,foreignOwner].entries())ok(await agent.post("/api/auth/login").send({email:accounts[i].email,password}));
  const bs=await db.insert(branchesTable).values([
    {companyId:company,name:`${tag}-source`,nameAr:"مصدر مستقل",city:"الرياض"},
    {companyId:company,name:`${tag}-destination`,nameAr:"وجهة الاستلام",city:"جدة"},
    {companyId:foreignCompany,name:`${tag}-foreign`,nameAr:"شركة أخرى",city:"الدمام"},
  ]).returning();
  [sourceBranch,destinationBranch]=bs.map(b=>b.id);
  const ws=await db.insert(warehousesTable).values([
    {companyId:company,branchId:sourceBranch,name:`${tag}-source`,nameAr:"مستودع المصدر"},
    {companyId:company,branchId:destinationBranch,name:`${tag}-destination`,nameAr:"مستودع الوجهة"},
    ...[0,1].map(n=>({companyId:foreignCompany,branchId:bs[2].id,name:`${tag}-other-${n}`,nameAr:"مستودع شركة أخرى"})),
  ]).returning();
  [source,destination,foreignSource,foreignDestination]=ws.map(w=>w.id);
  const [category]=await db.insert(categoriesTable).values({name:tag,nameAr:tag}).returning();
  const ps=await db.insert(productsTable).values([company,foreignCompany].map((companyId,i)=>({
    companyId,name:`${tag}-${i}`,nameAr:"منتج استلام مصطنع",sku:`${tag}-${i}`,categoryId:category.id,
    price:"10",costPrice:"3",stock:"100",minStock:0,unit:"pcs",
  }))).returning();
  [product,foreignProduct]=ps.map(p=>p.id);
  for(const [warehouseId,productId] of [[source,product],[foreignSource,foreignProduct]]) {
    await pool.query("INSERT INTO stock_quants(warehouse_id,product_id,quantity,avg_cost) VALUES($1,$2,100,3)",[warehouseId,productId]);
  }
  const year=new Date().getUTCFullYear();
  for(const companyId of [company,foreignCompany]) {
    const [fy]=await db.insert(fiscalYearsTable).values({companyId,name:tag,startDate:`${year}-01-01`,endDate:`${year}-12-31`}).returning();
    await db.insert(fiscalPeriodsTable).values({fiscalYearId:fy.id,name:tag,startDate:`${year}-01-01`,endDate:`${year}-12-31`,status:"open"});
  }
});

describe("destination-scoped full transfer receipt",()=>{
  it("lists only owned destination transfers without exposing costs, then receives at the original carrying cost",async()=>{
    const actor=await member(),move=await transfer(),foreign=await transfer(true);
    const view=ok(await listing(actor));
    expect(view.canReceive).toBe(true);
    expect(view.transfers.some((t:{id:number})=>t.id===move.id)).toBe(true);
    expect(view.transfers.some((t:{id:number})=>t.id===foreign.id)).toBe(false);
    const item=view.transfers.find((t:{id:number})=>t.id===move.id);
    expect(Object.keys(item).sort()).toEqual(["createdAt","destinationWarehouse","id","productName","quantity","reference","sourceWarehouse","state"].sort());
    await pool.query("UPDATE products SET cost_price=999 WHERE id=$1",[product]);
    const before=await evidence(move.id);
    ok(await receive(actor,move.id));
    const after=await evidence(move.id);
    expect(after.move.state).toBe("done");expect(after.move.unit_cost).toBe(before.move.unit_cost);
    expect(Number(after.quants.find(q=>q.warehouse_id===destination).avg_cost)).toBe(3);
    expect(after.journals).toEqual(before.journals);
    expect(after.audit).toHaveLength(1);
    const audit=JSON.parse(after.audit[0].details);
    expect(audit.responsibility.branchId).toBe(destinationBranch);
    expect(audit.receiptReference).toBe("SYNTHETIC-RECEIPT");
    await pool.query("UPDATE products SET cost_price=3 WHERE id=$1",[product]);
  });
  it("denies read-only, source-only and foreign-company callers without stock or journal effects",async()=>{
    const move=await transfer(),before=await evidence(move.id);
    const reader=await member(["inventory.read"]),sourceOnly=await member(undefined,source,sourceBranch);
    ok(await receive(reader,move.id),403);
    ok(await receive(sourceOnly,move.id),403);
    expect(await evidence(move.id)).toEqual(before);
    const actor=await member(),foreign=await transfer(true);
    ok(await receive(actor,foreign.id),404);
    expect(await evidence(move.id)).toEqual(before);
  });
  it("rejects missing retry identity, substituted amount/quantity/destination and an empty evidence reference",async()=>{
    const actor=await member(),move=await transfer(),before=await evidence(move.id);
    ok(await actor.agent.post(`/api/inventory/transfers/${move.id}/receive`).set("X-Workspace-Responsibility",String(actor.grantId))
      .send({receiptReference:"SYNTHETIC"}),400);
    ok(await receive(actor,move.id,randomUUID(),""),400);
    ok(await actor.agent.post(`/api/inventory/transfers/${move.id}/receive`).set("X-Workspace-Responsibility",String(actor.grantId))
      .set("Idempotency-Key",randomUUID()).send({receiptReference:"SYNTHETIC",quantity:999,toWarehouseId:source,unitCost:0}),400);
    expect(await evidence(move.id)).toEqual(before);
  });
  it("concurrent identical keys return one original and one committed replay, without a second receipt",async()=>{
    const actor=await member(),move=await transfer(),key=randomUUID(),before=await evidence(move.id);
    const replies=await Promise.all([receive(actor,move.id,key),receive(actor,move.id,key)]);
    replies.forEach(r=>ok(r));
    expect(replies.filter(r=>r.headers["idempotency-replayed"]==="true")).toHaveLength(1);
    const after=await evidence(move.id);
    expect(after.audit).toHaveLength(1);expect(after.journals).toEqual(before.journals);
    const destBefore=Number(before.quants.find(q=>q.warehouse_id===destination)?.quantity??0);
    expect(Number(after.quants.find(q=>q.warehouse_id===destination).quantity)-destBefore).toBe(2);
    ok(await receive(actor,move.id,key,"CHANGED-REFERENCE"),409);
    expect(await evidence(move.id)).toEqual(after);
  });
  it("different concurrent request identities cannot apply the same source transfer twice",async()=>{
    const actor=await member(),move=await transfer();
    const replies=await Promise.all([receive(actor,move.id),receive(actor,move.id)]);
    expect(replies.map(r=>r.status).sort()).toEqual([200,409]);
    expect((await evidence(move.id)).audit).toHaveLength(1);
  });
  it("revoking execution retains a readable committed replay but prevents a fresh receipt",async()=>{
    const actor=await member(),move=await transfer(),key=randomUUID();
    ok(await receive(actor,move.id,key));const committed=await evidence(move.id);
    const [{revision}]=await rows("SELECT revision FROM employee_access WHERE company_id=$1 AND employee_id=$2",[company,actor.person.personId]);
    const input={...actor.input,grants:[grant(["inventory.read"])]};
    ok(await owner.put(`/api/team/people/${actor.person.personId}/access`).send({expectedRevision:revision,person:input,suspended:false}));
    actor.grantId=ok(await actor.agent.get("/api/workspace/access")).grants.find((g:{resource:string})=>g.resource==="inventory").id;
    const replay=await receive(actor,move.id,key);ok(replay);expect(replay.headers["idempotency-replayed"]).toBe("true");
    expect(await evidence(move.id)).toEqual(committed);
    const fresh=await transfer(),before=await evidence(fresh.id);
    ok(await receive(actor,fresh.id),403);
    expect(await evidence(fresh.id)).toEqual(before);
  });
  it("a converted inventory identity inherits no legacy writes and receives only after an explicit destination grant",async()=>{
    const name="موظف مخزون قديم مصطنع",email=`${randomUUID()}@example.invalid`;
    const [user]=await db.insert(usersTable).values({name,email,passwordHash:bcrypt.hashSync(password,4),role:"inventory",branchId:destinationBranch,isActive:true}).returning();
    await db.insert(userCompaniesTable).values({userId:user.id,companyId:company,role:"inventory",isDefault:true});
    const [employee]=await db.insert(employeesTable).values({
      companyId:company,userId:user.id,name,nameAr:name,email,employeeNo:`LEG-${randomUUID()}`,
      hireDate:"2024-01-01",status:"active",recordKind:"employee",nationality:"SA",
    }).returning();
    const agent=request.agent(app);ok(await agent.post("/api/auth/login").send({email,password}));
    const input={creationKey:randomUUID(),name,email,loginKinds:["platform"],deniedActions:[],grants:[grant(["inventory.read"])]};
    const body={userId:user.id,person:input};
    const preview=ok(await owner.post("/api/team/legacy/preview").send(body));
    ok(await owner.post("/api/team/legacy/apply").send({...body,expectedDigest:preview.digest}));
    const actor={agent,person:{personId:employee.id},input,grantId:ok(await agent.get("/api/workspace/access")).grants[0].id};
    const move=await transfer(),before=await evidence(move.id);
    ok(await receive(actor,move.id),403);
    ok(await agent.post("/api/inventory/moves").set("X-Workspace-Responsibility",String(actor.grantId))
      .send({productId:product,warehouseId:source,kind:"issue",quantity:1}),403);
    expect(await evidence(move.id)).toEqual(before);
    const [{revision}]=await rows("SELECT revision FROM employee_access WHERE company_id=$1 AND employee_id=$2",[company,employee.id]);
    ok(await owner.put(`/api/team/people/${employee.id}/access`).send({
      expectedRevision:revision,person:{...input,grants:[grant()]},suspended:false,
    }));
    actor.grantId=ok(await agent.get("/api/workspace/access")).grants[0].id;
    ok(await receive(actor,move.id));
    expect((await evidence(move.id)).audit).toHaveLength(1);
  });
  it("rechecks a deactivated actor after waiting behind the authority writer and before touching stock",async()=>{
    const actor=await member(),move=await transfer(),before=await evidence(move.id);
    const [{user_id:userId}]=await rows("SELECT user_id FROM employees WHERE id=$1 AND company_id=$2",[actor.person.personId,company]);
    const lock=await pool.connect();let pending:Promise<request.Response>|undefined;
    try {
      await lock.query("BEGIN");
      await lock.query("SELECT pg_advisory_xact_lock(174223,35)");
      const [{pid}]=(await lock.query("SELECT pg_backend_pid() AS pid")).rows;
      pending=receive(actor,move.id).then(r=>r);
      await vi.waitFor(async()=>{
        const [{n}]=await rows(`SELECT count(*)::int n FROM pg_stat_activity
          WHERE $1=ANY(pg_blocking_pids(pid)) AND query LIKE '%pg_advisory_xact_lock_shared%'`,[pid]);
        expect(n).toBeGreaterThan(0);
      },{timeout:5000,interval:25});
      await lock.query("UPDATE users SET is_active=false WHERE id=$1",[userId]);
      await lock.query("COMMIT");
      ok(await pending,403);
      expect(await evidence(move.id)).toEqual(before);
    } finally {
      await lock.query("ROLLBACK").catch(()=>{});
      lock.release();
      if(pending)await pending;
    }
  });
});
