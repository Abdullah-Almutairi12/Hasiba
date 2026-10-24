import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import {
  db, pool, companiesTable, usersTable, userCompaniesTable, categoriesTable,
  productsTable, customersTable, suppliersTable, branchesTable, warehousesTable, posSessionsTable,
  fiscalYearsTable, fiscalPeriodsTable,
  approvalRulesTable, approvalStepsTable, approvalRequestsTable,
  approverDelegationsTable,
} from "@workspace/db";
import app, { assertApplicationReady } from "../app";
import { postJournalEntry } from "../lib/journal-posting";
import { and, eq } from "drizzle-orm";

// Everything here is synthetic and retained only until the isolated cluster
// is destroyed. No SMTP, payment gateway, OCR, or production DB is contacted.
let maker: request.Agent, receiver: request.Agent, makerId: number;
let companyId: number, productId: number, warehouseId: number, customerId: number, supplierId: number, sessionId: number;
let poId: number, poLineId: number, posInvoiceId: number, posLineId: number;
let issuedCreditId: number, issuedCreditBody: object, issuedCreditKey: string;
const tag = `cycle-${Date.now()}`;
async function rows(query: string, args: unknown[] = []) { return (await pool.query(query, args)).rows; }
async function stock() {
  const [p] = await rows("SELECT stock FROM products WHERE id=$1", [productId]);
  return Number(p.stock);
}
async function totals() {
  const [r] = await rows(`SELECT
    (SELECT count(*)::int FROM journal_entries WHERE company_id=$1) AS journals,
    (SELECT count(*)::int FROM customer_invoices WHERE company_id=$1) AS invoices,
    (SELECT count(*)::int FROM pos_orders WHERE company_id=$1) AS orders,
    (SELECT count(*)::int FROM goods_receipts WHERE po_id IN (SELECT id FROM purchase_orders WHERE company_id=$1)) AS receipts,
    (SELECT count(*)::int FROM stock_moves WHERE product_id=$2) AS moves`, [companyId, productId]);
  return { ...r, stock: await stock() };
}
function sent(agent: request.Agent, path: string, body: object, key?: string) {
  const call = agent.post(`/api${path}`);
  if (key) call.set("Idempotency-Key", key);
  return call.send(body);
}
function ok(response: request.Response, status = 201) {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  return response.body;
}
async function createPo(quantity: number, key: string) {
  return ok(await sent(maker, "/procurement/purchase-orders", {
    supplierId, warehouseId, lines: [{ productId, description: tag, quantity, unitPrice: 50, taxRate: 0 }],
  }, key));
}
async function confirm(id: number) {
  const r = await sent(maker, `/procurement/purchase-orders/${id}/confirm`, {});
  expect(r.status, JSON.stringify(r.body)).toBe(200);
}

beforeAll(async () => {
  await assertApplicationReady();
  const [company] = await db.insert(companiesTable).values({ name: tag, vatRegistrationStatus: "not_registered" }).returning();
  companyId = company.id;
  const year = new Date().getUTCFullYear();
  const [fiscal] = await db.insert(fiscalYearsTable).values({
    companyId, name: `${tag}-${year}`, startDate: `${year}-01-01`, endDate: `${year}-12-31`,
  }).returning();
  await db.insert(fiscalPeriodsTable).values({
    fiscalYearId: fiscal.id, name: tag, startDate: `${year}-01-01`, endDate: `${year}-12-31`, status: "open",
  });
  const password = "Synthetic-Cycle-Only-123!";
  const passwordHash = await bcrypt.hash(password, 4);
  const accounts = await db.insert(usersTable).values(["maker", "receiver"].map((role) => ({
    name: `${tag}-${role}`, email: `${tag}-${role}@example.invalid`, passwordHash, role: "owner", isActive: true,
  }))).returning();
  makerId = accounts[0].id;
  await db.insert(userCompaniesTable).values(accounts.map((u) => ({ userId: u.id, companyId, role: "owner", isDefault: true })));
  const [branch] = await db.insert(branchesTable).values({ companyId, name: tag, nameAr: tag, city: "Test" }).returning();
  const [warehouse] = await db.insert(warehousesTable).values({ companyId, branchId: branch.id, name: tag, nameAr: tag, isDefault: true }).returning();
  warehouseId = warehouse.id;
  const [category] = await db.insert(categoriesTable).values({ name: tag, nameAr: tag }).returning();
  const [product] = await db.insert(productsTable).values({
    companyId, categoryId: category.id, name: tag, nameAr: tag, sku: tag, price: "100", costPrice: "50", stock: "0",
  }).returning();
  productId = product.id;
  const [customer] = await db.insert(customersTable).values({ companyId, name: tag }).returning();
  customerId = customer.id;
  const [supplier] = await db.insert(suppliersTable).values({ companyId, name: tag }).returning();
  supplierId = supplier.id;
  const [session] = await db.insert(posSessionsTable).values({ sessionNumber: tag, cashierName: tag, branchId: branch.id, openingCash: "0", status: "open" }).returning();
  sessionId = session.id;
  maker = request.agent(app); receiver = request.agent(app);
  for (const [i, agent] of [maker, receiver].entries()) {
    ok(await agent.post("/api/auth/login").send({ email: accounts[i].email, password }), 200);
  }
});

