import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import {
  db, pool, companiesTable, usersTable, userCompaniesTable, categoriesTable,
  productsTable, customersTable, branchesTable, warehousesTable, posSessionsTable,
  fiscalYearsTable, fiscalPeriodsTable, customerInvoicesTable, customerInvoiceLinesTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import app, { assertApplicationReady } from "../app";
import { recordStockMove } from "../lib/stock-engine";
import { postJournalEntry } from "../lib/journal-posting";

// Run only through test:isolated: all rows are synthetic in a disposable PG cluster.
beforeAll(assertApplicationReady);
async function rows(sql: string, params: unknown[] = []) { return (await pool.query(sql, params)).rows; }
function ok(response: request.Response, status = 201) {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  return response.body;
}
async function fixture(method: "fifo" | "average" | "standard" = "fifo") {
  const tag = `return-cost-${randomUUID()}`;
  const [company] = await db.insert(companiesTable).values({ name: tag, vatRegistrationStatus: "not_registered" }).returning();
  const companyId = company.id;
  const year = new Date().getUTCFullYear();
  const [fy] = await db.insert(fiscalYearsTable).values({
    companyId, name: tag, startDate: `${year}-01-01`, endDate: `${year}-12-31`,
  }).returning();
  await db.insert(fiscalPeriodsTable).values({
    fiscalYearId: fy.id, name: tag, startDate: `${year}-01-01`, endDate: `${year}-12-31`, status: "open",
  });
  const password = "Synthetic-return-only-123!";
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
    price: "100", costPrice: "10", stock: "0", costingMethod: method,
  }).returning();
  const [customer] = await db.insert(customersTable).values({ companyId, name: tag }).returning();
  const [session] = await db.insert(posSessionsTable).values({
    sessionNumber: tag, cashierName: tag, branchId: branch.id, openingCash: "0", status: "open",
  }).returning();
  const agent = request.agent(app);
  ok(await agent.post("/api/auth/login").send({ email: user.email, password }), 200);
  // Distinct inbound cost layers: 2×10 + 4×20 = SAR 100.
  await db.transaction(async (tx) => {
    for (const [quantity, unitCost] of [[2, 10], [4, 20]]) {
      await recordStockMove(tx, {
        companyId, productId: product.id, toWarehouseId: warehouse.id,
        kind: "receipt", quantity, unitCost, sourceRef: tag,
      });
    }
  });
  return { tag, companyId, productId: product.id, warehouseId: warehouse.id, customerId: customer.id, sessionId: session.id, agent };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function sale(f: Fixture, items = [{ productId: f.productId, quantity: 4 }]) {
  const pos = ok(await f.agent.post("/api/pos/orders").send({
    sessionId: f.sessionId, customerId: f.customerId, items, paymentMethod: "cash", discount: 0,
  }));
  const [invoice] = await rows("SELECT * FROM customer_invoices WHERE company_id=$1 AND source_ref=$2", [f.companyId, pos.orderNumber]);
  const lines = await rows("SELECT * FROM customer_invoice_lines WHERE invoice_id=$1 ORDER BY id", [invoice.id]);
  return { invoice, lines };
}
function returnBody(f: Fixture, invoiceId: number, invoiceLineId: number, quantity: number, unitPrice = 100, restock = true) {
  return {
    invoiceId, customerId: f.customerId, warehouseId: f.warehouseId, restock,
    lines: [{ invoiceLineId, productId: f.productId, description: f.tag, quantity, unitPrice, taxRate: 0 }],
  };
}
async function reconcile(f: Fixture, expected: { inventory: number; cogs: number; profit: number }, fifo = true) {
  const balances = await rows(`SELECT a.system_key, sum(l.base_debit-l.base_credit)::float8 AS value
    FROM journal_entries j JOIN journal_entry_lines l ON l.entry_id=j.id JOIN accounts a ON a.id=l.account_id
    WHERE j.company_id=$1 AND j.status='posted' GROUP BY a.system_key`, [f.companyId]);
  const balance = (key: string) => Number(balances.find((r) => r.system_key === key)?.value ?? 0);
  const [quant] = await rows("SELECT sum(quantity*avg_cost)::float8 AS value FROM stock_quants WHERE product_id=$1", [f.productId]);
  const [moves] = await rows(`SELECT sum(CASE WHEN to_warehouse_id IS NOT NULL THEN quantity*unit_cost
    ELSE -quantity*unit_cost END)::float8 AS value FROM stock_moves WHERE product_id=$1 AND state='done'`, [f.productId]);
  expect(balance("inventory")).toBeCloseTo(expected.inventory, 2);
  expect(balance("cogs")).toBeCloseTo(expected.cogs, 2);
  expect(-balance("sales_revenue") - balance("sales_returns") - balance("sales_discount") - balance("cogs")).toBeCloseTo(expected.profit, 2);
  expect(Number(quant.value)).toBeCloseTo(expected.inventory, 2);
  expect(Number(moves.value)).toBeCloseTo(expected.inventory, 2);
  if (fifo) {
    const [layers] = await rows("SELECT sum(remaining_qty*unit_cost)::float8 AS value FROM stock_layers WHERE product_id=$1", [f.productId]);
    expect(Number(layers.value)).toBeCloseTo(expected.inventory, 2);
  }
}

