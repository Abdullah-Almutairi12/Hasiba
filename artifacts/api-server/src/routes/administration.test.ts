import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { db, pool, companiesTable, usersTable, userCompaniesTable, branchesTable, warehousesTable, categoriesTable, productsTable } from "@workspace/db";
import app,{assertApplicationReady} from "../app";
import { LEGACY_ADMIN_RESPONSIBILITIES } from "../lib/administration-authority";
import { ensureAdministrativePerson } from "../lib/administration-enrollment";
const password="Isolated administration phrase 2026!";
// Preserve the pre-tax-administration lifecycle fixture. New tax authority is
// explicit and separately exercised by the policy tests, never inferred here.
const all=[...LEGACY_ADMIN_RESPONSIBILITIES];
let clientNumber=0;
const agent=()=>request.agent(app).set("X-Forwarded-For",`198.51.100.${++clientNumber}`);
const ok=(r:request.Response,status=200)=>{expect(r.status,JSON.stringify(r.body)).toBe(status);return r.body;};
const query=async(q:string,p:unknown[]=[]) => (await pool.query(q,p)).rows;
beforeAll(async()=>{await assertApplicationReady();});
async function fixture(){
  const tag=randomUUID();
  const cs=await db.insert(companiesTable).values([{name:`admin-${tag}`},{name:`other-${tag}`}]).returning();
  const hash=await bcrypt.hash(password,4);
  const users=await db.insert(usersTable).values(["sender","target","third"].map(name=>({
    name,email:`${name}-${tag}@example.invalid`,passwordHash:hash,role:"scoped",isActive:true}))).returning();
  await db.insert(userCompaniesTable).values(users.flatMap((u,i)=>[
    {userId:u.id,companyId:cs[0].id,role:i===0?"owner":"scoped",isDefault:true},
    ...(i===0?[{userId:u.id,companyId:cs[1].id,role:"manager",isDefault:false}]:[])]));
  const agents=users.map(()=>agent());
  for(let i=0;i<users.length;i++)ok(await agents[i].post("/api/auth/login").send({email:users[i].email,password}));
  const other=agent();
  ok(await other.post("/api/auth/login").send({email:users[0].email,password}));
  ok(await other.post("/api/auth/switch-company").send({companyId:cs[1].id}));
  return {company:cs[0].id,otherCompany:cs[1].id,users,sender:agents[0],target:agents[1],third:agents[2],other};
}
function input(target:number,departure="stay"){return {id:randomUUID(),expectedRevision:0,toUserId:target,personId:null,responsibilities:all,departure};}
async function propose(f:Awaited<ReturnType<typeof fixture>>,departure="stay"){
  const body=input(f.users[1].id,departure);
  ok(await f.sender.put("/api/administration/handovers").send(body));
  return body;
}
async function accept(f:Awaited<ReturnType<typeof fixture>>,id:string,revision=1){
  return ok(await f.target.post(`/api/administration/handovers/${id}/accept`).send({expectedRevision:revision}));
}
const complete=(a:request.Agent,id:string,revision=1)=>a.post(`/api/auth/administration/handovers/${id}/complete`).send({expectedRevision:revision});
async function appoint(f:Awaited<ReturnType<typeof fixture>>) {
  return ok(await f.sender.post("/api/administration/owner/appoint").send({acknowledge:true}));
}
describe("explicit primary system owner, independent manager lifecycle and identity-only recovery",()=>{
  it.each(["none","single","multiple","scoped"])("receipt recovery never becomes an operational session: %s memberships, first request products",async kind=>{
    const f=await fixture();
    const actor=kind==="scoped"?f.users[1]:f.users[0];
    if(kind==="none")await query("DELETE FROM user_companies WHERE user_id=$1",[actor.id]);
    if(kind==="single")await query("DELETE FROM user_companies WHERE user_id=$1 AND company_id<>$2",[actor.id,f.company]);
    const [category]=await db.insert(categoriesTable).values({name:randomUUID(),nameAr:"تصنيف معزول"}).returning();
    await db.insert(productsTable).values({companyId:f.company,name:"Synthetic recovery product",nameAr:"منتج اختبار الاسترداد",
      sku:randomUUID(),categoryId:category.id,price:"100",costPrice:"67.89"});
    if(kind==="scoped"){
      await db.transaction(tx=>ensureAdministrativePerson(tx,f.company,actor.id));
      const [branch]=await db.insert(branchesTable).values({companyId:f.company,name:"نطاق بلا تكلفة",nameAr:"نطاق بلا تكلفة",city:"الرياض"}).returning();
      const [wh]=await db.insert(warehousesTable).values({companyId:f.company,branchId:branch.id,name:"نطاق بلا تكلفة",nameAr:"نطاق بلا تكلفة"}).returning();
      const [profile]=await query("SELECT employee_id FROM employee_access WHERE company_id=$1 AND user_id=$2",[f.company,actor.id]);
      const [grant]=await query(`INSERT INTO responsibility_grants(company_id,employee_id,resource,branch_id,warehouse_ids,actions,created_by)
        VALUES($1,$2,'inventory',$3,$4,ARRAY['inventory.read'],$5) RETURNING id`,
        [f.company,profile.employee_id,branch.id,[wh.id],f.users[0].id]);
      // A real legacy operational session missing its context must resolve it
      // BEFORE the gate, not fall through to products' unredacted legacy handler.
      await query(`UPDATE "session" SET sess=(sess::jsonb-'companyId'-'role')::json WHERE sess->>'userId'=$1`,[String(actor.id)]);
      const normal=ok(await f.target.get("/api/products").set("X-Workspace-Responsibility",String(grant.id)));
      expect(normal.length).toBe(1);expect(normal[0]).not.toHaveProperty("costPrice");
    }
    const recovery=agent();
    ok(await recovery.post("/api/auth/administration/recover").send({email:actor.email,password}));
    // No /me or other warm-up: the first request used to bypass managedAccessGate.
    const products=await recovery.get("/api/products");
    expect(products.status,JSON.stringify(products.body)).toBe(403);
    for(const path of ["/api/auth/me","/api/users","/api/companies","/api/app-settings","/api/storage/objects","/api/team/setup","/api/accounting/journal-entries"])
      expect((await recovery.get(path)).status,path).toBe(403);
    expect((await recovery.post("/api/auth/switch-company").send({companyId:f.company})).status).toBe(403);
  });
  it("recovery may replay a committed result but cannot execute an accepted, unfinished handover",async()=>{
    const f=await fixture(),h=await propose(f,"retain");await accept(f,h.id);
    const recovery=agent();ok(await recovery.post("/api/auth/administration/recover").send({email:f.users[0].email,password}));
    expect((await complete(recovery,h.id)).status).toBe(409);
    expect((await query("SELECT state FROM administration_handovers WHERE id=$1",[h.id]))[0].state).toBe("accepted");
    ok(await complete(f.sender,h.id));
    expect(ok(await complete(recovery,h.id)).replayed).toBe(true);
    expect(ok(await recovery.get(`/api/auth/administration/handovers/${h.id}/receipt`)).state).toBe("completed");
  });
  it.each(["suspend","terminate"])("restores a temporary suspension atomically but never revives a terminated membership: %s",async departure=>{
    const f=await fixture();await appoint(f);
    await db.transaction(tx=>ensureAdministrativePerson(tx,f.company,f.users[1].id));
    const [branch]=await db.insert(branchesTable).values({companyId:f.company,name:"نطاق استعادة",nameAr:"نطاق استعادة",city:"الرياض"}).returning();
    const [wh]=await db.insert(warehousesTable).values({companyId:f.company,branchId:branch.id,name:"مستودع استعادة",nameAr:"مستودع استعادة"}).returning();
    let person=ok(await f.sender.get("/api/team/people")).find((p:any)=>p.userId===f.users[1].id);
    const form={creationKey:person.creationKey,name:person.name,email:person.email,loginKinds:["platform"],
      deniedActions:[],grants:[{resource:"inventory",branchId:branch.id,warehouseIds:[wh.id],actions:["inventory.read"],amountLimit:null,startsAt:null,endsAt:null}]};
    person=ok(await f.sender.put(`/api/team/people/${person.personId}/access`).send({person:form,expectedRevision:person.revision,suspended:false}));
    const beforeGrants=person.grants;
    await db.insert(userCompaniesTable).values({companyId:f.otherCompany,userId:f.users[1].id,role:"manager"});
    const other=agent();ok(await other.post("/api/auth/login").send({email:f.users[1].email,password}));
    ok(await other.post("/api/auth/switch-company").send({companyId:f.otherCompany}));
    ok(await f.sender.post(`/api/administration/members/${f.users[1].id}/access`).send({departure}));
    expect((await f.target.get("/api/products")).status).toBe(401);
    ok(await other.get("/api/auth/me"));
    person=ok(await f.sender.get("/api/team/people")).find((p:any)=>p.userId===f.users[1].id);
    expect(person.membershipDeparture).toBe(departure);
    expect(person.grants.length).toBe(departure==="suspend"?beforeGrants.length:0);
    const update=()=>f.sender.put(`/api/team/people/${person.personId}/access`).send({person:form,expectedRevision:person.revision,suspended:false});
    if(departure==="terminate"){
      expect((await update()).status).toBe(409);
      expect((await query("SELECT * FROM user_companies WHERE company_id=$1 AND user_id=$2",[f.company,f.users[1].id])).length).toBe(0);
      return;
    }
    // The owner already consumes one seat; a full plan must not report restoration success.
    ok(await f.sender.put("/api/team/policy").send({enabledModules:["inventory"],seatLimit:1}));
    expect((await update()).status).toBe(409);
    expect((await query("SELECT * FROM user_companies WHERE company_id=$1 AND user_id=$2",[f.company,f.users[1].id])).length).toBe(0);
    ok(await f.sender.put("/api/team/policy").send({enabledModules:["pos"],seatLimit:null}));
    expect((await update()).status).toBe(403);
    ok(await f.sender.put("/api/team/policy").send({enabledModules:["inventory","pos"],seatLimit:null}));
    const responses=await Promise.all([update(),update()]);
    expect(responses.map(r=>r.status).sort()).toEqual([200,409]);
    const restored=responses.find(r=>r.status===200)!.body;
    expect(restored.status).toBe("active");expect(restored.membershipDeparture).toBeNull();
    const login=agent();ok(await login.post("/api/auth/login").send({email:f.users[1].email,password}));
    const products=ok(await login.get("/api/products").set("X-Workspace-Responsibility",String(restored.grants[0].id)));
    expect(products.every((p:any)=>!("costPrice" in p))).toBe(true);
    expect((await login.get("/api/accounting/journal-entries")).status).toBe(403);
    expect(ok(await login.get("/api/administration")).rights).toEqual([]);
    expect((await query("SELECT role FROM user_companies WHERE company_id=$1 AND user_id=$2",[f.company,f.users[1].id]))[0].role).toBe("scoped");
    expect((await query("SELECT role FROM user_companies WHERE company_id=$1 AND user_id=$2",[f.otherCompany,f.users[1].id]))[0].role).toBe("manager");
  });
  it("does not mass-promote legacy owners or administrators; requires explicit authorized acknowledgement",async()=>{
    const f=await fixture();
    expect(ok(await f.sender.get("/api/administration")).primaryOwnerId).toBeNull();
    expect(ok(await f.sender.get("/api/administration")).canAppointPrimaryOwner).toBe(true);
    expect((await f.sender.post("/api/administration/owner/appoint").send({acknowledge:false})).status).toBe(400);
    const existing=await propose(f,"retain");await accept(f,existing.id);ok(await complete(f.sender,existing.id));
    expect((await f.target.post("/api/administration/owner/appoint").send({acknowledge:true})).status).toBe(403);
    await appoint(f);await appoint(f);
    expect(ok(await f.sender.get("/api/administration")).isPrimaryOwner).toBe(true);
    expect(ok(await f.other.get("/api/administration")).isPrimaryOwner).toBe(false);
    expect((await f.target.post("/api/administration/owner/appoint").send({acknowledge:true})).status).toBe(409);
    expect((await query("SELECT * FROM audit_logs WHERE company_id=$1 AND action='system_owner.appointed'",[f.company])).length).toBe(1);
  });
  it("subscriber signup remains scoped until its evidenced creator explicitly appoints the account owner",async()=>{
    const a=agent(),email=`subscriber-${randomUUID()}@example.invalid`;
    ok(await a.post("/api/auth/signup").send({name:"مسؤول مشترك صريح",email,password}),201);
    expect(ok(await a.get("/api/administration")).canAppointPrimaryOwner).toBe(true);
    expect((await a.get("/api/accounting/journal-entries")).status).toBe(403);
    ok(await a.post("/api/administration/owner/appoint").send({acknowledge:true}));
    expect(ok(await a.get("/api/auth/me")).role).toBe("owner");
    ok(await a.get("/api/accounting/journal-entries"));
    expect((await query("SELECT * FROM responsibility_grants WHERE company_id=(SELECT company_id FROM user_companies uc JOIN users u ON u.id=uc.user_id WHERE u.email=$1)",[email])).length).toBe(0);
  });
  it("serializes concurrent explicit first appointments and keeps one primary owner without changing other legacy permissions",async()=>{
    const f=await fixture();
    await query("UPDATE user_companies SET role='owner' WHERE company_id=$1 AND user_id=$2",[f.company,f.users[1].id]);
    const results=await Promise.all([f.sender,f.target].map(a=>a.post("/api/administration/owner/appoint").send({acknowledge:true})));
    expect(results.map(r=>r.status).sort()).toEqual([200,409]);
    expect((await query("SELECT * FROM company_administrators WHERE company_id=$1 AND primary_owner",[f.company])).length).toBe(1);
    expect((await query("SELECT role FROM user_companies WHERE company_id=$1 AND user_id=ANY($2::integer[])",[f.company,f.users.slice(0,2).map(u=>u.id)])).every(r=>r.role==="owner")).toBe(true);
  });
  it.each(["suspend","terminate"])("owner appoints and edits independent managers, then revokes %s during a live session without consent",async departure=>{
    const f=await fixture();await appoint(f);
    ok(await f.sender.patch(`/api/administration/members/${f.users[1].id}`).send({responsibilities:["users","contact"],active:true}));
    expect(ok(await f.target.get("/api/administration")).rights).toEqual(["users","contact"]);
    expect((await f.target.get("/api/accounting/journal-entries")).status).toBe(403);
    ok(await f.sender.patch(`/api/administration/members/${f.users[1].id}`).send({responsibilities:all,active:true}));
    expect(ok(await f.target.get("/api/administration")).rights).toEqual(all);
    expect((await f.target.patch(`/api/administration/members/${f.users[2].id}`).send({responsibilities:all,active:true})).status).toBe(409);
    await db.insert(userCompaniesTable).values({companyId:f.otherCompany,userId:f.users[1].id,role:"manager"});
    const other=agent();ok(await other.post("/api/auth/login").send({email:f.users[1].email,password}));
    ok(await other.post("/api/auth/switch-company").send({companyId:f.otherCompany}));
    await db.transaction(tx=>ensureAdministrativePerson(tx,f.company,f.users[1].id));
    ok(await f.sender.post(`/api/administration/members/${f.users[1].id}/access`).send({departure}));
    expect((await f.target.get("/api/administration")).status).toBe(401);
    ok(await other.get("/api/auth/me"));
    expect((await query("SELECT * FROM user_companies WHERE company_id=$1 AND user_id=$2",[f.company,f.users[1].id])).length).toBe(0);
    expect((await query("SELECT * FROM employees WHERE company_id=$1 AND user_id=$2",[f.company,f.users[1].id])).length).toBe(1);
    expect((await query("SELECT * FROM administration_handovers WHERE company_id=$1",[f.company])).length).toBe(0);
  });
  it("protects the primary owner even with other active administrators, including old membership and employee editors",async()=>{
    const f=await fixture();await appoint(f);
    await db.transaction(tx=>ensureAdministrativePerson(tx,f.company,f.users[0].id));
    ok(await f.sender.patch(`/api/administration/members/${f.users[1].id}`).send({responsibilities:all,active:true}));
    expect((await f.sender.patch(`/api/administration/members/${f.users[0].id}`).send({responsibilities:all,active:false})).status).toBe(409);
    expect((await f.sender.patch(`/api/administration/members/${f.users[0].id}`).send({responsibilities:["administrators"],active:true})).status).toBe(409);
    expect((await f.sender.post(`/api/administration/members/${f.users[0].id}/access`).send({departure:"terminate"})).status).toBe(409);
    expect((await f.sender.post("/api/administration/membership/leave").send({acknowledge:true,departure:"terminate"})).status).toBe(409);
    expect((await f.sender.patch(`/api/users/${f.users[0].id}`).send({role:"manager"})).status).toBe(409);
    const [person]=await query("SELECT employee_id FROM employee_access WHERE company_id=$1 AND user_id=$2",[f.company,f.users[0].id]);
    expect((await f.sender.patch(`/api/hr/employees/${person.employee_id}`).send({status:"terminated"})).status).toBe(409);
    expect((await f.sender.patch(`/api/hr/employees/${person.employee_id}`).send({userId:null})).status).toBe(409);
    expect((await f.sender.patch(`/api/hr/employees/${person.employee_id}`).send({userId:f.users[2].id})).status).toBe(409);
    expect(ok(await f.sender.get("/api/administration")).primaryOwnerId).toBe(f.users[0].id);
  });
  it("a non-administrator may voluntarily leave only their own company membership while history and other membership survive",async()=>{
    const f=await fixture();await appoint(f);
    await db.transaction(tx=>ensureAdministrativePerson(tx,f.company,f.users[1].id));
    await db.insert(userCompaniesTable).values({companyId:f.otherCompany,userId:f.users[1].id,role:"manager"});
    expect((await f.target.post("/api/administration/membership/leave").send({acknowledge:false,departure:"terminate"})).status).toBe(400);
    ok(await f.target.post("/api/administration/membership/leave").send({acknowledge:true,departure:"terminate"}));
    expect((await f.target.get("/api/administration")).status).toBe(401);
    expect((await query("SELECT company_id FROM user_companies WHERE user_id=$1",[f.users[1].id])).map(r=>r.company_id)).toEqual([f.otherCompany]);
    expect((await query("SELECT * FROM employees WHERE company_id=$1 AND user_id=$2",[f.company,f.users[1].id])).length).toBe(1);
    expect(ok(await f.sender.get("/api/administration")).isPrimaryOwner).toBe(true);
  });
  it("transfers full account responsibility only with a live replacement accepting the exact owner-transfer revision",async()=>{
    const f=await fixture();await appoint(f);
    const h={...input(f.users[1].id,"terminate"),ownerTransfer:true};
    expect((await f.sender.put("/api/administration/handovers").send({...h,ownerTransfer:false})).status).toBe(409);
    ok(await f.sender.put("/api/administration/handovers").send(h));
    expect((await complete(f.sender,h.id)).status).toBe(409);
    await accept(f,h.id);
    ok(await f.sender.put("/api/administration/handovers").send({...h,expectedRevision:1,departure:"suspend"}));
    expect((await complete(f.sender,h.id,2)).status).toBe(409);
    await accept(f,h.id,2);
    const responses=await Promise.all([complete(f.sender,h.id,2),complete(f.sender,h.id,2)]);
    expect(responses.map(r=>r.status)).toEqual([200,200]);
    expect(responses.filter(r=>r.body.replayed===true)).toHaveLength(1);
    expect(ok(await f.target.get("/api/administration")).isPrimaryOwner).toBe(true);
    expect(ok(await f.target.get("/api/auth/me")).role).toBe("owner");
    ok(await f.target.get("/api/accounting/journal-entries"));
    expect(ok(await f.other.get("/api/administration")).isPrimaryOwner).toBe(false);
    expect((await query("SELECT * FROM audit_logs WHERE action='administration.completed' AND details::jsonb->>'id'=$1",[h.id])).length).toBe(1);
  });
  it("recovers a lost committed result without any other membership, without restoring company or financial access",async()=>{
    const f=await fixture();await appoint(f);
    await query("DELETE FROM user_companies WHERE company_id=$1 AND user_id=$2",[f.otherCompany,f.users[0].id]);
    const h={...input(f.users[1].id,"terminate"),ownerTransfer:true};
    ok(await f.sender.put("/api/administration/handovers").send(h));await accept(f,h.id);
    ok(await complete(f.sender,h.id));
    const recovery=agent();
    expect((await recovery.post("/api/auth/login").send({email:f.users[0].email,password})).status).toBe(403);
    expect(ok(await recovery.post("/api/auth/administration/recover").send({email:f.users[0].email,password})).userId).toBe(f.users[0].id);
    expect(ok(await recovery.get(`/api/auth/administration/handovers/${h.id}/receipt`)).state).toBe("completed");
    expect(ok(await complete(recovery,h.id)).replayed).toBe(true);
    expect((await recovery.get("/api/accounting/journal-entries")).status).toBe(403);
    expect((await recovery.get("/api/administration")).status).toBe(403);
    expect((await f.third.get(`/api/auth/administration/handovers/${h.id}/receipt`)).status).toBe(404);
    expect((await query("SELECT * FROM user_companies WHERE user_id=$1",[f.users[0].id])).length).toBe(0);
    expect((await query("SELECT * FROM audit_logs WHERE action='administration.completed' AND details::jsonb->>'id'=$1",[h.id])).length).toBe(1);
    await query("UPDATE users SET is_active=false WHERE id=$1",[f.users[0].id]);
    expect((await recovery.get(`/api/auth/administration/handovers/${h.id}/receipt`)).status).toBe(401);
  });
  it("rechecks revoked replacement eligibility and concurrent attempts cannot remove the primary owner",async()=>{
    const f=await fixture();await appoint(f);
    const h={...input(f.users[1].id),ownerTransfer:true};
    ok(await f.sender.put("/api/administration/handovers").send(h));await accept(f,h.id);
    ok(await f.sender.post(`/api/administration/members/${f.users[1].id}/access`).send({departure:"suspend"}));
    expect((await complete(f.sender,h.id)).status).toBe(409);
    const changes=await Promise.all(["suspend","terminate"].map(departure=>
      f.sender.post(`/api/administration/members/${f.users[0].id}/access`).send({departure})));
    expect(changes.map(r=>r.status)).toEqual([409,409]);
    expect(ok(await f.sender.get("/api/administration")).isPrimaryOwner).toBe(true);
  });
});
describe("company-local administration and explicit handover",()=>{
  it("self-service creator is an administrator, not a legal owner or automatic financial approver",async()=>{
    const agent=request.agent(app),email=`signup-${randomUUID()}@example.invalid`;
    ok(await agent.post("/api/auth/signup").send({name:"مسؤول تقنية مفوض",email,password}),201);
    const workspace=ok(await agent.get("/api/administration"));
    expect(workspace.rights).toEqual(all);
    const [membership]=await query("SELECT uc.role FROM user_companies uc JOIN users u ON u.id=uc.user_id WHERE u.email=$1",[email]);
    expect(membership.role).toBe("scoped");
    expect((await agent.get("/api/accounting/journal-entries")).status).toBe(403);
    expect((await query("SELECT * FROM responsibility_grants WHERE company_id=(SELECT company_id FROM user_companies uc JOIN users u ON u.id=uc.user_id WHERE u.email=$1)",[email])).length).toBe(0);
  });
  it("requires recipient login and acceptance; retains approved job membership and unrelated membership/history",async()=>{
    const f=await fixture();
    await query("INSERT INTO company_administrators(company_id,user_id,responsibilities) VALUES($1,$2,$3)",[f.company,f.users[0].id,all]);
    await db.transaction(tx=>ensureAdministrativePerson(tx,f.company,f.users[0].id));
    const [branch]=await db.insert(branchesTable).values({companyId:f.company,name:"فرع وظيفة باقية",nameAr:"فرع وظيفة باقية",city:"الرياض"}).returning();
    const [wh]=await db.insert(warehousesTable).values({companyId:f.company,branchId:branch.id,name:"مستودع وظيفة",nameAr:"مستودع وظيفة"}).returning();
    const [profile]=await query("SELECT employee_id FROM employee_access WHERE company_id=$1 AND user_id=$2",[f.company,f.users[0].id]);
    const [grant]=await query(`INSERT INTO responsibility_grants(company_id,employee_id,resource,branch_id,warehouse_ids,actions,created_by)
      VALUES($1,$2,'inventory',$3,$4,ARRAY['inventory.read'],$5) RETURNING *`,
      [f.company,profile.employee_id,branch.id,[wh.id],f.users[0].id]);
    const h=await propose(f);
    expect((await complete(f.sender,h.id)).status).toBe(409);
    expect((await f.third.post(`/api/administration/handovers/${h.id}/accept`).send({expectedRevision:1})).status).toBe(403);
    await accept(f,h.id);
    ok(await complete(f.sender,h.id));
    expect((await query("SELECT role FROM user_companies WHERE company_id=$1 AND user_id=$2",[f.company,f.users[0].id]))[0].role).toBe("scoped");
    expect(ok(await f.target.get("/api/administration")).rights).toEqual(all);
    expect((await f.target.get("/api/accounting/journal-entries")).status).toBe(403);
    expect(ok(await f.other.get("/api/administration")).userId).toBe(f.users[0].id);
    expect((await query("SELECT * FROM administration_notices WHERE handover_id=$1",[h.id])).length).toBe(6);
    const relog=request.agent(app);ok(await relog.post("/api/auth/login").send({email:f.users[0].email,password}));
    expect(ok(await relog.get("/api/administration")).rights).toEqual([]);
    const remaining=ok(await relog.get("/api/workspace/access"));
    expect(remaining.grants.map((g:any)=>g.id)).toContain(grant.id);
    expect((await query("SELECT revoked_at FROM responsibility_grants WHERE id=$1",[grant.id]))[0].revoked_at).toBeNull();
    expect(ok(await relog.get(`/api/auth/administration/handovers/${h.id}/receipt`)).state).toBe("completed");
  });
  it.each(["suspend","terminate"])("revokes only company-local access for %s and replays a committed lost response",async departure=>{
    const f=await fixture(),h=await propose(f,departure);
    await db.transaction(tx=>ensureAdministrativePerson(tx,f.company,f.users[0].id));
    await db.insert(userCompaniesTable).values({companyId:f.otherCompany,userId:f.users[1].id,role:"manager"});
    const delegations=await query(`INSERT INTO approver_delegations(company_id,from_user_id,to_user_id,from_date,to_date)
      VALUES($1,$3,$4,now()-interval '1 day',now()+interval '1 day'),($2,$3,$4,now()-interval '1 day',now()+interval '1 day')
      RETURNING id,company_id`,[f.company,f.otherCompany,f.users[0].id,f.users[1].id]);
    await accept(f,h.id);
    await complete(f.sender,h.id); // Treat response as lost; verify independent DB evidence first.
    expect((await query("SELECT * FROM user_companies WHERE company_id=$1 AND user_id=$2",[f.company,f.users[0].id])).length).toBe(0);
    expect((await query("SELECT * FROM user_companies WHERE company_id=$1 AND user_id=$2",[f.otherCompany,f.users[0].id])).length).toBe(1);
    expect(ok(await complete(f.other,h.id)).replayed).toBe(true);
    expect((await query("SELECT * FROM audit_logs WHERE action='administration.completed' AND details::jsonb->>'id'=$1",[h.id])).length).toBe(1);
    expect(ok(await f.other.get("/api/administration")).userId).toBe(f.users[0].id);
    expect((await f.sender.get("/api/administration")).status).toBe(401);
    const after=await query("SELECT id,company_id,revoked_at FROM approver_delegations WHERE id=ANY($1::integer[])",[delegations.map(d=>d.id)]);
    expect(after.find(d=>d.company_id===f.company).revoked_at).not.toBeNull();
    expect(after.find(d=>d.company_id===f.otherCompany).revoked_at).toBeNull();
    expect((await query("SELECT status FROM employee_access WHERE company_id=$1 AND user_id=$2",[f.company,f.users[0].id]))[0].status).toBe("suspended");
    expect((await query("SELECT * FROM employees WHERE company_id=$1 AND user_id=$2",[f.company,f.users[0].id])).length).toBe(1);
  });
  it("supports multiple independent administrators, distributes explicit responsibilities without finance",async()=>{
    const f=await fixture(),h=await propose(f,"retain");await accept(f,h.id);ok(await complete(f.sender,h.id));
    expect(ok(await f.sender.get("/api/administration")).rights).toEqual(all);
    expect(ok(await f.target.get("/api/administration")).rights).toEqual(all);
    const second={...input(f.users[2].id,"retain"),responsibilities:["users","contact"]};
    ok(await f.sender.put("/api/administration/handovers").send(second));
    ok(await f.third.post(`/api/administration/handovers/${second.id}/accept`).send({expectedRevision:1}));
    ok(await complete(f.sender,second.id));
    expect(ok(await f.third.get("/api/administration")).rights).toEqual(["users","contact"]);
    expect(ok(await f.third.get("/api/team/setup")).policy).toBeTruthy();
    ok(await f.third.post("/api/team/people").send({creationKey:randomUUID(),name:"سجل دون دخول",email:null,loginKinds:[],grants:[],deniedActions:[]}),201);
    expect((await f.third.put("/api/team/setup").send({expectedRevision:0,mode:"solo",step:"people",draft:{}})).status).toBe(403);
    expect((await f.third.put("/api/team/policy").send({enabledModules:[],seatLimit:1})).status).toBe(403);
    expect((await f.third.get("/api/accounting/journal-entries")).status).toBe(403);
  });
  it("an explicitly revoked legacy owner cannot bypass the roster through old user/company editors",async()=>{
    const f=await fixture(),h=await propose(f,"retain");await accept(f,h.id);ok(await complete(f.sender,h.id));
    ok(await f.target.patch(`/api/administration/members/${f.users[0].id}`).send({responsibilities:[],active:false}));
    expect((await f.sender.get("/api/users")).status).toBe(403);
    expect((await f.sender.patch(`/api/admin/companies/${f.company}`).send({name:"غير مسموح"})).status).toBe(403);
    expect((await f.sender.patch("/api/settings").send({company:{name:"غير مسموح"}})).status).toBe(403);
    expect(ok(await f.sender.get("/api/administration")).rights).toEqual([]);
    expect((await query("SELECT role FROM user_companies WHERE company_id=$1 AND user_id=$2",[f.company,f.users[0].id]))[0].role).toBe("owner");
  });
  it("invalidates acceptance when departure or responsibilities change",async()=>{
    const f=await fixture(),h=await propose(f);await accept(f,h.id);
    ok(await f.sender.put("/api/administration/handovers").send({...h,expectedRevision:1,departure:"suspend",responsibilities:["administrators","users"]}));
    expect((await complete(f.sender,h.id,1)).status).toBe(409);
    expect((await complete(f.sender,h.id,2)).status).toBe(409);
    await accept(f,h.id,2);ok(await complete(f.sender,h.id,2));
  });
  it("separates settings-only and subscription-only UI services without leaking or overwriting person drafts",async()=>{
    const f=await fixture(),h={...input(f.users[1].id,"retain"),responsibilities:["settings"]};
    ok(await f.sender.put("/api/administration/handovers").send(h));await accept(f,h.id);ok(await complete(f.sender,h.id));
    ok(await f.sender.put("/api/team/setup").send({expectedRevision:0,mode:"team",step:"people",draft:{person:{name:"مسودة خاصة بالمسؤول عن المستخدمين"}}}));
    const read=ok(await f.target.get("/api/team/setup"));expect(read.draft).toEqual({});
    const updated=ok(await f.target.put("/api/team/setup").send({expectedRevision:read.revision,mode:"solo",step:read.step,draft:{}}));
    expect(updated.draft).toEqual({});
    expect((await query("SELECT draft FROM team_setup_state WHERE company_id=$1",[f.company]))[0].draft.person.name).toBe("مسودة خاصة بالمسؤول عن المستخدمين");
    expect((await f.target.get("/api/team/people")).status).toBe(403);
    const subscription={...input(f.users[2].id,"retain"),responsibilities:["subscription"]};
    ok(await f.sender.put("/api/administration/handovers").send(subscription));
    ok(await f.third.post(`/api/administration/handovers/${subscription.id}/accept`).send({expectedRevision:1}));
    ok(await complete(f.sender,subscription.id));
    const policy=ok(await f.third.get("/api/team/setup")).policy;
    ok(await f.third.put("/api/team/policy").send({enabledModules:policy.enabledModules,seatLimit:10}));
    expect((await f.third.get("/api/team/people")).status).toBe(403);
    expect((await f.third.put("/api/team/setup").send({expectedRevision:updated.revision,mode:"team",step:"people",draft:{}})).status).toBe(403);
  });
  it("rechecks revoked recipient eligibility before execution, even after personal acceptance",async()=>{
    const f=await fixture(),h=await propose(f);await accept(f,h.id);
    await query("DELETE FROM user_companies WHERE company_id=$1 AND user_id=$2",[f.company,f.users[1].id]);
    expect((await complete(f.sender,h.id)).status).toBe(409);
    expect(ok(await f.sender.get("/api/administration")).rights).toEqual(all);
  });
  it("prevents concurrent removal of the last active manager, not counting invitations",async()=>{
    const f=await fixture(),h=await propose(f,"retain");await accept(f,h.id);ok(await complete(f.sender,h.id));
    const results=await Promise.all([
      f.sender.patch(`/api/administration/members/${f.users[0].id}`).send({responsibilities:[],active:false}),
      f.target.patch(`/api/administration/members/${f.users[1].id}`).send({responsibilities:[],active:false}),
    ]);
    expect(results.map(r=>r.status).sort()).toEqual([200,409]);
  });
  it("serializes two accepted reciprocal departures and refuses the second after eligibility changes",async()=>{
    const f=await fixture(),appoint=await propose(f,"retain");await accept(f,appoint.id);ok(await complete(f.sender,appoint.id));
    const a=input(f.users[1].id,"terminate"),b=input(f.users[0].id,"terminate");
    ok(await f.sender.put("/api/administration/handovers").send(a));
    ok(await f.target.put("/api/administration/handovers").send(b));
    ok(await f.target.post(`/api/administration/handovers/${a.id}/accept`).send({expectedRevision:1}));
    ok(await f.sender.post(`/api/administration/handovers/${b.id}/accept`).send({expectedRevision:1}));
    const results=await Promise.all([complete(f.sender,a.id),complete(f.target,b.id)]);
    expect(results.map(r=>r.status).sort()).toEqual([200,409]);
    expect((await query("SELECT * FROM company_administrators ca JOIN user_companies uc USING(company_id,user_id) WHERE ca.company_id=$1 AND ca.active AND 'administrators'=ANY(ca.responsibilities)",[f.company])).length).toBe(1);
  });
  it("never counts an unactivated invitation and revocation prevents activation",async()=>{
    const f=await fixture();
    const person=ok(await f.sender.post("/api/team/people").send({creationKey:randomUUID(),name:"بديل مدعو",
      email:`invited-${randomUUID()}@example.invalid`,loginKinds:["platform"],grants:[],deniedActions:[]}),201);
    const invite=ok(await f.sender.post(`/api/team/people/${person.personId}/invite`).send({expectedRevision:person.revision}),201);
    const h={...input(f.users[1].id),toUserId:null,personId:person.personId};
    ok(await f.sender.put("/api/administration/handovers").send(h));
    expect((await complete(f.sender,h.id)).status).toBe(409);
    expect((await f.sender.patch(`/api/administration/members/${f.users[0].id}`).send({responsibilities:[],active:false})).status).toBe(409);
    ok(await f.sender.delete(`/api/team/people/${person.personId}/invite`));
    expect((await request(app).post("/api/auth/team-activation/accept").send({token:invite.activationToken,password})).status).toBe(409);
  });
  it("invited replacement activates through the existing service, logs in, accepts, and completes once",async()=>{
    const f=await fixture(),email=`replacement-${randomUUID()}@example.invalid`;
    const person=ok(await f.sender.post("/api/team/people").send({creationKey:randomUUID(),name:"مسؤول مستقل",
      email,loginKinds:["platform"],grants:[],deniedActions:[]}),201);
    const invite=ok(await f.sender.post(`/api/team/people/${person.personId}/invite`).send({expectedRevision:person.revision}),201);
    const h={...input(f.users[1].id,"terminate"),toUserId:null,personId:person.personId};
    ok(await f.sender.put("/api/administration/handovers").send(h));
    ok(await request(app).post("/api/auth/team-activation/accept").send({token:invite.activationToken,password}));
    const replacement=request.agent(app);ok(await replacement.post("/api/auth/login").send({email,password}));
    const inbox=ok(await replacement.get("/api/administration"));
    expect(inbox.handovers.find((x:any)=>x.id===h.id).to_user_id).toBe(inbox.userId);
    ok(await replacement.post(`/api/administration/handovers/${h.id}/accept`).send({expectedRevision:1}));
    const results=await Promise.all([complete(f.sender,h.id),complete(f.sender,h.id)]);
    results.forEach(r=>ok(r));expect(results.map(r=>r.body.replayed).sort()).toEqual([false,true]);
    expect(ok(await replacement.get("/api/administration")).rights).toEqual(all);
    expect((await query("SELECT * FROM journal_entries WHERE company_id=$1",[f.company])).length).toBe(0);
    expect((await query("SELECT * FROM users WHERE id=$1 AND is_active",[f.users[0].id])).length).toBe(1);
  });
});
