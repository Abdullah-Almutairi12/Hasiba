import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { db, pool, companiesTable, usersTable, userCompaniesTable, branchesTable, warehousesTable,
  categoriesTable, productsTable, employeesTable, fiscalYearsTable, fiscalPeriodsTable } from "@workspace/db";
import app, { assertApplicationReady } from "../app";
import { recordStockMove } from "../lib/stock-engine";
import type { TeamPerson } from "../lib/team-catalog";

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
  const actions = ["pos.read","pos.sell","pos.shift.open","pos.discount","pos.payment.record","pos.shift.close",
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
    ok(await request(app).post("/api/auth/team-activation/accept").send({ token: invite.activationToken, password }));
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
  const action = (name: string, payload: unknown) => post("/pos/returns/actions", { action: name, payload });
  return { owner, agent, get, post, action, company: c.id, branch: b.id, wh: w.id, product: p.id, person, employee, identityId, grant };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function openAndSell(f: Fixture, method = "cash") {
  const session = ok(await f.post("/pos/sessions", { branchId: f.branch, openingCash: 20, cashierName: "اسم الطلب" }), 201);
  const sale = ok(await f.post("/pos/orders", { sessionId: session.id, paymentMethod: method,
    items: [{ productId: f.product, quantity: 1, unitPrice: 10 }] }), 201);
  const invoice = ok(await f.get("/pos/returns/workspace")).invoices[0];
  const noteBody = { customerId: invoice.customer_id, invoiceId: invoice.id, warehouseId: f.wh, restock: true,
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
    ok(await request(app).post("/api/auth/team-activation/accept").send({token:invite.activationToken,password}));
    const agent=actorAgent();ok(await agent.post("/api/auth/login").send({email:person.email,password}));
    let grant=ok(await agent.get("/api/workspace/access")).grants[0];
    const approve=()=>agent.post("/api/pos/returns/actions").set("X-Workspace-Responsibility",String(grant.id))
      .send({action:"approve_close",payload:{sessionId:sale.session.id}});
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
    ok(await f.post("/pos/orders", { ...body, items: [{ productId: f.product, quantity: 1, unitPrice: 10 }], discount: 1,
      paymentMethod: "card", payments: [{ method: "card", amount: 9, reference: "دليل تحصيل تجريبي" }] }), 201);
    const workspace = ok(await f.get("/pos/returns/workspace"));
    const invoice = workspace.invoices.find((i: any) => Number(i.total) === 20);
    const line = invoice.lines[0], receipt = invoice.receipts[0];
    for (let n=0; n<2; n++) {
      const req = { customerId: invoice.customer_id, invoiceId: invoice.id, warehouseId: f.wh, restock: true,
        disposition: "resale", settlementMethod: "cash", proofRef: `استلام فعلي تجريبي${n}`, reason: "مرتجع تجريبي",
        lines: [{ invoiceLineId: line.id, productId: f.product, description: "منتج الدورة", quantity: 1, unitPrice: 10, taxRate: 0 }],
        idempotencyKey: randomUUID() };
      const note = ok(await f.action("request", req), 201);
      expect(note.status).toBe("issued");
      expect(ok(await f.action("request", req), 201).id).toBe(note.id);
      const refund = { noteId: note.id, receiptId: receipt.id, sessionId: session.id, amount: 10, method: "cash",
        reference: "تم تسليم النقد تجريبيًا", delivered: true, idempotencyKey: randomUUID() };
      const payouts = await Promise.all([f.action("payout", refund),f.action("payout", refund)]);
      expect(ok(payouts[0]).id).toBe(ok(payouts[1]).id);
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
  });
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
    const approves=await Promise.all([1,2].map(()=>f.owner.post("/api/pos/returns/actions").send({action:"approve_close",payload:{sessionId:sale.session.id}})));
    expect(ok(approves[0]).status).toBe("approved");
    expect(ok(approves[1]).status).toBe("approved");
    expect((await rows("SELECT count(*)::int AS n FROM journal_entries WHERE company_id=$1 AND reference=$2",[f.company,`SHIFT-VAR-${sale.session.id}`]))[0].n).toBe(1);
  });
  it("records external refunds as pending until independent evidence, without claiming card network execution",async()=>{
    const f=await fixture(false,["pos.return.external"]),sale=await openAndSell(f,"card");
    const note=ok(await f.action("request",{...sale.noteBody,restock:false,disposition:"no_goods"}),201);
    const refund=ok(await f.action("payout",{noteId:note.id,receiptId:sale.invoice.receipts[0].id,sessionId:sale.session.id,
      amount:10,method:"card",reference:"طلب رد يدوي",idempotencyKey:randomUUID()}));
    expect(refund.status).toBe("requested");
    ok(await f.action("close",{sessionId:sale.session.id,counted:20,unresolvedSalesCleared:true}),409);
    const proof={payoutId:refund.id,reference:"دليل مزود تجريبي بلا شبكة"};
    expect(ok(await f.action("confirm_external",proof)).status).toBe("external_confirmed");
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
