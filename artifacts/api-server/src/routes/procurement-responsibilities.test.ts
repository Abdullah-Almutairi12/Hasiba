import {describe,it,expect} from "vitest";
import {randomUUID} from "node:crypto";
import {pool} from "@workspace/db";
import {posTemplateFixture,accepted as ok,personInput,fixtureRows as rows} from "../test/pos-template-fixture";

const actions=["read","suppliers.read","suppliers.create","suppliers.edit","suppliers.export",
  "orders.read","orders.create","orders.confirm","orders.approve","orders.cancel","orders.close","orders.print","orders.export","orders.send"]
  .map(a=>`procurement.${a}`);
async function fixture(){
  const f=await posTemplateFixture();
  const t=ok(await f.owner.post("/api/team/templates").send({name:"مشتريات محدودة مستقلة",resource:"procurement",actions}),201);
  const people:any[]=[];
  for(let i=0;i<3;i++){
    const p=f.people[i];
    people.push(ok(await f.owner.put(`/api/team/people/${p.personId}/access`).send({
      expectedRevision:p.revision,suspended:false,person:{...personInput(p),loginKinds:["platform"],
        deniedActions:[],grants:[{resource:"procurement",branchId:f.branches[i===2?1:0].id,
          warehouseIds:[f.warehouses[i===2?1:0].id],actions,amountLimit:"100000",
          startsAt:null,endsAt:null,templateId:t.id,templateRevision:1,templateMode:i===2?"override":"inherit"}]},
    })));
  }
  const supplier=ok(await f.owner.post("/api/suppliers").send({name:`مورد ${randomUUID()}`,email:"purchase@example.invalid"}),201);
  const otherSupplier=(await rows(`INSERT INTO suppliers(company_id,name) VALUES($1,'مورد الشركة الأخرى') RETURNING id`,[f.companies[1].id]))[0];
  const selected=(i:number,method:"get"|"post"|"patch",path:string)=>
    f.actors[i][method](`/api${path}`).set("X-Workspace-Responsibility",String(people[i].grants[0].id));
  const body=(warehouseId=f.warehouses[0].id,price=10)=>({supplierId:supplier.id,warehouseId,
    lines:[{description:"بند شراء",quantity:2,unitPrice:price,taxRate:0}],total:0.01});
  const create=async(price=10,i=0)=>ok(await selected(i,"post","/procurement/purchase-orders")
    .set("Idempotency-Key",randomUUID()).send(body(f.warehouses[i===2?1:0].id,price)),201);
  const update=async(i:number,patch:any)=>{
    const old=people[i];people[i]=ok(await f.owner.put(`/api/team/people/${old.personId}/access`).send({
      expectedRevision:old.revision,suspended:false,person:{...personInput(old),...patch},
    }));return people[i];
  };
  return {...f,people,t,supplier,otherSupplier,selected,body,create,update};
}
describe("native suppliers and purchase orders use existing responsibilities",()=>{
  it("isolates company, actual warehouse branch and exact server amounts; grants no payments or stock receipts",async()=>{
    const f=await fixture(),po=await f.create();
    expect(Number(po.total)).toBe(20);
    const list=ok(await f.selected(0,"get","/procurement/purchase-orders"));
    expect(list.map((p:any)=>p.id)).toContain(po.id);
    ok(await f.selected(2,"get",`/procurement/purchase-orders/${po.id}`),403);
    ok(await f.selected(0,"post","/procurement/purchase-orders").send({...f.body(),supplierId:f.otherSupplier.id}),404);
    ok(await f.selected(0,"post","/procurement/purchase-orders").send(f.body(f.warehouses[1].id)),403);
    ok(await f.selected(0,"post","/procurement/purchase-orders").send({...f.body(),warehouseId:null}),403);
    for(const path of ["/procurement/payment-runs","/procurement/goods-receipts","/procurement/match"])
      ok(await f.selected(0,"post",path).send({}),403);
    const suppliers=ok(await f.selected(0,"get","/suppliers"));
    expect(suppliers.some((s:any)=>s.id===f.otherSupplier.id)).toBe(false);
    expect(suppliers[0]).not.toHaveProperty("balance");
    expect(suppliers[0]).not.toHaveProperty("invoicesCount");
    const detail=ok(await f.selected(0,"get",`/suppliers/${f.supplier.id}`));
    expect(detail).not.toHaveProperty("recentInvoices");expect(detail.supplier).not.toHaveProperty("balance");
  });
  it("separates read/create/edit/print/export/send and blocks direct native routes after denial in the open session",async()=>{
    const f=await fixture(),po=await f.create();
    await f.update(0,{grants:[{...personInput(f.people[0]).grants[0],templateMode:"override",
      actions:["procurement.read","procurement.suppliers.read","procurement.orders.read"]}]});
    ok(await f.selected(0,"get",`/procurement/purchase-orders/${po.id}`));
    for(const path of [`/procurement/purchase-orders/${po.id}/pdf`,
      `/procurement/purchase-orders/${po.id}/pdf?download=1`,"/exports/suppliers.xlsx","/exports/suppliers.pdf"])
      ok(await f.selected(0,"get",path),403);
    for(const op of ["confirm","approve","cancel","close","send"])
      ok(await f.selected(0,"post",`/procurement/purchase-orders/${po.id}/${op}`).send({}),403);
    ok(await f.selected(0,"post","/suppliers").send({name:"غير مصرح"}),403);
    ok(await f.selected(0,"patch",`/suppliers/${f.supplier.id}`).send({name:"غير مصرح"}),403);
    ok(await f.selected(0,"post","/procurement/purchase-orders").send(f.body()),403);
  });
  it("applies amount/time/upper denial and template inheritance without replacing an individual exception",async()=>{
    const f=await fixture();
    await f.update(0,{deniedActions:["procurement.orders.print"],grants:[{...personInput(f.people[0]).grants[0],amountLimit:"20"}]});
    await f.create(10);
    ok(await f.selected(0,"post","/procurement/purchase-orders").send(f.body(f.warehouses[0].id,10.01)),403);
    const edit={expectedRevision:1,name:"قراءة فقط",actions:["procurement.read","procurement.orders.read","procurement.suppliers.read"]};
    const preview=ok(await f.owner.post(`/api/team/templates/${f.t.id}/preview`).send(edit));
    ok(await f.owner.put(`/api/team/templates/${f.t.id}`).send({...edit,digest:preview.digest}));
    const people=ok(await f.owner.get("/api/team/people"));
    for(let i=0;i<3;i++)f.people[i]=people.find((p:any)=>p.personId===f.people[i].personId);
    expect(f.people[0].grants[0].actions).not.toContain("procurement.orders.create");
    expect(f.people[2].grants[0].actions).toContain("procurement.orders.create");
    await rows("UPDATE responsibility_grants SET ends_at=clock_timestamp()-interval '1 second',starts_at=clock_timestamp()-interval '1 hour' WHERE id=$1",[f.people[2].grants[0].id]);
    ok(await f.selected(2,"get","/procurement/purchase-orders"),403);
  });
  it("rechecks a revoked create grant after waiting for the authority writer fence, without a partial PO or receipt",async()=>{
    const f=await fixture(),client=await pool.connect();
    try{
      await client.query("BEGIN");await client.query("SELECT pg_advisory_xact_lock(174223,35)");
      await client.query("UPDATE responsibility_grants SET revoked_at=clock_timestamp() WHERE id=$1",[f.people[0].grants[0].id]);
      const request=f.selected(0,"post","/procurement/purchase-orders").set("Idempotency-Key","purchase-revocation-race").send(f.body()).then(r=>r);
      await new Promise(resolve=>setTimeout(resolve,100));
      await client.query("COMMIT");
      ok(await request,403);
      expect((await rows("SELECT count(*)::int n FROM purchase_orders WHERE company_id=$1",[f.companies[0].id]))[0].n).toBe(0);
    }finally{await client.query("ROLLBACK");client.release();}
  });
  it("uses original workflow facts and current independent reviewer; concurrent confirmations never release twice",async()=>{
    const f=await fixture(),po=await f.create(30000);
    const pending=ok(await f.selected(0,"post",`/procurement/purchase-orders/${po.id}/confirm`).send({}),202);
    expect(pending.approvalRequestId).toBeTruthy();
    ok(await f.selected(0,"post",`/procurement/purchase-orders/${po.id}/approve`).send({}),403);
    ok(await f.selected(1,"post",`/procurement/purchase-orders/${po.id}/approve`).send({}));
    expect(ok(await f.selected(0,"get",`/procurement/purchase-orders/${po.id}`)).status).toBe("confirmed");
    const second=await f.create(30000);
    ok(await f.selected(0,"post",`/procurement/purchase-orders/${second.id}/confirm`).send({}),202);
    await rows("UPDATE purchase_order_lines SET description='تعديل جوهري بنفس المبلغ' WHERE po_id=$1",[second.id]);
    ok(await f.selected(1,"post",`/procurement/purchase-orders/${second.id}/approve`).send({}),409);
    expect((await rows("SELECT status FROM purchase_orders WHERE id=$1",[second.id]))[0].status).not.toBe("confirmed");
    const small=await f.create();
    const replies=await Promise.all([0,1].map(()=>f.selected(0,"post",`/procurement/purchase-orders/${small.id}/confirm`).send({})));
    expect(replies.map(r=>r.status).sort()).toEqual([200,409]);
    expect((await rows("SELECT count(*)::int n FROM audit_logs WHERE company_id=$1 AND action='purchase_order.confirmed' AND details::jsonb->'source'->>'id'=$2",[f.companies[0].id,String(small.id)]))[0].n).toBe(1);
  });
  it("exports directory only, prints owned sources, and records real grant evidence",async()=>{
    const f=await fixture(),po=await f.create();
    ok(await f.selected(0,"get",`/procurement/purchase-orders/${po.id}/pdf`));
    const download=await f.selected(0,"get",`/procurement/purchase-orders/${po.id}/pdf?download=1`);
    expect(download.status).toBe(200);expect(download.headers["content-disposition"]).toContain("attachment");
    const exported=await f.selected(0,"get","/exports/suppliers.xlsx").buffer(true).parse((res,done)=>{
      const chunks:Buffer[]=[];
      res.on("data",(chunk:Buffer)=>chunks.push(chunk));
      res.on("end",()=>done(null,Buffer.concat(chunks)));
      res.on("error",done);
    });
    expect(exported.status).toBe(200);
    const {default:ExcelJS}=await import("exceljs");
    const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(exported.body);
    expect(workbook.worksheets[0].columnCount).toBe(4);
    const audit=await rows("SELECT details::jsonb AS facts FROM audit_logs WHERE company_id=$1 AND action='purchase_order.created'",[f.companies[0].id]);
    expect(audit[0].facts.grant.resource).toBe("procurement");
    expect(audit[0].facts.grant.id).toBe(f.people[0].grants[0].id);
  },120_000);
  it("revalidates a prior reviewer at final execution and retains the earlier decision after revocation",async()=>{
    const f=await fixture(),po=await f.create(30000);
    await f.update(2,{grants:[{...personInput(f.people[2]).grants[0],branchId:f.branches[0].id,warehouseIds:[f.warehouses[0].id]}]});
    const rule=(await rows(`INSERT INTO approval_rules(company_id,name,doc_type,min_amount,mode,is_active)
      VALUES($1,'مراجعة مستقلة بخطوتين','purchase_order',0,'sequential',true) RETURNING id`,[f.companies[0].id]))[0];
    for(let i=1;i<=2;i++)await rows(`INSERT INTO approval_steps(rule_id,sequence,approver_role,approver_user_id)
      VALUES($1,$2,'scoped',$3)`,[rule.id,i,f.people[i].userId]);
    ok(await f.selected(0,"post",`/procurement/purchase-orders/${po.id}/confirm`).send({}),202);
    const first=ok(await f.selected(1,"get",`/procurement/purchase-orders/${po.id}`)).review;
    expect(first.actionableSteps).toHaveLength(1);
    ok(await f.selected(1,"post",`/procurement/purchase-orders/${po.id}/approve`).send({
      stepToken:first.actionableSteps[0].stepToken,decisionId:randomUUID(),
    }));
    await f.update(1,{deniedActions:["procurement.orders.approve"]});
    const last=ok(await f.selected(2,"get",`/procurement/purchase-orders/${po.id}`)).review;
    ok(await f.selected(2,"post",`/procurement/purchase-orders/${po.id}/approve`).send({
      stepToken:last.actionableSteps[0].stepToken,decisionId:randomUUID(),
    }),403);
    expect((await rows("SELECT status FROM purchase_orders WHERE id=$1",[po.id]))[0].status).toBe("pending_approval");
    const saved=await rows(`SELECT a.action,a.authority_fingerprint FROM approval_actions a
      JOIN approval_requests r ON r.id=a.request_id WHERE r.record_id=$1 AND r.doc_type='purchase_order'
      AND a.action='approve'`,[po.id]);
    expect(saved).toHaveLength(1);expect(saved[0].authority_fingerprint).toBeTruthy();
  });
});
