import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { db,pool,companiesTable,usersTable,userCompaniesTable,branchesTable,warehousesTable } from "@workspace/db";
import app,{assertApplicationReady} from "../app";
const password="Isolated permission template phrase 2026!";
let clientId=100;
const agent=()=>request.agent(app).set("X-Forwarded-For",`203.0.113.${++clientId}`);
const ok=(r:request.Response,s=200)=>{expect(r.status,JSON.stringify(r.body)).toBe(s);return r.body;};
const rows=async(q:string,p:unknown[]=[]) => (await pool.query(q,p)).rows;
const personInput=(p:any)=>({creationKey:p.creationKey,name:p.name,email:p.email,loginKinds:p.loginKinds,
  deniedActions:p.deniedActions,grants:p.grants.map(({id,...g}:any)=>g)});
beforeAll(async()=>assertApplicationReady());
async function fixture(){
  const tag=randomUUID();
  const companies=await db.insert(companiesTable).values([{name:`template-${tag}`},{name:`foreign-${tag}`}]).returning();
  const [user]=await db.insert(usersTable).values({name:"Template administrator",email:`owner-${tag}@example.invalid`,
    passwordHash:await bcrypt.hash(password,4),role:"owner",isActive:true}).returning();
  await db.insert(userCompaniesTable).values(companies.map(c=>({companyId:c.id,userId:user.id,role:"owner",isDefault:c.id===companies[0].id})));
  const a=agent(),other=agent();
  for(const c of [a,other])ok(await c.post("/api/auth/login").send({email:user.email,password}));
  ok(await other.post("/api/auth/switch-company").send({companyId:companies[1].id}));
  const branches=await db.insert(branchesTable).values(companies.flatMap(c=>[1,2].map(n=>({
    companyId:c.id,name:`Branch ${n}`,nameAr:`فرع ${n}`,city:"الرياض"})))).returning();
  const wh=await db.insert(warehousesTable).values(branches.map(b=>({
    companyId:b.companyId,branchId:b.id,name:"Template warehouse",nameAr:"مستودع القوالب"}))).returning();
  const t=ok(await a.post("/api/team/templates").send({name:"قالب قراءة",resource:"inventory",actions:["inventory.read"]}),201);
  const people=[];
  for(let i=0;i<3;i++){
    const body={creationKey:randomUUID(),name:`موظف الوراثة ${i+1}`,email:`person-${i}-${tag}@example.invalid`,
      loginKinds:["platform"],deniedActions:i===1?["inventory.cost.read"]:[],
      grants:[{resource:"inventory",branchId:branches[i%2].id,warehouseIds:[wh[i%2].id],actions:t.actions,
        amountLimit:null,startsAt:null,endsAt:null,templateId:t.id,templateRevision:t.revision,templateMode:i===2?"override":"inherit"}]};
    let p=ok(await a.post("/api/team/people").send(body),201);
    const inv=ok(await a.post(`/api/team/people/${p.personId}/invite`).send({expectedRevision:p.revision}),201);
    ok(await agent().post("/api/auth/team-activation/accept").send({token:inv.activationToken,password}));
    p=ok(await a.get("/api/team/people")).find((x:any)=>x.personId===p.personId);
    people.push(p);
  }
  return {a,other,company:companies[0].id,foreign:companies[1].id,t,people,branches,wh};
}
describe("shared permission templates preserve paired scopes, evidence and explicit exceptions",()=>{
  it("two inherit, one overrides; preview shows denial and scopes, apply changes only inherited grants, then returns exception to inheritance",async()=>{
    const f=await fixture(),edit={expectedRevision:1,name:"قراءة وتكلفة اختيارية",actions:["inventory.read","inventory.cost.read"]};
    const preview=ok(await f.a.post(`/api/team/templates/${f.t.id}/preview`).send(edit));
    expect(preview.effects).toHaveLength(3);
    expect(preview.effects[0].effectiveAfter).toContain("inventory.cost.read");
    expect(preview.effects[1].effectiveAfter).toEqual(["inventory.read"]);
    expect(preview.effects[1].deniedActions).toEqual(["inventory.cost.read"]);
    expect(preview.effects[2].mode).toBe("override");
    expect(preview.effects[2].afterActions).toEqual(["inventory.read"]);
    ok(await f.a.put(`/api/team/templates/${f.t.id}`).send({...edit,digest:preview.digest}));
    let people=ok(await f.a.get("/api/team/people"));
    for(let i=0;i<3;i++){
      const p=people.find((x:any)=>x.personId===f.people[i].personId),before=f.people[i].grants[0],after=p.grants[0];
      expect(after.branchId).toBe(before.branchId);expect(after.warehouseIds).toEqual(before.warehouseIds);
      expect(after.amountLimit).toBe(before.amountLimit);expect(after.startsAt).toEqual(before.startsAt);expect(after.endsAt).toEqual(before.endsAt);
      expect(after.templateRevision).toBe(i===2?1:2);expect(after.id===before.id).toBe(i===2);
    }
    const third=people.find((x:any)=>x.personId===f.people[2].personId),input=personInput(third);
    input.grants[0]={...input.grants[0],templateMode:"inherit",templateRevision:2,actions:edit.actions};
    ok(await f.a.put(`/api/team/people/${third.personId}/access`).send({person:input,expectedRevision:third.revision,suspended:false}));
    const thirdAgent=agent();ok(await thirdAgent.post("/api/auth/login").send({email:third.email,password}));
    const access=ok(await thirdAgent.get("/api/workspace/access"));
    expect(access.grants[0].actions).toContain("inventory.cost.read");
    expect((await thirdAgent.get("/api/team/templates")).status).toBe(403);
    expect((await thirdAgent.get("/api/accounting/journal-entries")).status).toBe(403);
    const second=agent();ok(await second.post("/api/auth/login").send({email:f.people[1].email,password}));
    expect(ok(await second.get("/api/workspace/access")).grants[0].actions).not.toContain("inventory.cost.read");
    expect((await rows("SELECT * FROM team_permission_template_versions WHERE template_id=$1 ORDER BY revision",[f.t.id])).length).toBe(2);
    expect((await rows("SELECT * FROM responsibility_grants WHERE template_id=$1 AND revoked_at IS NOT NULL",[f.t.id])).length).toBe(3);
  });
  it("rejects a stale impact after staff changes and serializes two simultaneous template edits",async()=>{
    const f=await fixture(),edit={expectedRevision:1,name:"تعديل متزامن",actions:["inventory.read","inventory.cost.read"]};
    const preview=ok(await f.a.post(`/api/team/templates/${f.t.id}/preview`).send(edit));
    const p=f.people[0],input=personInput(p);input.deniedActions=["inventory.cost.read"];
    ok(await f.a.put(`/api/team/people/${p.personId}/access`).send({person:input,expectedRevision:p.revision,suspended:false}));
    expect((await f.a.put(`/api/team/templates/${f.t.id}`).send({...edit,digest:preview.digest})).status).toBe(409);
    const fresh=ok(await f.a.post(`/api/team/templates/${f.t.id}/preview`).send(edit));
    const outcomes=await Promise.all([1,2].map(()=>f.a.put(`/api/team/templates/${f.t.id}`).send({...edit,digest:fresh.digest})));
    expect(outcomes.map(r=>r.status).sort()).toEqual([200,409]);
    expect((await rows("SELECT * FROM audit_logs WHERE company_id=$1 AND action='team.template.applied'",[f.company])).length).toBe(1);
    expect((await f.a.post(`/api/team/templates/${f.t.id}/preview`).send(edit)).status).toBe(409);
  });
  it("rejects foreign templates, warehouses, branch unions, unavailable actions and stale inheritance without promoting a user",async()=>{
    const f=await fixture(),edit={expectedRevision:1,name:"خارج النطاق",actions:["inventory.read"]};
    expect((await f.other.post(`/api/team/templates/${f.t.id}/preview`).send(edit)).status).toBe(404);
    const foreign=ok(await f.other.post("/api/team/templates").send({name:"قالب آخر",resource:"inventory",actions:["inventory.read"]}),201);
    const p=f.people[0],input=personInput(p);
    input.grants[0].templateId=foreign.id;
    expect((await f.a.put(`/api/team/people/${p.personId}/access`).send({person:input,expectedRevision:p.revision,suspended:false})).status).toBe(403);
    input.grants[0].templateId=f.t.id;input.grants[0].warehouseIds=[f.wh[1].id];
    expect((await f.a.put(`/api/team/people/${p.personId}/access`).send({person:input,expectedRevision:p.revision,suspended:false})).status).toBe(403);
    input.grants[0].warehouseIds=[f.wh[0].id];input.grants[0].actions=["inventory.read","inventory.cost.read"];
    expect((await f.a.put(`/api/team/people/${p.personId}/access`).send({person:input,expectedRevision:p.revision,suspended:false})).status).toBe(409);
    for(const actions of [["inventory.read","inventory.write"],["inventory.read","finance.read"],["inventory.read","pos.sell"]]){
      expect((await f.a.post("/api/team/templates").send({name:"غير متاح",resource:"inventory",actions})).status).toBe(400);
    }
    expect((await f.a.post("/api/team/templates").send({name:"رواتب غير مفعلة",resource:"payroll",actions:["payroll.read"]})).status).toBe(400);
    expect((await rows("SELECT role FROM user_companies WHERE company_id=$1 AND user_id=$2",[f.company,p.userId]))[0].role).toBe("scoped");
  });
  it("shows dormant inheritance without restoring suspended membership; rejects previews changed by scope or entitlement",async()=>{
    const f=await fixture(),p=f.people[0],edit={expectedRevision:1,name:"نطاق متوقف",actions:["inventory.read","inventory.cost.read"]};
    const before=ok(await f.a.post(`/api/team/templates/${f.t.id}/preview`).send(edit));
    ok(await f.a.put(`/api/team/people/${p.personId}/access`).send({person:personInput(p),expectedRevision:p.revision,suspended:true}));
    expect((await f.a.put(`/api/team/templates/${f.t.id}`).send({...edit,digest:before.digest})).status).toBe(409);
    const fresh=ok(await f.a.post(`/api/team/templates/${f.t.id}/preview`).send(edit));
    const effect=fresh.effects.find((e:any)=>e.personId===p.personId);
    expect(effect.blocked).toBe(true);expect(effect.effectiveBefore).toEqual([]);expect(effect.effectiveAfter).toEqual([]);
    expect(effect.afterActions).toContain("inventory.cost.read");
    ok(await f.a.put(`/api/team/templates/${f.t.id}`).send({...edit,digest:fresh.digest}));
    const after=ok(await f.a.get("/api/team/people")).find((x:any)=>x.personId===p.personId);
    expect(after.status).toBe("suspended");expect(after.grants[0].templateRevision).toBe(2);
    const next={...edit,expectedRevision:2,name:"تغير الاستحقاق"};
    const preview=ok(await f.a.post(`/api/team/templates/${f.t.id}/preview`).send(next));
    ok(await f.a.put("/api/team/policy").send({enabledModules:["pos"],seatLimit:null}));
    expect((await f.a.put(`/api/team/templates/${f.t.id}`).send({...next,digest:preview.digest})).status).toBe(403);
  });
});
