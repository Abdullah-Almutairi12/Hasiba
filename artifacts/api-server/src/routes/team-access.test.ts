import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { db, pool, companiesTable, usersTable, userCompaniesTable, branchesTable, warehousesTable,
  categoriesTable, productsTable, fiscalYearsTable, fiscalPeriodsTable } from "@workspace/db";
import app, { assertApplicationReady } from "../app";
import { recordStockMove } from "../lib/stock-engine";
import { type TeamPerson, TeamPersonInput } from "../lib/team-catalog";
import { hashAccountPassword, verifyAccountPassword } from "../lib/account-password";
import { sql } from "drizzle-orm";
import { currentResponsibilities } from "../lib/responsibility-context";

const tag = `team-${randomUUID()}`;
const password = "Synthetic team access phrase 2026!";
let owner: request.Agent, outsider: request.Agent, member: request.Agent;
let companyId: number, otherCompanyId: number, ownerId: number;
let riyadh: number, jeddah: number, rWh: number, jWh: number, productId: number;
let person: Record<string, any>, grants: Record<string, any>[], input: TeamPerson, sessionId: number;
const rows = async (q: string, p: unknown[] = []) => (await pool.query(q, p)).rows;
const ok = (response: request.Response, status = 200) => {
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  return response.body;
};
const personInput = (overrides: Partial<TeamPerson> = {}): TeamPerson => ({
  creationKey: randomUUID(), name: "شخص تجريبي", email: null, loginKinds: [], grants: [], deniedActions: [], ...overrides,
});
const stockGrant = () => ({ resource: "inventory" as const, branchId: riyadh, warehouseIds: [rWh],
  actions: ["inventory.read"], amountLimit: null, startsAt: null, endsAt: null });
const saleGrant = () => ({ resource: "pos" as const, branchId: jeddah, warehouseIds: [jWh],
  actions: ["pos.read","pos.sell","pos.shift.open"], amountLimit: "15.00", startsAt: null, endsAt: null });
const scoped = (method: "get" | "post", path: string, grantId: number) =>
  member[method](`/api${path}`).set("X-Workspace-Responsibility", String(grantId));
const totals = () => rows(`SELECT (SELECT count(*)::int FROM pos_orders o JOIN pos_sessions s ON s.id=o.session_id
  JOIN branches b ON b.id=s.branch_id WHERE b.company_id=$1) AS orders,
  (SELECT count(*)::int FROM customer_invoices WHERE company_id=$1) AS invoices,
  (SELECT count(*)::int FROM journal_entries WHERE company_id=$1) AS journals,
  (SELECT count(*)::int FROM stock_moves WHERE product_id=$2) AS moves`, [companyId, productId]);
