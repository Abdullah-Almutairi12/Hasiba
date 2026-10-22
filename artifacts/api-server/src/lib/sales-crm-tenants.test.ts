import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { eq, inArray, sql } from "drizzle-orm";
import {
  db, companiesTable, usersTable, userCompaniesTable, customersTable,
  branchesTable, warehousesTable, quotationsTable, quotationLinesTable,
  salesOrdersTable, salesOrderLinesTable, deliveryOrdersTable, deliveryOrderLinesTable,
  customerInvoicesTable, customerInvoiceLinesTable, customerReceiptsTable,
  creditNotesTable, opportunitiesTable, opportunityStagesTable, leadsTable,
  commissionPlansTable, salesRepAssignmentsTable, journalEntriesTable, auditLogsTable,
  categoriesTable, productsTable, stockQuantsTable, stockMovesTable, creditNoteLinesTable,
} from "@workspace/db";
import app, { assertApplicationReady } from "../app";
import { cleanupCompanyDefaults } from "../test/cleanup-company-defaults";
import { seedCompanyFiscalCalendar } from "./fiscal-calendar";
import { recordStockMove } from "./stock-engine";

const tag = `sales-crm-tenants-${Date.now()}`;
const date = new Date().toISOString().slice(0, 10);
const range = { from: `${date.slice(0, 7)}-01`, to: date };
type Fixture = Record<"company" | "user" | "customer" | "warehouse" | "branch" |
  "quote" | "order" | "orderLine" | "delivery" | "invoice" | "receipt" | "credit" |
  "lead" | "opportunity" | "outbox" | "product", number>;
const fixtures: Fixture[] = [];
const agents: request.Agent[] = [];
let stage = 0;
let plan = 0;
let category = 0;

