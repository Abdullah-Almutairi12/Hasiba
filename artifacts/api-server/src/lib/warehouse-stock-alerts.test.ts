import {describe,it,expect} from "vitest";
import {randomUUID} from "node:crypto";
import {db,pool} from "@workspace/db";
import {sql} from "drizzle-orm";
import {posTemplateFixture,personInput,accepted,fixtureRows} from "../test/pos-template-fixture";
import {evaluateWarehouseStockAlerts} from "./warehouse-stock-alerts";
import {recordStockMove} from "./stock-engine";
import {runAlertsCleanup} from "./alerts-cleanup-cron";
type Fixture=Awaited<ReturnType<typeof posTemplateFixture>>;
const payload=(f:Fixture,extra={})=>({productId:f.products[0].id,warehouseId:f.warehouses[0].id,minQty:20,maxQty:100,isActive:false,alertEnabled:true,...extra});
async function grant(f:Fixture,actions=["inventory.read","inventory.reorder.manage"],warehouses=[f.warehouses[0].id]){
 let person=accepted(await f.owner.get("/api/team/people")).find((p:any)=>p.personId===f.people[0].personId);
 person=accepted(await f.owner.put(`/api/team/people/${person.personId}/access`).send({expectedRevision:person.revision,suspended:false,
  person:{...personInput(person),grants:[{resource:"inventory",branchId:f.branches[0].id,warehouseIds:warehouses,actions,
   amountLimit:null,startsAt:new Date(Date.now()-60000).toISOString(),endsAt:null}]}}));
 return String(person.grants[0].id);
}
async function save(f:Fixture,body=payload(f),key=randomUUID()){
 return f.owner.post("/api/inventory/reorder-rules").set("Idempotency-Key",key).send(body);
}
async function cycles(f:Fixture){return fixtureRows("SELECT * FROM warehouse_stock_alert_cycles WHERE product_id=$1 ORDER BY id",[f.products[0].id]);}
async function effects(f:Fixture){return fixtureRows(`SELECT
 (SELECT count(*)::int FROM pos_orders WHERE company_id=$1) orders,
 (SELECT count(*)::int FROM invoices WHERE company_id=$1) invoices,
 (SELECT count(*)::int FROM customer_invoices WHERE company_id=$1) customer_invoices,
 (SELECT count(*)::int FROM pos_order_payments p JOIN pos_orders o ON o.id=p.order_id WHERE o.company_id=$1) payments,
 (SELECT count(*)::int FROM purchase_orders WHERE company_id=$1) purchases,
 (SELECT count(*)::int FROM stock_moves WHERE product_id=$2) moves,
 (SELECT count(*)::int FROM journal_entries WHERE company_id=$1) journals,
 (SELECT coalesce(sum(quantity),0)::text FROM stock_quants WHERE product_id=$2) quantity`,[f.companies[0].id,f.products[0].id]);}
