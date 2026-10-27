import {describe,it,expect} from "vitest";
import {randomUUID,createHash} from "node:crypto";
import {posTemplateFixture,accepted as ok,personInput,fixtureRows as rows,testActor} from "../test/pos-template-fixture";
import {customerInvoiceAction} from "../lib/customer-invoice-access";
const base=["sales.read"],print="sales.invoices.print",exp="sales.invoices.export";
async function fixture(){
  const f=await posTemplateFixture(),people:any[]=[],actors=[...f.actors];
  const combinations=[base,[...base,print],[...base,exp],[...base,print,exp]];
  const templates:any[]=[];
  for(let i=0;i<4;i++){
    const t=ok(await f.owner.post("/api/team/templates").send({name:`صلاحيات فاتورة ${i}`,resource:"sales",actions:combinations[i]}),201);
    templates.push(t);
    const grant={resource:"sales",branchId:f.branches[0].id,warehouseIds:[],actions:combinations[i],
      amountLimit:"500",startsAt:null,endsAt:null,templateId:t.id,templateRevision:1,templateMode:"inherit"};
    if(i<3){
      people.push(ok(await f.owner.put(`/api/team/people/${f.people[i].personId}/access`).send({
        expectedRevision:f.people[i].revision,suspended:false,person:{...personInput(f.people[i]),loginKinds:["platform"],deniedActions:[],grants:[grant]}})));
    }else{
      let p=ok(await f.owner.post("/api/team/people").send({creationKey:randomUUID(),name:"قارئ وطابع ومصدر",
        email:`sales-doc-${randomUUID()}@example.invalid`,loginKinds:["platform"],deniedActions:[],grants:[grant]}),201);
      const invite=ok(await f.owner.post(`/api/team/people/${p.personId}/invite`).send({expectedRevision:p.revision}),201);
      ok(await testActor().post("/api/auth/team-activation/accept").send({token:invite.activationToken,password:f.password}));
      p=ok(await f.owner.get("/api/team/people")).find((v:any)=>v.personId===p.personId);
      const actor=testActor();ok(await actor.post("/api/auth/login").send({email:p.email,password:f.password}));
      people.push(p);actors.push(actor);
    }
  }
  const customer=ok(await f.owner.post("/api/customers").send({name:"عميل فحص فصل أذونات الفاتورة"}),201);
  const create=async(branchId=f.branches[0].id)=>ok(await f.owner.post("/api/sales/invoices").set("Idempotency-Key",randomUUID())
    .send({customerId:customer.id,branchId,lines:[{description:"سلام ABC فحص صلاحيات",quantity:2,unitPrice:100,taxRate:0}]}),201);
  const invoice=await create(),otherBranch=await create(f.branches[1].id);
  ok(await f.owner.post("/api/auth/switch-company").send({companyId:f.companies[1].id}));
  const foreignCustomer=ok(await f.owner.post("/api/customers").send({name:"عميل الشركة المعزولة الثانية"}),201);
  const foreignInvoice=ok(await f.owner.post("/api/sales/invoices").set("Idempotency-Key",randomUUID()).send({
    customerId:foreignCustomer.id,branchId:f.branches[2].id,lines:[{description:"مستند شركة أخرى",quantity:1,unitPrice:40,taxRate:0}]}),201);
  ok(await f.owner.post("/api/auth/switch-company").send({companyId:f.companies[0].id}));
  const selected=(i:number,path:string)=>actors[i].get(`/api${path}`).set("X-Workspace-Responsibility",String(people[i].grants[0].id));
  const update=async(i:number,patch:any)=>{
    people[i]=ok(await f.owner.put(`/api/team/people/${people[i].personId}/access`).send({
      expectedRevision:people[i].revision,suspended:false,person:{...personInput(people[i]),...patch}}));return people[i];
  };
  return {...f,people,actors,templates,invoice,otherBranch,foreignInvoice,selected,update,combinations};
}
async function snapshot(){
  const result:any={};
  for(const table of ["customer_invoices","customer_invoice_lines","stock_moves","stock_quants","stock_layers","journal_entries","journal_entry_lines","financial_requests","document_issuer_snapshots"]){
    const data=(await rows(`SELECT row_to_json(t)::text AS data FROM ${table} t ORDER BY row_to_json(t)::text`)).map(v=>v.data);
    result[table]={count:data.length,hash:createHash("sha256").update(JSON.stringify(data)).digest("hex")};
  }
  return result;
}
describe("customer invoice native read/print/PDF-export permissions",()=>{
  it("does not confuse checking a credit note's source invoice with printing that invoice",()=>{
    expect(customerInvoiceAction("GET","/sales/invoices/1")).toBe("sales.read");
    expect(customerInvoiceAction("GET","/sales/invoices/1/pdf")).toBe(print);
    expect(customerInvoiceAction("GET","/sales/invoices/1/pdf","1")).toBe(exp);
    expect(customerInvoiceAction("GET","/sales/credit-notes/1/pdf")).toBeNull();
    expect(customerInvoiceAction("POST","/sales/invoices")).toBeNull();
  });
  it("separates all four combinations using existing templates, without changing any financial document",async()=>{
    const f=await fixture(),before=await snapshot();
    for(let i=0;i<4;i++){
      const list=ok(await f.selected(i,"/sales/invoices?limit=1"));
      expect(list.map((x:any)=>x.id)).toEqual([f.invoice.id]);
      ok(await f.selected(i,`/sales/invoices/${f.invoice.id}`));
      const pr=await f.selected(i,`/sales/invoices/${f.invoice.id}/pdf`);
      ok(pr,f.combinations[i].includes(print)?200:403);
      const ex=await f.selected(i,`/sales/invoices/${f.invoice.id}/pdf?download=1`);
      ok(ex,f.combinations[i].includes(exp)?200:403);
      if(pr.status===200)expect(pr.body.subarray(0,5).toString()).toBe("%PDF-");
      if(ex.status===200)expect(ex.body.subarray(0,5).toString()).toBe("%PDF-");
      for(const suffix of ["","/pdf","/pdf?download=1"])
        expect([403,404]).toContain((await f.selected(i,`/sales/invoices/${f.otherBranch.id}${suffix}`)).status);
      for(const suffix of ["","/pdf","/pdf?download=1"])
        expect([403,404]).toContain((await f.selected(i,`/sales/invoices/${f.foreignInvoice.id}${suffix}`)).status);
      for(const path of ["/pos/orders","/workspace/inventory","/sales/orders","/sales/receipts","/sales/invoices/email-failure-count"])
        ok(await f.selected(i,path),403);
    }
    expect(await snapshot()).toEqual(before);
    // Legacy owner keeps established access; no entitlement/grant backfill.
    ok(await f.owner.get(`/api/sales/invoices/${f.invoice.id}/pdf`));
    ok(await f.owner.get(`/api/sales/invoices/${f.invoice.id}/pdf?download=1`));
  },90000);
  it("rechecks individual denials, base read, validity and amount scope in already open sessions",async()=>{
    const f=await fixture(),id=f.invoice.id;
    await f.update(1,{grants:[{...personInput(f.people[1]).grants[0],templateId:f.templates[0].id,templateMode:"inherit",actions:base}]});
    await f.update(0,{grants:[{...personInput(f.people[0]).grants[0],templateMode:"override",actions:[...base,print]}]});
    ok(await f.selected(0,`/sales/invoices/${id}/pdf`));
    ok(await f.selected(1,`/sales/invoices/${id}/pdf`),403);
    ok(await f.selected(1,`/sales/invoices/${id}`));
    await f.update(3,{deniedActions:[exp]});
    ok(await f.selected(3,`/sales/invoices/${id}/pdf`));
    ok(await f.selected(3,`/sales/invoices/${id}/pdf?download=1`),403);
    await f.update(3,{deniedActions:[print]});
    ok(await f.selected(3,`/sales/invoices/${id}/pdf`),403);
    ok(await f.selected(3,`/sales/invoices/${id}/pdf?download=1`));
    await f.update(3,{deniedActions:["sales.read"]});
    for(const path of ["/sales/invoices",`/sales/invoices/${id}`,`/sales/invoices/${id}/pdf?download=1`])
      ok(await f.selected(3,path),403);
    const p=f.people[2];
    await f.update(2,{grants:[{...personInput(p).grants[0],templateMode:"override",amountLimit:"199"}]});
    expect(ok(await f.selected(2,"/sales/invoices"))).toEqual([]);
    ok(await f.selected(2,`/sales/invoices/${id}`),404);
    await rows("UPDATE responsibility_grants SET ends_at=clock_timestamp()-interval '1 second' WHERE id=$1",[f.people[1].grants[0].id]);
    ok(await f.selected(1,`/sales/invoices/${id}`),403);
    // Same identity switches to its independently scoped second tenant:
    ok(await f.actors[0].post("/api/auth/switch-company").send({companyId:f.companies[1].id}));
    ok(await f.selected(0,`/sales/invoices/${id}`),403);
  },90000);
  it("withdraws template actions in an open session using the existing preview/apply cycle",async()=>{
    const f=await fixture(),edit={expectedRevision:1,name:"عرض وتصدير بعد سحب الطباعة",actions:[...base,exp]};
    const preview=ok(await f.owner.post(`/api/team/templates/${f.templates[3].id}/preview`).send(edit));
    ok(await f.owner.put(`/api/team/templates/${f.templates[3].id}`).send({...edit,digest:preview.digest}));
    const live=ok(await f.owner.get("/api/team/people")).find((p:any)=>p.personId===f.people[3].personId);
    f.people[3]=live;
    ok(await f.selected(3,`/sales/invoices/${f.invoice.id}`));
    ok(await f.selected(3,`/sales/invoices/${f.invoice.id}/pdf`),403);
    ok(await f.selected(3,`/sales/invoices/${f.invoice.id}/pdf?download=1`));
  },90000);
});
