import {randomUUID} from "node:crypto";
import {describe,it,expect} from "vitest";
import {pool} from "@workspace/db";
import {posTemplateFixture,personInput,testActor,accepted as ok,fixtureRows as rows} from "../test/pos-template-fixture";
async function fixture(){
 const f=await posTemplateFixture();
 const supplier=ok(await f.owner.post("/api/suppliers").send({name:`مورد دورة ${randomUUID()}`}),201);
 const [account]=await rows(`SELECT id FROM accounts WHERE type='expense' AND NOT is_group AND is_active LIMIT 1`);
 const body={supplierId:supplier.id,invoiceNumber:`مصدر-${randomUUID()}`,invoiceDate:new Date().toISOString().slice(0,10),
   branchId:f.branches[0].id,kind:"expense",expenseAccountId:account.id,
   items:[{description:"خدمة أصلية",quantity:2,unitPrice:50,taxRate:0,unit:"piece"}]};
 const create=(input=body,key=randomUUID())=>f.owner.post("/api/invoices/drafts").set("Idempotency-Key",key).send(input);
 const process=(id:number,action:string,key=randomUUID(),extra={})=>f.owner.post(`/api/invoices/${id}/process`)
   .set("Idempotency-Key",key).send({action,...extra});
 let person=f.people[0];
 const assign=async(actions:string[],grantPatch={},personPatch={})=>{
   person=ok(await f.owner.put(`/api/team/people/${person.personId}/access`).send({
     expectedRevision:person.revision,suspended:false,person:{...personInput(person),loginKinds:["platform"],
       ...personPatch,grants:[{resource:"procurement",branchId:f.branches[0].id,warehouseIds:[],
         actions:["procurement.read",...actions],amountLimit:null,startsAt:null,endsAt:null,...grantPatch}]}}));
   return person;
 };
 const scoped=(method:"get"|"post"|"patch",path:string)=>f.actors[0][method](`/api${path}`)
   .set("X-Workspace-Responsibility",String(person.grants[0].id));
 return {...f,supplier,body,create,process,assign,scoped};
}
const invoiceActions=["read","compare","create","edit","review","submit","approve","post","cancel","reverse"]
  .map(a=>`procurement.invoices.${a}`);
