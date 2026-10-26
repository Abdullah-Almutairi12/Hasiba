import {beforeAll,describe,it,expect,vi} from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import {randomUUID} from "node:crypto";
import {db,pool,companiesTable,usersTable,userCompaniesTable,branchesTable,warehousesTable,
 categoriesTable,productsTable,fiscalYearsTable,fiscalPeriodsTable} from "@workspace/db";
import {recordStockMove,completeTransfer} from "../lib/stock-engine";
import app,{assertApplicationReady} from "../app";

const tag=`moving-${randomUUID()}`,password="Synthetic moving stocktake password 2026!";
let actor:request.Agent,company:number,user:number,wh:number,dest:number,product:number;
const rows=async(q:string,v:unknown[]=[])=> (await pool.query(q,v)).rows;
const ok=(r:request.Response,status=200)=>{expect(r.status,JSON.stringify(r.body)).toBe(status);return r.body;};
const open=async()=>ok(await actor.post("/api/inventory/stock-takes").send({warehouseId:wh}),201).id as number;
const prepare=async(id:number)=>ok(await actor.post(`/api/inventory/stock-takes/${id}/checkpoint`).send({productId:product}));
const save=(id:number,p:{lineId:number;checkpointId:string;expectedRevision:string},n:number,key=randomUUID())=>
 actor.patch(`/api/inventory/stock-takes/${id}/lines/${p.lineId}`).set("Idempotency-Key",key)
 .send({countedQty:n,checkpointId:p.checkpointId,expectedRevision:p.expectedRevision});
const close=(id:number)=>actor.post(`/api/inventory/stock-takes/${id}/complete`).send({});
const move=async(kind:"receipt"|"issue",quantity:number,unitCost?:number)=>ok(await actor.post("/api/inventory/moves")
 .set("Idempotency-Key",randomUUID()).send({productId:product,warehouseId:wh,kind,quantity,unitCost}),201);
