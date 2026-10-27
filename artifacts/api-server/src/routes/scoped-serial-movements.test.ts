import {beforeAll,afterAll,expect,it} from "vitest";
import {mkdirSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {randomUUID} from "node:crypto";
import {db,pool,productsTable} from "@workspace/db";
import {sql} from "drizzle-orm";
import {recordStockMove} from "../lib/stock-engine";
import {posTemplateFixture,personInput,accepted as ok,fixtureRows as rows} from "../test/pos-template-fixture";
import {teamPeople,updateTeamPerson} from "../lib/team-store";
let f:Awaited<ReturnType<typeof posTemplateFixture>>,product:number,p:any,wh:number;
const barriers:unknown[]=[];
const actions=["inventory.read","inventory.move.receipt","inventory.move.issue","inventory.transfer.send","inventory.transfer.receive"];
async function access(deniedActions:string[]=[],amountLimit="500",endsAt:string|null=null){
 const current=(await teamPeople(f.companies[0].id)).find(x=>x.userId===f.people[0].userId)!;
 await updateTeamPerson(f.companies[0].id,f.ownerUser.id,current.personId,current.revision,{
  ...personInput(current),deniedActions,grants:[0,1].map(i=>({resource:"inventory",branchId:f.branches[i].id,
   warehouseIds:[f.warehouses[i].id],actions,amountLimit,startsAt:new Date(Date.now()-86400000).toISOString(),endsAt}))},false);
 p=(await teamPeople(f.companies[0].id)).find(x=>x.userId===f.people[0].userId)!;
}
const headers=(key:string,branch=1)=>({"Idempotency-Key":key,"X-Workspace-Responsibility":String(p.grants.find((g:any)=>g.branchId===f.branches[branch].id).id)});
const body=(serialNumber:string,kind="receipt",warehouseId=wh)=>({kind,productId:product,warehouseId,quantity:1,serialNumber,notes:"حركة تسلسل معزولة"});
const send=(b:any,key=randomUUID(),branch=1)=>f.actors[0].post(`/api/inventory/${b.fromWarehouseId?"transfers":"moves"}`).set(headers(key,branch)).send(b);
const close=(b:any,key:string)=>f.actors[0].post("/api/workspace/inventory/movement-attempts/close").set(headers(key)).send({transfer:!!b.fromWarehouseId,body:b});
async function serial(number:string){return (await rows("SELECT * FROM stock_serials WHERE product_id=$1 AND serial_number=$2",[product,number]))[0];}
beforeAll(async()=>{
 f=await posTemplateFixture();wh=f.warehouses[1].id;
 const [r]=await db.insert(productsTable).values({companyId:f.companies[0].id,categoryId:f.products[0].categoryId,name:"serial-test",nameAr:"جهاز تسلسلي",sku:randomUUID(),
  trackingMode:"serial",costingMethod:"fifo",costPrice:"3",price:"20"}).returning();
 product=r.id;ok(await f.actors[0].post("/api/auth/switch-company").send({companyId:f.companies[0].id}));await access();
});
it("native engine rejects a second receipt of an already received serial without altering quantity",async()=>{
 const [s]=await rows("INSERT INTO stock_serials(product_id,serial_number) VALUES($1,$2) RETURNING id",[product,randomUUID()]);
 await db.transaction(tx=>recordStockMove(tx,{companyId:f.companies[0].id,productId:product,serialId:s.id,quantity:1,kind:"receipt",toWarehouseId:wh}));
 await expect(db.transaction(tx=>recordStockMove(tx,{companyId:f.companies[0].id,productId:product,serialId:s.id,quantity:1,kind:"receipt",toWarehouseId:wh}))).rejects.toThrow();
 expect((await rows("SELECT quantity::text AS q FROM stock_quants WHERE product_id=$1 AND warehouse_id=$2",[product,wh]))[0].q).toBe("1.0000");
});
it("receives two distinct pieces, uses FIFO rather than serial purchase identity, and recovers the exact committed result",async()=>{
 const a=randomUUID(),b=randomUUID();
 ok(await send(body(a)),201);
 await rows("UPDATE products SET cost_price=7 WHERE id=$1",[product]);
 const key=randomUUID(),request=body(b),receipt=ok(await send(request,key),201);
 expect(ok(await send(request,key),201)).toEqual(receipt);
 expect(ok(await close(request,key))).toMatchObject({state:"completed",...receipt});
 const sb=await serial(b),sa=await serial(a);
 // The newer piece is selected, but FIFO consumes the oldest layer (3).
 const issue=ok(await send({...body("", "issue"),serialNumber:undefined,serialId:sb.id}),201);
 const [m]=await rows("SELECT unit_cost::text AS cost FROM stock_moves WHERE id=$1",[issue.moveId]);
 expect(Number(m.cost)).toBe(3);expect((await serial(b)).state).toBe("sold");
 expect((await serial(a)).state).toBe("in_stock");expect(sa.current_warehouse_id).toBe(wh);
});
it("rejects duplicate and fractional serial requests, foreign identities, and warehouse mismatch with no receipt",async()=>{
 const number=randomUUID();ok(await send(body(number)),201);const s=await serial(number);
 for(const b of [body(number),{...body(randomUUID()),quantity:0.5},{...body(randomUUID()),quantity:2},
  {...body(number,"issue",f.warehouses[0].id),serialId:s.id},
  {...body(number),serialId:s.id,productId:f.products[1].id},
  {...body(randomUUID()),serialIds:[s.id,s.id]}]){
  const key=randomUUID(),response=await send(b,key);
  if(b.productId===f.products[1].id)expect(response.status).toBe(404);
  else expect([400,403,409]).toContain(response.status);
  expect(await rows("SELECT request_key FROM financial_requests WHERE request_key=$1",[key])).toEqual([]);
 }
});
it("seals a refused serial request, blocks the late original, and permits a corrected new key",async()=>{
 const number=randomUUID(),key=randomUUID(),b={...body(number),quantity:2};
 expect((await send(b,key)).status).toBe(400);
 expect(ok(await close(b,key))).toMatchObject({state:"closed_without_execution"});
 expect((await send(b,key)).status).toBe(409);
 const fresh=ok(await send(body(number)),201);expect(fresh.moveId).toBeGreaterThan(0);
});
it("serializes duplicate receipt requests on PostgreSQL, including different warehouses",async()=>{
 const number=randomUUID(),barrier=await pool.connect();
 try{
  await barrier.query("BEGIN");await barrier.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`serial-stock:${product}`]);
  const a=send(body(number)).then(r=>r),b=send(body(number,"receipt",f.warehouses[0].id),randomUUID(),0).then(r=>r);
  await waiting(2);await barrier.query("COMMIT");
  expect((await Promise.all([a,b])).map(r=>r.status).sort()).toEqual([201,409]);
 }finally{await barrier.query("ROLLBACK");barrier.release();}
 expect((await rows("SELECT count(*)::int AS n FROM stock_moves WHERE serial_id=$1",[(await serial(number)).id]))[0].n).toBe(1);
});
async function waiting(count:number){
 for(let i=0;i<150;i++){
  const [r]=await rows("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event='advisory'");
  if(r.n>=count){
   const locks=await rows(`SELECT l.pid,l.granted,l.classid::text,l.objid::text,a.wait_event
    FROM pg_locks l LEFT JOIN pg_stat_activity a ON a.pid=l.pid WHERE l.locktype='advisory'
    AND l.classid=((hashtextextended($1,0)>>32)&4294967295)::oid
    AND l.objid=(hashtextextended($1,0)&4294967295)::oid
    AND l.database=(SELECT oid FROM pg_database WHERE datname=current_database()) ORDER BY l.pid`,[`serial-stock:${product}`]);
   expect(locks.filter(l=>!l.granted&&l.wait_event==="advisory").length).toBeGreaterThanOrEqual(count);
   barriers.push({waiting:count,locks});return;
  }await new Promise(r=>setTimeout(r,20));
 }throw new Error("PostgreSQL serial barrier not reached");
}
const transfer=(id:number)=>({productId:product,serialId:id,quantity:1,fromWarehouseId:wh,toWarehouseId:f.warehouses[0].id,
 destinationResponsibilityId:p.grants.find((g:any)=>g.branchId===f.branches[0].id).id,notes:"نقل قطعة محددة"});
