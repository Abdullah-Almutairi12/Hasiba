import { cleanupCompanyDefaults } from "../test/cleanup-company-defaults";
/**
 * Order Parking (hold/resume) HTTP integration tests. Boots the real
 * Express app and asserts:
 *   - park endpoint creates a `status='parked'` row with no payment
 *     trigger violation (parked rows skip pos_order_payments).
 *   - list endpoint is session AND tenant scoped.
 *   - resume returns the snapshot, deletes the row, and a second
 *     resume returns 404 (atomic).
 *   - cross-tenant: tenant B cannot park into A's session, cannot
 *     list A's parked rows, cannot resume A's parked row.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  companiesTable,
  usersTable,
  userCompaniesTable,
  categoriesTable,
  productsTable,
  branchesTable,
  posSessionsTable,
  posOrdersTable,
  auditLogsTable,
  warehousesTable,
} from "@workspace/db";
import app from "../app";

const RUN_TAG = `vitest-park-${Date.now()}`;
const PASSWORD = "Test1234!";

let companyAId = 0;
let companyBId = 0;
let userAId = 0;
let userBId = 0;
let categoryId = 0;
let productAId = 0;
let branchAId = 0;
let branchBId = 0;
let sessionAId = 0;
let sessionBId = 0;

let agentA: request.Agent;
let agentB: request.Agent;

beforeAll(async () => {
  const [a] = await db
    .insert(companiesTable)
    .values({ name: `Park Co A ${RUN_TAG}`, baseCurrency: "SAR" })
    .returning();
  const [b] = await db
    .insert(companiesTable)
    .values({ name: `Park Co B ${RUN_TAG}`, baseCurrency: "SAR" })
    .returning();
  companyAId = a.id;
  companyBId = b.id;

  const hash = await bcrypt.hash(PASSWORD, 4);
  const [uA] = await db
    .insert(usersTable)
    .values({
      name: `Park U A ${RUN_TAG}`,
      email: `park-a-${RUN_TAG}@test.local`,
      passwordHash: hash,
      role: "owner",
      isActive: true,
    })
    .returning();
  const [uB] = await db
    .insert(usersTable)
    .values({
      name: `Park U B ${RUN_TAG}`,
      email: `park-b-${RUN_TAG}@test.local`,
      passwordHash: hash,
      role: "owner",
      isActive: true,
    })
    .returning();
  userAId = uA.id;
  userBId = uB.id;

  await db.insert(userCompaniesTable).values([
    { userId: userAId, companyId: companyAId, role: "owner", isDefault: true },
    { userId: userBId, companyId: companyBId, role: "owner", isDefault: true },
  ]);

  const [cat] = await db
    .insert(categoriesTable)
    .values({ name: `Park Cat ${RUN_TAG}`, nameAr: `فئة ${RUN_TAG}` })
    .returning();
  categoryId = cat.id;

  const [pA] = await db
    .insert(productsTable)
    .values({
      name: `Park Prod ${RUN_TAG}`,
      nameAr: `منتج ${RUN_TAG}`,
      sku: `PARK-SKU-${RUN_TAG}`,
      categoryId,
      price: "30.00",
      costPrice: "10.00",
      companyId: companyAId,
    })
    .returning();
  productAId = pA.id;

  const [brA] = await db
    .insert(branchesTable)
    .values({
      name: `Park Br A ${RUN_TAG}`,
      nameAr: `فرع A ${RUN_TAG}`,
      city: "Riyadh",
      companyId: companyAId,
    })
    .returning();
  const [brB] = await db
    .insert(branchesTable)
    .values({
      name: `Park Br B ${RUN_TAG}`,
      nameAr: `فرع B ${RUN_TAG}`,
      city: "Jeddah",
      companyId: companyBId,
    })
    .returning();
  branchAId = brA.id;
  branchBId = brB.id;

  const [sA] = await db
    .insert(posSessionsTable)
    .values({
      sessionNumber: `PARK-POS-A-${RUN_TAG}`,
      branchId: branchAId,
      cashierName: "A",
    })
    .returning();
  const [sB] = await db
    .insert(posSessionsTable)
    .values({
      sessionNumber: `PARK-POS-B-${RUN_TAG}`,
      branchId: branchBId,
      cashierName: "B",
    })
    .returning();
  sessionAId = sA.id;
  sessionBId = sB.id;

  agentA = request.agent(app);
  agentB = request.agent(app);
  const lA = await agentA
    .post("/api/auth/login")
    .send({ email: `park-a-${RUN_TAG}@test.local`, password: PASSWORD });
  const lB = await agentB
    .post("/api/auth/login")
    .send({ email: `park-b-${RUN_TAG}@test.local`, password: PASSWORD });
  if (lA.status !== 200 || lB.status !== 200) {
    throw new Error(
      `login failed A=${lA.status} B=${lB.status} ${JSON.stringify(lA.body)} ${JSON.stringify(lB.body)}`,
    );
  }
});

afterAll(async () => {
  // Clear any parked rows + sessions + branches for both tenants
  const brIds = [branchAId, branchBId].filter((n) => n > 0);
  if (brIds.length > 0) {
    // Sweep ALL sessions (including the extra one created mid-suite for
    // the cross-session resume test) so the branches FK can drop cleanly.
    const sessRows = await db
      .select({ id: posSessionsTable.id })
      .from(posSessionsTable)
      .where(inArray(posSessionsTable.branchId, brIds));
    const sIds = sessRows.map((r) => r.id);
    if (sIds.length > 0) {
      await db
        .delete(posOrdersTable)
        .where(inArray(posOrdersTable.sessionId, sIds));
      await db
        .delete(posSessionsTable)
        .where(inArray(posSessionsTable.id, sIds));
    }
    await db.delete(branchesTable).where(inArray(branchesTable.id, brIds));
  }
  if (productAId) await db.delete(productsTable).where(eq(productsTable.id, productAId));
  if (categoryId) await db.delete(categoriesTable).where(eq(categoriesTable.id, categoryId));
  const uids = [userAId, userBId].filter((n) => n > 0);
  if (uids.length > 0) {
    await db.delete(userCompaniesTable).where(inArray(userCompaniesTable.userId, uids));
    await db.delete(usersTable).where(inArray(usersTable.id, uids));
  }
  const coIds = [companyAId, companyBId].filter((n) => n > 0);
  if (coIds.length > 0) {
    await db.delete(auditLogsTable).where(inArray(auditLogsTable.companyId, coIds));
    await db.delete(warehousesTable).where(inArray(warehousesTable.companyId, coIds));
    await cleanupCompanyDefaults(coIds);
    await db.delete(companiesTable).where(inArray(companiesTable.id, coIds));
  }
});

function parkBody(opts: { sessionId: number; label?: string }) {
  return {
    sessionId: opts.sessionId,
    label: opts.label ?? "Table 5",
    items: [
      {
        productId: productAId,
        quantity: 2,
        priceSnapshot: 30,
        nameSnapshot: "Park Prod",
      },
    ],
    subtotal: 60,
    tax: 9,
    discount: 0,
    total: 69,
  };
}

describe("POST /api/pos/orders/park", () => {
  it("parks an order with status='parked' and skips the payment-balance trigger", async () => {
    const res = await agentA
      .post("/api/pos/orders/park")
      .send(parkBody({ sessionId: sessionAId, label: "Table A1" }));
    expect(res.status).toBe(201);
    expect(res.body.parkedLabel).toBe("Table A1");
    expect(Number(res.body.total)).toBe(69);

    const [row] = await db
      .select()
      .from(posOrdersTable)
      .where(eq(posOrdersTable.id, res.body.id));
    expect(row.status).toBe("parked");
    expect(row.companyId).toBe(companyAId);
  });

  it("rejects park into another tenant's session with 404", async () => {
    const res = await agentB
      .post("/api/pos/orders/park")
      .send(parkBody({ sessionId: sessionAId, label: "x-tenant" }));
    expect(res.status).toBe(404);
  });
});

describe("GET /api/pos/orders/parked", () => {
  it("lists only the caller's parked orders for the given session", async () => {
    // Tenant A's session already has at least one parked row from
    // the previous block; create another to verify ordering.
    await agentA
      .post("/api/pos/orders/park")
      .send(parkBody({ sessionId: sessionAId, label: "Table A2" }));

    const res = await agentA.get(
      `/api/pos/orders/parked?sessionId=${sessionAId}`,
    );
    expect(res.status).toBe(200);
    const labels = (res.body as Array<{ parkedLabel: string }>).map(
      (r) => r.parkedLabel,
    );
    expect(labels).toContain("Table A1");
    expect(labels).toContain("Table A2");
  });

  it("returns empty list for tenant B querying tenant A's session", async () => {
    const res = await agentB.get(
      `/api/pos/orders/parked?sessionId=${sessionAId}`,
    );
    // Endpoint is tenant-scoped → leak-free → empty array (200), not 403/leak.
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe("POST /api/pos/orders/:id/resume", () => {
  it("resume returns the snapshot, deletes the row, and a second resume returns 404", async () => {
    const created = await agentA
      .post("/api/pos/orders/park")
      .send(parkBody({ sessionId: sessionAId, label: "ToResume" }));
    expect(created.status).toBe(201);
    const id = created.body.id as number;

    const r1 = await agentA
      .post(`/api/pos/orders/${id}/resume`)
      .send({ sessionId: sessionAId });
    expect(r1.status).toBe(200);
    expect(r1.body.parkedLabel).toBe("ToResume");
    expect(Array.isArray(r1.body.items)).toBe(true);

    // Row gone
    const rows = await db
      .select({ id: posOrdersTable.id })
      .from(posOrdersTable)
      .where(eq(posOrdersTable.id, id));
    expect(rows).toEqual([]);

    // Second resume must 404
    const r2 = await agentA
      .post(`/api/pos/orders/${id}/resume`)
      .send({ sessionId: sessionAId });
    expect(r2.status).toBe(404);
  });

  it("tenant B cannot resume tenant A's parked order (404 + row untouched)", async () => {
    const created = await agentA
      .post("/api/pos/orders/park")
      .send(parkBody({ sessionId: sessionAId, label: "Locked-A" }));
    const id = created.body.id as number;

    // Tenant B sends its own session in the body; the SQL predicate
    // still filters by tenant + status, so this MUST be a 404.
    const xres = await agentB
      .post(`/api/pos/orders/${id}/resume`)
      .send({ sessionId: sessionBId });
    expect(xres.status).toBe(404);

    const [row] = await db
      .select({ status: posOrdersTable.status })
      .from(posOrdersTable)
      .where(eq(posOrdersTable.id, id));
    expect(row.status).toBe("parked");
  });

  it("rejects resume when sessionId in body does not match the parked row's session", async () => {
    // Seed a second open session in tenant A so we have two valid
    // sessions in the same tenant to cross-check the session scope.
    const [extraSession] = await db
      .insert(posSessionsTable)
      .values({
        sessionNumber: `PARK-EXTRA-${RUN_TAG}`,
        branchId: branchAId,
        cashierName: "A2",
      })
      .returning();

    const created = await agentA
      .post("/api/pos/orders/park")
      .send(parkBody({ sessionId: sessionAId, label: "WrongSession" }));
    const id = created.body.id as number;

    // Same tenant, different session → 404 (session-scoped resume).
    const xres = await agentA
      .post(`/api/pos/orders/${id}/resume`)
      .send({ sessionId: extraSession.id });
    expect(xres.status).toBe(404);

    // Row must still exist as parked.
    const [row] = await db
      .select({ status: posOrdersTable.status })
      .from(posOrdersTable)
      .where(eq(posOrdersTable.id, id));
    expect(row.status).toBe("parked");

    // Correct session resumes successfully.
    const ok = await agentA
      .post(`/api/pos/orders/${id}/resume`)
      .send({ sessionId: sessionAId });
    expect(ok.status).toBe(200);
  });
});

describe("GET /api/pos/summary excludes parked orders", () => {
  it("does not count parked orders in totalSales / ordersCount", async () => {
    // Baseline: read summary BEFORE parking anything fresh today.
    const before = await agentA.get("/api/pos/summary");
    expect(before.status).toBe(200);
    const beforeTotal = Number(before.body.totalSales);
    const beforeCount = Number(before.body.ordersCount);

    // Park a non-trivial-total order — if it leaks into summary, both
    // totalSales and ordersCount will increase by the parked amounts.
    const parked = await agentA
      .post("/api/pos/orders/park")
      .send(parkBody({ sessionId: sessionAId, label: "ShouldNotCount" }));
    expect(parked.status).toBe(201);

    const after = await agentA.get("/api/pos/summary");
    expect(after.status).toBe(200);
    expect(Number(after.body.totalSales)).toBe(beforeTotal);
    expect(Number(after.body.ordersCount)).toBe(beforeCount);
  });
});
