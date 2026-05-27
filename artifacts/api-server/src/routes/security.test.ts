/**
 * Task #262 — Cross-tenant privacy redaction regression tests.
 *
 * Boots the real Express app and exercises GET /api/security/audit-logs
 * with two real companies + users to lock down the worst-class bug in
 * the audit pipeline:
 *
 *   (1) Strict tenant filter — a viewer in company A NEVER sees a row
 *       belonging to company B, even if both companies share the same
 *       actor id heuristics.
 *
 *   (2) Per-actor consent redaction — a non-owner viewer sees
 *       REDACTED money / PII / IP when the row's data subject
 *       (the actor) has opted those fields out via
 *       `users.adminPrefs.auditConsent`, and RAW values when they
 *       have opted in.
 *
 *   (3) Owner bypass — `role === "owner"` viewers always see the
 *       raw row, regardless of the subject's consent.
 *
 * Fixtures are tagged with a per-run timestamp and torn down in
 * `afterAll`. We use a fresh user per role so we can log in as each
 * via supertest cookie-jar agents.
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
  auditLogsTable,
} from "@workspace/db";
import app from "../app";

const RUN_TAG = `vitest-sec-${Date.now()}`;
const PASSWORD = "Test1234!";

let companyAId = 0;
let companyBId = 0;
let ownerAId = 0;
let managerAId = 0;
let ownerBId = 0;
let auditRowAId = 0;
let auditRowAOpenId = 0;
let auditRowBId = 0;
// Task #264 — fixtures for /security/audit-access ("who viewed your data").
let accessRowAToManagerRedactId = 0;
let accessRowAToManagerOpenId = 0;
let accessRowAToOwnerId = 0;
let accessRowARosterReadId = 0;
let accessRowASelfActorId = 0;
let accessRowBToManagerId = 0;

let agentOwnerA: request.Agent;
let agentManagerA: request.Agent;
let agentOwnerB: request.Agent;

beforeAll(async () => {
  // Two real tenants
  const [coA] = await db
    .insert(companiesTable)
    .values({ name: `Sec Co A ${RUN_TAG}`, baseCurrency: "SAR" })
    .returning();
  const [coB] = await db
    .insert(companiesTable)
    .values({ name: `Sec Co B ${RUN_TAG}`, baseCurrency: "SAR" })
    .returning();
  companyAId = coA.id;
  companyBId = coB.id;

  const hash = await bcrypt.hash(PASSWORD, 4);

  // Company A: owner (acts AND will become subject of redacted row)
  // + manager (non-owner viewer, must see redaction).
  const [ownerA] = await db
    .insert(usersTable)
    .values({
      name: `Owner A ${RUN_TAG}`,
      email: `sec-owner-a-${RUN_TAG}@test.local`,
      passwordHash: hash,
      role: "owner",
      isActive: true,
      adminPrefs: {
        auditConsent: {
          customerPii: false,
          salesDetails: false,
          locationContext: false,
        },
      },
    })
    .returning();
  const [managerA] = await db
    .insert(usersTable)
    .values({
      name: `Manager A ${RUN_TAG}`,
      email: `sec-manager-a-${RUN_TAG}@test.local`,
      passwordHash: hash,
      // Manager passes auditReadGuard but is a NON-OWNER viewer, so
      // redaction MUST apply to them.
      role: "manager",
      isActive: true,
    })
    .returning();
  ownerAId = ownerA.id;
  managerAId = managerA.id;

  // Company B: a separate owner with a separate audit trail.
  const [ownerB] = await db
    .insert(usersTable)
    .values({
      name: `Owner B ${RUN_TAG}`,
      email: `sec-owner-b-${RUN_TAG}@test.local`,
      passwordHash: hash,
      role: "owner",
      isActive: true,
    })
    .returning();
  ownerBId = ownerB.id;

  await db.insert(userCompaniesTable).values([
    { userId: ownerAId, companyId: companyAId, role: "owner", isDefault: true },
    { userId: managerAId, companyId: companyAId, role: "manager", isDefault: true },
    { userId: ownerBId, companyId: companyBId, role: "owner", isDefault: true },
  ]);

  // Tenant A audit row #1 — actor=ownerA (consent OFF on all 3 fields).
  // Contains money, email, phone, ip → every field must be redacted
  // for a non-owner viewer in company A.
  const [rowA] = await db
    .insert(auditLogsTable)
    .values({
      action: "update",
      entity: `customer#${ownerAId}`, // subject resolves to ownerA via user#<N> regex
      userId: ownerAId,
      userName: `Owner A ${RUN_TAG}`,
      details:
        `paid 1,250.50 SAR — contact sec-pii-a-${RUN_TAG}@x.test phone +966500000077`,
      ipAddress: "203.0.113.45",
      companyId: companyAId,
    })
    .returning();
  auditRowAId = rowA.id;

  // Tenant A audit row #2 — same actor but we will flip consent ON
  // before exercising it, to assert raw values.
  const [rowAOpen] = await db
    .insert(auditLogsTable)
    .values({
      action: "update",
      entity: `customer#${ownerAId}`,
      userId: ownerAId,
      userName: `Owner A ${RUN_TAG}`,
      details:
        `refunded 99.00 SAR — contact sec-pii-open-${RUN_TAG}@x.test phone +966500000088`,
      ipAddress: "203.0.113.99",
      companyId: companyAId,
    })
    .returning();
  auditRowAOpenId = rowAOpen.id;

  // Tenant B audit row — must NEVER appear in any A-side response.
  // Uses a uniquely-tagged details string we can grep for in the body.
  const [rowB] = await db
    .insert(auditLogsTable)
    .values({
      action: "create",
      entity: "invoice#999",
      userId: ownerBId,
      userName: `Owner B ${RUN_TAG}`,
      details: `B-SECRET-${RUN_TAG} cross-tenant tracer 9,999.00 SAR`,
      ipAddress: "198.51.100.7",
      companyId: companyBId,
    })
    .returning();
  auditRowBId = rowB.id;

  // ============================================================
  // Task #264 — /security/audit-access fixtures.
  //
  // Endpoint contract (see routes/security.ts):
  //   * Only rows where the actor is NOT the viewer (`ne(userId,
  //     viewerId)`) and the row's subject is the viewer.
  //   * Subject linkage tier 1 (everyone): entity LIKE `user#<viewerId>%`.
  //   * Subject linkage tier 2 (owner only): action = `read`
  //     (roster-wide read events on tenant-owned data).
  //   * Strict tenant filter on companyId.
  //   * Non-owner viewers get per-actor consent redaction; owners
  //     bypass redaction.
  // ============================================================

  // Row #1: ownerA viewed manager's user record. Subject = manager,
  // actor = ownerA. managerA should see this; we'll assert redaction
  // by toggling MANAGER's own auditConsent (subject == manager).
  const [accessRowAToManagerRedact] = await db
    .insert(auditLogsTable)
    .values({
      action: "read",
      entity: `user#${managerAId}`,
      userId: ownerAId,
      userName: `Owner A ${RUN_TAG}`,
      details:
        `viewed profile — bonus 3,750.25 SAR — contact sec-axs-redact-${RUN_TAG}@x.test phone +966500000111`,
      ipAddress: "203.0.113.10",
      companyId: companyAId,
    })
    .returning();
  accessRowAToManagerRedactId = accessRowAToManagerRedact.id;

  // Row #2: same shape as #1 but with a distinct details payload, used
  // to assert raw values once we flip manager's consent ON.
  const [accessRowAToManagerOpen] = await db
    .insert(auditLogsTable)
    .values({
      action: "update",
      entity: `user#${managerAId}`,
      userId: ownerAId,
      userName: `Owner A ${RUN_TAG}`,
      details:
        `adjusted limit — 480.00 SAR — contact sec-axs-open-${RUN_TAG}@x.test phone +966500000222`,
      ipAddress: "203.0.113.20",
      companyId: companyAId,
    })
    .returning();
  accessRowAToManagerOpenId = accessRowAToManagerOpen.id;

  // Row #3: managerA viewed owner's user record. Subject = ownerA,
  // actor = manager. ownerA must see it; managerA must NOT (it
  // targets a teammate, not them) — this is the core leak guard.
  const [accessRowAToOwner] = await db
    .insert(auditLogsTable)
    .values({
      action: "read",
      entity: `user#${ownerAId}`,
      userId: managerAId,
      userName: `Manager A ${RUN_TAG}`,
      details: `A-TEAMMATE-${RUN_TAG} viewed owner profile`,
      ipAddress: "203.0.113.30",
      companyId: companyAId,
    })
    .returning();
  accessRowAToOwnerId = accessRowAToOwner.id;

  // Row #4: roster-wide read by manager. Owner viewer (tier-2 rule)
  // sees this; non-owner viewers must NOT.
  const [accessRowARosterRead] = await db
    .insert(auditLogsTable)
    .values({
      action: "read",
      entity: "customer#listing",
      userId: managerAId,
      userName: `Manager A ${RUN_TAG}`,
      details: `A-ROSTER-${RUN_TAG} customer list scan`,
      ipAddress: "203.0.113.40",
      companyId: companyAId,
    })
    .returning();
  accessRowARosterReadId = accessRowARosterRead.id;

  // Row #5: self-authored — viewer is both actor and subject. The
  // endpoint's `ne(userId, viewerId)` filter must drop it.
  const [accessRowASelfActor] = await db
    .insert(auditLogsTable)
    .values({
      action: "read",
      entity: `user#${managerAId}`,
      userId: managerAId,
      userName: `Manager A ${RUN_TAG}`,
      details: `A-SELFACT-${RUN_TAG} self viewed own profile`,
      ipAddress: "203.0.113.50",
      companyId: companyAId,
    })
    .returning();
  accessRowASelfActorId = accessRowASelfActor.id;

  // Row #6: cross-tenant tracer — tenant B row whose entity targets
  // managerA's user id. Must NEVER appear in any A-side response.
  const [accessRowBToManager] = await db
    .insert(auditLogsTable)
    .values({
      action: "read",
      entity: `user#${managerAId}`,
      userId: ownerBId,
      userName: `Owner B ${RUN_TAG}`,
      details: `B-AXS-SECRET-${RUN_TAG} cross-tenant access tracer`,
      ipAddress: "198.51.100.77",
      companyId: companyBId,
    })
    .returning();
  accessRowBToManagerId = accessRowBToManager.id;

  agentOwnerA = request.agent(app);
  agentManagerA = request.agent(app);
  agentOwnerB = request.agent(app);
  const loginOA = await agentOwnerA
    .post("/api/auth/login")
    .send({ email: ownerA.email, password: PASSWORD });
  const loginMA = await agentManagerA
    .post("/api/auth/login")
    .send({ email: managerA.email, password: PASSWORD });
  const loginOB = await agentOwnerB
    .post("/api/auth/login")
    .send({ email: ownerB.email, password: PASSWORD });
  if (loginOA.status !== 200 || loginMA.status !== 200 || loginOB.status !== 200) {
    throw new Error(
      `login failed — OA=${loginOA.status} MA=${loginMA.status} OB=${loginOB.status}`,
    );
  }
});

afterAll(async () => {
  const ids = [
    auditRowAId,
    auditRowAOpenId,
    auditRowBId,
    accessRowAToManagerRedactId,
    accessRowAToManagerOpenId,
    accessRowAToOwnerId,
    accessRowARosterReadId,
    accessRowASelfActorId,
    accessRowBToManagerId,
  ].filter((n) => n > 0);
  if (ids.length > 0) {
    await db.delete(auditLogsTable).where(inArray(auditLogsTable.id, ids));
  }
  const coIds = [companyAId, companyBId].filter((n) => n > 0);
  if (coIds.length > 0) {
    // Sweep any session/login audit rows the test created in either tenant.
    await db
      .delete(auditLogsTable)
      .where(inArray(auditLogsTable.companyId, coIds));
  }
  const uids = [ownerAId, managerAId, ownerBId].filter((n) => n > 0);
  if (uids.length > 0) {
    await db
      .delete(userCompaniesTable)
      .where(inArray(userCompaniesTable.userId, uids));
    await db.delete(usersTable).where(inArray(usersTable.id, uids));
  }
  if (coIds.length > 0) {
    await db.delete(companiesTable).where(inArray(companiesTable.id, coIds));
  }
});

async function setOwnerAConsent(opts: {
  customerPii: boolean;
  salesDetails: boolean;
  locationContext: boolean;
}) {
  await db
    .update(usersTable)
    .set({ adminPrefs: { auditConsent: opts } })
    .where(eq(usersTable.id, ownerAId));
}

async function setManagerAConsent(opts: {
  customerPii: boolean;
  salesDetails: boolean;
  locationContext: boolean;
}) {
  await db
    .update(usersTable)
    .set({ adminPrefs: { auditConsent: opts } })
    .where(eq(usersTable.id, managerAId));
}

describe("GET /api/security/audit-logs — cross-tenant isolation (Task #262)", () => {
  it("a viewer in tenant A NEVER sees tenant B's audit rows", async () => {
    const res = await agentManagerA
      .get("/api/security/audit-logs?limit=100")
      .expect(200);
    const rows = res.body as Array<{
      id: number;
      companyId: number;
      details: string | null;
    }>;
    // No row from B's id space, no row carrying B's companyId, and
    // the unique tracer string from B must not appear anywhere.
    expect(rows.find((r) => r.id === auditRowBId)).toBeUndefined();
    for (const r of rows) {
      expect(r.companyId).toBe(companyAId);
      expect(r.companyId).not.toBe(companyBId);
    }
    const blob = JSON.stringify(res.body);
    expect(blob).not.toContain(`B-SECRET-${RUN_TAG}`);
  });

  it("an OWNER viewer in tenant A also NEVER sees tenant B's rows (owner bypass is for redaction, not tenancy)", async () => {
    const res = await agentOwnerA
      .get("/api/security/audit-logs?limit=100")
      .expect(200);
    const rows = res.body as Array<{ id: number; companyId: number }>;
    expect(rows.find((r) => r.id === auditRowBId)).toBeUndefined();
    for (const r of rows) expect(r.companyId).toBe(companyAId);
    expect(JSON.stringify(res.body)).not.toContain(`B-SECRET-${RUN_TAG}`);
  });

  it("the tenant B owner sees their own row but NEVER tenant A's rows", async () => {
    const res = await agentOwnerB
      .get("/api/security/audit-logs?limit=100")
      .expect(200);
    const rows = res.body as Array<{ id: number; companyId: number }>;
    expect(rows.find((r) => r.id === auditRowBId)).toBeDefined();
    expect(rows.find((r) => r.id === auditRowAId)).toBeUndefined();
    expect(rows.find((r) => r.id === auditRowAOpenId)).toBeUndefined();
    for (const r of rows) expect(r.companyId).toBe(companyBId);
  });
});

describe("GET /api/security/audit-logs — per-actor consent redaction", () => {
  it("non-owner sees REDACTED money / PII / IP when the actor opted out", async () => {
    await setOwnerAConsent({
      customerPii: false,
      salesDetails: false,
      locationContext: false,
    });
    const res = await agentManagerA
      .get("/api/security/audit-logs?limit=100")
      .expect(200);
    const seen = (res.body as Array<{
      id: number;
      userName: string;
      details: string | null;
      ipAddress: string | null;
    }>).find((r) => r.id === auditRowAId);
    expect(seen).toBeDefined();
    // userName is treated as PII and replaced with "—".
    expect(seen!.userName).toBe("—");
    // Money amount scrubbed (the regex strips the numeric portion;
    // a bare currency tag without digits is not itself the sensitive value).
    expect(seen!.details).not.toContain("1,250.50");
    expect(seen!.details).not.toContain("1250.50");
    // Email + phone scrubbed.
    expect(seen!.details).not.toContain(`sec-pii-a-${RUN_TAG}`);
    expect(seen!.details).not.toContain("+966500000077");
    expect(seen!.details).toContain("—");
    // IP nulled out, not just emptied.
    expect(seen!.ipAddress).toBeNull();
  });

  it("non-owner sees RAW money / PII / IP when the actor opted in", async () => {
    await setOwnerAConsent({
      customerPii: true,
      salesDetails: true,
      locationContext: true,
    });
    const res = await agentManagerA
      .get("/api/security/audit-logs?limit=100")
      .expect(200);
    const seen = (res.body as Array<{
      id: number;
      userName: string;
      details: string | null;
      ipAddress: string | null;
    }>).find((r) => r.id === auditRowAOpenId);
    expect(seen).toBeDefined();
    expect(seen!.userName).toContain("Owner A");
    expect(seen!.details).toContain("99.00 SAR");
    expect(seen!.details).toContain(`sec-pii-open-${RUN_TAG}`);
    expect(seen!.details).toContain("+966500000088");
    expect(seen!.ipAddress).toBe("203.0.113.99");
  });
});

describe("GET /api/security/audit-logs — owner role bypasses redaction entirely", () => {
  it("owner viewer sees RAW values even when the subject's consent is fully OFF", async () => {
    await setOwnerAConsent({
      customerPii: false,
      salesDetails: false,
      locationContext: false,
    });
    const res = await agentOwnerA
      .get("/api/security/audit-logs?limit=100")
      .expect(200);
    const seen = (res.body as Array<{
      id: number;
      userName: string;
      details: string | null;
      ipAddress: string | null;
    }>).find((r) => r.id === auditRowAId);
    expect(seen).toBeDefined();
    // Owner bypass: NO redaction applied.
    expect(seen!.userName).toContain("Owner A");
    expect(seen!.details).toContain("1,250.50");
    expect(seen!.details).toContain("SAR");
    expect(seen!.details).toContain(`sec-pii-a-${RUN_TAG}`);
    expect(seen!.details).toContain("+966500000077");
    expect(seen!.ipAddress).toBe("203.0.113.45");
  });
});

// ============================================================================
// Task #264 — GET /api/security/audit-access ("who viewed your data").
// Mirrors the audit-logs coverage (tenancy + subject scoping + per-actor
// consent redaction) to lock down the worst-class bug for this sibling
// endpoint: leaking teammate activity into another user's privacy panel.
// ============================================================================

describe("GET /api/security/audit-access — cross-tenant isolation (Task #264)", () => {
  it("a viewer in tenant A NEVER sees a tenant B row that targets their user id", async () => {
    const res = await agentManagerA
      .get("/api/security/audit-access")
      .expect(200);
    const rows = res.body as Array<{
      id: number;
      companyId: number;
      details: string | null;
    }>;
    expect(rows.find((r) => r.id === accessRowBToManagerId)).toBeUndefined();
    for (const r of rows) {
      expect(r.companyId).toBe(companyAId);
      expect(r.companyId).not.toBe(companyBId);
    }
    expect(JSON.stringify(res.body)).not.toContain(`B-AXS-SECRET-${RUN_TAG}`);
  });

  it("an OWNER viewer in tenant A also NEVER sees tenant B's rows", async () => {
    const res = await agentOwnerA
      .get("/api/security/audit-access")
      .expect(200);
    const rows = res.body as Array<{ id: number; companyId: number }>;
    expect(rows.find((r) => r.id === accessRowBToManagerId)).toBeUndefined();
    for (const r of rows) expect(r.companyId).toBe(companyAId);
    expect(JSON.stringify(res.body)).not.toContain(`B-AXS-SECRET-${RUN_TAG}`);
  });

  it("the tenant B owner NEVER sees tenant A's audit-access rows", async () => {
    const res = await agentOwnerB
      .get("/api/security/audit-access")
      .expect(200);
    const rows = res.body as Array<{ id: number; companyId: number }>;
    expect(rows.find((r) => r.id === accessRowAToManagerRedactId)).toBeUndefined();
    expect(rows.find((r) => r.id === accessRowAToOwnerId)).toBeUndefined();
    expect(rows.find((r) => r.id === accessRowARosterReadId)).toBeUndefined();
    for (const r of rows) expect(r.companyId).toBe(companyBId);
  });
});

describe("GET /api/security/audit-access — subject scoping (Task #264)", () => {
  it("a non-owner viewer sees rows targeting their own user#<id>, never a teammate's", async () => {
    const res = await agentManagerA
      .get("/api/security/audit-access")
      .expect(200);
    const rows = res.body as Array<{ id: number; details: string | null }>;
    // Self-targeted row authored by ownerA shows up.
    expect(rows.find((r) => r.id === accessRowAToManagerRedactId)).toBeDefined();
    // Teammate-targeted row (entity = user#<ownerAId>) MUST NOT appear,
    // even though it's in the same tenant.
    expect(rows.find((r) => r.id === accessRowAToOwnerId)).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain(`A-TEAMMATE-${RUN_TAG}`);
  });

  it("a non-owner viewer NEVER sees roster-wide read events (owner-only tier-2)", async () => {
    const res = await agentManagerA
      .get("/api/security/audit-access")
      .expect(200);
    const rows = res.body as Array<{ id: number }>;
    expect(rows.find((r) => r.id === accessRowARosterReadId)).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain(`A-ROSTER-${RUN_TAG}`);
  });

  it("an OWNER viewer additionally sees roster-wide read events (tier-2 rule), still tenant-scoped", async () => {
    const res = await agentOwnerA
      .get("/api/security/audit-access")
      .expect(200);
    const rows = res.body as Array<{ id: number; companyId: number }>;
    // Tier 1 — entity = user#<ownerAId> authored by manager.
    expect(rows.find((r) => r.id === accessRowAToOwnerId)).toBeDefined();
    // Tier 2 — roster-wide read authored by manager.
    expect(rows.find((r) => r.id === accessRowARosterReadId)).toBeDefined();
    // Still tenant-scoped.
    for (const r of rows) expect(r.companyId).toBe(companyAId);
  });

  it("self-authored rows are excluded (actor must NOT equal viewer)", async () => {
    const res = await agentManagerA
      .get("/api/security/audit-access")
      .expect(200);
    const rows = res.body as Array<{ id: number }>;
    expect(rows.find((r) => r.id === accessRowASelfActorId)).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain(`A-SELFACT-${RUN_TAG}`);
  });
});

describe("GET /api/security/audit-access — per-actor consent redaction (Task #264)", () => {
  it("non-owner sees REDACTED money / PII / IP when the subject opted out", async () => {
    await setManagerAConsent({
      customerPii: false,
      salesDetails: false,
      locationContext: false,
    });
    const res = await agentManagerA
      .get("/api/security/audit-access")
      .expect(200);
    const seen = (res.body as Array<{
      id: number;
      userName: string;
      details: string | null;
      ipAddress: string | null;
    }>).find((r) => r.id === accessRowAToManagerRedactId);
    expect(seen).toBeDefined();
    // userName (the actor's name) is PII and is replaced with "—".
    expect(seen!.userName).toBe("—");
    // Money scrubbed.
    expect(seen!.details).not.toContain("3,750.25");
    expect(seen!.details).not.toContain("3750.25");
    // Email + phone scrubbed.
    expect(seen!.details).not.toContain(`sec-axs-redact-${RUN_TAG}`);
    expect(seen!.details).not.toContain("+966500000111");
    expect(seen!.details).toContain("—");
    // IP nulled out.
    expect(seen!.ipAddress).toBeNull();
  });

  it("non-owner sees RAW money / PII / IP when the subject opted in", async () => {
    await setManagerAConsent({
      customerPii: true,
      salesDetails: true,
      locationContext: true,
    });
    const res = await agentManagerA
      .get("/api/security/audit-access")
      .expect(200);
    const seen = (res.body as Array<{
      id: number;
      userName: string;
      details: string | null;
      ipAddress: string | null;
    }>).find((r) => r.id === accessRowAToManagerOpenId);
    expect(seen).toBeDefined();
    expect(seen!.userName).toContain("Owner A");
    expect(seen!.details).toContain("480.00 SAR");
    expect(seen!.details).toContain(`sec-axs-open-${RUN_TAG}`);
    expect(seen!.details).toContain("+966500000222");
    expect(seen!.ipAddress).toBe("203.0.113.20");
  });
});
