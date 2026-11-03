import { beforeAll, describe, it, expect, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import ExcelJS from "exceljs";
import { randomUUID } from "node:crypto";
import { db, pool, companiesTable, usersTable, userCompaniesTable } from "@workspace/db";
import app, { assertApplicationReady } from "../app";
import { type ImportDocument, signImport } from "../lib/product-import";
import { posTemplateFixture, accepted as ok, personInput } from "../test/pos-template-fixture";

const endpoint = "/api/customers/imports", tag = randomUUID();
const agents: request.Agent[] = [], companies: number[] = [], users: number[] = [];
const rows = async (q: string, values: unknown[] = []) => (await pool.query(q, values)).rows;
const doc = (name = `عميل ${randomUUID()}`): ImportDocument => ({
  headers: ["الاسم", "الهاتف", "الرقم الضريبي"], rows: [[name, "005001234", null]],
  mapping: { name: 0, phone: 1, taxNumber: 2 },
});
const preview = async (document = doc(), index = 0, confirmSimilarNames = false) =>
  (await agents[index].post(endpoint).send({ action: "preview", document, confirmSimilarNames }).expect(200)).body;
const send = (token: string, key = randomUUID(), action = "commit", index = 0) =>
  agents[index].post(endpoint).set("Idempotency-Key", key).send({ action, token });
const facts = async () => (await rows("SELECT to_jsonb(c) value FROM customers c ORDER BY id")).map(r => r.value);
async function waiting(pid: number, needle: string) {
  for (let n = 0; n < 120; n++) {
    const r = await rows("SELECT pid FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid)) AND query ILIKE $2", [pid, `%${needle}%`]);
    if (r.length) return r[0].pid;
    await new Promise(r => setTimeout(r, 15));
  }
  throw new Error(`No real PostgreSQL wait: ${needle}`);
}
beforeAll(async () => {
  expect(new URL(process.env.TEST_DATABASE_URL!).hostname).toBe("127.0.0.1");
  await assertApplicationReady();
  const password = `synthetic-${tag}`, passwordHash = await bcrypt.hash(password, 4);
  for (let i = 0; i < 2; i++) {
    const [c] = await db.insert(companiesTable).values({ name: `عملاء ${tag}-${i}` }).returning();
    companies.push(c.id);
    const [u] = await db.insert(usersTable).values({ name: "اختبار", email: `${tag}-${i}@example.invalid`, passwordHash, role: "owner", isActive: true }).returning();
    users.push(u.id);
    await db.insert(userCompaniesTable).values({ userId: u.id, companyId: c.id, role: "owner", isDefault: true });
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ email: u.email, password }).expect(200);
    agents.push(agent);
  }
});
describe.sequential("customer directory import on disposable PostgreSQL", () => {
  it.each(["اسم الشركة", "Company Name", "Customer Company Name"])("accepts mapped natural name %s; directory only", async header => {
    const p = await preview({ headers: [header], rows: [[`منشأة ${randomUUID()}`]], mapping: { name: 0 } });
    const result = await send(p.token).expect(200);
    const [saved] = await rows("SELECT * FROM customers WHERE id=$1", [result.body.customers[0].id]);
    expect(saved).toMatchObject({ company_id: companies[0], total_orders: 0, total_spent: "0.00",
      credit_limit: "0.00", payment_terms_days: 0, linked_company_id: null, default_pricelist_id: null });
  });
  it("parses Arabic quoted CSV with separators, reordering and optional text identifiers", async () => {
    const before = await facts();
    const csv = '\ufeff"هاتف";"اسم";"عنوان"\r\n"005001234";"عميل، عربي";"الرياض; شمال"\r\n';
    const parsed = await agents[0].post(endpoint).send({ action: "parse", fileName: "عربي.csv", base64: Buffer.from(csv).toString("base64") }).expect(200);
    const p = await preview({ ...parsed.body, mapping: { phone: 0, name: 1, billingAddress: 2 } }, 0, true);
    expect(p.customers[0]).toMatchObject({ phone: "005001234", name: "عميل، عربي", billingAddress: "الرياض; شمال", taxNumber: null });
    expect(await facts()).toEqual(before);
  });
  it("parses Arabic XLSX with text zeroes, both addresses and individual without tax number", async () => {
    const wb = new ExcelJS.Workbook(), sheet = wb.addWorksheet("العملاء");
    sheet.addRow(["البريد", "العميل", "الرقم", "هاتف", "فوترة", "شحن"]);
    sheet.addRow(["customer@example.invalid", "عميل ملف إكسل", "000789012345678", "005001234", "الرياض", "جدة"]);
    sheet.addRow([null, `فرد ${tag}`, null, null, null, null]);
    const parsed = await agents[0].post(endpoint).send({ action: "parse", fileName: "العملاء.xlsx",
      base64: Buffer.from(await wb.xlsx.writeBuffer()).toString("base64") }).expect(200);
    const p = await preview({ ...parsed.body, mapping: { email: 0, name: 1, taxNumber: 2, phone: 3, billingAddress: 4, shippingAddress: 5 } }, 0, true);
    const saved = await send(p.token).expect(200);
    const records = await rows("SELECT tax_number,phone FROM customers WHERE id=ANY($1::int[]) ORDER BY id", [saved.body.customers.map((c: any) => c.id)]);
    expect(records).toEqual([{ tax_number: "000789012345678", phone: "005001234" }, { tax_number: null, phone: null }]);
  });
  it.each(["mixed", "invalid"])("shows every original %s source row without any insertion", async kind => {
    const before = await facts();
    const p = await preview({ headers: ["name", "email"], rows: [["أ", "bad"], ["ب", kind === "mixed" ? "ok@example.invalid" : "bad-too"]],
      mapping: { name: 0, email: 1 } });
    expect(p.previewRows.map((r: any) => r.row)).toEqual([2, 3]);
    expect(p.previewRows.map((r: any) => r.values.email)).toEqual(["bad", kind === "mixed" ? "ok@example.invalid" : "bad-too"]);
    expect(p.previewRows[0].errors[0].row).toBe(2);
    expect(p.canCommit).toBe(false); expect(p.token).toBeNull();
    expect(await facts()).toEqual(before);
  });
  it("rejects unsupported ownership/finance, unbound columns, invalid strings and numeric identifiers atomically", async () => {
    const before = await facts();
    for (const header of ["companyId", "balance", "creditLimit", "paymentTermsDays", "defaultPricelistId", "totalOrders", "linkedCompanyId", "iban"]) {
      const p = await preview({ headers: ["name", header], rows: [["صالح", "100"]], mapping: { name: 0, billingAddress: 1 } });
      expect(p.canCommit).toBe(false);
    }
    for (const d of [
      { ...doc(), rows: [["فرد", 5001234, null]] }, { ...doc(), rows: [["فرد", null, 12345678901234567]] },
      { ...doc(), rows: [["", null, null]] }, { ...doc(), rows: [["+SUM(1,2)", null, null]] },
      { ...doc(), mapping: { name: 0, phone: 0 } }, { ...doc(), mapping: { name: 0 } },
      { ...doc(), mapping: { name: 0, balance: 1, phone: 2 } },
    ]) expect((await preview(d as ImportDocument)).canCommit).toBe(false);
    await agents[0].post(endpoint).send({ action: "preview", document: doc(), companyId: companies[1] }).expect(400);
    expect(await facts()).toEqual(before);
  });
  it("rejects malformed, oversized, formula workbooks and record/column limits through shared reader", async () => {
    for (const [fileName, data] of [["x.xlsx", "broken"], ["x.json", "{}"], ["x.csv", "name\n" + "x".repeat(262144)]])
      await agents[0].post(endpoint).send({ action: "parse", fileName, base64: Buffer.from(data).toString("base64") }).expect(400);
    const wb = new ExcelJS.Workbook(), sheet = wb.addWorksheet("عملاء");
    sheet.addRow(["name"]); sheet.addRow([{ formula: '"unsafe"', result: "value" }]);
    await agents[0].post(endpoint).send({ action: "parse", fileName: "formula.xlsx", base64: Buffer.from(await wb.xlsx.writeBuffer()).toString("base64") }).expect(400);
    await agents[0].post(endpoint).send({ action: "preview", document: { ...doc(), rows: Array(501).fill(["اسم", null, null]) } }).expect(400);
    await agents[0].post(endpoint).send({ action: "preview", document: { ...doc(), headers: Array(13).fill("name") } }).expect(400);
  });
  it("treats same name/phone/email/tax as review, not identity uniqueness or merge; same company duplicates allowed explicitly", async () => {
    const d = { headers: ["name", "phone", "email", "tax"], rows: [[`تشابه ${tag}`, "000123", "shared@example.invalid", "000001"]],
      mapping: { name: 0, phone: 1, email: 2, taxNumber: 3 } };
    const first = await send((await preview(d)).token).expect(200);
    const p = await preview(d); expect(p.canCommit).toBe(false); expect(p.warnings[0].matches[0].id).toBe(first.body.customers[0].id);
    const old = await facts();
    const second = await send((await preview(d, 0, true)).token).expect(200);
    expect(second.body.customers[0].id).not.toBe(first.body.customers[0].id);
    expect((await facts()).slice(0, old.length)).toEqual(old);
    const repeated = await preview({ ...d, rows: [["أ", "same-phone", null, null], ["ب", "same-phone", null, null]] });
    expect(repeated.warnings[0].row).toBe(3); expect(repeated.warnings[0].matches[0].id).toBe(-2);
    expect(repeated.canCommit).toBe(false);
  });
  it("isolates company matches and supports one member explicitly switching company", async () => {
    const d = { headers: ["name"], rows: [[`مشترك ${tag}`]], mapping: { name: 0 } };
    await send((await preview(d)).token).expect(200);
    const p = await preview(d, 1); expect(p.warnings).toEqual([]);
    await send(p.token, randomUUID(), "commit", 0).expect(403);
    await send(p.token, randomUUID(), "commit", 1).expect(200);
    await db.insert(userCompaniesTable).values({ userId: users[0], companyId: companies[1], role: "owner" });
    const selected = await agents[0].post("/api/auth/switch-company").send({ companyId: companies[1] });
    // The public switch contract must remain authenticated, never file-owned.
    expect(selected.status).toBe(200);
    const own = await agents[0].get("/api/customers").expect(200);
    expect(own.body.every((c: any) => c.companyId === companies[1])).toBe(true);
    await agents[0].post("/api/auth/switch-company").send({ companyId: companies[0] }).expect(200);
  });
  it("binds reviewed matches to current facts and rejects stale consent after original customer changes", async () => {
    const name = `تغير ${randomUUID()}`, d = { headers: ["name"], rows: [[name]], mapping: { name: 0 } };
    const p = await preview(d), key = randomUUID();
    await agents[0].post("/api/customers").send({ name }).expect(201);
    await send(p.token, key).expect(409);
    expect((await send(p.token, key, "close").expect(200)).body.state).toBe("closed");
    await send(p.token, key).expect(409);
    await send((await preview(d, 0, true)).token).expect(200);
  });
  it("binds tokens to user, tenant, purpose and unmodified reviewed body", async () => {
    const p = await preview(doc(), 0, true);
    await send(p.token, randomUUID(), "commit", 1).expect(403);
    await send(signImport(companies[0], users[0], doc(), "suppliers")).expect(400);
    await send(p.token.slice(0, -1) + (p.token.endsWith("a") ? "b" : "a")).expect(400);
    await agents[0].post(endpoint).set("Idempotency-Key", randomUUID()).send({ action: "commit", token: p.token, rows: [] }).expect(400);
  });
  it("expires creation but retains safe durable closure/recovery", async () => {
    const p = await preview(doc(), 0, true), key = randomUUID(), now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now + 901000);
    try {
      await send(p.token, key).expect(409);
      expect((await send(p.token, key, "close").expect(200)).body.state).toBe("closed");
      expect((await send(p.token, key, "recover").expect(200)).body.state).toBe("closed");
    } finally { clock.mockRestore(); }
  });
  it("saves once under concurrent retries and recovers unchanged receipt after response loss and permission withdrawal", async () => {
    const p = await preview(doc(), 0, true), key = randomUUID(), before = await facts();
    const replies = await Promise.all([send(p.token, key), send(p.token, key)]);
    expect(replies.map(r => r.status)).toEqual([200, 200]);
    expect(replies[0].body).toEqual(replies[1].body);
    expect((await send(p.token, key, "recover").expect(200)).body).toEqual(replies[0].body);
    expect((await send(p.token, key, "close").expect(200)).body).toEqual(replies[0].body);
    expect((await facts()).length - before.length).toBe(1);
    await rows("UPDATE user_companies SET role='auditor' WHERE company_id=$1 AND user_id=$2", [companies[0], users[0]]);
    await agents[0].get(endpoint).expect(403);
    await send(p.token, key, "recover").expect(200);
    await rows("DELETE FROM user_companies WHERE company_id=$1 AND user_id=$2", [companies[0], users[0]]);
    expect([401,403]).toContain((await send(p.token, key, "recover")).status);
    await db.insert(userCompaniesTable).values({ companyId: companies[0], userId: users[0], role: "owner", isDefault: true });
  });
  it("rechecks actual write authority after PostgreSQL relation wait", async () => {
    const p = await preview(doc(), 0, true), key = randomUUID(), blocker = await pool.connect();
    let pending: Promise<request.Response> | undefined;
    try {
      await blocker.query("BEGIN"); await blocker.query("LOCK TABLE customers IN SHARE MODE");
      const pid = (await blocker.query("SELECT pg_backend_pid() pid")).rows[0].pid;
      pending = send(p.token, key).then(r => r);
      await waiting(pid, "LOCK TABLE customers");
      await rows("UPDATE user_companies SET role='auditor' WHERE company_id=$1 AND user_id=$2", [companies[0], users[0]]);
      await blocker.query("COMMIT");
      expect((await pending).status).toBe(403);
      expect(await rows("SELECT request_key FROM financial_requests WHERE company_id=$1 AND request_key=$2", [companies[0], key])).toHaveLength(0);
      await send(p.token, key, "close").expect(200);
    } finally {
      await blocker.query("ROLLBACK"); blocker.release(); if (pending) await pending;
      await rows("UPDATE user_companies SET role='owner' WHERE company_id=$1 AND user_id=$2", [companies[0], users[0]]);
    }
  });
  it("serializes execution versus safe closure in both real PostgreSQL start orders", async () => {
    for (const first of ["commit", "close"]) {
      const p = await preview(doc(), 0, true), key = randomUUID(), blocker = await pool.connect();
      const lock = JSON.stringify([companies[0], users[0], "POST:/api:/customers/imports", key]);
      let a: Promise<request.Response> | undefined, b: Promise<request.Response> | undefined;
      try {
        await blocker.query("BEGIN"); await blocker.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [lock]);
        const pid = (await blocker.query("SELECT pg_backend_pid() pid")).rows[0].pid;
        a = send(p.token, key, first).then(r => r); await waiting(pid, "pg_advisory_xact_lock(hashtextextended");
        b = send(p.token, key, first === "commit" ? "close" : "commit").then(r => r);
        for (let n = 0; n < 100; n++) {
          const w = await rows("SELECT pid FROM pg_stat_activity WHERE query LIKE '%pg_advisory_xact_lock(hashtextextended%' AND wait_event_type='Lock'");
          if (w.length >= 2) break;
          await new Promise(r => setTimeout(r, 10));
          if (n === 99) throw new Error("Second contender never reached PostgreSQL");
        }
        await blocker.query("COMMIT");
        expect((await a).status).toBe(200); expect((await b).status).toBe(first === "commit" ? 200 : 409);
        expect((await send(p.token, key, "recover").expect(200)).body.state).toBe(first === "commit" ? "completed" : "closed");
      } finally { await blocker.query("ROLLBACK"); blocker.release(); await a; await b; }
    }
  });
  it("grants directory independently of invoice access, templates, and individual upper denial", async () => {
    const f = await posTemplateFixture(), person = f.people[0];
    const actions = ["sales.customers.read", "sales.customers.create"];
    const t = ok(await f.owner.post("/api/team/templates").send({ name: "دليل عملاء فقط", resource: "sales", actions }), 201);
    const update = async (old: typeof person, deniedActions: string[]) => ok(await f.owner.put(`/api/team/people/${old.personId}/access`).send({
      expectedRevision: old.revision, suspended: false, person: { ...personInput(old), loginKinds: ["platform"], deniedActions,
        grants: [{ resource: "sales", branchId: f.branches[0].id, warehouseIds: [], actions,
          amountLimit: null, startsAt: null, endsAt: null, templateId: t.id, templateRevision: 1, templateMode: "inherit" }] },
    }));
    const enabled = await update(person, []);
    const header = String(enabled.grants[0].id);
    const p = ok(await f.actors[0].post(endpoint).set("X-Workspace-Responsibility", header).send({ action: "preview", document: { headers: ["name"], rows: [["مسموح"]], mapping: { name: 0 } } }));
    expect(p.canCommit).toBe(true);
    ok(await f.actors[0].get("/api/sales/invoices").set("X-Workspace-Responsibility", header), 403);
    const denied = await update(enabled, ["sales.customers.create"]);
    ok(await f.actors[0].get(endpoint).set("X-Workspace-Responsibility", String(denied.grants[0].id)), 403);
    const listing = ok(await f.actors[0].get("/api/customers").set("X-Workspace-Responsibility", String(denied.grants[0].id)));
    expect(listing.every((c: any) => c.creditLimit === undefined && c.totalSpent === 0)).toBe(true);
    ok(await f.actors[0].post(endpoint).set("X-Workspace-Responsibility", String(denied.grants[0].id))
      .set("Idempotency-Key", randomUUID()).send({ action: "commit", token: p.token }), 403);
    // Invoice reading alone does not authorize directory import.
    const invoiceOnly = ok(await f.owner.put(`/api/team/people/${denied.personId}/access`).send({
      expectedRevision: denied.revision, suspended: false, person: { ...personInput(denied), loginKinds: ["platform"], deniedActions: [],
        grants: [{ resource: "sales", branchId: f.branches[0].id, warehouseIds: [], actions: ["sales.read"],
          amountLimit: null, startsAt: null, endsAt: null }] },
    }));
    ok(await f.actors[0].get(endpoint).set("X-Workspace-Responsibility", String(invoiceOnly.grants[0].id)), 403);
    ok(await f.actors[0].get("/api/customers").set("X-Workspace-Responsibility", String(invoiceOnly.grants[0].id)), 403);
  });
  it("honors grant expiry, suspension and an upper directory read denial without expanding roles", async () => {
    const f = await posTemplateFixture(), person = f.people[0];
    const enabled = ok(await f.owner.put(`/api/team/people/${person.personId}/access`).send({
      expectedRevision: person.revision, suspended: false, person: { ...personInput(person), loginKinds: ["platform"], deniedActions: [],
        grants: [{ resource: "sales", branchId: f.branches[0].id, warehouseIds: [],
          actions: ["sales.customers.read", "sales.customers.create"], amountLimit: null, startsAt: null, endsAt: null }] },
    }));
    const header = String(enabled.grants[0].id);
    ok(await f.actors[0].get(endpoint).set("X-Workspace-Responsibility", header));
    await rows("UPDATE responsibility_grants SET ends_at=clock_timestamp()-interval '1 second' WHERE id=$1", [enabled.grants[0].id]);
    ok(await f.actors[0].get(endpoint).set("X-Workspace-Responsibility", header), 403);
    await rows("UPDATE responsibility_grants SET ends_at=NULL WHERE id=$1", [enabled.grants[0].id]);
    await rows("UPDATE employee_access SET status='suspended' WHERE company_id=$1 AND employee_id=$2", [f.companies[0].id, person.personId]);
    ok(await f.actors[0].get(endpoint).set("X-Workspace-Responsibility", header), 403);
    await rows("UPDATE employee_access SET status='active',denied_actions=ARRAY['sales.customers.read'] WHERE company_id=$1 AND employee_id=$2", [f.companies[0].id, person.personId]);
    ok(await f.actors[0].get(endpoint).set("X-Workspace-Responsibility", header), 403);
  });
  it("does not expose hidden customer matching or recovered names after owner privacy withdrawal", async () => {
    const p = await preview(doc(), 0, true), key = randomUUID();
    await send(p.token, key).expect(200);
    await rows("UPDATE users SET admin_prefs=$1::jsonb WHERE id=$2", [JSON.stringify({ auditConsent: { customerPii: false } }), users[1]]);
    await rows("UPDATE user_companies SET role='sales' WHERE company_id=$1 AND user_id=$2", [companies[1], users[0]]);
    await agents[0].post("/api/auth/switch-company").send({ companyId: companies[1] }).expect(200);
    await agents[0].post(endpoint).send({ action: "preview", document: doc() }).expect(403);
    await agents[0].post("/api/auth/switch-company").send({ companyId: companies[0] }).expect(200);
    await rows("UPDATE users SET admin_prefs=$1::jsonb WHERE id=$2", [JSON.stringify({ auditConsent: { customerPii: false } }), users[0]]);
    await rows("UPDATE user_companies SET role='auditor' WHERE company_id=$1 AND user_id=$2", [companies[0], users[0]]);
    // Another retained owner supplies the company privacy preference.
    await db.insert(userCompaniesTable).values({ companyId: companies[0], userId: users[1], role: "owner" });
    await send(p.token, key, "recover").expect(403);
    await rows("UPDATE user_companies SET role='owner' WHERE company_id=$1 AND user_id=$2", [companies[0], users[0]]);
  });
});
