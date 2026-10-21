import { cleanupCompanyDefaults } from "../test/cleanup-company-defaults";
/**
 * VAT-gating regression for purchase-order creation.
 *
 * When a company's `vatRegistrationStatus` is `not_registered`, the
 * backend MUST clamp every PO line's tax rate to 0 (so persisted
 * `purchase_orders.vat` = 0 and every line.tax_rate = 0) — regardless
 * of the inbound payload's `taxRate` or the supplier's `defaultTax`.
 * This test posts a real PO through the full middleware chain for a
 * not-registered tenant whose supplier defaults to 15% AND whose line
 * payload also asks for 15%, then asserts both the header VAT and
 * every line tax rate land at zero.
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
  suppliersTable,
  purchaseOrdersTable,
  purchaseOrderLinesTable,
} from "@workspace/db";
import app from "../app";

const RUN_TAG = `vitest-provat-${Date.now()}`;
const PASSWORD = "Test1234!";

let companyId = 0;
let userId = 0;
let supplierId = 0;
let createdPoId = 0;

let agent: request.Agent;

beforeAll(async () => {
  const [co] = await db
    .insert(companiesTable)
    .values({
      name: `ProVAT Co ${RUN_TAG}`,
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
      email: `provat-${RUN_TAG}@test.local`,
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

  // Supplier intentionally configured at 15% so we can prove the
  // gating overrides BOTH the payload and the supplier default.
  const [sup] = await db
    .insert(suppliersTable)
    .values({
      companyId,
      name: `Sup ${RUN_TAG}`,
      defaultTax: "15",
      defaultCurrency: "SAR",
    })
    .returning();
  supplierId = sup.id;

  agent = request.agent(app);
  const login = await agent
    .post("/api/auth/login")
    .send({ email: `provat-${RUN_TAG}@test.local`, password: PASSWORD });
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
      console.warn("[provat cleanup]", (e as Error).message);
    }
  };

  if (createdPoId) {
    await tryRun(`DELETE FROM purchase_order_lines WHERE po_id = $1`, [createdPoId]);
    await tryRun(`DELETE FROM purchase_orders WHERE id = $1`, [createdPoId]);
  }
  if (supplierId) {
    await db.delete(suppliersTable).where(eq(suppliersTable.id, supplierId));
  }
  if (companyId) {
    await tryRun(`DELETE FROM audit_logs WHERE company_id = $1`, [companyId]);
  }
  if (userId) {
    await db
      .delete(userCompaniesTable)
      .where(inArray(userCompaniesTable.userId, [userId]));
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  }
  if (companyId) {
    await cleanupCompanyDefaults([companyId]);
    await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
  }
});

describe("Purchase orders — VAT gating for not_registered tenant", () => {
  it("forces persisted PO header VAT + every line.taxRate to 0", async () => {
    const res = await agent
      .post("/api/procurement/purchase-orders")
      .send({
        supplierId,
        notes: null,
        lines: [
          {
            productId: null,
            description: "VATGate procurement line",
            quantity: 2,
            unitPrice: 100,
            // Caller asks for 15% AND supplier defaults to 15% — backend
            // MUST clamp both to 0 because the tenant is not registered.
            taxRate: 15,
          },
        ],
      });
    if (res.status !== 201) {
      throw new Error(
        `PO create returned ${res.status}: ${JSON.stringify(res.body)}`,
      );
    }
    createdPoId = (res.body as { id: number }).id;

    const [po] = await db
      .select({
        vat: purchaseOrdersTable.vat,
        subtotal: purchaseOrdersTable.subtotal,
        total: purchaseOrdersTable.total,
      })
      .from(purchaseOrdersTable)
      .where(eq(purchaseOrdersTable.id, createdPoId));

    expect(Number(po.vat)).toBe(0);
    // 2 × 100, no VAT → subtotal = total = 200.
    expect(Number(po.subtotal)).toBe(200);
    expect(Number(po.total)).toBe(200);

    const lines = await db
      .select({ taxRate: purchaseOrderLinesTable.taxRate })
      .from(purchaseOrderLinesTable)
      .where(eq(purchaseOrderLinesTable.poId, createdPoId));
    expect(lines.length).toBeGreaterThan(0);
    for (const ln of lines) {
      expect(Number(ln.taxRate)).toBe(0);
    }
  });
});
