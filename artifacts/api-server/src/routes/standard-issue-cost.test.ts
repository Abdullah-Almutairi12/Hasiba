import { beforeAll, describe, expect, it } from "vitest";
import {reviewedSalesInvoice} from "../test/reviewed-sales-invoice";
import request from "supertest";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import {
  db, pool, companiesTable, usersTable, userCompaniesTable, categoriesTable,
  productsTable, branchesTable, warehousesTable, posSessionsTable,
  fiscalYearsTable, fiscalPeriodsTable, stockLotsTable, productVariantsTable, customersTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import app, { assertApplicationReady } from "../app";
import { recordStockMove } from "../lib/stock-engine";

// Executed by test:isolated against a disposable PostgreSQL cluster.
beforeAll(assertApplicationReady);
let clientNumber = 100;
async function rows(query: string, params: unknown[] = []) {
  return (await pool.query(query, params)).rows;
}
function ok(response: request.Response, status = 201) {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  return response.body;
}
async function fixture() {
  const tag = `standard-issue-${randomUUID()}`;
  const [company] = await db.insert(companiesTable).values({ name: tag, vatRegistrationStatus: "not_registered" }).returning();
  const companyId = company.id;
  const year = new Date().getUTCFullYear();
  const [fy] = await db.insert(fiscalYearsTable).values({
    companyId, name: tag, startDate: `${year}-01-01`, endDate: `${year}-12-31`,
  }).returning();
  await db.insert(fiscalPeriodsTable).values({
    fiscalYearId: fy.id, name: tag, startDate: `${year}-01-01`, endDate: `${year}-12-31`, status: "open",
  });
  const password = "Synthetic-standard-only-123!";
  const [user] = await db.insert(usersTable).values({
    name: tag, email: `${tag}@example.invalid`, passwordHash: await bcrypt.hash(password, 4), role: "owner",
  }).returning();
  await db.insert(userCompaniesTable).values({ userId: user.id, companyId, role: "owner", isDefault: true });
  const [branch] = await db.insert(branchesTable).values({ companyId, name: tag, nameAr: tag, city: "Test" }).returning();
  const [warehouse] = await db.insert(warehousesTable).values({
    companyId, branchId: branch.id, name: tag, nameAr: tag, isDefault: true,
  }).returning();
  const [category] = await db.insert(categoriesTable).values({ name: tag, nameAr: tag }).returning();
  const [product] = await db.insert(productsTable).values({
    companyId, categoryId: category.id, name: tag, nameAr: tag, sku: tag,
    price: "100", costPrice: "10", stock: "0", costingMethod: "standard",
  }).returning();
  const [session] = await db.insert(posSessionsTable).values({
    sessionNumber: tag, cashierName: tag, branchId: branch.id, openingCash: "0", status: "open",
  }).returning();
  const [customer] = await db.insert(customersTable).values({ companyId, name: tag }).returning();
  const agent = request.agent(app);
  ok(await agent.post("/api/auth/login").set("X-Forwarded-For", `192.0.2.${++clientNumber}`)
    .send({ email: user.email, password }), 200);
  return { companyId, productId: product.id, warehouseId: warehouse.id, sessionId: session.id, customerId: customer.id, agent };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function receive(f: Fixture, quantity: number, unitCost?: number) {
  return db.transaction((tx) => recordStockMove(tx, {
    companyId: f.companyId, productId: f.productId, toWarehouseId: f.warehouseId,
    quantity, unitCost, kind: "receipt",
  }));
}
async function setStandard(f: Fixture, price: number) {
  await db.update(productsTable).set({ costPrice: String(price) }).where(eq(productsTable.id, f.productId));
}
async function sell(f: Fixture, quantity: number) {
  return ok(await f.agent.post("/api/pos/orders").send({
    sessionId: f.sessionId, customerId: f.customerId,
    items: [{ productId: f.productId, quantity }], paymentMethod: "cash", discount: 0,
  }));
}
async function manualIssue(f: Fixture, quantity: number, unitCost?: number) {
  return ok(await f.agent.post("/api/inventory/moves").send({
    productId: f.productId, warehouseId: f.warehouseId, quantity, unitCost, kind: "issue",
  }));
}
async function salesOrder(f: Fixture, quantity: number) {
  const order = ok(await f.agent.post("/api/sales/orders").send({
    customerId: f.customerId, warehouseId: f.warehouseId, status: "confirmed",
    lines: [{ productId: f.productId, description: "Synthetic standard sale", quantity, unitPrice: 100, taxRate: 0 }],
  }));
  const [line] = await rows("SELECT id FROM sales_order_lines WHERE so_id=$1", [order.id]);
  return { id: order.id as number, lineId: line.id as number };
}
async function fulfilment(order: { id: number; lineId: number }, status: string, delivered: number, invoiced: number) {
  expect(await rows("SELECT status FROM sales_orders WHERE id=$1", [order.id])).toEqual([{ status }]);
  expect(await rows(`SELECT delivered_qty::float8 AS delivered, invoiced_qty::float8 AS invoiced
    FROM sales_order_lines WHERE id=$1`, [order.lineId])).toEqual([{ delivered, invoiced }]);
}
async function deliveryIssues(f: Fixture) {
  return rows(`SELECT m.id, m.source_id, m.source_ref, m.from_warehouse_id, m.state,
    m.quantity::float8 AS quantity, m.unit_cost::float8 AS cost,
    (m.quantity*m.unit_cost)::float8 AS value,
    (SELECT sum(l.base_debit-l.base_credit)::float8 FROM journal_entry_lines l
      JOIN accounts a ON a.id=l.account_id WHERE l.entry_id=m.journal_entry_id AND a.system_key='cogs') AS cogs,
    (SELECT sum(l.base_credit-l.base_debit)::float8 FROM journal_entry_lines l
      JOIN accounts a ON a.id=l.account_id WHERE l.entry_id=m.journal_entry_id AND a.system_key='inventory') AS inventory
    FROM stock_moves m WHERE m.product_id=$1 AND m.kind='issue' AND m.source_type='delivery_order'
    ORDER BY m.id`, [f.productId]);
}
async function allocations(invoiceId: number) {
  return rows(`SELECT a.issue_move_id, a.quantity::float8 AS quantity, a.unit_cost::float8 AS cost,
    (a.quantity*a.unit_cost)::float8 AS value, il.so_line_id, il.product_id
    FROM sales_issue_allocations a JOIN customer_invoice_lines il ON il.id=a.invoice_line_id
    WHERE il.invoice_id=$1 ORDER BY a.id`, [invoiceId]);
}
async function stockEvidence(f: Fixture) {
  return {
    moves: await rows("SELECT * FROM stock_moves WHERE product_id=$1 ORDER BY id", [f.productId]),
    journals: await rows(`SELECT j.*, l.* FROM journal_entries j JOIN journal_entry_lines l ON l.entry_id=j.id
      WHERE j.company_id=$1 ORDER BY j.id,l.id`, [f.companyId]),
    quants: await rows("SELECT * FROM stock_quants WHERE product_id=$1 ORDER BY id", [f.productId]),
  };
}
async function reconcile(f: Fixture, expected: { quantity: number; inventory: number; cogs: number; profit: number }) {
  const balances = await rows(`SELECT a.system_key, sum(l.base_debit-l.base_credit)::float8 AS value
    FROM journal_entries j JOIN journal_entry_lines l ON l.entry_id=j.id JOIN accounts a ON a.id=l.account_id
    WHERE j.company_id=$1 AND j.status='posted' GROUP BY a.system_key`, [f.companyId]);
  const balance = (key: string) => Number(balances.find((r) => r.system_key === key)?.value ?? 0);
  const [quant] = await rows(`SELECT coalesce(sum(quantity),0)::float8 AS qty,
    coalesce(sum(quantity*avg_cost),0)::float8 AS value, min(avg_cost)::float8 AS min_cost
    FROM stock_quants WHERE product_id=$1`, [f.productId]);
  const [moves] = await rows(`SELECT
    coalesce(sum(CASE WHEN to_warehouse_id IS NOT NULL THEN quantity ELSE -quantity END),0)::float8 AS qty,
    coalesce(sum(CASE WHEN to_warehouse_id IS NOT NULL THEN quantity*unit_cost ELSE -quantity*unit_cost END),0)::float8 AS value
    FROM stock_moves WHERE product_id=$1 AND state='done'`, [f.productId]);
  const [product] = await rows("SELECT stock::float8 AS stock FROM products WHERE id=$1", [f.productId]);
  expect(quant.qty).toBe(expected.quantity);
  expect(moves.qty).toBe(expected.quantity);
  expect(product.stock).toBe(expected.quantity);
  expect(quant.value).toBeCloseTo(expected.inventory, 6);
  expect(moves.value).toBeCloseTo(expected.inventory, 6);
  expect(quant.min_cost ?? 0).toBeGreaterThanOrEqual(0);
  expect(balance("inventory")).toBeCloseTo(expected.inventory, 2);
  expect(balance("cogs")).toBeCloseTo(expected.cogs, 2);
  expect(-balance("sales_revenue") - balance("sales_discount") - balance("cogs")).toBeCloseTo(expected.profit, 2);
  const [unbalanced] = await rows(`SELECT count(*)::int AS count FROM (
    SELECT j.id FROM journal_entries j JOIN journal_entry_lines l ON l.entry_id=j.id
    WHERE j.company_id=$1 GROUP BY j.id HAVING abs(sum(l.base_debit-l.base_credit)) > 0.001
  ) q`, [f.companyId]);
  expect(unbalanced.count).toBe(0);
}

describe("prospective standard cost with realized differences net in COGS", () => {
  describe.each(["delivered", "ready"] as const)("sales order delivery via %s", (status) => {
    it.each([30, 4])("keeps carrying cost after the standard changes to %s, through invoicing", async (standard) => {
      const f = await fixture();
      await receive(f, 6, 10);
      const order = await salesOrder(f, 6);
      const original = await stockEvidence(f);
      // In the ready path, edit the price after picking but before shipping.
      const ready = status === "ready"
        ? ok(await f.agent.post("/api/sales/deliveries").send({ soId: order.id, status }))
        : null;
      if (ready) {
        expect(ready.status).toBe("ready");
        expect(await stockEvidence(f)).toEqual(original);
        await fulfilment(order, "confirmed", 0, 0);
      }
      await setStandard(f, standard);
      expect(await stockEvidence(f)).toEqual(original);
      await reconcile(f, { quantity: 6, inventory: 60, cogs: 0, profit: 0 });
      const delivery = ready
        ? ok(await f.agent.post(`/api/sales/deliveries/${ready.id}/transition`).send({ to: "delivered" }), 200)
        : ok(await f.agent.post("/api/sales/deliveries").send({ soId: order.id }));
      expect(delivery.status).toBe("delivered");
      await fulfilment(order, "fully_delivered", 6, 0);
      await reconcile(f, { quantity: 0, inventory: 0, cogs: 60, profit: -60 });
      const issues = await deliveryIssues(f);
      expect(issues).toEqual([{
        id: expect.any(Number), source_id: order.lineId, source_ref: delivery.reference,
        from_warehouse_id: f.warehouseId, state: "done", quantity: 6, cost: 10, value: 60, cogs: 60, inventory: 60,
      }]);
      const shipped = await stockEvidence(f);
      // A later standard edit cannot change either shipment evidence or invoice allocation.
      await setStandard(f, 99);
      expect(await stockEvidence(f)).toEqual(shipped);
      const invoice = ok(await reviewedSalesInvoice(f.agent,{ soId: order.id }));
      expect(await allocations(invoice.id)).toEqual([{
        issue_move_id: issues[0].id, quantity: 6, cost: 10, value: 60,
        so_line_id: order.lineId, product_id: f.productId,
      }]);
      await fulfilment(order, "invoiced", 6, 6);
      await reconcile(f, { quantity: 0, inventory: 0, cogs: 60, profit: 540 });
      // Invoicing posts revenue only: no new stock move or second COGS expense.
      const billed = await stockEvidence(f);
      expect(billed.moves).toEqual(shipped.moves);
      expect(billed.quants).toEqual(shipped.quants);
      for (const line of shipped.journals) expect(billed.journals).toContainEqual(line);
      expect(billed.moves[0]).toEqual(original.moves[0]);
    });
  });

  it.each([30, 4])("reconciles two partial deliveries and split invoice allocations with standards %s then changed again", async (standard) => {
    const f = await fixture();
    // Mixed receipts: carrying cost 16, distinct from both the original and edited standard.
    await receive(f, 2, 10);
    await receive(f, 4, 19);
    const order = await salesOrder(f, 6);
    const original = await stockEvidence(f);
    await setStandard(f, standard);
    expect(await stockEvidence(f)).toEqual(original);
    await reconcile(f, { quantity: 6, inventory: 96, cogs: 0, profit: 0 });
    const first = ok(await f.agent.post("/api/sales/deliveries").send({
      soId: order.id, lines: [{ soLineId: order.lineId, quantity: 2 }],
    }));
    await fulfilment(order, "partially_delivered", 2, 0);
    await reconcile(f, { quantity: 4, inventory: 64, cogs: 32, profit: -32 });
    const partial = await stockEvidence(f);
    await setStandard(f, standard === 30 ? 4 : 30);
    expect(await stockEvidence(f)).toEqual(partial);
    const second = ok(await f.agent.post("/api/sales/deliveries").send({ soId: order.id }));
    await fulfilment(order, "fully_delivered", 6, 0);
    await reconcile(f, { quantity: 0, inventory: 0, cogs: 96, profit: -96 });
    const issues = await deliveryIssues(f);
    expect(issues).toEqual([
      { id: expect.any(Number), source_id: order.lineId, source_ref: first.reference,
        from_warehouse_id: f.warehouseId, state: "done", quantity: 2, cost: 16, value: 32, cogs: 32, inventory: 32 },
      { id: expect.any(Number), source_id: order.lineId, source_ref: second.reference,
        from_warehouse_id: f.warehouseId, state: "done", quantity: 4, cost: 16, value: 64, cogs: 64, inventory: 64 },
    ]);
    const shipped = await stockEvidence(f);
    await setStandard(f, 99);
    expect(await stockEvidence(f)).toEqual(shipped);
    // The first invoice crosses the delivery boundary (2 + 1); the second
    // consumes only the remaining three units, not either whole issue again.
    const invoice1 = ok(await reviewedSalesInvoice(f.agent,{
      soId: order.id,
      lines: [{ productId: f.productId, description: "First half", quantity: 3, unitPrice: 100, taxRate: 0 }],
    }));
    const linked = { so_line_id: order.lineId, product_id: f.productId, cost: 16 };
    const firstAllocations = await allocations(invoice1.id);
    expect(firstAllocations).toEqual([
      { ...linked, issue_move_id: issues[0].id, quantity: 2, value: 32 },
      { ...linked, issue_move_id: issues[1].id, quantity: 1, value: 16 },
    ]);
    await fulfilment(order, "fully_delivered", 6, 3);
    await reconcile(f, { quantity: 0, inventory: 0, cogs: 96, profit: 204 });
    const invoice2 = ok(await reviewedSalesInvoice(f.agent,{ soId: order.id }));
    const secondAllocations = await allocations(invoice2.id);
    expect(secondAllocations).toEqual([
      { ...linked, issue_move_id: issues[1].id, quantity: 3, value: 48 },
    ]);
    expect(await allocations(invoice1.id)).toEqual(firstAllocations);
    expect([...firstAllocations, ...secondAllocations].reduce((sum, a) => sum + a.value, 0)).toBe(96);
    await fulfilment(order, "invoiced", 6, 6);
    await reconcile(f, { quantity: 0, inventory: 0, cogs: 96, profit: 504 });
    const billed = await stockEvidence(f);
    expect(billed.moves).toEqual(shipped.moves);
    expect(billed.quants).toEqual(shipped.quants);
    for (const line of shipped.journals) expect(billed.journals).toContainEqual(line);
    expect(billed.moves.slice(0, 2)).toEqual(original.moves);
  });

  it.each([30, 4])("reconciles manual issues after the standard changes to %s, including explicit costs and depletion", async (standard) => {
    const f = await fixture();
    const receipt = await receive(f, 6, 10);
    const originalMoves = await rows("SELECT * FROM stock_moves WHERE id=$1", [receipt.moveId]);
    const originalJournals = await rows(`SELECT l.* FROM journal_entry_lines l
      JOIN stock_moves m ON m.journal_entry_id=l.entry_id WHERE m.id=$1 ORDER BY l.id`, [receipt.moveId]);
    await setStandard(f, standard);
    // A price edit alone must not revalue stock or create a journal.
    await reconcile(f, { quantity: 6, inventory: 60, cogs: 0, profit: 0 });
    expect((await rows("SELECT count(*)::int AS n FROM stock_moves WHERE product_id=$1", [f.productId]))[0].n).toBe(1);
    expect((await rows("SELECT count(*)::int AS n FROM journal_entries WHERE company_id=$1", [f.companyId]))[0].n).toBe(1);
    await manualIssue(f, 2, standard);
    await reconcile(f, { quantity: 4, inventory: 40, cogs: 20, profit: -20 });
    await manualIssue(f, 4);
    await reconcile(f, { quantity: 0, inventory: 0, cogs: 60, profit: -60 });
    expect(await rows("SELECT * FROM stock_moves WHERE id=$1", [receipt.moveId])).toEqual(originalMoves);
    expect(await rows(`SELECT l.* FROM journal_entry_lines l JOIN stock_moves m ON m.journal_entry_id=l.entry_id
      WHERE m.id=$1 ORDER BY l.id`, [receipt.moveId])).toEqual(originalJournals);
    const issued = await rows("SELECT unit_cost::float8 AS cost FROM stock_moves WHERE product_id=$1 AND kind='issue'", [f.productId]);
    expect(issued.map((m) => m.cost)).toEqual([10, 10]);
    // Default receipt cost now uses the new standard, never the depleted quant.
    expect((await receive(f, 2)).unitCost).toBe(standard);
    await manualIssue(f, 2);
    await reconcile(f, { quantity: 0, inventory: 0, cogs: 60 + 2 * standard, profit: -60 - 2 * standard });
  });

  it.each([30, 4])("reconciles POS skipJournal sales after the standard changes to %s with mixed receipt costs", async (standard) => {
    const f = await fixture();
    await receive(f, 2, 10);
    await receive(f, 4, 20);
    await setStandard(f, standard);
    await sell(f, 2);
    await reconcile(f, { quantity: 4, inventory: 200 / 3, cogs: 100 / 3, profit: 200 - 100 / 3 });
    // A second edit before depletion cannot change the booked remainder.
    await setStandard(f, standard === 30 ? 50 : 2);
    await sell(f, 4);
    await reconcile(f, { quantity: 0, inventory: 0, cogs: 100, profit: 500 });
    const issues = await rows(`SELECT unit_cost::float8 AS cost, invoice_line_id FROM stock_moves
      WHERE product_id=$1 AND kind='issue' ORDER BY id`, [f.productId]);
    expect(issues).toHaveLength(2);
    for (const move of issues) {
      expect(move.cost).toBeCloseTo(50 / 3, 8);
      expect(move.invoice_line_id).not.toBeNull();
    }
  });

  it("values only the selected variant and lot, not other stock of the same product", async () => {
    const f = await fixture();
    await receive(f, 6, 10);
    const [variant] = await db.insert(productVariantsTable).values({ productId: f.productId, sku: `variant-${randomUUID()}` }).returning();
    const [lot] = await db.insert(stockLotsTable).values({ productId: f.productId, lotNumber: randomUUID() }).returning();
    const dimensions = { variantId: variant.id, lotId: lot.id };
    await db.transaction((tx) => recordStockMove(tx, {
      companyId: f.companyId, productId: f.productId, toWarehouseId: f.warehouseId,
      ...dimensions, kind: "receipt", quantity: 2, unitCost: 25,
    }));
    await setStandard(f, 99);
    const issued = await db.transaction((tx) => recordStockMove(tx, {
      companyId: f.companyId, productId: f.productId, fromWarehouseId: f.warehouseId,
      ...dimensions, kind: "issue", quantity: 2,
    }));
    expect(issued.unitCost).toBe(25);
    await reconcile(f, { quantity: 6, inventory: 60, cogs: 50, profit: -50 });
  });

  it("does not invent cost for missing or invalid carrying evidence and permits zero-cost stock", async () => {
    const f = await fixture();
    const issue = () => db.transaction((tx) => recordStockMove(tx, {
      companyId: f.companyId, productId: f.productId, fromWarehouseId: f.warehouseId,
      kind: "issue", quantity: 1,
    }));
    await expect(issue()).rejects.toThrow("قيمة دفترية صالحة");
    await receive(f, 2, 0);
    await setStandard(f, 99);
    expect((await issue()).unitCost).toBe(0);
    await reconcile(f, { quantity: 1, inventory: 0, cogs: 0, profit: 0 });
    await pool.query("UPDATE stock_quants SET avg_cost=-5 WHERE product_id=$1", [f.productId]);
    const before = await rows("SELECT * FROM stock_quants WHERE product_id=$1", [f.productId]);
    await expect(issue()).rejects.toThrow("قيمة دفترية صالحة");
    expect(await rows("SELECT * FROM stock_quants WHERE product_id=$1", [f.productId])).toEqual(before);
    expect((await rows("SELECT count(*)::int AS n FROM stock_moves WHERE product_id=$1", [f.productId]))[0].n).toBe(2);
  });
});
