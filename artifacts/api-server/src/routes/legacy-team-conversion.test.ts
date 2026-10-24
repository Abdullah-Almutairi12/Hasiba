import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { db, pool, companiesTable, usersTable, userCompaniesTable, branchesTable, warehousesTable, employeesTable } from "@workspace/db";
import app, { assertApplicationReady } from "../app";
import type { TeamPerson } from "../lib/team-catalog";

const tag = `legacy-team-${randomUUID()}`;
const password = "Synthetic legacy migration phrase 2026!";
let companyId: number, otherCompanyId: number, ownerId: number, branchId: number, otherBranchId: number, warehouseId: number;
let owner: request.Agent;
const rows = async (q: string, p: unknown[] = []) => (await pool.query(q, p)).rows;
const ok = (r: request.Response, status = 200) => { expect(r.status, JSON.stringify(r.body)).toBe(status); return r.body; };
async function login(email: string) {
  const agent = request.agent(app);
  ok(await agent.post("/api/auth/login").send({ email, password }));
  return agent;
}
beforeAll(async () => {
  await assertApplicationReady();
  const companies = await db.insert(companiesTable).values([0,1].map(i => ({
    name: `${tag}-${i}`, nameAr: "شركة اختبار تحويل", isActive: true,
  }))).returning();
  [companyId, otherCompanyId] = companies.map(c => c.id);
  const [user] = await db.insert(usersTable).values({ name: "مالك التحويل", email: `${tag}-owner@example.test`,
    passwordHash: await bcrypt.hash(password, 4), role: "owner", isActive: true }).returning();
  ownerId = user.id;
  await db.insert(userCompaniesTable).values({ userId: ownerId, companyId, role: "owner" });
  const branches = await db.insert(branchesTable).values([0,1].map(i => ({
    companyId, name: `${tag}-branch-${i}`, nameAr: "فرع الاختبار", city: "الرياض",
  }))).returning();
  [branchId, otherBranchId] = branches.map(b => b.id);
  const [warehouse] = await db.insert(warehousesTable).values({
    companyId, branchId, name: tag, nameAr: "مستودع الاختبار",
  }).returning();
  warehouseId = warehouse.id;
  owner = await login(user.email);
});
async function fixture(role: "inventory" | "cashier" = "inventory") {
  const name = `موظف تحويل ${randomUUID().slice(0,8)}`, email = `${randomUUID()}@example.test`;
  const [user] = await db.insert(usersTable).values({ name, email, passwordHash: await bcrypt.hash(password, 4),
    role, branchId, isActive: true }).returning();
  await db.insert(userCompaniesTable).values({ userId: user.id, companyId, role, isDefault: true });
  const [employee] = await db.insert(employeesTable).values({
    companyId, userId: user.id, name, nameAr: name, email, employeeNo: `LEG-${randomUUID()}`,
    hireDate: "2024-01-01", status: "active", recordKind: "employee", nationality: "SA",
  }).returning();
  const resource = role === "cashier" ? "pos" : "inventory";
  const person: TeamPerson = { creationKey: randomUUID(), name, email, loginKinds: [resource === "pos" ? "pos" : "platform"],
    deniedActions: [], grants: [{ resource, branchId, warehouseIds: [warehouseId], actions: [`${resource}.read`],
      amountLimit: null, startsAt: null, endsAt: null }] };
  return { user, employee, person, body: { userId: user.id, person }, agent: await login(email) };
}
const preview = async (body: object) => ok(await owner.post("/api/team/legacy/preview").send(body));
const apply = async (body: object, digest: string) => owner.post("/api/team/legacy/apply").send({ ...body, expectedDigest: digest });
const rollbackPreview = async (id: number) => ok(await owner.get(`/api/team/legacy/${id}/rollback-preview`));