beforeAll(async () => {
  await assertApplicationReady();
  const hash = await bcrypt.hash("SalesTenant123!", 4);
  category = (await db.insert(categoriesTable).values({ name: tag, nameAr: tag }).returning())[0].id;
  stage = (await db.insert(opportunityStagesTable).values({
    name: tag, nameAr: tag, sequence: 999, probability: 100, isWon: true,
  }).returning())[0].id;
  plan = (await db.insert(commissionPlansTable).values({
    name: tag, rate: "10", quota: "0", bonusRate: "0",
  }).returning())[0].id;
  for (let n = 0; n < 2; n++) {
    const f = {} as Fixture;
    const name = `${tag}-${n}`;
    const amount = n === 0 ? "100" : "9000";
    f.company = (await db.insert(companiesTable).values({ name }).returning())[0].id;
    await seedCompanyFiscalCalendar(f.company);
    f.user = (await db.insert(usersTable).values({
      name, email: `${name}@test.local`, passwordHash: hash, role: "owner", isActive: true,
    }).returning())[0].id;
    await db.insert(userCompaniesTable).values({
      companyId: f.company, userId: f.user, role: "owner", isDefault: true,
    });
    f.customer = (await db.insert(customersTable).values({
      companyId: f.company, name, email: `${name}@test.local`, phone: `${tag}-${n}`,
    }).returning())[0].id;
    f.branch = (await db.insert(branchesTable).values({
      companyId: f.company, name, nameAr: name, city: "Synthetic",
    }).returning())[0].id;
    f.warehouse = (await db.insert(warehousesTable).values({
      companyId: f.company, branchId: f.branch, name, nameAr: name, isDefault: true,
    }).returning())[0].id;
    f.product = (await db.insert(productsTable).values({
      companyId: f.company, categoryId: category, name, nameAr: name, sku: name,
      price: "10", costPrice: "1", stock: "10", minStock: 0,
    }).returning())[0].id;
    await db.insert(stockQuantsTable).values({
      productId: f.product, warehouseId: f.warehouse, quantity: "10", avgCost: "1",
    });
    f.quote = (await db.insert(quotationsTable).values({
      companyId: f.company, reference: `${name}-Q`, customerId: f.customer,
      customerName: name, quoteDate: date, total: amount, status: "accepted",
    }).returning())[0].id;
    await db.insert(quotationLinesTable).values({
      quotationId: f.quote, description: name, quantity: "1", unitPrice: amount, lineTotal: amount,
    });
    f.order = (await db.insert(salesOrdersTable).values({
      companyId: f.company, reference: `${name}-SO`, customerId: f.customer,
      customerName: name, orderDate: date, total: amount, status: "confirmed", warehouseId: f.warehouse,
    }).returning())[0].id;
    f.orderLine = (await db.insert(salesOrderLinesTable).values({
      soId: f.order, description: name, quantity: "1", unitPrice: amount, lineTotal: amount,
    }).returning())[0].id;
    f.delivery = (await db.insert(deliveryOrdersTable).values({
      companyId: f.company, reference: `${name}-DO`, soId: f.order,
      warehouseId: f.warehouse, status: "ready", deliveryDate: date,
    }).returning())[0].id;
    await db.insert(deliveryOrderLinesTable).values({
      doId: f.delivery, soLineId: f.orderLine, description: name, quantity: "1",
    });
    f.invoice = (await db.insert(customerInvoicesTable).values({
      companyId: f.company, reference: `${name}-INV`, customerId: f.customer,
      customerName: name, invoiceDate: date, status: "open", isLocked: true,
      subtotal: amount, total: amount, salesRepId: f.user,
    }).returning())[0].id;
    await db.insert(customerInvoiceLinesTable).values({
      invoiceId: f.invoice, description: name, quantity: "1", unitPrice: amount, lineTotal: amount,
    });
    f.receipt = (await db.insert(customerReceiptsTable).values({
      reference: `${name}-R`, customerId: f.customer, customerName: name,
      receiptDate: date, amount, bankRef: `${name}-private`,
    }).returning())[0].id;
    f.credit = (await db.insert(creditNotesTable).values({
      companyId: f.company, reference: `${name}-CN`, customerId: f.customer,
      customerName: name, noteDate: date, total: amount, status: "issued", restock: false,
    }).returning())[0].id;
    f.lead = (await db.insert(leadsTable).values({
      companyId: f.company, fullName: name, estimatedValue: amount, notes: `${name}-private`,
    }).returning())[0].id;
    // A customerless opportunity must still be owned and visible.
    f.opportunity = (await db.insert(opportunitiesTable).values({
      companyId: f.company, name, stageId: stage, expectedRevenue: amount,
      probability: 100, salesRepId: f.user,
    }).returning())[0].id;
    await db.insert(salesRepAssignmentsTable).values({ userId: f.user, planId: plan, effectiveFrom: date });
    const outbox = await db.execute(sql`
      INSERT INTO sales_email_outbox (kind, ref_id, reference, recipient, subject, body, status,
        attempts, next_retry_at)
      VALUES ('invoice', ${f.invoice}, ${`${name}-INV`}, ${`${name}@test.local`},
        'Synthetic', 'Synthetic', 'failed', 99, null) RETURNING id
    `);
    f.outbox = Number(outbox.rows[0].id);
    fixtures.push(f);
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ email: `${name}@test.local`, password: "SalesTenant123!" }).expect(200);
    agents.push(agent);
  }
});

