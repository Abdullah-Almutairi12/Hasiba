import { beforeAll, describe, expect, it } from "vitest";
import {reviewedSalesInvoice} from "../test/reviewed-sales-invoice";
import request from "supertest";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import {
  db, pool, companiesTable, usersTable, userCompaniesTable, branchesTable,
  warehousesTable, categoriesTable, productsTable, customersTable, suppliersTable,
  invoicesTable,
} from "@workspace/db";
import app, { assertApplicationReady } from "../app";
import { seedCompanyFiscalCalendar } from "../lib/fiscal-calendar";
import { recordStockMove } from "../lib/stock-engine";
import { postJournalEntry } from "../lib/journal-posting";

// The isolated runner creates and destroys the entire PostgreSQL cluster.
// No application database, real documents or external services are used.
beforeAll(assertApplicationReady);
let clientNumber = 100;
const rows = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows;
function ok(response: request.Response, status = 201) {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  return response.body;
}
type Kind = "supplier invoice" | "sales invoice" | "sales return";

async function fixture(kind: Kind) {
  const tag = `document-race-${randomUUID()}`;
  const [company] = await db.insert(companiesTable).values({
    name: tag, vatRegistrationStatus: "not_registered",
  }).returning();
  const companyId = company.id;
  await seedCompanyFiscalCalendar(companyId);
  const password = "Synthetic-race-only-123!";
  const [user] = await db.insert(usersTable).values({
    name: tag, email: `${tag}@example.invalid`,
    passwordHash: await bcrypt.hash(password, 4), role: "owner",
  }).returning();
  await db.insert(userCompaniesTable).values({
    companyId, userId: user.id, role: "owner", isDefault: true,
  });
  const agent = request.agent(app);
  ok(await agent.post("/api/auth/login").set("X-Forwarded-For", `192.0.2.${++clientNumber}`)
    .send({ email: user.email, password }), 200);
  const [branch] = await db.insert(branchesTable).values({
    companyId, name: tag, nameAr: tag, city: "Test",
  }).returning();
  const [warehouse] = await db.insert(warehousesTable).values({
    companyId, branchId: branch.id, name: tag, nameAr: tag, isDefault: true,
  }).returning();
  const [category] = await db.insert(categoriesTable).values({ name: tag, nameAr: tag }).returning();
  const [product] = await db.insert(productsTable).values({
    companyId, categoryId: category.id, name: tag, nameAr: tag, sku: tag,
    price: "100", costPrice: "10", stock: "0", costingMethod: "fifo",
  }).returning();
  const [customer] = await db.insert(customersTable).values({ companyId, name: tag }).returning();
  const [supplier] = await db.insert(suppliersTable).values({
    companyId, name: tag, balance: "100",
  }).returning();
  await db.transaction((tx) => recordStockMove(tx, {
    companyId, productId: product.id, toWarehouseId: warehouse.id,
    kind: "receipt", quantity: 10, unitCost: 10, sourceRef: tag,
  }));
  const base = { companyId, agent, productId: product.id, customerId: customer.id, supplierId: supplier.id };
  if (kind === "supplier invoice") {
    const [invoice] = await db.insert(invoicesTable).values({
      companyId, invoiceNumber: tag, supplierId: supplier.id, supplierName: tag,
      amount: "100", status: "done", isLocked: true, lockedAt: new Date(),
    }).returning();
    const journal = await db.transaction((tx) => postJournalEntry(tx, {
      companyId, entryDate: new Date(), description: tag, source: "supplier_invoice",
      sourceRef: `INV-${tag}`, createdBy: user.id,
    }, [{ systemKey: "inventory", debit: 100 }, { systemKey: "ap", credit: 100 }]));
    return { ...base, journalId: journal.id, docId: invoice.id,
      documentPath: `/api/invoices/${invoice.id}/reverse` };
  }
  // Real SO/delivery/invoice routes provide inventory evidence and nonzero
  // fulfilment counters, so rollback tests cannot pass with empty fixtures.
  const order = ok(await agent.post("/api/sales/orders").send({
    customerId: customer.id, warehouseId: warehouse.id, status: "confirmed",
    lines: [{ productId: product.id, description: tag, quantity: 4, unitPrice: 100, taxRate: 0 }],
  }));
  ok(await agent.post("/api/sales/deliveries").send({ soId: order.id }));
  const invoice = ok(await reviewedSalesInvoice(agent,{ soId: order.id }));
  if (kind === "sales invoice") {
    const [journal] = await rows(`SELECT id FROM journal_entries
      WHERE company_id=$1 AND source='manual' AND source_ref=$2 AND status='posted'`,
    [companyId, invoice.reference]);
    expect(journal).toBeDefined();
    return { ...base, journalId: journal.id as number, docId: invoice.id,
      documentPath: `/api/sales/invoices/${invoice.id}/reverse` };
  }
  const [line] = await rows("SELECT id FROM customer_invoice_lines WHERE invoice_id=$1", [invoice.id]);
  const credit = ok(await agent.post("/api/sales/credit-notes").send({
    invoiceId: invoice.id, customerId: customer.id, warehouseId: warehouse.id, restock: true,
    lines: [{ invoiceLineId: line.id, productId: product.id, description: tag,
      quantity: 1, unitPrice: 100, taxRate: 0 }],
  }));
  expect(credit.journalEntryId).toBeTypeOf("number");
  return { ...base, journalId: credit.journalEntryId as number, docId: credit.id,
    documentPath: `/api/sales/credit-notes/${credit.id}/cancel` };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

async function stockSnapshot(f: Fixture) {
  return {
    product: await rows("SELECT * FROM products WHERE id=$1", [f.productId]),
    moves: await rows("SELECT * FROM stock_moves WHERE product_id=$1 ORDER BY id", [f.productId]),
    quants: await rows("SELECT * FROM stock_quants WHERE product_id=$1 ORDER BY id", [f.productId]),
    layers: await rows("SELECT * FROM stock_layers WHERE product_id=$1 ORDER BY id", [f.productId]),
  };
}
async function businessSnapshot(f: Fixture) {
  return {
    stock: await stockSnapshot(f),
    suppliers: await rows("SELECT * FROM suppliers WHERE company_id=$1 ORDER BY id", [f.companyId]),
    customers: await rows("SELECT * FROM customers WHERE company_id=$1 ORDER BY id", [f.companyId]),
    invoices: await rows("SELECT * FROM invoices WHERE company_id=$1 ORDER BY id", [f.companyId]),
    sales: await rows("SELECT * FROM customer_invoices WHERE company_id=$1 ORDER BY id", [f.companyId]),
    lines: await rows(`SELECT l.* FROM customer_invoice_lines l JOIN customer_invoices i ON i.id=l.invoice_id
      WHERE i.company_id=$1 ORDER BY l.id`, [f.companyId]),
    notes: await rows("SELECT * FROM credit_notes WHERE company_id=$1 ORDER BY id", [f.companyId]),
    noteLines: await rows(`SELECT l.* FROM credit_note_lines l JOIN credit_notes n ON n.id=l.note_id
      WHERE n.company_id=$1 ORDER BY l.id`, [f.companyId]),
    orders: await rows("SELECT * FROM sales_orders WHERE company_id=$1 ORDER BY id", [f.companyId]),
    orderLines: await rows(`SELECT l.* FROM sales_order_lines l JOIN sales_orders o ON o.id=l.so_id
      WHERE o.company_id=$1 ORDER BY l.id`, [f.companyId]),
  };
}
async function ledgerSnapshot(f: Fixture) {
  return {
    entries: await rows("SELECT * FROM journal_entries WHERE company_id=$1 ORDER BY id", [f.companyId]),
    lines: await rows(`SELECT l.* FROM journal_entry_lines l JOIN journal_entries j ON j.id=l.entry_id
      WHERE j.company_id=$1 ORDER BY l.id`, [f.companyId]),
  };
}

/**
 * Queue both independent HTTP transactions behind a third connection's row
 * lock. Observe the first waiter BEFORE starting the second. PostgreSQL's
 * lock queue then chooses the requested winner, without sleeps or mocks.
 */
async function race(f: Fixture, documentFirst: boolean) {
  const blocker = await pool.connect();
  const pending: Array<Promise<request.Response>> = [];
  const start = (document: boolean) => f.agent.post(document ? f.documentPath
    : `/api/accounting/journal-entries/${f.journalId}/reverse`)
    .send({ reason: "Synthetic competing reversal" }).then((response) => response);
  try {
    await blocker.query("BEGIN");
    const { rows: [{ pid }] } = await blocker.query("SELECT pg_backend_pid() AS pid");
    await blocker.query("SELECT id FROM journal_entries WHERE id=$1 FOR UPDATE", [f.journalId]);
    const waiters = () => rows(`SELECT pid, pg_blocking_pids(pid) AS blockers FROM pg_stat_activity
      WHERE datname=current_database() AND wait_event_type='Lock'
        AND query ILIKE '%journal_entries%' AND query ILIKE '%for update%'`);
    pending.push(start(documentFirst));
    await expect.poll(async () => (await waiters()).filter((r) => r.blockers.includes(pid)).length,
      { timeout: 5000 }).toBe(1);
    const firstPid = (await waiters()).find((r) => r.blockers.includes(pid))!.pid;
    pending.push(start(!documentFirst));
    // The second may wait on the tuple or transaction lock; either way its
    // blocker graph must include the known first HTTP backend.
    await expect.poll(async () => (await waiters()).some((r) =>
      r.pid !== firstPid && r.blockers.includes(firstPid)), { timeout: 5000 }).toBe(true);
  } finally {
    await blocker.query("ROLLBACK");
    blocker.release();
    // Always drain requests, even if a lock assertion failed.
    await Promise.allSettled(pending);
  }
  const [first, second] = await Promise.all(pending);
  return documentFirst ? { document: first, manual: second } : { document: second, manual: first };
}

describe("document cancellation versus manual journal reversal on disposable PostgreSQL", () => {
  for (const kind of ["supplier invoice", "sales invoice", "sales return"] as const) {
    it.each([false, true])(`${kind}: document wins = %s; exactly one atomic reversal`, async (documentFirst) => {
      const f = await fixture(kind);
      const before = await businessSnapshot(f);
      const ledgerBefore = await ledgerSnapshot(f);
      const original = ledgerBefore.entries.find((j) => j.id === f.journalId)!;
      expect(original.reversed_at).toBeNull();
      expect(before.stock.moves.length).toBeGreaterThan(0);
      expect(Number(before.suppliers[0].balance)).toBe(100);
      if (kind !== "supplier invoice") {
        expect(Number(before.orderLines[0].invoiced_qty)).toBe(kind === "sales return" ? 3 : 4);
        expect(before.customers[0].total_orders).toBe(1);
        expect(Number(before.customers[0].total_spent)).toBe(400);
      }

      const result = await race(f, documentFirst);
      ok(result.document, documentFirst ? 200 : 409);
      ok(result.manual, documentFirst ? 409 : 200);
      const after = await businessSnapshot(f);
      const ledgerAfter = await ledgerSnapshot(f);
      const reversals = ledgerAfter.entries.filter((j) => j.reversal_of === f.journalId);
      expect(reversals).toHaveLength(1);
      const reversal = reversals[0];
      if (!documentFirst) expect(reversal.id).toBe(result.manual.body.id);
      else if (kind !== "sales return") expect(reversal.id).toBe(result.document.body.reverseJournalId);
      else expect(after.notes.find((n) => n.id === f.docId)!.journal_entry_id).toBe(f.journalId);
      expect(reversal.company_id).toBe(f.companyId);
      expect(reversal.status).toBe("posted");
      expect(reversal.currency_code).toBe(original.currency_code);
      expect(reversal.exchange_rate).toBe(original.exchange_rate);
      const saved = ledgerAfter.entries.find((j) => j.id === f.journalId)!;
      expect(saved.reversed_at).toBeInstanceOf(Date);
      expect(saved.reversed_by).toBeTypeOf("number");
      expect({ ...saved, reversed_at: null, reversed_by: null }).toEqual(original);
      // All pre-existing journal lines and unrelated entries remain exact.
      expect(ledgerAfter.entries.filter((j) => j.id !== reversal.id && j.id !== original.id))
        .toEqual(ledgerBefore.entries.filter((j) => j.id !== original.id));
      expect(ledgerAfter.lines.filter((l) => l.entry_id !== reversal.id)).toEqual(ledgerBefore.lines);
      const origLines = ledgerBefore.lines.filter((l) => l.entry_id === original.id);
      const reverseLines = ledgerAfter.lines.filter((l) => l.entry_id === reversal.id);
      const amounts = (ls: typeof origLines, swap = false) => ls.map((l) => ({
        account: l.account_id, debit: swap ? l.credit : l.debit, credit: swap ? l.debit : l.credit,
        baseDebit: swap ? l.base_credit : l.base_debit, baseCredit: swap ? l.base_debit : l.base_credit,
      })).sort((a, b) => a.account - b.account);
      expect(reverseLines).toHaveLength(origLines.length);
      expect(amounts(reverseLines)).toEqual(amounts(origLines, true));

      if (!documentFirst) {
        // Includes inserted reverse documents/lines, links, status, balances,
        // fulfilment counters, stock movements, quants, layers and cached stock.
        expect(after).toEqual(before);
      } else if (kind === "supplier invoice") {
        expect(after.invoices).toHaveLength(2);
        const reverse = after.invoices.find((i) => i.reverses_id === f.docId)!;
        expect(reverse.id).toBe(result.document.body.reverse.id);
        expect(after.invoices.find((i) => i.id === f.docId)!.reversed_by_id).toBe(reverse.id);
        expect(Number(reverse.amount)).toBe(-100);
        expect(Number(after.suppliers[0].balance)).toBe(Number(before.suppliers[0].balance) - 100);
        expect(after.customers).toEqual(before.customers);
        expect(after.stock).toEqual(before.stock);
      } else if (kind === "sales invoice") {
        expect(after.sales).toHaveLength(2);
        const reverse = after.sales.find((i) => i.reverses_id === f.docId)!;
        const source = after.sales.find((i) => i.id === f.docId)!;
        expect(reverse.id).toBe(result.document.body.reverse.id);
        expect(source.reversed_by_id).toBe(reverse.id);
        expect(source.status).toBe("cancelled");
        expect(Number(reverse.total)).toBe(-400);
        expect(after.lines.filter((l) => l.invoice_id === reverse.id).map((l) => [
          Number(l.quantity), Number(l.line_total),
        ])).toEqual([[-4, -400]]);
        expect(after.customers[0].total_orders).toBe(before.customers[0].total_orders - 1);
        expect(Number(after.customers[0].total_spent)).toBe(Number(before.customers[0].total_spent) - 400);
        expect(Number(after.orderLines[0].invoiced_qty)).toBe(0);
        expect(after.suppliers).toEqual(before.suppliers);
        // Invoice reversal is commercial; it must not invent a stock return.
        expect(after.stock).toEqual(before.stock);
      } else {
        expect(after.notes.find((n) => n.id === f.docId)!.status).toBe("cancelled");
        expect(after.noteLines).toEqual(before.noteLines);
        expect(after.customers).toEqual(before.customers);
        expect(after.suppliers).toEqual(before.suppliers);
        expect(Number(after.orderLines[0].invoiced_qty)).toBe(4);
        expect(Number(after.orderLines[0].delivered_qty)).toBe(4);
        expect(after.orders[0].status).toBe("invoiced");
        expect(after.sales[0].status).toBe("open");
        const moves = after.stock.moves.filter((m) => m.source_type === "credit_note_cancel");
        expect(moves).toHaveLength(1);
        expect(moves[0].source_id).toBe(f.docId);
        expect(Number(moves[0].quantity)).toBe(1);
        expect(Number(moves[0].unit_cost)).toBe(10);
        expect(after.stock.moves.filter((m) => m.id !== moves[0].id)).toEqual(before.stock.moves);
        expect(Number(after.stock.product[0].stock)).toBe(6);
        expect(after.stock.quants.reduce((sum, q) => sum + Number(q.quantity), 0)).toBe(6);
        expect(after.stock.quants.reduce((sum, q) => sum + Number(q.quantity) * Number(q.avg_cost), 0)).toBe(60);
        expect(after.stock.layers.reduce((sum, l) => sum + Number(l.remaining_qty), 0)).toBe(6);
        expect(after.stock.layers.reduce((sum, l) => sum + Number(l.remaining_qty) * Number(l.unit_cost), 0)).toBe(60);
      }
      // Neither a later manual request nor retrying the document may add any
      // further effects after either race outcome.
      ok(await f.agent.post(`/api/accounting/journal-entries/${f.journalId}/reverse`).send({}), 409);
      ok(await f.agent.post(f.documentPath).send({ reason: "Synthetic retry" }), 409);
      expect(await businessSnapshot(f)).toEqual(after);
      expect(await ledgerSnapshot(f)).toEqual(ledgerAfter);
    });
  }
});
