import { beforeAll, describe, expect, it } from "vitest";
import { closingReviewPayload } from "../test-utils/closing-review";
import request from "supertest";
import bcrypt from "bcryptjs";
import { randomUUID, createHash } from "node:crypto";
import { db, pool, companiesTable, usersTable, userCompaniesTable, branchesTable, warehousesTable,
  categoriesTable, productsTable, employeesTable, fiscalYearsTable, fiscalPeriodsTable } from "@workspace/db";
import app, { assertApplicationReady } from "../app";
import { recordStockMove } from "../lib/stock-engine";
import type { TeamPerson } from "../lib/team-catalog";
import { finalizeCreditNoteIssue } from "./sales";
import { returnFingerprint } from "../lib/return-access";

const rows = async (s: string, p: unknown[] = []) => (await pool.query(s, p)).rows;
const ok = (r: request.Response, status = 200) => { expect(r.status, JSON.stringify(r.body)).toBe(status); return r.body; };
const password = "Isolated POS cycle phrase 2026!";
// Independent synthetic tenants must not exhaust one shared loopback login bucket.
// Keep the actual production limiter active, with a separate test address per actor.
let testAddress = 1;
const actorAgent = () => request.agent(app).set("X-Forwarded-For", `198.18.0.${testAddress++}`);
beforeAll(async () => { await assertApplicationReady(); });
async function fixture(legacy: boolean, extraActions: string[] = []) {
  const tag = randomUUID();
  const [c] = await db.insert(companiesTable).values({ name: tag, vatRegistrationStatus: "not_registered" }).returning();
  const hash = await bcrypt.hash(password, 4);
  const [u] = await db.insert(usersTable).values({ name: "مالك اختبار", email: `${tag}-o@example.invalid`, passwordHash: hash, role: "owner" }).returning();
  await db.insert(userCompaniesTable).values({ userId: u.id, companyId: c.id, role: "owner", isDefault: true });
  const owner = actorAgent();
  ok(await owner.post("/api/auth/login").send({ email: u.email, password }));
  const [b] = await db.insert(branchesTable).values({ companyId: c.id, name: tag, nameAr: "فرع الدورة", city: "الرياض" }).returning();
  const [w] = await db.insert(warehousesTable).values({ companyId: c.id, branchId: b.id, name: tag, nameAr: "مستودع الدورة", isDefault: true }).returning();
  const [cat] = await db.insert(categoriesTable).values({ name: tag, nameAr: tag }).returning();
  const [p] = await db.insert(productsTable).values({ companyId: c.id, categoryId: cat.id, name: tag, nameAr: "منتج الدورة",
    sku: tag, price: "10", costPrice: "3", costingMethod: "fifo" }).returning();
  const year = new Date().getUTCFullYear();
  const [fy] = await db.insert(fiscalYearsTable).values({ companyId: c.id, name: tag, startDate: `${year}-01-01`, endDate: `${year}-12-31` }).returning();
  await db.insert(fiscalPeriodsTable).values({ fiscalYearId: fy.id, name: tag, startDate: `${year}-01-01`, endDate: `${year}-12-31`, status: "open" });
  await db.transaction(tx => recordStockMove(tx, { companyId: c.id, productId: p.id, quantity: 20, unitCost: 3, kind: "receipt",
    toWarehouseId: w.id, sourceType: "isolated_cycle", sourceRef: tag, createdBy: u.id }));
  const actions = ["pos.read","pos.sell","pos.shift.open","pos.discount","pos.payment.record","pos.shift.close","pos.receipts.print",
    "pos.return.request","pos.return.direct","pos.return.receive","pos.return.payout", ...extraActions];
  const person: TeamPerson = { creationKey: randomUUID(), name: "موظف دورة معزولة", email: `${tag}-e@example.invalid`,
    loginKinds: ["pos","platform"], deniedActions: [], grants: [{ resource: "pos", branchId: b.id, warehouseIds: [w.id],
      actions, amountLimit: "100", startsAt: null, endsAt: null }] };
  let employee: any, identityId: number;
  if (legacy) {
    const [old] = await db.insert(usersTable).values({ name: person.name, email: person.email!, passwordHash: hash, role: "cashier", branchId: b.id }).returning();
    identityId = old.id;
    await db.insert(userCompaniesTable).values({ userId: old.id, companyId: c.id, role: "cashier", isDefault: true });
    await db.insert(employeesTable).values({ companyId: c.id, name: person.name, employeeNo: `LEG-${tag}`, nameAr: person.name, email: person.email!, userId: old.id,
      status: "active", hireDate: "2025-01-01", recordKind: "employee" });
    const initial = { ...person, loginKinds: ["pos" as const], grants: [{ ...person.grants[0], actions: ["pos.read","pos.sell","pos.shift.open"] }] };
    const preview = ok(await owner.post("/api/team/legacy/preview").send({ userId: old.id, person: initial }));
    employee = ok(await owner.post("/api/team/legacy/apply").send({ userId: old.id, person: initial, expectedDigest: preview.digest }));
    employee = ok(await owner.put(`/api/team/people/${employee.personId}/access`).send({ expectedRevision: employee.revision, person, suspended: false }));
  } else {
    employee = ok(await owner.post("/api/team/people").send(person), 201);
    const invite = ok(await owner.post(`/api/team/people/${employee.personId}/invite`).send({ expectedRevision: employee.revision }), 201);
    ok(await actorAgent().post("/api/auth/team-activation/accept").send({ token: invite.activationToken, password }));
    employee = ok(await owner.get("/api/team/people")).find((x: any) => x.personId === employee.personId);
    identityId = employee.userId;
  }
  for (const [actionKey, maxValue] of [["pos.discount_pct", 15],["sales.credit_note_amount",100]] as const) {
    ok(await owner.post("/api/workflow/financial-limits").send({ role: "scoped", actionKey, maxValue }));
  }
  const agent = actorAgent();
  ok(await agent.post("/api/auth/login").send({ email: person.email, password }));
  const grant = ok(await agent.get("/api/workspace/access")).grants[0];
  const get = (path: string) => agent.get(`/api${path}`).set("X-Workspace-Responsibility", String(grant.id));
  const post = (path: string, body: object, key = randomUUID()) => agent.post(`/api${path}`).set("X-Workspace-Responsibility", String(grant.id)).set("Idempotency-Key", key).send(body);
  const action = async (name: string, payload: unknown) => post("/pos/returns/actions", { action: name, payload: name==="approve_close"?await closingReviewPayload(payload):payload });
  return { owner, agent, get, post, action, company: c.id, branch: b.id, wh: w.id, product: p.id, person, employee, identityId, grant };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function anotherActor(f: Fixture, actions: string[]) {
  const person = { ...f.person, creationKey: randomUUID(), email: `${randomUUID()}@example.invalid`,
    grants: [{ ...f.person.grants[0], actions }] };
  let employee = ok(await f.owner.post("/api/team/people").send(person), 201);
  const invite = ok(await f.owner.post(`/api/team/people/${employee.personId}/invite`).send({ expectedRevision: employee.revision }), 201);
  ok(await actorAgent().post("/api/auth/team-activation/accept").send({ token: invite.activationToken, password }));
  employee = ok(await f.owner.get("/api/team/people")).find((x: any) => x.personId === employee.personId);
  const agent = actorAgent();
  ok(await agent.post("/api/auth/login").send({ email: person.email, password }));
  const grant = ok(await agent.get("/api/workspace/access")).grants[0];
  return { employee, person, agent, grant, action: async (action: string, payload: unknown) =>
    agent.post("/api/pos/returns/actions").set("X-Workspace-Responsibility", String(grant.id)).send({ action, payload:action==="approve_close"?await closingReviewPayload(payload):payload }) };
}
async function openAndSell(f: Fixture, method = "cash") {
  const session = ok(await f.post("/pos/sessions", { branchId: f.branch, openingCash: 20, cashierName: "اسم الطلب" }), 201);
  const sale = ok(await f.post("/pos/orders", { sessionId: session.id, paymentMethod: method,
    items: [{ productId: f.product, quantity: 1, unitPrice: 10 }] }), 201);
  const invoice = ok(await f.get("/pos/returns/workspace")).invoices[0];
  const noteBody = { customerId: invoice.customer_id, invoiceId: invoice.id, warehouseId: f.wh, restock: true,
    goodsReceived: true,
    disposition: "resale", settlementMethod: method, proofRef: "دليل استحقاق معزول", reason: "مرتجع اختبار",
    lines: [{ invoiceLineId: invoice.lines[0].id, productId: f.product, description: "منتج", quantity: 1, unitPrice: 10, taxRate: 0 }],
    idempotencyKey: randomUUID() };
  return { session, sale, invoice, noteBody };
}
async function changeActions(f: Fixture, actions: string[]) {
  const p = ok(await f.owner.get("/api/team/people")).find((p: any) => p.personId === f.employee.personId);
  const saved = ok(await f.owner.put(`/api/team/people/${p.personId}/access`).send({ expectedRevision: p.revision,
    person: { ...f.person, grants: [{ ...f.person.grants[0], actions }] }, suspended: false }));
  Object.assign(f.grant, ok(await f.agent.get("/api/workspace/access")).grants[0]);
  return saved;
}
async function evidence(f: Fixture) {
  return {
    notes: await rows("SELECT id,status,total FROM credit_notes WHERE company_id=$1 ORDER BY id",[f.company]),
    journals: await rows("SELECT id,status FROM journal_entries WHERE company_id=$1 ORDER BY id",[f.company]),
    stock: await rows("SELECT quantity::text,avg_cost::text FROM stock_quants WHERE product_id=$1",[f.product]),
    payouts: await rows("SELECT id,status,amount FROM return_payouts WHERE company_id=$1 ORDER BY id",[f.company]),
  };
}

describe("native POS lifecycle for new and converted scoped employees", () => {
  it("requests an exact-operation discount exception without manager session or direct discount permission", async () => {
    const f = await fixture(false);
    await changeActions(f, ["pos.read","pos.sell","pos.shift.open","pos.discount.request"]);
    const session = ok(await f.post("/pos/sessions",{branchId:f.branch,openingCash:20,cashierName:"طالب استثناء"}),201);
    const body = {sessionId:session.id,paymentMethod:"cash",discount:1,items:[{productId:f.product,quantity:1}]};
    const before = await evidence(f);
    const pending = ok(await f.post("/pos/orders",body),403);
    expect(pending.requiresManagerApproval).toBe(true);
    expect(pending.approvalRequestId).toBeTypeOf("number");
    expect(await evidence(f)).toEqual(before);
    const [manager] = await db.insert(usersTable).values({name:"مراجع استثناء معزول",email:`${randomUUID()}@example.invalid`,
      passwordHash:await bcrypt.hash(password,4),role:"manager",branchId:f.branch}).returning();
    await db.insert(userCompaniesTable).values({userId:manager.id,companyId:f.company,role:"manager",isDefault:true});
    const reviewer = actorAgent();
    ok(await reviewer.post("/api/auth/login").send({email:manager.email,password}));
    for (let round=0; round<3; round++) {
      for (const authority of [reviewer, f.owner]) {
        const detail = ok(await authority.get(`/api/workflow/approval-requests/${pending.approvalRequestId}`));
        if (detail.status === "approved") break;
        const step = detail.actionableSteps[0];
        if (step) ok(await authority.post(`/api/workflow/approval-requests/${pending.approvalRequestId}/act`).send({
          action:"approve",comment:"اعتماد عملية لا ترقية جلسة",stepToken:step.stepToken,decisionId:randomUUID(),
        }));
      }
      if (ok(await f.get(`/workflow/approval-requests/${pending.approvalRequestId}`)).status === "approved") break;
    }
    expect(ok(await f.get(`/workflow/approval-requests/${pending.approvalRequestId}`)).status).toBe("approved");
    const key = randomUUID(), approved = {...body,approvalRequestId:pending.approvalRequestId};
    const sale = ok(await f.post("/pos/orders",approved,key),201);
    expect(Number(sale.total)).toBe(9);
    expect(ok(await f.post("/pos/orders",approved,key),201).id).toBe(sale.id);
    expect((await f.get("/workspace/access")).body.grants[0].actions).not.toContain("pos.discount");
    ok(await f.post("/pos/orders",{...body,managerOverride:{email:manager.email,password}}),403);
  });
  it.each(["amount","warehouse","branch"] as const)("rejects scoped return approval outside its %s", async kind => {
    const f = await fixture(false), sale = await openAndSell(f);
    await changeActions(f, ["pos.read","pos.return.request"]);
    const reviewer = await anotherActor(f, ["pos.read","pos.return.approve"]);
    const note = ok(await f.action("request",{...sale.noteBody,goodsReceived:false}),202);
    let branch = f.branch;
    if (kind === "branch") branch = (await db.insert(branchesTable).values({companyId:f.company,name:randomUUID(),nameAr:"فرع آخر مصطنع",city:"الرياض"}).returning())[0].id;
    const warehouse = kind === "amount" ? f.wh : (await db.insert(warehousesTable)
      .values({companyId:f.company,branchId:branch,name:randomUUID(),nameAr:"مستودع آخر مصطنع"}).returning())[0].id;
    const changed = ok(await f.owner.put(`/api/team/people/${reviewer.employee.personId}/access`).send({
      expectedRevision:reviewer.employee.revision,person:{...reviewer.person,grants:[{
        ...reviewer.person.grants[0],branchId:branch,warehouseIds:[warehouse],amountLimit:kind==="amount"?"5":"100",
      }]},suspended:false }));
    // Editing replaces the grant. The new header is explicit, not the revoked old selection.
    const grants = ok(await reviewer.agent.get("/api/workspace/access")).grants;
    const before = await evidence(f);
    const denied = await reviewer.agent.post("/api/pos/returns/actions").set("X-Workspace-Responsibility", String(grants[0].id))
      .send({action:"approve",payload:{noteId:note.id,comment:"يجب رفض خارج النطاق"}});
    expect(denied.status).toBe(403);
    expect(await evidence(f)).toEqual(before);
    expect(changed.revision).toBeGreaterThan(reviewer.employee.revision);
  });
  it("separates requester, source-bound reviewer, physical receiver and payer, with one financial effect", async () => {
    const f = await fixture(false), sale = await openAndSell(f);
    await changeActions(f, ["pos.read","pos.return.request"]);
    const reviewer = await anotherActor(f, ["pos.read","pos.return.approve"]);
    const receiver = await anotherActor(f, ["pos.read","pos.return.receive"]);
    const payer = await anotherActor(f, ["pos.read","pos.return.payout","pos.shift.close"]);
    const note = ok(await f.action("request", {...sale.noteBody,goodsReceived:false}),202);
    expect((await evidence(f)).stock[0].quantity).toBe("19.0000");
    ok(await f.action("approve",{noteId:note.id,comment:"غير مخول"}),403);
    ok(await f.action("receive",{noteId:note.id,reference:"غير مخول"}),403);
    ok(await reviewer.action("receive",{noteId:note.id,reference:"غير مخول"}),403);
    ok(await receiver.action("receive",{noteId:note.id,reference:"قبل الاعتماد"}),409);
    ok(await reviewer.action("approve",{noteId:note.id,comment:"راجعت المصدر والمبلغ والمستودع"}));
    expect((await evidence(f)).stock[0].quantity).toBe("19.0000");
    expect((await rows("SELECT journal_entry_id FROM credit_notes WHERE id=$1",[note.id]))[0].journal_entry_id).toBeNull();
    const receive = {noteId:note.id,reference:"استلام فعلي بموظف مستقل"};
    const receipts = await Promise.all([receiver.action("receive",receive),receiver.action("receive",receive)]);
    receipts.forEach(r => expect(ok(r).status).toBe("issued"));
    const payout = {noteId:note.id,receiptId:sale.invoice.receipts[0].id,sessionId:sale.session.id,
      amount:10,method:"cash",reference:"",delivered:true,idempotencyKey:randomUUID()};
    ok(await f.action("payout",payout),403);
    const paid = await Promise.all([payer.action("payout",payout),payer.action("payout",payout)]);
    expect(ok(paid[0]).id).toBe(ok(paid[1]).id);
    // Branch-closing permission deliberately includes a colleague's shift.
    expect(ok(await payer.action("close",{sessionId:sale.session.id,counted:20,unresolvedSalesCleared:true})).difference).toBe("0.00");
    const final = await evidence(f);
    expect(final.stock[0].quantity).toBe("20.0000");
    expect(final.payouts).toHaveLength(1);
    expect((await rows(`SELECT count(*)::int AS n FROM
      (SELECT j.id FROM journal_entries j JOIN journal_entry_lines l ON l.entry_id=j.id
       WHERE j.company_id=$1 GROUP BY j.id HAVING sum(l.base_debit)<>sum(l.base_credit)) x`,[f.company]))[0].n).toBe(0);
  });
  it.each(["revoke","source","policy"] as const)("rejects delayed receipt after %s changes, preserving approved history and stock", async kind => {
    const f = await fixture(true), sale = await openAndSell(f);
    await changeActions(f, ["pos.read","pos.return.request"]);
    const reviewer = await anotherActor(f, ["pos.read","pos.return.approve"]);
    const receiver = await anotherActor(f, ["pos.read","pos.return.receive"]);
    const note = ok(await f.action("request",{...sale.noteBody,goodsReceived:false}),202);
    ok(await reviewer.action("approve",{noteId:note.id,comment:"اعتماد مصطنع"}));
    const before = await evidence(f);
    if (kind === "revoke") {
      ok(await f.owner.put(`/api/team/people/${reviewer.employee.personId}/access`).send({
        expectedRevision:reviewer.employee.revision,person:{...reviewer.person,
          grants:[{...reviewer.person.grants[0],actions:["pos.read"]}]},suspended:false }));
    } else if (kind === "source") await pool.query("UPDATE credit_notes SET reason='تعديل جوهري بعد الاعتماد' WHERE id=$1",[note.id]);
    else ok(await f.owner.post("/api/pos/returns/actions").send({action:"configure_policy",
      payload:{branchId:f.branch,approvalAbove:0,allowResale:false}}));
    const rejected = await receiver.action("receive",{noteId:note.id,reference:"لن يرحل بعد التغيير"});
    expect([403,409]).toContain(rejected.status);
    expect(await evidence(f)).toEqual(before);
    expect((await rows("SELECT a.status,c.received_by FROM return_controls c JOIN approval_requests a ON a.id=c.approval_id WHERE c.note_id=$1",[note.id]))[0])
      .toEqual({status:"approved",received_by:null});
  });
  it("credits only the original discounted invoice net and pays it once after deferred receipt", async () => {
    const f = await fixture(false);
    const session = ok(await f.post("/pos/sessions", { branchId:f.branch, openingCash:20,cashierName:"اختبار الخصم" }),201);
    ok(await f.post("/pos/orders", {sessionId:session.id,paymentMethod:"cash",discount:1,
      items:[{productId:f.product,quantity:1,unitPrice:10}]}),201);
    const invoice = ok(await f.get("/pos/returns/workspace")).invoices[0];
    expect(Number(invoice.total)).toBe(9);
    expect(invoice.lines[0].return_total).toBe("9.00");
    const noteBody = {invoiceId:invoice.id,customerId:invoice.customer_id,warehouseId:f.wh,
      restock:true,goodsReceived:false,disposition:"resale",settlementMethod:"cash",proofRef:"أصل بيع مخفض",
      reason:"رد صافي الأصل",idempotencyKey:randomUUID(),lines:[{invoiceLineId:invoice.lines[0].id,
        productId:f.product,description:"بند الأصل",quantity:1,unitPrice:10,taxRate:0}]};
    ok(await f.owner.post("/api/workflow/financial-limits").send({role:"scoped",actionKey:"sales.credit_note_amount",maxValue:8}));
    ok(await f.action("request",noteBody),403);
    expect(await rows("SELECT id FROM credit_notes WHERE company_id=$1",[f.company])).toHaveLength(0);
    ok(await f.owner.post("/api/workflow/financial-limits").send({role:"scoped",actionKey:"sales.credit_note_amount",maxValue:9}));
    const note=ok(await f.action("request",noteBody),201);
    expect(Number(note.total)).toBe(9);
    ok(await f.action("receive",{noteId:note.id,reference:"استلام الأصل المخفض"}));
    const payload={noteId:note.id,receiptId:invoice.receipts[0].id,sessionId:session.id,amount:9,method:"cash",
      delivered:true,reference:"",idempotencyKey:randomUUID()};
    const paid=await Promise.all([f.action("payout",payload),f.action("payout",payload)]);
    expect(ok(paid[0]).id).toBe(ok(paid[1]).id);
    expect(await rows("SELECT amount FROM return_payouts WHERE company_id=$1 AND note_id=$2",[f.company,note.id]))
      .toEqual([{amount:"9.00"}]);
    expect((await evidence(f)).stock.map(q=>[Number(q.quantity),Number(q.avg_cost)])).toEqual([[20,3]]);
    expect(await rows("SELECT sum(quantity*avg_cost)::numeric(18,2)::text AS carrying_value FROM stock_quants WHERE product_id=$1",[f.product]))
      .toEqual([{carrying_value:"60.00"}]);
  },60000);
  it("blocks an old unissued over-credit before stock or ledger effects without rewriting issued history", async () => {
    const f=await fixture(false);
    const session=ok(await f.post("/pos/sessions",{branchId:f.branch,openingCash:20,cashierName:"اختبار المسودة السابقة"}),201);
    ok(await f.post("/pos/orders",{sessionId:session.id,paymentMethod:"cash",discount:1,
      items:[{productId:f.product,quantity:1,unitPrice:10}]}),201);
    const invoice=ok(await f.get("/pos/returns/workspace")).invoices[0];
    const note=ok(await f.action("request",{invoiceId:invoice.id,customerId:invoice.customer_id,warehouseId:f.wh,
      restock:true,goodsReceived:false,disposition:"resale",settlementMethod:"cash",proofRef:"مسودة سابقة مصطنعة",
      reason:"اختبار حماية إصدار",idempotencyKey:randomUUID(),lines:[{invoiceLineId:invoice.lines[0].id,
        productId:f.product,description:"الأصل",quantity:1,unitPrice:10,taxRate:0}]}),201);
    // Reproduce the previously observed unissued shape; no customer data or issued document is modified.
    await rows("UPDATE credit_notes SET subtotal=10,total=10 WHERE id=$1",[note.id]);
    await rows("UPDATE credit_note_lines SET unit_price=10,line_total=10 WHERE note_id=$1",[note.id]);
    await rows("UPDATE return_controls SET received_by=$1,received_at=now(),receipt_reference='synthetic legacy receipt' WHERE note_id=$2",
      [f.identityId,note.id]);
    await rows("UPDATE return_controls SET fingerprint=$1 WHERE note_id=$2",[await returnFingerprint(db,note.id),note.id]);
    const before=await evidence(f);
    await expect(finalizeCreditNoteIssue(note.id,f.identityId,f.company)).rejects.toThrow(/صافي المصدر/);
    const after=await evidence(f);
    expect(after.stock).toEqual(before.stock);expect(after.journals).toEqual(before.journals);
    expect(after.payouts).toEqual(before.payouts);
    expect((await rows("SELECT status,journal_entry_id,total FROM credit_notes WHERE id=$1",[note.id]))[0])
      .toEqual({status:"pending_approval",journal_entry_id:null,total:"10.00"});
  },60000);
  it("permits direct authorization without implicit receipt or independent review, with server-side PDF gating", async () => {
    const f=await fixture(false), sale=await openAndSell(f);
    const before=await evidence(f);
    const note=ok(await f.action("request",{...sale.noteBody,goodsReceived:false}),201);
    expect(note).toMatchObject({directAuthorized:true,pendingReceipt:true});
    const waiting=await evidence(f);
    expect(waiting.stock).toEqual(before.stock);expect(waiting.journals).toEqual(before.journals);expect(waiting.payouts).toEqual(before.payouts);
    expect(await rows("SELECT id FROM approval_requests WHERE company_id=$1 AND doc_type='credit_note' AND record_id=$2",[f.company,note.id])).toHaveLength(0);
    ok(await f.get(`/sales/credit-notes/${note.id}/pdf`),409);
    const receiver=await anotherActor(f,["pos.read","pos.return.receive"]);
    const received=ok(await receiver.action("receive",{noteId:note.id,reference:"استلام منفصل بعد سماح مباشر"}));
    expect(received.status).toBe("issued");
    ok(await receiver.action("receive",{noteId:note.id,reference:"استلام منفصل بعد سماح مباشر"}));
    expect((await evidence(f)).stock).toEqual([{quantity:"20.0000",avg_cost:"3.0000000000000000"}]);
    ok(await f.get(`/sales/credit-notes/${note.id}/pdf`));
    expect((await rows("SELECT journal_entry_id FROM credit_notes WHERE id=$1",[note.id]))[0].journal_entry_id).not.toBeNull();
  },60000);
  it("rejects delayed direct receipt after original authority revocation without borrowing receiver powers", async () => {
    const f=await fixture(false), sale=await openAndSell(f);
    const note=ok(await f.action("request",{...sale.noteBody,goodsReceived:false}),201);
    const receiver=await anotherActor(f,["pos.read","pos.return.receive"]);
    const before=await evidence(f);
    await changeActions(f,f.person.grants[0].actions.filter(a=>a!=="pos.return.direct"));
    ok(await receiver.action("receive",{noteId:note.id,reference:"إثبات بعد سحب السماح"}),403);
    expect(await evidence(f)).toEqual(before);
  });
  it("re-reviews the same return after reviewer revocation, retaining the old decision and one financial effect", async () => {
    const f=await fixture(false), sale=await openAndSell(f);
    ok(await f.owner.post("/api/pos/returns/actions").send({action:"configure_policy",payload:{branchId:f.branch,approvalAbove:0,allowResale:true}}));
    const reviewer=await anotherActor(f,["pos.read","pos.return.approve"]);
    const receiver=await anotherActor(f,["pos.read","pos.return.receive"]);
    const note=ok(await f.action("request",{...sale.noteBody,goodsReceived:false}),202);
    ok(await f.get(`/sales/credit-notes/${note.id}/pdf`),409);
    ok(await reviewer.action("approve",{noteId:note.id,comment:"مراجعة أصلية مستقلة"}));
    ok(await f.get(`/sales/credit-notes/${note.id}/pdf`),409);
    const p=ok(await f.owner.get("/api/team/people")).find((x:any)=>x.personId===reviewer.employee.personId);
    ok(await f.owner.put(`/api/team/people/${p.personId}/access`).send({expectedRevision:p.revision,person:{
      ...reviewer.person,grants:[{...reviewer.person.grants[0],actions:["pos.read"]}]},suspended:false}));
    const before=await evidence(f);
    ok(await receiver.action("receive",{noteId:note.id,reference:"محاولة بعد سحب أهلية المعتمد"}),403);
    expect(await evidence(f)).toEqual(before);
    const renewed=await Promise.all([f.action("re_review",{noteId:note.id}),f.action("re_review",{noteId:note.id})]);
    const first=ok(renewed[0]),second=ok(renewed[1]);expect(first.approvalRequestId).toBe(second.approvalRequestId);
    expect(first.approvalRequestId).not.toBe(note.approvalRequestId);
    const history=await rows("SELECT status,review_invalidated_at FROM approval_requests WHERE company_id=$1 AND doc_type='credit_note' AND record_id=$2 ORDER BY id",[f.company,note.id]);
    expect(history).toHaveLength(2);expect(history[0].status).toBe("approved");expect(history[0].review_invalidated_at).not.toBeNull();
    const replacement=await anotherActor(f,["pos.read","pos.return.approve"]);
    ok(await replacement.action("approve",{noteId:note.id,comment:"مراجعة بديلة مستقلة بعد السحب"}));
    ok(await receiver.action("receive",{noteId:note.id,reference:"استلام بعد مراجعة جديدة"}));
    const payout={noteId:note.id,receiptId:sale.invoice.receipts[0].id,sessionId:sale.session.id,amount:10,
      method:"cash",reference:"صرف بعد المراجعة الجديدة",delivered:true,idempotencyKey:randomUUID()};
    ok(await f.action("payout",payout));ok(await f.action("payout",payout));
    expect((await rows("SELECT count(*)::int n,sum(amount)::text paid FROM return_payouts WHERE note_id=$1",[note.id]))[0]).toEqual({n:1,paid:"10.00"});
    expect(await rows("SELECT id FROM credit_notes WHERE company_id=$1",[f.company])).toHaveLength(1);
  });
  it("limits explicit sole-owner exceptions to one operation, then records responsibility without extra money or payroll", async () => {
    const f=await fixture(false), act=async(action:string,payload:unknown)=>f.owner.post("/api/pos/returns/actions").send({action,payload:action==="approve_close"?await closingReviewPayload(payload):payload});
    const session=ok(await f.owner.post("/api/pos/sessions").send({branchId:f.branch,openingCash:20,cashierName:"المالك"}),201);
    ok(await act("close",{sessionId:session.id,counted:19,reason:"فرق مصطنع للمالك",unresolvedSalesCleared:true}));
    ok(await act("approve_close",{sessionId:session.id}),403);
    ok(await act("owner_proof",{sessionId:session.id,purpose:"cash_difference_review",password}),403);
    ok(await act("configure_owner_policy",{enabled:true,operations:["cash_difference_review","cash_difference_responsibility"],amountLimit:1,reason:"سياسة شركة اختبار للمالك المنفرد"}));
    ok(await act("owner_proof",{sessionId:session.id,purpose:"cash_difference_review",password:"غير صحيح"}),401);
    ok(await f.action("owner_proof",{sessionId:session.id,purpose:"cash_difference_review",password}),403);
    const identity=ok(await act("owner_proof",{sessionId:session.id,purpose:"cash_difference_review",password}));
    expect(identity.independentApproval).toBe(false);
    ok(await act("approve_close",{sessionId:session.id,ownerProof:identity.proof}));
    const afterClose=await evidence(f),hrBefore=await rows("SELECT to_jsonb(e) AS data FROM employees e WHERE company_id=$1 ORDER BY id",[f.company]);
    ok(await act("approve_close",{sessionId:session.id,ownerProof:identity.proof}));
    expect(await evidence(f)).toEqual(afterClose);
    const decision={sessionId:session.id,decision:"company_bears",reason:"تتحمل المنشأة الفرق التجريبي",evidence:"محضر مصطنع 001",idempotencyKey:randomUUID()};
    ok(await act("responsibility",{...decision,ownerProof:identity.proof}),403); // Wrong purpose, no reusable override.
    const confirmation=ok(await act("owner_proof",{sessionId:session.id,purpose:"cash_difference_responsibility",password,decision}));
    ok(await act("responsibility",{...decision,reason:"تغيير الغرض بعد تأكيده",ownerProof:confirmation.proof}),403);
    const outcomes=await Promise.all([act("responsibility",{...decision,ownerProof:confirmation.proof}),act("responsibility",{...decision,ownerProof:confirmation.proof})]);
    expect(ok(outcomes[0]).id).toBe(ok(outcomes[1]).id);
    expect(ok(outcomes[0]).owner_exception).toBe(true);
    expect(await evidence(f)).toEqual(afterClose);
    expect(await rows("SELECT to_jsonb(e) AS data FROM employees e WHERE company_id=$1 ORDER BY id",[f.company])).toEqual(hrBefore);
    expect(await rows("SELECT id FROM pos_cash_responsibility_decisions WHERE company_id=$1",[f.company])).toHaveLength(1);
    expect(await rows("SELECT token_hash FROM pos_owner_operation_proofs WHERE company_id=$1 AND consumed_at IS NOT NULL",[f.company])).toHaveLength(2);
    ok(await act("responsibility",{...decision,evidence:"دليل مختلف",ownerProof:confirmation.proof}),409);
  });
  it.each(["expired","policy","amount","second_owner","source"] as const)("rejects a sole-owner proof after %s changes without posting the difference",async kind=>{
    const f=await fixture(false),act=async(action:string,payload:unknown)=>f.owner.post("/api/pos/returns/actions").send({action,payload:action==="approve_close"?await closingReviewPayload(payload):payload});
    const session=ok(await f.owner.post("/api/pos/sessions").send({branchId:f.branch,openingCash:20,cashierName:"المالك"}),201);
    ok(await act("close",{sessionId:session.id,counted:19,reason:"فرق مصطنع",unresolvedSalesCleared:true}));
    const p={enabled:true,operations:["cash_difference_review"],amountLimit:1,reason:"سياسة مصطنعة مؤرخة"};
    ok(await act("configure_owner_policy",p));
    const proof=ok(await act("owner_proof",{sessionId:session.id,purpose:"cash_difference_review",password}));
    const before=await evidence(f);
    if(kind==="expired") await rows("UPDATE pos_owner_operation_proofs SET expires_at=clock_timestamp()-interval '1 second' WHERE company_id=$1",[f.company]);
    if(kind==="policy") ok(await act("configure_owner_policy",{...p,enabled:false}));
    if(kind==="amount") ok(await act("configure_owner_policy",{...p,amountLimit:0.5}));
    if(kind==="second_owner") await rows("UPDATE user_companies SET role='owner' WHERE company_id=$1 AND user_id=$2",[f.company,f.identityId]);
    if(kind==="source") await rows("UPDATE pos_cash_closings SET reason='تغير مصدر القرار' WHERE session_id=$1",[session.id]);
    ok(await act("approve_close",{sessionId:session.id,ownerProof:proof.proof}),403);
    expect(await evidence(f)).toEqual(before);
  });
  it("keeps cash-difference responsibility separate from review and bounds it to a granted branch and amount",async()=>{
    const f=await fixture(false),sale=await openAndSell(f);
    const closer=await anotherActor(f,["pos.read","pos.shift.close"]);
    ok(await closer.action("close",{sessionId:sale.session.id,counted:29,reason:"فرق مستقل",unresolvedSalesCleared:true}));
    const reviewer=await anotherActor(f,["pos.read","pos.shift.difference"]);
    const decision={sessionId:sale.session.id,decision:"employee_responsible",employeeId:f.employee.personId,
      reason:"قرار مسؤولية مستقل دون دين",evidence:"دليل مصطنع",idempotencyKey:randomUUID()};
    ok(await f.action("responsibility",decision),403);
    const responsible=await anotherActor(f,["pos.read","pos.shift.responsibility"]);
    const liveAction=async(payload:unknown)=>{
      const grant=ok(await responsible.agent.get("/api/workspace/access")).grants.find((g:any)=>g.actions.includes("pos.shift.responsibility"));
      return responsible.agent.post("/api/pos/returns/actions").set("X-Workspace-Responsibility",String(grant.id))
        .send({action:"responsibility",payload});
    };
    ok(await responsible.action("responsibility",decision),409);
    ok(await reviewer.action("approve_close",{sessionId:sale.session.id}));
    ok(await reviewer.action("responsibility",decision),403);
    const before=await evidence(f);
    const current=ok(await f.owner.get("/api/team/people")).find((x:any)=>x.personId===responsible.employee.personId);
    ok(await f.owner.put(`/api/team/people/${current.personId}/access`).send({expectedRevision:current.revision,
      person:{...responsible.person,grants:[{...responsible.person.grants[0],amountLimit:"0.50"}]},suspended:false}));
    ok(await liveAction(decision),403);
    const limited=ok(await f.owner.get("/api/team/people")).find((x:any)=>x.personId===responsible.employee.personId);
    ok(await f.owner.put(`/api/team/people/${limited.personId}/access`).send({expectedRevision:limited.revision,person:responsible.person,suspended:false}));
    ok(await liveAction({...decision,employeeId:999999999}),403);
    const [otherBranch]=await db.insert(branchesTable).values({companyId:f.company,name:randomUUID(),nameAr:"فرع جدة المعزول",city:"جدة"}).returning();
    const workspace=ok(await f.owner.get("/api/pos/returns/workspace"));
    expect(workspace.responsibility_employees).toContainEqual(expect.objectContaining({id:f.employee.personId,branch_id:f.branch}));
    expect(workspace.responsibility_employees.some((e:any)=>e.id===f.employee.personId&&e.branch_id===otherBranch.id)).toBe(false);
    expect(workspace.responsibility_employees.every((e:any)=>Object.keys(e).sort().join(",")==="branch_id,employee_no,id,name_ar")).toBe(true);
    const hrBefore=await rows("SELECT to_jsonb(e) AS data FROM employees e WHERE company_id=$1 ORDER BY id",[f.company]);
    const r=ok(await liveAction(decision));
    expect(r).toMatchObject({decision:"employee_responsible",employee_id:f.employee.personId,owner_exception:false,difference_amount:"-1.00"});
    ok(await liveAction(decision));
    expect(await evidence(f)).toEqual(before);
    expect(await rows("SELECT to_jsonb(e) AS data FROM employees e WHERE company_id=$1 ORDER BY id",[f.company])).toEqual(hrBefore);
  });
  it("bounds external confirmation by current amount authority but retains committed receipt recovery", async () => {
    const f=await fixture(false,["pos.return.external"]), sale=await openAndSell(f,"card");
    const note=ok(await f.action("request",sale.noteBody),201);
    const payout=ok(await f.action("payout",{noteId:note.id,receiptId:sale.invoice.receipts[0].id,
      sessionId:sale.session.id,amount:10,method:"card",reference:"حجز رد تجريبي",delivered:true,idempotencyKey:randomUUID()}));
    f.person.grants[0].amountLimit="5";
    await changeActions(f,f.person.grants[0].actions);
    const before=await evidence(f), confirm={payoutId:payout.id,reference:"دليل مزود مصطنع فقط"};
    ok(await f.action("confirm_external",confirm),403);
    expect(await evidence(f)).toEqual(before);
    f.person.grants[0].amountLimit="10";
    await changeActions(f,f.person.grants[0].actions);
    expect(ok(await f.action("confirm_external",confirm)).status).toBe("external_confirmed");
    f.person.grants[0].amountLimit="5";
    await changeActions(f,f.person.grants[0].actions);
    const committed=await evidence(f);
    expect(ok(await f.action("confirm_external",confirm)).status).toBe("external_confirmed");
    expect(await evidence(f)).toEqual(committed);
  });
  it("bounds an independent scoped difference reviewer and does not re-spend authority on replay", async () => {
    const f=await fixture(false),sale=await openAndSell(f);
    const closing=ok(await f.action("close",{sessionId:sale.session.id,counted:20,reason:"عجز مصطنع عشرة",unresolvedSalesCleared:true}));
    expect(closing.status).toBe("pending");
    const person:TeamPerson={...f.person,creationKey:randomUUID(),name:"مراجع فرق مستقل",
      email:`review-${randomUUID()}@example.invalid`,grants:[{...f.person.grants[0],actions:["pos.read","pos.shift.difference"],amountLimit:"5"}]};
    let employee=ok(await f.owner.post("/api/team/people").send(person),201);
    const invite=ok(await f.owner.post(`/api/team/people/${employee.personId}/invite`).send({expectedRevision:employee.revision}),201);
    ok(await actorAgent().post("/api/auth/team-activation/accept").send({token:invite.activationToken,password}));
    const agent=actorAgent();ok(await agent.post("/api/auth/login").send({email:person.email,password}));
    let grant=ok(await agent.get("/api/workspace/access")).grants[0];
    const approve=async()=>agent.post("/api/pos/returns/actions").set("X-Workspace-Responsibility",String(grant.id))
      .send({action:"approve_close",payload:await closingReviewPayload({sessionId:sale.session.id})});
    const setLimit=async(limit:string)=>{
      employee=ok(await f.owner.get("/api/team/people")).find((x:any)=>x.personId===employee.personId);
      person.grants[0].amountLimit=limit;
      ok(await f.owner.put(`/api/team/people/${employee.personId}/access`).send({expectedRevision:employee.revision,person,suspended:false}));
      grant=ok(await agent.get("/api/workspace/access")).grants[0];
    };
    const before=await evidence(f);
    ok(await approve(),403);expect(await evidence(f)).toEqual(before);
    await setLimit("10");
    expect(ok(await approve()).status).toBe("approved");
    await setLimit("5");
    const committed=await evidence(f);
    expect(ok(await approve()).status).toBe("approved");
    expect(await evidence(f)).toEqual(committed);
    expect((await rows("SELECT count(*)::int AS n FROM journal_entries WHERE company_id=$1 AND reference=$2",
      [f.company,`SHIFT-VAR-${sale.session.id}`]))[0].n).toBe(1);
  });
  it.each([false,true])("reconciles sale, recorded tender, partial/full refund, and one closing (legacy=%s)", async legacy => {
    const f = await fixture(legacy);
    const open = { branchId: f.branch, cashierName: "اسم غير موثوق", openingCash: 20 }, openKey = randomUUID();
    const session = ok(await f.post("/pos/sessions", open, openKey), 201);
    expect(ok(await f.post("/pos/sessions", open, openKey), 201).id).toBe(session.id);
    const body = { sessionId: session.id, items: [{ productId: f.product, quantity: 2, unitPrice: 10 }], paymentMethod: "cash" };
    const key = randomUUID();
    const sale = ok(await f.post("/pos/orders", body, key), 201);
    expect(ok(await f.post("/pos/orders", body, key), 201).id).toBe(sale.id);
    const receiptPdf = await f.get(`/pos/orders/${sale.id}/receipt.pdf`);
    ok(receiptPdf);
    expect(receiptPdf.headers["content-type"]).toContain("application/pdf");
    ok(await f.get(`/pos/orders/${sale.id}/receipt.pdf?intent=export_requested`),403);
    ok(await f.post("/pos/orders", { ...body, items: [{ productId: f.product, quantity: 1, unitPrice: 10 }], discount: 1,
      paymentMethod: "card", payments: [{ method: "card", amount: 9, reference: "دليل تحصيل تجريبي" }] }), 201);
    const workspace = ok(await f.get("/pos/returns/workspace"));
    const invoice = workspace.invoices.find((i: any) => Number(i.total) === 20);
    const line = invoice.lines[0], receipt = invoice.receipts[0];
    for (let n=0; n<2; n++) {
      const req = { customerId: invoice.customer_id, invoiceId: invoice.id, warehouseId: f.wh, restock: true,
        goodsReceived: true,
        disposition: "resale", settlementMethod: "cash", proofRef: `استلام فعلي تجريبي${n}`, reason: "مرتجع تجريبي",
        lines: [{ invoiceLineId: line.id, productId: f.product, description: "منتج الدورة", quantity: 1, unitPrice: 10, taxRate: 0 }],
        idempotencyKey: randomUUID() };
      const note = ok(await f.action("request", req), 201);
      expect(note.status).toBe("issued");
      expect(ok(await f.action("request", req), 201).id).toBe(note.id);
      const refund = { noteId: note.id, receiptId: receipt.id, sessionId: session.id, amount: 10, method: "cash",
        reference: legacy ? "" : " تم تسليم النقد تجريبيًا ", delivered: true, idempotencyKey: randomUUID() };
      const payouts = await Promise.all([f.action("payout", refund),f.action("payout", refund)]);
      expect(ok(payouts[0]).id).toBe(ok(payouts[1]).id);
      if (!legacy) expect(ok(payouts[0]).reference.endsWith(refund.reference)).toBe(true);
    }
    const closing = { sessionId: session.id, counted: 20, unresolvedSalesCleared: true };
    const closed = await Promise.all([f.action("close", closing),f.action("close", closing)]);
    expect(ok(closed[0]).id).toBe(ok(closed[1]).id);
    expect(ok(closed[0]).status).toBe("approved");
    const [quant] = await rows("SELECT quantity::text AS q,(quantity*avg_cost)::numeric(18,2)::text AS v FROM stock_quants WHERE product_id=$1 AND warehouse_id=$2",[f.product,f.wh]);
    expect(quant).toEqual({ q: "19.0000", v: "57.00" });
    expect(await rows(`SELECT j.id FROM journal_entries j JOIN journal_entry_lines l ON l.entry_id=j.id
      WHERE j.company_id=$1 GROUP BY j.id HAVING sum(l.base_debit)<>sum(l.base_credit)`,[f.company])).toEqual([]);
    expect((await rows("SELECT count(*)::int AS n FROM pos_cash_closings WHERE company_id=$1",[f.company]))[0].n).toBe(1);
    expect((await rows("SELECT count(*)::int AS n FROM return_payouts WHERE company_id=$1",[f.company]))[0].n).toBe(2);
    expect((await rows("SELECT count(*)::int AS n FROM credit_notes WHERE company_id=$1",[f.company]))[0].n).toBe(2);
    expect((await rows("SELECT count(*)::int AS n FROM pos_orders WHERE company_id=$1",[f.company]))[0].n).toBe(2);
  }, 60_000);
  it.each([false,true])("blocks positive discounts without owned scoped policy; never inherits legacy cashier cap (legacy=%s)", async legacy => {
    const f = await fixture(legacy);
    await rows("DELETE FROM financial_limits WHERE company_id=$1 AND role='scoped' AND action_key='pos.discount_pct'",[f.company]);
    const session = ok(await f.post("/pos/sessions", { branchId: f.branch, openingCash: 20, cashierName: "اسم الطلب" }), 201);
    const before = await evidence(f);
    ok(await f.post("/pos/orders", { sessionId: session.id, paymentMethod: "cash", discount: 0.1,
      items: [{ productId: f.product, quantity: 1, unitPrice: 10 }] }), 403);
    expect(await evidence(f)).toEqual(before);
  });
  it("separates deny, approval-required and direct modes, and never lets identity confirmation approve another request", async () => {
    const f = await fixture(false), sale = await openAndSell(f);
    const denied = f.person.grants[0].actions.filter(a => !a.startsWith("pos.return."));
    await changeActions(f, denied);
    const before = await evidence(f);
    ok(await f.action("request", sale.noteBody),403);
    expect(await evidence(f)).toEqual(before);
    await changeActions(f, [...denied,"pos.return.request"]);
    ok(await f.action("request", sale.noteBody),403); // Goods receiving is a separate permission.
    await changeActions(f,[...denied,"pos.return.request","pos.return.receive","pos.return.payout"]);
    const note = ok(await f.action("request",sale.noteBody),202);
    expect(note.pendingApproval).toBe(true);
    expect((await rows("SELECT status FROM credit_notes WHERE id=$1",[note.id]))[0].status).toBe("pending_approval");
    expect((await evidence(f)).stock).toEqual(before.stock);
    ok(await f.action("approve",{ noteId:note.id,comment:"تأكيد هوية ليس موافقة" }),403);
    ok(await f.owner.post("/api/pos/returns/actions").send({ action:"approve",payload:{noteId:note.id,comment:"مراجعة مستقلة للمصدر"} }));
    expect((await rows("SELECT status FROM credit_notes WHERE id=$1",[note.id]))[0].status).toBe("issued");
  });
  it("keeps a required company threshold above a direct grant and rejects a forged receiving warehouse", async () => {
    const f = await fixture(true), sale = await openAndSell(f);
    const [other] = await db.insert(warehousesTable).values({ companyId:f.company,branchId:f.branch,name:randomUUID(),nameAr:"غير ممنوح" }).returning();
    const before=await evidence(f);
    ok(await f.action("request",{...sale.noteBody,warehouseId:other.id}),403);
    expect(await evidence(f)).toEqual(before);
    ok(await f.owner.post("/api/pos/returns/actions").send({action:"configure_policy",payload:{branchId:f.branch,approvalAbove:0,allowResale:true}}));
    const note=ok(await f.action("request",sale.noteBody),202);
    expect(note.pendingApproval).toBe(true);
    expect((await rows("SELECT status FROM credit_notes WHERE id=$1",[note.id]))[0].status).toBe("pending_approval");
    expect((await evidence(f)).stock).toEqual(before.stock);
  });
  it("cannot approve one's own till difference and posts one balanced adjustment by an independent reviewer",async()=>{
    const f=await fixture(false,["pos.shift.difference"]),sale=await openAndSell(f);
    const closed=ok(await f.action("close",{sessionId:sale.session.id,counted:29,reason:"فرق تجريبي معلوم",unresolvedSalesCleared:true}));
    expect(closed.status).toBe("pending");
    const before=await evidence(f);
    ok(await f.action("approve_close",{sessionId:sale.session.id}),403);
    expect(await evidence(f)).toEqual(before);
    const approves=await Promise.all([1,2].map(async()=>f.owner.post("/api/pos/returns/actions").send({action:"approve_close",payload:await closingReviewPayload({sessionId:sale.session.id})})));
    expect(ok(approves[0]).status).toBe("approved");
    expect(ok(approves[1]).status).toBe("approved");
    expect((await rows("SELECT count(*)::int AS n FROM journal_entries WHERE company_id=$1 AND reference=$2",[f.company,`SHIFT-VAR-${sale.session.id}`]))[0].n).toBe(1);
  });
  it("records external refunds as pending until independent evidence, without claiming card network execution",async()=>{
    const f=await fixture(false,["pos.return.external"]),sale=await openAndSell(f,"card");
    const note=ok(await f.action("request",{...sale.noteBody,restock:false,disposition:"no_goods"}),201);
    const intent={noteId:note.id,receiptId:sale.invoice.receipts[0].id,sessionId:sale.session.id,
      amount:10,method:"card",reference:"طلب رد يدوي",idempotencyKey:randomUUID()};
    const before = await evidence(f);
    ok(await f.action("payout",{...intent,reference:"     "}),400);
    expect(await evidence(f)).toEqual(before);
    const refund=ok(await f.action("payout",intent));
    expect(refund.status).toBe("requested");
    ok(await f.action("close",{sessionId:sale.session.id,counted:20,unresolvedSalesCleared:true}),409);
    const proof={payoutId:refund.id,reference:"دليل مزود تجريبي بلا شبكة"};
    ok(await f.action("confirm_external",{...proof,reference:"    "}),400);
    expect(ok(await f.action("confirm_external",proof)).status).toBe("external_confirmed");
    // Reconstruct a pre-fix confirmed receipt in this disposable fixture.
    // The old bytes/fingerprint must replay; content validation is not a rewrite.
    const oldIntent = {...intent,reference:"     ",delivered:false};
    const oldFingerprint=createHash("sha256").update(JSON.stringify({
      noteId:note.id,receiptId:sale.invoice.receipts[0].id,sessionId:sale.session.id,amount:10,method:"card",
      reference:oldIntent.reference,delivered:false,idempotencyKey:intent.idempotencyKey,userId:f.identityId,
    })).digest("hex");
    await pool.query("UPDATE return_payouts SET fingerprint=$1 WHERE id=$2",[oldFingerprint,refund.id]);
    expect(ok(await f.action("payout",oldIntent)).id).toBe(refund.id);
    expect(ok(await f.action("confirm_external",proof)).status).toBe("external_confirmed");
    expect(ok(await f.action("close",{sessionId:sale.session.id,counted:20,unresolvedSalesCleared:true})).status).toBe("approved");
    expect((await evidence(f)).stock[0].quantity).toBe("19.0000");
  });
  it("rechecks a live payout revocation after waiting for the authority fence without extra financial effects",async()=>{
    const f=await fixture(true),sale=await openAndSell(f);
    const note=ok(await f.action("request",sale.noteBody),201),before=await evidence(f);
    const writer=await pool.connect();
    try{
      await writer.query("BEGIN");
      await writer.query("SELECT pg_advisory_xact_lock(174223,35)");
      await writer.query("UPDATE responsibility_grants SET actions=array_remove(actions,'pos.return.payout') WHERE id=$1",[f.grant.id]);
      const pid=(await writer.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      const pending=f.action("payout",{noteId:note.id,receiptId:sale.invoice.receipts[0].id,sessionId:sale.session.id,amount:10,
        method:"cash",reference:"اختبار سحب الصلاحية",delivered:true,idempotencyKey:randomUUID()}).then(r=>r);
      let waiting=false;
      for(let i=0;i<100;i++){
        if((await rows("SELECT count(*)::int AS n FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))",[pid]))[0].n){waiting=true;break;}
        await new Promise(r=>setTimeout(r,20));
      }
      await writer.query("COMMIT");
      expect(waiting).toBe(true);
      ok(await pending,403);
      expect(await evidence(f)).toEqual(before);
    }finally{await writer.query("ROLLBACK");writer.release();}
  });
  it("hides a different branch's order list, detail and actual PDF without widening old-role access",async()=>{
    const f=await fixture(true);
    const [b]=await db.insert(branchesTable).values({companyId:f.company,name:randomUUID(),nameAr:"فرع غير ممنوح",city:"جدة"}).returning();
    const [w]=await db.insert(warehousesTable).values({companyId:f.company,branchId:b.id,name:randomUUID(),nameAr:"مستودع غير ممنوح",isDefault:true}).returning();
    await db.transaction(tx=>recordStockMove(tx,{companyId:f.company,productId:f.product,quantity:5,unitCost:7,kind:"receipt",
      toWarehouseId:w.id,sourceType:"isolated_other_branch",sourceRef:randomUUID(),createdBy:f.identityId}));
    const session=ok(await f.owner.post("/api/pos/sessions").send({branchId:b.id,openingCash:0,cashierName:"مالك الشركة"}),201);
    const sale=ok(await f.owner.post("/api/pos/orders").send({sessionId:session.id,paymentMethod:"cash",items:[{productId:f.product,quantity:1,unitPrice:10}]}),201);
    ok(await f.get(`/pos/orders/${sale.id}`),403);
    ok(await f.get(`/pos/orders/${sale.id}/receipt.pdf`),403);
    expect(ok(await f.get("/pos/orders")).some((o:any)=>o.id===sale.id)).toBe(false);
    expect(ok(await f.get("/pos/returns/workspace")).invoices).toEqual([]);
  });
});
