import { beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { db, pool, companiesTable, usersTable, userCompaniesTable, branchesTable, warehousesTable,
  categoriesTable, productsTable } from "@workspace/db";
import { seedCompanyFiscalCalendar } from "../lib/fiscal-calendar";
import { stocktakeSeparation } from "../lib/stocktake-separation";
import app, { assertApplicationReady } from "../app";

const tag=`count-independence-${randomUUID()}`, password="Synthetic independence test 2026!";
const rows=async(q:string,v:unknown[]=[]) => (await pool.query(q,v)).rows;
const ok=(r:request.Response,status=200)=>{expect(r.status,JSON.stringify(r.body)).toBe(status);return r.body;};
let company:number,wh:number,products:number[];
let manager:request.Agent,secondCounter:request.Agent,reviewer:request.Agent,unprivileged:request.Agent,foreign:request.Agent;
let managerId:number,secondCounterId:number,reviewerId:number;
async function actor(companyId:number,role:string,suffix:string) {
  const [u]=await db.insert(usersTable).values({name:`${tag}-${suffix}`,email:`${tag}-${suffix}@example.invalid`,
    passwordHash:await bcrypt.hash(password,4),role,isActive:true,has2fa:false}).returning();
  await db.insert(userCompaniesTable).values({userId:u.id,companyId,role,isDefault:true});
  const agent=request.agent(app);ok(await agent.post("/api/auth/login").send({email:u.email,password}));
  return {agent,id:u.id};
}
const open=async()=>ok(await reviewer.post("/api/inventory/stock-takes").send({warehouseId:wh}),201).id as number;
const point=async(who:request.Agent,id:number,product=products[0]) =>
  ok(await who.post(`/api/inventory/stock-takes/${id}/checkpoint`).send({productId:product}));
const count=(who:request.Agent,id:number,p:{lineId:number;expectedRevision:string;checkpointId:string},qty:number,key=randomUUID()) =>
  who.patch(`/api/inventory/stock-takes/${id}/lines/${p.lineId}`).set("Idempotency-Key",key)
    .send({countedQty:qty,expectedRevision:p.expectedRevision,checkpointId:p.checkpointId});
const close=(who:request.Agent,id:number)=>who.post(`/api/inventory/stock-takes/${id}/complete`).send({});
const detail=async(who:request.Agent,id:number)=>ok(await who.get(`/api/inventory/stock-takes/${id}`));
async function proof(id:number) {
  return {
    take:await rows("SELECT status,closure_result FROM stock_takes WHERE id=$1",[id]),
    quantities:await rows("SELECT product_id,quantity::text,avg_cost::text FROM stock_quants WHERE warehouse_id=$1 ORDER BY product_id",[wh]),
    moves:await rows("SELECT id,quantity::text,unit_cost::text FROM stock_moves WHERE source_type='stocktake' AND source_id=$1 ORDER BY id",[id]),
    journals:await rows("SELECT id FROM journal_entries WHERE company_id=$1 ORDER BY id",[company]),
    closureAudits:await rows(`SELECT user_id,details::jsonb AS details FROM audit_logs
      WHERE company_id=$1 AND action='inventory.stocktake.closed'
      AND (details::jsonb->>'takeId')::integer=$2 ORDER BY id`,[company,id]),
  };
}
beforeAll(async()=>{
  await assertApplicationReady();
  company=(await db.insert(companiesTable).values({name:tag}).returning())[0].id;
  await seedCompanyFiscalCalendar(company);
  ({agent:manager,id:managerId}=await actor(company,"manager","counter-manager"));
  ({agent:secondCounter,id:secondCounterId}=await actor(company,"owner","counter-owner"));
  ({agent:reviewer,id:reviewerId}=await actor(company,"owner","independent"));
  ({agent:unprivileged}=await actor(company,"cashier","no-approval"));
  const foreignCompany=(await db.insert(companiesTable).values({name:`${tag}-foreign`}).returning())[0].id;
  ({agent:foreign}=await actor(foreignCompany,"owner","foreign"));
  const b=(await db.insert(branchesTable).values({companyId:company,name:tag,nameAr:"فرع اختبار الاستقلال",city:"الرياض"}).returning())[0];
  wh=(await db.insert(warehousesTable).values({companyId:company,branchId:b.id,name:tag,nameAr:"مستودع اختبار الاستقلال"}).returning())[0].id;
  const cat=(await db.insert(categoriesTable).values({name:tag,nameAr:tag}).returning())[0];
  products=(await db.insert(productsTable).values([0,1].map(i=>({companyId:company,categoryId:cat.id,name:`${tag}-${i}`,
    nameAr:`صنف الاستقلال ${i}`,sku:`${tag}-${i}`,price:"20",costPrice:"5",stock:"0",minStock:0,unit:"pcs"}))).returning()).map(p=>p.id);
  for(const productId of products)ok(await reviewer.post("/api/inventory/moves").set("Idempotency-Key",randomUUID())
    .send({productId,warehouseId:wh,kind:"receipt",quantity:100,unitCost:5}),201);
});

describe("session-wide historical count participation",()=>{
  it("rejects manager and owner counters for the whole session; permits its independent creator/viewer",async()=>{
    const id=await open(),a=await point(manager,id),b=await point(secondCounter,id,products[1]);
    const opening=await proof(id);
    ok(await count(manager,id,a,a.expectedQty-1));ok(await count(secondCounter,id,b,b.expectedQty));
    // Creating, viewing and preparing a checkpoint do not make a participant.
    await point(reviewer,id);
    const independent=await detail(reviewer,id);expect(independent.canComplete).toBe(true);
    expect(independent.hasCountParticipation).toBe(false);
    const blocked=await detail(manager,id);
    expect(blocked.canComplete).toBe(false);expect(blocked.hasCountParticipation).toBe(true);
    expect(blocked.approvalBlockReason).toContain("بانتظار معتمد");
    const before=await proof(id);expect(before.quantities).toEqual(opening.quantities);expect(before.journals).toEqual(opening.journals);
    expect(ok(await close(manager,id),403).error).toContain("سجّلت");
    ok(await close(secondCounter,id),403);expect(await proof(id)).toEqual(before);
    expect(ok(await close(reviewer,id))).toEqual({adjustments:1});
    const after=await proof(id);
    expect(after.moves).toHaveLength(1);expect(Number(after.moves[0].quantity)).toBe(1);
    expect(after.journals.length-before.journals.length).toBe(1);
    expect(after.closureAudits).toHaveLength(1);
    expect(after.closureAudits[0].user_id).toBe(reviewerId);
    expect(after.closureAudits[0].details.countParticipantIds).toEqual([managerId,secondCounterId].sort((a,b)=>a-b));
    expect(after.closureAudits[0].details.independentOfCount).toBe(true);
    // Independent SQL: quantity × carrying cost agrees with the company's inventory GL.
    const [{stock}]=await rows(`SELECT sum(quantity*avg_cost)::text AS stock FROM stock_quants
      WHERE warehouse_id=$1`,[wh]);
    const [{ledger}]=await rows(`SELECT coalesce(sum(l.debit-l.credit),0)::text AS ledger
      FROM journal_entry_lines l JOIN journal_entries j ON j.id=l.entry_id
      JOIN accounts a ON a.id=l.account_id WHERE j.company_id=$1 AND a.system_key='inventory'`,[company]);
    expect(Number(ledger)).toBe(Number(stock));
  });
  it("retains the original actor after deleting the count line and recounting by another person",async()=>{
    const id=await open(),p=await point(manager,id);ok(await count(manager,id,p,p.expectedQty));
    // No public delete/assignment operation is invented. Simulate removal of
    // a count record directly in this disposable DB to exercise retention.
    await rows("DELETE FROM stock_take_lines WHERE id=$1",[p.lineId]);
    const q=await point(secondCounter,id);ok(await count(secondCounter,id,q,q.expectedQty));
    expect((await stocktakeSeparation(db,id,managerId)).participated).toBe(true);
    ok(await close(manager,id),403);ok(await close(secondCounter,id),403);
    expect(ok(await close(reviewer,id))).toEqual({adjustments:0});
    const closed=await proof(id);expect(closed.moves).toHaveLength(0);
    expect(closed.closureAudits[0].details.countParticipantIds).toEqual([managerId,secondCounterId].sort((a,b)=>a-b));
  });
  it("records changing an existing count, including an unchanged numeric value, as participation",async()=>{
    const id=await open(),a=await point(manager,id);ok(await count(manager,id,a,a.expectedQty));
    const b=await point(secondCounter,id);ok(await count(secondCounter,id,b,b.expectedQty));
    ok(await close(secondCounter,id),403);
    const participants=await rows("SELECT user_id FROM stocktake_count_participants WHERE take_id=$1 ORDER BY user_id",[id]);
    expect(participants.map(p=>p.user_id)).toEqual([managerId,secondCounterId].sort((a,b)=>a-b));
  });
  it("counts a recorded zero as participation, not as an absent observation",async()=>{
    const id=await open(),p=await point(manager,id);ok(await count(manager,id,p,0));
    const before=await proof(id);ok(await close(manager,id),403);
    expect(await proof(id)).toEqual(before);expect(before.take[0].status).toBe("in_progress");
  });
  it("does not mark failed or merely prepared counts as participation",async()=>{
    const id=await open(),p=await point(manager,id);
    ok(await count(manager,id,p,-1),400);
    expect((await stocktakeSeparation(db,id,managerId)).participantIds).toEqual([]);
    expect((await detail(manager,id)).canComplete).toBe(true);
  });
  it("does not bypass missing authority or company scope merely because a person is independent",async()=>{
    const id=await open(),p=await point(manager,id);ok(await count(manager,id,p,p.expectedQty));
    const before=await proof(id);
    ok(await close(unprivileged,id),403);
    expect((await close(foreign,id)).status).not.toBe(200);
    expect((await foreign.get(`/api/inventory/stock-takes/${id}`)).status).not.toBe(200);
    expect(await proof(id)).toEqual(before);
  });
  it("rechecks participation after a count commits ahead of the waiting closure",async()=>{
    const id=await open(),p=await point(manager,id),lock=await pool.connect();
    let counting:Promise<request.Response>|undefined,closing:Promise<request.Response>|undefined;
    try{
      await lock.query("BEGIN");await lock.query("SELECT id FROM stock_takes WHERE id=$1 FOR UPDATE",[id]);
      const [{pid}]=(await lock.query("SELECT pg_backend_pid() AS pid")).rows;
      const waiters=async()=>Number((await rows(`SELECT count(*) n FROM pg_stat_activity
        WHERE $1=ANY(pg_blocking_pids(pid)) AND query LIKE '%stock_takes%'`,[pid]))[0].n);
      counting=count(manager,id,p,p.expectedQty).then(r=>r);
      await vi.waitFor(async()=>expect(await waiters()).toBeGreaterThanOrEqual(1),{timeout:5000,interval:20});
      closing=close(manager,id).then(r=>r);
      // The second waiter can be blocked by the first queued writer, so count
      // the complete blocking tree rather than only the root holder.
      await vi.waitFor(async()=>{
        const [{n}]=await rows(`SELECT count(*)::integer n FROM pg_stat_activity
          WHERE cardinality(pg_blocking_pids(pid))>0 AND query LIKE '%stock_takes%'`);
        expect(n).toBeGreaterThanOrEqual(2);
      },{timeout:5000,interval:20});
      await lock.query("COMMIT");ok(await counting);ok(await closing,403);
      const after=await proof(id);expect(after.take[0].status).toBe("in_progress");
      expect(after.moves).toHaveLength(0);expect(after.closureAudits).toHaveLength(0);
    }finally{await lock.query("ROLLBACK").catch(()=>{});lock.release();if(counting)await counting;if(closing)await closing;}
  });
  it("preserves a confirmed close and its participant audit across concurrent retries and a lost reply",async()=>{
    const id=await open(),p=await point(manager,id),key=randomUUID();
    ok(await count(manager,id,p,p.expectedQty,key));ok(await count(manager,id,p,p.expectedQty,key));
    const before=await proof(id);
    // The first successful response is intentionally ignored, then recovered.
    ok(await close(reviewer,id));
    const replies=await Promise.all([close(reviewer,id),close(reviewer,id)]);
    replies.forEach(r=>expect(ok(r)).toEqual({adjustments:0}));
    const after=await proof(id);
    expect(after.closureAudits).toHaveLength(1);expect(after.moves).toHaveLength(0);
    expect(after.journals).toEqual(before.journals);
    expect(await rows("SELECT * FROM stocktake_count_participants WHERE take_id=$1",[id])).toHaveLength(1);
  });
  it("backfills only evidenced participants, never the creator; recount cannot erase missing historical identity",async()=>{
    const id=await open(),p=await point(manager,id);ok(await count(manager,id,p,p.expectedQty));
    await rows("DELETE FROM stocktake_count_participants WHERE take_id=$1",[id]);
    expect((await detail(reviewer,id)).approvalBlockReason).toContain("بلا دليل");
    await pool.query(readFileSync(new URL("../../../../lib/db/drizzle/0062_stocktake_count_participants.sql",import.meta.url),"utf8"));
    const restored=await stocktakeSeparation(db,id,reviewerId);
    expect(restored.participantIds).toEqual([managerId]);expect(restored.blockReason).toBeNull();
    ok(await close(manager,id),403);
    const legacy=await open(),old=await point(manager,legacy);
    await rows("UPDATE stock_take_lines SET counted_qty=0 WHERE id=$1",[old.lineId]);
    expect((await detail(reviewer,legacy)).canComplete).toBe(false);
    const fresh=await point(secondCounter,legacy);ok(await count(secondCounter,legacy,fresh,fresh.expectedQty));
    expect((await detail(reviewer,legacy)).canComplete).toBe(false);
    expect((await detail(reviewer,legacy)).approvalBlockReason).toContain("لا يكفي حذف العد أو إعادته");
    expect((await stocktakeSeparation(db,legacy,reviewerId)).participantIds).toEqual([secondCounterId]);
    await rows("DELETE FROM stock_take_lines WHERE stock_take_id=$1",[legacy]);
    expect((await detail(reviewer,legacy)).canComplete).toBe(false);
  });
});