afterAll(async () => {
  const ids = fixtures.map(f => f.company);
  const users = fixtures.map(f => f.user);
  if (!ids.length) return;
  await db.delete(stockMovesTable).where(inArray(stockMovesTable.productId, fixtures.map(f => f.product)));
  await db.execute(sql`DELETE FROM sales_email_outbox WHERE reference LIKE ${`${tag}%`}`);
  await db.delete(opportunitiesTable).where(inArray(opportunitiesTable.companyId, ids));
  await db.delete(leadsTable).where(inArray(leadsTable.companyId, ids));
  await db.delete(opportunityStagesTable).where(eq(opportunityStagesTable.id, stage));
  await db.delete(salesRepAssignmentsTable).where(eq(salesRepAssignmentsTable.planId, plan));
  await db.delete(commissionPlansTable).where(eq(commissionPlansTable.id, plan));
  const credits = await db.select({ id: creditNotesTable.id }).from(creditNotesTable).where(inArray(creditNotesTable.companyId, ids));
  if (credits.length) await db.delete(creditNoteLinesTable).where(inArray(creditNoteLinesTable.noteId, credits.map(c => c.id)));
  await db.delete(creditNotesTable).where(inArray(creditNotesTable.companyId, ids));
  await db.delete(customerReceiptsTable).where(inArray(customerReceiptsTable.customerId, fixtures.map(f => f.customer)));
  await db.delete(customerInvoicesTable).where(inArray(customerInvoicesTable.companyId, ids));
  const orders = await db.select({ id: salesOrdersTable.id }).from(salesOrdersTable).where(inArray(salesOrdersTable.companyId, ids));
  const deliveries = await db.select({ id: deliveryOrdersTable.id }).from(deliveryOrdersTable).where(inArray(deliveryOrdersTable.companyId, ids));
  if (deliveries.length) await db.delete(deliveryOrderLinesTable).where(inArray(deliveryOrderLinesTable.doId, deliveries.map(d => d.id)));
  await db.delete(deliveryOrdersTable).where(inArray(deliveryOrdersTable.companyId, ids));
  if (orders.length) await db.delete(salesOrderLinesTable).where(inArray(salesOrderLinesTable.soId, orders.map(o => o.id)));
  await db.delete(salesOrdersTable).where(inArray(salesOrdersTable.companyId, ids));
  await db.delete(quotationsTable).where(inArray(quotationsTable.companyId, ids));
  await db.delete(customersTable).where(inArray(customersTable.companyId, ids));
  const products = fixtures.map(f => f.product);
  await db.delete(stockQuantsTable).where(inArray(stockQuantsTable.productId, products));
  await db.delete(productsTable).where(inArray(productsTable.id, products));
  await db.delete(categoriesTable).where(eq(categoriesTable.id, category));
  await db.delete(warehousesTable).where(inArray(warehousesTable.companyId, ids));
  await db.delete(branchesTable).where(inArray(branchesTable.companyId, ids));
  await db.delete(journalEntriesTable).where(inArray(journalEntriesTable.companyId, ids));
  await cleanupCompanyDefaults(ids);
  await db.delete(auditLogsTable).where(inArray(auditLogsTable.userId, users));
  await db.delete(usersTable).where(inArray(usersTable.id, users));
  await db.delete(companiesTable).where(inArray(companiesTable.id, ids));
});

