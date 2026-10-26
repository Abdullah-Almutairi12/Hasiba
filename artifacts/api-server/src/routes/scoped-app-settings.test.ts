import {beforeAll,describe,it,expect} from "vitest";
import request from "supertest";
import {randomUUID} from "node:crypto";
import bcrypt from "bcryptjs";
import {db,pool,companiesTable,usersTable,userCompaniesTable,branchesTable} from "@workspace/db";
import app,{assertApplicationReady} from "../app";
import {ensureAdministrativePerson} from "../lib/administration-enrollment";
const password="Synthetic settings scope phrase 2026!";
let address=0;
const agent=()=>request.agent(app).set("X-Forwarded-For",`198.18.78.${++address}`);
const ok=(r:request.Response,status=200)=>{expect(r.status,JSON.stringify(r.body)).toBe(status);return r.body;};
const rows=async(q:string,p:unknown[]=[]) =>(await pool.query(q,p)).rows;
beforeAll(async()=>{await assertApplicationReady();});
async function fixture(){
 const tag=randomUUID(),hash=await bcrypt.hash(password,4);
 const companies=await db.insert(companiesTable).values([{name:`settings-a-${tag}`},{name:`settings-b-${tag}`}]).returning();
 const users=await db.insert(usersTable).values(["admin","viewer","delegate"].map(name=>({
  name,email:`${name}-${tag}@example.invalid`,passwordHash:hash,role:"scoped",isActive:true}))).returning();
 await db.insert(userCompaniesTable).values(users.flatMap((u,i)=>[{userId:u.id,companyId:companies[0].id,role:i?"scoped":"owner",isDefault:true},
  ...(!i?[{userId:u.id,companyId:companies[1].id,role:"owner",isDefault:false}]:[])]));
 const branches=await db.insert(branchesTable).values([
  {companyId:companies[0].id,name:"أ",nameAr:"أ",city:"الرياض"},
  {companyId:companies[0].id,name:"ب",nameAr:"ب",city:"جدة"},
  {companyId:companies[1].id,name:"غ",nameAr:"غ",city:"الخبر"}]).returning();
 for(const user of users.slice(1))await db.transaction(tx=>ensureAdministrativePerson(tx,companies[0].id,user.id));
 const clients=users.map(()=>agent());
 for(let i=0;i<users.length;i++)ok(await clients[i].post("/api/auth/login").send({email:users[i].email,password}));
 return {companies,users,branches,owner:clients[0],viewer:clients[1],delegate:clients[2]};
}
const payload=(s:any,data:object)=>({...data,expectedCompanyId:s.scope.companyId,expectedRevision:s.scope.revision,expectedParentRevision:s.scope.parentRevision});
describe("Company/branch settings on the original endpoint",()=>{
 it("rejects stale company intent even when both companies have the same revision",async()=>{
  const f=await fixture(),a=ok(await f.owner.get("/api/settings"));
  ok(await f.owner.post("/api/auth/switch-company").send({companyId:f.companies[1].id}));
  const b=ok(await f.owner.get("/api/settings"));expect(b.scope.revision).toBe(a.scope.revision);
  ok(await f.owner.patch("/api/settings").send(payload(a,{appearance:{theme:"stale-company"}})),409);
  expect(ok(await f.owner.get("/api/settings")).appearance).toEqual({});
 });
 it("quarantines historic global payload and isolates companies, branches and sensitive values",async()=>{
  const f=await fixture();
  await rows(`INSERT INTO app_settings(id,company,notifications) VALUES(1,$1,$2)
   ON CONFLICT(id) DO UPDATE SET company=excluded.company,notifications=excluded.notifications`,
   [{nameAr:"unassigned legacy must not become tenant identity"},{smtpPassword:"synthetic-unassigned-secret"}]);
  const a=ok(await f.owner.get("/api/settings"));
  expect(a.company).toEqual({});expect(a.notifications).toEqual({});expect(a.scope.canManage).toBe(true);
  expect(a.scope.availableBranches.map((b:any)=>b.id)).toEqual(f.branches.slice(0,2).map(b=>b.id));
  const saved=ok(await f.owner.patch("/api/settings").send(payload(a,{company:{currency:"SAR",timezone:"Asia/Riyadh"},notifications:{smtpPassword:"synthetic-company-only"}})));
  expect(saved.scope.revision).toBe(1);
  expect(saved.scope.history).toHaveLength(1);
  const audits=await rows("SELECT details FROM audit_logs WHERE company_id=$1 AND action='settings.scope.updated'",[f.companies[0].id]);
  expect(audits).toHaveLength(1);expect(JSON.stringify(audits)).not.toContain("synthetic-company-only");
  const publicView=ok(await f.viewer.get("/api/settings"));expect(publicView.notifications).toEqual({});
  expect(publicView.scope.availableBranches).toEqual([]);
  expect(publicView.scope.canManage).toBe(false);expect(publicView.company.currency).toBe("SAR");
  ok(await f.viewer.patch("/api/settings").send(payload(publicView,{pos:{x:1}})),403);
  ok(await f.owner.get(`/api/settings?branchId=${f.branches[2].id}`),404);
  ok(await f.viewer.get(`/api/settings?branchId=${f.branches[0].id}`),403);
  ok(await f.owner.post("/api/auth/switch-company").send({companyId:f.companies[1].id}));
  const b=ok(await f.owner.get("/api/settings"));expect(b.notifications).toEqual({});expect(b.company).toEqual({});
  expect(b.scope.companyId).toBe(f.companies[1].id);
  const [legacy]=await rows("SELECT company,notifications FROM app_settings WHERE id=1");
  expect(legacy.company.nameAr).toBe("unassigned legacy must not become tenant identity");
  expect(legacy.notifications.smtpPassword).toBe("synthetic-unassigned-secret");
 });
 it("inherits only unmodified fields, supports explicit branch override/reset and preserves immutable version evidence",async()=>{
  const f=await fixture(),url=`/api/settings?branchId=${f.branches[0].id}`,other=`/api/settings?branchId=${f.branches[1].id}`;
  let root=ok(await f.owner.get("/api/settings"));
  root=ok(await f.owner.patch("/api/settings").send(payload(root,{pos:{allowCash:true,receiptCopies:1}})));
  let branch=ok(await f.owner.get(url));expect(branch.pos).toEqual(root.pos);expect(branch.scope.revision).toBe(0);
  branch=ok(await f.owner.patch(url).send(payload(branch,{pos:{receiptCopies:2}})));
  expect(branch.scope.overrides.pos).toEqual(["receiptCopies"]);
  root=ok(await f.owner.patch("/api/settings").send(payload(root,{pos:{allowCash:false,receiptCopies:3}})));
  branch=ok(await f.owner.get(url));expect(branch.pos).toEqual({allowCash:false,receiptCopies:2});
  expect(ok(await f.owner.get(other)).pos).toEqual({allowCash:false,receiptCopies:3});
  branch=ok(await f.owner.patch(url).send(payload(branch,{reset:{pos:["receiptCopies"]}})));
  expect(branch.pos).toEqual(root.pos);expect(branch.scope.overrides.pos).toEqual([]);
  ok(await f.owner.patch(url).send(payload(branch,{tax:{registration:"invented"}})),400);
  ok(await f.owner.patch(url).send(payload(branch,{company:{vatNumber:"invented"}})),400);
  const history=await rows("SELECT id,revision,parent_revision,changed_sections FROM app_settings_versions WHERE company_id=$1 ORDER BY id",[f.companies[0].id]);
  expect(history).toHaveLength(4);
  expect(JSON.stringify(history)).not.toContain("synthetic-company-only");
  await expect(rows("UPDATE app_settings_versions SET revision=100 WHERE id=$1",[history[0].id])).rejects.toThrow("immutable");
  await expect(rows("UPDATE app_settings SET branch_id=$1 WHERE company_id=$2 AND branch_id IS NULL",[f.branches[2].id,f.companies[0].id])).rejects.toThrow("immutable");
 });
 it("rejects stale scope and parent versions and allows only one concurrent writer without losing sibling fields",async()=>{
  const f=await fixture(),first=ok(await f.owner.get("/api/settings"));
  const second=agent();ok(await second.post("/api/auth/login").send({email:f.users[0].email,password}));
  const attempts=await Promise.all([f.owner.patch("/api/settings").send(payload(first,{appearance:{theme:"dark"}})),
   second.patch("/api/settings").send(payload(first,{pos:{receiptCopies:2}}))]);
  expect(attempts.map(a=>a.status).sort()).toEqual([200,409]);
  let root=ok(await f.owner.get("/api/settings"));
  const url=`/api/settings?branchId=${f.branches[0].id}`,branch=ok(await f.owner.get(url));
  root=ok(await f.owner.patch("/api/settings").send(payload(root,{appearance:{color:"blue"}})));
  ok(await f.owner.patch(url).send(payload(branch,{appearance:{color:"green"}})),409);
  const fresh=ok(await f.owner.get(url));
  expect(fresh.scope.overrides.appearance).toEqual([]);
  expect((await rows("SELECT count(*)::int AS n FROM app_settings_versions WHERE company_id=$1",[f.companies[0].id]))[0].n).toBe(2);
 });
 it("honors explicit settings administration without a job-title role and revokes an open session immediately",async()=>{
  const f=await fixture();
  await rows("INSERT INTO company_administrators(company_id,user_id,responsibilities,active) VALUES($1,$2,ARRAY['settings'],true)",[f.companies[0].id,f.users[2].id]);
  const current=ok(await f.delegate.get("/api/settings"));expect(current.scope.canManage).toBe(true);
  ok(await f.delegate.patch("/api/settings").send(payload(current,{appearance:{theme:"light"}})));
  await rows("UPDATE company_administrators SET active=false WHERE company_id=$1 AND user_id=$2",[f.companies[0].id,f.users[2].id]);
  const after=ok(await f.delegate.get("/api/settings"));expect(after.scope.canManage).toBe(false);
  ok(await f.delegate.patch("/api/settings").send(payload(after,{appearance:{theme:"dark"}})),403);
 });
 it("rechecks settings authority after waiting behind the native authority writer fence",async()=>{
  const f=await fixture();
  await rows("INSERT INTO company_administrators(company_id,user_id,responsibilities,active) VALUES($1,$2,ARRAY['settings'],true)",[f.companies[0].id,f.users[2].id]);
  const current=ok(await f.delegate.get("/api/settings"));
  const blocker=await pool.connect();
  let committed=false;
  try{
   await blocker.query("BEGIN");await blocker.query("SELECT pg_advisory_xact_lock(174223,35)");
   const waiting=f.delegate.patch("/api/settings").send(payload(current,{appearance:{theme:"dark"}})).then(r=>r);
   let observed=false;
   for(let n=0;n<150;n++){
    const active=await rows("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event='advisory' AND query LIKE '%pg_advisory_xact_lock_shared(174223,35)%'");
    if(active.length){observed=true;break;}
    await new Promise(r=>setTimeout(r,20));
   }
   expect(observed).toBe(true);
   await blocker.query("UPDATE company_administrators SET active=false WHERE company_id=$1 AND user_id=$2",[f.companies[0].id,f.users[2].id]);
   await blocker.query("COMMIT");committed=true;
   ok(await waiting,403);
   expect((await rows("SELECT count(*)::int AS n FROM app_settings_versions WHERE company_id=$1",[f.companies[0].id]))[0].n).toBe(0);
  }finally{if(!committed)await blocker.query("ROLLBACK");blocker.release();}
 });
});