beforeAll(async () => {
  await assertApplicationReady();
  const companies = await db.insert(companiesTable).values([{ name: tag, vatRegistrationStatus: "not_registered" },
    { name: `${tag}-other`, vatRegistrationStatus: "not_registered" }]).returning();
  [companyId, otherCompanyId] = companies.map(c => c.id);
  const hash = await bcrypt.hash(password, 4);
  const accounts = await db.insert(usersTable).values(["owner","other"].map(n => ({
    name: n, email: `${tag}-${n}@example.invalid`, passwordHash: hash, role: "owner", isActive: true,
  }))).returning();
  ownerId = accounts[0].id;
  await db.insert(userCompaniesTable).values(accounts.map((u, i) => ({ userId: u.id, companyId: companies[i].id, role: "owner", isDefault: true })));
  [owner, outsider] = [request.agent(app), request.agent(app)];
  ok(await owner.post("/api/auth/login").send({ email: accounts[0].email, password }));
  ok(await outsider.post("/api/auth/login").send({ email: accounts[1].email, password }));
  const branches = await db.insert(branchesTable).values(["الرياض","جدة"].map(name => ({ companyId, name, nameAr: name, city: name }))).returning();
  [riyadh, jeddah] = branches.map(b => b.id);
  const warehouses = await db.insert(warehousesTable).values(branches.map(b => ({
    companyId, branchId: b.id, name: b.name, nameAr: b.nameAr, isDefault: true,
  }))).returning();
  [rWh, jWh] = warehouses.map(w => w.id);
  const [category] = await db.insert(categoriesTable).values({ name: tag, nameAr: tag }).returning();
  const [product] = await db.insert(productsTable).values({ companyId, name: tag, nameAr: "منتج نطاق تجريبي",
    sku: tag, categoryId: category.id, price: "10", costPrice: "2", stock: "0", minStock: 0, unit: "pcs" }).returning();
  productId = product.id;
  const year = new Date().getUTCFullYear();
  const [fiscal] = await db.insert(fiscalYearsTable).values({ companyId, name: tag,
    startDate: `${year}-01-01`, endDate: `${year}-12-31` }).returning();
  await db.insert(fiscalPeriodsTable).values({ fiscalYearId: fiscal.id, name: tag,
    startDate: `${year}-01-01`, endDate: `${year}-12-31`, status: "open" });
  await db.transaction(async tx => {
    for (const [warehouseId, quantity, unitCost] of [[rWh, 9, 2],[jWh, 7, 3]]) {
      await recordStockMove(tx, { companyId, productId, quantity, unitCost, kind: "receipt",
        toWarehouseId: warehouseId, sourceType: "synthetic_team_opening", sourceRef: tag, createdBy: ownerId });
    }
  });
});
describe("resumable people and paired responsibility access", () => {
  it("resumes solo/team drafts with optimistic concurrency and rejects secret fields", async () => {
    const before = ok(await owner.get("/api/team/setup"));
    const body = { expectedRevision: before.revision, mode: "solo", step: "people", draft: { person: { name: "لم يكتمل" } } };
    const saved = ok(await owner.put("/api/team/setup").send(body));
    expect(saved.revision).toBe(before.revision + 1);
    expect(ok(await owner.get("/api/team/setup")).draft.person.name).toBe("لم يكتمل");
    ok(await owner.put("/api/team/setup").send(body), 409);
    ok(await owner.put("/api/team/setup").send({ ...body, expectedRevision: saved.revision, draft: { password: "must-not-store" } }), 400);
    expect(ok(await owner.get("/api/team/setup")).draft).not.toHaveProperty("password");
  });
  it("creates one HR person without employment facts, password, membership or extra seat even on retry", async () => {
    const before = ok(await owner.get("/api/team/setup")).policy;
    const body = personInput();
    const created = ok(await owner.post("/api/team/people").send(body), 201);
    expect(ok(await owner.post("/api/team/people").send(body), 201).personId).toBe(created.personId);
    expect(created.status).toBe("record");
    expect(created.userId).toBeNull();
    const [employee] = await rows("SELECT hire_date,record_kind,bank_iban,user_id,nationality FROM employees WHERE id=$1", [created.personId]);
    expect(employee).toEqual({ hire_date: null, record_kind: "person", bank_iban: null, user_id: null, nationality: "" });
    const after = ok(await owner.get("/api/team/setup")).policy;
    expect(after.activeLoginSeats).toBe(before.activeLoginSeats);
    expect(after.reservedAccessSlots).toBe(before.reservedAccessSlots);
    ok(await owner.post("/api/team/people").send({ ...body, name: "محاولة مختلفة" }), 409);
  });
  it("keeps email-less POS pending secure device activation and never fabricates an email", async () => {
    const created = ok(await owner.post("/api/team/people").send(personInput({ loginKinds: ["pos"], grants: [saleGrant()] })), 201);
    expect(created.status).toBe("device_setup_required");
    expect(created.email).toBeNull();
    expect(created.userId).toBeNull();
    ok(await owner.post(`/api/team/people/${created.personId}/invite`).send({ expectedRevision: created.revision }), 409);
  });
  it("previews distinct scopes without granting a Cartesian product or writing", async () => {
    input = personInput({ name: "مخزون الرياض وكاشير جدة", email: `${tag}-member@example.invalid`,
      loginKinds: ["platform","pos"], grants: [stockGrant(), saleGrant()] });
    const before = await totals();
    const preview = ok(await owner.post("/api/team/people/preview").send(input));
    expect(preview.grants[0].branchId).toBe(riyadh);
    expect(preview.grants[0].actions).toEqual(["inventory.read"]);
    expect(preview.grants[1].branchId).toBe(jeddah);
    expect(preview.grants[1].actions).not.toContain("inventory.read");
    expect(await totals()).toEqual(before);
    person = ok(await owner.post("/api/team/people").send(input), 201);
  });
  it.each(["finance.read","inventory.write","pos.refund","team.manage"])("rejects unsupported grant %s through API", async action => {
    ok(await owner.post("/api/team/people/preview").send(personInput({ email: `${randomUUID()}@example.invalid`,
      loginKinds: ["platform"], grants: [{ ...stockGrant(), actions: [action] }] })), 400);
  });
  it("rejects cross-branch warehouse, foreign company person, and manager-style self promotion", async () => {
    ok(await owner.post("/api/team/people/preview").send({ ...input, grants: [{ ...stockGrant(), warehouseIds: [jWh] }] }), 403);
    ok(await outsider.put(`/api/team/people/${person.personId}/access`).send({ expectedRevision: person.revision, person: input, suspended: true }), 404);
    const forged = { ...input, grants: [{ ...stockGrant(), role: "owner" }] };
    ok(await owner.post("/api/team/people/preview").send(forged), 400);
  });
  it("activates once, cannot replay invitation, and uses full-password login", async () => {
    const invitation = ok(await owner.post(`/api/team/people/${person.personId}/invite`).send({ expectedRevision: person.revision }), 201);
    const token = invitation.activationToken;
    expect(invitation.deliveryMode).toBe("manual-development");
    const before = ok(await owner.get("/api/team/people"));
    expect(JSON.stringify(before)).not.toContain(token);
    ok(await request(app).post("/api/auth/team-activation/inspect").send({ token }));
    ok(await request(app).post("/api/auth/team-activation/accept").send({ token, password: "123456" }), 400);
    ok(await request(app).post("/api/auth/team-activation/accept").send({ token, password }));
    ok(await request(app).post("/api/auth/team-activation/accept").send({ token, password }), 409);
    member = request.agent(app);
    const logged = ok(await member.post("/api/auth/login").send({ email: input.email, password }));
    expect(logged.user?.role ?? logged.role).toBe("scoped");
    person = ok(await owner.get("/api/team/people")).find((p: any) => p.personId === person.personId);
    grants = ok(await member.get("/api/workspace/access")).grants;
    expect(grants).toHaveLength(2);
  });
  it("reads only Riyadh inventory without cost; POS grant cannot read inventory, and catalog stock isn't company total", async () => {
    const inventory = ok(await scoped("get", "/workspace/inventory", grants[0].id));
    expect(inventory).toEqual([expect.objectContaining({ warehouseId: rWh, quantity: "9.0000", cost: null })]);
    ok(await scoped("get", "/workspace/inventory", grants[1].id), 403);
    const catalog = ok(await scoped("get", "/products", grants[1].id));
    expect(catalog[0].stock).toBe(7);
    expect(catalog[0]).not.toHaveProperty("costPrice");
    expect(ok(await scoped("get", "/products/categories", grants[1].id))).toHaveLength(1);
  });
  it.each(["/accounting/accounts","/reports","/exports/products","/ai/assistant","/users","/team/catalog",
    "/inventory/quants","/sales/sellers/report","/procurement/purchase-orders"])("full module entitlement never grants %s", async path => {
    expect((await scoped("get", path, grants[0].id)).status).toBe(403);
  });
  it("cannot forge another branch or replace inventory responsibility with a cashier role", async () => {
    const body = { branchId: riyadh, cashierName: "غير موثوق", openingCash: 0 };
    ok(await scoped("post", "/pos/sessions", grants[0].id).send(body), 403);
    const denied = await scoped("post", "/pos/sessions", grants[1].id).send(body);
    expect([403,404]).toContain(denied.status);
    sessionId = ok(await scoped("post", "/pos/sessions", grants[1].id).send({
      ...body, branchId: jeddah, cashierName: input.name }), 201).id;
  });
  it("sells in Jeddah once with a stable receipt, rejects excess/discount/wrong responsibility without effects", async () => {
    const body = { sessionId, items: [{ productId, quantity: 1 }], paymentMethod: "cash", discount: 0 };
    const before = await totals();
    ok(await scoped("post", "/pos/orders", grants[0].id).set("Idempotency-Key", randomUUID()).send(body), 403);
    ok(await scoped("post", "/pos/orders", grants[1].id).set("Idempotency-Key", randomUUID()).send({ ...body, discount: 1 }), 403);
    ok(await scoped("post", "/pos/orders", grants[1].id).set("Idempotency-Key", randomUUID()).send({ ...body, items: [{ productId, quantity: 2 }] }), 403);
    expect(await totals()).toEqual(before);
    const key = randomUUID();
    const sold = ok(await scoped("post", "/pos/orders", grants[1].id).set("Idempotency-Key", key).send(body), 201);
    expect(sold.total).toBe(10);
    const replay = await scoped("post", "/pos/orders", grants[1].id).set("Idempotency-Key", key).send(body);
    expect(ok(replay, 201).id).toBe(sold.id);
    expect(replay.headers["idempotency-replayed"]).toBe("true");
    const [after] = await totals();
    expect(after.orders).toBe(before[0].orders + 1);
    expect(after.invoices).toBe(before[0].invoices + 1);
    const evidence = await rows("SELECT details FROM audit_logs WHERE company_id=$1 AND action='pos.responsibility.used'", [companyId]);
    expect(evidence).toHaveLength(1);
    expect(JSON.parse(evidence[0].details)).toMatchObject({ orderId: sold.id,
      responsibility: { id: grants[1].id, branch_id: jeddah, warehouse_ids: [jWh] } });
  });
  it("changes access in open sessions, preserves old grants and audit, and enforces explicit denial", async () => {
    const changed = { ...input, deniedActions: ["pos.sell"], grants: [{ ...stockGrant(), actions: ["inventory.read","inventory.cost.read"] }, saleGrant()] };
    person = ok(await owner.put(`/api/team/people/${person.personId}/access`).send({
      expectedRevision: person.revision, person: changed, suspended: false }));
    ok(await scoped("get", "/workspace/inventory", grants[0].id), 403);
    grants = ok(await member.get("/api/workspace/access")).grants;
    expect(grants[1].actions).not.toContain("pos.sell");
    expect(ok(await scoped("get", "/workspace/inventory", grants[0].id))[0].cost).toBe("2.0000000000000000");
    ok(await scoped("post", "/pos/orders", grants[1].id).set("Idempotency-Key", randomUUID()).send({
      sessionId, items: [{ productId, quantity: 1 }], paymentMethod: "cash" }), 403);
    const [history] = await rows("SELECT count(*)::int AS n FROM responsibility_grants WHERE employee_id=$1 AND revoked_at IS NOT NULL", [person.personId]);
    expect(history.n).toBe(2);
    expect((await rows("SELECT id FROM audit_logs WHERE company_id=$1 AND action='team.access.update'", [companyId])).length).toBeGreaterThan(0);
    ok(await owner.put(`/api/team/people/${person.personId}/access`).send({ expectedRevision: person.revision-1, person: changed, suspended: false }), 409);
    person = ok(await owner.put(`/api/team/people/${person.personId}/access`).send({ expectedRevision: person.revision, person: changed, suspended: true }));
    // Suspension now invalidates the company session, rather than leaving a
    // logged-in shell with an empty grant list.
    ok(await scoped("get", "/workspace/inventory", grants[0].id), 401);
    ok(await member.get("/api/workspace/access"),401);
  });
  it("keeps records allowed at full seat quota, but prevents concurrent pending-login over-allocation", async () => {
    const current = ok(await owner.get("/api/team/setup")).policy;
    ok(await owner.put("/api/team/policy").send({ enabledModules: ["inventory","pos"], seatLimit: current.reservedAccessSlots + 1 }));
    const bodies = [1,2].map(i => personInput({ name: `Quota ${i}`, email: `${tag}-quota-${i}@example.invalid`, loginKinds: ["platform"] }));
    const created = await Promise.all(bodies.map(b => owner.post("/api/team/people").send(b)));
    expect(created.map(r => r.status).sort()).toEqual([201,409]);
    ok(await owner.post("/api/team/people").send(personInput()), 201);
  });
  it("bounds an existing shared identity to this company without resetting its password or inheriting its other-company owner role", async () => {
    ok(await owner.put("/api/team/policy").send({ enabledModules: ["inventory","pos","finance","hr","payroll","crm","reports","ai","team"], seatLimit: null }));
    const original = (await rows("SELECT id,password_hash FROM users WHERE email=$1", [`${tag}-other@example.invalid`]))[0];
    const body = personInput({ email: `${tag}-other@example.invalid`, loginKinds: ["platform"], grants: [stockGrant()] });
    const created = ok(await owner.post("/api/team/people").send(body), 201);
    const invitation = ok(await owner.post(`/api/team/people/${created.personId}/invite`).send({ expectedRevision: created.revision }), 201);
    ok(await request(app).post("/api/auth/team-activation/accept").send({ token: invitation.activationToken, password }), 403);
    ok(await outsider.post("/api/auth/team-activation/accept").send({ token: invitation.activationToken, password }));
    const unchanged = (await rows("SELECT id,password_hash FROM users WHERE id=$1", [original.id]))[0];
    expect(unchanged).toEqual(original);
    expect((await rows("SELECT role FROM user_companies WHERE user_id=$1 AND company_id=$2", [original.id, otherCompanyId]))[0].role).toBe("owner");
    ok(await outsider.post("/api/auth/switch-company").send({ companyId }));
    const access = ok(await outsider.get("/api/workspace/access"));
    expect(access.grants).toHaveLength(1);
    expect(access.grants[0].resource).toBe("inventory");
    expect((await outsider.get("/api/team/catalog")).status).toBe(403);
    expect((await outsider.post("/api/pos/orders").set("X-Workspace-Responsibility", String(access.grants[0].id))
      .set("Idempotency-Key", randomUUID()).send({ sessionId, items: [{ productId, quantity: 1 }], paymentMethod: "cash" })).status).toBe(403);
    ok(await outsider.post("/api/auth/switch-company").send({ companyId: otherCompanyId }));
    ok(await outsider.get("/api/team/catalog"));
  });
  it("never replaces an existing company membership, including the last owner, during activation", async () => {
    const body = personInput({ email: `${tag}-owner@example.invalid`, loginKinds: ["platform"], grants: [stockGrant()] });
    const created = ok(await owner.post("/api/team/people").send(body), 201);
    const invitation = ok(await owner.post(`/api/team/people/${created.personId}/invite`).send({ expectedRevision: created.revision }), 201);
    ok(await owner.post("/api/auth/team-activation/accept").send({ token: invitation.activationToken, password }), 409);
    expect((await rows("SELECT role FROM user_companies WHERE user_id=$1 AND company_id=$2", [ownerId, companyId]))[0].role).toBe("owner");
    ok(await owner.delete(`/api/team/people/${created.personId}/invite`));
    ok(await request(app).post("/api/auth/team-activation/inspect").send({ token: invitation.activationToken }), 409);
    ok(await owner.put(`/api/team/people/${created.personId}/access`).send({
      expectedRevision: created.revision, person: { ...body, loginKinds: [], grants: [] }, suspended: false }));
  });
  it("invalidates invitations after scope edits and serializes conflicting administrator edits", async () => {
    const body = personInput({ email: `${tag}-changing@example.invalid`, loginKinds: ["platform"], grants: [stockGrant()] });
    const created = ok(await owner.post("/api/team/people").send(body), 201);
    const invitation = ok(await owner.post(`/api/team/people/${created.personId}/invite`).send({ expectedRevision: created.revision }), 201);
    const changes = await Promise.all([1,2].map(n => owner.put(`/api/team/people/${created.personId}/access`).send({
      expectedRevision: created.revision, person: { ...body, name: `مراجعة ${n}` }, suspended: false })));
    expect(changes.map(r => r.status).sort()).toEqual([200,409]);
    ok(await request(app).post("/api/auth/team-activation/inspect").send({ token: invitation.activationToken }), 409);
    expect((await rows("SELECT revoked_at,used_at FROM team_invitations WHERE employee_id=$1", [created.personId]))[0])
      .toEqual({ revoked_at: expect.any(Date), used_at: null });
  });
  it("evaluates expiry by wall clock even after a transaction has already started", async () => {
    const current = (await rows("SELECT user_id FROM employee_access WHERE employee_id=$1", [person.personId]))[0];
    const target = grants[0].id;
    try {
      await db.transaction(async tx => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(174223,35)`);
        await tx.execute(sql`UPDATE employee_access SET status='active' WHERE employee_id=${person.personId}`);
        await tx.execute(sql`UPDATE responsibility_grants SET ends_at=clock_timestamp()+interval '100 milliseconds' WHERE id=${target}`);
        await tx.execute(sql`SELECT pg_sleep(0.15)`);
        const control = await tx.execute(sql`SELECT ends_at>now() AS frozen_clock_would_allow FROM responsibility_grants WHERE id=${target}`);
        expect(control.rows[0].frozen_clock_would_allow).toBe(true);
        expect((await currentResponsibilities(current.user_id, companyId, tx)).some(g => g.id === target)).toBe(false);
        throw new Error("intentional synthetic rollback");
      });
    } catch (err) { if (!(err instanceof Error) || err.message !== "intentional synthetic rollback") throw err; }
  });
  it("rejects an expired invitation without exposing an identity or activating a membership", async () => {
    const body = personInput({ email: `${tag}-expired@example.invalid`, loginKinds: ["platform"], grants: [stockGrant()] });
    const created = ok(await owner.post("/api/team/people").send(body), 201);
    const invitation = ok(await owner.post(`/api/team/people/${created.personId}/invite`).send({ expectedRevision: created.revision }), 201);
    await rows("UPDATE team_invitations SET expires_at=created_at+interval '1 millisecond' WHERE employee_id=$1", [created.personId]);
    await rows("SELECT pg_sleep(0.02)");
    ok(await request(app).post("/api/auth/team-activation/inspect").send({ token: invitation.activationToken }), 409);
    ok(await request(app).post("/api/auth/team-activation/accept").send({ token: invitation.activationToken, password }), 409);
    expect((await rows("SELECT user_id,status FROM employee_access WHERE employee_id=$1", [created.personId]))[0]).toEqual({ user_id: null, status: "pending" });
  });
  it("accepts one concurrent activation only, creates one identity and never logs in automatically", async () => {
    const body = personInput({ email: `${tag}-once@example.invalid`, loginKinds: ["platform"], grants: [stockGrant()] });
    const created = ok(await owner.post("/api/team/people").send(body), 201);
    const invitation = ok(await owner.post(`/api/team/people/${created.personId}/invite`).send({ expectedRevision: created.revision }), 201);
    const client = request.agent(app);
    const replies = await Promise.all([1,2].map(() => client.post("/api/auth/team-activation/accept")
      .send({ token: invitation.activationToken, password })));
    expect(replies.map(r=>r.status).sort()).toEqual([200,409]);
    expect((await rows("SELECT count(*)::int AS n FROM users WHERE email=$1", [body.email]))[0].n).toBe(1);
    const [profile] = await rows("SELECT user_id,revision FROM employee_access WHERE employee_id=$1", [created.personId]);
    expect(profile.revision).toBe(2);
    expect((await rows("SELECT count(*)::int AS n FROM user_companies WHERE user_id=$1 AND company_id=$2", [profile.user_id,companyId]))[0].n).toBe(1);
    ok(await client.get("/api/auth/me"), 401);
  });
  it("rechecks a managed cashier after the authority writer wins; no invoice or stock effect", async () => {
    person = ok(await owner.put(`/api/team/people/${person.personId}/access`).send({
      expectedRevision: person.revision, person: input, suspended: false }));
    ok(await member.post("/api/auth/login").send({email:input.email,password}));
    grants = ok(await member.get("/api/workspace/access")).grants;
    const before = await totals();
    const writer = await pool.connect();
    const writerPid = (await writer.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    try {
      await writer.query("BEGIN");
      await writer.query("SELECT pg_advisory_xact_lock(174223,35)");
      await writer.query("UPDATE employee_access SET status='suspended',revision=revision+1 WHERE employee_id=$1", [person.personId]);
      const pending = scoped("post", "/pos/orders", grants[1].id).set("Idempotency-Key", randomUUID())
        .send({ sessionId, items: [{ productId, quantity: 1 }], paymentMethod: "cash" }).then(r => r);
      let blocked = false;
      for (let i = 0; i < 100; i++) {
        const [waiters] = await rows(`SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE $1=ANY(pg_blocking_pids(pid)) AND query LIKE '%pg_advisory_xact_lock_shared%'`, [writerPid]);
        if (waiters.n) { blocked = true; break; }
        await new Promise(r => setTimeout(r, 20));
      }
      await writer.query("COMMIT");
      expect(blocked).toBe(true);
      ok(await pending, 403);
      expect(await totals()).toEqual(before);
    } finally { await writer.query("ROLLBACK"); writer.release(); }
  });
  it("measures the global fence across three synthetic companies without claiming production capacity", async () => {
    const [third] = await db.insert(companiesTable).values({ name: `${tag}-probe` }).returning();
    await db.insert(userCompaniesTable).values({ companyId: third.id, userId: ownerId, role: "owner" });
    const ids = [companyId, otherCompanyId, third.id];
    const probe = async (id: number) => {
      const client = await pool.connect();
      const start = performance.now();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock_shared(174223,35)");
        const proof = await client.query("SELECT company_id,role FROM user_companies WHERE company_id=$1 LIMIT 1", [id]);
        expect(proof.rows[0].company_id).toBe(id);
        await client.query("COMMIT");
        return Number((performance.now()-start).toFixed(2));
      } finally { await client.query("ROLLBACK"); client.release(); }
    };
    const baseline = await Promise.all(ids.map(probe));
    const writer = await pool.connect();
    const writerPid = (await writer.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    try {
      await writer.query("BEGIN");
      await writer.query("SELECT pg_advisory_xact_lock(174223,35)");
      await writer.query("UPDATE team_access_policy SET updated_at=now() WHERE company_id=$1", [companyId]);
      const blocked = ids.map(probe);
      let count = 0;
      for (let i=0; i<100; i++) {
        const [w] = await rows("SELECT count(*)::int AS n FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))", [writerPid]);
        count = w.n;
        if (count >= 3) break;
        await new Promise(r => setTimeout(r, 10));
      }
      await new Promise(r => setTimeout(r, 40)); // explicitly injected authority-writer hold
      await writer.query("COMMIT");
      const contended = await Promise.all(blocked);
      expect(count).toBeGreaterThanOrEqual(3);
      console.log("TEAM_AUTHORITY_FENCE_PROBE", JSON.stringify({ companies: 3, samplesPerCompany: 1,
        injectedHoldMs: 40, baselineMs: baseline, contendedMs: contended, unit: "authority SQL read, not full POS or production throughput" }));
    } finally { await writer.query("ROLLBACK"); writer.release(); }
  });
  it("supports long Arabic phrases without bcrypt truncation, preserves legacy verification", async () => {
    const phrase = "عبارة مرور طويلة للموظف مع كلمات مختلفة وآمنة للاختبار فقط";
    const hash = await hashAccountPassword(phrase);
    expect(await verifyAccountPassword(phrase, hash)).toBe(true);
    expect(await verifyAccountPassword(phrase + " تغيير", hash)).toBe(false);
    expect(await verifyAccountPassword(password, await bcrypt.hash(password, 4))).toBe(true);
    expect(TeamPersonInput.safeParse({ ...input, grants: [{ ...stockGrant(), actions: ["owner"] }] }).success).toBe(false);
  });
  it("does not turn a managed identity into a broad legacy role or count it as a replacement last owner", async () => {
    const [{ user_id: userId }] = await rows("SELECT user_id FROM employee_access WHERE employee_id=$1", [person.personId]);
    ok(await owner.patch(`/api/users/${userId}`).send({ role: "owner" }), 409);
    ok(await owner.delete(`/api/users/${userId}`), 409);
    await rows("UPDATE user_companies SET role='owner' WHERE user_id=$1 AND company_id=$2", [userId,companyId]);
    try { ok(await owner.patch(`/api/users/${ownerId}`).send({ role: "cashier" }), 409); }
    finally { await rows("UPDATE user_companies SET role='scoped' WHERE user_id=$1 AND company_id=$2", [userId,companyId]); }
    expect((await rows("SELECT role FROM user_companies WHERE user_id=$1 AND company_id=$2", [ownerId,companyId]))[0].role).toBe("owner");
  });
  it("requires base read explicitly, cascades read denial, and never promises an inventory amount cap", async () => {
    for (const grant of [{ ...stockGrant(), actions: ["inventory.cost.read"] },
      { ...saleGrant(), actions: ["pos.sell"] }, { ...stockGrant(), amountLimit: "50" }]) {
      ok(await owner.post("/api/team/people/preview").send(personInput({ email: `${tag}-read@example.invalid`, grants: [grant], loginKinds: ["platform","pos"] })), 400);
    }
    const preview = ok(await owner.post("/api/team/people/preview").send({
      ...personInput({ email: `${tag}-read@example.invalid`, grants: [stockGrant(),saleGrant()], loginKinds: ["platform","pos"] }),
      deniedActions: ["inventory.read","pos.read"] }));
    expect(preview.grants.every((g: { actions: string[] }) => g.actions.length === 0)).toBe(true);
  });
});