function deferredPosAuthorityTests() {
describe.sequential("deferred POS authority is live at financial execution", () => {
  let reviewer: request.Agent, delegated: request.Agent;
  let reviewerId: number, delegatedId: number, branchId: number;
  const activeRuleIds: number[] = [];
  let reviewSequence = 0;
  beforeAll(async () => {
    // Obtain real inventory through the existing GR/IR service, not a fake
    // stock total. This describe runs after the financial-cycle acceptance.
    const po = await createPo(20, "authority-inventory-po");
    await confirm(po.id);
    const [line] = await rows("SELECT id FROM purchase_order_lines WHERE po_id=$1", [po.id]);
    ok(await sent(receiver, "/procurement/goods-receipts", {
      poId: po.id, warehouseId, lines: [{ poLineId: line.id, quantity: 20 }],
    }, "authority-inventory-gr"));
    const [session] = await rows("SELECT branch_id FROM pos_sessions WHERE id=$1", [sessionId]);
    branchId = Number(session.branch_id);
    const password = "Synthetic-Authority-Only-123!";
    const accounts = await db.insert(usersTable).values(["reviewer", "delegate"].map(name => ({
      name: `${tag}-${name}`, email: `${tag}-${name}@example.invalid`,
      passwordHash: bcrypt.hashSync(password, 4), role: "manager", branchId, isActive: true,
    }))).returning();
    [reviewerId, delegatedId] = accounts.map(a => a.id);
    await db.insert(userCompaniesTable).values(accounts.map(a => ({ userId: a.id, companyId, role: "manager" })));
    reviewer = request.agent(app); delegated = request.agent(app);
    for (const [index, agent] of [reviewer, delegated].entries()) {
      ok(await agent.post("/api/auth/login").send({ email: accounts[index].email, password }), 200);
    }
    await rows("UPDATE user_companies SET role='cashier' WHERE user_id=$1 AND company_id=$2", [makerId, companyId]);
    await rows("UPDATE users SET branch_id=$1 WHERE id=$2", [branchId, makerId]);
  });
  afterAll(async () => {
    await rows("UPDATE user_companies SET role='owner' WHERE user_id=$1 AND company_id=$2", [makerId, companyId]);
    await rows("UPDATE users SET branch_id=NULL WHERE id=$1", [makerId]);
  });
  async function prepare(useDelegation = false, approve = true) {
    await rows("UPDATE users SET is_active=true,branch_id=$1 WHERE id IN ($2,$3)", [branchId, reviewerId, delegatedId]);
    await rows("INSERT INTO user_companies(user_id,company_id,role,is_default) VALUES($1,$2,'manager',false) ON CONFLICT(user_id,company_id) DO UPDATE SET role='manager'",
      [reviewerId, companyId]);
    await rows("DELETE FROM return_access WHERE company_id=$1 AND user_id IN ($2,$3)", [companyId, reviewerId, delegatedId]);
    await rows("DELETE FROM financial_limits WHERE company_id=$1 AND role='manager' AND action_key='pos.discount_pct'", [companyId]);
    await rows("DELETE FROM approver_delegations WHERE company_id=$1 AND from_user_id=$2", [companyId, reviewerId]);
    for (const id of activeRuleIds) await rows("UPDATE approval_rules SET is_active=false WHERE id=$1", [id]);
    const [session] = await db.insert(posSessionsTable).values({
      sessionNumber: `${tag}-authority-${++reviewSequence}`, cashierName: tag, branchId, status: "open", openingCash: "0",
    }).returning();
    const [rule] = await db.insert(approvalRulesTable).values({
      companyId, name: `${tag}-authority-${reviewSequence}`, docType: "pos_over_limit", branchId,
      minAmount: "0", mode: "sequential", isActive: true,
    }).returning();
    activeRuleIds.push(rule.id);
    await db.insert(approvalStepsTable).values({ ruleId: rule.id, sequence: 1, approverRole: "manager", approverUserId: reviewerId });
    let delegationId: number | undefined;
    if (useDelegation) {
      const [delegation] = await db.insert(approverDelegationsTable).values({
        companyId, fromUserId: reviewerId, toUserId: delegatedId,
        fromDate: new Date(Date.now() - 60_000), toDate: new Date(Date.now() + 3_600_000),
        branchId, docTypes: ["pos_over_limit"], maxAmount: "20",
      }).returning();
      delegationId = delegation.id;
    }
    const intent = { sessionId: session.id, customerId, items: [{ productId, quantity: 1 }], paymentMethod: "cash", discount: 10 };
    const blocked = await sent(maker, "/pos/orders", intent, `authority-request-${reviewSequence}`);
    expect(blocked.status, JSON.stringify(blocked.body)).toBe(403);
    const id = blocked.body.approvalRequestId as number;
    expect(id).toBeTypeOf("number");
    if (approve) {
      expect((await (useDelegation ? delegated : reviewer).post(`/api/workflow/approval-requests/${id}/act`).send({ action: "approve" })).status).toBe(200);
      const [action] = await rows("SELECT authority_fingerprint FROM approval_actions WHERE request_id=$1 AND action='approve'", [id]);
      expect(action.authority_fingerprint).toMatch(/^[a-f0-9]{64}$/);
    }
    return { id, sessionId: session.id, delegationId, intent, body: { ...intent, approvalRequestId: id }, key: `authority-execute-${reviewSequence}` };
  }
  it.each([false, true])("denies a new POS decision when approval is explicitly removed but read remains (delegate=%s)", async useDelegation => {
    const prepared = await prepare(useDelegation, false);
    const before = await totals();
    await rows("INSERT INTO return_access(company_id,user_id,template,capabilities,branches,updated_by) VALUES($1,$2,'branch_manager','[\"view\"]'::jsonb,$3::jsonb,$4)",
      [companyId, useDelegation ? delegatedId : reviewerId, JSON.stringify([branchId]), makerId]);
    const response = await (useDelegation ? delegated : reviewer).post(`/api/workflow/approval-requests/${prepared.id}/act`).send({ action: "approve" });
    expect(response.status).toBe(403);
    expect(await rows("SELECT id FROM approval_actions WHERE request_id=$1 AND action='approve'", [prepared.id])).toHaveLength(0);
    expect((await rows("SELECT status FROM approval_requests WHERE id=$1", [prepared.id]))[0].status).toBe("pending");
    expect(await totals()).toEqual(before);
  });
  it.each(["role", "membership", "account", "branch", "capability", "limit", "delegation_expiry", "delegation_revocation", "delegator_role", "delegate_capability", "delegator_capability"] as const)(
    "prevents a new effect after %s revocation and preserves the original decision", async kind => {
      const prepared = await prepare(kind.startsWith("delegat"));
      const before = await totals();
      if (kind === "role" || kind === "delegator_role") await rows("UPDATE user_companies SET role='sales' WHERE user_id=$1 AND company_id=$2", [reviewerId, companyId]);
      if (kind === "membership") await rows("DELETE FROM user_companies WHERE user_id=$1 AND company_id=$2", [reviewerId, companyId]);
      if (kind === "account") await rows("UPDATE users SET is_active=false WHERE id=$1", [reviewerId]);
      if (kind === "branch" || kind === "capability" || kind === "delegate_capability" || kind === "delegator_capability") {
        await rows("INSERT INTO return_access(company_id,user_id,template,capabilities,branches,updated_by) VALUES($1,$2,'branch_manager',$3::jsonb,$4::jsonb,$5)",
          [companyId, kind === "delegate_capability" ? delegatedId : reviewerId,
            JSON.stringify(kind === "branch" ? ["view", "approve"] : ["view"]), JSON.stringify(kind === "branch" ? [] : [branchId]), makerId]);
      }
      if (kind === "limit") await rows("INSERT INTO financial_limits(company_id,role,action_key,max_value) VALUES($1,'manager','pos.discount_pct',5)", [companyId]);
      if (kind === "delegation_expiry") await rows("UPDATE approver_delegations SET to_date=now()-interval '1 second' WHERE id=$1", [prepared.delegationId]);
      if (kind === "delegation_revocation") {
        expect((await reviewer.delete(`/api/workflow/delegations/${prepared.delegationId}`)).status).toBe(200);
        const [saved] = await rows("SELECT revoked_at,revoked_by FROM approver_delegations WHERE id=$1", [prepared.delegationId]);
        expect(saved.revoked_at).not.toBeNull();
        expect(saved.revoked_by).toBe(reviewerId);
      }
      const rejected = await sent(maker, "/pos/orders", prepared.body, prepared.key);
      expect(rejected.status, JSON.stringify(rejected.body)).toBe(403);
      expect(await totals()).toEqual(before);
      // A fresh submission is distinct from executing the old approval. It
      // recalculates the quote on the server and invalidates the old authority.
      const resubmitted = await sent(maker, "/pos/orders", prepared.intent, `authority-resubmit-${reviewSequence}`);
      expect(resubmitted.status, JSON.stringify(resubmitted.body)).toBe(403);
      expect(resubmitted.body.approvalRequestId).toBeTypeOf("number");
      expect(resubmitted.body.approvalRequestId).not.toBe(prepared.id);
      expect(await totals()).toEqual(before);
      const [historical] = await rows("SELECT status,decided_at,review_invalidated_at FROM approval_requests WHERE id=$1", [prepared.id]);
      expect(historical.status).toBe("approved");
      expect(historical.decided_at).not.toBeNull();
      expect(historical.review_invalidated_at).not.toBeNull();
      const [actions] = await rows("SELECT count(*)::int AS n FROM approval_actions WHERE request_id=$1 AND action='approve'", [prepared.id]);
      expect(actions.n).toBe(1);
    });
  async function waiter(blockerPid: number): Promise<number> {
    for (let attempt = 0; attempt < 150; attempt++) {
      const found = await rows("SELECT pid FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid)) AND pid<>pg_backend_pid()", [blockerPid]);
      if (found.length) return Number(found[0].pid);
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error("Expected a real PostgreSQL lock waiter, not a timing assumption");
  }
  it.each([false, true])("lets committed revocation win against waiting checkout (delegation=%s), with no effect", async delegatedReview => {
    const prepared = await prepare(delegatedReview);
    const before = await totals();
    const writer = await pool.connect();
    let checkout: Promise<request.Response> | undefined;
    try {
      await writer.query("BEGIN");
      const { rows: [backend] } = await writer.query("SELECT pg_backend_pid() AS pid");
      if (delegatedReview) await writer.query("UPDATE approver_delegations SET revoked_at=now(),revoked_by=$2 WHERE id=$1", [prepared.delegationId, reviewerId]);
      else await writer.query("UPDATE user_companies SET role='sales' WHERE user_id=$1 AND company_id=$2", [reviewerId, companyId]);
      checkout = sent(maker, "/pos/orders", prepared.body, prepared.key).then(r => r);
      await waiter(Number(backend.pid));
      await writer.query("COMMIT");
      expect((await checkout).status).toBe(403);
      expect(await totals()).toEqual(before);
    } finally { await writer.query("ROLLBACK"); writer.release(); if (checkout) await checkout; }
  });
  it("executes a valid bounded delegation once without promoting the cashier's session", async () => {
    const prepared = await prepare(true);
    const before = await totals();
    const response = await sent(maker, "/pos/orders", prepared.body, prepared.key);
    const first = ok(response);
    const after = await totals();
    expect(after.orders).toBe(before.orders + 1);
    expect(after.stock).toBe(before.stock - 1);
    const me = await maker.get("/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.role ?? me.body.user?.role).toBe("cashier");
    const retry = await sent(maker, "/pos/orders", prepared.body, prepared.key);
    expect(ok(retry).id).toBe(first.id);
    expect(await totals()).toEqual(after);
  });
  it("serializes revocation behind an executing checkout and replays its receipt after revocation", async () => {
    const prepared = await prepare();
    const before = await totals();
    const blocker = await pool.connect();
    let checkout: Promise<request.Response> | undefined, revoke: Promise<unknown> | undefined;
    try {
      await blocker.query("BEGIN");
      const { rows: [backend] } = await blocker.query("SELECT pg_backend_pid() AS pid");
      await blocker.query("SELECT id FROM pos_sessions WHERE id=$1 FOR UPDATE", [prepared.sessionId]);
      checkout = sent(maker, "/pos/orders", prepared.body, prepared.key).then(r => r);
      const checkoutPid = await waiter(Number(backend.pid)); // checkout has the shared authority fence
      revoke = rows("UPDATE user_companies SET role='sales' WHERE user_id=$1 AND company_id=$2", [reviewerId, companyId]);
      await waiter(checkoutPid); // revocation is proven blocked by that very checkout
      await blocker.query("COMMIT");
      const first = ok(await checkout);
      await revoke;
      const after = await totals();
      expect(after.orders).toBe(before.orders + 1);
      expect(after.stock).toBe(before.stock - 1);
      const replay = await sent(maker, "/pos/orders", prepared.body, prepared.key);
      expect(ok(replay).id).toBe(first.id);
      expect(replay.headers["idempotency-replayed"]).toBe("true");
      expect(await totals()).toEqual(after);
      const [member] = await rows("SELECT role FROM user_companies WHERE company_id=$1 AND user_id=$2", [companyId, reviewerId]);
      expect(member.role).toBe("sales");
      await rows("DELETE FROM user_companies WHERE user_id=$1 AND company_id=$2", [makerId, companyId]);
      try {
        expect((await sent(maker, "/pos/orders", prepared.body, prepared.key)).status).toBe(403);
        expect(await totals()).toEqual(after);
      } finally {
        await rows("INSERT INTO user_companies(user_id,company_id,role,is_default) VALUES($1,$2,'cashier',true)", [makerId, companyId]);
      }
    } finally { await blocker.query("ROLLBACK"); blocker.release(); if (checkout) await checkout; if (revoke) await revoke; }
  });
});

}

describe.sequential("purchase → receipt → POS sale → return → balanced books", () => {
  it("creates one PO for concurrent retries of the same financial intent", async () => {
    const body = { supplierId, warehouseId, lines: [{ productId, description: tag, quantity: 20, unitPrice: 50, taxRate: 0 }] };
    const replies = await Promise.all([sent(maker, "/procurement/purchase-orders", body, "cycle-purchase-001"), sent(maker, "/procurement/purchase-orders", body, "cycle-purchase-001")]);
    const a = ok(replies[0]), b = ok(replies[1]);
    expect(a.id).toBe(b.id); poId = a.id;
    const [line] = await rows("SELECT id FROM purchase_order_lines WHERE po_id=$1", [poId]); poLineId = line.id;
    await confirm(poId);
  });
  it("receives stock and posts one balanced GR-IR journal even after replay", async () => {
    const body = { poId, warehouseId, lines: [{ poLineId, quantity: 20 }] };
    const first = ok(await sent(receiver, "/procurement/goods-receipts", body, "cycle-receipt-001"));
    const before = await totals();
    const repeat = await sent(receiver, "/procurement/goods-receipts", body, "cycle-receipt-001");
    expect(ok(repeat).id).toBe(first.id);
    expect(repeat.headers["idempotency-replayed"]).toBe("true");
    expect(await totals()).toEqual(before); expect(await stock()).toBe(20);
  });
  it("posts the supplier bill once, then reverses it once under concurrent requests", async () => {
    const body = {
      supplierName: tag, invoiceNumber: `BILL-${tag}`, total: 1000, subtotal: 1000, vat: 0, poId, confidence: 1,
      fileUrl: "/api/storage/objects/invoices/2026-10-22/00000000-0000-4000-8000-000000000000.pdf",
      addToInventory: false, items: [{ productId, poLineId, description: tag, quantity: 20, unitPrice: 50, total: 1000 }],
    };
    const beforeInvalid = await totals();
    const invalid = await sent(receiver, "/invoices/from-scan", { ...body, items: [
      { ...body.items[0], quantity: 12, total: 600 }, { ...body.items[0], quantity: 12, total: 600 },
    ] }, "cycle-bill-001");
    expect(invalid.status).toBe(409); expect(await totals()).toEqual(beforeInvalid);
    const bill = ok(await sent(receiver, "/invoices/from-scan", body, "cycle-bill-001"), 200);
    const id = bill.id ?? bill.invoice?.id;
    expect(id).toBeTypeOf("number");
    const before = await totals();
    const again = ok(await sent(receiver, "/invoices/from-scan", body, "cycle-bill-001"), 200);
    expect(again.id ?? again.invoice?.id).toBe(id);
    expect(await totals()).toEqual(before);
    const reversals = await Promise.all([sent(maker, `/invoices/${id}/reverse`, { reason: "Synthetic reversal" }), sent(maker, `/invoices/${id}/reverse`, { reason: "Synthetic reversal" })]);
    expect(reversals.filter((r) => [200, 201].includes(r.status))).toHaveLength(1);
    expect(reversals.filter((r) => r.status === 409)).toHaveLength(1);
    expect(await stock()).toBe(20); // A billing reversal is NOT a physical supplier return.
  });
  it("sells stock through POS exactly once despite concurrent retries", async () => {
    const body = { sessionId, customerId, items: [{ productId, quantity: 2 }], paymentMethod: "cash", discount: 0 };
    const replies = await Promise.all([sent(maker, "/pos/orders", body, "cycle-pos-sale-001"), sent(maker, "/pos/orders", body, "cycle-pos-sale-001")]);
    const sale = ok(replies[0]); expect(ok(replies[1]).id).toBe(sale.id);
    expect(await stock()).toBe(18);
    const [invoice] = await rows("SELECT id FROM customer_invoices WHERE company_id=$1 AND source_ref=$2", [companyId, sale.orderNumber]);
    posInvoiceId = invoice.id;
    const [line] = await rows("SELECT id FROM customer_invoice_lines WHERE invoice_id=$1", [posInvoiceId]); posLineId = line.id;
  });
  it("returns sold stock once and prevents a credit exceeding the original sale", async () => {
    const body = { invoiceId: posInvoiceId, customerId, warehouseId, restock: true, reason: "Synthetic return", lines: [
      { invoiceLineId: posLineId, productId, description: tag, quantity: 2, unitPrice: 100, taxRate: 0 },
    ] };
    const returned = await Promise.all([
      sent(maker, "/sales/credit-notes", body, "cycle-return-001"),
      sent(maker, "/sales/credit-notes", body, "cycle-return-002"),
    ]);
    expect(returned.filter((r) => r.status === 201)).toHaveLength(1);
    expect(returned.filter((r) => r.status === 409)).toHaveLength(1);
    const winner = returned.findIndex((r) => r.status === 201);
    const credit = ok(returned[winner]);
    const replayKey = winner === 0 ? "cycle-return-001" : "cycle-return-002";
    issuedCreditId = credit.id; issuedCreditBody = body; issuedCreditKey = replayKey;
    const before = await totals();
    expect(ok(await sent(maker, "/sales/credit-notes", body, replayKey)).id).toBe(credit.id);
    expect(await totals()).toEqual(before); expect(await stock()).toBe(20);
    const invalid = await sent(maker, "/sales/credit-notes", body, "cycle-return-003");
    expect(invalid.status).toBe(409);
    expect(await totals()).toEqual(before);
    const ledger = await rows(`SELECT a.system_key, sum(l.debit-l.credit)::numeric AS balance
      FROM journal_entries e JOIN journal_entry_lines l ON l.entry_id=e.id JOIN accounts a ON a.id=l.account_id
      WHERE e.company_id=$1 AND a.system_key IN ('inventory','cogs') GROUP BY a.system_key`, [companyId]);
    expect(Number(ledger.find((r) => r.system_key === "inventory")?.balance)).toBe(1000);
    expect(Number(ledger.find((r) => r.system_key === "cogs")?.balance)).toBe(0);
  });
  it("keeps identical legitimate invoices distinct by intent, not by body", async () => {
    const body = { customerId, lines: [{ productId, description: tag, quantity: 1, unitPrice: 100, taxRate: 0 }] };
    const [a, b] = await Promise.all([sent(maker, "/sales/invoices", body, "cycle-sale-A"), sent(maker, "/sales/invoices", body, "cycle-sale-B")]);
    const saleA = ok(a), saleB = ok(b); expect(saleA.id).not.toBe(saleB.id);
    const before = await totals();
    expect(ok(await sent(maker, "/sales/invoices", body, "cycle-sale-A")).id).toBe(saleA.id);
    const conflict = await sent(maker, "/sales/invoices", { ...body, notes: "different intent" }, "cycle-sale-A");
    expect(conflict.status).toBe(409);
    expect(await totals()).toEqual(before);
    const r = await Promise.all([sent(maker, `/sales/invoices/${saleA.id}/reverse`, { reason: "Synthetic reversal" }), sent(maker, `/sales/invoices/${saleA.id}/reverse`, { reason: "Synthetic reversal" })]);
    expect(r.filter((v) => [200, 201].includes(v.status))).toHaveLength(1);
    expect(r.filter((v) => v.status === 409)).toHaveLength(1);
  });
  it("rolls back earlier receipt lines, stock and journals after a later line fails; the key is retryable", async () => {
    const po = await createPo(4, "cycle-rollback-po"); await confirm(po.id);
    const [line] = await rows("SELECT id FROM purchase_order_lines WHERE po_id=$1", [po.id]);
    const before = await totals();
    const failed = await sent(receiver, "/procurement/goods-receipts", {
      poId: po.id, warehouseId, lines: [{ poLineId: line.id, quantity: 1 }, { poLineId, quantity: 1 }],
    }, "cycle-rollback-grn");
    expect(failed.status).toBe(400);
    expect(await totals()).toEqual(before);
    const body = { poId: po.id, warehouseId, lines: [{ poLineId: line.id, quantity: 4 }] };
    const replies = await Promise.all([sent(receiver, "/procurement/goods-receipts", body, "cycle-rollback-grn"), sent(receiver, "/procurement/goods-receipts", body, "cycle-racing-grn")]);
    expect(replies.filter((r) => r.status === 201)).toHaveLength(1);
    expect(replies.filter((r) => r.status === 409)).toHaveLength(1);
    expect(await stock()).toBe(24);
  });
  it("rejects insufficient-stock POS without orphan orders, invoices or journal entries", async () => {
    const before = await totals();
    const result = await sent(maker, "/pos/orders", { sessionId, customerId, items: [{ productId, quantity: 10000 }], paymentMethod: "cash" }, "cycle-insufficient");
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(await totals()).toEqual(before);
  });
  it("deduplicates manual inventory movements and reconciles every posted journal", async () => {
    const body = { productId, warehouseId, kind: "adjustment_in", quantity: 1, unitCost: 50, notes: "Synthetic adjustment" };
    ok(await sent(maker, "/inventory/moves", body, "cycle-adjustment"));
    const before = await totals();
    ok(await sent(maker, "/inventory/moves", body, "cycle-adjustment"));
    expect(await totals()).toEqual(before); expect(await stock()).toBe(25);
    const unbalanced = await rows(`SELECT e.id FROM journal_entries e JOIN journal_entry_lines l ON l.entry_id=e.id
      WHERE e.company_id=$1 AND e.status='posted' GROUP BY e.id
      HAVING abs(sum(l.debit)-sum(l.credit)) > 0.005`, [companyId]);
    expect(unbalanced).toEqual([]);
    const [sum] = await rows(`SELECT sum(l.debit)::numeric AS debit, sum(l.credit)::numeric AS credit
      FROM journal_entries e JOIN journal_entry_lines l ON l.entry_id=e.id WHERE e.company_id=$1 AND e.status='posted'`, [companyId]);
    expect(Number(sum.debit)).toBeGreaterThan(0); expect(Number(sum.debit)).toBeCloseTo(Number(sum.credit), 2);
  });
  it("rolls back an already-written balanced journal when the outer transaction fails", async () => {
    const before = await totals();
    await expect(db.transaction(async (tx) => {
      await postJournalEntry(tx, { companyId, entryDate: new Date(), description: tag, source: "system" },
        [{ systemKey: "cash", debit: 10 }, { systemKey: "ap", credit: 10 }]);
      throw new Error("synthetic outer failure");
    })).rejects.toThrow("synthetic outer failure");
    expect(await totals()).toEqual(before);
  });
  it("accepts two legitimate concurrent POS intents with unique order numbers", async () => {
    const before = await stock();
    const body = { sessionId, customerId, items: [{ productId, quantity: 1 }], paymentMethod: "cash", discount: 0 };
    const [first, second] = await Promise.all([
      sent(maker, "/pos/orders", body, "cycle-pos-distinct-A"),
      sent(maker, "/pos/orders", body, "cycle-pos-distinct-B"),
    ]);
    const a = ok(first), b = ok(second);
    expect(a.id).not.toBe(b.id); expect(a.orderNumber).not.toBe(b.orderNumber);
    expect(await stock()).toBe(before - 2);
  });
  it("replays a committed POS order after its one-use approval has been consumed", async () => {
    const beforeStock = await stock();
    const [unbound] = await db.insert(approvalRequestsTable).values({
      companyId, docType: "pos_over_limit", recordId: sessionId,
      recordRef: `POS session #${sessionId} — pos.discount_pct`, amount: "10", status: "approved",
    }).returning();
    const refused = await sent(maker, "/pos/orders", {
      sessionId, customerId, items: [{ productId, quantity: 1 }], paymentMethod: "cash",
      discount: 10, approvalRequestId: unbound.id,
    }, "cycle-unbound-approval");
    expect(refused.status, JSON.stringify(refused.body)).toBe(403);
    expect(await stock()).toBe(beforeStock);
    const [session] = await rows("SELECT branch_id FROM pos_sessions WHERE id=$1", [sessionId]);
    const intent = { sessionId, customerId, items: [{ productId, quantity: 1 }], paymentMethod: "cash", discount: 10 };
    const configured = await receiver.post("/api/workflow/approval-rules").send({
      name: `${tag}-checkout-review`, docType: "pos_over_limit", branchId: Number(session.branch_id),
      minAmount: 0, mode: "sequential", isActive: true, steps: [{ sequence: 1, approverRole: "owner" }],
    });
    expect(configured.status).toBe(201);
    await db.update(userCompaniesTable).set({ role: "cashier" }).where(and(eq(userCompaniesTable.userId, makerId), eq(userCompaniesTable.companyId, companyId)));
    // A real cashier needs an explicitly assigned branch; the owner fixture
    // previously had no branch and must not inherit owner-wide POS authority.
    await db.update(usersTable).set({ branchId: Number(session.branch_id) }).where(eq(usersTable.id, makerId));
    try {
    const blocked = await sent(maker, "/pos/orders", intent, "cycle-approval-quote");
    expect(blocked.status, JSON.stringify(blocked.body)).toBe(403);
    expect(blocked.body.approvalRequestId, JSON.stringify(blocked.body)).toBeTypeOf("number");
    let approvalId = blocked.body.approvalRequestId as number;
    const decision = await receiver.post(`/api/workflow/approval-requests/${approvalId}/act`).send({ action: "approve" });
    expect(decision.status, JSON.stringify({ error: decision.body, review: (await receiver.get(`/api/workflow/approval-requests/${approvalId}`)).body })).toBe(200);
    const beforeQuoteChange = await totals();
    const [pricedProduct] = await db.select({ price: productsTable.price }).from(productsTable).where(eq(productsTable.id, productId));
    try {
      await db.update(productsTable).set({ price: "111" }).where(eq(productsTable.id, productId));
      const repriced = await sent(maker, "/pos/orders", { ...intent, approvalRequestId: approvalId }, "cycle-repriced-approval");
      expect(repriced.status, JSON.stringify(repriced.body)).toBe(403);
      expect(repriced.body.approvalRequestId).toBeTypeOf("number");
      expect(repriced.body.approvalRequestId).not.toBe(approvalId);
      expect(await totals()).toEqual(beforeQuoteChange);
      const [superseded] = await rows("SELECT status,review_invalidated_at FROM approval_requests WHERE id=$1", [approvalId]);
      expect(superseded.status).toBe("approved");
      expect(superseded.review_invalidated_at).not.toBeNull();
      approvalId = repriced.body.approvalRequestId as number;
      expect((await receiver.post(`/api/workflow/approval-requests/${approvalId}/act`).send({ action: "approve" })).status).toBe(200);
    } finally {
      await db.update(productsTable).set({ price: pricedProduct.price }).where(eq(productsTable.id, productId));
    }
    // Restoring the earlier price does not resurrect superseded authority.
    const restored = await sent(maker, "/pos/orders", { ...intent, approvalRequestId: approvalId }, "cycle-restored-approval");
    expect(restored.status, JSON.stringify(restored.body)).toBe(403);
    expect(restored.body.approvalRequestId).toBeTypeOf("number");
    expect(restored.body.approvalRequestId).not.toBe(approvalId);
    expect(await totals()).toEqual(beforeQuoteChange);
    approvalId = restored.body.approvalRequestId as number;
    expect((await receiver.post(`/api/workflow/approval-requests/${approvalId}/act`).send({ action: "approve" })).status).toBe(200);
    const body = { ...intent, approvalRequestId: approvalId };
    const original = ok(await sent(maker, "/pos/orders", body, "cycle-approved-pos"));
    const [consumed] = await rows("SELECT status FROM approval_requests WHERE id=$1", [approvalId]);
    expect(consumed.status).toBe("consumed");
    const before = await totals();
    // Discarding the original response and reissuing exactly this body/key
    // is the HTTP equivalent of the client losing success after commit.
    const replay = await sent(maker, "/pos/orders", body, "cycle-approved-pos");
    expect(ok(replay).id).toBe(original.id);
    expect(replay.headers["idempotency-replayed"]).toBe("true");
    expect(await totals()).toEqual(before);
    // A different intent must NOT reuse the consumed authority.
    expect((await sent(maker, "/pos/orders", body, "cycle-new-approval-intent")).status).toBe(403);
    expect(await totals()).toEqual(before);
    } finally {
      await db.update(userCompaniesTable).set({ role: "owner" }).where(and(eq(userCompaniesTable.userId, makerId), eq(userCompaniesTable.companyId, companyId)));
      await db.update(usersTable).set({ branchId: null }).where(eq(usersTable.id, makerId));
      await rows("UPDATE approval_rules SET is_active=false WHERE id=$1 AND company_id=$2", [configured.body.id, companyId]);
    }
  });
  it("does not regress or reissue a credit note when approval rules change before replay", async () => {
    const [rule] = await db.insert(approvalRulesTable).values({
      companyId,
      name: `Changed credit policy ${tag}`, docType: "credit_note", minAmount: "0", mode: "sequential", isActive: true,
    }).returning();
    try {
      await db.insert(approvalStepsTable).values({ ruleId: rule.id, sequence: 1, approverRole: "manager", minAmount: "0" });
      const before = await totals();
      const [note] = await rows("SELECT status, journal_entry_id FROM credit_notes WHERE id=$1", [issuedCreditId]);
      expect(["issued", "applied"]).toContain(note.status);
      const [approvalsBefore] = await rows("SELECT count(*)::int AS n FROM approval_requests WHERE doc_type='credit_note' AND record_id=$1", [issuedCreditId]);
      const replays = await Promise.all([
        sent(maker, "/sales/credit-notes", issuedCreditBody, issuedCreditKey),
        sent(maker, "/sales/credit-notes", issuedCreditBody, issuedCreditKey),
      ]);
      for (const replay of replays) expect(ok(replay).id).toBe(issuedCreditId);
      const [after] = await rows("SELECT status, journal_entry_id FROM credit_notes WHERE id=$1", [issuedCreditId]);
      const [approvalsAfter] = await rows("SELECT count(*)::int AS n FROM approval_requests WHERE doc_type='credit_note' AND record_id=$1", [issuedCreditId]);
      expect(after).toEqual(note);
      expect(approvalsAfter.n).toBe(approvalsBefore.n);
      expect(await totals()).toEqual(before);
    } finally {
      await db.delete(approvalRulesTable).where(eq(approvalRulesTable.id, rule.id));
    }
  });
  it("rejects unbalanced and non-finite journal values before writing", async () => {
    const before = await totals();
    const header = { companyId, entryDate: new Date(), description: tag };
    await expect(db.transaction((tx) => postJournalEntry(tx, header,
      [{ systemKey: "cash", debit: 10 }, { systemKey: "ap", credit: 9 }]))).rejects.toThrow("غير متوازن");
    await expect(db.transaction((tx) => postJournalEntry(tx, header,
      [{ systemKey: "cash", debit: NaN }, { systemKey: "ap", credit: 10 }]))).rejects.toThrow("أرقاماً صالحة");
    await expect(db.transaction((tx) => postJournalEntry(tx, { ...header, exchangeRate: Infinity },
      [{ systemKey: "cash", debit: 10 }, { systemKey: "ap", credit: 10 }]))).rejects.toThrow("سعر الصرف");
    expect(await totals()).toEqual(before);
  });
});

deferredPosAuthorityTests();
