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
let clientAddress=1;
const agent=()=>request.agent(app).set("X-Forwarded-For",`198.18.82.${clientAddress++}`);
const ok=(r:request.Response,status=200)=>{expect(r.status,JSON.stringify(r.body)).toBe(status);return r.body;};
const rows=async(q:string,v:unknown[]=[])=> (await pool.query(q,v)).rows;
const actions=["inventory.read","inventory.move.receipt","inventory.move.issue","inventory.transfer.send"];
const grant=(wh=warehouse,b=branch,a=actions,limit:string|null=null)=>({
 resource:"inventory",branchId:b,warehouseIds:[wh],actions:a,amountLimit:limit,startsAt:null,endsAt:null,
});
describe("untracked variants through existing scoped stock services",()=>{
 async function variantProduct(method="average"){
  const [p]=await rows(`INSERT INTO products(company_id,name,name_ar,sku,category_id,price,cost_price,stock,unit,min_stock,
   is_variant_parent,tracking_mode,costing_method) SELECT $1,$2,$2,$2,category_id,50,99,0,'pcs',0,true,'none',$3
   FROM products WHERE id=$4 RETURNING id`,[company,`variant-${randomUUID()}`,method,product]);
  const variants=await rows(`INSERT INTO product_variants(product_id,sku,attributes,cost_price) VALUES
   ($1,$2,'{"color":"blue","size":"L"}',7),($1,$3,'{"color":"red","size":"M"}',11) RETURNING id`,
   [p.id,`blue-${randomUUID()}`,`red-${randomUUID()}`]);
  return {id:p.id,blue:variants[0].id,red:variants[1].id};
 }
 const body=(v:{id:number;blue:number},kind="receipt",quantity=10)=>({...payload(kind),productId:v.id,variantId:v.blue,quantity});
 const state=async(id:number)=>({
  quants:await rows("SELECT warehouse_id,variant_id,quantity::text,avg_cost::text FROM stock_quants WHERE product_id=$1 ORDER BY warehouse_id,variant_id",[id]),
  moves:await rows("SELECT id,variant_id,state,quantity::text,unit_cost::text FROM stock_moves WHERE product_id=$1 ORDER BY id",[id]),
  journals:await rows(`SELECT j.id,l.account_id,l.debit::text,l.credit::text FROM journal_entries j JOIN journal_entry_lines l ON l.entry_id=j.id
   WHERE j.id IN(SELECT journal_entry_id FROM stock_moves WHERE product_id=$1) ORDER BY j.id,l.id`,[id]),
 });
 const receive=(a:Actor,id:number,key=randomUUID())=>a.agent.post(`/api/inventory/transfers/${id}/receive`)
  .set("X-Workspace-Responsibility",String(a.grants.find(g=>g.branchId===otherBranch)?.id??a.grants[0].id))
  .set("Idempotency-Key",key).send({receiptReference:"إثبات استلام متغير مصطنع"});
 for(const method of ["average","fifo","standard"]){
  it(`keeps variant quantity and native ${method} carrying value through receipt, issue, transit and arrival`,async()=>{
   const v=await variantProduct(method),a=await member([...actions,"inventory.transfer.receive"],null,true);
   ok(await send(a,body(v)),201);ok(await send(a,{...body(v),variantId:v.red,quantity:5}),201);
   // Catalog edits are prospective, not a revaluation of existing stock.
   await rows("UPDATE product_variants SET cost_price=17 WHERE id=$1",[v.blue]);
   const issue=ok(await send(a,body(v,"issue",2)),201);
   const t=ok(await send(a,{...transferBody(a),productId:v.id,variantId:v.blue} as never,randomUUID(),"transfers"),201);
   const inTransit=await state(v.id);
   expect(inTransit.quants.map(q=>[q.variant_id,Number(q.quantity),Number(q.avg_cost)])).toEqual([[v.blue,6,7],[v.red,5,11]]);
   expect(inTransit.moves.find(m=>m.id===t.moveId)).toMatchObject({variant_id:v.blue,state:"in_transit"});
   expect(Number(inTransit.moves.find(m=>m.id===issue.moveId).unit_cost)).toBe(7);
   expect(Number(inTransit.moves.find(m=>m.id===t.moveId).unit_cost)).toBe(7);
   ok(await receive(a,t.moveId));const done=await state(v.id);
   expect(done.quants.map(q=>[q.warehouse_id,q.variant_id,Number(q.quantity),Number(q.avg_cost)]))
    .toEqual([[warehouse,v.blue,6,7],[warehouse,v.red,5,11],[destination,v.blue,2,7]]);
   expect(done.moves.length).toBe(4);expect(done.journals.length).toBeGreaterThan(0);
   const value=await rows(`SELECT (SELECT sum(quantity*avg_cost) FROM stock_quants WHERE product_id=$1)::text AS stock,
    (SELECT sum(l.debit-l.credit) FROM journal_entry_lines l JOIN journal_entries j ON j.id=l.entry_id
     JOIN accounts a ON a.id=l.account_id WHERE a.system_key='inventory'
     AND j.id IN(SELECT journal_entry_id FROM stock_moves WHERE product_id=$1))::text AS ledger`,[v.id]);
   expect(Number(value[0].stock)).toBe(111);expect(Number(value[0].ledger)).toBe(111);
   if(method==="fifo"){
    const layers=await rows("SELECT sum(remaining_qty*unit_cost)::text AS value FROM stock_layers WHERE product_id=$1",[v.id]);
    expect(Number(layers[0].value)).toBe(111);
   }
  });
 }
 it("requires the real variant, rejects cross-product/company/inactive/tracked references and never mutates the parent quant",async()=>{
  const v=await variantProduct(),other=await variantProduct(),a=await member();
  const before=await state(v.id);
  ok(await send(a,{...payload("receipt"),productId:v.id}),409);
  ok(await owner.post("/api/inventory/moves").send(body(v)),409);
  ok(await owner.post("/api/inventory/transfers").send({...transferBody(a),productId:v.id,variantId:v.blue}),409);
  ok(await send(a,{...body(v),variantId:other.blue}),403);
  const [foreignVariant]=await rows("INSERT INTO product_variants(product_id,sku,cost_price) VALUES($1,$2,7) RETURNING id",
   [foreignProduct,`foreign-variant-${randomUUID()}`]);
  ok(await send(a,{...body(v),variantId:foreignVariant.id}),404);
  ok(await send(a,{...body(v),productId:foreignProduct}),404);
  ok(await send(a,{...body(v),warehouseId:foreignWh}),404);
  ok(await send(a,{...body(v),warehouseId:destination}),403);
  await rows("UPDATE product_variants SET is_active=false WHERE id=$1",[v.blue]);ok(await send(a,body(v)),403);
  await rows("UPDATE product_variants SET is_active=true WHERE id=$1",[v.blue]);
  await rows("UPDATE products SET tracking_mode='lot' WHERE id=$1",[v.id]);ok(await send(a,body(v)),409);
  expect(await state(v.id)).toEqual(before);
  const noGrant=await member(["inventory.read"]);
  ok(await send(noGrant,body(other)),403);
  ok(await noGrant.agent.post("/api/inventory/variants").send({productId:other.id,sku:randomUUID()}),403);
 });
 it("calculates caps from variant cost without exposing financial fields and enforces source and destination caps",async()=>{
  const v=await variantProduct(),a=await member([...actions,"inventory.transfer.receive"],"13",true);
  ok(await send(a,body(v,"receipt",2)),403);
  ok(await send(a,body(v,"receipt",1)),201);
  const options=ok(await a.agent.get("/api/workspace/inventory/movement-options").set("X-Workspace-Responsibility",String(a.grants[0].id)));
  const p=options.products.find((p:{id:number})=>p.id===v.id);expect(p.requiresVariant).toBe(true);
  expect(p.variants.map((v:{id:number})=>v.id)).toEqual([v.blue,v.red]);
  expect(JSON.stringify(options)).not.toMatch(/cost|value|price/i);
  await rows("UPDATE responsibility_grants SET amount_limit=6 WHERE id=$1",[a.grants.find(g=>g.branchId===otherBranch)!.id]);
  ok(await send(a,{...transferBody(a),quantity:1,productId:v.id,variantId:v.blue} as never,randomUUID(),"transfers"),403);
  await rows("UPDATE responsibility_grants SET amount_limit=13 WHERE id=$1",[a.grants.find(g=>g.branchId===otherBranch)!.id]);
  const t=ok(await send(a,{...transferBody(a),quantity:1,productId:v.id,variantId:v.blue} as never,randomUUID(),"transfers"),201);
  const receiver=a.grants.find(g=>g.branchId===otherBranch)!;
  await rows("UPDATE responsibility_grants SET amount_limit=6 WHERE id=$1",[receiver.id]);
  ok(await receive(a,t.moveId),403);
  const incoming=ok(await a.agent.get("/api/workspace/inventory/transfers").set("X-Workspace-Responsibility",String(receiver.id)));
  expect(incoming.transfers.find((x:{id:number})=>x.id===t.moveId)).toMatchObject({variantId:v.blue,unit:"pcs"});
  expect(JSON.stringify(incoming)).not.toMatch(/cost|value|price/i);
  // A receiver-only responsibility may have its own finite ceiling; sending
  // is not required or implicitly granted to authorize this limit.
  const receiverOnly=await member(["inventory.read","inventory.transfer.receive"],"13");
  expect(receiverOnly.grants).toHaveLength(1);
  const balances=ok(await a.agent.get("/api/workspace/inventory").set("X-Workspace-Responsibility",String(a.grants[0].id)));
  const balance=balances.find((b:{productId:number})=>b.productId===v.id);
  expect(balance).toMatchObject({variantId:v.blue,unit:"pcs",cost:null});
  expect(balance.quantId).toBeGreaterThan(0);
 });
 it("deduplicates concurrent receipt/issue/transfer and recovers the same confirmed result without the execution grant",async()=>{
  const v=await variantProduct(),a=await member([...actions,"inventory.transfer.receive"],null,true);
  for(const kind of ["receipt","issue"]){
   const key=randomUUID(),b=body(v,kind,kind==="receipt"?10:2);
   const rs=await Promise.all([send(a,b,key),send(a,b,key),send(a,b,key)]);rs.forEach(r=>ok(r,201));
   expect(rs[0].body).toEqual(rs[2].body);
   const before=await state(v.id);ok(await send(a,b,key),201);expect(await state(v.id)).toEqual(before);
  }
  const key=randomUUID(),b={...transferBody(a),productId:v.id,variantId:v.blue};
  const rs=await Promise.all([send(a,b as never,key,"transfers"),send(a,b as never,key,"transfers")]);rs.forEach(r=>ok(r,201));
  const t=rs[0].body,receiptKey=randomUUID();
  const incoming=await Promise.all([receive(a,t.moveId,receiptKey),receive(a,t.moveId,receiptKey)]);incoming.forEach(r=>ok(r));
  const done=await state(v.id);
  await rows("UPDATE responsibility_grants SET actions=ARRAY['inventory.read'] WHERE id=ANY($1::int[])",[a.grants.map(g=>g.id)]);
  expect(ok(await send(a,b as never,key,"transfers"),201)).toEqual(t);
  ok(await receive(a,t.moveId,receiptKey));expect(await state(v.id)).toEqual(done);
  expect(done.moves.length).toBe(3);
  ok(await send(a,{...b,variantId:v.red} as never,key,"transfers"),409);
 });
 for(const change of ["revoked","suspended","denied"]){
  it(`rejects a variant movement after ${change} while its existing session waits at the authority fence`,async()=>{
   const v=await variantProduct(),a=await member(),lock=await pool.connect(),before=await state(v.id);
   await lock.query("BEGIN");await lock.query("SELECT pg_advisory_xact_lock(174223,35)");
   const pending=send(a,body(v)).then(r=>r);
   try{
    let waiting=false;
    for(let i=0;i<100&&!waiting;i++){waiting=(await rows("SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%pg_advisory_xact_lock_shared(174223,35)%'")).length>0;if(!waiting)await new Promise(r=>setTimeout(r,10));}
    expect(waiting).toBe(true);
    if(change==="revoked")await lock.query("UPDATE responsibility_grants SET revoked_at=now() WHERE id=$1",[a.grants[0].id]);
    if(change==="suspended")await lock.query("UPDATE employee_access SET status='suspended' WHERE employee_id=$1",[a.person.personId]);
    if(change==="denied")await lock.query("UPDATE employee_access SET denied_actions=ARRAY['inventory.move.receipt'] WHERE employee_id=$1",[a.person.personId]);
    await lock.query("COMMIT");ok(await pending,403);expect(await state(v.id)).toEqual(before);
   }finally{await lock.query("ROLLBACK");lock.release();}
  });
 }
 it("rechecks variant authority expiry after its real quant lock and rolls back all effects",async()=>{
  const v=await variantProduct(),a=await member();ok(await send(a,body(v)),201);
  const lock=await pool.connect(),before=await state(v.id);
  await lock.query("BEGIN");await lock.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`${v.id}-${warehouse}-${v.blue}-0`]);
  await rows("UPDATE responsibility_grants SET ends_at=clock_timestamp()+interval '2 seconds' WHERE id=$1",[a.grants[0].id]);
  const pending=send(a,body(v,"issue",1)).then(r=>r);
  try{
   let waiting=false;
   for(let i=0;i<100&&!waiting;i++){waiting=(await rows("SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%pg_advisory_xact_lock(hashtextextended%'")).length>0;if(!waiting)await new Promise(r=>setTimeout(r,10));}
   expect(waiting).toBe(true);await new Promise(r=>setTimeout(r,2100));
   await lock.query("COMMIT");ok(await pending,403);expect(await state(v.id)).toEqual(before);
  }finally{await lock.query("ROLLBACK");lock.release();}
 });
 it("keeps scarce stock isolated under concurrent different intents and rejects missing parent flags or disabled variants",async()=>{
  const v=await variantProduct(),a=await member();
  ok(await send(a,body(v,"receipt",1)),201);
  const replies=await Promise.all([send(a,body(v,"issue",1)),send(a,body(v,"issue",1))]);
  expect(replies.filter(r=>r.status===201)).toHaveLength(1);
  expect(replies.filter(r=>r.status===400)).toHaveLength(1);
  await rows("UPDATE products SET is_variant_parent=false WHERE id=$1",[v.id]);
  ok(await send(a,{...payload("receipt"),productId:v.id}),409);
  await rows("UPDATE product_variants SET is_active=false WHERE id=$1",[v.red]);
  const options=ok(await a.agent.get("/api/workspace/inventory/movement-options").set("X-Workspace-Responsibility",String(a.grants[0].id)));
  expect(options.products.find((p:{id:number})=>p.id===v.id).variants.map((v:{id:number})=>v.id)).toEqual([v.blue]);
  expect((await state(v.id)).quants.map(q=>[q.variant_id,Number(q.quantity)])).toEqual([[v.blue,0]]);
 });
 it("rechecks destination receive expiry after the real destination quant lock before committing arrival",async()=>{
  const v=await variantProduct(),a=await member([...actions,"inventory.transfer.receive"],null,true);
  ok(await send(a,body(v)),201);
  const t=ok(await send(a,{...transferBody(a),productId:v.id,variantId:v.blue},randomUUID(),"transfers"),201);
  const lock=await pool.connect(),before=await state(v.id),dest=a.grants.find(g=>g.branchId===otherBranch)!;
  await lock.query("BEGIN");await lock.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`${v.id}-${destination}-${v.blue}-0`]);
  await rows("UPDATE responsibility_grants SET ends_at=clock_timestamp()+interval '2 seconds' WHERE id=$1",[dest.id]);
  const pending=receive(a,t.moveId).then(r=>r);
  try{
   let waiting=false;
   for(let i=0;i<100&&!waiting;i++){waiting=(await rows("SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%pg_advisory_xact_lock(hashtextextended%'")).length>0;if(!waiting)await new Promise(r=>setTimeout(r,10));}
   expect(waiting).toBe(true);await new Promise(r=>setTimeout(r,2100));
   await lock.query("COMMIT");ok(await pending,403);expect(await state(v.id)).toEqual(before);
  }finally{await lock.query("ROLLBACK");lock.release();}
 });
 it("retains native closed-period rejection and prospective inherited variant receipt cost without changing prior movements",async()=>{
  const v=await variantProduct(),a=await member();
  await rows("UPDATE product_variants SET cost_price=null WHERE id=$1",[v.blue]);
  const first=ok(await send(a,body(v,"receipt",1)),201);
  expect(Number((await state(v.id)).moves.find(m=>m.id===first.moveId).unit_cost)).toBe(99);
  await rows("UPDATE product_variants SET cost_price=7 WHERE id=$1",[v.blue]);
  const before=await state(v.id);
  await rows("UPDATE fiscal_periods SET status='closed' WHERE fiscal_year_id IN(SELECT id FROM fiscal_years WHERE company_id=$1)",[company]);
  try{ok(await send(a,body(v,"receipt",1)),400);expect(await state(v.id)).toEqual(before);}
  finally{await rows("UPDATE fiscal_periods SET status='open' WHERE fiscal_year_id IN(SELECT id FROM fiscal_years WHERE company_id=$1)",[company]);}
  const second=ok(await send(a,body(v,"receipt",1)),201),after=await state(v.id);
  expect(Number(after.moves.find(m=>m.id===first.moveId).unit_cost)).toBe(99);
  expect(Number(after.moves.find(m=>m.id===second.moveId).unit_cost)).toBe(7);
  expect(Number(after.quants[0].avg_cost)).toBe(53);
 });
});
async function member(a=actions,limit:string|null=null,pair=false){
 const input={creationKey:randomUUID(),name:"مخزون مفوض مصطنع",email:`${randomUUID()}@example.invalid`,loginKinds:["platform"],
  grants:[grant(warehouse,branch,a,limit),...(pair?[grant(destination,otherBranch,a,limit)]:[])],deniedActions:[]};
 const person=ok(await owner.post("/api/team/people").send(input),201);
 const invite=ok(await owner.post(`/api/team/people/${person.personId}/invite`).send({expectedRevision:person.revision}),201);
 const client=agent();
 ok(await client.post("/api/auth/team-activation/accept").send({token:invite.activationToken,password}));
 ok(await client.post("/api/auth/login").send({email:input.email,password}));
 const access=ok(await client.get("/api/workspace/access"));
 return {agent:client,person,grants:access.grants as {id:number;branchId:number}[]};
}
type Actor=Awaited<ReturnType<typeof member>>;
const payload=(kind="issue")=>({kind,productId:product,warehouseId:warehouse,quantity:2,notes:"مرجع مخزون مصطنع"});
const send=(a:Actor,body:Record<string,unknown>=payload(),key=randomUUID(),path="moves")=>a.agent.post(`/api/inventory/${path}`)
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
 owner=agent();ok(await owner.post("/api/auth/login").send({email:u.email,password}));
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
 it("allows delegated moves during an active count under the approved moving-count policy without closing it",async()=>{
  const a=await member(),take=ok(await owner.post("/api/inventory/stock-takes").send({warehouseId:warehouse}),201),before=await snapshot();
  try{
   ok(await send(a),201);ok(await send(a,payload("receipt")),201);
   const after=await snapshot();expect(after.quants).toEqual(before.quants);
   expect((await rows("SELECT status FROM stock_takes WHERE id=$1",[take.id]))[0].status).toBe("in_progress");
   expect(after.audits.length).toBe(before.audits.length+2);
  }
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
 it("preserves a count opening snapshot while a waiting delegated move proceeds under the moving-count policy",async()=>{
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
   try{
    ok(await movement,201);
    const after=await snapshot();
    expect(Number(after.quants.find((q:{warehouse_id:number})=>q.warehouse_id===warehouse).quantity))
     .toBe(Number(before.quants.find((q:{warehouse_id:number})=>q.warehouse_id===warehouse).quantity)-2);
    expect((await rows("SELECT status FROM stock_takes WHERE id=$1",[take.id]))[0].status).toBe("in_progress");
   }
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
