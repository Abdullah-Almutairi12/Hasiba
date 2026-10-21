import { cleanupCompanyDefaults } from "../test/cleanup-company-defaults";
/**
 * HTTP-level regression tests for per-user alert dismissals.
 *
 * Boots the real Express app and drives `POST /dashboard/alerts/dismiss`
 * + `GET /dashboard/alerts` end-to-end via supertest cookie jars. Pins
 * the multi-tenant boundary introduced when dismissals became per-user
 * and per-tenant:
 *
 *   1. User A dismissing a persisted alert hides it for A only —
 *      user B in the SAME company still sees it.
 *   2. A user in tenant B cannot dismiss tenant A's persisted alert
 *      (the lookup must return 404, never write the row).
 *   3. The synthetic `synthetic:stale_scan` banner, once dismissed,
 *      reappears the next time the staleness condition re-triggers
 *      past the dismissal timestamp (i.e. dismissals don't permanently
 *      silence a recurring banner).
 *
 * Fixtures are tagged with a per-run timestamp and torn down in
 * `afterAll` to keep the shared DB clean. Login is rate-limited
 * (20/15min/IP) — we log in once per user.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { eq, inArray, and } from "drizzle-orm";
import {
  db,
  companiesTable,
  usersTable,
  userCompaniesTable,
  alertsTable,
  alertDismissalsTable,
  auditLogsTable,
  intercompanyLinksTable,
} from "@workspace/db";
import app from "../app";

const RUN_TAG = `vitest-alerts-${Date.now()}`;
const PASSWORD = "Test1234!";
// Mirrors STALE_SCAN_MS in routes/dashboard.ts.
const STALE_SCAN_MS = 26 * 60 * 60 * 1000;

let companyAId = 0;
let companyBId = 0;
let userA1Id = 0;
let userA2Id = 0;
let userBId = 0;
let alertAId = 0;
let interLinkId = 0;

let agentA1: request.Agent;
let agentA2: request.Agent;
let agentB: request.Agent;

beforeAll(async () => {
  // Two tenants — A holds the alert, B is the cross-tenant attacker.
  const [a] = await db
    .insert(companiesTable)
    .values({ name: `Alerts Co A ${RUN_TAG}`, baseCurrency: "SAR" })
    .returning();
  const [b] = await db
    .insert(companiesTable)
    .values({ name: `Alerts Co B ${RUN_TAG}`, baseCurrency: "SAR" })
    .returning();
  companyAId = a.id;
  companyBId = b.id;

  const hash = await bcrypt.hash(PASSWORD, 4);
  // Two finance-role users in company A so we can prove per-user isolation
  // within the same tenant. "manager" is in FINANCE_ROLES so the synthetic
  // stale-scan banner is visible to them.
  const [uA1] = await db
    .insert(usersTable)
    .values({
      name: `User A1 ${RUN_TAG}`,
      email: `user-a1-${RUN_TAG}@test.local`,
      passwordHash: hash,
      role: "manager",
      isActive: true,
    })
    .returning();
  const [uA2] = await db
    .insert(usersTable)
    .values({
      name: `User A2 ${RUN_TAG}`,
      email: `user-a2-${RUN_TAG}@test.local`,
      passwordHash: hash,
      role: "manager",
      isActive: true,
    })
    .returning();
  const [uB] = await db
    .insert(usersTable)
    .values({
      name: `User B ${RUN_TAG}`,
      email: `user-b-${RUN_TAG}@test.local`,
      passwordHash: hash,
      role: "manager",
      isActive: true,
    })
    .returning();
  userA1Id = uA1.id;
  userA2Id = uA2.id;
  userBId = uB.id;

  await db.insert(userCompaniesTable).values([
    { userId: userA1Id, companyId: companyAId, role: "manager", isDefault: true },
    { userId: userA2Id, companyId: companyAId, role: "manager", isDefault: true },
    { userId: userBId, companyId: companyBId, role: "manager", isDefault: true },
  ]);

  // Seed a persisted alert in tenant A. Both A1 and A2 should see it
  // until one of them dismisses it.
  const [al] = await db
    .insert(alertsTable)
    .values({
      type: "warning",
      title: `Alert ${RUN_TAG}`,
      message: `Persisted alert for ${RUN_TAG}`,
      companyId: companyAId,
    })
    .returning();
  alertAId = al.id;

  // Required for the synthetic stale-scan banner to be eligible: the
  // reader only emits it when the tenant participates in at least one
  // intercompany link. Source = A so it's tied to tenant A's feed.
  const [link] = await db
    .insert(intercompanyLinksTable)
    .values({
      kind: "sales_invoice",
      sourceCompanyId: companyAId,
      sourceDocId: Date.now() % 2_000_000_000,
      sourceRef: `STUB-SRC-${RUN_TAG}`,
      targetCompanyId: companyBId,
      targetDocId: (Date.now() % 2_000_000_000) + 1,
      targetRef: `STUB-TGT-${RUN_TAG}`,
      status: "matched",
    })
    .returning();
  interLinkId = link.id;

  agentA1 = request.agent(app);
  agentA2 = request.agent(app);
  agentB = request.agent(app);
  const [l1, l2, l3] = await Promise.all([
    agentA1
      .post("/api/auth/login")
      .send({ email: `user-a1-${RUN_TAG}@test.local`, password: PASSWORD }),
    agentA2
      .post("/api/auth/login")
      .send({ email: `user-a2-${RUN_TAG}@test.local`, password: PASSWORD }),
    agentB
      .post("/api/auth/login")
      .send({ email: `user-b-${RUN_TAG}@test.local`, password: PASSWORD }),
  ]);
  if (l1.status !== 200 || l2.status !== 200 || l3.status !== 200) {
    throw new Error(
      `login failed — A1=${l1.status} A2=${l2.status} B=${l3.status}`,
    );
  }
});

afterAll(async () => {
  const uids = [userA1Id, userA2Id, userBId].filter((n) => n > 0);
  if (uids.length > 0) {
    await db.delete(alertDismissalsTable).where(inArray(alertDismissalsTable.userId, uids));
  }
  if (alertAId) {
    await db.delete(alertsTable).where(eq(alertsTable.id, alertAId));
  }
  if (interLinkId) {
    await db.delete(intercompanyLinksTable).where(eq(intercompanyLinksTable.id, interLinkId));
  }
  const coIds = [companyAId, companyBId].filter((n) => n > 0);
  if (coIds.length > 0) {
    // audit_logs.company_id is NOT NULL with onDelete: "restrict" — we
    // may have inserted synthetic scan_nightly rows for this run, so
    // clear them before dropping the parent companies.
    await db.delete(auditLogsTable).where(inArray(auditLogsTable.companyId, coIds));
  }
  if (uids.length > 0) {
    await db.delete(userCompaniesTable).where(inArray(userCompaniesTable.userId, uids));
    await db.delete(usersTable).where(inArray(usersTable.id, uids));
  }
  if (coIds.length > 0) {
    await cleanupCompanyDefaults(coIds);
    await db.delete(companiesTable).where(inArray(companiesTable.id, coIds));
  }
});

describe("Alert dismissals — per-user isolation within a tenant", () => {
  it("User A1 dismissing alert:<id> hides it for A1 only — A2 still sees it", async () => {
    // Pre-condition: both users see the alert.
    const before1 = await agentA1.get("/api/dashboard/alerts");
    const before2 = await agentA2.get("/api/dashboard/alerts");
    expect(before1.status).toBe(200);
    expect(before2.status).toBe(200);
    const key = `alert:${alertAId}`;
    expect((before1.body as Array<{ key: string }>).map((x) => x.key)).toContain(key);
    expect((before2.body as Array<{ key: string }>).map((x) => x.key)).toContain(key);

    // A1 dismisses.
    const dismiss = await agentA1
      .post("/api/dashboard/alerts/dismiss")
      .send({ key });
    expect(dismiss.status).toBe(200);
    expect(dismiss.body).toEqual({ ok: true });

    // A1 no longer sees it; A2 still does.
    const after1 = await agentA1.get("/api/dashboard/alerts");
    const after2 = await agentA2.get("/api/dashboard/alerts");
    expect(after1.status).toBe(200);
    expect(after2.status).toBe(200);
    expect((after1.body as Array<{ key: string }>).map((x) => x.key)).not.toContain(key);
    expect((after2.body as Array<{ key: string }>).map((x) => x.key)).toContain(key);
  });
});

describe("Alert dismissals — cross-tenant rejection", () => {
  it("Tenant B cannot dismiss tenant A's persisted alert (404, no row written)", async () => {
    const key = `alert:${alertAId}`;
    const res = await agentB
      .post("/api/dashboard/alerts/dismiss")
      .send({ key });
    expect(res.status).toBe(404);

    // No dismissal row should have been written for user B against
    // tenant A's alert key.
    const rows = await db
      .select({ id: alertDismissalsTable.id })
      .from(alertDismissalsTable)
      .where(
        and(
          eq(alertDismissalsTable.userId, userBId),
          eq(alertDismissalsTable.alertKey, key),
        ),
      );
    expect(rows).toEqual([]);
  });
});

describe("Alert dismissals — synthetic stale-scan banner re-emerges after re-trigger", () => {
  it("dismissing the banner, then a re-triggered stale condition, brings it back", async () => {
    const key = "synthetic:stale_scan";

    // With no scan_nightly audit row yet, the banner is eligible
    // (hasLinks + lastScan missing → triggeredAt = epoch 0).
    const initial = await agentA2.get("/api/dashboard/alerts");
    expect(initial.status).toBe(200);
    expect((initial.body as Array<{ key: string }>).map((x) => x.key)).toContain(key);

    // A2 dismisses it — dismissedAt = now.
    const dismiss = await agentA2
      .post("/api/dashboard/alerts/dismiss")
      .send({ key });
    expect(dismiss.status).toBe(200);

    // Right after dismissal it should disappear (triggeredAt = epoch 0
    // is well below dismissedAt = now).
    const hidden = await agentA2.get("/api/dashboard/alerts");
    expect(hidden.status).toBe(200);
    expect((hidden.body as Array<{ key: string }>).map((x) => x.key)).not.toContain(key);

    // Simulate a fresh scan running, then time advancing past the
    // STALE_SCAN_MS window. We insert a scan_nightly row whose
    // createdAt is 27h ago, so the reader computes
    //   triggeredAt = createdAt + 26h = (now - 1h)
    // which is GREATER than dismissedAt (≈now from a moment ago).
    // The regex `group=\[(.*,)?<companyId>(,.*)?\]` in the reader
    // requires the company id to appear inside a comma-separated
    // `group=[...]` token in details.
    const staleAt = new Date(Date.now() - 27 * 60 * 60 * 1000);
    await db.insert(auditLogsTable).values({
      userId: null,
      userName: "system",
      action: "scan_nightly",
      entity: "intercompany_imbalance",
      details: `group=[${companyAId}] result=stale`,
      severity: "warning",
      companyId: companyAId,
      createdAt: staleAt,
    });
    // Drift triggeredAt safely above dismissedAt regardless of clock
    // skew by also nudging the dismissal back in time.
    await db
      .update(alertDismissalsTable)
      .set({ dismissedAt: new Date(staleAt.getTime() + STALE_SCAN_MS - 60 * 1000) })
      .where(
        and(
          eq(alertDismissalsTable.userId, userA2Id),
          eq(alertDismissalsTable.companyId, companyAId),
          eq(alertDismissalsTable.alertKey, key),
        ),
      );

    const reborn = await agentA2.get("/api/dashboard/alerts");
    expect(reborn.status).toBe(200);
    expect((reborn.body as Array<{ key: string }>).map((x) => x.key)).toContain(key);
  });
});