async function move(f:Fixture,quantity:number,kind:"receipt"|"issue"){
 return db.transaction(tx=>recordStockMove(tx,{companyId:f.companies[0].id,productId:f.products[0].id,quantity,unitCost:3,kind,
  ...(kind==="receipt"?{toWarehouseId:f.warehouses[0].id}:{fromWarehouseId:f.warehouses[0].id}),createdBy:f.ownerUser.id}));
}
describe("explicit warehouse stock alerts: transactional, scoped and internal only",()=>{
 it("retention keeps linked cycle evidence while still sweeping unrelated old read alerts without financial effects",async()=>{
  const f=await posTemplateFixture();accepted(await save(f),201);await evaluateWarehouseStockAlerts();
  const [cycle]=await cycles(f);
  await fixtureRows("UPDATE alerts SET is_read=true,created_at=now()-interval '50000 days' WHERE id=$1",[cycle.alert_id]);
  const [ordinary]=await fixtureRows("INSERT INTO alerts(company_id,type,title,message,is_read,created_at) VALUES($1,'retention_fixture','isolated old read alert','unrelated fixture',true,now()-interval '50000 days') RETURNING id",[f.companies[0].id]);
  const before=await effects(f);
  await runAlertsCleanup();
  expect(await fixtureRows("SELECT id FROM alerts WHERE id=$1",[ordinary.id])).toHaveLength(0);
  expect(await fixtureRows("SELECT id FROM alerts WHERE id=$1",[cycle.alert_id])).toHaveLength(1);
  expect(await cycles(f)).toHaveLength(1);expect(await effects(f)).toEqual(before);
 });
 it("new and legacy rules remain unadopted unless explicitly enabled; configuration has no financial effects",async()=>{
  const f=await posTemplateFixture(),before=await effects(f);
  const body:any=payload(f);delete body.alertEnabled;
  accepted(await save(f,body),201);await evaluateWarehouseStockAlerts();
  expect(await cycles(f)).toHaveLength(0);
  const row=accepted(await f.owner.get("/api/inventory/reorder-rules")).find((r:any)=>r.productId===f.products[0].id);
  expect(row.alertEnabled).toBe(false);expect(row.alertAdoptedAt).toBe(null);
  accepted(await save(f),201);await evaluateWarehouseStockAlerts();
  expect(await cycles(f)).toHaveLength(1);expect(await effects(f)).toEqual(before);
 });
 it("21→20 opens one cycle, another warehouse's 100 cannot hide it; concurrent evaluation updates, recovery and relapse retain history",async()=>{
  const f=await posTemplateFixture();
  await move(f,1,"receipt");
  await db.transaction(tx=>recordStockMove(tx,{companyId:f.companies[0].id,productId:f.products[0].id,quantity:100,unitCost:3,kind:"receipt",toWarehouseId:f.extraWarehouse.id}));
  accepted(await save(f),201);await evaluateWarehouseStockAlerts();expect(await cycles(f)).toHaveLength(0);
  await move(f,1,"issue");await Promise.all([evaluateWarehouseStockAlerts(),evaluateWarehouseStockAlerts(),evaluateWarehouseStockAlerts()]);
  expect(await cycles(f)).toMatchObject([{status:"open",quantity:"20.0000"}]);
  await move(f,1,"issue");await Promise.all([evaluateWarehouseStockAlerts(),evaluateWarehouseStockAlerts()]);
  expect(await cycles(f)).toMatchObject([{status:"open",quantity:"19.0000"}]);
  const list=accepted(await f.owner.get("/api/inventory/reorder-rules"));expect(list.find((r:any)=>r.productId===f.products[0].id).onHand).toBe(19);
  await move(f,2,"receipt");await evaluateWarehouseStockAlerts();expect(await cycles(f)).toMatchObject([{status:"recovered",quantity:"21.0000"}]);
  await move(f,1,"issue");await evaluateWarehouseStockAlerts();expect((await cycles(f)).map(c=>c.status)).toEqual(["recovered","open"]);
  const alerts=accepted(await f.owner.get("/api/dashboard/alerts")).filter((a:any)=>a.type==="warehouse_low_stock");
  expect(alerts.some((a:any)=>a.message.includes("20.0000")&&a.message.includes(f.warehouses[0].nameAr))).toBe(true);
 });
 it("disable closes an open cycle and blocks later cycles; old clients cannot silently replace adopted rules",async()=>{
  const f=await posTemplateFixture();accepted(await save(f),201);await evaluateWarehouseStockAlerts();
  const r=accepted(await f.owner.get("/api/inventory/reorder-rules")).find((r:any)=>r.productId===f.products[0].id);
  accepted(await save(f,payload(f,{alertEnabled:false,revision:r.revision})),201);await evaluateWarehouseStockAlerts();
  await move(f,1,"issue");await evaluateWarehouseStockAlerts();
  expect(await cycles(f)).toMatchObject([{status:"disabled"}]);
  const response=accepted(await save(f),201);expect(response).toMatchObject({id:null,rejected:true});
 });
 it("rollback enqueues no false alert; committed dirty work survives a worker gap and produces no extra stock or journals",async()=>{
  const f=await posTemplateFixture();await move(f,1,"receipt");accepted(await save(f),201);await evaluateWarehouseStockAlerts();
  const before=await effects(f);
  await expect(db.transaction(async tx=>{await recordStockMove(tx,{companyId:f.companies[0].id,productId:f.products[0].id,quantity:1,kind:"issue",fromWarehouseId:f.warehouses[0].id});throw new Error("rollback proof");})).rejects.toThrow("rollback proof");
  await evaluateWarehouseStockAlerts();expect(await cycles(f)).toHaveLength(0);expect(await effects(f)).toEqual(before);
  await move(f,1,"issue");
  expect((await fixtureRows("SELECT * FROM warehouse_stock_alert_queue WHERE product_id=$1",[f.products[0].id])).length).toBe(1);
  const committed=await effects(f);await evaluateWarehouseStockAlerts();expect(await cycles(f)).toHaveLength(1);expect(await effects(f)).toEqual(committed);
 });
 it("same intent replays after a lost response; conflicting body and stale revisions cannot mutate the rule or duplicate alerts",async()=>{
  const f=await posTemplateFixture(),key=randomUUID();
  const responses=await Promise.all([save(f,payload(f),key),save(f,payload(f),key)]);
  expect(responses.map(r=>r.status)).toEqual([201,201]);expect(responses[0].body).toEqual(responses[1].body);
  expect((await save(f,payload(f,{minQty:19}),key)).status).toBe(409);
  const r=accepted(await f.owner.get("/api/inventory/reorder-rules")).find((r:any)=>r.productId===f.products[0].id);
  accepted(await save(f,payload(f,{revision:r.revision,maxQty:110})),201);
  const staleKey=randomUUID(),stale=payload(f,{revision:r.revision,maxQty:120});
  expect(accepted(await save(f,stale,staleKey),201).rejected).toBe(true);
  expect(accepted(await save(f,stale,staleKey),201).rejected).toBe(true);
  await evaluateWarehouseStockAlerts();expect(await cycles(f)).toHaveLength(1);
  expect(accepted(await f.owner.get("/api/inventory/reorder-rules"))[0].maxQty).toBe(110);
 });
 it("read and manage are separate, bounded to one company/branch/warehouse; no costs; active sessions lose revoked grants",async()=>{
  const f=await posTemplateFixture(),id=await grant(f);
  const request=f.actors[0];
  accepted(await request.post("/api/inventory/reorder-rules").set("X-Workspace-Responsibility",id).set("Idempotency-Key",randomUUID()).send(payload(f)),201);
  await evaluateWarehouseStockAlerts();
  const rows=accepted(await request.get("/api/inventory/reorder-rules").set("X-Workspace-Responsibility",id));
  expect(rows).toHaveLength(1);expect(JSON.stringify(rows)).not.toMatch(/avgCost|unitCost|cost_price/);
  const options=accepted(await request.get("/api/inventory/reorder-options").set("X-Workspace-Responsibility",id));
  expect(options.warehouses.map((w:any)=>w.id)).toEqual([f.warehouses[0].id]);
  expect(options.products.map((p:any)=>p.id)).toEqual([f.products[0].id]);
  expect(JSON.stringify(options)).not.toMatch(/cost|price|stock|quantity/i);
  for(const body of [payload(f,{warehouseId:f.extraWarehouse.id}),payload(f,{warehouseId:f.warehouses[1].id})]){
   expect((await request.post("/api/inventory/reorder-rules").set("X-Workspace-Responsibility",id).send(body)).status).toBe(403);
  }
  expect((await request.post("/api/inventory/reorder-rules").set("X-Workspace-Responsibility",id)
   .send(payload(f,{productId:f.products[1].id,warehouseId:f.warehouses[2].id}))).status).toBe(404);
  const read=await grant(f,["inventory.read"]);
  expect((await request.post("/api/inventory/reorder-rules").set("X-Workspace-Responsibility",read).send(payload(f))).status).toBe(403);
  expect(accepted(await request.get("/api/inventory/reorder-rules").set("X-Workspace-Responsibility",read))).toHaveLength(1);
  const other=await grant(f,["inventory.read"],[f.extraWarehouse.id]);
  expect(accepted(await request.get("/api/inventory/reorder-rules").set("X-Workspace-Responsibility",other))).toEqual([]);
  expect(accepted(await request.get("/api/dashboard/alerts").set("X-Workspace-Responsibility",other)).filter((a:any)=>a.type==="warehouse_low_stock")).toEqual([]);
  expect((await request.get("/api/inventory/reorder-rules").set("X-Workspace-Responsibility",id)).status).toBe(403);
 });
 it("writer rechecks authority after a PostgreSQL lock wait",async()=>{
  const f=await posTemplateFixture(),id=await grant(f),blocker=await pool.connect();
  try{
   await pool.query("UPDATE responsibility_grants SET ends_at=clock_timestamp()+interval '2 seconds' WHERE id=$1",[Number(id)]);
   await blocker.query("BEGIN");
   await blocker.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`reorder-rule:${f.products[0].id}:${f.warehouses[0].id}`]);
   const pending=f.actors[0].post("/api/inventory/reorder-rules").set("X-Workspace-Responsibility",id).send(payload(f)).then(r=>r);
   let waiting=false;
   for(let i=0;i<150;i++){if((await fixtureRows("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event='advisory' AND query LIKE '%pg_advisory_xact_lock(hashtextextended%'")).length){waiting=true;break;}await new Promise(r=>setTimeout(r,20));}
   expect(waiting).toBe(true);
   // Do NOT reverse the production authority->source lock order in this
   // fixture. Prove expiration while the real source lock remains held.
   await new Promise(r=>setTimeout(r,2100));
   await blocker.query("COMMIT");
   const response=await pending;
   expect({status:response.status,error:response.status===403?undefined:response.body}).toEqual({status:403,error:undefined});
   expect(await fixtureRows("SELECT * FROM reorder_rules WHERE product_id=$1",[f.products[0].id])).toHaveLength(0);
  }finally{await blocker.query("ROLLBACK");blocker.release();}
 });
 it("tracked, variant parents and cross-tenant references cannot adopt ordinary-stock alerts",async()=>{
  const f=await posTemplateFixture();
  await db.execute(sql`UPDATE products SET tracking_mode='lot' WHERE id=${f.products[0].id}`);
  expect((await save(f)).status).toBe(409);
  await db.execute(sql`UPDATE products SET tracking_mode='none',is_variant_parent=true WHERE id=${f.products[0].id}`);
  expect((await save(f)).status).toBe(409);
  expect((await save(f,payload(f,{productId:f.products[1].id}))).status).toBe(404);
 });
});
