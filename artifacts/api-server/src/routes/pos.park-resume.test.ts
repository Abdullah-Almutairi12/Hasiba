import { cleanupCompanyDefaults } from "../test/cleanup-company-defaults";
/**
 * Order Parking (hold/resume) HTTP integration tests. Boots the real
 * Express app and asserts:
 *   - park endpoint creates a `status='parked'` row with no payment
 *     trigger violation (parked rows skip pos_order_payments).
 *   - list endpoint is session AND tenant scoped.
 *   - resume returns the snapshot, deletes the row, and a second
 *     resume returns 404 (atomic).
 *   - cross-tenant: tenant B cannot park into A's session, cannot
 *     list A's parked rows, cannot resume A's parked row.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { eq, inArray, sql } from "drizzle-orm";
import {
  db,
  pool,
  financialRequestsTable,
  companiesTable,
  usersTable,
  userCompaniesTable,
  categoriesTable,
  productsTable,
  branchesTable,
  posSessionsTable,
  posOrdersTable,
  auditLogsTable,
  warehousesTable,
} from "@workspace/db";
import app from "../app";

const RUN_TAG = `vitest-park-${Date.now()}`;
const PASSWORD = "Test1234!";

let companyAId = 0;
let companyBId = 0;
let userAId = 0;
let userBId = 0;
let categoryId = 0;
let productAId = 0;
let branchAId = 0;
let branchBId = 0;
let sessionAId = 0;
let sessionBId = 0;

let agentA: request.Agent;
let agentB: request.Agent;

beforeAll(async () => {
  const [a] = await db
    .insert(companiesTable)
    .values({ name: `Park Co A ${RUN_TAG}`, baseCurrency: "SAR" })
    .returning();
  const [b] = await db
    .insert(companiesTable)
    .values({ name: `Park Co B ${RUN_TAG}`, baseCurrency: "SAR" })
    .returning();
  companyAId = a.id;
  companyBId = b.id;

  const hash = await bcrypt.hash(PASSWORD, 4);
  const [uA] = await db
    .insert(usersTable)
    .values({
      name: `Park U A ${RUN_TAG}`,
      email: `park-a-${RUN_TAG}@test.local`,
      passwordHash: hash,
      role: "owner",
      isActive: true,
    })
    .returning();
  const [uB] = await db
    .insert(usersTable)
    .values({
      name: `Park U B ${RUN_TAG}`,
      email: `park-b-${RUN_TAG}@test.local`,
      passwordHash: hash,
      role: "owner",
      isActive: true,
    })
    .returning();
  userAId = uA.id;
  userBId = uB.id;

  await db.insert(userCompaniesTable).values([
    { userId: userAId, companyId: companyAId, role: "owner", isDefault: true },
    { userId: userBId, companyId: companyBId, role: "owner", isDefault: true },
  ]);

  const [cat] = await db
    .insert(categoriesTable)
    .values({ name: `Park Cat ${RUN_TAG}`, nameAr: `فئة ${RUN_TAG}` })
    .returning();
  categoryId = cat.id;

  const [pA] = await db
    .insert(productsTable)
    .values({
      name: `Park Prod ${RUN_TAG}`,
      nameAr: `منتج ${RUN_TAG}`,
      sku: `PARK-SKU-${RUN_TAG}`,
      categoryId,
      price: "30.00",
      costPrice: "10.00",
      companyId: companyAId,
    })
    .returning();
  productAId = pA.id;

  const [brA] = await db
    .insert(branchesTable)
    .values({
      name: `Park Br A ${RUN_TAG}`,
      nameAr: `فرع A ${RUN_TAG}`,
      city: "Riyadh",
      companyId: companyAId,
    })
    .returning();
  const [brB] = await db
    .insert(branchesTable)
    .values({
      name: `Park Br B ${RUN_TAG}`,
      nameAr: `فرع B ${RUN_TAG}`,
      city: "Jeddah",
      companyId: companyBId,
    })
    .returning();
  branchAId = brA.id;
  branchBId = brB.id;

  const [sA] = await db
    .insert(posSessionsTable)
    .values({
      sessionNumber: `PARK-POS-A-${RUN_TAG}`,
      branchId: branchAId,
      cashierName: "A",
    })
    .returning();
  const [sB] = await db
    .insert(posSessionsTable)
    .values({
      sessionNumber: `PARK-POS-B-${RUN_TAG}`,
      branchId: branchBId,
      cashierName: "B",
    })
    .returning();
  sessionAId = sA.id;
  sessionBId = sB.id;

  agentA = request.agent(app);
  agentB = request.agent(app);
  const lA = await agentA
    .post("/api/auth/login")
    .send({ email: `park-a-${RUN_TAG}@test.local`, password: PASSWORD });
  const lB = await agentB
    .post("/api/auth/login")
    .send({ email: `park-b-${RUN_TAG}@test.local`, password: PASSWORD });
  if (lA.status !== 200 || lB.status !== 200) {
    throw new Error(
      `login failed A=${lA.status} B=${lB.status} ${JSON.stringify(lA.body)} ${JSON.stringify(lB.body)}`,
    );
  }
});

afterAll(async () => {
  // Clear any parked rows + sessions + branches for both tenants
  const brIds = [branchAId, branchBId].filter((n) => n > 0);
  if (brIds.length > 0) {
    // Sweep ALL sessions (including the extra one created mid-suite for
    // the cross-session resume test) so the branches FK can drop cleanly.
    const sessRows = await db
      .select({ id: posSessionsTable.id })
      .from(posSessionsTable)
      .where(inArray(posSessionsTable.branchId, brIds));
    const sIds = sessRows.map((r) => r.id);
    if (sIds.length > 0) {
      await db
        .delete(posOrdersTable)
        .where(inArray(posOrdersTable.sessionId, sIds));
      await db
        .delete(posSessionsTable)
        .where(inArray(posSessionsTable.id, sIds));
    }
    await db.delete(branchesTable).where(inArray(branchesTable.id, brIds));
  }
  if (productAId) await db.delete(productsTable).where(eq(productsTable.id, productAId));
  if (categoryId) await db.delete(categoriesTable).where(eq(categoriesTable.id, categoryId));
  const uids = [userAId, userBId].filter((n) => n > 0);
  if(uids.length)await db.delete(financialRequestsTable).where(inArray(financialRequestsTable.userId,uids));
  if (uids.length > 0) {
    await db.delete(userCompaniesTable).where(inArray(userCompaniesTable.userId, uids));
    await db.delete(usersTable).where(inArray(usersTable.id, uids));
  }
  const coIds = [companyAId, companyBId].filter((n) => n > 0);
  if (coIds.length > 0) {
    await db.delete(auditLogsTable).where(inArray(auditLogsTable.companyId, coIds));
    await db.delete(warehousesTable).where(inArray(warehousesTable.companyId, coIds));
    await cleanupCompanyDefaults(coIds);
    await db.delete(companiesTable).where(inArray(companiesTable.id, coIds));
  }
});

describe("durable parking receipts on PostgreSQL",()=>{
  it.each(["close-first","execute-first"] as const)("serializes park/resolve %s on the same PostgreSQL lock",async order=>{
    const key=randomUUID(),body=parkBody({sessionId:sessionAId,label:`race-${order}`});
    const connection=await pool.connect();
    const execute=()=>agentA.post("/api/pos/orders/park").set("Idempotency-Key",key).send(body).then(r=>r);
    const resolve=()=>agentA.post("/api/pos/orders/park/resolve").send({requestKey:key,body}).then(r=>r);
    let first!:Promise<request.Response>,second!:Promise<request.Response>;
    async function waitFor(n:number,holder:number){
      const end=Date.now()+5000;
      while(Date.now()<end){
        const result=await connection.query(`SELECT count(*)::int AS n FROM pg_locks w JOIN pg_locks h
          ON w.locktype=h.locktype AND w.database=h.database AND w.classid=h.classid AND w.objid=h.objid AND w.objsubid=h.objsubid
          WHERE h.pid=$1 AND h.locktype='advisory' AND h.granted AND NOT w.granted`,[holder]);
        if(result.rows[0].n===n)return;
        await new Promise(r=>setTimeout(r,10));
      }
      throw Error(`Expected ${n} actual PostgreSQL waiters`);
    }
    try{
      await connection.query("BEGIN");
      const holder=(await connection.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      await connection.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [JSON.stringify([companyAId,userAId,"POST:/api:/pos/orders/park",key])]);
      first=order==="close-first"?resolve():execute();await waitFor(1,holder);
      second=order==="close-first"?execute():resolve();await waitFor(2,holder);
    }finally{await connection.query("COMMIT");connection.release();await Promise.allSettled([first,second]);}
    const [a,b]=await Promise.all([first,second]);
    if(order==="close-first"){
      expect(a.body).toEqual({state:"closed_without_execution",requestId:key});
      expect(b.status).toBe(409);
      expect((await execute()).status).toBe(409); // valid delayed original is permanently fenced
    }else{
      expect(a.status).toBe(201);
      expect(b.body).toEqual({state:"completed",result:a.body});
      expect((await execute()).body).toEqual(a.body);
    }
    const rows=await db.select().from(financialRequestsTable).where(eq(financialRequestsTable.requestKey,key));
    expect(rows).toHaveLength(1);
  },20000);
  it.each([""," ".repeat(3),"س".repeat(60)])("accepts an optional or maximum length name (%j)",async label=>{
    const result=await agentA.post("/api/pos/orders/park").set("Idempotency-Key",randomUUID())
      .send(parkBody({sessionId:sessionAId,label}));
    expect(result.status).toBe(201);
    expect(result.body.parkedLabel).toBe(label.trim()||null);
  });
  it("seals an old rejected label, fences delayed originals, then saves one corrected draft without financial effects",async()=>{
    const key=randomUUID(),body=parkBody({sessionId:sessionAId,label:"س".repeat(61)});
    const send=()=>agentA.post("/api/pos/orders/park").set("Idempotency-Key",key).send(body);
    expect((await send()).status).toBe(400);
    const close=()=>agentA.post("/api/pos/orders/park/resolve").send({requestKey:key,body});
    const sealed=await close();
    expect(sealed.status).toBe(200);
    expect(sealed.body).toEqual({state:"closed_without_execution",requestId:key});
    expect((await close()).body).toEqual(sealed.body);
    // Even an invalid old request stays rejected. A valid body cannot reuse its sealed identity either.
    expect((await send()).status).toBe(400);
    const corrected={...body,label:"س".repeat(60)};
    expect((await agentA.post("/api/pos/orders/park").set("Idempotency-Key",key).send(corrected)).status).toBe(409);
    const nextKey=randomUUID();
    const results=await Promise.all([1,2].map(()=>agentA.post("/api/pos/orders/park")
      .set("Idempotency-Key",nextKey).send(corrected)));
    expect(results.map(r=>r.status)).toEqual([201,201]);
    expect(results[0].body.id).toBe(results[1].body.id);
    const facts=(await db.execute(sql`SELECT
      (SELECT count(*)::int FROM pos_orders WHERE id=${results[0].body.id}) AS drafts,
      (SELECT count(*)::int FROM pos_order_payments p JOIN pos_orders o ON o.id=p.order_id WHERE o.company_id=${companyAId}) AS payments,
      (SELECT count(*)::int FROM customer_invoices WHERE company_id=${companyAId}) AS invoices,
      (SELECT count(*)::int FROM stock_moves m JOIN products p ON p.id=m.product_id WHERE p.company_id=${companyAId}) AS movements,
      (SELECT count(*)::int FROM journal_entries WHERE company_id=${companyAId}) AS journals`)).rows[0];
    expect(facts).toEqual({drafts:1,payments:0,invoices:0,movements:0,journals:0});
  });
  it("resolves a committed attempt to its original draft instead of closing it",async()=>{
    const key=randomUUID(),body=parkBody({sessionId:sessionAId,label:"Saved before lost response"});
    const original=await agentA.post("/api/pos/orders/park").set("Idempotency-Key",key).send(body);
    expect(original.status).toBe(201);
    const recovery=await agentA.post("/api/pos/orders/park/resolve").send({requestKey:key,body});
    expect(recovery.status).toBe(200);
    expect(recovery.body).toEqual({state:"completed",result:original.body});
    expect((await agentA.post("/api/pos/orders/park/resolve")
      .send({requestKey:key,body:{...body,label:"different"}})).status).toBe(409);
    expect((await agentB.post("/api/pos/orders/park/resolve").send({requestKey:key,body})).status).toBe(403);
  });
  it("requires an intent key before persisting any draft",async()=>{
    const r=await agentA.post("/api/pos/orders/park").send(parkBody({sessionId:sessionAId}));
    expect(r.status).toBe(400);
  });
  it("serializes two actual waiters into one draft and rejects changed content",async()=>{
    const key=randomUUID(), body=parkBody({sessionId:sessionAId,label:"Concurrent durable draft"});
    const connection=await pool.connect();
    let a!:Promise<request.Response>,b!:Promise<request.Response>;
    try{
      await connection.query("BEGIN");
      const holder=(await connection.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      await connection.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [JSON.stringify([companyAId,userAId,"POST:/api:/pos/orders/park",key])]);
      a=agentA.post("/api/pos/orders/park").set("Idempotency-Key",key).send(body).then(r=>r);
      b=agentA.post("/api/pos/orders/park").set("Idempotency-Key",key).send(body).then(r=>r);
      let waiters=0;
      const deadline=Date.now()+5000;
      while(waiters<2&&Date.now()<deadline){
        const q=await connection.query(`SELECT count(*)::int AS n FROM pg_locks w JOIN pg_locks h
          ON w.locktype=h.locktype AND w.database=h.database AND w.classid=h.classid AND w.objid=h.objid AND w.objsubid=h.objsubid
          WHERE h.pid=$1 AND h.locktype='advisory' AND h.granted AND NOT w.granted`,[holder]);
        waiters=q.rows[0].n;
        if(waiters<2)await new Promise(r=>setTimeout(r,10));
      }
      expect(waiters).toBe(2);
    }finally{await connection.query("COMMIT");connection.release();await Promise.allSettled([a,b]);}
    const responses=await Promise.all([a,b]);
    expect(responses.map(r=>r.status)).toEqual([201,201]);
    expect(responses[0].body.id).toBe(responses[1].body.id);
    expect(responses.filter(r=>r.headers["idempotency-replayed"]==="true")).toHaveLength(1);
    const id=responses[0].body.id;
    expect(responses[0].body.requestId).toBe(key);
    const changed=await agentA.post("/api/pos/orders/park").set("Idempotency-Key",key)
      .send({...body,label:"Changed content"});
    expect(changed.status).toBe(409);
    const facts=(await db.execute(sql`SELECT
      (SELECT count(*)::int FROM pos_orders WHERE id=${id} AND status='parked') AS drafts,
      (SELECT count(*)::int FROM financial_requests WHERE request_key=${key}) AS receipts,
      (SELECT count(*)::int FROM pos_order_payments p JOIN pos_orders o ON o.id=p.order_id WHERE o.company_id=${companyAId}) AS payments,
      (SELECT count(*)::int FROM customer_invoices WHERE company_id=${companyAId}) AS invoices,
      (SELECT count(*)::int FROM stock_moves m JOIN products p ON p.id=m.product_id WHERE p.company_id=${companyAId}) AS movements,
      (SELECT count(*)::int FROM journal_entries WHERE company_id=${companyAId}) AS journals`)).rows[0];
    expect(facts).toEqual({drafts:1,receipts:1,payments:0,invoices:0,movements:0,journals:0});
  },20000);
  it("replays a lost result after resume deleted the draft, without recreating it",async()=>{
    const key=randomUUID(),body=parkBody({sessionId:sessionAId,label:"Lost then resumed"});
    const send=()=>agentA.post("/api/pos/orders/park").set("Idempotency-Key",key).send(body);
    const original=await send();
    expect(original.status).toBe(201);
    const resumed=await agentA.post(`/api/pos/orders/${original.body.id}/resume`).set("Idempotency-Key",randomUUID()).send({sessionId:sessionAId});
    expect(resumed.status).toBe(200);
    const replay=await send();
    expect(replay.status).toBe(201);expect(replay.body).toEqual(original.body);
    expect(await db.select().from(posOrdersTable).where(eq(posOrdersTable.id,original.body.id))).toHaveLength(0);
  });
});

function parkBody(opts: { sessionId: number; label?: string }) {
  return {
    sessionId: opts.sessionId,
    label: opts.label ?? "Table 5",
    items: [
      {
        productId: productAId,
        quantity: 2,
        priceSnapshot: 30,
        nameSnapshot: "Park Prod",
      },
    ],
    subtotal: 60,
    tax: 9,
    discount: 0,
    total: 69,
  };
}

describe("POST /api/pos/orders/park", () => {
  it("parks an order with status='parked' and skips the payment-balance trigger", async () => {
    const res = await agentA
      .post("/api/pos/orders/park")
      .set("Idempotency-Key",randomUUID())
      .send(parkBody({ sessionId: sessionAId, label: "Table A1" }));
    expect(res.status).toBe(201);
    expect(res.body.parkedLabel).toBe("Table A1");
    expect(Number(res.body.total)).toBe(69);

    const [row] = await db
      .select()
      .from(posOrdersTable)
      .where(eq(posOrdersTable.id, res.body.id));
    expect(row.status).toBe("parked");
    expect(row.companyId).toBe(companyAId);
  });

  it("rejects park into another tenant's session with 404", async () => {
    const res = await agentB
      .post("/api/pos/orders/park")
      .set("Idempotency-Key",randomUUID())
      .send(parkBody({ sessionId: sessionAId, label: "x-tenant" }));
    expect(res.status).toBe(403);
  });
});

describe("GET /api/pos/orders/parked", () => {
  it("lists only the caller's parked orders for the given session", async () => {
    // Tenant A's session already has at least one parked row from
    // the previous block; create another to verify ordering.
    await agentA
      .post("/api/pos/orders/park")
      .set("Idempotency-Key",randomUUID())
      .send(parkBody({ sessionId: sessionAId, label: "Table A2" }));

    const res = await agentA.get(
      `/api/pos/orders/parked?sessionId=${sessionAId}`,
    );
    expect(res.status).toBe(200);
    const labels = (res.body as Array<{ parkedLabel: string }>).map(
      (r) => r.parkedLabel,
    );
    expect(labels).toContain("Table A1");
    expect(labels).toContain("Table A2");
  });

  it("returns empty list for tenant B querying tenant A's session", async () => {
    const res = await agentB.get(
      `/api/pos/orders/parked?sessionId=${sessionAId}`,
    );
    // Endpoint is tenant-scoped → leak-free → empty array (200), not 403/leak.
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe("durable authorized parked delivery",()=>{
  it("requires a saved key before consuming a draft",async()=>{
    const p=await agentA.post("/api/pos/orders/park").set("Idempotency-Key",randomUUID()).send(parkBody({sessionId:sessionAId}));
    const r=await agentA.post(`/api/pos/orders/${p.body.id}/resume`).send({sessionId:sessionAId});
    expect(r.status).toBe(400);
    expect(await db.select().from(posOrdersTable).where(eq(posOrdersTable.id,p.body.id))).toHaveLength(1);
  });
  it("recovers identical contents under the original resume key after the draft was consumed",async()=>{
    const p=await agentA.post("/api/pos/orders/park").set("Idempotency-Key",randomUUID()).send(parkBody({sessionId:sessionAId}));
    const key=randomUUID(),send=()=>agentA.post(`/api/pos/orders/${p.body.id}/resume`).set("Idempotency-Key",key).send({sessionId:sessionAId});
    const first=await send(),recovered=await send();
    expect(first.status).toBe(200);expect(recovered.status).toBe(200);
    expect(recovered.body).toEqual(first.body);expect(recovered.body.items).toEqual(parkBody({sessionId:sessionAId}).items);
  });
  it("does not accept knowledge of another branch's valid shift as authorization",async()=>{
    const p=await agentA.post("/api/pos/orders/park").set("Idempotency-Key",randomUUID()).send(parkBody({sessionId:sessionAId}));
    const [other]=await db.insert(branchesTable).values({name:`Other ${RUN_TAG}`,nameAr:"فرع اختبار آخر",city:"Riyadh",companyId:companyAId}).returning();
    try{
      await db.execute(sql`UPDATE user_companies SET role='cashier' WHERE company_id=${companyAId} AND user_id=${userAId}`);
      await db.execute(sql`UPDATE users SET role='cashier',branch_id=${other.id} WHERE id=${userAId}`);
      const r=await agentA.post(`/api/pos/orders/${p.body.id}/resume`).set("Idempotency-Key",randomUUID()).send({sessionId:sessionAId});
      expect(r.status).toBe(403);
      expect((await agentA.get(`/api/pos/orders/parked?sessionId=${sessionAId}`)).status).toBe(403);
      expect(await db.select().from(posOrdersTable).where(eq(posOrdersTable.id,p.body.id))).toHaveLength(1);
    }finally{
      await db.execute(sql`UPDATE user_companies SET role='owner' WHERE company_id=${companyAId} AND user_id=${userAId}`);
      await db.execute(sql`UPDATE users SET role='owner',branch_id=NULL WHERE id=${userAId}`);
      await db.delete(branchesTable).where(eq(branchesTable.id,other.id));
    }
  });
  it("does not let a cashier borrow a peer's shift even within the same branch",async()=>{
    const [peer]=await db.insert(posSessionsTable).values({sessionNumber:`PEER-${RUN_TAG}`,branchId:branchAId,
      cashierName:"Peer",cashierUserId:userBId}).returning();
    const p=await agentA.post("/api/pos/orders/park").set("Idempotency-Key",randomUUID()).send(parkBody({sessionId:peer.id}));
    try{
      await db.execute(sql`UPDATE user_companies SET role='cashier' WHERE company_id=${companyAId} AND user_id=${userAId}`);
      await db.execute(sql`UPDATE users SET role='cashier',branch_id=${branchAId} WHERE id=${userAId}`);
      const r=await agentA.post(`/api/pos/orders/${p.body.id}/resume`).set("Idempotency-Key",randomUUID()).send({sessionId:peer.id});
      expect(r.status).toBe(403);
      expect((await agentA.get(`/api/pos/orders/parked?sessionId=${peer.id}`)).status).toBe(403);
      expect(await db.select().from(posOrdersTable).where(eq(posOrdersTable.id,p.body.id))).toHaveLength(1);
      await db.update(posSessionsTable).set({cashierUserId:userAId}).where(eq(posSessionsTable.id,peer.id));
      const ok=await agentA.post(`/api/pos/orders/${p.body.id}/resume`).set("Idempotency-Key",randomUUID()).send({sessionId:peer.id});
      expect(ok.status).toBe(200);
    }finally{
      await db.execute(sql`UPDATE user_companies SET role='owner' WHERE company_id=${companyAId} AND user_id=${userAId}`);
      await db.execute(sql`UPDATE users SET role='owner',branch_id=NULL WHERE id=${userAId}`);
      await db.delete(posOrdersTable).where(eq(posOrdersTable.sessionId,peer.id));
      await db.delete(posSessionsTable).where(eq(posSessionsTable.id,peer.id));
    }
  });
  it("consumes once with concurrent keys and records no financial effects",async()=>{
    const p=await agentA.post("/api/pos/orders/park").set("Idempotency-Key",randomUUID()).send(parkBody({sessionId:sessionAId}));
    const keys=[randomUUID(),randomUUID()];
    const replies=await Promise.all(keys.map(key=>agentA.post(`/api/pos/orders/${p.body.id}/resume`).set("Idempotency-Key",key).send({sessionId:sessionAId})));
    expect(replies.map(r=>r.status).sort()).toEqual([200,404]);
    expect(replies.map(r=>r.body.state).sort()).toEqual(["resumed","unavailable"]);
    const facts=(await db.execute(sql`SELECT
      (SELECT count(*)::int FROM pos_orders WHERE id=${p.body.id}) AS drafts,
      (SELECT count(*)::int FROM audit_logs WHERE entity=${`pos_order#${p.body.id}`} AND action='pos.park.resumed') AS deliveries,
      (SELECT count(*)::int FROM financial_requests WHERE request_key=${keys[0]} OR request_key=${keys[1]}) AS receipts,
      (SELECT count(*)::int FROM pos_order_payments p JOIN pos_orders o ON o.id=p.order_id WHERE o.company_id=${companyAId}) AS payments,
      (SELECT count(*)::int FROM customer_invoices WHERE company_id=${companyAId}) AS invoices,
      (SELECT count(*)::int FROM stock_moves m JOIN products p ON p.id=m.product_id WHERE p.company_id=${companyAId}) AS movements,
      (SELECT count(*)::int FROM journal_entries WHERE company_id=${companyAId}) AS journals`)).rows[0];
    expect(facts).toEqual({drafts:0,deliveries:1,receipts:2,payments:0,invoices:0,movements:0,journals:0});
  });
  it("deduplicates the same key and keeps cancellation in a separate operation",async()=>{
    const p=await agentA.post("/api/pos/orders/park").set("Idempotency-Key",randomUUID()).send(parkBody({sessionId:sessionAId}));
    const key=randomUUID(),send=()=>agentA.post(`/api/pos/orders/${p.body.id}/resume`).set("Idempotency-Key",key).send({sessionId:sessionAId});
    const [a,b]=await Promise.all([send(),send()]);
    expect(a.status).toBe(200);expect(b.status).toBe(200);expect(a.body).toEqual(b.body);
    expect(a.body.state).toBe("resumed");
    const cancelled=await agentA.post(`/api/pos/orders/${p.body.id}/cancel`).set("Idempotency-Key",key).send({sessionId:sessionAId});
    expect(cancelled.status).toBe(404);expect(cancelled.body.state).toBe("unavailable");
    const wrong=await agentA.post(`/api/pos/orders/${p.body.id}/resume`).set("Idempotency-Key",key).send({sessionId:sessionBId});
    expect(wrong.status).toBe(409);
  });
  it("does not replay a cancelled draft as a resumed basket",async()=>{
    const p=await agentA.post("/api/pos/orders/park").set("Idempotency-Key",randomUUID()).send(parkBody({sessionId:sessionAId}));
    const key=randomUUID(),send=()=>agentA.post(`/api/pos/orders/${p.body.id}/cancel`).set("Idempotency-Key",key).send({sessionId:sessionAId});
    const a=await send(),b=await send();
    expect(a.status).toBe(200);expect(b.body).toEqual(a.body);expect(a.body.state).toBe("cancelled");
    expect(a.body.items).toBeUndefined();
    const r=await agentA.post(`/api/pos/orders/${p.body.id}/resume`).set("Idempotency-Key",key).send({sessionId:sessionAId});
    expect(r.status).toBe(404);expect(r.body.state).toBe("unavailable");
  });
  it("rechecks revoked execution authority after a real PostgreSQL fence wait",async()=>{
    const p=await agentA.post("/api/pos/orders/park").set("Idempotency-Key",randomUUID()).send(parkBody({sessionId:sessionAId}));
    const connection=await pool.connect(),key=randomUUID();
    try{
      await db.update(posSessionsTable).set({cashierUserId:userAId}).where(eq(posSessionsTable.id,sessionAId));
      await connection.query("BEGIN");
      await connection.query("SELECT pg_advisory_xact_lock(174223,35)");
      const pending=agentA.post(`/api/pos/orders/${p.body.id}/resume`).set("Idempotency-Key",key).send({sessionId:sessionAId}).then(r=>r);
      let waiting=0;
      for(let n=0;n<100;n++){
        waiting=Number((await pool.query("SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND classid=174223 AND objid=35 AND NOT granted")).rows[0].count);
        if(waiting)break;
        await new Promise(r=>setTimeout(r,10));
      }
      expect(waiting).toBeGreaterThan(0);
      await connection.query("UPDATE user_companies SET role='auditor' WHERE company_id=$1 AND user_id=$2",[companyAId,userAId]);
      await connection.query("UPDATE users SET role='auditor' WHERE id=$1",[userAId]);
      await connection.query("COMMIT");
      const r=await pending;
      expect(r.status).toBe(403);
      expect(await db.select().from(posOrdersTable).where(eq(posOrdersTable.id,p.body.id))).toHaveLength(1);
      expect(await db.select().from(financialRequestsTable).where(eq(financialRequestsTable.requestKey,key))).toHaveLength(0);
    }finally{
      await connection.query("ROLLBACK");connection.release();
      await db.execute(sql`UPDATE user_companies SET role='owner' WHERE company_id=${companyAId} AND user_id=${userAId}`);
      await db.execute(sql`UPDATE users SET role='owner' WHERE id=${userAId}`);
      await db.update(posSessionsTable).set({cashierUserId:null}).where(eq(posSessionsTable.id,sessionAId));
    }
  },15000);
});

describe("POST /api/pos/orders/:id/resume", () => {
  it("resume returns the snapshot, deletes the row, and a second resume returns 404", async () => {
    const created = await agentA
      .post("/api/pos/orders/park")
      .set("Idempotency-Key",randomUUID())
      .send(parkBody({ sessionId: sessionAId, label: "ToResume" }));
    expect(created.status).toBe(201);
    const id = created.body.id as number;

    const r1 = await agentA
      .post(`/api/pos/orders/${id}/resume`)
      .set("Idempotency-Key",randomUUID())
      .send({ sessionId: sessionAId });
    expect(r1.status).toBe(200);
    expect(r1.body.parkedLabel).toBe("ToResume");
    expect(Array.isArray(r1.body.items)).toBe(true);

    // Row gone
    const rows = await db
      .select({ id: posOrdersTable.id })
      .from(posOrdersTable)
      .where(eq(posOrdersTable.id, id));
    expect(rows).toEqual([]);

    // Second resume must 404
    const r2 = await agentA
      .post(`/api/pos/orders/${id}/resume`)
      .set("Idempotency-Key",randomUUID())
      .send({ sessionId: sessionAId });
    expect(r2.status).toBe(404);
  });

  it("tenant B cannot resume tenant A's parked order (404 + row untouched)", async () => {
    const created = await agentA
      .post("/api/pos/orders/park")
      .set("Idempotency-Key",randomUUID())
      .send(parkBody({ sessionId: sessionAId, label: "Locked-A" }));
    const id = created.body.id as number;

    // Tenant B sends its own session in the body; the SQL predicate
    // still filters by tenant + status, so this MUST be a 404.
    const xres = await agentB
      .post(`/api/pos/orders/${id}/resume`)
      .set("Idempotency-Key",randomUUID())
      .send({ sessionId: sessionBId });
    expect(xres.status).toBe(404);

    const [row] = await db
      .select({ status: posOrdersTable.status })
      .from(posOrdersTable)
      .where(eq(posOrdersTable.id, id));
    expect(row.status).toBe("parked");
  });

  it("rejects resume when sessionId in body does not match the parked row's session", async () => {
    // Seed a second open session in tenant A so we have two valid
    // sessions in the same tenant to cross-check the session scope.
    const [extraSession] = await db
      .insert(posSessionsTable)
      .values({
        sessionNumber: `PARK-EXTRA-${RUN_TAG}`,
        branchId: branchAId,
        cashierName: "A2",
      })
      .returning();

    const created = await agentA
      .post("/api/pos/orders/park")
      .set("Idempotency-Key",randomUUID())
      .send(parkBody({ sessionId: sessionAId, label: "WrongSession" }));
    const id = created.body.id as number;

    // Same tenant, different session → 404 (session-scoped resume).
    const xres = await agentA
      .post(`/api/pos/orders/${id}/resume`)
      .set("Idempotency-Key",randomUUID())
      .send({ sessionId: extraSession.id });
    expect(xres.status).toBe(404);

    // Row must still exist as parked.
    const [row] = await db
      .select({ status: posOrdersTable.status })
      .from(posOrdersTable)
      .where(eq(posOrdersTable.id, id));
    expect(row.status).toBe("parked");

    // Correct session resumes successfully.
    const ok = await agentA
      .post(`/api/pos/orders/${id}/resume`)
      .set("Idempotency-Key",randomUUID())
      .send({ sessionId: sessionAId });
    expect(ok.status).toBe(200);
  });
});

describe("GET /api/pos/summary excludes parked orders", () => {
  it("does not count parked orders in totalSales / ordersCount", async () => {
    // Baseline: read summary BEFORE parking anything fresh today.
    const before = await agentA.get("/api/pos/summary");
    expect(before.status).toBe(200);
    const beforeTotal = Number(before.body.totalSales);
    const beforeCount = Number(before.body.ordersCount);

    // Park a non-trivial-total order — if it leaks into summary, both
    // totalSales and ordersCount will increase by the parked amounts.
    const parked = await agentA
      .post("/api/pos/orders/park")
      .set("Idempotency-Key",randomUUID())
      .send(parkBody({ sessionId: sessionAId, label: "ShouldNotCount" }));
    expect(parked.status).toBe(201);

    const after = await agentA.get("/api/pos/summary");
    expect(after.status).toBe(200);
    expect(Number(after.body.totalSales)).toBe(beforeTotal);
    expect(Number(after.body.ordersCount)).toBe(beforeCount);
  });
});