describe("Sales and CRM company isolation", () => {
  it("scopes sales lists even when a foreign filter or companyId is supplied", async () => {
    for (const [path, key] of [
      ["quotations", "quote"], ["deliveries", "delivery"],
      ["credit-notes", "credit"], ["receipts", "receipt"],
    ] as const) {
      for (let n = 0; n < 2; n++) {
        const own = fixtures[n], foreign = fixtures[1 - n];
        const list = await agents[n].get(`/api/sales/${path}`).query({ companyId: foreign.company }).expect(200);
        expect(list.body.map((r: { id: number }) => r.id)).toEqual([own[key]]);
        const filtered = await agents[n].get(`/api/sales/${path}`).query(
          path === "deliveries" ? { soId: foreign.order } : { customerId: foreign.customer },
        ).expect(200);
        expect(filtered.body).toEqual([]);
      }
    }
  });

  it("rejects foreign quotation detail, transitions, conversion, and sending before any action", async () => {
    const foreign = fixtures[1];
    await agents[0].get(`/api/sales/quotations/${foreign.quote}`).expect(404);
    await agents[0].post(`/api/sales/quotations/${foreign.quote}/transition`).send({ to: "sent" }).expect(404);
    await agents[0].post(`/api/sales/quotations/${foreign.quote}/convert`).send({ companyId: fixtures[0].company }).expect(404);
    await agents[0].post(`/api/sales/quotations/${foreign.quote}/send`).send({ to: "attacker@test.local" }).expect(404);
    expect((await db.select().from(quotationsTable).where(eq(quotationsTable.id, foreign.quote)))[0].status).toBe("accepted");
    expect(await db.select().from(salesOrdersTable).where(eq(salesOrdersTable.quotationId, foreign.quote))).toHaveLength(0);
    const own = await agents[0].get(`/api/sales/quotations/${fixtures[0].quote}`).expect(200);
    expect(own.body.lines).toHaveLength(1);
    const converted = await agents[0].post(`/api/sales/quotations/${fixtures[0].quote}/convert`).send({}).expect(201);
    expect(converted.body.companyId).toBe(fixtures[0].company);
    expect(converted.body.warehouseId).toBe(fixtures[0].warehouse);
  });

  it("rejects foreign deliveries and order references without changing fulfillment", async () => {
    const foreign = fixtures[1];
    await agents[0].post(`/api/sales/deliveries/${foreign.delivery}/transition`).send({ to: "delivered" }).expect(404);
    await agents[0].post("/api/sales/deliveries").send({ soId: foreign.order }).expect(404);
    expect((await db.select().from(deliveryOrdersTable).where(eq(deliveryOrdersTable.id, foreign.delivery)))[0].status).toBe("ready");
    expect(Number((await db.select().from(salesOrderLinesTable).where(eq(salesOrderLinesTable.id, foreign.orderLine)))[0].deliveredQty)).toBe(0);
    await agents[0].post(`/api/sales/deliveries/${fixtures[0].delivery}/transition`).send({ to: "delivered" }).expect(200);
    expect(Number((await db.select().from(salesOrderLinesTable).where(eq(salesOrderLinesTable.id, fixtures[0].orderLine)))[0].deliveredQty)).toBe(1);
  });

  it("protects PDF, sending, history, retries, deletion, and reversal of foreign invoices", async () => {
    const foreign = fixtures[1];
    for (const suffix of ["pdf", "send-history"]) {
      await agents[0].get(`/api/sales/invoices/${foreign.invoice}/${suffix}`).expect(404);
    }
    await agents[0].post(`/api/sales/invoices/${foreign.invoice}/send`).send({ channel: "email", to: "attacker@test.local" }).expect(404);
    await agents[0].post(`/api/sales/invoices/${foreign.invoice}/send-history/${foreign.outbox}/retry`).send({}).expect(404);
    await agents[0].post(`/api/sales/invoices/${fixtures[0].invoice}/send-history/${foreign.outbox}/retry`).send({}).expect(404);
    await agents[0].delete(`/api/sales/invoices/${foreign.invoice}`).expect(404);
    await agents[0].post(`/api/sales/invoices/${foreign.invoice}/reverse`).send({ reason: "Unauthorized reversal" }).expect(404);
    const [unchanged] = await db.select().from(customerInvoicesTable).where(eq(customerInvoicesTable.id, foreign.invoice));
    expect(unchanged.status).toBe("open");
    expect(unchanged.reversedById).toBeNull();
    expect(unchanged.sentToCustomerAt).toBeNull();
    const pdf = await agents[0].get(`/api/sales/invoices/${fixtures[0].invoice}/pdf`).expect(200);
    expect(pdf.headers["content-type"]).toContain("application/pdf");
    const history = await agents[0].get(`/api/sales/invoices/${fixtures[0].invoice}/send-history`).expect(200);
    expect(history.body.items.map((r: { id: number }) => r.id)).toEqual([fixtures[0].outbox]);
    const count = await agents[0].get("/api/sales/invoices/email-failure-count").expect(200);
    expect(count.body.exhaustedCount).toBe(1);
  });

  it("does not cancel a foreign credit note or guess an owned legacy note's missing journal", async () => {
    await agents[0].post(`/api/sales/credit-notes/${fixtures[1].credit}/cancel`).send({}).expect(404);
    expect((await db.select().from(creditNotesTable).where(eq(creditNotesTable.id, fixtures[1].credit)))[0].status).toBe("issued");
    // Synthetic legacy note was marked issued without a journal: ownership
    // alone cannot justify a financial reversal.
    await agents[0].post(`/api/sales/credit-notes/${fixtures[0].credit}/cancel`).send({}).expect(409);
    expect((await db.select().from(creditNotesTable).where(eq(creditNotesTable.id, fixtures[0].credit)))[0].status).toBe("issued");
  });

  it("reports only the active company's revenue, customers, reps, receivables, and commission base", async () => {
    const summary = await agents[0].get("/api/sales/reports/summary").expect(200);
    expect(summary.body.invoices).toEqual({ outstanding: 100, thisMonth: 100 });
    expect(summary.body.quotations.value).toBe(100);
    const aging = await agents[0].get("/api/sales/reports/ar-aging").expect(200);
    expect(aging.body.total).toBe(100);
    expect(aging.body.customers.map((c: { customerId: number }) => c.customerId)).toEqual([fixtures[0].customer]);
    for (const report of ["by-rep", "by-customer", "by-product"]) {
      const result = await agents[0].get(`/api/sales/reports/${report}`).query(range).expect(200);
      expect(result.body).toHaveLength(1);
      expect(result.body[0].revenue).toBe(100);
      if (report === "by-rep") expect(result.body[0].repId).toBe(fixtures[0].user);
      if (report === "by-customer") expect(result.body[0].customerId).toBe(fixtures[0].customer);
    }
    const commissions = await agents[0].get("/api/sales/commission-report").query(range).expect(200);
    expect(commissions.body.total).toBe(10);
    expect(commissions.body.rows.map((r: { repId: number }) => r.repId)).toEqual([fixtures[0].user]);
    const posted = await agents[0].post("/api/sales/commissions/post").send(range).expect(200);
    expect(posted.body.total).toBe(10);
    expect(posted.body.posted).toBe(true);
    expect(posted.body.breakdown).toEqual([{ repId: fixtures[0].user, commission: 10 }]);
  });

  it("scopes CRM reports, including per-rep filters and customerless opportunities", async () => {
    const list = await agents[0].get("/api/crm/opportunities").expect(200);
    expect(list.body.map((o: { id: number }) => o.id)).toEqual([fixtures[0].opportunity]);
    const pipeline = await agents[0].get("/api/crm/pipeline").expect(200);
    expect(pipeline.body.stages.find((s: { stageId: number }) => s.stageId === stage)).toMatchObject({ count: 1, value: 100, weighted: 100 });
    const filtered = await agents[0].get("/api/crm/pipeline").query({ salesRepId: fixtures[1].user }).expect(200);
    expect(filtered.body.stages.every((s: { count: number }) => s.count === 0)).toBe(true);
    const winRate = await agents[0].get("/api/crm/reports/win-rate").expect(200);
    expect(winRate.body).toMatchObject({ totalClosed: 1, won: 1, lost: 0, winRate: 100 });
  });

  it("rejects foreign leads and customer references, but preserves owned conversion and replay", async () => {
    const own = fixtures[0], foreign = fixtures[1];
    await agents[0].post(`/api/crm/leads/${foreign.lead}/convert`).send({ stageId: stage }).expect(404);
    expect((await db.select().from(leadsTable).where(eq(leadsTable.id, foreign.lead)))[0].status).toBe("new");
    expect(await db.select().from(opportunitiesTable).where(eq(opportunitiesTable.leadId, foreign.lead))).toHaveLength(0);
    await agents[0].post(`/api/crm/leads/${own.lead}/convert`).send({ customerId: foreign.customer }).expect(404);
    await agents[0].post("/api/crm/opportunities").send({
      name: tag, stageId: stage, customerId: foreign.customer, customerName: "forged",
    }).expect(404);
    await agents[0].patch(`/api/crm/opportunities/${own.opportunity}`).send({ customerId: foreign.customer }).expect(404);
    const converted = await agents[0].post(`/api/crm/leads/${own.lead}/convert`).send({ stageId: stage }).expect(201);
    expect(converted.body.companyId).toBe(own.company);
    expect(converted.body.expectedRevenue).toBe(100);
    const replay = await agents[0].post(`/api/crm/leads/${own.lead}/convert`).send({ stageId: stage }).expect(201);
    expect(replay.body.id).toBe(converted.body.id);
    expect((await db.select().from(leadsTable).where(eq(leadsTable.id, own.lead)))[0].status).toBe("qualified");
  });

  it("still allows an owned invoice to be reversed", async () => {
    const result = await agents[0].post(`/api/sales/invoices/${fixtures[0].invoice}/reverse`).send({ reason: "Synthetic correction" }).expect(200);
    expect(result.body.reverse.companyId).toBe(fixtures[0].company);
    expect(result.body.reverse.total).toBe(-100);
  });

  it("rejects foreign credit-note products and warehouses before any stock or financial write", async () => {
    const own = fixtures[0], foreign = fixtures[1];
    const snapshot = async () => ({
      product: await db.select().from(productsTable).where(eq(productsTable.id, foreign.product)),
      quants: await db.select().from(stockQuantsTable).where(eq(stockQuantsTable.productId, foreign.product)),
      moves: await db.select().from(stockMovesTable).where(eq(stockMovesTable.productId, foreign.product)),
      notes: await db.select().from(creditNotesTable).where(eq(creditNotesTable.companyId, own.company)),
      journals: await db.select().from(journalEntriesTable).where(eq(journalEntriesTable.companyId, own.company)),
    });
    const before = await snapshot();
    for (const restock of [true, false]) {
      for (const [warehouseId, productId] of [
        [foreign.warehouse, foreign.product],
        [own.warehouse, foreign.product],
        [foreign.warehouse, own.product],
      ]) {
        await agents[0].post("/api/sales/credit-notes").send({
          customerId: own.customer, warehouseId, restock,
          lines: [{ productId, description: "Forged return", quantity: 2, unitPrice: 10, taxRate: 0 }],
        }).expect(404);
      }
      // Omitting the warehouse must not bypass product validation.
      await agents[0].post("/api/sales/credit-notes").send({
        customerId: own.customer, restock,
        lines: [{ productId: foreign.product, description: "Forged return", quantity: 2, unitPrice: 10, taxRate: 0 }],
      }).expect(404);
    }
    expect(await snapshot()).toEqual(before);

    // Historical mixed-company notes must also fail closed on cancellation.
    const [poisoned] = await db.insert(creditNotesTable).values({
      companyId: own.company, reference: `${tag}-poisoned-CN`, customerId: own.customer,
      customerName: tag, noteDate: date, status: "issued", restock: true,
      warehouseId: foreign.warehouse, subtotal: "20", total: "20",
    }).returning();
    await db.insert(creditNoteLinesTable).values({
      noteId: poisoned.id, productId: foreign.product, description: tag,
      quantity: "2", unitPrice: "10", lineTotal: "20",
    });
    await agents[0].post(`/api/sales/credit-notes/${poisoned.id}/cancel`).send({}).expect(404);
    expect((await db.select().from(creditNotesTable).where(eq(creditNotesTable.id, poisoned.id)))[0].status).toBe("issued");
    const after = await snapshot();
    expect(after.product).toEqual(before.product);
    expect(after.quants).toEqual(before.quants);
    expect(after.moves).toEqual(before.moves);
    expect(after.journals).toEqual(before.journals);
  });

  it("issues and cancels an owned inventory return without touching foreign stock", async () => {
    const own = fixtures[0], foreign = fixtures[1];
    const foreignBefore = await db.select().from(stockQuantsTable).where(eq(stockQuantsTable.productId, foreign.product));
    // A physical return now requires a genuine original sale/issue, rather
    // than using a free-form credit to manufacture stock at today's price.
    const invoice = await agents[0].post("/api/sales/invoices").send({
      customerId: own.customer,
      lines: [{ productId: own.product, description: "Owned sale", quantity: 2, unitPrice: 10, taxRate: 0 }],
    }).expect(201);
    const [invoiceLine] = await db.select().from(customerInvoiceLinesTable)
      .where(eq(customerInvoiceLinesTable.invoiceId, invoice.body.id));
    await db.transaction((tx) => recordStockMove(tx, {
      companyId: own.company, productId: own.product, quantity: 2, kind: "issue",
      fromWarehouseId: own.warehouse, invoiceLineId: invoiceLine.id, sourceRef: invoice.body.reference,
    }));
    const created = await agents[0].post("/api/sales/credit-notes").send({
      invoiceId: invoice.body.id, customerId: own.customer, restock: true,
      lines: [{ invoiceLineId: invoiceLine.id, productId: own.product, description: "Owned return", quantity: 2, unitPrice: 10, taxRate: 0 }],
    }).expect(201);
    expect(created.body.companyId).toBe(own.company);
    expect(created.body.warehouseId).toBe(own.warehouse);
    expect(Number((await db.select().from(stockQuantsTable).where(eq(stockQuantsTable.productId, own.product)))[0].quantity)).toBe(10);
    await agents[0].post(`/api/sales/credit-notes/${created.body.id}/cancel`).send({}).expect(200);
    expect(Number((await db.select().from(stockQuantsTable).where(eq(stockQuantsTable.productId, own.product)))[0].quantity)).toBe(8);
    expect(await db.select().from(stockQuantsTable).where(eq(stockQuantsTable.productId, foreign.product))).toEqual(foreignBefore);
  });
});
