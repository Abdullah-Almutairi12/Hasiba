import {beforeAll,beforeEach,describe,it,expect,vi} from "vitest";
import {randomUUID} from "node:crypto";
import {db,pool} from "@workspace/db";
import {posTemplateFixture,personInput,accepted as ok,fixtureRows as rows} from "../test/pos-template-fixture";
import {updateTeamPerson,teamPeople} from "../lib/team-store";
import {recordStockMove} from "../lib/stock-engine";
import {getOnHandForConnector} from "../lib/integrations/marketplaces";

let f:Awaited<ReturnType<typeof posTemplateFixture>>,people:any[],source:number,dest:number,company:number;
const all=["inventory.read","inventory.move.receipt","inventory.move.issue","inventory.transfer.send"];
const day=(n:number)=>new Date(Date.now()+n*86400000).toISOString().slice(0,10);
async function waitForAdvisory(count=1){
 for(let i=0;i<80;i++){
  const [r]=await rows("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event='advisory'");
  if(r.n>=count)return;
  await new Promise(r=>setTimeout(r,25));
 }throw new Error("The deterministic quant-key barrier was not reached");
}
async function configure(i:number,limit="100"){
 const p=(await teamPeople(company)).find(p=>p.userId===f.people[i].userId)!;
 const grant=(wh:number,b:number,actions:string[])=>({resource:"inventory" as const,branchId:b,warehouseIds:[wh],
  actions,amountLimit:limit,startsAt:null,endsAt:null});
 await updateTeamPerson(company,f.ownerUser.id,p.personId,p.revision,{
  ...personInput(p),deniedActions:[],grants:i===0?[grant(source,f.branches[1].id,all),grant(dest,f.branches[0].id,all)]:
   [grant(dest,f.branches[0].id,["inventory.read","inventory.transfer.receive"])],
 },false);
 people[i]=(await teamPeople(company)).find(p=>p.personId===f.people[i].personId)!;
}
const send=(body:any,key=randomUUID())=>f.actors[0].post(`/api/inventory/${body.fromWarehouseId?"transfers":"moves"}`)
 .set("X-Workspace-Responsibility",String(people[0].grants.find((g:any)=>g.branchId===f.branches[1].id).id))
 .set("Idempotency-Key",key).send(body);
const receive=(id:number,key=randomUUID())=>f.actors[1].post(`/api/inventory/transfers/${id}/receive`)
 .set("X-Workspace-Responsibility",String(people[1].grants[0].id)).set("Idempotency-Key",key)
 .send({receiptReference:"محضر وصول دفعات مصطنع"});
const movement=(id:number,kind="receipt",quantity=2)=>({productId:id,warehouseId:source,kind,quantity,notes:"حركة دفعات معزولة"});
const transfer=(id:number,quantity=2)=>({productId:id,fromWarehouseId:source,toWarehouseId:dest,quantity,
 notes:"تحويل دفعات معزول",destinationResponsibilityId:people[0].grants.find((g:any)=>g.branchId===f.branches[0].id).id});
