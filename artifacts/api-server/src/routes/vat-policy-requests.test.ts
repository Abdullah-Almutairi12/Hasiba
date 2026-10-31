import {beforeAll,describe,it,expect} from "vitest";
import request from "supertest";
import {randomUUID} from "node:crypto";
import bcrypt from "bcryptjs";
import type {Request} from "express";
import {db,pool,companiesTable,usersTable,userCompaniesTable,customerInvoicesTable,customersTable} from "@workspace/db";
import app,{assertApplicationReady} from "../app";
import {taxPolicySchema,publishTaxPolicy,riyadhDate,calculatePolicySale,taxContext} from "../lib/vat-policy";
import {captureIssuer,saveIssuer} from "../lib/document-identity";
import {PrintProfilePatch} from "./print-profile";

// The publish HTTP route is deliberately gated until all issuer consumers
// are connected. Direct service calls exercise the real PostgreSQL/account-
// proof implementation here, not a mock or a claim about native UI acceptance.
const q=async(s:string,p:unknown[]=[]) => (await pool.query(s,p)).rows;
let ip=10;
beforeAll(assertApplicationReady);
async function fixture(){
  const tag=randomUUID(),password=`Synthetic-only-${randomUUID()}`;
  const [company]=await db.insert(companiesTable).values({name:`tax-${tag}`}).returning();
  const [u]=await db.insert(usersTable).values({name:"مصطنع",email:`tax-${tag}@example.invalid`,
    role:"owner",isActive:true,passwordHash:await bcrypt.hash(password,4)}).returning();
  await db.insert(userCompaniesTable).values({userId:u.id,companyId:company.id,role:"owner",isDefault:true});
  const a=request.agent(app).set("X-Forwarded-For",`198.51.100.${ip++}`);
  expect((await a.post("/api/auth/login").send({email:u.email,password})).status).toBe(200);
  await q(`INSERT INTO company_administrators(company_id,user_id,responsibilities)
    VALUES($1,$2,ARRAY['tax']) ON CONFLICT(company_id,user_id)
    DO UPDATE SET active=true,responsibilities=ARRAY['tax']`,[company.id,u.id]);
  const [s]=await q(`SELECT sess FROM "session" WHERE sess->>'userId'=$1 ORDER BY expire DESC LIMIT 1`,[String(u.id)]);
  const req={session:{...s.sess,save:(cb:()=>void)=>cb()},headers:{},ip:"198.51.100.240",
    get:()=>undefined} as unknown as Request;
  const input=taxPolicySchema.parse({requestId:randomUUID(),revision:0,
    effectiveFrom:riyadhDate(),status:"not_registered",vatNumber:null,priceIncludesVat:false,
    productRules:[],serviceRule:{category:"standard"},reason:"مراجعة اصطناعية صريحة لنطاق الاختبار",
    proof:{currentPassword:password}});
  const {proof,...facts}=input;
  const path=`/api/vat/policy/requests/${input.requestId}`;
  return {a,company,u,password,req,input,facts,proof,path};
}
async function waitForCompanyBarrier(pid:number){
  for(let n=0;n<100;n++){
    const r=await q(`SELECT pid FROM pg_stat_activity
      WHERE $1=ANY(pg_blocking_pids(pid)) AND query ILIKE '%companies%'`,[pid]);
    if(r.length)return;
    await new Promise(r=>setTimeout(r,20));
  }
  throw new Error("No PostgreSQL company-row barrier was observed");
}
describe("guarded company tax request lifecycle on isolated PostgreSQL",()=>{
  it("blocks the general company VAT writer after dated adoption, including a future policy",async()=>{
    const f=await fixture();
    await q("UPDATE company_administrators SET responsibilities=ARRAY['tax','settings','administrators'] WHERE company_id=$1",[f.company.id]);
    await publishTaxPolicy(f.req,{...f.input,effectiveFrom:"2099-01-01"});
    const before=await q("SELECT vat_number FROM companies WHERE id=$1",[f.company.id]);
    const result=await f.a.patch(`/api/admin/companies/${f.company.id}`).send({vatNumber:"300000000000003"});
    expect(result.status,JSON.stringify(result.body)).toBe(409);
    expect(await q("SELECT vat_number FROM companies WHERE id=$1",[f.company.id])).toEqual(before);
  });
  it("the workspace portal reads the effective policy, not the legacy registration flag",async()=>{
    const f=await fixture();
    await publishTaxPolicy(f.req,{...f.input,status:"registered",vatNumber:"300000000000003"});
    expect((await f.a.get("/api/workspace/access")).body.vatRegistered).toBe(true);
    expect((await f.a.get("/api/vat/status")).body.vatNumber).toBe("300000000000003");
    expect((await f.a.get("/api/print/profile")).body.profile.vatNumber).toBe("300000000000003");
  });
  it("company administration reads effective identity without rewriting legacy storage",async()=>{
    const f=await fixture();
    await q("UPDATE company_administrators SET responsibilities=ARRAY['tax','settings','administrators'] WHERE company_id=$1",[f.company.id]);
    await publishTaxPolicy(f.req,{...f.input,status:"registered",vatNumber:"300000000000003"});
    const listed=await f.a.get("/api/admin/companies");
    expect(listed.status).toBe(200);
    expect(listed.body.find((c:{id:number})=>c.id===f.company.id).vatNumber).toBe("300000000000003");
    expect((await q("SELECT vat_number FROM companies WHERE id=$1",[f.company.id]))[0].vat_number).toBeNull();
  });
  it("rejects legacy tax preferences after adoption without blocking unrelated preferences",async()=>{
    const f=await fixture();
    await q("UPDATE company_administrators SET responsibilities=ARRAY['tax','settings','administrators'] WHERE company_id=$1",[f.company.id]);
    await publishTaxPolicy(f.req,f.input);
    const settings=await f.a.get("/api/settings");
    const result=await f.a.patch("/api/settings").send({
      expectedCompanyId:f.company.id,expectedRevision:settings.body.scope.revision,
      tax:{vatNumber:"300000000000003",vatEnabled:true}});
    expect(result.status,JSON.stringify(result.body)).toBe(409);
    expect((await f.a.patch("/api/settings").send({
      expectedCompanyId:f.company.id,expectedRevision:settings.body.scope.revision,
      appearance:{theme:"dark"}})).status).toBe(200);
  });
  it("keeps two legal companies and multiple branch views separate across current and future identity",async()=>{
    const a=await fixture(),b=await fixture();
    for(const f of [a,b])await q("UPDATE company_administrators SET responsibilities=ARRAY['tax','settings','administrators'] WHERE company_id=$1",[f.company.id]);
    const branches=await q(`INSERT INTO branches(company_id,name,name_ar,city)
      VALUES($1,'A1','أ١','الرياض'),($1,'A2','أ٢','جدة'),($2,'B1','ب١','الدمام') RETURNING id,company_id`,[a.company.id,b.company.id]);
    await publishTaxPolicy(a.req,{...a.input,status:"registered",vatNumber:"300000000000003"});
    await publishTaxPolicy(a.req,{...a.input,requestId:randomUUID(),revision:1,effectiveFrom:"2099-01-01"});
    await publishTaxPolicy(b.req,b.input);
    for(const branch of branches.filter(v=>v.company_id===a.company.id)){
      const settings=await a.a.get(`/api/settings?branchId=${branch.id}`);
      expect(settings.status).toBe(200);
      expect(settings.body.tax.legalIdentity).toMatchObject({
        companyId:a.company.id,status:"registered",vatNumber:"300000000000003",revision:1});
      const rejected=await a.a.patch(`/api/settings?branchId=${branch.id}`).send({
        expectedCompanyId:a.company.id,expectedRevision:settings.body.scope.revision,
        expectedParentRevision:settings.body.scope.parentRevision,company:{vat_number:"300000000000013"}});
      expect(rejected.status).toBe(409);
    }
    expect((await a.a.get(`/api/settings?branchId=${branches.find(v=>v.company_id===b.company.id)!.id}`)).status).toBe(404);
    expect((await b.a.get("/api/workspace/access")).body.vatRegistered).toBe(false);
    expect((await b.a.get("/api/print/profile")).body.profile.vatNumber).toBe("");
    expect(await taxContext(a.company.id,"2099-01-01")).toMatchObject({registered:false,vatNumber:null,revision:2});
    const current=await a.a.get("/api/vat/status");
    expect(current.body).toMatchObject({status:"registered",policyRevision:1,policyEffectiveFrom:riyadhDate()});
    expect(current.body.vatRegistrationDate).toBe(`${riyadhDate()}T00:00:00+03:00`);
  });
  it("preserves unmigrated legacy editing and refuses publication through the live gate",async()=>{
    const f=await fixture();
    await q("UPDATE company_administrators SET responsibilities=ARRAY['tax','settings','administrators'] WHERE company_id=$1",[f.company.id]);
    expect((await f.a.patch(`/api/admin/companies/${f.company.id}`).send({vatNumber:"300000000000003"})).status).toBe(200);
    expect((await f.a.patch("/api/vat/registration").send({status:"registered",vatNumber:"300000000000003"})).status).toBe(200);
    expect((await f.a.get("/api/workspace/access")).body.vatRegistered).toBe(true);
    const blocked=await f.a.put("/api/vat/policy").send(f.input);
    expect(blocked.status).toBe(503);expect(blocked.body.code).toBe("TAX_POLICY_NOT_READY");
    expect(await q("SELECT id FROM company_tax_policy_versions WHERE company_id=$1",[f.company.id])).toEqual([]);
  });
  it("adoption changes no stock, ledger, document snapshot or financial request evidence",async()=>{
    const f=await fixture();
    const [customer]=await db.insert(customersTable).values({companyId:f.company.id,name:"عميل تاريخي مصطنع"}).returning();
    const [invoice]=await db.insert(customerInvoicesTable).values({
      companyId:f.company.id,customerId:customer.id,customerName:customer.name,reference:`HIST-${randomUUID()}`,
      status:"open",subtotal:"100",total:"100",amountPaid:"0",invoiceDate:riyadhDate(),createdBy:f.u.id}).returning();
    await db.transaction(async tx=>saveIssuer(tx,"invoice",invoice.id,await captureIssuer(tx,f.company.id)));
    const snapshot=async()=>{
      const data:Record<string,unknown>={};
      for(const table of ["stock_quants","stock_layers","stock_moves","journal_entries","journal_entry_lines",
        "document_issuer_snapshots","customer_invoices","financial_requests"])
        data[table]=await q(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`);
      return data;
    };
    const before=await snapshot();
    await publishTaxPolicy(f.req,{...f.input,status:"registered",vatNumber:"300000000000003"});
    await publishTaxPolicy(f.req,{...f.input,requestId:randomUUID(),revision:1,effectiveFrom:"2099-01-01"});
    expect(await snapshot()).toEqual(before);
    expect((await q("SELECT count(*)::int AS n FROM audit_logs WHERE company_id=$1 AND action='vat.policy.published'",[f.company.id]))[0].n).toBe(2);
  });
  it("rechecks legacy company tax writes after waiting behind policy adoption",async()=>{
    const f=await fixture();
    await q("UPDATE company_administrators SET responsibilities=ARRAY['tax','settings','administrators'] WHERE company_id=$1",[f.company.id]);
    const blocker=await pool.connect();
    try{
      await blocker.query("BEGIN");
      await blocker.query("SELECT id FROM companies WHERE id=$1 FOR UPDATE",[f.company.id]);
      // Establish adoption under the same company fence, then release a legacy
      // writer that entered before the new version was visible.
      const delayed=f.a.patch(`/api/admin/companies/${f.company.id}`)
        .send({vatNumber:"300000000000013"}).then(r=>r);
      const {rows:[{pid}]}=await blocker.query<{pid:number}>("SELECT pg_backend_pid() AS pid");
      await waitForCompanyBarrier(pid);
      await blocker.query(`INSERT INTO company_tax_policy_versions(company_id,revision,request_id,request_hash,
        effective_from,status,vat_number,price_includes_vat,product_rules,service_rule,legacy_state,reason,created_by)
        VALUES($1,1,$2,'isolated-adoption-race','2099-01-01','not_registered',NULL,false,'[]','{"category":"standard"}','{}',
        'Explicit synthetic concurrent adoption',$3)`,[f.company.id,randomUUID(),f.u.id]);
      await blocker.query("COMMIT");
      expect((await delayed).status).toBe(409);
      expect((await q("SELECT vat_number FROM companies WHERE id=$1",[f.company.id]))[0].vat_number).toBeNull();
    }finally{await blocker.query("ROLLBACK");blocker.release();}
  });
  it("keeps new company status unresolved, with no implicit tax administration",async()=>{
    const f=await fixture();
    expect(f.company.vatRegistrationStatus).toBe("unresolved");
    await q("DELETE FROM company_administrators WHERE company_id=$1",[f.company.id]);
    const policy=await f.a.get("/api/vat/policy");
    expect(policy.status).toBe(200);expect(policy.body.canManage).toBe(false);
    // Existing settings+administrators governance may inspect its own attempt,
    // but is not implicitly commissioned to publish tax facts.
    expect((await f.a.get(f.path)).body.status).toBe("pending");
    await expect(publishTaxPolicy(f.req,f.input)).rejects.toMatchObject({status:403});
    // Missing registration blocks a new sale, not historical/non-tax reading.
    await expect(calculatePolicySale(db,f.company.id,riyadhDate(),[
      {description:"خدمة مصطنعة",quantity:1,unitPrice:100},
    ],0)).rejects.toMatchObject({status:422});
    expect((await captureIssuer(db,f.company.id)).taxContext?.status).toBe("unresolved");
  });
  it("requires explicit first-adoption consent, both governance rights and fresh identity proof",async()=>{
    const f=await fixture();
    await q("UPDATE company_administrators SET responsibilities=ARRAY['settings','administrators'] WHERE company_id=$1",[f.company.id]);
    await expect(publishTaxPolicy(f.req,f.input)).rejects.toMatchObject({status:403});
    const adopting=taxPolicySchema.parse({...f.input,adoptTaxAdministration:true});
    await expect(publishTaxPolicy(f.req,{...adopting,proof:{currentPassword:"wrong"}}))
      .rejects.toMatchObject({status:401});
    expect((await q("SELECT * FROM company_tax_policy_versions WHERE company_id=$1",[f.company.id])).length).toBe(0);
    expect((await q("SELECT 'tax'=ANY(responsibilities) AS granted FROM company_administrators WHERE company_id=$1",[f.company.id]))[0].granted).toBe(false);
    expect((await publishTaxPolicy(f.req,adopting)).revision).toBe(1);
    expect((await publishTaxPolicy(f.req,adopting)).replayed).toBe(true);
    expect((await q("SELECT 'tax'=ANY(responsibilities) AS granted FROM company_administrators WHERE company_id=$1",[f.company.id]))[0].granted).toBe(true);
    expect((await q("SELECT * FROM audit_logs WHERE company_id=$1 AND action='vat.authority.explicit_adoption'",[f.company.id])).length).toBe(1);
    await q("UPDATE company_administrators SET responsibilities=ARRAY['settings','administrators'] WHERE company_id=$1",[f.company.id]);
    await expect(publishTaxPolicy(f.req,adopting)).rejects.toMatchObject({status:403});
    expect((await q("SELECT 'tax'=ANY(responsibilities) AS granted FROM company_administrators WHERE company_id=$1",[f.company.id]))[0].granted).toBe(false);
  });
  it("never bootstraps tax authority from settings alone or an administrator title alone",async()=>{
    const f=await fixture(),input=taxPolicySchema.parse({...f.input,adoptTaxAdministration:true});
    for(const rights of [["settings"],["administrators"],[]]){
      await q("UPDATE company_administrators SET responsibilities=$2::text[] WHERE company_id=$1",[f.company.id,rights]);
      await expect(publishTaxPolicy(f.req,input)).rejects.toMatchObject({status:403});
    }
    expect((await q("SELECT * FROM company_tax_policy_versions WHERE company_id=$1",[f.company.id])).length).toBe(0);
  });
  it.each(["registration","print"])("prevents the legacy %s writer from changing adopted legal tax facts",async(writer)=>{
    const f=await fixture();
    await q("UPDATE company_administrators SET responsibilities=ARRAY['tax','settings','administrators'] WHERE company_id=$1",[f.company.id]);
    await publishTaxPolicy(f.req,f.input);
    const before=await q("SELECT vat_registration_status,vat_number FROM companies WHERE id=$1",[f.company.id]);
    let result:request.Response;
    if(writer==="registration"){
      result=await f.a.patch("/api/vat/registration")
        .send({status:"registered",vatNumber:"300000000000003"});
    }else{
      const p=await f.a.get("/api/print/profile");
      expect(p.status,JSON.stringify(p.body)).toBe(200);
      const profile=p.body.profile;
      const body=Object.fromEntries(Object.keys(PrintProfilePatch.shape).map(k=>
        [k,k==="address"?profile.addressFields:profile[k]]));
      result=await f.a.patch("/api/print/profile").send({...body,vatNumber:"300000000000003"});
    }
    expect(result.status,JSON.stringify(result.body)).toBe(409);
    expect(await q("SELECT vat_registration_status,vat_number FROM companies WHERE id=$1",[f.company.id])).toEqual(before);
    expect((await q("SELECT * FROM company_tax_policy_versions WHERE company_id=$1",[f.company.id])).length).toBe(1);
  });
  it("closes an unexecuted request with proof and rejects its late original body",async()=>{
    const f=await fixture();
    expect((await f.a.get(f.path)).body.status).toBe("pending");
    expect((await f.a.post(`${f.path}/close`).send({facts:f.facts,proof:{currentPassword:"wrong"}})).status).toBe(401);
    const r=await f.a.post(`${f.path}/close`).send({facts:f.facts,proof:f.proof});
    expect(r.status,JSON.stringify(r.body)).toBe(200);expect(r.body.status).toBe("closed");
    expect((await f.a.post(`${f.path}/close`).send({facts:f.facts,proof:f.proof})).body.status).toBe("closed");
    await expect(publishTaxPolicy(f.req,f.input)).rejects.toMatchObject({status:409});
    expect((await q("SELECT * FROM company_tax_policy_versions WHERE company_id=$1",[f.company.id])).length).toBe(0);
    expect((await q(`SELECT * FROM audit_logs WHERE company_id=$1 AND action='vat.policy.intent_closed'`,[f.company.id])).length).toBe(1);
  });
  it("restores a committed result and never labels it closed after a lost reply",async()=>{
    const f=await fixture(),saved=await publishTaxPolicy(f.req,f.input);
    expect(saved.revision).toBe(1);
    expect((await f.a.get(f.path)).body).toMatchObject({status:"saved",revision:1});
    const closed=await f.a.post(`${f.path}/close`).send({facts:f.facts,proof:f.proof});
    expect(closed.status,JSON.stringify(closed.body)).toBe(200);expect(closed.body.status).toBe("saved");
    expect((await publishTaxPolicy(f.req,f.input)).replayed).toBe(true);
    expect((await q("SELECT * FROM company_tax_policy_versions WHERE company_id=$1",[f.company.id])).length).toBe(1);
    expect((await q("SELECT * FROM company_tax_policy_request_closures WHERE company_id=$1",[f.company.id])).length).toBe(0);
  });
  it.each(["close","publish"])("linearizes %s first under a real PostgreSQL company-row barrier",async(first)=>{
    const f=await fixture(),blocker=await pool.connect();
    try{
      await blocker.query("BEGIN");
      await blocker.query("SELECT id FROM companies WHERE id=$1 FOR UPDATE",[f.company.id]);
      const close=()=>f.a.post(`${f.path}/close`).send({facts:f.facts,proof:f.proof}).then(r=>{
        expect(r.status,JSON.stringify(r.body)).toBe(200);return r.body;
      });
      const publish=()=>publishTaxPolicy(f.req,f.input).catch((e:unknown)=>e);
      const one=first==="close"?close():publish();
      const {rows:[{pid}]}=await blocker.query<{pid:number}>("SELECT pg_backend_pid() AS pid");
      await waitForCompanyBarrier(pid);
      const two=first==="close"?publish():close();
      await blocker.query("COMMIT");
      await Promise.all([one,two]);
      const versions=await q("SELECT * FROM company_tax_policy_versions WHERE company_id=$1",[f.company.id]);
      const closures=await q("SELECT * FROM company_tax_policy_request_closures WHERE company_id=$1",[f.company.id]);
      expect(versions.length).toBe(first==="publish"?1:0);
      expect(closures.length).toBe(first==="close"?1:0);
    }finally{await blocker.query("ROLLBACK");blocker.release();}
  });
  it("never treats a revoked read as evidence of non-execution",async()=>{
    const f=await fixture();await publishTaxPolicy(f.req,f.input);
    await q("UPDATE company_administrators SET active=false WHERE company_id=$1",[f.company.id]);
    expect((await f.a.get(f.path)).status).toBe(403);
    expect((await f.a.post(`${f.path}/close`).send({facts:f.facts,proof:f.proof})).status).toBe(403);
    expect((await q("SELECT * FROM company_tax_policy_versions WHERE company_id=$1",[f.company.id])).length).toBe(1);
    expect((await q("SELECT * FROM company_tax_policy_request_closures WHERE company_id=$1",[f.company.id])).length).toBe(0);
  });
  it("isolates equal request IDs across companies without disclosing another company's saved result",async()=>{
    const a=await fixture(),b=await fixture();
    await publishTaxPolicy(a.req,a.input);
    const r=await b.a.get(`/api/vat/policy/requests/${a.input.requestId}`);
    expect(r.status).toBe(200);expect(r.body).toEqual({status:"pending",revision:null});
    const close=await b.a.post(`/api/vat/policy/requests/${a.input.requestId}/close`)
      .send({facts:a.facts,proof:b.proof});
    expect(close.status,JSON.stringify(close.body)).toBe(200);expect(close.body.status).toBe("closed");
    expect((await a.a.get(a.path)).body).toMatchObject({status:"saved",revision:1});
    expect((await q("SELECT * FROM company_tax_policy_versions WHERE company_id=$1",[a.company.id])).length).toBe(1);
    expect((await q("SELECT * FROM company_tax_policy_request_closures WHERE company_id=$1",[a.company.id])).length).toBe(0);
  });
  it("rechecks live authority after waiting for the company writer lock",async()=>{
    const f=await fixture(),blocker=await pool.connect();
    try{
      await blocker.query("BEGIN");
      await blocker.query("SELECT id FROM companies WHERE id=$1 FOR UPDATE",[f.company.id]);
      const pending=publishTaxPolicy(f.req,f.input).catch((e:unknown)=>e);
      const {rows:[{pid}]}=await blocker.query<{pid:number}>("SELECT pg_backend_pid() AS pid");
      await waitForCompanyBarrier(pid);
      // A fixture-only direct update models a legacy writer not taking the
      // account-authority fence. The implementation must still recheck here.
      await q("UPDATE company_administrators SET active=false WHERE company_id=$1",[f.company.id]);
      await blocker.query("COMMIT");
      expect(await pending).toMatchObject({status:403});
      expect((await q("SELECT * FROM company_tax_policy_versions WHERE company_id=$1",[f.company.id])).length).toBe(0);
      expect((await q("SELECT * FROM company_tax_policy_request_closures WHERE company_id=$1",[f.company.id])).length).toBe(0);
    }finally{await blocker.query("ROLLBACK");blocker.release();}
  });
});
