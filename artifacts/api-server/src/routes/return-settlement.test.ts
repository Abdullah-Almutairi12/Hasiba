import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { db, pool, companiesTable, usersTable, userCompaniesTable, branchesTable, warehousesTable,
  categoriesTable, productsTable, posSessionsTable, fiscalYearsTable, fiscalPeriodsTable } from "@workspace/db";
import app, { assertApplicationReady } from "../app";
import { recordStockMove } from "../lib/stock-engine";

beforeAll(assertApplicationReady);
let address = 90;
const action = (agent: ReturnType<typeof request.agent>, name: string, payload: Record<string, unknown>) =>
  agent.post("/api/pos/returns/actions").send({ action: name, payload });
function ok(r: request.Response, status = 200) { expect(r.status, JSON.stringify(r.body)).toBe(status); return r.body; }
async function fixture(method: "cash" | "card" = "cash") {
  const tag = randomUUID(), password = "Synthetic-only-Returns-123!";
  const [company] = await db.insert(companiesTable).values({ name: tag, vatRegistrationStatus: "not_registered" }).returning();
  const [branch] = await db.insert(branchesTable).values({ companyId: company.id, name: tag, nameAr: tag, city: "Test" }).returning();
  const [otherBranch] = await db.insert(branchesTable).values({ companyId: company.id, name: `${tag}-other`, nameAr: "فرع ثان", city: "Test" }).returning();
  const [warehouse] = await db.insert(warehousesTable).values({ companyId: company.id, branchId: branch.id, name: tag, nameAr: tag, isDefault: true }).returning();
  const year = new Date().getUTCFullYear();
  const [fy] = await db.insert(fiscalYearsTable).values({ companyId: company.id, name: tag, startDate: `${year}-01-01`, endDate: `${year}-12-31` }).returning();
  await db.insert(fiscalPeriodsTable).values({ fiscalYearId: fy.id, name: tag, startDate: `${year}-01-01`, endDate: `${year}-12-31`, status: "open" });
  const [category] = await db.insert(categoriesTable).values({ name: tag, nameAr: tag }).returning();
  const [product] = await db.insert(productsTable).values({ companyId: company.id, categoryId: category.id, sku: tag,
    name: tag, nameAr: "منتج اختبار", price: "100", costPrice: "10", stock: "0", costingMethod: "fifo" }).returning();
  await db.transaction(tx => recordStockMove(tx, { companyId: company.id, productId: product.id,
    toWarehouseId: warehouse.id, quantity: 20, unitCost: 10, kind: "receipt", sourceRef: tag }));
  const [session] = await db.insert(posSessionsTable).values({ sessionNumber: tag, branchId: branch.id, cashierName: tag, openingCash: "0" }).returning();
  const agents = [];
  for (const role of ["owner", "cashier", "manager"] as const) {
    const [user] = await db.insert(usersTable).values({ name: `${role}-${tag}`, email: `${role}-${tag}@example.invalid`,
      role, branchId: branch.id, passwordHash: await bcrypt.hash(password, 4) }).returning();
    await db.insert(userCompaniesTable).values({ userId: user.id, companyId: company.id, role, isDefault: true });
    const agent = request.agent(app);
    ok(await agent.post("/api/auth/login").set("X-Forwarded-For", `192.0.2.${++address}`).send({ email: user.email, password }), 200);
    agents.push({ agent, user });
  }
  const [owner, cashier, manager] = agents;
  const sale = ok(await cashier.agent.post("/api/pos/orders").set("Idempotency-Key", randomUUID()).send({
    sessionId: session.id, paymentMethod: method, discount: 0,
    items: [{ productId: product.id, productName: product.nameAr, quantity: 4, unitPrice: 100 }],
  }), 201);
  const workspace = ok(await cashier.agent.get("/api/pos/returns/workspace"));
  expect(workspace.invoices, JSON.stringify({ sale, invoices: workspace.invoices })).toHaveLength(1);
  const invoice = workspace.invoices[0];
  expect(invoice).toBeTruthy();
  const noteBody = (quantity = 1) => ({ invoiceId: invoice.id, customerId: invoice.customer_id, warehouseId: warehouse.id,
    reason: "طلب مرتجع تجريبي", disposition: "no_goods", settlementMethod: method, restock: false,
    proofRef: `إثبات الفاتورة ${invoice.reference}`, idempotencyKey: randomUUID(),
    lines: [{ invoiceLineId: invoice.lines[0].id, productId: product.id, description: product.nameAr,
      quantity, unitPrice: 100, taxRate: 0 }] });
  async function note(quantity = 1) {
    const created = ok(await action(cashier.agent, "request", noteBody(quantity)), 202);
    ok(await action(manager.agent, "approve", { noteId: created.id, comment: "تم التحقق من مصدر الاستحقاق" }));
    return created;
  }
  const payment = (noteId: number, value = 100) => ({ noteId, receiptId: invoice.receipts[0].id, sessionId: session.id,
    amount: value, method, reference: "تسليم لصاحب السند", delivered: method === "cash", idempotencyKey: randomUUID() });
  return { company, branch, otherBranch, warehouse, product, session, owner, cashier, manager, invoice, noteBody, note, payment };
}
describe("branch-authorized return / approval / refund / till lifecycle", () => {
  it("noncash remains requested and reserved until authorized external evidence; blocks closing and posts only once on confirmation", async () => {
    const f = await fixture("card"), note = await f.note();
    const p = ok(await action(f.cashier.agent, "payout", f.payment(note.id)));
    expect(p.status).toBe("requested"); expect(p.journal_id).toBeNull();
    expect((await action(f.cashier.agent, "close", { sessionId: f.session.id, counted: 0, unresolvedSalesCleared: true })).status).toBe(409);
    expect((await action(f.cashier.agent, "confirm_external", { payoutId: p.id, reference: "بنك خارجي" })).status).toBe(403);
    const confirmed = ok(await action(f.owner.agent, "confirm_external", { payoutId: p.id, reference: "إثبات خارجي مصطنع" }));
    expect(confirmed.status).toBe("external_confirmed"); expect(confirmed.journal_id).toBeTruthy();
    const replay = ok(await action(f.owner.agent, "confirm_external", { payoutId: p.id, reference: "إثبات خارجي مصطنع" }));
    expect(replay.journal_id).toBe(confirmed.journal_id);
    const workspace = ok(await f.owner.agent.get("/api/pos/returns/workspace"));
    expect(workspace.sessions[0].expected).toBe(0);
    ok(await action(f.cashier.agent, "close", { sessionId: f.session.id, counted: 0, unresolvedSalesCleared: true }));
  });
  it("records a till expense once and posts the approved cash shortage without erasing the counted difference", async () => {
    const f = await fixture(), note = await f.note();
    ok(await action(f.cashier.agent, "payout", f.payment(note.id)));
    const workspace = ok(await f.owner.agent.get("/api/pos/returns/workspace"));
    expect(workspace.accounts.length).toBeGreaterThan(0);
    const body = { sessionId: f.session.id, accountId: workspace.accounts[0].id, amount: 20,
      reference: "مصروف موثق تجريبي", delivered: true, idempotencyKey: randomUUID() };
    const exp = ok(await action(f.manager.agent, "expense", body));
    expect(ok(await action(f.manager.agent, "expense", body)).id).toBe(exp.id);
    const closing = ok(await action(f.cashier.agent, "close", { sessionId: f.session.id, counted: 275,
      reason: "عجز خمسة موثق", unresolvedSalesCleared: true }));
    expect(Number(closing.expected)).toBe(280); expect(Number(closing.difference)).toBe(-5);
    ok(await action(f.manager.agent, "approve_close", { sessionId: f.session.id }));
    const balance = await pool.query(`SELECT sum(l.debit-l.credit) AS cash FROM journal_entry_lines l
      JOIN journal_entries j ON j.id=l.entry_id JOIN accounts a ON a.id=l.account_id
      WHERE j.company_id=$1 AND a.system_key='cash'`, [f.company.id]);
    expect(Number(balance.rows[0].cash)).toBe(275);
  });
  it("400 collected, approved return 100, one cash voucher, original receipt preserved, expected cash 300 and closed accurately", async () => {
    const f = await fixture(), note = await f.note();
    const body = f.payment(note.id);
    const paid = ok(await action(f.cashier.agent, "payout", body));
    const replay = ok(await action(f.cashier.agent, "payout", body));
    expect(replay.id).toBe(paid.id);
    const receipt = await pool.query("SELECT amount FROM customer_receipts WHERE id=$1", [body.receiptId]);
    expect(Number(receipt.rows[0].amount)).toBe(400);
    const count = await pool.query("SELECT count(*)::int AS n FROM return_payouts WHERE note_id=$1", [note.id]);
    expect(count.rows[0].n).toBe(1);
    const workspace = ok(await f.cashier.agent.get("/api/pos/returns/workspace"));
    expect(workspace.sessions.find((s: { id: number }) => s.id === f.session.id).expected).toBe(300);
    expect(Number((await pool.query("SELECT stock FROM products WHERE id=$1", [f.product.id])).rows[0].stock)).toBe(16);
    const gl = await pool.query("SELECT sum(debit)-sum(credit) AS delta FROM journal_entry_lines WHERE entry_id=$1", [paid.journal_id]);
    expect(Number(gl.rows[0].delta)).toBe(0);
    ok(await action(f.cashier.agent, "close", { sessionId: f.session.id, counted: 300, reason: "متطابق", unresolvedSalesCleared: true }));
    expect((await pool.query("SELECT status FROM pos_sessions WHERE id=$1", [f.session.id])).rows[0].status).toBe("closed");
    expect((await action(f.cashier.agent, "payout", f.payment(note.id, 1))).status).toBe(409);
  });
  it("serializes competing payouts, allows partial then remainder and prevents overpayment or reuse after credit settlement", async () => {
    const f = await fixture(), note = await f.note();
    const results = await Promise.all([action(f.cashier.agent, "payout", f.payment(note.id, 70)),
      action(f.cashier.agent, "payout", f.payment(note.id, 70))]);
    expect(results.map(r => r.status).sort()).toEqual([200, 409]);
    ok(await action(f.cashier.agent, "payout", f.payment(note.id, 30)));
    expect((await action(f.cashier.agent, "payout", f.payment(note.id, 0.01))).status).toBe(409);
    const used = await f.note();
    await pool.query("UPDATE credit_notes SET status='applied' WHERE id=$1", [used.id]);
    expect((await action(f.cashier.agent, "payout", f.payment(used.id))).status).toBe(409);
    const total = await pool.query("SELECT sum(amount) AS amount FROM return_payouts WHERE note_id=$1", [note.id]);
    expect(Number(total.rows[0].amount)).toBe(100);
  });
  it("enforces refreshed capability and branch restrictions, owner-only configuration, no self-grant and foreign company rejection", async () => {
    const f = await fixture(), foreign = await fixture(), note = await f.note();
    expect((await action(f.cashier.agent, "approve", { noteId: note.id, comment: "غير مسموح" })).status).toBe(403);
    expect((await action(f.cashier.agent, "configure_access", { userId: f.cashier.user.id, template: "finance_manager",
      capabilities: ["approve"], branches: [f.branch.id] })).status).toBe(403);
    expect((await action(f.owner.agent, "configure_access", { userId: f.owner.user.id, template: "finance_manager",
      capabilities: ["approve"], branches: [f.branch.id] })).status).toBe(403);
    ok(await action(f.owner.agent, "configure_access", { userId: f.cashier.user.id, template: "cashier",
      capabilities: ["view", "payout"], branches: [f.otherBranch.id] }));
    expect((await action(f.cashier.agent, "payout", f.payment(note.id))).status).toBe(403);
    expect(ok(await f.cashier.agent.get("/api/pos/returns/workspace")).notes).toHaveLength(0);
    expect((await f.cashier.agent.get(`/api/sales/invoices/${f.invoice.id}`)).status).toBe(403);
    expect((await f.cashier.agent.get(`/api/sales/invoices/${f.invoice.id}/pdf`)).status).toBe(403);
    expect((await f.cashier.agent.get("/api/pos/orders")).body).toHaveLength(0);
    expect((await action(f.cashier.agent, "export", {})).status).toBe(403);
    expect((await action(foreign.owner.agent, "payout", f.payment(note.id))).status).toBe(404);
    ok(await action(f.owner.agent, "configure_access", { userId: f.manager.user.id, template: "branch_manager",
      capabilities: ["view", "request", "approve", "payout", "close"], branches: [f.branch.id] }));
    expect((await f.manager.agent.get("/api/hr/employees")).status).toBe(403);
  });
  it("rejects a changed approved document, self-approval, bad disposition and cross-invoice use of anonymous cash entitlement", async () => {
    const f = await fixture();
    ok(await action(f.owner.agent, "configure_policy", { branchId: f.branch.id, approvalAbove: 0, allowResale: false }));
    const self = ok(await action(f.manager.agent, "request", f.noteBody()), 202);
    expect((await action(f.manager.agent, "approve", { noteId: self.id, comment: "اعتماد نفسي" })).status).toBeGreaterThanOrEqual(400);
    const wrong = { ...f.noteBody(), disposition: "resale", restock: true };
    expect((await action(f.cashier.agent, "request", wrong)).status).toBe(400);
    ok(await action(f.owner.agent, "configure_policy", { branchId: f.branch.id, approvalAbove: 0, allowResale: true }));
    await pool.query("UPDATE companies SET business_type='fb' WHERE id=$1", [f.company.id]);
    expect((await action(f.cashier.agent, "request", wrong)).status).toBe(400);
    const changed = ok(await action(f.cashier.agent, "request", f.noteBody()), 202);
    await pool.query("UPDATE credit_notes SET reason='تغيرت بيانات مؤثرة' WHERE id=$1", [changed.id]);
    expect((await action(f.manager.agent, "approve", { noteId: changed.id, comment: "محاولة اعتماد" })).status).toBeGreaterThanOrEqual(400);
    const valid = await f.note();
    const sale = ok(await f.cashier.agent.post("/api/pos/orders").set("Idempotency-Key", randomUUID()).send({
      sessionId: f.session.id, paymentMethod: "cash", items: [{ productId: f.product.id, productName: "اختبار", quantity: 1, unitPrice: 100 }],
    }), 201);
    const workspace = ok(await f.cashier.agent.get("/api/pos/returns/workspace"));
    const other = workspace.invoices.find((i: { id: number }) => i.id !== f.invoice.id);
    const body = { ...f.payment(valid.id), receiptId: other.receipts[0].id };
    expect((await action(f.cashier.agent, "payout", body)).status).toBe(400);
    expect((await action(f.cashier.agent, "payout", { ...f.payment(valid.id), delivered: false })).status).toBe(400);
    ok(await action(f.cashier.agent, "payout", f.payment(valid.id)));
    expect((await f.owner.agent.post(`/api/sales/credit-notes/${valid.id}/cancel`).send({})).status).toBe(409);
  });
  it("preserves nonzero till difference and requires another authorized approver; never silently zeroes it", async () => {
    const f = await fixture();
    const close = ok(await action(f.cashier.agent, "close", { sessionId: f.session.id, counted: 390,
      reason: "عجز نقدي موثق", unresolvedSalesCleared: true }));
    expect(Number(close.difference)).toBe(-10);
    expect(close.status).toBe("pending");
    expect((await action(f.cashier.agent, "approve_close", { sessionId: f.session.id })).status).toBe(403);
    ok(await action(f.manager.agent, "approve_close", { sessionId: f.session.id }));
    const row = (await pool.query("SELECT * FROM pos_cash_closings WHERE session_id=$1", [f.session.id])).rows[0];
    expect(Number(row.expected)).toBe(400); expect(Number(row.counted)).toBe(390); expect(Number(row.difference)).toBe(-10);
    expect(row.created_by).toBe(f.cashier.user.id); expect(row.approved_by).toBe(f.manager.user.id);
  });
});
