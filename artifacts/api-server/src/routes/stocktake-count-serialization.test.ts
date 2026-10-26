import {beforeAll,describe,expect,it,vi} from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import {randomUUID} from "node:crypto";
import {db,pool,companiesTable,usersTable,userCompaniesTable,branchesTable,warehousesTable,categoriesTable,productsTable} from "@workspace/db";
import app,{assertApplicationReady} from "../app";

const tag=`count-safety-${randomUUID()}`,password="Synthetic count safety phrase 2026!";
let owner:request.Agent,reviewer:request.Agent,company:number,ownerId:number,warehouse:number,product:number,unexpected:number,branch:number;
const ok=(r:request.Response,status=200)=>{expect(r.status,JSON.stringify(r.body)).toBe(status);return r.body;};
const rows=async(text:string,values:unknown[]=[])=> (await pool.query(text,values)).rows;
async function take() {
  const created=ok(await owner.post("/api/inventory/stock-takes").send({warehouseId:warehouse}),201);
  const detail=ok(await owner.get(`/api/inventory/stock-takes/${created.id}`));
  return {id:created.id as number,lineId:detail.lines[0].id as number,revision:detail.lines[0].countRevision as string};
}
const scanPoints=new Map<string,Promise<string|undefined>>();
const scan=async(id:number,key:string,quantity=1,productId=product)=>{
 if(!scanPoints.has(key)){
  scanPoints.set(key,owner.post(`/api/inventory/stock-takes/${id}/checkpoint`).send({productId})
    .then(p=>p.status===200?p.body.checkpointId:undefined));
 }
 const checkpointId=await scanPoints.get(key);
 return owner.post(`/api/inventory/stock-takes/${id}/lines`)
 .set("Idempotency-Key",key).send({productId,countedQty:quantity,checkpointId});
};
const setPoints=new Map<string,string>();
const set=async(t:{id:number;lineId:number;revision?:string},key:string,countedQty=10)=>{
 if(!setPoints.has(key)){
  const p=await owner.post(`/api/inventory/stock-takes/${t.id}/checkpoint`).send({productId:product});
  if(p.status===200)setPoints.set(key,p.body.checkpointId);
 }
 return owner.patch(`/api/inventory/stock-takes/${t.id}/lines/${t.lineId}`)
 .set("Idempotency-Key",key).send({countedQty,expectedRevision:t.revision??"0",checkpointId:setPoints.get(key)});
};
async function proof(id:number) {
  return {
    take:(await rows("SELECT status FROM stock_takes WHERE id=$1",[id]))[0],
    lines:await rows("SELECT id,product_id,counted_qty::text FROM stock_take_lines WHERE stock_take_id=$1 ORDER BY id",[id]),
    quants:await rows("SELECT quantity::text,avg_cost::text FROM stock_quants WHERE product_id=$1 AND warehouse_id=$2",[product,warehouse]),
    audits:await rows("SELECT details::jsonb AS details FROM audit_logs WHERE company_id=$1 AND action='inventory.stocktake.counted' AND (details::jsonb->>'takeId')::integer=$2 ORDER BY id",[company,id]),
    journals:(await rows("SELECT count(*)::int n FROM journal_entries WHERE company_id=$1",[company]))[0].n,
  };
}
beforeAll(async()=>{
  await assertApplicationReady();
  const [c]=await db.insert(companiesTable).values({name:tag,isActive:true}).returning();company=c.id;
  const [u]=await db.insert(usersTable).values({name:"مالك عد مصطنع",email:`${tag}@example.invalid`,
    passwordHash:bcrypt.hashSync(password,4),role:"owner",isActive:true}).returning();ownerId=u.id;
  await db.insert(userCompaniesTable).values({userId:u.id,companyId:company,role:"owner",isDefault:true});
  const [b]=await db.insert(branchesTable).values({companyId:company,name:tag,nameAr:"فرع عد مصطنع",city:"الرياض"}).returning();
  branch=b.id;
  const [w]=await db.insert(warehousesTable).values({companyId:company,branchId:b.id,name:tag,nameAr:"مستودع عد مصطنع"}).returning();warehouse=w.id;
  const [cat]=await db.insert(categoriesTable).values({name:tag,nameAr:tag}).returning();
  const ps=await db.insert(productsTable).values([0,1].map(i=>({companyId:company,name:`${tag}-${i}`,nameAr:"صنف عد مصطنع",
    sku:`${tag}-${i}`,categoryId:cat.id,price:"10",costPrice:"3",stock:i?"0":"10",minStock:0,unit:"pcs"}))).returning();
  [product,unexpected]=ps.map(p=>p.id);
  await pool.query("INSERT INTO stock_quants(product_id,warehouse_id,quantity,avg_cost) VALUES($1,$2,10,3)",[product,warehouse]);
  owner=request.agent(app);ok(await owner.post("/api/auth/login").send({email:u.email,password}));
});