async function product(method="fifo"){
 const [p]=await rows(`INSERT INTO products(company_id,name,name_ar,sku,category_id,price,cost_price,stock,unit,min_stock,tracking_mode,costing_method)
  SELECT $1,$2,$2,$2,category_id,50,7,0,'pcs',0,'lot',$3 FROM products WHERE id=$4 RETURNING id`,
  [company,`دفعات-${randomUUID()}`,method,f.products[0].id]);return p.id as number;
}
async function receipt(id:number,name:string,qty=2,expiry=day(10)){
 const r=ok(await send({...movement(id,"receipt",qty),lotNumber:name,expiryDate:expiry}),201);
 const [m]=await rows("SELECT lot_id FROM stock_moves WHERE id=$1",[r.moveId]);return {...r,lotId:m.lot_id};
}
async function snapshot(id:number){
 return {
  quants:await rows("SELECT warehouse_id,lot_id,quantity::text,avg_cost::text FROM stock_quants WHERE product_id=$1 ORDER BY warehouse_id,lot_id",[id]),
  lots:await rows("SELECT id,lot_number,expiry_date::text FROM stock_lots WHERE product_id=$1 ORDER BY id",[id]),
  moves:await rows("SELECT id,lot_id,quantity::text,unit_cost::text,state,journal_entry_id FROM stock_moves WHERE product_id=$1 ORDER BY id",[id]),
  layers:await rows("SELECT id,warehouse_id,lot_id,remaining_qty::text,unit_cost::text FROM stock_layers WHERE product_id=$1 ORDER BY id",[id]),
 };
}
async function reconcile(id:number){
 const [r]=await rows(`SELECT
 (SELECT coalesce(sum(quantity*avg_cost),0) FROM stock_quants WHERE product_id=$1)::text AS physical,
 (SELECT coalesce(sum(quantity*unit_cost),0) FROM stock_moves WHERE product_id=$1 AND state='in_transit')::text AS transit,
 (SELECT coalesce(sum(remaining_qty*unit_cost),0) FROM stock_layers WHERE product_id=$1)::text AS layers,
 (SELECT coalesce(sum(l.debit-l.credit),0) FROM journal_entry_lines l JOIN accounts a ON a.id=l.account_id
  WHERE a.system_key='inventory' AND l.entry_id IN(SELECT j.id FROM journal_entries j WHERE
   j.id IN(SELECT journal_entry_id FROM stock_moves WHERE product_id=$1) OR
   (j.company_id=(SELECT company_id FROM products WHERE id=$1) AND j.source='pos'
    AND j.source_ref IN(SELECT source_ref||'-COGS' FROM stock_moves WHERE product_id=$1 AND source_type='pos_order'))))::text AS ledger`,[id]);
 expect(Number(r.physical)+Number(r.transit)).toBeCloseTo(Number(r.ledger),8);
 expect(Number(r.layers)).toBeCloseTo(Number(r.physical),8);
 const bad=await rows(`SELECT entry_id FROM journal_entry_lines WHERE entry_id IN
 (SELECT journal_entry_id FROM stock_moves WHERE product_id=$1) GROUP BY entry_id HAVING sum(debit)<>sum(credit)`,[id]);
 expect(bad).toEqual([]);return r;
}
beforeAll(async()=>{f=await posTemplateFixture();company=f.companies[0].id;source=f.warehouses[1].id;dest=f.warehouses[0].id;people=[];});
beforeEach(async()=>{await configure(0);await configure(1);});
describe("scoped lots without variants through the original stock engine",()=>{
 it("receives separate lots, preserves identity/expiry, rejects conflicting dates and leaks no costs",async()=>{
  const id=await product(),a=await receipt(id,"أ",2,day(10)),b=await receipt(id,"ب",3,day(20));
  const before=await snapshot(id);expect(a.lotId).not.toBe(b.lotId);expect(before.quants.map(q=>Number(q.quantity))).toEqual([2,3]);
  expect((await send({...movement(id),lotNumber:"أ",expiryDate:day(11)})).status).toBeGreaterThanOrEqual(400);
  expect(await snapshot(id)).toEqual(before);
  const options=ok(await f.actors[0].get("/api/workspace/inventory/movement-options")
   .set("X-Workspace-Responsibility",String(people[0].grants[0].id)));
  expect(options.lots.filter((l:any)=>l.productId===id)).toHaveLength(2);
  expect(JSON.stringify(options)).not.toMatch(/unitCost|avgCost|costPrice|journalEntry/);
  expect(options.products.find((p:any)=>p.id===id)).toMatchObject({tracking:"lot",unit:"pcs"});
  await reconcile(id);
 });
 it("issues an explicit lot and selects FEFO independently of FIFO valuation",async()=>{
  const id=await product(),a=await receipt(id,"بعيدة",2,day(20));
  await rows("UPDATE products SET cost_price=11 WHERE id=$1",[id]);
  const b=await receipt(id,"قريبة",2,day(10));
  ok(await send({...movement(id,"issue",1),lotId:a.lotId}),201);
  const out=ok(await send(movement(id,"issue",2)),201);expect(out.moveIds).toHaveLength(1);
  const state=await snapshot(id);expect(state.moves.find(m=>m.id===out.moveId)).toMatchObject({lot_id:b.lotId,unit_cost:"11.0000000000000000"});
  expect(Number((await reconcile(id)).physical)).toBe(7);
  const before=await snapshot(id);
  expect((await send(movement(id,"issue",2))).status).toBeGreaterThanOrEqual(400);
  expect(await snapshot(id)).toEqual(before);
 });
 it("atomically dispatches and receives a multi-lot group with a gross destination cap and stable retries",async()=>{
  const id=await product();await receipt(id,"أ",2,day(10));await rows("UPDATE products SET cost_price=11 WHERE id=$1",[id]);await receipt(id,"ب",2,day(20));
  const out=ok(await send(transfer(id,3)),201);expect(out.moveIds).toHaveLength(2);await reconcile(id);
  await configure(1,"20");const before=await snapshot(id);
  ok(await receive(out.moveIds[1]),403);expect(await snapshot(id)).toEqual(before);
  await configure(1);const key=randomUUID();
  const results=await Promise.all([receive(out.moveIds[1],key),receive(out.moveIds[1],key)]);
  results.forEach(r=>ok(r));expect(results[0].body).toEqual(results[1].body);
  expect((await snapshot(id)).moves.filter(m=>out.moveIds.includes(m.id)).every(m=>m.state==="done")).toBe(true);
  const after=await snapshot(id);ok(await receive(out.moveIds[1],key));expect(await snapshot(id)).toEqual(after);
  expect(Number((await reconcile(id)).physical)).toBe(36);
 });
 it("records physical arrival after expiry but blocks native sale, issue, consumption, FEFO and usable quantities",async()=>{
  const id=await product(),a=await receipt(id,"تصل بعد انتهائها",2,day(1));
  const out=ok(await send({...transfer(id),lotId:a.lotId}),201);
  const now=Date.now();
  try{
   vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date(now+3*86400000));
   const key=randomUUID();ok(await receive(out.moveId,key));const before=await snapshot(id);ok(await receive(out.moveId,key));
   expect(await snapshot(id)).toEqual(before);
   for(const kind of ["issue","adjustment","transfer"] as const){
    await expect(db.transaction(tx=>recordStockMove(tx,{companyId:company,productId:id,kind,fromWarehouseId:dest,
     toWarehouseId:kind==="transfer"?source:null,quantity:1,lotId:a.lotId,sourceType:kind==="issue"?"pos_sale":"manual"})))
     .rejects.toThrow(/منتهي/);
   }
   await expect(db.transaction(tx=>recordStockMove(tx,{companyId:company,productId:id,kind:"issue",fromWarehouseId:dest,quantity:1})))
    .rejects.toThrow(/غير كاف/);
   expect(await snapshot(id)).toEqual(before);
   const products=ok(await f.owner.get("/api/products"));expect(Number(products.find((p:any)=>p.id===id).availableQuantity)).toBe(0);
   expect(await getOnHandForConnector(id,dest,company)).toBe(0);
   expect(await getOnHandForConnector(id,null,company)).toBe(0);
   const q=ok(await f.actors[1].get("/api/workspace/inventory").set("X-Workspace-Responsibility",String(people[1].grants[0].id)));
   expect(q.find((q:any)=>q.productId===id)).toMatchObject({quantity:"2.0000",availableQuantity:"0"});
   const incoming=ok(await f.actors[1].get("/api/workspace/inventory/transfers").set("X-Workspace-Responsibility",String(people[1].grants[0].id)));
   expect(incoming.transfers.find((t:any)=>t.id===out.moveId)).toMatchObject({expired:true,lotNumber:"تصل بعد انتهائها",state:"done"});
   expect(Number((await reconcile(id)).physical)).toBe(14);
   expect((await rows("SELECT details::jsonb->>'expiredAtReceipt' AS expired FROM audit_logs WHERE action='inventory.transfer.received' AND details::jsonb->>'moveId'=$1",[String(out.moveId)]))[0].expired).toBe("true");
  }finally{vi.useRealTimers();}
 });
 it("rejects foreign lots, bad units/quantities, expired outflow, mixed variants, excessive cap and closed period without partial effects",async()=>{
  const id=await product(),a=await receipt(id,"مسموحة"),other=await product(),b=await receipt(other,"أخرى");
  const before=await snapshot(id);
  expect((await send({...movement(id,"issue"),lotId:b.lotId})).status).toBeGreaterThanOrEqual(400);
  for(const extra of [{quantity:-1},{quantity:0},{quantity:0.00001},{quantity:"bad"},{unit:"kg"}])
   expect((await send({...movement(id),lotId:a.lotId,...extra})).status).toBeGreaterThanOrEqual(400);
  ok(await send({...movement(id),lotId:a.lotId,warehouseId:f.warehouses[2].id}),404);
  await configure(0,"6");ok(await send({...movement(id,"issue",1),lotId:a.lotId}),403);
  await configure(0);
  await rows("UPDATE fiscal_periods SET status='closed' WHERE fiscal_year_id IN(SELECT id FROM fiscal_years WHERE company_id=$1)",[company]);
  try{expect((await send({...movement(id,"issue",1),lotId:a.lotId})).status).toBeGreaterThanOrEqual(400);}
  finally{await rows("UPDATE fiscal_periods SET status='open' WHERE fiscal_year_id IN(SELECT id FROM fiscal_years WHERE company_id=$1)",[company]);}
  expect(await snapshot(id)).toEqual(before);
  await rows("UPDATE products SET is_variant_parent=true WHERE id=$1",[id]);ok(await send({...movement(id),lotId:a.lotId}),409);
 });
 it("serializes limited multi-lot outflow without duplicate inventory or journals",async()=>{
  const id=await product();await receipt(id,"أ",1,day(10));await receipt(id,"ب",1,day(20));
  const results=await Promise.all([send(movement(id,"issue",2)),send(movement(id,"issue",2))]);
  expect(results.filter(r=>r.status===201)).toHaveLength(1);expect(results.filter(r=>r.status>=400)).toHaveLength(1);
  expect(Number((await reconcile(id)).physical)).toBe(0);
 });
 it("rejects an actual POS order backed only by expired lots and rolls its financial write back",async()=>{
  const id=await product(),a=await receipt(id,"تجربة بيع",3,day(1));
  const out=ok(await send({...transfer(id,3),lotId:a.lotId}),201);ok(await receive(out.moveId));
  const session=ok(await f.owner.post("/api/pos/sessions").send({branchId:f.branches[0].id,cashierName:"كاشير اختبار الدفعات",openingCash:0}),201);
  const sale=(key:string)=>f.owner.post("/api/pos/orders").set("Idempotency-Key",key)
   .send({sessionId:session.id,items:[{productId:id,quantity:1}],paymentMethod:"cash",discount:0});
  ok(await sale(randomUUID()),201);const before=await snapshot(id),now=Date.now();
  try{
   vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date(now+3*86400000));
   const r=await sale(randomUUID());expect(r.status).toBeGreaterThanOrEqual(400);expect(JSON.stringify(r.body)).toMatch(/كاف|منتهي/);
   expect(await snapshot(id)).toEqual(before);await reconcile(id);
  }finally{vi.useRealTimers();}
 });
 it("honors a revoked execution right on an already-open session and blocks a suspended account",async()=>{
  const id=await product(),a=await receipt(id,"أ");const before=await snapshot(id);
  await rows("UPDATE employee_access SET denied_actions=ARRAY['inventory.move.issue'] WHERE employee_id=$1",[people[0].personId]);
  ok(await send({...movement(id,"issue",1),lotId:a.lotId}),403);
  expect(await snapshot(id)).toEqual(before);
  await rows("UPDATE users SET is_active=false WHERE id=$1",[people[0].userId]);
  try{expect((await send({...movement(id,"issue",1),lotId:a.lotId})).status).toBeGreaterThanOrEqual(400);}
  finally{await rows("UPDATE users SET is_active=true WHERE id=$1",[people[0].userId]);
   ok(await f.actors[0].post("/api/auth/login").send({email:f.people[0].email,password:f.password}));
   ok(await f.actors[0].post("/api/auth/switch-company").send({companyId:company}));}
 });
 it("rechecks a revoked lot-execution right after the existing authority writer fence",async()=>{
  const id=await product(),a=await receipt(id,"انتظار"),before=await snapshot(id),lock=await pool.connect();
  await lock.query("BEGIN");await lock.query("SELECT pg_advisory_xact_lock(174223,35)");
  const pending=send({...movement(id,"issue",1),lotId:a.lotId}).then(r=>r);
  try{
   await waitForAdvisory();
   await lock.query("UPDATE employee_access SET denied_actions=ARRAY['inventory.move.issue'] WHERE employee_id=$1",[people[0].personId]);
   await lock.query("COMMIT");ok(await pending,403);expect(await snapshot(id)).toEqual(before);
  }finally{await lock.query("ROLLBACK");lock.release();await Promise.allSettled([pending]);}
 });
 it("uses one key order for actual opposite-warehouse lot dispatches",async()=>{
  const id=await product(),a=await receipt(id,"مشتركة",5);
  const destinationGrant=people[0].grants.find((g:any)=>g.branchId===f.branches[0].id);
  const sourceGrant=people[0].grants.find((g:any)=>g.branchId===f.branches[1].id);
  ok(await f.actors[0].post("/api/inventory/moves").set("X-Workspace-Responsibility",String(destinationGrant.id))
   .set("Idempotency-Key",randomUUID()).send({...movement(id,"receipt",2),warehouseId:dest,lotId:a.lotId}),201);
  const lock=await pool.connect();await lock.query("BEGIN");
  await lock.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`${id}-${Math.min(source,dest)}-0-${a.lotId}`]);
  const forward=send({...transfer(id,2),lotId:a.lotId}).then(r=>r);
  const reverse=f.actors[0].post("/api/inventory/transfers").set("X-Workspace-Responsibility",String(destinationGrant.id))
   .set("Idempotency-Key",randomUUID()).send({productId:id,fromWarehouseId:dest,toWarehouseId:source,lotId:a.lotId,
    quantity:1,destinationResponsibilityId:sourceGrant.id,notes:"الاتجاه المعاكس"}).then(r=>r);
  try{
   await waitForAdvisory(2);await lock.query("COMMIT");
   (await Promise.all([forward,reverse])).forEach(r=>ok(r,201));
   expect(Number((await reconcile(id)).transit)).toBe(21);
  }finally{await lock.query("ROLLBACK");lock.release();await Promise.allSettled([forward,reverse]);}
 });
 it("rolls back every FEFO slice after audit failure and safely retries the original intent",async()=>{
  const id=await product();await receipt(id,"أ",2,day(10));await receipt(id,"ب",2,day(20));
  const before=await snapshot(id),key=randomUUID(),fn=`reject_lot_audit_${id}`;
  await pool.query(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
   IF NEW.company_id=${company} AND NEW.action='inventory.transfer.send' THEN RAISE EXCEPTION 'synthetic lot audit failure'; END IF;
   RETURN NEW; END $$`);
  await pool.query(`CREATE TRIGGER ${fn} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${fn}()`);
  try{ok(await send(transfer(id,3),key),400);expect(await snapshot(id)).toEqual(before);}
  finally{await pool.query(`DROP TRIGGER ${fn} ON audit_logs`);await pool.query(`DROP FUNCTION ${fn}()`);}
  const out=ok(await send(transfer(id,3),key),201);expect(out.moveIds).toHaveLength(2);await reconcile(id);
 });
 it("deduplicates concurrent receipt of a new lot without merging conflicting expiry histories",async()=>{
  const id=await product(),key=randomUUID(),body={...movement(id),lotNumber:"نفس الدفعة",expiryDate:day(10)};
  const results=await Promise.all([send(body,key),send(body,key)]);results.forEach(r=>ok(r,201));
  expect(results[0].body).toEqual(results[1].body);
  const before=await snapshot(id);expect(before.lots).toHaveLength(1);expect(Number(before.quants[0].quantity)).toBe(2);
  expect((await send({...body,expiryDate:day(11)})).status).toBeGreaterThanOrEqual(400);
  expect(await snapshot(id)).toEqual(before);await reconcile(id);
 });
 it("receives concurrent different anchors of one lot group only once",async()=>{
  const id=await product();await receipt(id,"أ",1,day(10));await receipt(id,"ب",1,day(20));
  const out=ok(await send(transfer(id,2)),201);expect(out.moveIds).toHaveLength(2);
  const results=await Promise.all(out.moveIds.map((id:number)=>receive(id)));
  expect(results.map(r=>r.status).sort()).toEqual([200,409]);
  const state=await snapshot(id);expect(state.moves.filter(m=>out.moveIds.includes(m.id)).every(m=>m.state==="done")).toBe(true);
  expect(Number((await reconcile(id)).physical)).toBe(14);
 });
 it("rechecks lot expiry after a real stock-key wait",async()=>{
  const id=await product(),a=await receipt(id,"تنتهي أثناء الانتظار",2,day(1)),before=await snapshot(id),lock=await pool.connect(),now=Date.now();
  await lock.query("BEGIN");await lock.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`${id}-${source}-0-${a.lotId}`]);
  const pending=send({...movement(id,"issue",1),lotId:a.lotId}).then(r=>r);
  try{
   await waitForAdvisory();vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date(now+3*86400000));
   await lock.query("COMMIT");const r=await pending;ok(r,400);expect(JSON.stringify(r.body)).toMatch(/منتهي/);
   expect(await snapshot(id)).toEqual(before);
  }finally{vi.useRealTimers();await lock.query("ROLLBACK");lock.release();await Promise.allSettled([pending]);}
 });
 it("supports the minimum four-decimal lot quantity without zero moves, lost cost or negative residual stock",async()=>{
  const id=await product();await rows("UPDATE products SET cost_price=10000 WHERE id=$1",[id]);
  const a=await receipt(id,"دقة أربع منازل",0.0002);
  ok(await send({...movement(id,"issue",0.0001),lotId:a.lotId}),201);
  const [q]=await rows("SELECT quantity::text,avg_cost::text FROM stock_quants WHERE product_id=$1",[id]);
  expect(Number(q.quantity)).toBe(0.0001);expect(Number(q.avg_cost)).toBeCloseTo(10000,8);
  const out=ok(await send(movement(id,"issue",0.0001)),201);expect(out.moveId).toBeGreaterThan(0);expect(out.moveIds).toHaveLength(1);
  const before=await snapshot(id);
  ok(await send({...movement(id,"issue",0.0001),lotId:a.lotId}),400);expect(await snapshot(id)).toEqual(before);
  const [empty]=await rows("INSERT INTO stock_lots(product_id,lot_number,expiry_date) VALUES($1,'فارغة',$2) RETURNING id",[id,day(10)]);
  ok(await send({...movement(id,"issue",0.0001),lotId:empty.id}),400);
  expect((await rows("SELECT * FROM stock_quants WHERE product_id=$1 AND lot_id=$2",[id,empty.id]))).toEqual([]);
  expect(Number((await reconcile(id)).physical)).toBe(0);
 });
});
