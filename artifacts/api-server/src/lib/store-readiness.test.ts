import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { and, eq, inArray } from "drizzle-orm";
import {
  db, companiesTable, branchesTable, warehousesTable, usersTable,
  userCompaniesTable, auditLogsTable,
} from "@workspace/db";
import app, { assertApplicationReady } from "../app";

const tag = `store-readiness-${Date.now()}`;
const companies: number[] = [];
const branches: number[] = [];
const users: number[] = [];
const agents: request.Agent[] = [];
const analytics = ["/reports/ai-summary", "/reports/insights", "/reports/fraud-detection"];
const warehouse = (branchId: number) => ({ branchId, name: tag, nameAr: "مستودع اصطناعي" });

beforeAll(async () => {
  await assertApplicationReady();
  const password = "SyntheticStoreTest123!";
  const passwordHash = await bcrypt.hash(password, 4);
  for (let i = 0; i < 2; i++) {
    const [company] = await db.insert(companiesTable).values({ name: `${tag}-${i}` }).returning();
    companies.push(company.id);
    const [branch] = await db.insert(branchesTable).values({
      companyId: company.id, name: `${tag}-${i}`, nameAr: "فرع اصطناعي", city: "مدينة اصطناعية",
    }).returning();
    branches.push(branch.id);
  }
  for (let i = 0; i < 3; i++) {
    const role = i === 2 ? "cashier" as const : "owner" as const;
    const [user] = await db.insert(usersTable).values({
      name: `${tag}-${i}`, email: `${tag}-${i}@test.local`, passwordHash, role, isActive: true,
    }).returning();
    users.push(user.id);
    await db.insert(userCompaniesTable).values({
      userId: user.id, companyId: companies[i === 1 ? 1 : 0], role, isDefault: true,
    });
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ email: user.email, password }).expect(200);
    agents.push(agent);
  }
});

afterAll(async () => {
  await db.delete(warehousesTable).where(inArray(warehousesTable.companyId, companies));
  await db.delete(branchesTable).where(inArray(branchesTable.id, branches));
  await db.delete(auditLogsTable).where(inArray(auditLogsTable.userId, users));
  await db.delete(usersTable).where(inArray(usersTable.id, users));
  await db.delete(companiesTable).where(inArray(companiesTable.id, companies));
});

describe("report authenticity in an empty company", () => {
  it.each(analytics)("never supplies illustrative business facts from %s", async path => {
    for (const agent of agents.slice(0, 2)) {
      const response = await agent.get(`/api${path}`).expect(503);
      expect(response.body.code).toBe("REPORT_ANALYTICS_NOT_READY");
      expect(typeof response.body.error).toBe("string");
      expect(Object.keys(response.body).sort()).toEqual(["code", "error"]);
    }
  });
  it.each(analytics)("keeps authorization ahead of the unavailable response: %s", async path => {
    await request(app).get(`/api${path}`).expect(401);
    await agents[2].get(`/api${path}`).expect(403);
  });
});

describe("native warehouse creation contract", () => {
  it("accepts the generated client body without a client companyId", async () => {
    const response = await agents[0].post("/api/warehouses").send(warehouse(branches[0])).expect(201);
    expect(response.body).toMatchObject({ companyId: companies[0], branchId: branches[0] });
  });
  it("rejects a branch from the other company before inserting", async () => {
    await agents[0].post("/api/warehouses")
      .send({ ...warehouse(branches[1]), companyId: companies[0] }).expect(404);
    const rows = await db.select().from(warehousesTable).where(and(
      eq(warehousesTable.companyId, companies[0]), eq(warehousesTable.branchId, branches[1]),
    ));
    expect(rows).toHaveLength(0);
  });
  it("takes company ownership from the session, not the supplied body", async () => {
    const response = await agents[0].post("/api/warehouses")
      .send({ ...warehouse(branches[0]), companyId: companies[1] }).expect(201);
    expect(response.body.companyId).toBe(companies[0]);
  });
  it("rejects a nonexistent branch", async () => {
    await agents[0].post("/api/warehouses")
      .send({ ...warehouse(2147483647), companyId: companies[0] }).expect(404);
  });
  it("rejects blank warehouse names", async () => {
    await agents[0].post("/api/warehouses").send({
      ...warehouse(branches[0]), companyId: companies[0], name: " ", nameAr: " ",
    }).expect(400);
  });
  it("does not grant warehouse creation to a cashier", async () => {
    await agents[2].post("/api/warehouses").send(warehouse(branches[0])).expect(403);
  });
  it("rechecks a revoked membership even with the original session open", async () => {
    await db.update(userCompaniesTable).set({ role: "cashier" }).where(and(
      eq(userCompaniesTable.userId, users[1]), eq(userCompaniesTable.companyId, companies[1]),
    ));
    try {
      await agents[1].post("/api/warehouses").send(warehouse(branches[1])).expect(403);
    } finally {
      await db.update(userCompaniesTable).set({ role: "owner" }).where(and(
        eq(userCompaniesTable.userId, users[1]), eq(userCompaniesTable.companyId, companies[1]),
      ));
    }
  });
});
