/**
 * HTTP-level multi-tenant isolation regression tests.
 *
 * Boots the real Express app and exercises the full middleware
 * chain (session → requireAuth → requireCompanyContext → route).
 * Two real users in two real companies log in via supertest cookie
 * jars; we then assert that:
 *   - Tenant A's GET /api/products returns ONLY A's products.
 *   - A forged `companyId` in a POST body cannot plant a product in
 *     the other tenant — the row lands under the session's company.
 *
 * Fixtures are tagged with a per-run timestamp and cleaned up in
 * `afterAll`. Tests bypass the login rate limiter (5/hr/IP) by using
 * a single login per user.
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
  customersTable,
} from "@workspace/db";
import app from "../app";

const RUN_TAG = `vitest-http-${Date.now()}`;
const PASSWORD = "Test1234!";

let companyAId = 0;
let companyBId = 0;
let userAId = 0;
let userBId = 0;
let categoryId = 0;
let productAId = 0;
let productBId = 0;
let customerAId = 0;
let customerBId = 0;

let agentA: request.Agent;
let agentB: request.Agent;

beforeAll(async () => {
  // Two tenants
  const [a] = await db
    .insert(companiesTable)
    .values({ name: `HTTP Co A ${RUN_TAG}`, baseCurrency: "SAR" })
    .returning();
  const [b] = await db
    .insert(companiesTable)
    .values({ name: `HTTP Co B ${RUN_TAG}`, baseCurrency: "SAR" })
    .returning();
  companyAId = a.id;
  companyBId = b.id;

  // One owner-role user per tenant
  const hash = await bcrypt.hash(PASSWORD, 4);
  const [uA] = await db
    .insert(usersTable)
    .values({
      name: `User A ${RUN_TAG}`,
      email: `user-a-${RUN_TAG}@test.local`,
      passwordHash: hash,
      role: "owner",
      isActive: true,
    })
    .returning();
  const [uB] = await db
    .insert(usersTable)
    .values({
      name: `User B ${RUN_TAG}`,
      email: `user-b-${RUN_TAG}@test.local`,
      passwordHash: hash,
      role: "owner",
      isActive: true,
    })
    .returning();
  userAId = uA.id;
  userBId = uB.id;

  // Bind each user to their company (default)
  await db.insert(userCompaniesTable).values([
    { userId: userAId, companyId: companyAId, role: "owner", isDefault: true },
    { userId: userBId, companyId: companyBId, role: "owner", isDefault: true },
  ]);

  // Shared category (not tenant-scoped) for FK on products
  const [cat] = await db
    .insert(categoriesTable)
    .values({ name: `HTTP Cat ${RUN_TAG}`, nameAr: `فئة ${RUN_TAG}` })
    .returning();
  categoryId = cat.id;

  // Seed one product per tenant directly in DB
  const [pA] = await db
    .insert(productsTable)
    .values({
      name: `HTTP Prod A ${RUN_TAG}`,
      nameAr: `منتج A ${RUN_TAG}`,
      sku: `HTTP-SKU-A-${RUN_TAG}`,
      categoryId,
      price: "10.00",
      costPrice: "5.00",
      companyId: companyAId,
    })
    .returning();
  const [pB] = await db
    .insert(productsTable)
    .values({
      name: `HTTP Prod B ${RUN_TAG}`,
      nameAr: `منتج B ${RUN_TAG}`,
      sku: `HTTP-SKU-B-${RUN_TAG}`,
      categoryId,
      price: "20.00",
      costPrice: "10.00",
      companyId: companyBId,
    })
    .returning();
  productAId = pA.id;
  productBId = pB.id;

  // One customer per tenant
  const [cA] = await db
    .insert(customersTable)
    .values({ name: `HTTP Cust A ${RUN_TAG}`, companyId: companyAId })
    .returning();
  const [cB] = await db
    .insert(customersTable)
    .values({ name: `HTTP Cust B ${RUN_TAG}`, companyId: companyBId })
    .returning();
  customerAId = cA.id;
  customerBId = cB.id;

  // Login each via cookie-jar agents
  agentA = request.agent(app);
  agentB = request.agent(app);
  const loginA = await agentA
    .post("/api/auth/login")
    .send({ email: `user-a-${RUN_TAG}@test.local`, password: PASSWORD });
  const loginB = await agentB
    .post("/api/auth/login")
    .send({ email: `user-b-${RUN_TAG}@test.local`, password: PASSWORD });
  if (loginA.status !== 200 || loginB.status !== 200) {
    throw new Error(
      `login failed — A=${loginA.status} body=${JSON.stringify(loginA.body)} ` +
        `B=${loginB.status} body=${JSON.stringify(loginB.body)}`,
    );
  }
});

afterAll(async () => {
  const productIds: number[] = [];
  if (productAId) productIds.push(productAId);
  if (productBId) productIds.push(productBId);
  // Also remove anything created by the forged-payload test
  const extras = await db
    .select({ id: productsTable.id })
    .from(productsTable)
    .where(eq(productsTable.sku, `HTTP-FORGED-${RUN_TAG}`));
  for (const e of extras) productIds.push(e.id);
  if (productIds.length > 0) {
    await db.delete(productsTable).where(inArray(productsTable.id, productIds));
  }
  const custIds = [customerAId, customerBId].filter((n) => n > 0);
  if (custIds.length > 0) {
    await db.delete(customersTable).where(inArray(customersTable.id, custIds));
  }
  if (categoryId) await db.delete(categoriesTable).where(eq(categoriesTable.id, categoryId));
  const uids = [userAId, userBId].filter((n) => n > 0);
  if (uids.length > 0) {
    await db.delete(userCompaniesTable).where(inArray(userCompaniesTable.userId, uids));
    await db.delete(usersTable).where(inArray(usersTable.id, uids));
  }
  const coIds = [companyAId, companyBId].filter((n) => n > 0);
  if (coIds.length > 0) {
    await db.delete(companiesTable).where(inArray(companiesTable.id, coIds));
  }
});

describe("HTTP — GET /api/products is tenant-scoped", () => {
  it("Tenant A sees ONLY their own product, never tenant B's", async () => {
    const res = await agentA.get("/api/products");
    expect(res.status).toBe(200);
    const ids = (res.body as Array<{ id: number }>).map((p) => p.id);
    expect(ids).toContain(productAId);
    expect(ids).not.toContain(productBId);
  });

  it("Tenant B sees ONLY their own product, never tenant A's", async () => {
    const res = await agentB.get("/api/products");
    expect(res.status).toBe(200);
    const ids = (res.body as Array<{ id: number }>).map((p) => p.id);
    expect(ids).toContain(productBId);
    expect(ids).not.toContain(productAId);
  });
});

describe("HTTP — POST /api/products ignores forged companyId in body", () => {
  it("A forged companyId in the request body cannot plant a row in another tenant", async () => {
    const res = await agentA
      .post("/api/products")
      .send({
        name: "Forged",
        nameAr: "مزيف",
        sku: `HTTP-FORGED-${RUN_TAG}`,
        categoryId,
        price: 1,
        costPrice: 1,
        unit: "piece",
        minStock: 0,
        companyId: companyBId, // <- the attack
      });
    // Route may accept or reject the body, but if the row lands it
    // MUST be stamped with the session's company, not the forged one.
    if (res.status === 200 || res.status === 201) {
      const [row] = await db
        .select({ companyId: productsTable.companyId })
        .from(productsTable)
        .where(eq(productsTable.sku, `HTTP-FORGED-${RUN_TAG}`));
      expect(row?.companyId).toBe(companyAId);
      expect(row?.companyId).not.toBe(companyBId);
    } else {
      // 400 from Zod is also acceptable — the schema may reject
      // unknown fields. Either way no row should appear in B.
      const leaked = await db
        .select({ id: productsTable.id })
        .from(productsTable)
        .where(eq(productsTable.sku, `HTTP-FORGED-${RUN_TAG}`));
      for (const r of leaked) {
        const [row] = await db
          .select({ companyId: productsTable.companyId })
          .from(productsTable)
          .where(eq(productsTable.id, r.id));
        expect(row?.companyId).not.toBe(companyBId);
      }
    }
  });
});

describe("HTTP — GET /api/customers is tenant-scoped", () => {
  it("Tenant A sees ONLY their own customer, never tenant B's", async () => {
    const res = await agentA.get("/api/customers");
    expect(res.status).toBe(200);
    const ids = (res.body as Array<{ id: number }>).map((c) => c.id);
    expect(ids).toContain(customerAId);
    expect(ids).not.toContain(customerBId);
  });

  it("Tenant B sees ONLY their own customer, never tenant A's", async () => {
    const res = await agentB.get("/api/customers");
    expect(res.status).toBe(200);
    const ids = (res.body as Array<{ id: number }>).map((c) => c.id);
    expect(ids).toContain(customerBId);
    expect(ids).not.toContain(customerAId);
  });
});

describe("HTTP — GET /api/products/:id cross-tenant access", () => {
  it("Tenant A requesting tenant B's product id is denied (not leaked)", async () => {
    const res = await agentA.get(`/api/products/${productBId}`);
    // Acceptable: 404 (preferred — hides existence) or 403.
    // Critical: must NOT be 200 with B's data.
    expect([403, 404]).toContain(res.status);
    if (res.status === 200) {
      throw new Error("cross-tenant product was leaked through GET /:id");
    }
  });
});
