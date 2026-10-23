import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import {
  db, pool, companiesTable, usersTable, userCompaniesTable, categoriesTable,
  productsTable, customersTable, suppliersTable, branchesTable, warehousesTable, posSessionsTable,
  fiscalYearsTable, fiscalPeriodsTable,
  approvalRulesTable, approvalStepsTable, approvalRequestsTable,
} from "@workspace/db";
import app, { assertApplicationReady } from "../app";
import { postJournalEntry } from "../lib/journal-posting";
import { eq } from "drizzle-orm";

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
    const [approval] = await db.insert(approvalRequestsTable).values({
      companyId,
      submittedByUserId: makerId, branchId: Number(session.branch_id),
      docType: "pos_over_limit", recordId: sessionId, recordRef: `POS session #${sessionId} — pos.discount_pct`,
      amount: "10", status: "approved", submittedByName: tag,
    }).returning();
    const body = { sessionId, customerId, items: [{ productId, quantity: 1 }], paymentMethod: "cash", discount: 10, approvalRequestId: approval.id };
    const original = ok(await sent(maker, "/pos/orders", body, "cycle-approved-pos"));
    const [consumed] = await rows("SELECT status FROM approval_requests WHERE id=$1", [approval.id]);
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
