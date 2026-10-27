import {beforeAll,afterAll,describe,it,expect} from "vitest";
import {randomUUID} from "node:crypto";
import {writeFileSync,mkdirSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {resolve} from "node:path";
import bcrypt from "bcryptjs";
import {db,usersTable,userCompaniesTable} from "@workspace/db";
import {posTemplateFixture,personInput,testActor,accepted, type PosTemplateFixture} from "../test/pos-template-fixture";
import {orderedRace,reconcile,lockRows as rows} from "../test/inventory-lock-barrier";
import {recordStockMove} from "../lib/stock-engine";

let f:PosTemplateFixture,reviewer:ReturnType<typeof testActor>;
const evidence:unknown[]=[];
const inventoryActions=["inventory.read","inventory.move.receipt","inventory.move.issue","inventory.transfer.send","inventory.transfer.receive"];
const warehouse=()=>f.warehouses[1].id,destination=()=>f.warehouses[0].id;
const key=(id:number,wh=warehouse(),variant=0)=>`${id}-${wh}-${variant}-0`;
const grantId=(i=0,wh=warehouse())=>f.people[i].grants.find((g:any)=>g.warehouseIds.includes(wh)).id;
const move=(id:number,kind="issue",wh=warehouse(),variantId?:number,intent=randomUUID())=>f.actors[0].post("/api/inventory/moves")
 .set("X-Workspace-Responsibility",String(grantId(0,wh))).set("Idempotency-Key",intent)
 .send({productId:id,warehouseId:wh,kind,quantity:2,notes:"اختبار ترتيب الأقفال",...(variantId?{variantId}:{})}).then(r=>r);
const legacy=(id:number)=>f.owner.post("/api/inventory/moves").set("Idempotency-Key",randomUUID())
 .send({productId:id,warehouseId:warehouse(),kind:"issue",quantity:2}).then(r=>r);
const receive=(id:number,wh=warehouse(),intent=randomUUID())=>f.actors[1].post(`/api/inventory/transfers/${id}/receive`)
 .set("X-Workspace-Responsibility",String(grantId(1,wh))).set("Idempotency-Key",intent)
 .send({receiptReference:"وصول موثق لاختبار الأقفال"}).then(r=>r);
const close=(id:number)=>reviewer.post(`/api/inventory/stock-takes/${id}/complete`).send({}).then(r=>r);
async function product(variant=false){
 const [p]=await rows(`INSERT INTO products(company_id,category_id,name,name_ar,sku,price,cost_price,stock,min_stock,costing_method,is_variant_parent)
  SELECT company_id,category_id,$1,$1,$1,10,3,0,0,'fifo',$2 FROM products WHERE id=$3 RETURNING id`,
  [`lock-${randomUUID()}`,variant,f.products[0].id]);
 let variantId: number|undefined;
 if(variant)variantId=(await rows("INSERT INTO product_variants(product_id,sku,cost_price,attributes) VALUES($1,$2,3,'{\"color\":\"blue\"}') RETURNING id",[p.id,randomUUID()]))[0].id;
 for(const wh of [warehouse(),destination()])await db.transaction(tx=>recordStockMove(tx,{
  companyId:f.companies[0].id,productId:p.id,variantId,toWarehouseId:wh,quantity:20,unitCost:3,kind:"receipt",createdBy:f.ownerUser.id,sourceType:"lock_fixture"}));
 return {id:p.id,variantId};
}
async function counted(id:number){
 const take=accepted(await f.owner.post("/api/inventory/stock-takes").send({warehouseId:warehouse()}),201);
 const point=accepted(await f.owner.post(`/api/inventory/stock-takes/${take.id}/checkpoint`).send({productId:id}));
 accepted(await f.owner.patch(`/api/inventory/stock-takes/${take.id}/lines/${point.lineId}`)
  .set("Idempotency-Key",randomUUID()).send({countedQty:19,checkpointId:point.checkpointId,expectedRevision:point.expectedRevision}));
 return take.id as number;
}
async function incoming(p:{id:number;variantId?:number},to=warehouse()){
 return db.transaction(tx=>recordStockMove(tx,{companyId:f.companies[0].id,productId:p.id,variantId:p.variantId,
  fromWarehouseId:to===warehouse()?destination():warehouse(),toWarehouseId:to,kind:"transfer",state:"in_transit",quantity:2,createdBy:f.ownerUser.id,sourceType:"lock_fixture"}));
}
beforeAll(async()=>{
 f=await posTemplateFixture();
 for(let i=0;i<2;i++){
  const input=personInput(f.people[i]);input.deniedActions=[];
  input.grants=[0,1].map(n=>({resource:"inventory",branchId:f.branches[n].id,warehouseIds:[f.warehouses[n].id],
   actions:i===0?inventoryActions:["inventory.read","inventory.transfer.receive"],amountLimit:"500",startsAt:null,endsAt:null}));
  accepted(await f.owner.put(`/api/team/people/${f.people[i].personId}/access`).send({person:input,expectedRevision:f.people[i].revision,suspended:false}));
  f.people[i]=accepted(await f.owner.get("/api/team/people")).find((p:any)=>p.personId===f.people[i].personId);
 }
 const [u]=await db.insert(usersTable).values({name:"معتمد جرد مستقل لاختبار الأقفال",email:`lock-review-${randomUUID()}@example.invalid`,
  passwordHash:await bcrypt.hash(f.password,4),role:"owner",isActive:true,has2fa:false}).returning();
 await db.insert(userCompaniesTable).values({companyId:f.companies[0].id,userId:u.id,role:"owner",isDefault:true});
 reviewer=testActor();accepted(await reviewer.post("/api/auth/login").send({email:u.email,password:f.password}));
});
afterAll(()=>{
 const root=resolve(import.meta.dirname,"../../../.."),out=resolve(root,"generated-artifacts/inventory-lock-order");
 mkdirSync(out,{recursive:true});
 const phase=process.env.LOCK_EVIDENCE_PHASE??"current";expect(phase).toMatch(/^[a-z-]+$/);
 writeFileSync(resolve(out,`concurrency-${phase}.json`),JSON.stringify({
  phase,commit:execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim(),
  syntheticOnly:true,barrier:"PostgreSQL advisory lock plus observed pg_blocking_pids; both requests drained",cases:evidence},null,2));
});
function responses(r:Awaited<ReturnType<typeof orderedRace>>,name:string){
 const replies=r.results.map(x=>x.status==="fulfilled"?x.value as any:{status:0,body:{error:String(x.reason)}});
 evidence.push({name,firstWait:r.firstWait,bothWait:r.bothWait,cycle:r.cycle,replies:replies.map(x=>({status:x.status,body:x.body}))});
 expect(r.cycle,JSON.stringify(r.cycle)).toEqual([]);
 return replies;
}
async function proof(id:number){
 const result=await reconcile(id,f.companies[0].id);
 evidence.push({name:"independent-reconciliation",productId:id,proof:result});
 expect(result.checks).toEqual({balanced:true,valueMatches:true,layersMatch:true,noOpenTransactions:true});
 return result;
}
describe("native stock/count resource lock order with deterministic PostgreSQL barriers",()=>{
 for(const movementFirst of [false,true])for(const kind of ["issue","receipt"]){
  it(`${kind}: delegated movement ${movementFirst?"before":"after"} a real variance close`,async()=>{
   const p=await product(),take=await counted(p.id),intent=randomUUID();
   const movement=()=>move(p.id,kind,warehouse(),undefined,intent),closing=()=>close(take);
   const r=await orderedRace(key(p.id),movementFirst?movement:closing,movementFirst?closing:movement);
   const replies=responses(r,`${kind}-close-${movementFirst}`);accepted(replies[movementFirst?0:1],201);accepted(replies[movementFirst?1:0]);
   const reconciled=await proof(p.id);
   expect(Number(reconciled.quants.find(q=>q.warehouse_id===warehouse()).quantity)).toBe(kind==="issue"?17:21);
   expect(reconciled.moves.length).toBe(4);expect(reconciled.journals.length).toBe(4);
   expect(Object.keys(replies[movementFirst?0:1].body).sort()).toEqual(["moveId","moveIds"]);
   accepted(await movement(),201);accepted(await closing());
   expect(await proof(p.id)).toEqual(reconciled);
  });
 }
 for(const movementFirst of [false,true]){
  for(const scoped of [false,true]){
   it(`native inbound ${movementFirst?"after":"before"} ${scoped?"delegated":"legacy"} issue keeps FK locks compatible`,async()=>{
    const p=await product(),a=()=>scoped?move(p.id):legacy(p.id);
    const b=()=>db.transaction(tx=>recordStockMove(tx,{companyId:f.companies[0].id,productId:p.id,toWarehouseId:warehouse(),
     kind:"receipt",quantity:2,unitCost:3,sourceType:"lock_native_receipt",createdBy:f.ownerUser.id})).then(body=>({status:201,body}));
    const r=await orderedRace(key(p.id),movementFirst?a:b,movementFirst?b:a);
    for(const reply of responses(r,`native-inbound-${scoped}-${movementFirst}`))accepted(reply,201);
    const reconciled=await proof(p.id);
    expect(Number(reconciled.quants.find(q=>q.warehouse_id===warehouse()).quantity)).toBe(20);
    expect(reconciled.moves.length).toBe(4);
   });
  }
  it(`opposite warehouse dispatches ${movementFirst?"high":"low"} first use one resource order`,async()=>{
   const p=await product();
   const dispatch=(from:number,to:number)=>f.actors[0].post("/api/inventory/transfers")
    .set("X-Workspace-Responsibility",String(grantId(0,from))).set("Idempotency-Key",randomUUID())
    .send({productId:p.id,fromWarehouseId:from,toWarehouseId:to,quantity:2,
     destinationResponsibilityId:grantId(0,to),notes:"اختبار تحويلين باتجاهين"}).then(r=>r);
   const a=()=>dispatch(warehouse(),destination()),b=()=>dispatch(destination(),warehouse());
   const r=await orderedRace(key(p.id,Math.min(warehouse(),destination())),movementFirst?a:b,movementFirst?b:a);
   for(const reply of responses(r,`opposite-dispatch-${movementFirst}`))accepted(reply,201);
   const reconciled=await proof(p.id);
   expect(reconciled.quants.every(q=>Number(q.quantity)===18)).toBe(true);
   expect(reconciled.moves.filter(m=>m.state==="in_transit").length).toBe(2);
  });
  it(`delegated issue ${movementFirst?"before":"after"} legacy ordinary issue`,async()=>{
   const p=await product(),a=()=>move(p.id),b=()=>legacy(p.id);
   const r=await orderedRace(key(p.id),movementFirst?a:b,movementFirst?b:a);
   for(const reply of responses(r,`legacy-${movementFirst}`))accepted(reply,201);
   const reconciled=await proof(p.id);
   expect(Number(reconciled.quants.find(q=>q.warehouse_id===warehouse()).quantity)).toBe(16);expect(reconciled.moves.length).toBe(4);
  });
  it(`transfer arrival ${movementFirst?"before":"after"} real variance close`,async()=>{
   const p=await product(),take=await counted(p.id),t=await incoming(p),intent=randomUUID();
   const a=()=>receive(t.moveId,warehouse(),intent),b=()=>close(take);
   const r=await orderedRace(key(p.id),movementFirst?a:b,movementFirst?b:a);
   for(const reply of responses(r,`arrival-close-${movementFirst}`))accepted(reply);
   const reconciled=await proof(p.id);
   expect(Number(reconciled.quants.find(q=>q.warehouse_id===warehouse()).quantity)).toBe(21);expect(reconciled.moves.length).toBe(4);
   expect(reconciled.moves.find(m=>m.id===t.moveId).state).toBe("done");
   accepted(await a());accepted(await b());expect(await proof(p.id)).toEqual(reconciled);
  });
  it(`variant arrival ${movementFirst?"before":"after"} native variant issue without counting variants`,async()=>{
   const p=await product(true),t=await incoming(p,destination());
   const a=()=>receive(t.moveId,destination()),b=()=>db.transaction(tx=>recordStockMove(tx,{
    companyId:f.companies[0].id,productId:p.id,variantId:p.variantId,fromWarehouseId:destination(),quantity:2,kind:"issue",
    createdBy:f.ownerUser.id,sourceType:"lock_native_issue"})).then(body=>({status:201,body}));
   const r=await orderedRace(key(p.id,destination(),p.variantId),movementFirst?a:b,movementFirst?b:a);
   const replies=responses(r,`variant-arrival-${movementFirst}`);accepted(replies[movementFirst?0:1]);accepted(replies[movementFirst?1:0],201);
   const reconciled=await proof(p.id);
   expect(Number(reconciled.quants.find(q=>q.warehouse_id===destination()).quantity)).toBe(20);expect(reconciled.moves.length).toBe(4);
  });
 }
});
