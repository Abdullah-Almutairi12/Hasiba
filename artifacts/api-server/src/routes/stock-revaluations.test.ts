import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { db, pool, companiesTable, usersTable, userCompaniesTable, categoriesTable, productsTable,
  branchesTable, warehousesTable, fiscalYearsTable, fiscalPeriodsTable, accountsTable, stockLotsTable, productVariantsTable } from "@workspace/db";
import app, { assertApplicationReady } from "../app";
import { recordStockMove } from "../lib/stock-engine";
import { reverseJournalEntry } from "../lib/journal-posting";

beforeAll(assertApplicationReady);
const rows = async (q: string, p: unknown[] = []) => (await pool.query(q, p)).rows;
function ok(r: request.Response, status = 200) {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  return r.body;
}
let ip = 10;
async function fixture() {
  const tag = `reval-${randomUUID()}`;
  const [company] = await db.insert(companiesTable).values({ name: tag, vatRegistrationStatus: "not_registered" }).returning();
  const year = new Date().getUTCFullYear();
  const [fy] = await db.insert(fiscalYearsTable).values({
    companyId: company.id, name: tag, startDate: `${year}-01-01`, endDate: `${year}-12-31`,
  }).returning();
  const [period] = await db.insert(fiscalPeriodsTable).values({
    fiscalYearId: fy.id, name: tag, startDate: `${year}-01-01`, endDate: `${year}-12-31`, status: "open",
  }).returning();
  async function actor(role: string) {
    const email = `${randomUUID()}@example.invalid`;
    const password = "Synthetic-revaluation-only-123!";
    const [u] = await db.insert(usersTable).values({
      name: tag, email, passwordHash: await bcrypt.hash(password, 4), role,
    }).returning();
    await db.insert(userCompaniesTable).values({ userId: u.id, companyId: company.id, role, isDefault: true });
    const agent = request.agent(app);
    ok(await agent.post("/api/auth/login").set("X-Forwarded-For", `198.51.100.${++ip}`).send({ email, password }));
    return { agent, id: u.id };
  }
  const creator = await actor("inventory"), approver = await actor("accountant");
  const [branch] = await db.insert(branchesTable).values({ companyId: company.id, name: tag, nameAr: tag, city: "Test" }).returning();
  const [warehouse] = await db.insert(warehousesTable).values({
    companyId: company.id, branchId: branch.id, name: tag, nameAr: tag, isDefault: true,
  }).returning();
  const [category] = await db.insert(categoriesTable).values({ name: tag, nameAr: tag }).returning();
  const [product] = await db.insert(productsTable).values({
    companyId: company.id, categoryId: category.id, sku: tag, name: tag, nameAr: tag,
    price: "100", costPrice: "10", costingMethod: "standard",
  }).returning();
  const [variance] = await db.insert(accountsTable).values({
    code: tag, name: tag, nameAr: tag, type: "expense",
  }).returning();
  const receipt = await db.transaction((tx) => recordStockMove(tx, {
    companyId: company.id, productId: product.id, toWarehouseId: warehouse.id, kind: "receipt", quantity: 6, unitCost: 10,
  }));
  const [quant] = await rows("SELECT id FROM stock_quants WHERE product_id=$1", [product.id]);
  return { companyId: company.id, productId: product.id, warehouseId: warehouse.id, quantId: quant.id,
    varianceId: variance.id, periodId: period.id, creator, approver, actor, receiptId: receipt.moveId };
}
type F = Awaited<ReturnType<typeof fixture>>;
const standard = (f: F, cost: number) => rows("UPDATE products SET cost_price=$1 WHERE id=$2", [cost, f.productId]);
const preview = (f: F, key = randomUUID(), overrides = {}) => f.creator.agent.post("/api/inventory/revaluations")
  .set("Idempotency-Key", key).send({ quantId: f.quantId, varianceAccountId: f.varianceId, reason: "قرار إعادة تقييم موثق", ...overrides });
const transition = (f: F, id: number, action: string, actor = f.creator) =>
  actor.agent.post(`/api/inventory/revaluations/${id}/${action}`).send({});
