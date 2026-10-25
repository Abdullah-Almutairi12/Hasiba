import {randomUUID} from "node:crypto";
import {describe,it,expect} from "vitest";
import {pool} from "@workspace/db";
import {posTemplateFixture,personInput,accepted as ok,fixtureRows as rows} from "../test/pos-template-fixture";

const actions=["procurement.read","procurement.receipts.read","procurement.receipts.receive"];
async function fixture(){
  const f=await posTemplateFixture();
  const t=ok(await f.owner.post("/api/team/templates").send({name:"استلام مستقل بلا أسعار",resource:"procurement",actions}),201);
  const people:any[]=[];
  for(let i=0;i<3;i++)people.push(ok(await f.owner.put(`/api/team/people/${f.people[i].personId}/access`).send({
    expectedRevision:f.people[i].revision,suspended:false,person:{...personInput(f.people[i]),
      loginKinds:["platform"],deniedActions:[],grants:[{resource:"procurement",branchId:f.branches[i===2?1:0].id,
        warehouseIds:[f.warehouses[i===2?1:0].id],actions,amountLimit:null,startsAt:null,endsAt:null,
        templateId:t.id,templateRevision:1,templateMode:"inherit"}]},
  })));
  const supplier=ok(await f.owner.post("/api/suppliers").send({name:`مورد استلام ${randomUUID()}`}),201);
  const create=async(warehouseId=f.warehouses[0].id)=>{
    const po=ok(await f.owner.post("/api/procurement/purchase-orders").set("Idempotency-Key",randomUUID()).send({
      supplierId:supplier.id,warehouseId,lines:[{productId:f.products[0].id,description:"صنف شراء للاستلام",quantity:10,unitPrice:7.25,taxRate:0}],
    }),201);
    ok(await f.owner.post(`/api/procurement/purchase-orders/${po.id}/confirm`).send({}));
    return ok(await f.owner.get(`/api/procurement/purchase-orders/${po.id}`));
  };
  const selected=(i:number,method:"get"|"post",path:string)=>
    f.actors[i][method](`/api${path}`).set("X-Workspace-Responsibility",String(people[i].grants[0].id));
  const receive=(po:any,quantity:number,key=randomUUID(),i=0,extra:any={})=>selected(i,"post","/procurement/goods-receipts")
    .set("Idempotency-Key",key).send({poId:po.id,lines:[{poLineId:po.lines[0].id,quantity}],...extra});
  const update=async(patch:any)=>{
    people[0]=ok(await f.owner.put(`/api/team/people/${people[0].personId}/access`).send({
      expectedRevision:people[0].revision,suspended:false,person:{...personInput(people[0]),...patch},
    }));
  };
  return {...f,people,t,selected,receive,create,update};
}
describe("purchase receiving with independent existing responsibilities",()=>{
  it("reads quantities without purchase prices, supplier finance or implicit approval/print/export/payment",async()=>{
    const f=await fixture(),po=await f.create();
    const list=ok(await f.selected(0,"get","/procurement/purchase-orders"));
    const item=list.find((p:any)=>p.id===po.id);
    expect(item).toMatchObject({receiptOnly:true,warehouseId:f.warehouses[0].id});
    for(const k of ["total","subtotal","vat","exchangeRate","notes","supplierId"])expect(item).not.toHaveProperty(k);
    const detail=ok(await f.selected(0,"get",`/procurement/purchase-orders/${po.id}`));
    expect(detail.lines[0]).toMatchObject({quantity:10,receivedQty:0,remainingQty:10,productId:f.products[0].id});
    for(const k of ["unitPrice","unitCost","lineTotal","taxRate","billedQty"])expect(detail.lines[0]).not.toHaveProperty(k);
    for(const suffix of ["approve","confirm","cancel","close","send"])
      ok(await f.selected(0,"post",`/procurement/purchase-orders/${po.id}/${suffix}`).send({}),403);
    for(const path of ["/suppliers",`/procurement/purchase-orders/${po.id}/pdf`,`/procurement/purchase-orders/${po.id}/pdf?download=1`,
      "/exports/suppliers.xlsx","/procurement/ap-aging","/procurement/stats"])
      ok(await f.selected(0,"get",path),403);
    for(const path of ["/procurement/payment-runs","/procurement/match","/inventory/moves","/accounting/journal-entries"])
      ok(await f.selected(0,"post",path).send({}),403);
    ok(await f.selected(0,"post","/procurement/goods-receipts").send({poId:po.id,lines:[{poLineId:po.lines[0].id,quantity:1}]}),400);
  });
  it("receives partial then full exactly once under concurrent retries and reconciles stock with the automatic journal",async()=>{
    const f=await fixture(),po=await f.create(),key=randomUUID();
    const replies=await Promise.all([f.receive(po,3,key),f.receive(po,3,key)]);
    const a=ok(replies[0],201),b=ok(replies[1],201);
    expect(a.id).toBe(b.id);expect(replies.some(r=>r.headers["idempotency-replayed"]==="true")).toBe(true);
    expect(a).not.toHaveProperty("journalEntryId");expect(a).not.toHaveProperty("totalValue");
    expect(ok(await f.selected(0,"get",`/procurement/purchase-orders/${po.id}`)).status).toBe("partially_received");
    ok(await f.receive(po,7),201);
    const final=ok(await f.selected(0,"get",`/procurement/purchase-orders/${po.id}`));
    expect(final.status).toBe("fully_received");expect(final.lines[0].remainingQty).toBe(0);
    ok(await f.receive(po,0.0001),409);
    const grns=ok(await f.selected(0,"get",`/procurement/goods-receipts?poId=${po.id}`));
    expect(grns).toHaveLength(2);
    const moves=await rows(`SELECT SUM(quantity)::float8 q,SUM(quantity*unit_cost)::float8 v,COUNT(*)::int n
      FROM stock_moves WHERE source_type='goods_receipt' AND source_id=ANY($1::int[])`,[grns.map((g:any)=>g.id)]);
    expect(moves[0]).toMatchObject({q:10,v:72.5,n:2});
    const gl=await rows(`SELECT SUM(l.debit)::float8 d,SUM(l.credit)::float8 c,COUNT(DISTINCT e.id)::int n
      FROM journal_entries e JOIN journal_entry_lines l ON l.entry_id=e.id
      WHERE e.company_id=$1 AND e.source_ref=ANY($2::text[])`,[f.companies[0].id,grns.map((g:any)=>`GRN-${g.id}`)]);
    expect(gl[0]).toMatchObject({d:72.5,c:72.5,n:2});
    const quant=await rows(`SELECT SUM(quantity)::float8 q FROM stock_quants WHERE product_id=$1 AND warehouse_id=$2`,
      [f.products[0].id,f.warehouses[0].id]);
    expect(quant[0].q).toBe(30);
  });
  it("rejects destination, company, foreign line and malformed/over-receipt quantities atomically",async()=>{
    const f=await fixture(),po=await f.create();
    for(const warehouseId of [f.warehouses[1].id,f.warehouses[2].id,f.extraWarehouse.id])
      ok(await f.receive(po,1,randomUUID(),0,{warehouseId}),warehouseId===f.warehouses[2].id?404:403);
    ok(await f.receive(po,1,randomUUID(),2),403);
    const other=await f.create(f.warehouses[1].id);
    ok(await f.selected(0,"get",`/procurement/purchase-orders/${other.id}`),403);
    ok(await f.receive(other,1),403);
    for(const quantity of [0,-1,0.00001,10.0001])
      ok(await f.receive(po,quantity),quantity===10.0001?409:400);
    ok(await f.receive(po,1,randomUUID(),0,{lines:[{poLineId:other.lines[0].id,quantity:1}]}),400);
    ok(await f.receive(po,1,randomUUID(),0,{lines:[{poLineId:po.lines[0].id,quantity:1},{poLineId:po.lines[0].id,quantity:1}]}),400);
    expect(ok(await f.selected(0,"get",`/procurement/goods-receipts?poId=${po.id}`))).toHaveLength(0);
    const [supplier]=await rows("INSERT INTO suppliers(company_id,name) VALUES($1,'مورد شركة ثانية مصطنع') RETURNING id",[f.companies[1].id]);
    const [foreign]=await rows(`INSERT INTO purchase_orders(company_id,reference,supplier_id,supplier_name,warehouse_id,order_date,status)
      VALUES($1,$2,$3,'مصطنع',$4,current_date,'confirmed') RETURNING id`,
      [f.companies[1].id,randomUUID(),supplier.id,f.warehouses[2].id]);
    ok(await f.selected(0,"get",`/procurement/purchase-orders/${foreign.id}`),403);
    ok(await f.receive({...po,id:foreign.id},1),404);
    expect(ok(await f.selected(0,"get","/procurement/purchase-orders")).some((p:any)=>p.id===foreign.id)).toBe(false);
  });
  it("recovers a committed result after receive is withdrawn but denies a fresh receipt and read-revoked replay",async()=>{
    const f=await fixture(),po=await f.create(),key=randomUUID(),first=ok(await f.receive(po,2,key),201);
    await f.update({grants:[{...personInput(f.people[0]).grants[0],templateMode:"override",
      amountLimit:"1",actions:["procurement.read","procurement.receipts.read"]}]});
    const replay=await f.receive(po,2,key);expect(ok(replay,201).id).toBe(first.id);
    expect(replay.headers["idempotency-replayed"]).toBe("true");
    ok(await f.receive(po,1),403);
    ok(await f.receive(po,3,key),409);
    await f.update({deniedActions:["procurement.receipts.read"]});
    ok(await f.receive(po,2,key),403);
    expect((await rows("SELECT received_qty FROM purchase_order_lines WHERE id=$1",[po.lines[0].id]))[0].received_qty).toBe("2.0000");
  });
  it("rechecks receiving authority after a writer-fence wait without a partial GRN, move or journal",async()=>{
    const f=await fixture(),po=await f.create(),client=await pool.connect();
    try{
      await client.query("BEGIN");await client.query("SELECT pg_advisory_xact_lock(174223,35)");
      await client.query("UPDATE responsibility_grants SET actions=ARRAY['procurement.read','procurement.receipts.read'] WHERE id=$1",[f.people[0].grants[0].id]);
      const pending=f.receive(po,2).then(r=>r);
      await new Promise(r=>setTimeout(r,100));await client.query("COMMIT");
      ok(await pending,403);
      expect((await rows("SELECT count(*)::int n FROM goods_receipts WHERE po_id=$1",[po.id]))[0].n).toBe(0);
    }finally{await client.query("ROLLBACK");client.release();}
  });
  it("serializes different attempts against the remaining quantity and applies time/amount/upper deny rules",async()=>{
    const f=await fixture(),po=await f.create();
    const result=await Promise.all([f.receive(po,6),f.receive(po,6,randomUUID(),1)]);
    expect(result.map(r=>r.status).sort()).toEqual([201,409]);
    await f.update({deniedActions:["procurement.receipts.receive"]});
    ok(await f.receive(po,1),403);
    await f.update({deniedActions:[],grants:[{...personInput(f.people[0]).grants[0],amountLimit:"1",templateMode:"override"}]});
    ok(await f.receive(po,1),403);
    await rows("UPDATE responsibility_grants SET ends_at=clock_timestamp()-interval '1 second',starts_at=clock_timestamp()-interval '1 hour' WHERE id=$1",[f.people[1].grants[0].id]);
    ok(await f.receive(po,1,randomUUID(),1),403);
  });
});