it("issue and transfer of the same piece cannot both commit",async()=>{
 const number=randomUUID();ok(await send(body(number)),201);const s=await serial(number),barrier=await pool.connect();
 try{
  await barrier.query("BEGIN");await barrier.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`serial-stock:${product}`]);
  const a=send({...body(number,"issue"),serialId:s.id}).then(r=>r),b=send(transfer(s.id)).then(r=>r);
  await waiting(2);await barrier.query("COMMIT");
  expect((await Promise.all([a,b])).map(r=>r.status).sort()).toEqual([201,409]);
 }finally{await barrier.query("ROLLBACK");barrier.release();}
 expect((await rows("SELECT count(*)::int AS n FROM stock_moves WHERE serial_id=$1",[s.id]))[0].n).toBe(2);
});
it("dispatches into transit, receives once with an independent destination grant and preserves cost",async()=>{
 const number=randomUUID();ok(await send(body(number)),201);const s=await serial(number);
 const request=transfer(s.id),key=randomUUID(),out=ok(await send(request,key),201);
 expect(ok(await send(request,key),201)).toEqual(out);
 expect(await serial(number)).toMatchObject({state:"in_transit",current_warehouse_id:null});
 expect((await send({...body(number,"issue"),serialId:s.id})).status).toBe(409);
 const current=(await teamPeople(f.companies[0].id)).find(x=>x.userId===f.people[1].userId)!;
 await updateTeamPerson(f.companies[0].id,f.ownerUser.id,current.personId,current.revision,{
  ...personInput(current),deniedActions:[],grants:[{resource:"inventory",branchId:f.branches[0].id,warehouseIds:[f.warehouses[0].id],
   actions:["inventory.read","inventory.transfer.receive"],amountLimit:"500",startsAt:null,endsAt:null}]},false);
 const receiver:any=(await teamPeople(f.companies[0].id)).find(x=>x.userId===f.people[1].userId)!;
 ok(await f.actors[1].post("/api/auth/switch-company").send({companyId:f.companies[0].id}));
 const h={"Idempotency-Key":randomUUID(),"X-Workspace-Responsibility":String(receiver.grants[0].id)};
 const list=ok(await f.actors[1].get("/api/workspace/inventory/transfers").set(h));
 expect(JSON.stringify(list)).not.toMatch(/unitCost|unit_cost|avgCost|amountLimit|costPrice/);
 expect(list.transfers.find((m:any)=>m.id===out.moveId)).toMatchObject({serialId:s.id,serialNumber:number});
 const receive=()=>f.actors[1].post(`/api/inventory/transfers/${out.moveId}/receive`).set(h).send({receiptReference:"استلام مستقل لقطعة"});
 expect((await Promise.all([receive(),receive()])).map(r=>r.status)).toEqual([200,200]);
 expect(await serial(number)).toMatchObject({state:"in_stock",current_warehouse_id:f.warehouses[0].id});
 const [m]=await rows("SELECT unit_cost::text AS cost,state FROM stock_moves WHERE id=$1",[out.moveId]);
 const [layer]=await rows("SELECT unit_cost::text AS cost,remaining_qty::text AS q FROM stock_layers WHERE receipt_move_id=$1",[out.moveId]);
 expect(layer.cost).toBe(m.cost);expect(Number(layer.q)).toBe(1);
 expect((await rows("SELECT count(*)::int AS n FROM stock_moves WHERE serial_id=$1",[s.id]))[0].n).toBe(2);
 expect((await f.actors[1].post("/api/inventory/transfers").set(h).send(request)).status).toBe(403);
});
it("rechecks withdrawn execution authority after a real PostgreSQL lock wait, while allowing committed read recovery",async()=>{
 await access([],"500",new Date(Date.now()+4000).toISOString());
 const number=randomUUID(),b=body(number),key=randomUUID(),barrier=await pool.connect();
 try{
  await barrier.query("BEGIN");await barrier.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`serial-stock:${product}`]);
  const attempt=send(b,key).then(r=>r);await waiting(1);
  // Expiry is time-based and can change while the authority fence is held.
  await new Promise(r=>setTimeout(r,4100));
  await barrier.query("COMMIT");expect((await attempt).status).toBe(403);
 }finally{await barrier.query("ROLLBACK");barrier.release();await access();}
 expect(await serial(number)).toBeUndefined();
 const committed=randomUUID(),result=ok(await send(b,committed),201);
 await access(["inventory.move.receipt"]);expect(ok(await close(b,committed))).toMatchObject({state:"completed",...result});
 expect((await send(body(randomUUID()))).status).toBe(403);
 await access(["inventory.read"]);expect((await close(b,committed)).status).toBe(403);await access();
});
it("enforces monetary and temporal limits, tenant scope and account suspension; exposes no cost or product maintenance",async()=>{
 await access([],"0.01");expect((await send(body(randomUUID()))).status).toBe(403);
 await access([],"500",new Date(Date.now()-1000).toISOString());expect((await send(body(randomUUID()))).status).toBe(403);
 await access();
 expect((await send({...body(randomUUID()),warehouseId:f.warehouses[2].id})).status).toBe(404);
 const options=ok(await f.actors[0].get("/api/workspace/inventory/movement-options").set(headers(randomUUID())));
 expect(options.products.find((v:any)=>v.id===product).tracking).toBe("serial");
 expect(JSON.stringify(options)).not.toMatch(/unitCost|unit_cost|avgCost|costPrice|password|secret/);
 expect((await f.actors[0].post("/api/inventory/serials").set(headers(randomUUID())).send({productId:product,serialNumber:randomUUID()})).status).toBe(403);
 await rows("UPDATE users SET is_active=false WHERE id=$1",[p.userId]);
 expect([401,403]).toContain((await send(body(randomUUID()))).status);
 await rows("UPDATE users SET is_active=true WHERE id=$1",[p.userId]);
 ok(await f.actors[0].post("/api/auth/login").send({email:f.people[0].email,password:f.password}));
 ok(await f.actors[0].post("/api/auth/switch-company").send({companyId:f.companies[0].id}));
});
it("rejects ambiguous historical location evidence without modifying history",async()=>{
 const number=randomUUID(),[s]=await rows("INSERT INTO stock_serials(product_id,serial_number,current_warehouse_id) VALUES($1,$2,$3) RETURNING id",[product,number,wh]);
 const key=randomUUID();
 expect((await send({...body(number,"issue"),serialId:s.id},key)).status).toBe(409);
 expect((await rows("SELECT count(*)::int AS n FROM stock_moves WHERE serial_id=$1",[s.id]))[0].n).toBe(0);
 // Remove only deliberately synthetic ambiguity so independent acceptance
 // reconciliation below remains about valid pieces; no repair API is used.
 await rows("DELETE FROM stock_serials WHERE id=$1",[s.id]);
});
it("independently reconciles serial identity, quant quantity, native layers, transit and all company inventory GL",async()=>{
 const serialRows=await rows("SELECT * FROM stock_serials WHERE product_id=$1 ORDER BY id",[product]);
 const quants=await rows("SELECT warehouse_id,quantity::text,avg_cost::text FROM stock_quants WHERE product_id=$1",[product]);
 for(const q of quants)expect(Number(q.quantity)).toBe(serialRows.filter(s=>s.state==="in_stock"&&s.current_warehouse_id===q.warehouse_id).length);
 const [r]=await rows(`SELECT
 (SELECT coalesce(sum(quantity*avg_cost),0) FROM stock_quants WHERE product_id=$1)::text AS physical,
 (SELECT coalesce(sum(quantity*unit_cost),0) FROM stock_moves WHERE product_id=$1 AND state='in_transit')::text AS transit,
 (SELECT coalesce(sum(remaining_qty*unit_cost),0) FROM stock_layers WHERE product_id=$1)::text AS layers,
 (SELECT coalesce(sum(l.debit-l.credit),0) FROM journal_entry_lines l JOIN accounts a ON a.id=l.account_id
 WHERE a.system_key='inventory' AND l.entry_id IN(SELECT journal_entry_id FROM stock_moves WHERE product_id=$1))::text AS ledger`,[product]);
 expect(Number(r.physical)+Number(r.transit)).toBeCloseTo(Number(r.ledger),8);
 expect(Number(r.physical)).toBeCloseTo(Number(r.layers),8);
 expect(await rows(`SELECT l.entry_id FROM journal_entry_lines l JOIN journal_entries j ON j.id=l.entry_id
 WHERE j.company_id=$1 GROUP BY l.entry_id HAVING sum(l.debit)<>sum(l.credit)`,[f.companies[0].id])).toEqual([]);
 const [company]=await rows(`SELECT
  (SELECT coalesce(sum(q.quantity*q.avg_cost),0) FROM stock_quants q JOIN products p ON p.id=q.product_id WHERE p.company_id=$1)
  +(SELECT coalesce(sum(m.quantity*m.unit_cost),0) FROM stock_moves m JOIN products p ON p.id=m.product_id
    WHERE p.company_id=$1 AND m.state='in_transit') AS inventory,
  (SELECT coalesce(sum(l.debit-l.credit),0) FROM journal_entry_lines l JOIN accounts a ON a.id=l.account_id
    JOIN journal_entries j ON j.id=l.entry_id WHERE j.company_id=$1 AND a.system_key='inventory') AS ledger`,[f.companies[0].id]);
 expect(Number(company.inventory)).toBeCloseTo(Number(company.ledger),8);
});
afterAll(async()=>{
 if(!product)return;
 const data={scope:"isolated PostgreSQL synthetic serial fixture",productId:product,companyId:f.companies[0].id,barriers,
  serials:await rows("SELECT * FROM stock_serials WHERE product_id=$1 ORDER BY id",[product]),
  quants:await rows("SELECT * FROM stock_quants WHERE product_id=$1 ORDER BY id",[product]),
  layers:await rows("SELECT * FROM stock_layers WHERE product_id=$1 ORDER BY id",[product]),
  moves:await rows("SELECT * FROM stock_moves WHERE product_id=$1 ORDER BY id",[product]),
  receipts:await rows("SELECT operation,request_key,request_hash,result FROM financial_requests WHERE company_id=$1 AND user_id=$2",[f.companies[0].id,p.userId]),
  journals:await rows("SELECT j.id,l.account_id,a.system_key,l.debit::text,l.credit::text FROM journal_entries j JOIN journal_entry_lines l ON l.entry_id=j.id JOIN accounts a ON a.id=l.account_id WHERE j.company_id=$1 ORDER BY j.id,l.id",[f.companies[0].id]),
  audits:await rows("SELECT id,action,entity,details FROM audit_logs WHERE company_id=$1 AND entity IN('stock_move','financial_request') ORDER BY id",[f.companies[0].id])};
 const directory=resolve(process.cwd(),"../../generated-artifacts/serial-movements");mkdirSync(directory,{recursive:true});
 writeFileSync(resolve(directory,"api-reconciliation.json"),JSON.stringify(data,null,2));
});
