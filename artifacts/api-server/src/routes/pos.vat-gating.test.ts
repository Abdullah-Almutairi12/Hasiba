import { cleanupCompanyDefaults } from "../test/cleanup-company-defaults";
/**
 * VAT-gating regression for POS order creation.
 *
 * When a company's `vatRegistrationStatus` is `not_registered`, the
 * backend MUST force the order's tax to 0 and skip ZATCA QR generation
 * — even if the (legacy) client somehow asks for VAT. This test posts
 * a real order through the full middleware chain and asserts the
 * persisted `pos_orders.tax` row is "0.00".
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
  branchesTable,
  warehousesTable,
  posSessionsTable,
  posOrdersTable,
  customersTable,
  stockQuantsTable,
} from "@workspace/db";
import app from "../app";

const RUN_TAG = `vitest-vatgate-${Date.now()}`;
const PASSWORD = "Test1234!";

let companyId = 0;
let userId = 0;
let categoryId = 0;
let productId = 0;
let branchId = 0;
let warehouseId = 0;
let sessionId = 0;
let walkinCustomerId = 0;
let createdOrderId = 0;

let agent: request.Agent;

beforeAll(async () => {
  const [co] = await db
    .insert(companiesTable)
    .values({
      name: `VATGate Co ${RUN_TAG}`,
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
      email: `vatgate-${RUN_TAG}@test.local`,
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
    .values({ name: `VG Cat ${RUN_TAG}`, nameAr: `فئة ${RUN_TAG}` })
    .returning();
  categoryId = cat.id;

  const [p] = await db
    .insert(productsTable)
    .values({
      name: `VG Prod ${RUN_TAG}`,
      nameAr: `منتج ${RUN_TAG}`,
      sku: `VG-SKU-${RUN_TAG}`,
      categoryId,
      price: "100.00",
      costPrice: "50.00",
      companyId,
    })
    .returning();
  productId = p.id;

  const [br] = await db
    .insert(branchesTable)
    .values({
      name: `VG Branch ${RUN_TAG}`,
      nameAr: `فرع ${RUN_TAG}`,
      city: "Riyadh",
      companyId,
    })
    .returning();
  branchId = br.id;

  const [wh] = await db
    .insert(warehousesTable)
    .values({
      name: `VG WH ${RUN_TAG}`,
      nameAr: `مستودع ${RUN_TAG}`,
      branchId,
      isDefault: true,
      companyId,
    })
    .returning();
  warehouseId = wh.id;

  // Seed initial on-hand stock so the POS issue can debit inventory.
  await db.insert(stockQuantsTable).values({
    productId,
    warehouseId,
    quantity: "100",
    avgCost: "50",
  });

  // Deliberately omit the walk-in customer: the first real checkout must
  // provision its OWN tenant's default without requiring a server restart.

  const [s] = await db
    .insert(posSessionsTable)
    .values({
      sessionNumber: `VG-POS-${RUN_TAG}`,
      branchId,
      cashierName: "Cashier",
    })
    .returning();
  sessionId = s.id;

  agent = request.agent(app);
  const login = await agent
    .post("/api/auth/login")
    .send({ email: `vatgate-${RUN_TAG}@test.local`, password: PASSWORD });
  if (login.status !== 200) {
    throw new Error(
      `login failed status=${login.status} body=${JSON.stringify(login.body)}`,
    );
  }
});

afterAll(async () => {
  // Tear down everything the POS create flow touches, in strict FK
  // order. POS create writes to: pos_orders, customer_invoices (+lines,
  // +receipts +allocations), sales_orders (+lines, +delivery_orders
  // +lines), stock_moves/stock_quants, journal_entries (+lines),
  // audit_logs. Use raw SQL filtered by our tenant's company_id /
  // related ids so we don't have to import every dependent table.
  const tryRun = async (sql: string, params: unknown[] = []) => {
    try {
      await pool.query(sql, params);
    } catch (e) {
      // best-effort cleanup; surface but don't fail the suite
      // eslint-disable-next-line no-console
      console.warn("[vatgate cleanup]", (e as Error).message);
    }
  };

  if (createdOrderId) {
    await db.delete(posOrdersTable).where(eq(posOrdersTable.id, createdOrderId));
  }
  if (sessionId) {
    await db.delete(posSessionsTable).where(eq(posSessionsTable.id, sessionId));
  }
  // Stock movements now retain a restrictive reference to invoice lines.
  // Delete this fixture's moves before deleting their source documents.
  if (warehouseId) {
    await tryRun(
      `DELETE FROM stock_moves WHERE from_warehouse_id = $1 OR to_warehouse_id = $1`,
      [warehouseId],
    );
  }

  if (walkinCustomerId) {
    await tryRun(
      `DELETE FROM customer_receipt_allocations
         WHERE receipt_id IN (SELECT id FROM customer_receipts WHERE customer_id = $1)
            OR invoice_id IN (SELECT id FROM customer_invoices WHERE customer_id = $1)`,
      [walkinCustomerId],
    );
    await tryRun(
      `DELETE FROM customer_receipts WHERE customer_id = $1`,
      [walkinCustomerId],
    );
    await tryRun(
      `DELETE FROM customer_invoice_lines
         WHERE invoice_id IN (SELECT id FROM customer_invoices WHERE customer_id = $1)`,
      [walkinCustomerId],
    );
    await tryRun(
      `DELETE FROM customer_invoices WHERE customer_id = $1`,
      [walkinCustomerId],
    );
    await tryRun(
      `DELETE FROM delivery_order_lines
         WHERE do_id IN (
           SELECT id FROM delivery_orders
            WHERE so_id IN (SELECT id FROM sales_orders WHERE customer_id = $1)
         )`,
      [walkinCustomerId],
    );
    await tryRun(
      `DELETE FROM delivery_orders
         WHERE so_id IN (SELECT id FROM sales_orders WHERE customer_id = $1)`,
      [walkinCustomerId],
    );
    await tryRun(
      `DELETE FROM sales_order_lines
         WHERE so_id IN (SELECT id FROM sales_orders WHERE customer_id = $1)`,
      [walkinCustomerId],
    );
    await tryRun(
      `DELETE FROM sales_orders WHERE customer_id = $1`,
      [walkinCustomerId],
    );
  }

  if (companyId) {
    await tryRun(
      `DELETE FROM journal_entry_lines
         WHERE entry_id IN (SELECT id FROM journal_entries WHERE company_id = $1)`,
      [companyId],
    );
    await tryRun(`DELETE FROM journal_entries WHERE company_id = $1`, [companyId]);
    await tryRun(`DELETE FROM audit_logs WHERE company_id = $1`, [companyId]);
  }

  if (warehouseId) {
    await tryRun(
      `DELETE FROM stock_moves
         WHERE from_warehouse_id = $1 OR to_warehouse_id = $1`,
      [warehouseId],
    );
    await db
      .delete(stockQuantsTable)
      .where(eq(stockQuantsTable.warehouseId, warehouseId));
    await db
      .delete(warehousesTable)
      .where(eq(warehousesTable.id, warehouseId));
  }
  if (companyId) {
    await db
      .delete(customersTable)
      .where(eq(customersTable.companyId, companyId));
  }
  if (branchId) {
    await db.delete(branchesTable).where(eq(branchesTable.id, branchId));
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
    // Inventory subsystem may auto-provision extra warehouses (e.g.
    // "Scrap") for the new tenant; sweep them before the company delete
    // since warehouses.company_id is NOT NULL.
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
    await cleanupCompanyDefaults([companyId]);
    await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
  }
});

describe("POS — VAT gating for not_registered tenant", () => {
  it("forces persisted tax to 0 even when sale would normally accrue 15% VAT", async () => {
    const res = await agent
      .post("/api/pos/orders")
      .send({
        sessionId,
        items: [{ productId, quantity: 1 }],
        paymentMethod: "cash",
        discount: 0,
      });
    if (res.status !== 201) {
      throw new Error(
        `POS create returned ${res.status}: ${JSON.stringify(res.body)}`,
      );
    }
    createdOrderId = (res.body as { id: number }).id;
    const walkin = await pool.query<{ id: number }>(
      "SELECT id FROM customers WHERE company_id = $1 AND tax_number = 'POS-WALKIN'", [companyId],
    );
    expect(walkin.rows).toHaveLength(1);
    walkinCustomerId = walkin.rows[0].id;

    const [row] = await db
      .select({
        tax: posOrdersTable.tax,
        subtotal: posOrdersTable.subtotal,
        total: posOrdersTable.total,
      })
      .from(posOrdersTable)
      .where(eq(posOrdersTable.id, createdOrderId));

    expect(Number(row.tax)).toBe(0);
    // Subtotal=100, discount=0, tax=0 → total should equal subtotal.
    expect(Number(row.total)).toBe(Number(row.subtotal));
  });
});

describe("POS checkout rejects invalid context without partial financial effects", () => {
  const checkoutBody = () => ({
    sessionId, items: [{ productId, quantity: 1 }], paymentMethod: "cash", discount: 0,
  });
  const snapshot = async () => {
    const result = await pool.query(`
      SELECT
        (SELECT count(*) FROM pos_orders WHERE company_id = $1) AS orders,
        (SELECT count(*) FROM customer_invoices WHERE company_id = $1) AS invoices,
        (SELECT count(*) FROM journal_entries WHERE company_id = $1) AS journals,
        (SELECT count(*) FROM stock_moves WHERE product_id = $2) AS moves,
        (SELECT quantity::text FROM stock_quants WHERE product_id = $2 AND warehouse_id = $3) AS quantity,
        (SELECT orders_count FROM pos_sessions WHERE id = $4) AS session_orders
    `, [companyId, productId, warehouseId, sessionId]);
    return result.rows[0];
  };
  it("rejects a closed session with an actionable 409 instead of writing a sale", async () => {
    const before = await snapshot();
    await db.update(posSessionsTable).set({ status: "closed" }).where(eq(posSessionsTable.id, sessionId));
    try {
      const response = await agent.post("/api/pos/orders").send(checkoutBody());
      expect(response.status).toBe(409);
      expect(response.body.error).toContain("الوردية مغلقة");
      expect(await snapshot()).toEqual(before);
    } finally {
      await db.update(posSessionsTable).set({ status: "open" }).where(eq(posSessionsTable.id, sessionId));
    }
  });
  it("rejects an empty cart before creating financial documents", async () => {
    const before = await snapshot();
    const response = await agent.post("/api/pos/orders").send({ ...checkoutBody(), items: [] });
    expect(response.status).toBe(400);
    expect(await snapshot()).toEqual(before);
  });
  it("rolls back the first line when a later product is unavailable", async () => {
    const before = await snapshot();
    const response = await agent.post("/api/pos/orders").send({
      ...checkoutBody(), items: [{ productId, quantity: 1 }, { productId: 2147483647, quantity: 1 }],
    });
    expect(response.status).toBe(404);
    expect(response.body.error).toContain("أحد منتجات السلة غير متاح");
    expect(await snapshot()).toEqual(before);
  });
  it("does not fall back to a default warehouse belonging to a different branch", async () => {
    const before = await snapshot();
    // The generated warehouse remains a global default, but NOT for this till.
    await db.update(warehousesTable).set({ branchId: 0 }).where(eq(warehousesTable.id, warehouseId));
    try {
      const response = await agent.post("/api/pos/orders").send(checkoutBody());
      expect(response.status).toBe(409);
      expect(response.body.error).toContain("مستودع صالح لهذا الفرع");
      expect(await snapshot()).toEqual(before);
    } finally {
      await db.update(warehousesTable).set({ branchId }).where(eq(warehousesTable.id, warehouseId));
    }
  });
  it("rejects a mixed-company cart as a whole, without disclosing the other company", async () => {
    const [foreignCompany] = await db.insert(companiesTable).values({ name: `Foreign ${RUN_TAG}` }).returning();
    const [foreignProduct] = await db.insert(productsTable).values({
      name: "Foreign product", nameAr: "منتج خارجي", sku: `foreign-${RUN_TAG}`,
      categoryId, companyId: foreignCompany.id, price: "10", costPrice: "5",
    }).returning();
    const before = await snapshot();
    try {
      const response = await agent.post("/api/pos/orders").send({
        ...checkoutBody(), items: [{ productId, quantity: 1 }, { productId: foreignProduct.id, quantity: 1 }],
      });
      expect(response.status).toBe(404);
      expect(response.body.error).toBe("أحد منتجات السلة غير متاح لهذه المنشأة. راجع السلة قبل الدفع.");
      expect(await snapshot()).toEqual(before);
    } finally {
      await db.delete(productsTable).where(eq(productsTable.id, foreignProduct.id));
      await db.delete(companiesTable).where(eq(companiesTable.id, foreignCompany.id));
    }
  });
});
