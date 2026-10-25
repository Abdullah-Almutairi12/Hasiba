import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import request from "supertest";
import { db, pool } from "@workspace/db";
import { sql } from "drizzle-orm";
import app from "../app";
import { posTemplateFixture, accepted as ok, testActor, type PosTemplateFixture } from "../test/pos-template-fixture";
import { deviceBinding } from "../lib/pos-device-crypto";
import { teamRows } from "../lib/team-store";

type Device={id:string;privateKey:KeyObject;token?:string};
let f:PosTemplateFixture,device:Device,foreign:Device,person:any,other:any,foreignPerson:any,committedBody:any;
const pin="81367429";
const rows=(text:string,args:unknown[]=[])=>pool.query(text,args).then(r=>r.rows);
const keypair=()=>generateKeyPairSync("ec",{namedCurve:"prime256v1"});
async function register(branch:number,name="جهاز تجربة برمجية",stationName="نقطة اختبار"):Promise<Device>{
  const keys=keypair(),j=keys.publicKey.export({format:"jwk"});
  const result=ok(await f.owner.post("/api/pos-devices").send({name,branchId:branch,stationName,
    publicJwk:{kty:j.kty,crv:j.crv,x:j.x,y:j.y}}),201);
  return {id:result.id,privateKey:keys.privateKey};
}
async function proof(d:Device,purpose:"activate"|"unlock"|"request",path:string,body:unknown={},method="POST",privateKey=d.privateKey){
  const c=ok(await testActor().post("/api/pos-device/challenge").send({deviceId:d.id,purpose,binding:deviceBinding(method,path,body)}));
  return {id:c.id,nonce:c.nonce,signature:sign("sha256",Buffer.from(c.payload),
    {key:privateKey,dsaEncoding:"ieee-p1363"}).toString("base64url")};
}
async function activate(d:Device){
  const token=ok(await f.owner.post(`/api/pos-devices/${d.id}/activation`)).activationToken;
  const p=await proof(d,"activate","/api/pos-device/activate",{token});
  ok(await testActor().post("/api/pos-device/activate").send({deviceId:d.id,token,proof:p}));
}
async function unlock(d:Device,p=person,code=pin){
  const agent=testActor(),body={personId:p.personId,pin:code};
  const signed=await proof(d,"unlock","/api/pos-device/unlock",body);
  const response=await agent.post("/api/pos-device/unlock").send({deviceId:d.id,...body,proof:signed});
  return {agent,response};
}
async function call(agent:ReturnType<typeof testActor>,d:Device,method:"get"|"post",path:string,body:unknown={},grant=person.grants[0].id,key?:string){
  const signed=await proof(d,"request",`/api${path}`,body,method.toUpperCase());
  const req=agent[method](`/api${path}`).set("X-POS-Proof",Buffer.from(JSON.stringify(signed)).toString("base64url"))
    .set("X-Workspace-Responsibility",String(grant));
  if(key)req.set("Idempotency-Key",key);
  return method==="get"?req:req.send(body as object);
}
async function personWithoutEmail(branch:number,warehouse:number,name:string){
  const p=ok(await f.owner.post("/api/team/people").send({creationKey:randomUUID(),name,email:null,
    loginKinds:["pos"],deniedActions:[],grants:[{resource:"pos",branchId:branch,warehouseIds:[warehouse],
      actions:["pos.read","pos.sell","pos.shift.open"],amountLimit:"10",startsAt:new Date(Date.now()-60_000).toISOString(),endsAt:null}]}),201);
  ok(await f.owner.post(`/api/pos-devices/employees/${p.personId}/pin`).send({pin}));
  return p;
}
describe.sequential("POS device software proof and cashier-only identity",()=>{
  beforeAll(async()=>{
    f=await posTemplateFixture();
    person=await personWithoutEmail(f.branches[0].id,f.warehouses[0].id,"كاشير بلا بريد");
    other=await personWithoutEmail(f.branches[0].id,f.warehouses[0].id,"كاشير بديل");
    device=await register(f.branches[0].id);
    ok(await f.owner.post("/api/auth/switch-company").send({companyId:f.companies[1].id}));
    foreign=await register(f.branches[2].id);
    foreignPerson=await personWithoutEmail(f.branches[2].id,f.warehouses[2].id,"كاشير المنشأة الثانية");
    await activate(foreign);
    ok(await f.owner.post("/api/auth/switch-company").send({companyId:f.companies[0].id}));
  },60_000);
  it("binds activation to registered possession, purpose, expiry and one concurrent use; no fake email/password",async()=>{
    const identities=await rows(`SELECT u.email,u.password_hash,a.status FROM users u JOIN employee_access a ON a.user_id=u.id WHERE a.employee_id=$1`,[person.personId]);
    expect(identities).toEqual([{email:null,password_hash:null,status:"active"}]);
    const token=ok(await f.owner.post(`/api/pos-devices/${device.id}/activation`)).activationToken;
    const stolen=await proof(device,"activate","/api/pos-device/activate",{token},"POST",foreign.privateKey);
    ok(await testActor().post("/api/pos-device/activate").send({deviceId:device.id,token,proof:stolen}),403);
    const signed=await proof(device,"activate","/api/pos-device/activate",{token});
    const body={deviceId:device.id,token,proof:signed};
    const results=await Promise.all([testActor().post("/api/pos-device/activate").send(body),testActor().post("/api/pos-device/activate").send(body)]);
    expect(results.map(r=>r.status).sort()).toEqual([200,403]);
    ok(await testActor().post("/api/pos-device/activate").send(body),403);
    const fresh=ok(await f.owner.post(`/api/pos-devices/${device.id}/activation`)).activationToken;
    const expired=await proof(device,"activate","/api/pos-device/activate",{token:fresh});
    await rows("UPDATE pos_device_challenges SET expires_at=now()-interval '1 second' WHERE id=$1",[expired.id]);
    ok(await testActor().post("/api/pos-device/activate").send({deviceId:device.id,token:fresh,proof:expired}),403);
    const expiredTokenProof=await proof(device,"activate","/api/pos-device/activate",{token:fresh});
    await rows("UPDATE pos_devices SET activation_expires_at=now()-interval '1 second' WHERE id=$1",[device.id]);
    ok(await testActor().post("/api/pos-device/activate").send({deviceId:device.id,token:fresh,proof:expiredTokenProof}),403);
    const oldPurpose=await proof(device,"activate","/api/pos-device/activate",{token:fresh});
    ok(await testActor().post("/api/pos-device/unlock").send({deviceId:device.id,personId:person.personId,pin,proof:oldPurpose}),403);
    ok(await f.owner.post(`/api/pos-devices/${device.id}/revoke`));
    ok(await testActor().post("/api/pos-device/activate").send({deviceId:device.id,token:fresh,proof:oldPurpose}),403);
    await activate(device);
    const roster=ok(await f.owner.get("/api/pos-devices"));
    expect(roster.find((d:any)=>d.id===device.id).history.some((a:any)=>a.action==="pos.device.activated")).toBe(true);
    ok(await f.owner.post(`/api/pos-devices/${foreign.id}/revoke`),404);
  });
  it("requires a fresh key proof per request, binds query/body, isolates platform and company, and rotates cashier session",async()=>{
    const first=await unlock(device);ok(first.response);
    ok(await first.agent.get("/api/auth/me"),403);
    const me=ok(await call(first.agent,device,"get","/auth/me"));
    expect(me.email).toBeNull();expect(me.role).toBe("scoped");expect(me.companies).toEqual([]);
    for(const path of ["/users","/team/people","/pos-devices","/workspace/inventory","/auth/switch-company"])
      ok(await first.agent.get(`/api${path}`),403);
    ok(await first.agent.post("/api/auth/login").send({email:f.ownerUser.email,password:pin}),403);
    ok((await unlock(foreign,person)).response,403);
    const otherCompany=await unlock(foreign,foreignPerson);ok(otherCompany.response);
    expect(ok(await call(otherCompany.agent,foreign,"get","/auth/me",{},foreignPerson.grants[0].id)).companyId).toBe(f.companies[1].id);
    ok(await call(otherCompany.agent,foreign,"get","/products",{},person.grants[0].id),403);
    const p=await proof(device,"request","/api/products?search=allowed",{},"GET");
    ok(await first.agent.get("/api/products?search=changed").set("X-POS-Proof",Buffer.from(JSON.stringify(p)).toString("base64url")),403);
    const second=await unlock(device,other);ok(second.response);
    const otherMe=ok(await call(second.agent,device,"get","/auth/me",{},other.grants[0].id));
    expect(otherMe.id).not.toBe(me.id);expect(otherMe.name).toBe("كاشير بديل");
    // Unlock on the same cookie must rotate it; no inherited actor on switch.
    ok(await second.agent.post("/api/pos-device/lock"));
    ok(await second.agent.get("/api/auth/me"),401);
  });
  it("persists PIN attempt protection and invalidates open sessions on reset without changing platform password",async()=>{
    const active=await unlock(device);ok(active.response);
    for(let i=0;i<5;i++)ok((await unlock(device,person,"81367420")).response,403);
    ok((await unlock(device)).response,403);
    const [p]=await rows("SELECT failures,locked_until>now() AS blocked FROM pos_employee_credentials WHERE employee_id=$1",[person.personId]);
    expect(p.failures).toBe(5);expect(p.blocked).toBe(true);
    ok(await f.owner.post(`/api/pos-devices/employees/${person.personId}/pin`).send({pin}));
    ok(await call(active.agent,device,"get","/auth/me"),403);
    ok((await unlock(device)).response);
  });
  it("sells once at server limit, refuses foreign branch/grant, revokes live device yet a new authorized reader recovers exactly the committed result",async()=>{
    const cashier=await unlock(device);ok(cashier.response);
    const shift=ok(await call(cashier.agent,device,"post","/pos/sessions",{branchId:f.branches[0].id,openingCash:0,cashierName:"كاشير بلا بريد"}),201);
    const body={sessionId:shift.id,paymentMethod:"cash",discount:0,items:[{productId:f.products[0].id,quantity:1,unitPrice:0.01}]};
    committedBody=body;
    const differentStation=await register(f.branches[0].id,"جهاز نقطة أخرى","نقطة مختلفة");
    await activate(differentStation);
    const wrongStation=await unlock(differentStation);ok(wrongStation.response);
    ok(await call(wrongStation.agent,differentStation,"post","/pos/orders",body,person.grants[0].id,randomUUID()),403);
    const key=randomUUID();
    const sale=ok(await call(cashier.agent,device,"post","/pos/orders",body,person.grants[0].id,key),201);
    expect(Number(sale.total)).toBe(10);
    ok(await call(cashier.agent,device,"post","/pos/orders",{...body,items:[{...body.items[0],quantity:2}]},person.grants[0].id,randomUUID()),403);
    ok(await call(cashier.agent,device,"post","/pos/sessions",{branchId:f.branches[1].id,openingCash:0,cashierName:"غير مصرح"}),403);
    const before=await rows(`SELECT (SELECT count(*)::int FROM customer_invoices WHERE company_id=$1) invoices,
      (SELECT count(*)::int FROM stock_moves WHERE product_id=$2) moves,
      (SELECT count(*)::int FROM journal_entries WHERE company_id=$1) journals`,[f.companies[0].id,f.products[0].id]);
    ok(await f.owner.post(`/api/pos-devices/${device.id}/revoke`));
    ok(await cashier.agent.post("/api/pos/orders").set("Idempotency-Key",key).send(body),403);
    const reader=await register(f.branches[0].id,"جهاز قارئ بديل مصرح");
    await activate(reader);
    const authorized=await unlock(reader);ok(authorized.response);
    const replay=await call(authorized.agent,reader,"post","/pos/orders",body,person.grants[0].id,key);
    expect(replay.headers["idempotency-replayed"]).toBe("true");expect(ok(replay,201).id).toBe(sale.id);
    expect(await rows(`SELECT (SELECT count(*)::int FROM customer_invoices WHERE company_id=$1) invoices,
      (SELECT count(*)::int FROM stock_moves WHERE product_id=$2) moves,
      (SELECT count(*)::int FROM journal_entries WHERE company_id=$1) journals`,[f.companies[0].id,f.products[0].id])).toEqual(before);
    expect((await rows(`SELECT count(*)::int n FROM journal_entries j WHERE company_id=$1 AND
      (SELECT coalesce(sum(l.debit-l.credit),0) FROM journal_entry_lines l WHERE entry_id=j.id)<>0`,[f.companies[0].id]))[0].n).toBe(0);
    expect((await rows("SELECT quantity::text FROM stock_quants WHERE product_id=$1 AND warehouse_id=$2",[f.products[0].id,f.warehouses[0].id]))[0].quantity).toBe("19.0000");
    device=reader;
  });
  it("denies suspended membership and revoked responsibility during an open session and a request waiting at the authority fence",async()=>{
    const cashier=await unlock(device);ok(cashier.response);
    const p=await proof(device,"request","/api/pos/sessions",{branchId:f.branches[0].id,openingCash:0,cashierName:"مؤجل"});
    const writer=await pool.connect();
    try{
      await writer.query("BEGIN");await writer.query("SELECT pg_advisory_xact_lock(174223,35)");
      const pending=cashier.agent.post("/api/pos/sessions")
        .set("X-POS-Proof",Buffer.from(JSON.stringify(p)).toString("base64url"))
        .set("X-Workspace-Responsibility",String(person.grants[0].id))
        .send({branchId:f.branches[0].id,openingCash:0,cashierName:"مؤجل"}).then(r=>r);
      let waiting=false;
      for(let i=0;i<100;i++){
        if((await rows("SELECT count(*)::int n FROM pg_locks WHERE locktype='advisory' AND NOT granted"))[0].n){waiting=true;break;}
        await new Promise(r=>setTimeout(r,10));
      }
      expect(waiting).toBe(true);
      await writer.query("UPDATE employee_access SET status='suspended' WHERE employee_id=$1",[person.personId]);
      await writer.query("COMMIT");
      ok(await pending,403);
      ok(await call(cashier.agent,device,"get","/auth/me"),403);
      await rows("UPDATE employee_access SET status='active' WHERE employee_id=$1",[person.personId]);
      await rows("UPDATE responsibility_grants SET actions=ARRAY['pos.read'] WHERE employee_id=$1",[person.personId]);
      ok(await call(cashier.agent,device,"post","/pos/orders",committedBody,person.grants[0].id,randomUUID()),403);
    } finally {await writer.query("ROLLBACK");writer.release();}
  });
});