const issue = (f: F, quantity: number) => db.transaction((tx) => recordStockMove(tx, {
  companyId: f.companyId, productId: f.productId, fromWarehouseId: f.warehouseId, kind: "issue", quantity,
}));
async function reconcile(f: F, qty: number, value: number, cogs: number, variance: number) {
  const [q] = await rows("SELECT sum(quantity)::float8 qty, sum(quantity*avg_cost)::float8 value FROM stock_quants WHERE product_id=$1", [f.productId]);
  const [ledger] = await rows(`SELECT
    coalesce(sum(CASE WHEN to_warehouse_id IS NOT NULL THEN quantity ELSE -quantity END),0)::float8 qty,
    coalesce(sum(CASE WHEN to_warehouse_id IS NOT NULL THEN quantity*unit_cost ELSE -quantity*unit_cost END),0)::float8 value
    FROM stock_moves WHERE product_id=$1 AND state='done'`, [f.productId]);
  const [r] = await rows("SELECT coalesce(sum(new_value-old_value),0)::float8 value FROM stock_revaluations WHERE company_id=$1 AND status='posted'", [f.companyId]);
  const balances = await rows(`SELECT a.id, a.system_key, sum(l.base_debit-l.base_credit)::float8 value FROM journal_entries j
    JOIN journal_entry_lines l ON l.entry_id=j.id JOIN accounts a ON a.id=l.account_id
    WHERE j.company_id=$1 AND j.status='posted' GROUP BY a.id,a.system_key`, [f.companyId]);
  const balance = (key: string) => Number(balances.find((a) => a.system_key === key)?.value ?? 0);
  const actualVariance = Number(balances.find((a) => a.id === f.varianceId)?.value ?? 0);
  expect(q.qty).toBe(qty); expect(ledger.qty).toBe(qty);
  expect(q.value).toBeCloseTo(value, 6);
  expect(ledger.value + r.value).toBeCloseTo(value, 6);
  expect(balance("inventory")).toBeCloseTo(value, 2);
  expect(balance("cogs")).toBeCloseTo(cogs, 2);
  expect(actualVariance).toBeCloseTo(variance, 2);
  expect(-balance("cogs") - actualVariance).toBeCloseTo(-cogs - variance, 2);
  const [cache] = await rows("SELECT stock::float8 qty FROM products WHERE id=$1", [f.productId]);
  expect(cache.qty).toBe(qty);
  const [bad] = await rows(`SELECT count(*)::int n FROM (SELECT j.id FROM journal_entries j
    JOIN journal_entry_lines l ON l.entry_id=j.id WHERE j.company_id=$1
    GROUP BY j.id HAVING abs(sum(l.base_debit-l.base_credit))>0.001) t`, [f.companyId]);
  expect(bad.n).toBe(0);
}