async function proof(){
 return {
  quants:await rows("SELECT warehouse_id,quantity::text,avg_cost::text FROM stock_quants WHERE product_id=$1 ORDER BY warehouse_id",[product]),
  moves:await rows("SELECT id,kind,quantity::text,unit_cost::text,source_type FROM stock_moves WHERE product_id=$1 ORDER BY id",[product]),
  journals:await rows("SELECT id FROM journal_entries WHERE company_id=$1 ORDER BY id",[company]),
  reconciled:await rows("SELECT details::jsonb FROM audit_logs WHERE company_id=$1 AND action='inventory.stocktake.reconciled' ORDER BY id",[company]),
 };
}
const balance=async()=>Number((await rows("SELECT quantity FROM stock_quants WHERE product_id=$1 AND warehouse_id=$2",[product,wh]))[0].quantity);
beforeAll(async()=>{
 await assertApplicationReady();
 const [c]=await db.insert(companiesTable).values({name:tag}).returning();company=c.id;
 const [u]=await db.insert(usersTable).values({name:tag,email:`${tag}@example.invalid`,
  passwordHash:await bcrypt.hash(password,4),role:"owner",isActive:true,has2fa:false}).returning();user=u.id;
 await db.insert(userCompaniesTable).values({userId:user,companyId:company,role:"owner",isDefault:true});
 const [b]=await db.insert(branchesTable).values({companyId:company,name:tag,nameAr:"فرع الجرد المتحرك",city:"الرياض"}).returning();
 const ws=await db.insert(warehousesTable).values([0,1].map(i=>({companyId:company,branchId:b.id,name:tag+i,nameAr:"مستودع الجرد "+i}))).returning();
 [wh,dest]=ws.map(w=>w.id);
 const [cat]=await db.insert(categoriesTable).values({name:tag,nameAr:tag}).returning();
 const [p]=await db.insert(productsTable).values({companyId:company,categoryId:cat.id,name:tag,nameAr:"صنف الجرد المتحرك",
  sku:tag,price:"20",costPrice:"5",stock:"0",minStock:0,unit:"pcs"}).returning();product=p.id;
 const year=new Date().getUTCFullYear();
 const [fy]=await db.insert(fiscalYearsTable).values({companyId:company,name:tag,startDate:`${year}-01-01`,endDate:`${year}-12-31`}).returning();
 await db.insert(fiscalPeriodsTable).values({fiscalYearId:fy.id,name:tag,startDate:`${year}-01-01`,endDate:`${year}-12-31`,status:"open"});
 actor=request.agent(app);ok(await actor.post("/api/auth/login").send({email:u.email,password}));
 await move("receipt",100,5);
});
describe("moving stocktake cutoff on native services",()=>{
 it("recovers a lost opening response and concurrent retries as one session, not two competing snapshots",async()=>{
  const key=randomUUID(),before=await rows("SELECT id FROM stock_takes WHERE warehouse_id=$1",[wh]);
  const create=()=>actor.post("/api/inventory/stock-takes").set("Idempotency-Key",key).send({warehouseId:wh});
  const replies=await Promise.all([create(),create()]);
  const a=ok(replies[0],201),b=ok(replies[1],201);expect(a.id).toBe(b.id);
  expect(ok(await create(),201).id).toBe(a.id);
  expect((await rows("SELECT id FROM stock_takes WHERE warehouse_id=$1",[wh])).length).toBe(before.length+1);
 });
 it("does not invent variance for a sale before observation, and keeps receipt/issue after confirmation",async()=>{
  const id=await open(),initial=await balance();
  // Exercise the SAME stock engine used by POS, with its native sale source.
  await db.transaction(tx=>recordStockMove(tx,{companyId:company,productId:product,fromWarehouseId:wh,
   quantity:10,kind:"issue",sourceType:"pos_order",sourceId:id,createdBy:user}));
  const p=await prepare(id),before=await proof();
  ok(await save(id,p,initial-10));expect(await proof()).toEqual(before);
  await move("receipt",7,5);await move("issue",2);
  const beforeClose=await proof();
  expect(ok(await close(id))).toEqual({adjustments:0});
  expect(await balance()).toBe(initial-5);
  const after=await proof();expect(after.moves).toEqual(beforeClose.moves);expect(after.journals).toEqual(beforeClose.journals);
  expect(after.reconciled.at(-1).details).toMatchObject({observedExpectedQty:(initial-10).toFixed(4),delta:"0.0000"});
 });
 it("applies only true physical variance, preserving later movements and reconciling inventory value to balanced GL",async()=>{
  const id=await open(),initial=await balance(),p=await prepare(id);
  ok(await save(id,p,initial-3));await move("receipt",4,5);await move("issue",2);
  const before=await proof();expect(ok(await close(id))).toEqual({adjustments:1});
  expect(await balance()).toBe(initial-1);
  const after=await proof();expect(after.moves.length).toBe(before.moves.length+1);
  const last=after.moves.at(-1);expect(last).toMatchObject({source_type:"stocktake",quantity:"3.0000"});
  expect(Number(last.unit_cost)).toBe(5);
  const totals=await rows(`SELECT e.id,SUM(l.debit)::numeric AS debit,SUM(l.credit)::numeric AS credit
    FROM journal_entries e JOIN journal_entry_lines l ON l.entry_id=e.id WHERE e.company_id=$1 GROUP BY e.id`,[company]);
  expect(totals.every(t=>t.debit===t.credit)).toBe(true);
  const [ledger]=await rows(`SELECT SUM(l.debit-l.credit)::numeric AS value FROM journal_entry_lines l
    JOIN journal_entries e ON e.id=l.entry_id JOIN accounts a ON a.id=l.account_id
    WHERE e.company_id=$1 AND a.system_key='inventory'`,[company]);
  const [stock]=await rows("SELECT SUM(quantity*avg_cost)::numeric AS value FROM stock_quants WHERE product_id=$1",[product]);
  expect(Number(ledger.value)).toBe(Number(stock.value));
 });
 it("rejects movement during physical counting, including ABA, and accepts a fresh recount",async()=>{
  const id=await open(),p=await prepare(id),n=await balance();
  await move("issue",1);await move("receipt",1,5);
  const before=await proof();ok(await save(id,p,n),409);expect(await proof()).toEqual(before);
  const fresh=await prepare(id);ok(await save(id,fresh,n));
  expect(ok(await close(id))).toEqual({adjustments:0});
 });
 it("expires and binds checkpoints to their source/line; old legacy counts cannot silently post",async()=>{
  const id=await open(),p=await prepare(id),other=await open();
  ok(await save(other,p,1),404);
  await rows("UPDATE stocktake_checkpoints SET expires_at=now()-interval '1 second' WHERE id=$1",[p.checkpointId]);
  ok(await save(id,p,1),409);
  await rows("UPDATE stock_take_lines SET counted_qty=1 WHERE stock_take_id=$1",[id]);
  const before=await proof();ok(await close(id),409);expect(await proof()).toEqual(before);
 });
 it("an older session cannot supersede a newer zero-variance completion; explicit recount is required",async()=>{
  const old=await open(),newer=await open(),n=await balance();
  ok(await save(old,await prepare(old),n-2));ok(await save(newer,await prepare(newer),n));
  expect(ok(await close(newer))).toEqual({adjustments:0});
  const before=await proof();ok(await close(old),409);expect(await proof()).toEqual(before);
  ok(await save(old,await prepare(old),n));expect(ok(await close(old))).toEqual({adjustments:0});
 });
 it("only one of two concurrent overlapping closes can use observations of one generation",async()=>{
  const a=await open(),b=await open(),n=await balance();
  ok(await save(a,await prepare(a),n-1));ok(await save(b,await prepare(b),n-2));
  const before=await proof(),results=await Promise.all([close(a),close(b)]);
  expect(results.map(r=>r.status).sort()).toEqual([200,409]);
  const after=await proof();expect(after.moves.length).toBe(before.moves.length+1);
  expect(after.journals.length).toBe(before.journals.length+1);
 });
 it("concurrent repeats and a lost completion response recover the stored result without repeating effects",async()=>{
  const id=await open(),n=await balance();ok(await save(id,await prepare(id),n+2));
  const before=await proof(),responses=await Promise.all([close(id),close(id)]);
  responses.forEach(r=>expect(ok(r)).toEqual({adjustments:1}));
  const committed=await proof();expect(committed.moves.length).toBe(before.moves.length+1);
  // Treat first response as lost: retry original native endpoint after commit.
  expect(ok(await close(id))).toEqual({adjustments:1});expect(await proof()).toEqual(committed);
 });
 it("retains committed count receipt after movement and checkpoint expiry; same key still means the same count",async()=>{
  const id=await open(),p=await prepare(id),n=await balance(),key=randomUUID();
  ok(await save(id,p,n,key));await move("issue",1);
  await rows("UPDATE stocktake_checkpoints SET expires_at=now()-interval '1 second' WHERE id=$1",[p.checkpointId]);
  const before=await proof(),replay=await save(id,p,n,key);
  ok(replay);expect(replay.headers["idempotency-replayed"]).toBe("true");expect(await proof()).toEqual(before);
  ok(await save(id,p,n+1,key),409);
 });
 it("serializes a normal issue racing a close without dropping or applying either delta twice",async()=>{
  const id=await open(),n=await balance();ok(await save(id,await prepare(id),n-1));
  const before=await proof();
  const [closed]=await Promise.all([close(id),move("issue",2)]);
  expect(ok(closed)).toEqual({adjustments:1});expect(await balance()).toBe(n-3);
  const after=await proof();expect(after.moves.length).toBe(before.moves.length+2);
  expect(after.journals.length).toBe(before.journals.length+2);
 });
 it("preserves both transfer legs around observation without double counting the in-transit stock",async()=>{
  const id=await open(),n=await balance(),p=await prepare(id);ok(await save(id,p,n));
  const sent=await db.transaction(tx=>recordStockMove(tx,{companyId:company,productId:product,
   fromWarehouseId:wh,toWarehouseId:dest,kind:"transfer",state:"in_transit",quantity:2,createdBy:user}));
  expect(ok(await close(id))).toEqual({adjustments:0});expect(await balance()).toBe(n-2);
  await db.transaction(tx=>completeTransfer(tx,sent.moveId,user,company));
  expect(await balance()).toBe(n-2);
  const [target]=await rows("SELECT quantity FROM stock_quants WHERE product_id=$1 AND warehouse_id=$2",[product,dest]);
  expect(Number(target.quantity)).toBe(2);
 });
 it("rechecks the stock state AFTER an actual engine lock wait, rejecting a checkpoint made stale by a committed move",async()=>{
  const id=await open(),p=await prepare(id),n=await balance(),lock=await pool.connect();
  let pending:Promise<request.Response>|undefined;
  try{
   await lock.query("BEGIN");await lock.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`${product}-${wh}-0-0`]);
   const [{pid}]=(await lock.query("SELECT pg_backend_pid() pid")).rows;
   pending=save(id,p,n).then(r=>r);
   await vi.waitFor(async()=>expect((await rows("SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))",[pid])).length).toBeGreaterThan(0),{timeout:5000});
   // Synthetic concurrent writer under the exact engine lock. No client table.
   await lock.query("UPDATE stock_quants SET quantity=quantity-1 WHERE product_id=$1 AND warehouse_id=$2",[product,wh]);
   await lock.query("COMMIT");
   ok(await pending,409);
  }finally{await lock.query("ROLLBACK");lock.release();if(pending)await pending;}
 });
});
