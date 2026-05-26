/**
 * Task #259 — integration tests for Audit Consent + VAT Simulator.
 *
 * Boots the real Express app and exercises:
 *  - POST /api/vat/simulate happy path (range, response shape).
 *  - Consent redaction on /api/customers AND /api/security/audit-logs:
 *    when the company OWNER toggles `auditConsent.customerPii=false`
 *    in `admin_prefs`, a NON-OWNER viewer (accountant) in the same
 *    company immediately sees redacted phone / email on customer
 *    rows AND scrubbed contact data in their teammate's audit-log
 *    rows. Owner-role viewers see raw data.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { and, eq, inArray, like } from "drizzle-orm";
import {
  db,
  companiesTable,
  usersTable,
  userCompaniesTable,
  customersTable,
  auditLogsTable,
} from "@workspace/db";
import app from "../app";

const RUN_TAG = `vitest-consent-${Date.now()}`;
const PASSWORD = "Test1234!";

let companyId = 0;
let ownerId = 0;
let accountantId = 0;
let customerId = 0;
let agentOwner: request.Agent;
let agentAcct: request.Agent;

beforeAll(async () => {
  const [co] = await db
    .insert(companiesTable)
    .values({ name: `Consent Co ${RUN_TAG}`, baseCurrency: "SAR" })
    .returning();
  companyId = co.id;

  const hash = await bcrypt.hash(PASSWORD, 4);
  const [owner] = await db
    .insert(usersTable)
    .values({
      name: `Owner ${RUN_TAG}`,
      email: `consent-owner-${RUN_TAG}@test.local`,
      passwordHash: hash,
      role: "owner",
      isActive: true,
      adminPrefs: { auditConsent: { customerPii: true, salesDetails: true } },
    })
    .returning();
  const [acct] = await db
    .insert(usersTable)
    .values({
      name: `Acct ${RUN_TAG}`,
      // Role "manager" so the same agent passes BOTH the customers
      // read guard AND the auditReadGuard on /security/audit-logs.
      // Manager is still a non-owner, so consent redaction still
      // applies to them (only role==="owner" bypasses).
      email: `consent-acct-${RUN_TAG}@test.local`,
      passwordHash: hash,
      role: "manager",
      isActive: true,
    })
    .returning();
  ownerId = owner.id;
  accountantId = acct.id;

  await db.insert(userCompaniesTable).values([
    { userId: ownerId, companyId, role: "owner", isDefault: true },
    { userId: accountantId, companyId, role: "manager", isDefault: true },
  ]);

  const [cust] = await db
    .insert(customersTable)
    .values({
      name: `Cust ${RUN_TAG}`,
      phone: "+966500000001",
      email: `cust-${RUN_TAG}@test.local`,
      companyId,
    })
    .returning();
  customerId = cust.id;

  agentOwner = request.agent(app);
  agentAcct = request.agent(app);
  await agentOwner
    .post("/api/auth/login")
    .send({ email: owner.email, password: PASSWORD })
    .expect(200);
  await agentAcct
    .post("/api/auth/login")
    .send({ email: acct.email, password: PASSWORD })
    .expect(200);
});

afterAll(async () => {
  await db
    .delete(auditLogsTable)
    .where(eq(auditLogsTable.companyId, companyId));
  await db
    .delete(customersTable)
    .where(eq(customersTable.id, customerId));
  await db
    .delete(userCompaniesTable)
    .where(eq(userCompaniesTable.companyId, companyId));
  await db
    .delete(usersTable)
    .where(inArray(usersTable.id, [ownerId, accountantId]));
  await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
});

describe("POST /api/vat/simulate", () => {
  it("returns a 12-month trajectory with the new aggregate fields", async () => {
    const res = await agentOwner
      .post("/api/vat/simulate")
      .send({
        baselineRolling12mSales: 200_000,
        monthlyGrowthRate: 0.5,
        priceChangePct: 0.1,
        voluntaryRegistrationChoice: true,
        months: 12,
      })
      .expect(200);
    expect(res.body.trajectory).toHaveLength(12);
    const p = res.body.trajectory[0];
    expect(p).toHaveProperty("date");
    expect(p).toHaveProperty("vatCollected");
    expect(p).toHaveProperty("vatPaid");
    expect(res.body).toHaveProperty("netCashRegisterEarly");
    expect(res.body.monthlyGrowthRate).toBe(0.5);
  });

  it("clamps monthlyGrowthRate to the new -0.5..+2 range on the server", async () => {
    const res = await agentOwner
      .post("/api/vat/simulate")
      .send({ baselineRolling12mSales: 1000, monthlyGrowthRate: 5 })
      .expect(400); // schema max:2 rejects 5
    expect(res.body.error).toBeDefined();
  });
});

describe("Consent redaction (data-subject = company owner)", () => {
  async function setOwnerConsent(piiOn: boolean) {
    await db
      .update(usersTable)
      .set({
        adminPrefs: {
          auditConsent: { customerPii: piiOn, salesDetails: true },
        },
      })
      .where(eq(usersTable.id, ownerId));
  }

  it("non-owner sees raw PII when owner consent is ON", async () => {
    await setOwnerConsent(true);
    const res = await agentAcct.get("/api/customers").expect(200);
    const row = res.body.find((c: { id: number }) => c.id === customerId);
    expect(row).toBeDefined();
    expect(row.phone).toBe("+966500000001");
    expect(row.email).toContain(RUN_TAG);
  });

  it("non-owner sees redacted PII immediately after owner toggles consent OFF", async () => {
    await setOwnerConsent(false);
    const res = await agentAcct.get("/api/customers").expect(200);
    const row = res.body.find((c: { id: number }) => c.id === customerId);
    expect(row.phone).toBe("—");
    expect(row.email).toBe("—");
  });

  it("owner viewer always bypasses redaction even when their own consent is OFF", async () => {
    await setOwnerConsent(false);
    const res = await agentOwner.get("/api/customers").expect(200);
    const row = res.body.find((c: { id: number }) => c.id === customerId);
    expect(row.phone).toBe("+966500000001");
  });

  it("customer name is redacted when customerPii=false (non-owner viewer)", async () => {
    await setOwnerConsent(false);
    const res = await agentAcct.get("/api/customers").expect(200);
    const row = res.body.find((c: { id: number }) => c.id === customerId);
    expect(row.name).toBe("—");
  });
});

describe("Audit-logs consent redaction (data-subject = actor)", () => {
  it("redacts subject's email/phone in details + userName when their consent is OFF", async () => {
    // Owner journals a row that contains email + phone in details +
    // the owner's userName. Then we flip owner consent OFF and have
    // the accountant read /security/audit-logs.
    await db
      .update(usersTable)
      .set({
        adminPrefs: {
          auditConsent: {
            customerPii: false,
            salesDetails: true,
            locationContext: true,
          },
        },
      })
      .where(eq(usersTable.id, ownerId));

    const [row] = await db
      .insert(auditLogsTable)
      .values({
        action: "update",
        entity: `customer#${customerId}`,
        userId: ownerId,
        userName: `Owner ${RUN_TAG}`,
        details: `contacted client at owner-pii-${RUN_TAG}@x.test phone +966500000077`,
        companyId,
      })
      .returning();

    const res = await agentAcct
      .get("/api/security/audit-logs?limit=100")
      .expect(200);
    const seen = (res.body as Array<{ id: number; userName: string; details: string | null }>).find(
      (r) => r.id === row.id,
    );
    expect(seen).toBeDefined();
    expect(seen!.userName).toBe("—");
    expect(seen!.details).not.toContain("owner-pii-");
    expect(seen!.details).not.toContain("+966500000077");
    expect(seen!.details).toContain("—");
  });

  it("does NOT redact when subject consent is ON", async () => {
    await db
      .update(usersTable)
      .set({
        adminPrefs: {
          auditConsent: {
            customerPii: true,
            salesDetails: true,
            locationContext: true,
          },
        },
      })
      .where(eq(usersTable.id, ownerId));

    const [row] = await db
      .insert(auditLogsTable)
      .values({
        action: "update",
        entity: `customer#${customerId}`,
        userId: ownerId,
        userName: `Owner ${RUN_TAG}`,
        details: `contacted client at owner-pii-on-${RUN_TAG}@x.test`,
        companyId,
      })
      .returning();

    const res = await agentAcct
      .get("/api/security/audit-logs?limit=100")
      .expect(200);
    const seen = (res.body as Array<{ id: number; userName: string; details: string | null }>).find(
      (r) => r.id === row.id,
    );
    expect(seen!.userName).toContain("Owner");
    expect(seen!.details).toContain("owner-pii-on-");
  });
});