async function replica(f:Awaited<ReturnType<typeof fixture>>){
 const actor=testActor();ok(await actor.post("/api/auth/login").send({email:f.ownerUser.email,password:f.password}));
 return actor;
}
async function purchase(f:Awaited<ReturnType<typeof fixture>>,quantity=10){
 const po=ok(await f.owner.post("/api/procurement/purchase-orders").send({supplierId:f.supplier.id,
   warehouseId:f.warehouses[0].id,lines:[{productId:f.products[0].id,description:"بضاعة فعلية",quantity,unitPrice:10,taxRate:0}]}),201);
 const detail=ok(await f.owner.get(`/api/procurement/purchase-orders/${po.id}`));
 const [creator]=await rows(`SELECT id FROM users WHERE email=$1`,[personInput(f.people[0]).email]);
 await rows(`UPDATE purchase_orders SET status='confirmed',created_by=$2 WHERE id=$1 RETURNING id`,[po.id,creator.id]);
 const receive=(qty:number)=>f.owner.post("/api/procurement/goods-receipts").set("Idempotency-Key",randomUUID())
   .send({poId:po.id,lines:[{poLineId:detail.lines[0].id,quantity:qty}]});
 const body=(qty:number,price=10)=>({...f.body,invoiceNumber:`شراء-${randomUUID()}`,kind:"goods",poId:po.id,
   items:[{description:"بند فاتورة فعلي",poLineId:detail.lines[0].id,productId:f.products[0].id,
     quantity:qty,unitPrice:price,taxRate:0,unit:f.products[0].unit??"piece"}]});
 return {po,detail,receive,body};
}
describe("original supplier invoice lifecycle",()=>{
 it("stores original lines, reviews and posts once; recovers a committed result and reverses without stock",async()=>{
   const f=await fixture(),draft=ok(await f.create());
   expect(draft.amount).toBe("100.00");
   const evidence=ok(await f.owner.get(`/api/invoices/${draft.id}/evidence`));
   expect(evidence.lines[0]).toMatchObject({description:"خدمة أصلية",quantity:"2.000000",unitPrice:"50.000000"});
   expect((await f.process(draft.id,"post")).status).toBe(409);
   ok(await f.process(draft.id,"review"));ok(await f.process(draft.id,"submit"));
   const key=randomUUID(),posted=ok(await f.process(draft.id,"post",key));
   expect(posted.status).toBe("done");expect(ok(await f.process(draft.id,"post",key))).toEqual(posted);
   const [finance]=await rows(`SELECT (SELECT sum(debit-credit) FROM journal_entry_lines l WHERE l.entry_id=i.journal_entry_id) AS delta,
      (SELECT count(*) FROM journal_entries j WHERE j.source_ref=$2 AND j.company_id=$3) AS count
      FROM invoices i WHERE id=$1`,[draft.id,`SINV-${draft.id}`,f.companies[0].id]);
   expect(Number(finance.delta)).toBe(0);expect(Number(finance.count)).toBe(1);
   const reversalKey=randomUUID();
   const reversed=ok(await f.process(draft.id,"reverse",reversalKey,{reason:"تصحيح موثق"}));
   expect(reversed.status).toBe("reversed");
   expect(ok(await f.process(draft.id,"reverse",reversalKey,{reason:"تصحيح موثق"}))).toEqual(reversed);
   const [balance]=await rows(`SELECT balance FROM suppliers WHERE id=$1`,[f.supplier.id]);
   expect(Number(balance.balance)).toBe(0);
 });
 it("uses canonical source identity, not amount similarity, including concurrent creates",async()=>{
   const f=await fixture();
   const rival=await replica(f);
   const results=await Promise.all([f.create(),rival.post("/api/invoices/drafts").set("Idempotency-Key",randomUUID()).send(f.body)]);
   expect(results.map(r=>r.status).sort()).toEqual([200,409]);
   expect((await f.create({...f.body,invoiceNumber:`آخر-${randomUUID()}`})).status).toBe(200);
   const other=ok(await f.owner.post("/api/suppliers").send({name:`مورد آخر ${randomUUID()}`}),201);
   expect((await f.create({...f.body,supplierId:other.id})).status).toBe(200);
 });
 it("retains prior facts on draft edit and requires a new review; cancellation keeps evidence",async()=>{
   const f=await fixture(),draft=ok(await f.create());
   ok(await f.process(draft.id,"review"));
   ok(await f.owner.patch(`/api/invoices/${draft.id}/draft`).set("Idempotency-Key",randomUUID())
     .send({...f.body,items:[{...f.body.items[0],quantity:3}]}));
   expect((await f.process(draft.id,"submit")).status).toBe(409);
   const [history]=await rows(`SELECT facts FROM supplier_invoice_revisions WHERE invoice_id=$1`,[draft.id]);
   expect(Number(history.facts.lines[0].quantity)).toBe(2);
   expect((await f.owner.patch(`/api/invoices/${draft.id}`).send({amount:1})).status).toBe(409);
   expect((await f.owner.delete(`/api/invoices/${draft.id}`)).status).toBe(409);
   ok(await f.process(draft.id,"cancel"));
   expect(ok(await f.owner.get(`/api/invoices/${draft.id}/evidence`)).lines).toHaveLength(1);
 });
 it("reconciles multiple receipts and partial invoices without reusing quantities or adding stock at billing",async()=>{
   const f=await fixture(),p=await purchase(f);
   const firstReceipt=ok(await p.receive(4),201);
   const first=ok(await f.create(p.body(3,10.2)));
   ok(await f.process(first.id,"review"));ok(await f.process(first.id,"submit"));ok(await f.process(first.id,"post"));
   ok(await p.receive(6),201);
   const second=ok(await f.create(p.body(7)));
   ok(await f.process(second.id,"review"));ok(await f.process(second.id,"submit"));
   const key=randomUUID();ok(await f.process(second.id,"post",key));ok(await f.process(second.id,"post",key));
   const [balance]=await rows(`SELECT billed_qty,received_qty FROM purchase_order_lines WHERE id=$1`,[p.detail.lines[0].id]);
   expect(Number(balance.billed_qty)).toBe(10);expect(Number(balance.received_qty)).toBe(10);
   const allocations=await rows(`SELECT a.*,e.invoice_id FROM supplier_invoice_receipt_allocations a
     JOIN supplier_invoice_lines e ON e.id=a.invoice_line_id WHERE e.invoice_id=ANY($1::integer[])`,[[first.id,second.id]]);
   expect(allocations).toHaveLength(3);expect(allocations.reduce((n,a)=>n+Number(a.quantity),0)).toBe(10);
   const evidence=ok(await f.owner.get(`/api/invoices/${second.id}/evidence`));
   expect(evidence.lines[0].quantity).toBe("7.000000");expect(evidence.receipts).toHaveLength(2);
   const [stock]=await rows(`SELECT count(*) AS count,sum(s.quantity) AS qty FROM stock_moves s
     JOIN warehouses w ON w.id=s.to_warehouse_id WHERE w.company_id=$1 AND s.source_type='goods_receipt'`,[f.companies[0].id]);
   expect(Number(stock.count)).toBe(2);expect(Number(stock.qty)).toBe(10);
   const [clearing]=await rows(`SELECT sum(l.debit-l.credit) AS delta FROM journal_entry_lines l
     JOIN journal_entries j ON j.id=l.entry_id JOIN accounts a ON a.id=l.account_id
     WHERE j.company_id=$1 AND a.system_key='gr_ir' AND j.status='posted'`,[f.companies[0].id]);
   expect(Number(clearing.delta)).toBe(0);
   const [supplier]=await rows(`SELECT balance FROM suppliers WHERE id=$1`,[f.supplier.id]);
   expect(Number(supplier.balance)).toBe(100.6);
   const third=ok(await f.create(p.body(1)));
   expect((await f.process(third.id,"review")).status).toBe(409);
   const reverseKey=randomUUID();
   ok(await f.process(second.id,"reverse",reverseKey,{reason:"تسوية فاتورة جزئية"}));
   ok(await f.process(second.id,"reverse",reverseKey,{reason:"تسوية فاتورة جزئية"}));
   const [after]=await rows(`SELECT billed_qty FROM purchase_order_lines WHERE id=$1`,[p.detail.lines[0].id]);
   expect(Number(after.billed_qty)).toBe(3);
   expect((await rows(`SELECT * FROM supplier_invoice_receipt_allocations a JOIN supplier_invoice_lines e
     ON e.id=a.invoice_line_id WHERE e.invoice_id=$1 AND a.reversed_at IS NULL`,[second.id]))).toHaveLength(0);
   expect((await rows(`SELECT count(*) AS count FROM stock_moves s JOIN warehouses w ON w.id=s.to_warehouse_id
     WHERE w.company_id=$1 AND s.source_type='goods_receipt'`,
     [f.companies[0].id]))[0].count).toBe("2");
 });
 it("requires correction of a quantity discrepancy; two approved invoices cannot consume the same final receipt",async()=>{
   const f=await fixture(),p=await purchase(f,4);ok(await p.receive(4),201);
   const tooMuch=ok(await f.create(p.body(5)));
   expect((await f.process(tooMuch.id,"review")).status).toBe(409);
   const original=ok(await f.owner.get(`/api/invoices/${tooMuch.id}`));
   ok(await f.owner.patch(`/api/invoices/${tooMuch.id}/draft`).set("Idempotency-Key",randomUUID())
     .send({...p.body(4),invoiceNumber:original.invoiceNumber}));
   const second=ok(await f.create(p.body(4)));
   for(const id of [tooMuch.id,second.id]){ok(await f.process(id,"review"));ok(await f.process(id,"submit"));}
   const other=await replica(f);
   const results=await Promise.all([f.process(tooMuch.id,"post"),other.post(`/api/invoices/${second.id}/process`)
     .set("Idempotency-Key",randomUUID()).send({action:"post"})]);
   expect(results.map(r=>r.status).sort()).toEqual([200,409]);
   const [line]=await rows(`SELECT billed_qty FROM purchase_order_lines WHERE id=$1`,[p.detail.lines[0].id]);
   expect(Number(line.billed_qty)).toBe(4);
 });
 it("keeps a scoped session separate from finance and recovers its committed operation after post authority is withdrawn",async()=>{
   const f=await fixture(),draft=ok(await f.create());
   ok(await f.process(draft.id,"review"));ok(await f.process(draft.id,"submit"));
   await f.assign(invoiceActions);
   expect((await f.scoped("post","/suppliers").send({name:"غير مصرح"})).status).toBe(403);
   expect((await f.scoped("get","/procurement/open-invoices")).status).toBe(403);
   expect((await f.scoped("get",`/invoices/${draft.id}/pdf`)).status).toBe(403);
   const key=randomUUID();
   const result=ok(await f.scoped("post",`/invoices/${draft.id}/process`).set("Idempotency-Key",key).send({action:"post"}));
   await f.assign(["procurement.invoices.read"]);
   expect(ok(await f.scoped("post",`/invoices/${draft.id}/process`).set("Idempotency-Key",key).send({action:"post"}))).toEqual(result);
   expect((await f.scoped("post",`/invoices/${draft.id}/process`).set("Idempotency-Key",randomUUID()).send({action:"post"})).status).toBe(403);
   const [foreign]=await rows(`INSERT INTO invoices(company_id,invoice_number,supplier_name,amount)
     VALUES($1,$2,'محجوب',100) RETURNING id`,[f.companies[1].id,randomUUID()]);
   expect((await f.scoped("get",`/invoices/${foreign.id}/evidence`)).status).toBe(404);
   await f.assign(invoiceActions,{amountLimit:"50"});
   expect((await f.scoped("get",`/invoices/${draft.id}`)).status).toBe(404);
 });
 it("honors an upper denial, dates and the actual source warehouse, not a role title",async()=>{
   const f=await fixture(),p=await purchase(f);ok(await p.receive(2),201);
   const draft=ok(await f.create(p.body(2)));ok(await f.process(draft.id,"review"));ok(await f.process(draft.id,"submit"));
   await f.assign(invoiceActions,{}, {deniedActions:["procurement.invoices.post"]});
   expect((await f.scoped("post",`/invoices/${draft.id}/process`).set("Idempotency-Key",randomUUID()).send({action:"post"})).status).toBe(403);
   await f.assign(invoiceActions,{warehouseIds:[f.extraWarehouse.id]},{deniedActions:[]});
   expect((await f.scoped("get",`/invoices/${draft.id}`)).status).toBe(404);
   await f.assign(invoiceActions,{startsAt:new Date(Date.now()-60000).toISOString(),endsAt:new Date(Date.now()-1000).toISOString()},{deniedActions:[]});
   expect((await f.scoped("get",`/invoices/${draft.id}`)).status).toBe(403);
 });
 it("uses the native approval inbox and invalidates old authority without rewriting its decision",async()=>{
   const f=await fixture();await f.assign(["procurement.invoices.read","procurement.invoices.approve"]);
   const [approver]=await rows(`SELECT id FROM users WHERE email=$1`,[personInput(f.people[0]).email]);
   ok(await f.owner.post("/api/workflow/approval-rules").send({name:`مراجعة-${randomUUID()}`,docType:"supplier_invoice",
     branchId:f.branches[0].id,minAmount:0,steps:[{sequence:1,approverRole:"owner",approverUserId:approver.id}]}),201);
   const bypass=await f.owner.post("/api/invoices/from-scan").set("Idempotency-Key",randomUUID()).send({
     supplierName:f.supplier.name,invoiceNumber:randomUUID(),total:100,subtotal:100,vat:0,
     addToInventory:false,postToAccounting:true,items:[{description:"لا يتجاوز الموافقة",quantity:1,unitPrice:100,total:100}]});
   expect(bypass.status).toBe(409);
   const draft=ok(await f.create());ok(await f.process(draft.id,"review"));ok(await f.process(draft.id,"submit"));
   const request=async()=> (await rows(`SELECT * FROM approval_requests WHERE record_id=$1 AND doc_type='supplier_invoice' ORDER BY id DESC`,[draft.id]))[0];
   const first=await request();
   const approve=async(id:number)=>{
     const detail=ok(await f.scoped("get",`/workflow/approval-requests/${id}`));
     expect(detail.actionableSteps).toHaveLength(1);
     return f.scoped("post",`/workflow/approval-requests/${id}/act`).send({action:"approve",
       stepToken:detail.actionableSteps[0].stepToken,decisionId:randomUUID(),comment:"راجعت المصدر"});
   };
   ok(await approve(first.id));
   await f.assign(["procurement.invoices.read"]);
   expect((await f.process(draft.id,"post")).status).toBe(403);
   expect((await rows(`SELECT * FROM approval_actions WHERE request_id=$1 AND action='approve'`,[first.id]))).toHaveLength(1);
   const modified={...f.body,items:[{...f.body.items[0],unitPrice:60}]};
   ok(await f.owner.patch(`/api/invoices/${draft.id}/draft`).set("Idempotency-Key",randomUUID()).send(modified));
   const [history]=await rows(`SELECT status,review_invalidated_at FROM approval_requests WHERE id=$1`,[first.id]);
   expect(history.status).toBe("approved");expect(history.review_invalidated_at).not.toBeNull();
   ok(await f.process(draft.id,"review"));
   await f.assign(["procurement.invoices.read","procurement.invoices.approve"]);
   ok(await f.process(draft.id,"submit"));
   const next=await request();expect(next.id).not.toBe(first.id);ok(await approve(next.id));
   ok(await f.process(draft.id,"post"));
   const [journal]=await rows(`SELECT count(*) AS count FROM journal_entries WHERE company_id=$1 AND source_ref=$2`,
     [f.companies[0].id,`SINV-${draft.id}`]);
   expect(journal.count).toBe("1");
 });
 it("cancels a pending review without allowing a stale inbox decision to resurrect the document",async()=>{
   const f=await fixture();await f.assign(["procurement.invoices.read","procurement.invoices.approve"]);
   const [approver]=await rows(`SELECT id FROM users WHERE email=$1`,[personInput(f.people[0]).email]);
   ok(await f.owner.post("/api/workflow/approval-rules").send({name:randomUUID(),docType:"supplier_invoice",
     branchId:f.branches[0].id,steps:[{sequence:1,approverRole:"owner",approverUserId:approver.id}]}),201);
   const draft=ok(await f.create());ok(await f.process(draft.id,"review"));ok(await f.process(draft.id,"submit"));
   const [request]=await rows(`SELECT id FROM approval_requests WHERE record_id=$1 AND doc_type='supplier_invoice'`,[draft.id]);
   const detail=ok(await f.scoped("get",`/workflow/approval-requests/${request.id}`));
   ok(await f.process(draft.id,"cancel"));
   const denied=await f.scoped("post",`/workflow/approval-requests/${request.id}/act`).send({action:"approve",
     stepToken:detail.actionableSteps[0].stepToken,decisionId:randomUUID()});
   expect(denied.status).toBe(409);
   expect(ok(await f.owner.get(`/api/invoices/${draft.id}`)).status).toBe("cancelled");
 });
 it("allows service purchase-order billing without a fictitious goods receipt",async()=>{
   const f=await fixture();
   const po=ok(await f.owner.post("/api/procurement/purchase-orders").send({supplierId:f.supplier.id,
     warehouseId:f.warehouses[0].id,lines:[{description:"خدمة بعقد",quantity:10,unitPrice:10,taxRate:0}]}),201);
   await rows(`UPDATE purchase_orders SET status='confirmed' WHERE id=$1 RETURNING id`,[po.id]);
   const order=ok(await f.owner.get(`/api/procurement/purchase-orders/${po.id}`));
   await f.assign(invoiceActions,{amountLimit:"50"});
   const references=ok(await f.scoped("get","/invoices/draft-options"));
   const reference=references.orders.find((o:{id:number})=>o.id===po.id);
   expect(reference.referenceOnly).toBe(true);
   expect(reference.lines[0]).not.toHaveProperty("unitPrice");
   expect(reference.lines[0]).not.toHaveProperty("quantity");
   const draft=ok(await f.scoped("post","/invoices/drafts").set("Idempotency-Key",randomUUID()).send({
     ...f.body,poId:po.id,kind:"service",items:[{description:"خدمة جزئية",quantity:2,unitPrice:10,
       poLineId:order.lines[0].id,taxRate:0,unit:"piece"}]}));
   for(const action of ["review","submit","post"])
     ok(await f.scoped("post",`/invoices/${draft.id}/process`).set("Idempotency-Key",randomUUID()).send({action}));
   expect((await rows(`SELECT * FROM goods_receipts WHERE po_id=$1`,[po.id]))).toHaveLength(0);
   expect(Number((await rows(`SELECT billed_qty FROM purchase_order_lines WHERE po_id=$1`,[po.id]))[0].billed_qty)).toBe(2);
 });
 it("reads original stored lines and compares them without creation or scanning; never reconstructs historical lines",async()=>{
   const f=await fixture(),p=await purchase(f);ok(await p.receive(4),201);
   const invoice=ok(await f.create(p.body(3)));
   await f.assign(["procurement.invoices.read","procurement.invoices.compare"]);
   const evidence=ok(await f.scoped("get",`/invoices/${invoice.id}/evidence`));
   expect(evidence.lines).toHaveLength(1);expect(Number(evidence.lines[0].quantity)).toBe(3);
   expect((await f.scoped("get","/invoices/draft-options")).status).toBe(403);
   expect((await f.scoped("post","/invoices/drafts").set("Idempotency-Key",randomUUID()).send(f.body)).status).toBe(403);
   const preview=ok(await f.scoped("post","/invoices/match-preview").send({poId:p.po.id,invoiceId:invoice.id,
     items:[{poLineId:p.detail.lines[0].id,quantity:1,unitPrice:1}]}));
   expect(Number(preview.currentSubtotal)).toBe(30);
   const [historical]=await rows(`INSERT INTO invoices(company_id,supplier_id,po_id,invoice_number,supplier_name,amount)
     VALUES($1,$2,$3,$4,'مصدر قديم بلا بنود محفوظة',30) RETURNING id`,[f.companies[0].id,f.supplier.id,p.po.id,randomUUID()]);
   const unknown=ok(await f.scoped("get",`/invoices/${historical.id}/evidence`));
   expect(unknown.lines).toHaveLength(0);expect(unknown.historicalLimit).toBeTruthy();
 });
 it("rechecks the original reviewer's current authority at posting, not only the executor",async()=>{
   const f=await fixture(),invoice=ok(await f.create());
   await f.assign(["procurement.invoices.read","procurement.invoices.review"]);
   ok(await f.scoped("post",`/invoices/${invoice.id}/process`).set("Idempotency-Key",randomUUID()).send({action:"review"}));
   ok(await f.process(invoice.id,"submit"));
   await f.assign(["procurement.invoices.read"]);
   expect((await f.process(invoice.id,"post")).status).toBe(403);
   expect((await rows(`SELECT * FROM journal_entries WHERE company_id=$1 AND source_ref=$2`,
     [f.companies[0].id,`SINV-${invoice.id}`]))).toHaveLength(0);
   expect(Number((await rows(`SELECT balance FROM suppliers WHERE id=$1`,[f.supplier.id]))[0].balance)).toBe(0);
 });
 it("never rewrites a posted document when a draft edit waited behind its posting lock",async()=>{
   const f=await fixture(),invoice=ok(await f.create());
   ok(await f.process(invoice.id,"review"));ok(await f.process(invoice.id,"submit"));
   const other=await replica(f),blocker=await pool.connect();
   const waiting=async(n:number)=>{
     for(let i=0;i<200;i++){
       const [r]=await rows(`SELECT count(*) FROM pg_stat_activity WHERE datname=current_database()
         AND wait_event_type='Lock' AND query ILIKE '%invoices%FOR UPDATE%'`);
       if(Number(r.count)>=n)return;
       await new Promise(resolve=>setTimeout(resolve,20));
     }
     throw new Error("Expected invoice row-lock barrier was not reached");
   };
   try{
     await blocker.query("BEGIN");await blocker.query("SELECT id FROM invoices WHERE id=$1 FOR UPDATE",[invoice.id]);
     const posting=f.process(invoice.id,"post").then(r=>r);await waiting(1);
     const editing=other.patch(`/api/invoices/${invoice.id}/draft`).set("Idempotency-Key",randomUUID())
       .send({...f.body,notes:"تعديل ينتظر القفل"}).then(r=>r);await waiting(2);
     await blocker.query("COMMIT");
     const [posted,edited]=await Promise.all([posting,editing]);
     expect(posted.status).toBe(200);expect(edited.status).toBe(409);
   }finally{await blocker.query("ROLLBACK");blocker.release();}
   const saved=ok(await f.owner.get(`/api/invoices/${invoice.id}`));
   expect(saved.status).toBe("done");expect(saved.isLocked).toBe(true);
   expect(Number((await rows(`SELECT balance FROM suppliers WHERE id=$1`,[f.supplier.id]))[0].balance)).toBe(100);
 });
});
