import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { accepted as ok, posTemplateFixture, fixtureRows as rows, personInput, testActor, type PosTemplateFixture } from "../test/pos-template-fixture";

let f: PosTemplateFixture;
const path="/api/pos/sessions";
const body=(branchId=f.branches[0].id,openingCash=125.50)=>({branchId,openingCash,cashierName:"هوية مزورة من المتصفح"});
const scoped=(index=0)=>f.actors[index].post(path).set("X-Workspace-Responsibility",String(f.people[index].grants[0].id));
const counts=()=>rows(`SELECT (SELECT count(*)::int FROM pos_sessions) sessions,
  (SELECT count(*)::int FROM pos_orders) orders,(SELECT count(*)::int FROM customer_invoices) invoices,
  (SELECT count(*)::int FROM journal_entries) journals,(SELECT count(*)::int FROM stock_moves) moves`);
describe.sequential("native shift-opening scope, cash and durable request authority",()=>{
  beforeAll(async()=>{f=await posTemplateFixture();},60000);
  it("lists only active current-company branches for an unbound owner, without rebinding the account",async()=>{
    const before=await rows("SELECT branch_id FROM users WHERE id=$1",[f.ownerUser.id]);
    expect(before[0].branch_id).toBeNull();
    expect(ok(await f.owner.get("/api/pos/session-branches")).map((b:any)=>b.id)).toEqual(f.branches.slice(0,2).map(b=>b.id));
    expect(await rows("SELECT branch_id FROM users WHERE id=$1",[f.ownerUser.id])).toEqual(before);
  });
  it("restricts the picker and opening to the selected POS grant, not another responsibility or company",async()=>{
    const grant=f.people[0].grants[0];
    const get=(id:number)=>f.actors[0].get("/api/pos/session-branches").set("X-Workspace-Responsibility",String(id));
    expect(ok(await get(grant.id)).map((b:any)=>b.id)).toEqual([f.branches[0].id]);
    ok(await get(f.people[0].grants[1].id),403);
    ok(await scoped().send(body(f.branches[1].id)),403);
    ok(await scoped().send(body(f.branches[2].id)),403);
    ok(await f.owner.post(path).send(body(f.branches[2].id)),404);
  });
  it("keeps a legacy cashier branch-bound and denies an unprivileged account without rebinding either",async()=>{
    for(const role of ["cashier","auditor"]){
      const email=`shift-${role}-${randomUUID()}@example.invalid`;
      const [u]=await rows(`INSERT INTO users(name,email,password_hash,role,branch_id)
        VALUES($1,$2,$3,$4,$5) RETURNING id`,[role,email,f.ownerUser.passwordHash,role,f.branches[0].id]);
      await rows("INSERT INTO user_companies(user_id,company_id,role,is_default) VALUES($1,$2,$3,true)",[u.id,f.companies[0].id,role]);
      const a=testActor();ok(await a.post("/api/auth/login").send({email,password:f.password}));
      if(role==="cashier"){
        expect(ok(await a.get("/api/pos/session-branches")).map((b:any)=>b.id)).toEqual([f.branches[0].id]);
        const opened=ok(await a.post(path).set("Idempotency-Key",randomUUID()).send(body()),201);
        expect(opened.cashierUserId).toBe(u.id);
        ok(await a.post(path).send(body(f.branches[1].id)),403);
      }else{
        ok(await a.get("/api/pos/session-branches"),403);ok(await a.post(path).send(body()),403);
      }
    }
  });
  it("freezes the selected branch/cash under one key, canonicalizes the actor and serializes repeated opening",async()=>{
    const before=(await counts())[0],key=randomUUID(),input=body();
    const results=await Promise.all([1,2,3].map(()=>f.owner.post(path).set("Idempotency-Key",key).send(input)));
    for(const r of results)ok(r,201);
    expect(new Set(results.map(r=>r.body.id)).size).toBe(1);
    const saved=results[0].body;
    expect(saved.cashierUserId).toBe(f.ownerUser.id);
    expect(saved.cashierName).toBe(f.ownerUser.name);
    expect(saved.cashierName).not.toBe(input.cashierName);
    expect((await rows("SELECT opening_cash::text cash FROM pos_sessions WHERE id=$1",[saved.id]))[0].cash).toBe("125.50");
    const replay=await f.owner.post(path).set("Idempotency-Key",key).send(input);
    ok(replay,201);expect(replay.headers["idempotency-replayed"]).toBe("true");
    expect(replay.body).toEqual(saved);
    ok(await f.owner.post(path).set("Idempotency-Key",key).send({...input,openingCash:126}),409);
    const after=(await counts())[0];
    expect(after).toEqual({...before,sessions:before.sessions+1});
  });
  it.each([-1,0.001,100000000,"bad",null])("rejects invalid cash %s atomically",async(value)=>{
    const before=await counts();
    ok(await f.owner.post(path).set("Idempotency-Key",randomUUID()).send({...body(),openingCash:value}),400);
    expect(await counts()).toEqual(before);
  });
  it("accepts zero and a legitimate two-decimal amount, and refuses an inactive branch",async()=>{
    ok(await f.owner.post(path).set("Idempotency-Key",randomUUID()).send(body(f.branches[1].id,0)),201);
    ok(await f.owner.post(path).set("Idempotency-Key",randomUUID()).send(body(f.branches[1].id,0.29)),201);
    await rows("UPDATE branches SET is_active=false WHERE id=$1",[f.branches[1].id]);
    expect(ok(await f.owner.get("/api/pos/session-branches")).map((b:any)=>b.id)).toEqual([f.branches[0].id]);
    ok(await f.owner.post(path).set("Idempotency-Key",randomUUID()).send(body(f.branches[1].id)),404);
    await rows("UPDATE branches SET is_active=true WHERE id=$1",[f.branches[1].id]);
  });
  it("does not infer shift-open from read, and retains source-read replay after explicit open revocation",async()=>{
    const key=randomUUID(),input=body();
    const saved=ok(await scoped().set("Idempotency-Key",key).send(input),201);
    let person=ok(await f.owner.get("/api/team/people")).find((p:any)=>p.personId===f.people[0].personId);
    const next=personInput(person);
    const updated=ok(await f.owner.put(`/api/team/people/${person.personId}/access`).send({
      expectedRevision:person.revision,suspended:false,
      person:{...next,grants:next.grants.map((g:any)=>g.resource==="pos"?{...g,templateMode:"override",actions:["pos.read"]}:g)},
    }));
    updated.grants.sort((a:any,b:any)=>Number(b.resource==="pos")-Number(a.resource==="pos"));
    f.people[0]=updated;
    ok(await f.actors[0].get("/api/pos/session-branches").set("X-Workspace-Responsibility",String(f.people[0].grants[0].id)),403);
    ok(await scoped().set("Idempotency-Key",randomUUID()).send(input),403);
    const replay=await scoped().set("Idempotency-Key",key).send(input);
    ok(replay,201);expect(replay.body.id).toBe(saved.id);
    await rows("UPDATE responsibility_grants SET revoked_at=now() WHERE id=$1",[f.people[0].grants[0].id]);
    ok(await scoped().set("Idempotency-Key",key).send(input),403);
  });
  it("rechecks a delayed opener after the actual PostgreSQL authority fence and revocation",async()=>{
    const c=await pool.connect(),before=await counts(),key=randomUUID();
    try{
      await c.query("BEGIN");
      await c.query("SELECT pg_advisory_xact_lock(174223,35)");
      const request=scoped(1).set("Idempotency-Key",key).send(body()).then(r=>r);
      let waiting=false;
      for(let i=0;i<100;i++){
        const r=await rows(`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory'
          AND classid=174223 AND objid=35 AND NOT granted) waiting`);
        if(r[0].waiting){waiting=true;break;}
        await new Promise(r=>setTimeout(r,15));
      }
      expect(waiting).toBe(true);
      await c.query("UPDATE responsibility_grants SET revoked_at=now() WHERE id=$1",[f.people[1].grants[0].id]);
      await c.query("COMMIT");
      ok(await request,403);
      expect(await counts()).toEqual(before);
      expect(await rows("SELECT request_key FROM financial_requests WHERE request_key=$1",[key])).toEqual([]);
    }finally{await c.query("ROLLBACK");c.release();}
  });
});
