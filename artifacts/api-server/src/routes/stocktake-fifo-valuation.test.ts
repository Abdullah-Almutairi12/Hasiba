import {beforeAll,describe,it,expect} from "vitest";
import {randomUUID} from "node:crypto";
import {db} from "@workspace/db";
import {posTemplateFixture,personInput,accepted as ok,fixtureRows as rows,type PosTemplateFixture} from "../test/pos-template-fixture";
import {recordStockMove} from "../lib/stock-engine";
import {reconcile} from "../test/inventory-lock-barrier";
let f:PosTemplateFixture,people:any[];
async function configure(i:number,cap:string){
 const p=ok(await f.owner.get("/api/team/people")).find((x:any)=>x.personId===people[i].personId);
 people[i]=ok(await f.owner.put(`/api/team/people/${p.personId}/access`).send({expectedRevision:p.revision,suspended:false,
  person:{...personInput(p),deniedActions:[],grants:[{resource:"inventory",branchId:f.branches[1].id,
   warehouseIds:[f.warehouses[1].id],actions:["inventory.read",i===0?"inventory.stocktake.count":i===1?"inventory.stocktake.approve":"inventory.stocktake.post"],
   amountLimit:i===0?null:cap,startsAt:null,endsAt:null}]}}));
}
const call=(i:number,path:string)=>f.actors[i].post(`/api/inventory/stock-takes/${path}`)
 .set("X-Workspace-Responsibility",String(people[i].grants[0].id));
const approve=(id:number)=>call(1,`${id}/approve`).send({reason:"مراجعة تكلفة FIFO الفعلية"});
const close=(id:number)=>call(2,`${id}/complete`).send({});
async function move(productId:number,quantity:number,kind:"issue"|"receipt",unitCost?:number){
 return db.transaction(tx=>recordStockMove(tx,{companyId:f.companies[0].id,productId,quantity,kind,unitCost,
  ...(kind==="receipt"?{toWarehouseId:f.warehouses[1].id}:{fromWarehouseId:f.warehouses[1].id}),
  sourceType:"fifo_valuation_fixture",createdBy:f.ownerUser.id}));
}
async function scenario(delta:number){
 const [p]=await rows(`INSERT INTO products(company_id,category_id,name,name_ar,sku,price,cost_price,stock,min_stock,costing_method)
  SELECT company_id,category_id,$1,$1,$1,10,3,0,0,'fifo' FROM products WHERE id=$2 RETURNING id`,[randomUUID(),f.products[0].id]);
 await move(p.id,2,"receipt",2);await move(p.id,3,"receipt",8);
 const take=ok(await f.owner.post("/api/inventory/stock-takes").send({warehouseId:f.warehouses[1].id}),201);
 const point=ok(await call(0,`${take.id}/checkpoint`).send({productId:p.id}));
 ok(await f.actors[0].patch(`/api/inventory/stock-takes/${take.id}/lines/${point.lineId}`)
  .set("X-Workspace-Responsibility",String(people[0].grants[0].id)).set("Idempotency-Key",randomUUID())
  .send({countedQty:point.expectedQty+delta,checkpointId:point.checkpointId,expectedRevision:point.expectedRevision}));
 return {product:p.id,take:take.id};
}
async function proof(product:number,value:number,qty:number){
 const p=await reconcile(product,f.companies[0].id);
 expect(p.checks).toEqual({balanced:true,valueMatches:true,layersMatch:true,noOpenTransactions:true});
 expect(Number(p.values.stock)).toBe(value);expect(Number(p.values.ledger)).toBe(value);
 expect(Number(p.quants[0].quantity)).toBe(qty);
 return p;
}
beforeAll(async()=>{f=await posTemplateFixture();people=[...f.people];for(let i=0;i<3;i++)await configure(i,"100");});
describe("native FIFO stocktake financial facts without historical revaluation",()=>{
 it("uses consumed FIFO cost 12, not warehouse mean 16.8, for the approval cap and native posting",async()=>{
  const s=await scenario(-3);await configure(1,"13");await configure(2,"13");
  const before=await proof(s.product,28,5);ok(await approve(s.take));
  expect(await proof(s.product,28,5)).toEqual(before);
  const [take]=await rows("SELECT variance_review FROM stock_takes WHERE id=$1",[s.take]);
  expect(Number(take.variance_review.amount)).toBe(12);
  ok(await close(s.take));const after=await proof(s.product,16,2);
  expect(after.moves.filter(m=>m.source_type==="stocktake").map(m=>[Number(m.quantity),Number(m.unit_cost)])).toEqual([[3,4]]);
  expect(after.moves.slice(0,2)).toEqual(before.moves);
  const copy=await Promise.all([close(s.take),close(s.take)]);copy.forEach(r=>ok(r));
  expect(await proof(s.product,16,2)).toEqual(after);
 });
 it("invalidates approval when FIFO changes at unchanged quantity and average, and enforces the new 18 cap",async()=>{
  await configure(1,"100");await configure(2,"100");
  const s=await scenario(-3);ok(await approve(s.take));
  await move(s.product,1,"issue");await move(s.product,1,"receipt",2);
  const before=await proof(s.product,28,5);
  const stored=await rows("SELECT variance_review FROM stock_takes WHERE id=$1",[s.take]);
  ok(await close(s.take),409);expect(await proof(s.product,28,5)).toEqual(before);
  expect(await rows("SELECT variance_review FROM stock_takes WHERE id=$1",[s.take])).toEqual(stored);
  await configure(1,"13");ok(await approve(s.take),403);
  await configure(1,"18");ok(await approve(s.take));await configure(2,"17");ok(await close(s.take),403);
  await configure(2,"18");ok(await close(s.take));await proof(s.product,10,2);
 });
 it("preserves the existing carrying-cost policy for a positive FIFO observation and opens its native layer",async()=>{
  await configure(1,"100");await configure(2,"100");
  const s=await scenario(1);ok(await approve(s.take));ok(await close(s.take));await proof(s.product,33.6,6);
  const layers=await rows("SELECT unit_cost::text,remaining_qty::text FROM stock_layers WHERE product_id=$1 ORDER BY id",[s.product]);
  expect(layers.map(l=>[Number(l.unit_cost),Number(l.remaining_qty)])).toEqual([[2,2],[8,3],[5.6,1]]);
 });
 it("does not repair missing or inconsistent historical FIFO evidence through a stocktake",async()=>{
  const s=await scenario(-1);
  await rows("UPDATE stock_layers SET unit_cost=unit_cost+1 WHERE product_id=$1",[s.product]);
  const before=await rows("SELECT * FROM stock_layers WHERE product_id=$1 ORDER BY id",[s.product]);
  ok(await approve(s.take),409);
  expect(await rows("SELECT * FROM stock_layers WHERE product_id=$1 ORDER BY id",[s.product])).toEqual(before);
  expect(await rows("SELECT id FROM stock_moves WHERE source_type='stocktake' AND source_id=$1",[s.take])).toEqual([]);
 });
});