describe("legacy count safety before enabling scoped counting",()=>{
  it("grants cost-blind counting of an existing scoped take, not creation, closure, cost or another warehouse; revoked counting can only replay confirmed evidence",async()=>{
    const t=await take();
    const input={creationKey:randomUUID(),name:"عداد مصطنع",email:`${randomUUID()}@example.invalid`,loginKinds:["platform"],
      grants:[{resource:"inventory",branchId:branch,warehouseIds:[warehouse],actions:["inventory.read","inventory.stocktake.count"],
        amountLimit:null,startsAt:null,endsAt:null}],deniedActions:[]};
    const person=ok(await owner.post("/api/team/people").send(input),201);
    const invite=ok(await owner.post(`/api/team/people/${person.personId}/invite`).send({expectedRevision:person.revision}),201);
    ok(await request(app).post("/api/auth/team-activation/accept").send({token:invite.activationToken,password}));
    const agent=request.agent(app);ok(await agent.post("/api/auth/login").send({email:input.email,password}));
    const access=ok(await agent.get("/api/workspace/access")),grantId=access.grants[0].id;
    const header={"X-Workspace-Responsibility":String(grantId)},key=randomUUID(),before=await proof(t.id);
    const detail=ok(await agent.get(`/api/inventory/stock-takes/${t.id}`).set(header));
    expect(detail.canCount).toBe(true);expect(detail.canComplete).toBe(false);
    expect(JSON.stringify(detail)).not.toMatch(/unitCost|unit_cost|avgCost/);
    const list=ok(await agent.get("/api/inventory/stock-takes").set(header));
    expect(list.every((x:{warehouseId:number})=>x.warehouseId===warehouse)).toBe(true);
    const [other]=await db.insert(warehousesTable).values({companyId:company,branchId:branch,name:randomUUID(),nameAr:"خارج النطاق"}).returning();
    const foreign=ok(await owner.post("/api/inventory/stock-takes").send({warehouseId:other.id}),201);
    ok(await agent.get(`/api/inventory/stock-takes/${foreign.id}`).set(header),403);
    ok(await agent.post("/api/inventory/stock-takes").set(header).send({warehouseId:warehouse}),403);
    ok(await agent.post(`/api/inventory/stock-takes/${t.id}/complete`).set(header).send({}),403);
    const point=ok(await agent.post(`/api/inventory/stock-takes/${t.id}/checkpoint`).set(header).send({productId:product}));
    const write=()=>agent.post(`/api/inventory/stock-takes/${t.id}/lines`).set(header).set("Idempotency-Key",key).send({productId:product,countedQty:1,checkpointId:point.checkpointId});
    ok(await write(),201);
    const after=await proof(t.id);
    expect(after.quants).toEqual(before.quants);expect(after.journals).toBe(before.journals);expect(after.audits).toHaveLength(1);
    const lock=await pool.connect();
    let pending:Promise<request.Response>|undefined;
    try {
      await lock.query("BEGIN");await lock.query("SELECT pg_advisory_xact_lock(174223,35)");
      const [{pid}]=(await lock.query("SELECT pg_backend_pid() AS pid")).rows;
      pending=agent.post(`/api/inventory/stock-takes/${t.id}/lines`).set(header)
        .set("Idempotency-Key",randomUUID()).send({productId:product,countedQty:1}).then(r=>r);
      await vi.waitFor(async()=>{
        const [{n}]=await rows("SELECT count(*)::int n FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid)) AND query LIKE '%pg_advisory_xact_lock_shared%'",[pid]);
        expect(n).toBeGreaterThan(0);
      },{timeout:5000,interval:25});
      await lock.query("UPDATE responsibility_grants SET actions=ARRAY['inventory.read']::text[] WHERE id=$1",[grantId]);
      await lock.query("COMMIT");
      ok(await pending,403);
    } finally {await lock.query("ROLLBACK").catch(()=>{});lock.release();if(pending)await pending;}
    const replay=await write();ok(replay,201);expect(replay.headers["idempotency-replayed"]).toBe("true");
    ok(await agent.post(`/api/inventory/stock-takes/${t.id}/lines`).set(header).set("Idempotency-Key",randomUUID()).send({productId:product,countedQty:1}),403);
    expect(await proof(t.id)).toEqual(after);
  });
  it("rejects missing revisions, stale absolute updates and ABA even when quantity returns to the same value",async()=>{
    const t=await take();
    ok(await owner.patch(`/api/inventory/stock-takes/${t.id}/lines/${t.lineId}`).send({countedQty:0}),428);
    ok(await set(t,randomUUID(),1));
    ok(await set(t,randomUUID(),2),409);
    ok(await set({...t,revision:"1"},randomUUID(),0));
    ok(await set(t,randomUUID(),3),409);
    const detail=ok(await owner.get(`/api/inventory/stock-takes/${t.id}`));
    expect(detail.lines[0].countRevision).toBe("2");
    expect(detail.lines[0]).not.toHaveProperty("unitCost");
  });
  it("allows only one concurrent absolute overwrite of the same observed revision",async()=>{
    const t=await take(),before=await proof(t.id);
    const results=await Promise.all([set(t,randomUUID(),5),set(t,randomUUID(),7)]);
    expect(results.map(r=>r.status).sort()).toEqual([200,409]);
    const after=await proof(t.id);
    expect([5,7]).toContain(Number(after.lines[0].counted_qty));
    expect(after.audits).toHaveLength(1);expect(after.quants).toEqual(before.quants);expect(after.journals).toBe(before.journals);
  });
  it("replays one identified scan and serializes different scans without losing an increment",async()=>{
    const t=await take(),key=randomUUID(),before=await proof(t.id);
    const same=await Promise.all([scan(t.id,key),scan(t.id,key)]);
    same.forEach(r=>ok(r,201));
    expect(same.filter(r=>r.headers["idempotency-replayed"]==="true")).toHaveLength(1);
    const different=await Promise.all([scan(t.id,randomUUID()),scan(t.id,randomUUID())]);
    different.forEach(r=>ok(r,201));
    const after=await proof(t.id);
    expect(Number(after.lines[0].counted_qty)).toBe(3);expect(after.audits).toHaveLength(3);
    expect(after.quants).toEqual(before.quants);expect(after.journals).toBe(before.journals);
    expect(after.audits.every(a=>a.details.financialEffect===false&&a.details.independentApproval===false)).toBe(true);
    ok(await scan(t.id,key,7),409);expect(await proof(t.id)).toEqual(after);
  });
  it.each(["set","scan"] as const)("a waiting %s cannot modify a parent that closes before it acquires the row",async mode=>{
    const t=await take(),before=await proof(t.id),lock=await pool.connect();
    let pending:Promise<request.Response>|undefined;
    try {
      await lock.query("BEGIN");await lock.query("SELECT id FROM stock_takes WHERE id=$1 FOR UPDATE",[t.id]);
      const [{pid}]=(await lock.query("SELECT pg_backend_pid() AS pid")).rows;
      pending=(mode==="set"?set(t,randomUUID(),0):scan(t.id,randomUUID())).then(r=>r);
      await vi.waitFor(async()=>{
        const [{n}]=await rows(`SELECT count(*)::int n FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid)) AND query LIKE '%stock_takes%'`,[pid]);
        expect(n).toBeGreaterThan(0);
      },{timeout:5000,interval:25});
      await lock.query("UPDATE stock_takes SET status='done',completed_at=now() WHERE id=$1",[t.id]);
      await lock.query("COMMIT");
      ok(await pending,mode==="set"?409:400);
      const after=await proof(t.id);
      expect(after.take.status).toBe("done");expect(after.lines).toEqual(before.lines);
      expect(after.audits).toEqual(before.audits);expect(after.quants).toEqual(before.quants);expect(after.journals).toBe(before.journals);
    } finally {await lock.query("ROLLBACK").catch(()=>{});lock.release();if(pending)await pending;}
  });
  it("replays a committed count after an actual zero-variance close without reopening or writing another observation",async()=>{
    const t=await take(),key=randomUUID();
    const [r]=await db.insert(usersTable).values({name:`${tag}-reviewer`,email:`${tag}-reviewer@example.invalid`,
      passwordHash:await bcrypt.hash(password,4),role:"owner",isActive:true,has2fa:false}).returning();
    await db.insert(userCompaniesTable).values({userId:r.id,companyId:company,role:"owner",isDefault:true});
    reviewer=request.agent(app);ok(await reviewer.post("/api/auth/login").send({email:r.email,password}));
    ok(await set(t,key));expect(ok(await reviewer.post(`/api/inventory/stock-takes/${t.id}/complete`).send({}))).toEqual({adjustments:0});
    const closed=await proof(t.id);
    const replay=await set(t,key);ok(replay);expect(replay.headers["idempotency-replayed"]).toBe("true");
    ok(await set(t,randomUUID(),5),409);ok(await scan(t.id,randomUUID()),400);
    expect(await proof(t.id)).toEqual(closed);expect(closed.audits).toHaveLength(1);
  });
  it("does not reattribute another session's line and audits the canonical stored quantity, not an unrounded input",async()=>{
    const t=await take(),other=await take(),before=await proof(t.id);
    ok(await set({...t,lineId:other.lineId},randomUUID()),404);
    expect(await proof(t.id)).toEqual(before);
    const created=ok(await scan(t.id,randomUUID(),3.33333,unexpected),201);
    expect(created.countedQty).toBe(3.3333);
    const p=await proof(t.id),line=p.lines.find(l=>l.product_id===unexpected);
    expect(Number(line.counted_qty)).toBe(3.3333);
    expect(p.audits[0].details.countedQty).toBe(3.3333);expect(p.journals).toBe(0);
  });
  it("does not use the cached owner role after a company membership downgrade while waiting on the authority fence",async()=>{
    const t=await take(),before=await proof(t.id),lock=await pool.connect();
    let pending:Promise<request.Response>|undefined;
    try {
      await lock.query("BEGIN");await lock.query("SELECT pg_advisory_xact_lock(174223,35)");
      const [{pid}]=(await lock.query("SELECT pg_backend_pid() AS pid")).rows;
      pending=set(t,randomUUID(),0).then(r=>r);
      await vi.waitFor(async()=>{
        const [{n}]=await rows(`SELECT count(*)::int n FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid)) AND query LIKE '%pg_advisory_xact_lock_shared%'`,[pid]);
        expect(n).toBeGreaterThan(0);
      },{timeout:5000,interval:25});
      await lock.query("UPDATE user_companies SET role='accountant' WHERE user_id=$1 AND company_id=$2",[ownerId,company]);
      await lock.query("COMMIT");
      ok(await pending,403);expect(await proof(t.id)).toEqual(before);
    } finally {await lock.query("ROLLBACK").catch(()=>{});lock.release();if(pending)await pending;}
  });
});