describe("approved standard stock revaluation with PostgreSQL evidence", () => {
  it.each([30, 4, 0])("previews, confirms and posts standard %s without changing history; reconciles full depletion and profit", async (cost) => {
    const f = await fixture();
    const history = await rows("SELECT * FROM stock_moves WHERE id=$1", [f.receiptId]);
    const journals = await rows("SELECT * FROM journal_entries WHERE company_id=$1 ORDER BY id", [f.companyId]);
    await standard(f, cost);
    const p = ok(await preview(f), 201);
    expect(Number(p.delta)).toBe(6 * (cost - 10));
    await reconcile(f, 6, 60, 0, 0);
    expect((await transition(f, p.id, "approve", f.approver)).status).toBe(409);
    ok(await transition(f, p.id, "confirm"));
    const posted = ok(await transition(f, p.id, "approve", f.approver));
    expect(posted.status).toBe("posted");
    expect(posted.approvedBy).toBe(f.approver.id);
    await reconcile(f, 6, cost * 6, 0, 60 - cost * 6);
    // Repeated/concurrent approvals cannot post twice, even with no browser key.
    const repeat = await Promise.all([transition(f, p.id, "approve", f.approver), transition(f, p.id, "approve", f.approver)]);
    repeat.forEach((r) => expect(ok(r).journalEntryId).toBe(posted.journalEntryId));
    const [count] = await rows("SELECT count(*)::int n FROM journal_entries WHERE source_ref=$1", [`stock_revaluation:${p.id}`]);
    expect(count.n).toBe(1);
    await expect(db.transaction((tx) => reverseJournalEntry(tx, posted.journalEntryId, f.approver.id, f.companyId)))
      .rejects.toThrow("لا يمكن عكس");
    await expect(rows("UPDATE stock_revaluations SET reason='changed' WHERE id=$1", [p.id])).rejects.toThrow("immutable");
    expect(await rows("SELECT * FROM stock_moves WHERE id=$1", [f.receiptId])).toEqual(history);
    expect(await rows("SELECT * FROM journal_entries WHERE id=$1", [journals[0].id])).toEqual(journals);
    await standard(f, 99); // prospective edits still cannot revalue.
    await issue(f, 2);
    await reconcile(f, 4, cost * 4, cost * 2, 60 - cost * 6);
    await issue(f, 4);
    await reconcile(f, 0, 0, cost * 6, 60 - cost * 6);
    expect((await rows("SELECT count(*)::int n FROM audit_logs WHERE company_id=$1 AND action LIKE 'stock_revaluation.%'", [f.companyId]))[0].n).toBe(3);
  });
  it("durably deduplicates preview intent and rejects different payload under the same key", async () => {
    const f = await fixture(); await standard(f, 20);
    const key = randomUUID();
    const rs = await Promise.all([preview(f, key), preview(f, key)]);
    expect(ok(rs[0], 201).id).toBe(ok(rs[1], 201).id);
    expect((await preview(f, key, { reason: "سبب مختلف تمامًا" })).status).toBe(409);
    expect((await f.creator.agent.post("/api/inventory/revaluations").send({
      quantId: f.quantId, varianceAccountId: f.varianceId, reason: "بدون مفتاح",
    })).status).toBe(400);
  });
  it.each(["issue", "price", "receipt"])("refuses stale %s snapshots without financial/stock writes and supports cancellation", async (change) => {
    const f = await fixture(); await standard(f, 30);
    const p = ok(await preview(f), 201); ok(await transition(f, p.id, "confirm"));
    if (change === "issue") await issue(f, 1);
    if (change === "price") await standard(f, 31);
    if (change === "receipt") await db.transaction((tx) => recordStockMove(tx, {
      companyId: f.companyId, productId: f.productId, toWarehouseId: f.warehouseId, kind: "receipt", quantity: 1, unitCost: 10,
    }));
    expect((await transition(f, p.id, "approve", f.approver)).status).toBe(409);
    expect((await rows("SELECT count(*)::int n FROM journal_entries WHERE source_ref=$1", [`stock_revaluation:${p.id}`]))[0].n).toBe(0);
    ok(await transition(f, p.id, "cancel")); ok(await transition(f, p.id, "cancel"));
    expect((await transition(f, p.id, "confirm")).status).toBe(409);
  });
  it("serializes an issue racing approval: either stale rejection or new carrying cost, never mixed valuation", async () => {
    const f = await fixture(); await standard(f, 30);
    const p = ok(await preview(f), 201); ok(await transition(f, p.id, "confirm"));
    const [approval, issued] = await Promise.all([transition(f, p.id, "approve", f.approver), issue(f, 2)]);
    if (approval.status === 200) {
      expect(issued.unitCost).toBe(30); await reconcile(f, 4, 120, 60, -120);
    } else {
      expect(approval.status, JSON.stringify(approval.body)).toBe(409);
      expect(issued.unitCost).toBe(10); await reconcile(f, 4, 40, 20, 0);
    }
  });
  it("revalues only the selected lot/variant and rejects a competing preview after one approval", async () => {
    const f = await fixture();
    const [lot] = await db.insert(stockLotsTable).values({ productId: f.productId, lotNumber: randomUUID() }).returning();
    const [variant] = await db.insert(productVariantsTable).values({ productId: f.productId, sku: randomUUID() }).returning();
    await db.transaction((tx) => recordStockMove(tx, {
      companyId: f.companyId, productId: f.productId, toWarehouseId: f.warehouseId, kind: "receipt",
      quantity: 2, unitCost: 25, lotId: lot.id, variantId: variant.id,
    }));
    const [q] = await rows("SELECT id FROM stock_quants WHERE product_id=$1 AND lot_id=$2 AND variant_id=$3", [f.productId, lot.id, variant.id]);
    await standard(f, 30);
    const a = ok(await preview(f, randomUUID(), { quantId: q.id }), 201);
    const b = ok(await preview(f, randomUUID(), { quantId: q.id }), 201);
    ok(await transition(f, a.id, "confirm")); ok(await transition(f, b.id, "confirm"));
    ok(await transition(f, a.id, "approve", f.approver));
    expect((await transition(f, b.id, "approve", f.approver)).status).toBe(409);
    await reconcile(f, 8, 120, 0, -10);
    const [unchanged] = await rows("SELECT quantity::float8 qty, avg_cost::float8 cost FROM stock_quants WHERE id=$1", [f.quantId]);
    expect(unchanged).toEqual({ qty: 6, cost: 10 });
    const issued = await db.transaction((tx) => recordStockMove(tx, {
      companyId: f.companyId, productId: f.productId, fromWarehouseId: f.warehouseId, kind: "issue",
      quantity: 2, lotId: lot.id, variantId: variant.id,
    }));
    expect(issued.unitCost).toBe(30);
    await reconcile(f, 6, 60, 60, -10);
  });
  it("allocates journal cents from before/after values while retaining exact physical cost", async () => {
    const f = await fixture();
    await issue(f, 6);
    await db.transaction((tx) => recordStockMove(tx, {
      companyId: f.companyId, productId: f.productId, toWarehouseId: f.warehouseId,
      kind: "receipt", quantity: 0.5003, unitCost: 19.996002398560863,
    }));
    // Old value 10.004 rounds 10.00, new value 10.006 rounds 10.01;
    // rounding only their difference would incorrectly produce zero.
    await standard(f, 20);
    const p = ok(await preview(f), 201);
    expect(Number(p.delta)).toBe(0.01);
    ok(await transition(f, p.id, "confirm")); ok(await transition(f, p.id, "approve", f.approver));
    await reconcile(f, 0.5003, 10.006, 60, -0.01);
    await issue(f, 0.5003);
    await reconcile(f, 0, 0, 70.01, -0.01);
  });
  it("enforces tenant/role boundaries, independent approval and rollback in closed periods", async () => {
    const f = await fixture(); await standard(f, 30);
    const other = await fixture(); await standard(other, 20);
    expect((await preview(f, randomUUID(), { quantId: other.quantId })).status).toBe(404);
    const p = ok(await preview(f), 201); ok(await transition(f, p.id, "confirm"));
    expect((await transition(other, p.id, "approve", other.approver)).status).toBe(404);
    expect((await transition(f, p.id, "approve")).status).toBe(403);
    // A finance creator cannot approve their own preview.
    const own = ok(await f.approver.agent.post("/api/inventory/revaluations").set("Idempotency-Key", randomUUID())
      .send({ quantId: f.quantId, varianceAccountId: f.varianceId, reason: "طلب مالي موثق" }), 201);
    ok(await transition(f, own.id, "confirm", f.approver));
    expect((await transition(f, own.id, "approve", f.approver)).status).toBe(403);
    const auditor = await f.actor("auditor"), cashier = await f.actor("cashier");
    ok(await auditor.agent.get("/api/inventory/revaluations"));
    expect((await transition(f, p.id, "confirm", auditor)).status).toBe(403);
    expect((await cashier.agent.get("/api/inventory/revaluations")).status).toBe(403);
    await rows("UPDATE fiscal_periods SET status='closed' WHERE id=$1", [f.periodId]);
    expect((await transition(f, p.id, "approve", f.approver)).status).toBe(403);
    await reconcile(f, 6, 60, 0, 0);
    expect((await rows("SELECT status FROM stock_revaluations WHERE id=$1", [p.id]))[0].status).toBe("confirmed");
    await rows("UPDATE fiscal_periods SET status='open' WHERE id=$1", [f.periodId]);
    ok(await transition(f, p.id, "approve", f.approver));
    await reconcile(f, 6, 180, 0, -120);
  });
  it("rejects unchanged, nonstandard, scrap and disabled/system variance accounts", async () => {
    const f = await fixture();
    expect((await preview(f)).status).toBe(400);
    await standard(f, 30);
    await rows("UPDATE accounts SET is_active=false WHERE id=$1", [f.varianceId]);
    expect((await preview(f)).status).toBe(400);
    await rows("UPDATE accounts SET is_active=true WHERE id=$1", [f.varianceId]);
    const p = ok(await preview(f), 201); ok(await transition(f, p.id, "confirm"));
    await rows("UPDATE accounts SET is_active=false WHERE id=$1", [f.varianceId]);
    expect((await transition(f, p.id, "approve", f.approver)).status).toBe(400);
    await rows("UPDATE products SET costing_method='fifo' WHERE id=$1", [f.productId]);
    expect((await preview(f)).status).toBe(404);
    await rows("UPDATE products SET costing_method='standard' WHERE id=$1", [f.productId]);
    await rows("UPDATE warehouses SET is_scrap=true WHERE id=$1", [f.warehouseId]);
    expect((await preview(f)).status).toBe(404);
  });
});
