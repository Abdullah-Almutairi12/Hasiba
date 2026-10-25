import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import request from "supertest";
import { db, pool } from "@workspace/db";
import { sql } from "drizzle-orm";
import app from "../app";
import { posTemplateFixture, accepted as ok, testActor, type PosTemplateFixture } from "../test/pos-template-fixture";
import { deviceBinding } from "../lib/pos-device-crypto";
import { teamRows } from "../lib/team-store";
import {hashAccountPassword} from "../lib/account-password";

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
  const c=ok(await testActor().post("/api/pos-device/challenge").send(purpose==="unlock"
    ? {deviceId:d.id,purpose,personId:(body as {personId:number}).personId}
    : {deviceId:d.id,purpose,binding:deviceBinding(method,path,body)}));
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
  // PIN enrollment creates the login identity; the pre-enrollment DTO has null userId.
  return {...p,userId:(await rows("SELECT user_id FROM employee_access WHERE employee_id=$1",[p.personId]))[0].user_id};
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
    const shiftBody={branchId:f.branches[0].id,openingCash:0,cashierName:"غير قابل للتبديل"};
    const shiftProof=await proof(device,"request","/api/pos/sessions",shiftBody);
    ok(await first.agent.post("/api/pos/sessions").set("X-POS-Proof",Buffer.from(JSON.stringify(shiftProof)).toString("base64url"))
      .set("X-Workspace-Responsibility",String(person.grants[0].id)).send({...shiftBody,openingCash:1}),403);
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
  it("issues an unlock challenge from public person identity only, never a PIN verifier",async()=>{
    const response=await testActor().post("/api/pos-device/challenge").send({
      deviceId:device.id,purpose:"unlock",personId:person.personId});
    const challenge=ok(response);
    const stored=await rows("SELECT binding FROM pos_device_challenges WHERE id=$1",[challenge.id]);
    const oldVerifier=deviceBinding("POST","/api/pos-device/unlock",{personId:person.personId,pin});
    expect(JSON.stringify({challenge,stored})).not.toContain(oldVerifier);
    ok(await testActor().post("/api/pos-device/challenge").send({
      deviceId:device.id,purpose:"unlock",binding:oldVerifier}),400);
    const wrongKey=await proof(device,"unlock","/api/pos-device/unlock",{personId:person.personId},"POST",foreign.privateKey);
    ok(await testActor().post("/api/pos-device/unlock").send({deviceId:device.id,personId:person.personId,pin,proof:wrongKey}),403);
    const signed=await proof(device,"unlock","/api/pos-device/unlock",{personId:person.personId});
    ok(await testActor().post("/api/pos-device/unlock").send({deviceId:device.id,personId:other.personId,pin,proof:signed}),403);
    const body={deviceId:device.id,personId:person.personId,pin,proof:signed};
    ok(await testActor().post("/api/pos-device/unlock").send(body));
    ok(await testActor().post("/api/pos-device/unlock").send(body),403);
    const [record]=await rows("SELECT binding FROM pos_device_challenges WHERE id=$1",[signed.id]);
    expect(record.binding).toBe(deviceBinding("POST","/api/pos-device/unlock",{personId:person.personId}));
    expect(record.binding).not.toBe(oldVerifier);
  });
  it("sells once at server limit, refuses foreign branch/grant, revokes live device yet a new authorized reader recovers exactly the committed result",async()=>{
    const cashier=await unlock(device);ok(cashier.response);
    const shift=ok(await call(cashier.agent,device,"post","/pos/sessions",{branchId:f.branches[0].id,openingCash:0,cashierName:"كاشير بلا بريد"}),201);
    const body={sessionId:shift.id,paymentMethod:"cash",discount:0,items:[{productId:f.products[0].id,quantity:1,unitPrice:0.01}]};
    committedBody=body;
    const otherCashier=await unlock(device,other);ok(otherCashier.response);
    expect(ok(await call(otherCashier.agent,device,"get","/pos/sessions",{},other.grants[0].id))).toEqual([]);
    ok(await call(otherCashier.agent,device,"post","/pos/orders",body,other.grants[0].id,randomUUID()),403);
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
  it("filters company, station and cashier in SQL before the twenty-shift result limit",async()=>{
    const cashier=await unlock(device);ok(cashier.response);
    const shift=ok(await call(cashier.agent,device,"post","/pos/sessions",
      {branchId:f.branches[0].id,openingCash:0,cashierName:"موظفي"}),201);
    await rows(`INSERT INTO pos_sessions(branch_id,session_number,cashier_name,opened_at,cashier_user_id,pos_station_id)
      SELECT $1,'other-'||gen_random_uuid(),'موظف آخر',now()+interval '1 minute',$2,NULL FROM generate_series(1,25)`,
      [f.branches[0].id,other.userId]);
    const visible=ok(await call(cashier.agent,device,"get","/pos/sessions"));
    expect(visible.some((s:any)=>s.id===shift.id)).toBe(true);
    expect(visible.every((s:any)=>s.cashierUserId===person.userId && s.posStationId===shift.posStationId)).toBe(true);
  });
  it("routes granted device close actions to the existing authority service, without implicit approval or configuration",async()=>{
    const cashier=await unlock(device);ok(cashier.response);
    await rows("UPDATE responsibility_grants SET actions=array_append(actions,'pos.shift.close') WHERE id=$1",[person.grants[0].id]);
    const shift=ok(await call(cashier.agent,device,"post","/pos/sessions",
      {branchId:f.branches[0].id,openingCash:0,cashierName:"وردية إقفال"}),201);
    const peer=ok(await call((await unlock(device,other)).agent,device,"post","/pos/sessions",
      {branchId:f.branches[0].id,openingCash:0,cashierName:"وردية زميل"},other.grants[0].id),201);
    ok(await call(cashier.agent,device,"post","/pos/returns/actions",
      {action:"close",payload:{sessionId:peer.id,counted:0,unresolvedSalesCleared:true}}),403);
    const workspace=ok(await call(cashier.agent,device,"get","/pos/returns/workspace"));
    expect(workspace.sessions.some((s:any)=>Number(s.id)===peer.id)).toBe(false);
    expect(workspace.sessions.some((s:any)=>Number(s.id)===shift.id)).toBe(true);
    const body={action:"close",payload:{sessionId:shift.id,counted:0,unresolvedSalesCleared:true}};
    ok(await call(cashier.agent,device,"post","/pos/returns/actions",body));
    ok(await call(cashier.agent,device,"post","/pos/returns/actions",body));
    for(const action of ["approve_close","configure_policy","configure_access"])
      ok(await call(cashier.agent,device,"post","/pos/returns/actions",{action,payload:{sessionId:shift.id}}),403);
    await rows("UPDATE responsibility_grants SET actions=array_remove(actions,'pos.shift.close') WHERE id=$1",[person.grants[0].id]);
    ok(await call(cashier.agent,device,"post","/pos/returns/actions",body),403);
  });
  it("supports a device return request only with its live grant, retaining separate review, receipt and payout authorities and replay evidence",async()=>{
    const cashier=await unlock(device);ok(cashier.response);
    const workspace=ok(await call(cashier.agent,device,"get","/pos/returns/workspace"));
    const invoice=workspace.invoices[0];
    const payload={customerId:invoice.customer_id,invoiceId:invoice.id,warehouseId:f.warehouses[0].id,
      restock:true,goodsReceived:false,disposition:"resale",settlementMethod:"cash",proofRef:"دليل معزول",
      reason:"طلب مرتجع من جهاز",lines:[{invoiceLineId:invoice.lines[0].id,productId:f.products[0].id,
        description:"منتج",quantity:1,unitPrice:10,taxRate:0}],idempotencyKey:randomUUID()};
    const action={action:"request",payload};
    ok(await call(cashier.agent,device,"post","/pos/returns/actions",action),403);
    await rows("UPDATE responsibility_grants SET actions=array_append(actions,'pos.return.request') WHERE id=$1",[person.grants[0].id]);
    // An explicit company-level financial ceiling is still required; device
    // routing and a grant must not bypass the independent policy's default zero.
    ok(await f.owner.post("/api/workflow/financial-limits").send({role:"scoped",actionKey:"sales.credit_note_amount",maxValue:10}));
    const note=ok(await call(cashier.agent,device,"post","/pos/returns/actions",action),202);
    const snapshot=()=>rows(`SELECT (SELECT count(*)::int FROM credit_notes WHERE company_id=$1) notes,
      (SELECT count(*)::int FROM stock_moves WHERE product_id=$2) moves,
      (SELECT count(*)::int FROM journal_entries WHERE company_id=$1) journals,
      (SELECT count(*)::int FROM return_payouts WHERE company_id=$1) payouts`,[f.companies[0].id,f.products[0].id]);
    const before=await snapshot();
    const replay=await call(cashier.agent,device,"post","/pos/returns/actions",action);
    expect(ok(replay,202).id).toBe(note.id);
    expect(await snapshot()).toEqual(before);
    for(const [action,payload] of [
      ["approve",{noteId:note.id,comment:"لا صلاحية اعتماد"}],
      ["receive",{noteId:note.id,reference:"لا صلاحية استلام"}],
      ["payout",{noteId:note.id,receiptId:invoice.receipts[0].id,sessionId:committedBody.sessionId,
        amount:10,method:"cash",reference:"لا صلاحية صرف",idempotencyKey:randomUUID()}],
    ] as const) ok(await call(cashier.agent,device,"post","/pos/returns/actions",{action,payload}),403);
    expect(await snapshot()).toEqual(before);
    await rows("UPDATE responsibility_grants SET actions=array_remove(actions,'pos.return.request') WHERE id=$1",[person.grants[0].id]);
    ok(await call(cashier.agent,device,"post","/pos/returns/actions",{action:"request",payload:{...payload,idempotencyKey:randomUUID()}}),403);
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
  it("does not present optional factor availability or a checklist percentage as company-wide compliance evidence",async()=>{
    const checklist=ok(await f.owner.get("/api/security/checklist"));
    expect(checklist.items.find((item:any)=>item.key==="2fa").status).toBe("warning");
    expect(checklist.ncaCompliant).toBe(false);
  });
  it("keeps a dual-credential cashier device and PIN separate when that identity changes its platform password",async()=>{
    const both=await personWithoutEmail(f.branches[0].id,f.warehouses[0].id,"كاشير توافق مصطنع");
    // A historical dual-credential identity, created only in this disposable DB.
    const email=`dual-${randomUUID()}@example.invalid`,password="Synthetic dual platform phrase 2026!";
    await rows("UPDATE users SET email=$1,password_hash=$2 WHERE id=$3",[email,await hashAccountPassword(password),both.userId]);
    const d=await register(f.branches[0].id);await activate(d);
    const cashier=await unlock(d,both);ok(cashier.response);
    const before=(await rows("SELECT pin_hash FROM pos_employee_credentials WHERE employee_id=$1",[both.personId]))[0];
    const platform=testActor(),otherPlatform=testActor();
    ok(await platform.post("/api/auth/login").send({email,password}));
    ok(await otherPlatform.post("/api/auth/login").send({email,password}));
    ok(await platform.post("/api/auth/security/password").send({currentPassword:password,newPassword:"New synthetic dual platform phrase 2026!"}));
    ok(await otherPlatform.get("/api/auth/me"),401);
    expect(ok(await call(cashier.agent,d,"get","/auth/me",{},both.grants[0].id)).posDevice).toBe(true);
    const after=(await rows("SELECT pin_hash FROM pos_employee_credentials WHERE employee_id=$1",[both.personId]))[0];
    expect(before.pin_hash===after.pin_hash).toBe(true);
    ok(await call(cashier.agent,d,"get","/auth/security",{},both.grants[0].id),403);
    await rows("UPDATE employee_access SET status='suspended' WHERE employee_id=$1",[both.personId]);
    ok(await call(cashier.agent,d,"get","/auth/me",{},both.grants[0].id),403);
  });
});