describe("original sales cost, inventory carrying value and profit", () => {
  it.each(["fifo", "average", "standard"] as const)("reconciles %s after price changes and repeated partial returns through the real POS/CN routes", async (method) => {
    const f = await fixture(method);
    const { invoice, lines } = await sale(f);
    const cost = method === "fifo" ? 60 : method === "standard" ? 40 : 200 / 3;
    await reconcile(f, { inventory: 100 - cost, cogs: cost, profit: 400 - cost }, method === "fifo");
    await db.update(productsTable).set({ costPrice: "99" }).where(eq(productsTable.id, f.productId));
    const body = returnBody(f, invoice.id, lines[0].id, 1);
    const credit = ok(await f.agent.post("/api/sales/credit-notes").set("Idempotency-Key", `${f.tag}-partial`).send(body));
    await reconcile(f, { inventory: 100 - cost * 3 / 4, cogs: cost * 3 / 4, profit: 300 - cost * 3 / 4 }, method === "fifo");
    const [trace] = await rows(`SELECT r.unit_cost, r.quantity, r.original_move_id, r.invoice_line_id,
      m.unit_cost AS issue_cost, r.kind FROM stock_moves r JOIN stock_moves m ON m.id=r.original_move_id
      WHERE r.source_type='credit_note' AND r.source_id=$1`, [credit.id]);
    expect(trace.kind).toBe("return_in");
    expect(trace.invoice_line_id).toBe(lines[0].id);
    expect(trace.unit_cost).toBe(trace.issue_cost);
    expect(Number(trace.unit_cost)).not.toBe(99);
    expect(ok(await f.agent.post("/api/sales/credit-notes").set("Idempotency-Key", `${f.tag}-partial`).send(body)).id).toBe(credit.id);
    await db.update(productsTable).set({ costPrice: "150" }).where(eq(productsTable.id, f.productId));
    ok(await f.agent.post("/api/sales/credit-notes").send(returnBody(f, invoice.id, lines[0].id, 3)));
    await reconcile(f, { inventory: 100, cogs: 0, profit: 0 }, method === "fifo");
    const over = await f.agent.post("/api/sales/credit-notes").send(body);
    expect(over.status).toBe(409);
    await reconcile(f, { inventory: 100, cogs: 0, profit: 0 }, method === "fifo");
  });

  it("keeps duplicate-product invoice lines tied to their own FIFO issue costs", async () => {
    const f = await fixture();
    const { invoice, lines } = await sale(f, [{ productId: f.productId, quantity: 2 }, { productId: f.productId, quantity: 2 }]);
    await db.update(productsTable).set({ costPrice: "99" }).where(eq(productsTable.id, f.productId));
    ok(await f.agent.post("/api/sales/credit-notes").send(returnBody(f, invoice.id, lines[1].id, 1)));
    await reconcile(f, { inventory: 60, cogs: 40, profit: 260 });
    ok(await f.agent.post("/api/sales/credit-notes").send(returnBody(f, invoice.id, lines[0].id, 1)));
    await reconcile(f, { inventory: 70, cogs: 30, profit: 170 });
  });

  it.each(["delivered", "ready"] as const)("reconciles SO delivery (%s), invoice and partial return using original delivery cost", async (status) => {
    const f = await fixture();
    const order = ok(await f.agent.post("/api/sales/orders").send({
      customerId: f.customerId, warehouseId: f.warehouseId, status: "confirmed",
      lines: [{ productId: f.productId, description: f.tag, quantity: 4, unitPrice: 100, taxRate: 0 }],
    }));
    const delivery = ok(await f.agent.post("/api/sales/deliveries").send({ soId: order.id, status }));
    if (status === "ready") {
      await reconcile(f, { inventory: 100, cogs: 0, profit: 0 });
      ok(await f.agent.post(`/api/sales/deliveries/${delivery.id}/transition`).send({ to: "delivered" }), 200);
    }
    await reconcile(f, { inventory: 40, cogs: 60, profit: -60 });
    const invoice = ok(await f.agent.post("/api/sales/invoices").send({ customerId: f.customerId, soId: order.id }));
    const [line] = await rows("SELECT id FROM customer_invoice_lines WHERE invoice_id=$1", [invoice.id]);
    await reconcile(f, { inventory: 40, cogs: 60, profit: 340 });
    await db.update(productsTable).set({ costPrice: "99" }).where(eq(productsTable.id, f.productId));
    ok(await f.agent.post("/api/sales/credit-notes").send(returnBody(f, invoice.id, line.id, 1)));
    await reconcile(f, { inventory: 55, cogs: 45, profit: 255 });
    ok(await f.agent.post("/api/sales/credit-notes").send(returnBody(f, invoice.id, line.id, 3)));
    await reconcile(f, { inventory: 100, cogs: 0, profit: 0 });
  });

  it("returns the second partial invoice at its own SAR 20 issue cost, not the first invoice's SAR 10", async () => {
    const f = await fixture();
    const order = ok(await f.agent.post("/api/sales/orders").send({
      customerId: f.customerId, warehouseId: f.warehouseId, status: "confirmed",
      lines: [{ productId: f.productId, description: f.tag, quantity: 4, unitPrice: 100, taxRate: 0 }],
    }));
    const [soLine] = await rows("SELECT id FROM sales_order_lines WHERE so_id=$1", [order.id]);
    const invoices: Array<{ id: number; lineId: number }> = [];
    for (let installment = 0; installment < 2; installment++) {
      ok(await f.agent.post("/api/sales/deliveries").send({
        soId: order.id, lines: [{ soLineId: soLine.id, quantity: 2 }],
      }));
      const invoice = ok(await f.agent.post("/api/sales/invoices").send({
        soId: order.id,
        lines: [{ productId: f.productId, description: f.tag, quantity: 2, unitPrice: 100, taxRate: 0 }],
      }));
      const [line] = await rows("SELECT id FROM customer_invoice_lines WHERE invoice_id=$1", [invoice.id]);
      invoices.push({ id: invoice.id, lineId: line.id });
    }
    const allocations = await rows(`SELECT a.invoice_line_id, a.quantity, a.unit_cost, a.issue_move_id
      FROM sales_issue_allocations a JOIN customer_invoice_lines il ON il.id=a.invoice_line_id
      WHERE il.invoice_id=ANY($1::int[]) ORDER BY il.invoice_id`, [invoices.map((i) => i.id)]);
    expect(allocations.map((a) => Number(a.unit_cost))).toEqual([10, 20]);
    expect(allocations.map((a) => Number(a.quantity))).toEqual([2, 2]);
    expect(allocations[0].issue_move_id).not.toBe(allocations[1].issue_move_id);
    await db.update(productsTable).set({ costPrice: "99" }).where(eq(productsTable.id, f.productId));
    ok(await f.agent.post("/api/sales/credit-notes").send(returnBody(f, invoices[1].id, invoices[1].lineId, 1)));
    await reconcile(f, { inventory: 60, cogs: 40, profit: 260 });
    const [returned] = await rows(`SELECT original_move_id, unit_cost FROM stock_moves
      WHERE invoice_line_id=$1 AND kind='return_in'`, [invoices[1].lineId]);
    expect(returned.original_move_id).toBe(allocations[1].issue_move_id);
    expect(Number(returned.unit_cost)).toBe(20);
    ok(await f.agent.post("/api/sales/credit-notes").send(returnBody(f, invoices[1].id, invoices[1].lineId, 1)));
    await reconcile(f, { inventory: 80, cogs: 20, profit: 180 });
    ok(await f.agent.post("/api/sales/credit-notes").send(returnBody(f, invoices[0].id, invoices[0].lineId, 2)));
    await reconcile(f, { inventory: 100, cogs: 0, profit: 0 });
  });

  it("reserves separate quantity slices when two invoices share one delivery issue", async () => {
    const f = await fixture();
    const order = ok(await f.agent.post("/api/sales/orders").send({
      customerId: f.customerId, warehouseId: f.warehouseId, status: "confirmed",
      lines: [{ productId: f.productId, description: f.tag, quantity: 4, unitPrice: 100, taxRate: 0 }],
    }));
    ok(await f.agent.post("/api/sales/deliveries").send({ soId: order.id }));
    const invoices = [];
    for (let installment = 0; installment < 2; installment++) {
      const invoice = ok(await f.agent.post("/api/sales/invoices").send({
        soId: order.id,
        lines: [{ productId: f.productId, description: f.tag, quantity: 2, unitPrice: 100, taxRate: 0 }],
      }));
      const [line] = await rows("SELECT id FROM customer_invoice_lines WHERE invoice_id=$1", [invoice.id]);
      invoices.push({ id: invoice.id, lineId: line.id });
    }
    const allocations = await rows(`SELECT a.quantity, a.issue_move_id
      FROM sales_issue_allocations a JOIN customer_invoice_lines il ON il.id=a.invoice_line_id
      WHERE il.invoice_id=ANY($1::int[])`, [invoices.map((i) => i.id)]);
    expect(allocations).toHaveLength(2);
    expect(allocations[0].issue_move_id).toBe(allocations[1].issue_move_id);
    expect(allocations.map((a) => Number(a.quantity))).toEqual([2, 2]);
    ok(await f.agent.post("/api/sales/credit-notes").send(returnBody(f, invoices[1].id, invoices[1].lineId, 2)));
    await reconcile(f, { inventory: 70, cogs: 30, profit: 170 });
    ok(await f.agent.post("/api/sales/credit-notes").send(returnBody(f, invoices[0].id, invoices[0].lineId, 2)));
    await reconcile(f, { inventory: 100, cogs: 0, profit: 0 });
  });

  it("preserves allocation history but releases billing capacity only after an explicit invoice reversal", async () => {
    const f = await fixture();
    const order = ok(await f.agent.post("/api/sales/orders").send({
      customerId: f.customerId, warehouseId: f.warehouseId, status: "confirmed",
      lines: [{ productId: f.productId, description: f.tag, quantity: 4, unitPrice: 100, taxRate: 0 }],
    }));
    ok(await f.agent.post("/api/sales/deliveries").send({ soId: order.id }));
    const original = ok(await f.agent.post("/api/sales/invoices").send({ soId: order.id }));
    const [originalLine] = await rows("SELECT id FROM customer_invoice_lines WHERE invoice_id=$1", [original.id]);
    const allocationBefore = await rows("SELECT * FROM sales_issue_allocations WHERE invoice_line_id=$1", [originalLine.id]);
    ok(await f.agent.post(`/api/sales/invoices/${original.id}/reverse`).send({ reason: "Synthetic re-billing" }), 200);
    const replacement = ok(await f.agent.post("/api/sales/invoices").send({ soId: order.id }));
    const [replacementLine] = await rows("SELECT id FROM customer_invoice_lines WHERE invoice_id=$1", [replacement.id]);
    const allocationAfter = await rows("SELECT * FROM sales_issue_allocations WHERE invoice_line_id=$1", [originalLine.id]);
    expect(allocationAfter).toEqual(allocationBefore);
    const replacementAllocations = await rows("SELECT quantity,issue_move_id FROM sales_issue_allocations WHERE invoice_line_id=$1", [replacementLine.id]);
    expect(replacementAllocations).toHaveLength(1);
    expect(Number(replacementAllocations[0].quantity)).toBe(4);
    expect(replacementAllocations[0].issue_move_id).toBe(allocationBefore[0].issue_move_id);
    expect((await f.agent.post("/api/sales/credit-notes").send(returnBody(f, original.id, originalLine.id, 1))).status).toBe(409);
    await reconcile(f, { inventory: 40, cogs: 60, profit: 340 });
    ok(await f.agent.post("/api/sales/credit-notes").send(returnBody(f, replacement.id, replacementLine.id, 4)));
    await reconcile(f, { inventory: 100, cogs: 0, profit: 0 });
  });

  it("serializes concurrent partial returns without allocating original cost twice", async () => {
    const f = await fixture();
    const { invoice, lines } = await sale(f);
    await db.update(productsTable).set({ costPrice: "99" }).where(eq(productsTable.id, f.productId));
    const responses = await Promise.all([1, 3].map((quantity) => f.agent.post("/api/sales/credit-notes")
      .set("Idempotency-Key", `${f.tag}-${quantity}`).send(returnBody(f, invoice.id, lines[0].id, quantity))));
    responses.forEach((response) => ok(response));
    await reconcile(f, { inventory: 100, cogs: 0, profit: 0 });
  });

  it("restores the historical cost even after receiving a newer expensive purchase layer", async () => {
    const f = await fixture();
    const { invoice, lines } = await sale(f);
    await db.transaction(async (tx) => {
      await recordStockMove(tx, {
        companyId: f.companyId, productId: f.productId, quantity: 3, unitCost: 90,
        kind: "receipt", toWarehouseId: f.warehouseId,
      });
      await tx.update(productsTable).set({ costPrice: "90" }).where(eq(productsTable.id, f.productId));
    });
    await reconcile(f, { inventory: 310, cogs: 60, profit: 340 });
    ok(await f.agent.post("/api/sales/credit-notes").send(returnBody(f, invoice.id, lines[0].id, 1)));
    await reconcile(f, { inventory: 325, cogs: 45, profit: 255 });
    ok(await f.agent.post("/api/sales/credit-notes").send(returnBody(f, invoice.id, lines[0].id, 3)));
    await reconcile(f, { inventory: 370, cogs: 0, profit: 0 });
  });

  it("rolls back a restock when the journal cannot post to a closed period", async () => {
    const f = await fixture();
    const { invoice, lines } = await sale(f);
    await pool.query(`UPDATE fiscal_periods SET status='closed'
      WHERE fiscal_year_id IN (SELECT id FROM fiscal_years WHERE company_id=$1)`, [f.companyId]);
    const response = await f.agent.post("/api/sales/credit-notes").send(returnBody(f, invoice.id, lines[0].id, 1));
    expect(response.status).toBe(403);
    const [count] = await rows("SELECT count(*)::int AS n FROM stock_moves WHERE product_id=$1 AND kind='return_in'", [f.productId]);
    expect(count.n).toBe(0);
    await reconcile(f, { inventory: 40, cogs: 60, profit: 340 });
  });

  it("does not reverse cost or add stock for a commercial credit without a physical return", async () => {
    const f = await fixture();
    const { invoice, lines } = await sale(f);
    ok(await f.agent.post("/api/sales/credit-notes").send(returnBody(f, invoice.id, lines[0].id, 1, 100, false)));
    await reconcile(f, { inventory: 40, cogs: 60, profit: 240 });
  });

  it("rejects absent historical cost evidence without changing inventory, journals or creating a reserved draft", async () => {
    const f = await fixture();
    const { invoice, lines } = await sale(f);
    // Simulate a legacy sale: leave the original expense intact but remove
    // only its new trace reference in this disposable fixture.
    await pool.query("UPDATE stock_moves SET invoice_line_id=NULL WHERE invoice_line_id=$1", [lines[0].id]);
    const [before] = await rows("SELECT count(*)::int AS n FROM credit_notes WHERE company_id=$1", [f.companyId]);
    const result = await f.agent.post("/api/sales/credit-notes").send(returnBody(f, invoice.id, lines[0].id, 1));
    expect(result.status).toBe(409);
    expect(result.body.error).toContain("تكلفة الصرف الأصلية");
    const [after] = await rows("SELECT count(*)::int AS n FROM credit_notes WHERE company_id=$1", [f.companyId]);
    expect(after.n).toBe(before.n);
    await reconcile(f, { inventory: 40, cogs: 60, profit: 340 });
  });

  it("reverses USD revenue at its historical rate but restores SAR cost only once despite a changed rate", async () => {
    const f = await fixture();
    // Foreign-currency invoices are supported by persisted accounting data.
    // The POS UI currently emits SAR; create a real posted USD fixture rather
    // than pretend the public POS accepts an unsupported currency field.
    const { invoice, line } = await db.transaction(async (tx) => {
      const [invoice] = await tx.insert(customerInvoicesTable).values({
        companyId: f.companyId, reference: `${f.tag}-USD`, customerId: f.customerId, customerName: f.tag,
        invoiceDate: new Date().toISOString().slice(0, 10), currencyCode: "USD",
        subtotal: "80", total: "80", vat: "0", status: "open",
      }).returning();
      const [line] = await tx.insert(customerInvoiceLinesTable).values({
        invoiceId: invoice.id, productId: f.productId, description: f.tag,
        quantity: "4", unitPrice: "20", taxRate: "0", lineTotal: "80",
      }).returning();
      // Two issue records under one invoice line: partial returns span them.
      for (const quantity of [2, 2]) await recordStockMove(tx, {
        companyId: f.companyId, productId: f.productId, quantity, kind: "issue",
        fromWarehouseId: f.warehouseId, invoiceLineId: line.id, sourceRef: invoice.reference,
      });
      await postJournalEntry(tx, {
        companyId: f.companyId, entryDate: new Date(), description: f.tag, reference: invoice.reference,
        sourceRef: invoice.reference, currencyCode: "USD", exchangeRate: 3.75,
      }, [{ systemKey: "ar", debit: 80 }, { systemKey: "sales_revenue", credit: 80 }]);
      return { invoice, line };
    });
    await pool.query(`INSERT INTO exchange_rates(from_currency,to_currency,rate,rate_date)
      VALUES ('USD','SAR',4.2,current_date)
      ON CONFLICT (from_currency,to_currency,rate_date) DO UPDATE SET rate=4.2`);
    await db.update(productsTable).set({ costPrice: "99" }).where(eq(productsTable.id, f.productId));
    await reconcile(f, { inventory: 40, cogs: 60, profit: 240 });
    const credit = ok(await f.agent.post("/api/sales/credit-notes").send(returnBody(f, invoice.id, line.id, 3, 20)));
    expect(credit.currencyCode).toBe("USD");
    const [journal] = await rows("SELECT currency_code,exchange_rate FROM journal_entries WHERE id=$1", [credit.journalEntryId]);
    expect(journal.currency_code).toBe("USD"); expect(Number(journal.exchange_rate)).toBe(3.75);
    await reconcile(f, { inventory: 80, cogs: 20, profit: 55 });
    const [ar] = await rows(`SELECT sum(l.base_debit-l.base_credit)::float8 AS value
      FROM journal_entries j JOIN journal_entry_lines l ON l.entry_id=j.id JOIN accounts a ON a.id=l.account_id
      WHERE j.company_id=$1 AND a.system_key='ar'`, [f.companyId]);
    expect(ar.value).toBe(75); // USD 20 remaining × historical 3.75, not current 4.2.
    ok(await f.agent.post("/api/sales/credit-notes").send(returnBody(f, invoice.id, line.id, 1, 20)));
    await reconcile(f, { inventory: 100, cogs: 0, profit: 0 });
  });
});
