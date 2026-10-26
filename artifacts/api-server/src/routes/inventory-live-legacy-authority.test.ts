import {describe,it,expect} from "vitest";
import {randomUUID} from "node:crypto";
import {db,pool,usersTable,userCompaniesTable,financialRequestsTable} from "@workspace/db";
import {and,eq} from "drizzle-orm";
import {posTemplateFixture,testActor,accepted,fixtureRows} from "../test/pos-template-fixture";

async function fixture(){
 const f=await posTemplateFixture();
 const [user]=await db.insert(usersTable).values({name:"مسؤول مخزون قديم مصطنع",email:`legacy-inventory-${randomUUID()}@example.invalid`,
  passwordHash:f.ownerUser.passwordHash,role:"inventory",isActive:true}).returning();
 await db.insert(userCompaniesTable).values({userId:user.id,companyId:f.companies[0].id,role:"inventory",isDefault:true});
 const actor=testActor();accepted(await actor.post("/api/auth/login").send({email:user.email,password:f.password}));
 return {...f,user,actor};
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
async function inventorySnapshot(f:Fixture){
 return fixtureRows(`SELECT
  (SELECT coalesce(sum(quantity),0)::text FROM stock_quants WHERE product_id=$1) AS quantity,
  (SELECT count(*)::int FROM stock_moves WHERE product_id=$1) AS moves,
  (SELECT count(*)::int FROM journal_entries WHERE company_id=$2) AS journals,
  (SELECT count(*)::int FROM stock_lots WHERE product_id=$1) AS lots,
  (SELECT count(*)::int FROM stock_serials WHERE product_id=$1) AS serials,
  (SELECT count(*)::int FROM reorder_rules WHERE product_id=$1) AS rules,
  (SELECT count(*)::int FROM product_variants WHERE product_id=$1) AS variants,
  (SELECT is_variant_parent FROM products WHERE id=$1) AS variant_parent,
  (SELECT coalesce(jsonb_agg(jsonb_build_object('id',t.id,'status',t.status) ORDER BY t.id),'[]'::jsonb)
   FROM stock_takes t JOIN warehouses w ON w.id=t.warehouse_id WHERE w.company_id=$2) AS takes`,
  [f.products[0].id,f.companies[0].id]);
}
async function revokeWhileWaiting(f:Fixture,request:()=>PromiseLike<unknown>,suspend=false){
 const before=await inventorySnapshot(f),blocker=await pool.connect();
 let released=false;
 try{
  await blocker.query("BEGIN");await blocker.query("SELECT pg_advisory_xact_lock(174223,35)");
  const pending=Promise.resolve(request());
  let observed=false;
  for(let n=0;n<200;n++){
   if((await fixtureRows("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event='advisory' AND query LIKE '%pg_advisory_xact_lock_shared(174223,35)%'")).length){observed=true;break;}
   await new Promise(resolve=>setTimeout(resolve,20));
  }
  expect(observed,"The real operation must wait behind the native authority writer fence").toBe(true);
  if(suspend)await blocker.query("UPDATE users SET is_active=false WHERE id=$1",[f.user.id]);
  else await blocker.query("UPDATE user_companies SET role='sales' WHERE company_id=$1 AND user_id=$2",[f.companies[0].id,f.user.id]);
  await blocker.query("COMMIT");released=true;
  const response=await pending as {status:number;body:unknown};
  expect(response.status,JSON.stringify(response.body)).toBe(403);
  expect(await inventorySnapshot(f)).toEqual(before);
 }finally{if(!released)await blocker.query("ROLLBACK");blocker.release();}
}
describe("Existing inventory writers revalidate legacy authority inside execution",()=>{
 it("preserves a legitimate legacy inventory writer and its confirmed manual-move retry without duplicate stock or GL",async()=>{
  const f=await fixture(),key=randomUUID(),body={kind:"receipt",productId:f.products[0].id,warehouseId:f.warehouses[0].id,quantity:1,unitCost:3};
  const first=accepted(await f.actor.post("/api/inventory/moves").set("Idempotency-Key",key).send(body),201);
  const before=await inventorySnapshot(f);
  const second=accepted(await f.actor.post("/api/inventory/moves").set("Idempotency-Key",key).send(body),201);
  expect(second).toEqual(first);expect(await inventorySnapshot(f)).toEqual(before);
 });
 it("rejects a manual issue whose legacy role was revoked while waiting, with no inventory or accounting effect",async()=>{
  const f=await fixture();
  await revokeWhileWaiting(f,()=>f.actor.post("/api/inventory/moves").set("Idempotency-Key",randomUUID())
   .send({kind:"issue",productId:f.products[0].id,warehouseId:f.warehouses[0].id,quantity:1}));
 });
 it("rejects an already-open legacy session suspended while waiting inside the mutation",async()=>{
  const f=await fixture();
  await revokeWhileWaiting(f,()=>f.actor.post("/api/inventory/moves").set("Idempotency-Key",randomUUID())
   .send({kind:"issue",productId:f.products[0].id,warehouseId:f.warehouses[0].id,quantity:1}),true);
 });
 it("rechecks authority before returning a committed receipt when its retry waited behind the intent lock",async()=>{
  const f=await fixture(),key=randomUUID(),body={kind:"receipt",productId:f.products[0].id,warehouseId:f.warehouses[0].id,quantity:1,unitCost:3};
  accepted(await f.actor.post("/api/inventory/moves").set("Idempotency-Key",key).send(body),201);
  const [receipt]=await db.select().from(financialRequestsTable).where(and(eq(financialRequestsTable.companyId,f.companies[0].id),
   eq(financialRequestsTable.userId,f.user.id),eq(financialRequestsTable.requestKey,key)));
  const intent=JSON.stringify([f.companies[0].id,f.user.id,receipt!.operation,key]),blocker=await pool.connect();
  const before=await inventorySnapshot(f);let released=false;
  try{
   await blocker.query("BEGIN");await blocker.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[intent]);
   const pending=f.actor.post("/api/inventory/moves").set("Idempotency-Key",key).send(body).then(r=>r);
   let observed=false;
   for(let n=0;n<200;n++){
    if((await fixtureRows("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event='advisory' AND query LIKE '%pg_advisory_xact_lock(hashtextextended%'")).length){observed=true;break;}
    await new Promise(resolve=>setTimeout(resolve,20));
   }
   expect(observed).toBe(true);
   await blocker.query("SELECT pg_advisory_xact_lock(174223,35)");
   await blocker.query("UPDATE user_companies SET role='sales' WHERE company_id=$1 AND user_id=$2",[f.companies[0].id,f.user.id]);
   await blocker.query("COMMIT");released=true;
   const response=await pending;expect(response.status,JSON.stringify(response.body)).toBe(403);
   expect(await inventorySnapshot(f)).toEqual(before);
  }finally{if(!released)await blocker.query("ROLLBACK");blocker.release();}
 });
 it("retains the original confirmed outbound transfer for a repeated intent rather than deducting stock twice",async()=>{
  const f=await fixture(),key=randomUUID(),body={productId:f.products[0].id,fromWarehouseId:f.warehouses[0].id,toWarehouseId:f.warehouses[1].id,quantity:1};
  const first=accepted(await f.actor.post("/api/inventory/transfers").set("Idempotency-Key",key).send(body),201);
  const before=await inventorySnapshot(f);
  const repeated=accepted(await f.actor.post("/api/inventory/transfers").set("Idempotency-Key",key).send(body),201);
  expect(repeated).toEqual(first);expect(await inventorySnapshot(f)).toEqual(before);
 });
 it("rejects transfer creation after waiting and revocation without putting stock in transit",async()=>{
  const f=await fixture();
  await revokeWhileWaiting(f,()=>f.actor.post("/api/inventory/transfers").set("Idempotency-Key",randomUUID())
   .send({productId:f.products[0].id,fromWarehouseId:f.warehouses[0].id,toWarehouseId:f.warehouses[1].id,quantity:1}));
 });
 it("rejects stocktake creation after waiting and revocation without creating a partial snapshot",async()=>{
  const f=await fixture();
  await revokeWhileWaiting(f,()=>f.actor.post("/api/inventory/stock-takes").send({warehouseId:f.warehouses[0].id}));
 });
 it("rejects stocktake completion after waiting and revocation without closing it or posting a variance",async()=>{
  const f=await fixture();
  const take=accepted(await f.actor.post("/api/inventory/stock-takes").send({warehouseId:f.warehouses[0].id}),201);
  await revokeWhileWaiting(f,()=>f.actor.post(`/api/inventory/stock-takes/${take.id}/complete`).send({}));
 });
 it("does not turn a valid legacy membership into cross-company warehouse or product authority",async()=>{
  const f=await fixture(),before=await inventorySnapshot(f);
  const result=await f.actor.post("/api/inventory/moves").set("Idempotency-Key",randomUUID()).send({
   kind:"receipt",productId:f.products[1].id,warehouseId:f.warehouses[2].id,quantity:1,unitCost:3});
  expect([403,404]).toContain(result.status);expect(await inventorySnapshot(f)).toEqual(before);
 });
 it.each(["lots","serials","reorder-rules","variants"])("rechecks a waiting legacy %s mutation before any write",async endpoint=>{
  const f=await fixture();
  const payload={productId:f.products[0].id,lotNumber:randomUUID(),serialNumber:randomUUID(),
   currentWarehouseId:f.warehouses[0].id,warehouseId:f.warehouses[0].id,minQty:1,maxQty:5,sku:randomUUID()};
  await revokeWhileWaiting(f,()=>f.actor.post(`/api/inventory/${endpoint}`).send(payload));
 });
 it("saves native lot, serial, rule and variant metadata with atomic source-bound audit and no GL or stock change",async()=>{
  const f=await fixture(),before=(await inventorySnapshot(f))[0]!;
  const operations=[
   ["lots",{productId:f.products[0].id,lotNumber:randomUUID()}],
   ["serials",{productId:f.products[0].id,serialNumber:randomUUID(),currentWarehouseId:f.warehouses[0].id}],
   ["reorder-rules",{productId:f.products[0].id,warehouseId:f.warehouses[0].id,minQty:1,maxQty:5}],
   ["variants",{productId:f.products[0].id,sku:randomUUID(),attributes:{size:"كبير"},price:12,costPrice:3}],
  ] as const;
  for(const [endpoint,payload] of operations)accepted(await f.actor.post(`/api/inventory/${endpoint}`).send(payload),201);
  const after=(await inventorySnapshot(f))[0]!;
  expect([after.quantity,after.moves,after.journals]).toEqual([before.quantity,before.moves,before.journals]);
  expect(after.variant_parent).toBe(true);
  const audits=await fixtureRows("SELECT company_id,entity,details FROM audit_logs WHERE user_id=$1 AND action LIKE 'inventory.%' ORDER BY id",[f.user.id]);
  expect(audits).toHaveLength(4);
  for(const audit of audits){
   expect(audit.company_id).toBe(f.companies[0].id);
   const detail=typeof audit.details==="string"?JSON.parse(audit.details):audit.details;
   expect(Object.keys(detail).sort()).toEqual(["id","membershipRole","responsibilityId"]);
   expect(detail.membershipRole).toBe("inventory");expect(detail.responsibilityId).toBeNull();
  }
 });
 it("rolls back the variant and its parent flag together when the audit cannot commit",async()=>{
  const f=await fixture(),fn=`inventory_audit_failure_${randomUUID().replaceAll("-","")}`,before=await inventorySnapshot(f);
  await pool.query(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$
   BEGIN RAISE EXCEPTION 'isolated inventory audit failure'; END $$`);
  await pool.query(`CREATE TRIGGER ${fn} BEFORE INSERT ON audit_logs FOR EACH ROW
   WHEN(NEW.user_id=${f.user.id} AND NEW.action='inventory.variant.created') EXECUTE FUNCTION ${fn}()`);
  try{
   const result=await f.actor.post("/api/inventory/variants").send({productId:f.products[0].id,sku:randomUUID()});
   expect(result.status).toBe(400);expect(await inventorySnapshot(f)).toEqual(before);
  }finally{await pool.query(`DROP TRIGGER ${fn} ON audit_logs`);await pool.query(`DROP FUNCTION ${fn}()`);}
 });
 it("does not grant the legacy writer surface to a scoped read-only responsibility",async()=>{
  const f=await fixture(),take=accepted(await f.owner.post("/api/inventory/stock-takes").send({warehouseId:f.warehouses[1].id}),201);
  const grant=f.people[0].grants.find((g:{resource:string})=>g.resource==="inventory");
  const before=await inventorySnapshot(f),payload={kind:"receipt",productId:f.products[0].id,warehouseId:f.warehouses[1].id,
   fromWarehouseId:f.warehouses[1].id,toWarehouseId:f.warehouses[0].id,currentWarehouseId:f.warehouses[1].id,
   quantity:1,unitCost:3,lotNumber:randomUUID(),serialNumber:randomUUID(),sku:randomUUID(),minQty:1,maxQty:5};
  for(const path of ["moves","transfers","lots","serials","reorder-rules","variants","stock-takes",`stock-takes/${take.id}/complete`]){
   const response=await f.actors[0].post(`/api/inventory/${path}`).set("X-Workspace-Responsibility",String(grant.id)).send(payload);
   expect(response.status,`${path}: ${JSON.stringify(response.body)}`).toBe(403);
  }
  expect(await inventorySnapshot(f)).toEqual(before);
 });
});