describe("explicit conservative legacy adoption", () => {
  it("lists actual memberships only to owner, blocking owner and custom old policy without secrets", async () => {
    const f = await fixture();
    const list = ok(await owner.get("/api/team/legacy/users"));
    expect(list.find((u: any) => u.userId === f.user.id)).toMatchObject({ eligible: true, conversionState: "legacy" });
    expect(list.find((u: any) => u.userId === ownerId).eligible).toBe(false);
    expect(JSON.stringify(list)).not.toMatch(/passwordHash|password_hash|Synthetic legacy migration/);
    ok(await f.agent.get("/api/team/legacy/users"), 403);
    await rows("INSERT INTO return_access(company_id,user_id,template,capabilities,branches,updated_by) VALUES($1,$2,'cashier',$3,$4,$5)",
      [companyId, f.user.id, JSON.stringify(["view"]), JSON.stringify([branchId]), ownerId]);
    expect(ok(await owner.get("/api/team/legacy/users")).find((u: any) => u.userId === f.user.id).eligible).toBe(false);
    ok(await owner.post("/api/team/legacy/preview").send(f.body), 409);
  });
  it("previews without changing identity or grants and does not reserve another seat at the configured limit", async () => {
    const f = await fixture();
    const [{ n }] = await rows("SELECT count(*)::int n FROM user_companies WHERE company_id=$1", [companyId]);
    ok(await owner.put("/api/team/policy").send({ enabledModules: ["inventory","pos"], seatLimit: n }));
    const a = await preview(f.body), b = await preview(f.body);
    expect(a.digest).toBe(b.digest);
    expect(a.allowedActions).toEqual(["inventory.read"]);
    expect(a.warnings.join(" ")).toContain("محجوبة");
    expect(await rows("SELECT * FROM employee_access WHERE employee_id=$1", [f.employee.id])).toHaveLength(0);
    ok(await apply(f.body, a.digest));
    expect(ok(await owner.get("/api/team/setup")).policy.activeLoginSeats).toBe(n);
    ok(await owner.put("/api/team/policy").send({ enabledModules: ["inventory","pos"], seatLimit: null }));
  });
  it("rejects forged scope, identity edits, role changes and cross-company targets", async () => {
    const f = await fixture("cashier");
    const altered = structuredClone(f.body);
    altered.person.grants[0].branchId = otherBranchId;
    ok(await owner.post("/api/team/legacy/preview").send(altered), 403);
    altered.person.name = "اسم بديل";
    ok(await owner.post("/api/team/legacy/preview").send(altered), 409);
    ok(await owner.post("/api/team/legacy/preview").send({ ...f.body, userId: ownerId }), 409);
    const [foreign] = await db.insert(usersTable).values({ name: "أجنبي", email: `${randomUUID()}@example.test`,
      passwordHash: "not-used", role: "cashier", isActive: true }).returning();
    await db.insert(userCompaniesTable).values({ userId: foreign.id, companyId: otherCompanyId, role: "cashier" });
    ok(await owner.post("/api/team/legacy/preview").send({ ...f.body, userId: foreign.id }), 404);
  });
  it("adopts the same HR person and live session with no global changes; other company ownership survives", async () => {
    const f = await fixture();
    await db.insert(userCompaniesTable).values({ userId: f.user.id, companyId: otherCompanyId, role: "owner" });
    const before = await rows("SELECT row_to_json(u) identity,(SELECT row_to_json(e) FROM employees e WHERE id=$2) person FROM users u WHERE id=$1",
      [f.user.id, f.employee.id]);
    const p = await preview(f.body), saved = ok(await apply(f.body, p.digest));
    expect(saved.personId).toBe(f.employee.id);
    expect(saved.userId).toBe(f.user.id);
    expect(saved.status).toBe("active");
    const after = await rows("SELECT row_to_json(u) identity,(SELECT row_to_json(e) FROM employees e WHERE id=$2) person FROM users u WHERE id=$1",
      [f.user.id, f.employee.id]);
    expect(after).toEqual(before);
    expect((await rows("SELECT role FROM user_companies WHERE user_id=$1 AND company_id=$2", [f.user.id, otherCompanyId]))[0].role).toBe("owner");
    const access = ok(await f.agent.get("/api/workspace/access"));
    expect(access.managed).toBe(true);
    const me = ok(await f.agent.get("/api/auth/me"));
    expect(me.role).toBe("scoped");
    expect(me.companies.find((c: any) => c.id === companyId).role).toBe("scoped");
    expect(me.companies.find((c: any) => c.id === otherCompanyId).role).toBe("owner");
    expect(ok(await f.agent.get("/api/users/permissions"))).toEqual({ role: "scoped", permissions: [] });
    expect(ok(await (await login(f.user.email)).get("/api/auth/me")).role).toBe("scoped");
    const grant = access.grants[0];
    ok(await f.agent.get("/api/workspace/inventory").set("X-Workspace-Responsibility", String(grant.id)));
    ok(await f.agent.get("/api/workspace/inventory"), 403);
    ok(await f.agent.get("/api/users"), 403);
    ok(await f.agent.get("/api/reports/summary"), 403);
  });
  it("serializes identical concurrent application and rejects an altered retry body", async () => {
    const f = await fixture("cashier"), p = await preview(f.body);
    const replies = await Promise.all([apply(f.body, p.digest), apply(f.body, p.digest)]);
    replies.forEach(r => ok(r));
    expect(await rows("SELECT id FROM legacy_team_conversions WHERE user_id=$1 AND company_id=$2", [f.user.id, companyId])).toHaveLength(1);
    expect(await rows("SELECT id FROM responsibility_grants WHERE employee_id=$1", [f.employee.id])).toHaveLength(1);
    ok(await apply({ ...f.body, person: { ...f.person, deniedActions: ["pos.read"] } }, p.digest), 409);
  });
  it("rejects stale apply when old authority changed after preview", async () => {
    const f = await fixture("cashier"), p = await preview(f.body);
    await rows("UPDATE users SET branch_id=$1 WHERE id=$2", [otherBranchId, f.user.id]);
    ok(await apply(f.body, p.digest), 403);
    expect(await rows("SELECT employee_id FROM employee_access WHERE employee_id=$1", [f.employee.id])).toHaveLength(0);
  });
  it("requires fresh rollback review and reason; retains revoked history instead of deleting it", async () => {
    const f = await fixture(), p = await preview(f.body);
    const seatsBefore = ok(await owner.get("/api/team/setup")).policy.activeLoginSeats;
    ok(await apply(f.body, p.digest));
    const r = await rollbackPreview(f.user.id);
    expect(r.warnings[0]).toContain("أوسع");
    ok(await owner.post(`/api/team/legacy/${f.user.id}/rollback`).send({ expectedDigest: r.digest, reason: "لا" }), 400);
    ok(await owner.post(`/api/team/legacy/${f.user.id}/rollback`).send({
      expectedDigest: r.digest, reason: "إرجاع تجريبي بعد مراجعة نطاق الدور السابق",
    }));
    expect(ok(await f.agent.get("/api/workspace/access")).managed).toBe(false);
    expect(ok(await f.agent.get("/api/auth/me")).role).toBe("inventory");
    const [access] = await rows("SELECT status,revision FROM employee_access WHERE employee_id=$1", [f.employee.id]);
    expect(access).toMatchObject({ status: "suspended", revision: 2 });
    expect((await rows("SELECT revoked_at FROM responsibility_grants WHERE employee_id=$1", [f.employee.id]))[0].revoked_at).toBeTruthy();
    expect(await rows("SELECT id FROM audit_logs WHERE company_id=$1 AND action IN ('team.legacy.convert','team.legacy.rollback') AND details::jsonb->>'userId'=$2",
      [companyId, String(f.user.id)])).toHaveLength(2);
    expect(ok(await owner.get("/api/team/people")).some((x: any) => x.personId === f.employee.id)).toBe(false);
    expect(ok(await owner.get("/api/team/setup")).policy.activeLoginSeats).toBe(seatsBefore);
    ok(await owner.put(`/api/team/people/${f.employee.id}/access`).send({ expectedRevision: access.revision, person: f.person, suspended: false }), 409);
    ok(await owner.post("/api/team/legacy/preview").send(f.body), 409);
  });
  it("cannot use stale rollback to erase explicit deny or suspension", async () => {
    const f = await fixture(), p = await preview(f.body), saved = ok(await apply(f.body, p.digest));
    const r = await rollbackPreview(f.user.id);
    const denied = { ...f.person, deniedActions: ["inventory.cost.read"] };
    ok(await owner.put(`/api/team/people/${f.employee.id}/access`).send({ expectedRevision: saved.revision, person: denied, suspended: false }));
    ok(await owner.post(`/api/team/legacy/${f.user.id}/rollback`).send({ expectedDigest: r.digest, reason: "معاينة قديمة يجب ألا تتجاوز المنع الجديد" }), 409);
    const fresh = await rollbackPreview(f.user.id);
    ok(await owner.put(`/api/team/people/${f.employee.id}/access`).send({ expectedRevision: saved.revision + 1, person: denied, suspended: true }));
    ok(await owner.post(`/api/team/legacy/${f.user.id}/rollback`).send({ expectedDigest: fresh.digest, reason: "المستخدم معلق فلا يجوز تجاوزه بالرجوع" }), 409);
  });
  it("shows future and explicitly denied grants as ineffective in the preview", async () => {
    const f = await fixture();
    f.person.grants[0].startsAt = new Date(Date.now() + 86_400_000).toISOString();
    expect((await preview(f.body)).allowedActions).toEqual([]);
    f.person.grants[0].startsAt = null;
    f.person.deniedActions = ["inventory.read"];
    expect((await preview(f.body)).allowedActions).toEqual([]);
  });
  it("blocks rollback when the original HR link is no longer the same eligible person", async () => {
    const f = await fixture(), p = await preview(f.body);
    ok(await apply(f.body, p.digest));
    const r = await rollbackPreview(f.user.id);
    await rows("UPDATE employees SET status='terminated' WHERE id=$1", [f.employee.id]);
    ok(await owner.post(`/api/team/legacy/${f.user.id}/rollback`).send({
      expectedDigest: r.digest, reason: "انتهاء الموظف يجب ألا يعيد صلاحياته القديمة",
    }), 409);
  });
});
