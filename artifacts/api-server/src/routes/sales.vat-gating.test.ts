/**
 * VAT-gating regression for customer-invoice creation.
 *
 * When a company's `vatRegistrationStatus` is `not_registered`, the
 * backend MUST force every line's tax rate to 0 (so persisted
 * customer_invoices.vat = 0) and skip the ZATCA QR — regardless of the
 * inbound payload's `taxRate`. This test posts a real invoice through
 * the full middleware chain for a not-registered tenant with a payload
 * that asks for 15% VAT, and asserts vat=0 + each line.taxRate=0 +
 * zatcaQr is null.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { eq, inArray } from "drizzle-orm";

import {
  db,
  pool,
  companiesTable,
  usersTable,
  userCompaniesTable,
  categoriesTable,
  productsTable,
  customersTable,
  customerInvoicesTable,
  customerInvoiceLinesTable,
} from "@workspace/db";
import app from "../app";

const RUN_TAG = `vitest-salesvat-${Date.now()}`;
const PASSWORD = "Test1234!";

let companyId = 0;
let userId = 0;
let categoryId = 0;
let productId = 0;
let customerId = 0;
let createdInvoiceId = 0;

let agent: request.Agent;

beforeAll(async () => {
  const [co] = await db
    .insert(companiesTable)
    .values({
      name: `SalesVAT Co ${RUN_TAG}`,
      baseCurrency: "SAR",
      vatRegistrationStatus: "not_registered",
    })
    .returning();
  companyId = co.id;

  const hash = await bcrypt.hash(PASSWORD, 4);
  const [u] = await db
    .insert(usersTable)
    .values({
      name: `User ${RUN_TAG}`,
      email: `salesvat-${RUN_TAG}@test.local`,
      passwordHash: hash,
      role: "owner",
      isActive: true,
    })
    .returning();
  userId = u.id;
  await db.insert(userCompaniesTable).values({
    userId,
    companyId,
    role: "owner",
    isDefault: true,
  });

  const [cat] = await db
    .insert(categoriesTable)
    .values({ name: `SV Cat ${RUN_TAG}`, nameAr: `فئة ${RUN_TAG}` })
    .returning();
  categoryId = cat.id;

  const [p] = await db
    .insert(productsTable)
    .values({
      name: `SV Prod ${RUN_TAG}`,
      nameAr: `منتج ${RUN_TAG}`,
      sku: `SV-SKU-${RUN_TAG}`,
      categoryId,
      price: "100.00",
      costPrice: "50.00",
      companyId,
    })
    .returning();
  productId = p.id;

  const [cust] = await db
    .insert(customersTable)
    .values({
      name: `Cust ${RUN_TAG}`,
      companyId,
    })
    .returning();
  customerId = cust.id;

  agent = request.agent(app);
  const login = await agent
    .post("/api/auth/login")
    .send({ email: `salesvat-${RUN_TAG}@test.local`, password: PASSWORD });
  if (login.status !== 200) {
    throw new Error(
      `login failed status=${login.status} body=${JSON.stringify(login.body)}`,
    );
  }
});

afterAll(async () => {
  const tryRun = async (sql: string, params: unknown[] = []) => {
    try {
      await pool.query(sql, params);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[salesvat cleanup]", (e as Error).message);
    }
  };

  if (customerId) {
    await tryRun(
      `DELETE FROM customer_receipt_allocations
         WHERE invoice_id IN (SELECT id FROM customer_invoices WHERE customer_id = $1)
            OR receipt_id IN (SELECT id FROM customer_receipts WHERE customer_id = $1)`,
      [customerId],
    );
    await tryRun(`DELETE FROM customer_receipts WHERE customer_id = $1`, [
      customerId,
    ]);
    await tryRun(
      `DELETE FROM customer_invoice_lines
         WHERE invoice_id IN (SELECT id FROM customer_invoices WHERE customer_id = $1)`,
      [customerId],
    );
    await tryRun(`DELETE FROM customer_invoices WHERE customer_id = $1`, [
      customerId,
    ]);
  }

  if (companyId) {
    await tryRun(
      `DELETE FROM journal_entry_lines
         WHERE entry_id IN (SELECT id FROM journal_entries WHERE company_id = $1)`,
      [companyId],
    );
    await tryRun(`DELETE FROM journal_entries WHERE company_id = $1`, [
      companyId,
    ]);
    await tryRun(`DELETE FROM audit_logs WHERE company_id = $1`, [companyId]);
  }

  if (customerId) {
    await db.delete(customersTable).where(eq(customersTable.id, customerId));
  }
  if (productId) {
    await db.delete(productsTable).where(eq(productsTable.id, productId));
  }
  if (categoryId) {
    await db.delete(categoriesTable).where(eq(categoriesTable.id, categoryId));
  }
  if (userId) {
    await db
      .delete(userCompaniesTable)
      .where(inArray(userCompaniesTable.userId, [userId]));
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  }
  if (companyId) {
    // Inventory subsystem may auto-provision warehouses for the tenant.
    await tryRun(
      `DELETE FROM stock_moves
         WHERE from_warehouse_id IN (SELECT id FROM warehouses WHERE company_id = $1)
            OR to_warehouse_id   IN (SELECT id FROM warehouses WHERE company_id = $1)`,
      [companyId],
    );
    await tryRun(
      `DELETE FROM stock_quants
         WHERE warehouse_id IN (SELECT id FROM warehouses WHERE company_id = $1)`,
      [companyId],
    );
    await tryRun(`DELETE FROM warehouses WHERE company_id = $1`, [companyId]);
    await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
  }
});

describe("Sales invoices — VAT gating for not_registered tenant", () => {
  it("forces persisted VAT + every line.taxRate to 0 and skips ZATCA QR", async () => {
    const res = await agent
      .post("/api/sales/invoices")
      .send({
        customerId,
        lines: [
          {
            productId,
            description: "VATGate sales line",
            quantity: 2,
            unitPrice: 100,
            discountPct: 0,
            // Caller asks for 15% — the backend MUST clamp this to 0.
            taxRate: 15,
          },
        ],
      });
    if (res.status !== 201) {
      throw new Error(
        `invoice create returned ${res.status}: ${JSON.stringify(res.body)}`,
      );
    }
    createdInvoiceId = (res.body as { id: number }).id;

    const [inv] = await db
      .select({
        vat: customerInvoicesTable.vat,
        subtotal: customerInvoicesTable.subtotal,
        total: customerInvoicesTable.total,
        zatcaQr: customerInvoicesTable.zatcaQr,
      })
      .from(customerInvoicesTable)
      .where(eq(customerInvoicesTable.id, createdInvoiceId));

    expect(Number(inv.vat)).toBe(0);
    // 2 × 100, no discount, no VAT → total = subtotal = 200.
    expect(Number(inv.subtotal)).toBe(200);
    expect(Number(inv.total)).toBe(200);
    expect(inv.zatcaQr).toBeNull();

    const lines = await db
      .select({ taxRate: customerInvoiceLinesTable.taxRate })
      .from(customerInvoiceLinesTable)
      .where(eq(customerInvoiceLinesTable.invoiceId, createdInvoiceId));
    expect(lines.length).toBeGreaterThan(0);
    for (const ln of lines) {
      expect(Number(ln.taxRate)).toBe(0);
    }
  });
});
