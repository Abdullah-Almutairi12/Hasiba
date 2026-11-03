import { beforeAll, describe, it, expect, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import ExcelJS from "exceljs";
import { randomUUID } from "node:crypto";
import { db, pool, companiesTable, usersTable, userCompaniesTable } from "@workspace/db";
import app, { assertApplicationReady } from "../app";
import { type ImportDocument, signImport } from "../lib/product-import";
import { posTemplateFixture, accepted as ok, personInput } from "../test/pos-template-fixture";

const endpoint = "/api/suppliers/imports", tag = randomUUID();
const agents: request.Agent[] = [], companies: number[] = [], users: number[] = [];
const rows = async (q: string, values: unknown[] = []) => (await pool.query(q, values)).rows;
const doc = (name = `مورد ${randomUUID()}`, vat = `000${randomUUID()}`): ImportDocument => ({
  headers: ["الاسم", "الرقم الضريبي"], rows: [[name, vat]], mapping: { name: 0, vatNumber: 1 },
});
const preview = async (document = doc(), index = 0, confirmSimilarNames = false) => {
  const response = await agents[index].post(endpoint).send({ action: "preview", document, confirmSimilarNames }).expect(200);
  return response.body;
};
const send = (token: string, key = randomUUID(), action = "commit", index = 0) =>
  agents[index].post(endpoint).set("Idempotency-Key", key).send({ action, token });
const facts = async (company = companies[0]) => (await rows(
  "SELECT to_jsonb(s) value FROM suppliers s WHERE company_id=$1 ORDER BY id", [company])).map(r => r.value);
async function waiting(pid: number, needle: string) {
  for (let n = 0; n < 120; n++) {
    const result = await rows("SELECT pid FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid)) AND query ILIKE $2", [pid, `%${needle}%`]);
    if (result.length) return result[0].pid;
    await new Promise(r => setTimeout(r, 15));
  }
  throw new Error(`No actual PostgreSQL lock wait for ${needle}`);
}
beforeAll(async () => {
  expect(new URL(process.env.TEST_DATABASE_URL!).hostname).toBe("127.0.0.1");
  await assertApplicationReady();
  const password = `synthetic-${tag}`, passwordHash = await bcrypt.hash(password, 4);
  for (let i = 0; i < 2; i++) {
    const [c] = await db.insert(companiesTable).values({ name: `استيراد ${tag}-${i}` }).returning();
    companies.push(c.id);
    const [u] = await db.insert(usersTable).values({ name: "اختبار", email: `${tag}-${i}@example.invalid`, passwordHash, role: "owner", isActive: true }).returning();
    users.push(u.id);
    await db.insert(userCompaniesTable).values({ userId: u.id, companyId: c.id, role: "owner", isDefault: true });
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ email: u.email, password }).expect(200);
    agents.push(agent);
  }
});
describe.sequential("create-only supplier directory import on isolated PostgreSQL", () => {
  it.each(["اسم الشركة", "Company Name", "Supplier Company Name"])("correction: accepts natural supplier name header %s", async (header) => {
    const p = await preview({ headers: [header], rows: [[`شركة مورد ${randomUUID()}`]], mapping: { name: 0 } });
    expect(p.canCommit).toBe(true);
    const result = await send(p.token).expect(200);
    expect(result.body.accepted).toBe(1);
    expect((await rows("SELECT company_id FROM suppliers WHERE id=$1", [result.body.suppliers[0].id]))[0].company_id).toBe(companies[0]);
  });
  it.each(["companyId", "balance", "iban"])("correction: still rejects ownership or financial header %s", async (header) => {
    const before = await facts();
    expect((await preview({ headers: [header], rows: [["not allowed"]], mapping: { name: 0 } })).canCommit).toBe(false);
    expect((await preview({ headers: ["name"], rows: [["not allowed"]], mapping: { unsupportedField: 0 } })).canCommit).toBe(false);
    expect((await preview({ headers: ["name", "Company Name"], rows: [["valid name", "not a name mapping"]], mapping: { name: 0, notes: 1 } })).canCommit).toBe(false);
    expect(await facts()).toEqual(before);
  });
  it.each(["mixed", "invalid", "valid"])("correction: previews every source row independently of insertable records: %s", async (kind) => {
    const before = await facts();
    const input = { headers: ["name", "email"], rows: [
      [`أول ${tag}`, kind === "valid" ? "first@example.invalid" : "bad-email"],
      [`ثاني ${tag}`, kind === "invalid" ? "also-bad" : "second@example.invalid"],
      [`ثالث ${tag}`, kind === "valid" ? "third@example.invalid" : "bad-again"],
    ], mapping: { name: 0, email: 1 } };
    const p = await preview(input);
    expect(p.previewRows).toHaveLength(3);
    expect(p.previewRows.map((r: any) => r.row)).toEqual([2, 3, 4]);
    for (let i = 0; i < 3; i++) {
      expect(p.previewRows[i].values).toMatchObject({ name: input.rows[i][0], email: input.rows[i][1] });
      expect(p.previewRows[i].errors).toEqual(p.errors.filter((e: any) => e.row === i + 2));
      expect(p.previewRows[i].status).toBe(p.previewRows[i].errors.length ? "error" : "valid");
    }
    expect(p.suppliers).toHaveLength(kind === "valid" ? 3 : kind === "invalid" ? 0 : 1);
    expect(p.canCommit).toBe(kind === "valid");
    expect(await facts()).toEqual(before);
    if (kind === "valid") expect((await send(p.token).expect(200)).body.accepted).toBe(3);
    else expect(p.token).toBeNull();
  });
  it("uses supplier route ordering and original safe limits without creating anything in parse/preview", async () => {
    const before = await facts();
    const options = await agents[0].get(endpoint).expect(200);
    expect(options.body.required).toEqual(["name"]);
    expect(options.body.limits.bytes).toBe(262144);
    const text = '\ufeff"هاتف";"اسم";"رقم"\r\n"0500123000";"مؤسسة عربية";"000012345678901"\r\n';
    const parsed = await agents[0].post(endpoint).send({ action: "parse", fileName: "عربي.csv", base64: Buffer.from(text).toString("base64") }).expect(200);
    const reviewed = await preview({ ...parsed.body, mapping: { phone: 0, name: 1, vatNumber: 2 } });
    expect(reviewed.suppliers[0]).toMatchObject({ name: "مؤسسة عربية", phone: "0500123000", vatNumber: "000012345678901" });
    expect(reviewed.canCommit).toBe(true);
    expect(await facts()).toEqual(before);
  });
  it("imports Arabic XLSX with rearranged columns and blanks while preserving text zeroes", async () => {
    const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet("الموردون");
    sheet.addRow(["البريد", "المورد", "الرقم", "هاتف", "عنوان", "ملاحظة"]);
    sheet.addRow(["test@example.invalid", "مورد ملف إكسل", "000789012345678", "005001234", "الرياض", "ملاحظة"]);
    sheet.addRow([null, "مورد اختياري", null, null, null, null]);
    const parsed = await agents[0].post(endpoint).send({ action: "parse", fileName: "موردون.xlsx",
      base64: Buffer.from(await workbook.xlsx.writeBuffer()).toString("base64") }).expect(200);
    const p = await preview({ ...parsed.body, mapping: { email: 0, name: 1, vatNumber: 2, phone: 3, address: 4, notes: 5 } });
    expect(p.canCommit).toBe(true);
    const result = await send(p.token).expect(200);
    expect(result.body.accepted).toBe(2);
    const saved = await rows("SELECT vat_number,phone,balance::text,linked_company_id FROM suppliers WHERE id=ANY($1::int[]) ORDER BY id", [result.body.suppliers.map((s: { id: number }) => s.id)]);
    expect(saved[0]).toMatchObject({ vat_number: "000789012345678", phone: "005001234", balance: "0.00", linked_company_id: null });
    expect(saved[1].vat_number).toBeNull();
    expect(saved[1].balance).toBe("0.00");
  });
  it("rejects invalid names, email, unsupported fields, duplicate mappings and nontext identifiers without partial writes", async () => {
    const before = await facts();
    const samples: ImportDocument[] = [
      { ...doc(), rows: [["", "unique"], ["صالح", `x-${tag}`]] },
      { ...doc(), rows: [["اسم", 12345678901234567]] },
      { headers: ["name", "email"], rows: [["اسم", "not-email"]], mapping: { name: 0, email: 1 } },
      { headers: ["name", "companyId"], rows: [["اسم", "1"]], mapping: { name: 0, notes: 1 } },
      { headers: ["name", "balance"], rows: [["اسم", "100"]], mapping: { name: 0, notes: 1 } },
      { ...doc(), mapping: { name: 0, vatNumber: 0 } },
      { ...doc(), mapping: { name: 0 } },
      { ...doc(), rows: [["+SUM(1,2)", "formula-like"]] },
    ];
    for (const d of samples) {
      const p = await preview(d);
      expect(p.canCommit).toBe(false); expect(p.token).toBeNull(); expect(p.errors.length).toBeGreaterThan(0);
    }
    await agents[0].post(endpoint).send({ action: "preview", document: doc(), companyId: companies[1] }).expect(400);
    expect(await facts()).toEqual(before);
  });
  it("rejects corrupt, unsupported, formula, oversized and unsafe workbook input using shared reader", async () => {
    for (const [fileName, data] of [["x.xlsx", "broken"], ["x.json", "{}"], ["x.csv", "a\n" + "x".repeat(262144)]]) {
      await agents[0].post(endpoint).send({ action: "parse", fileName, base64: Buffer.from(data).toString("base64") }).expect(400);
    }
    const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet("بيانات");
    sheet.addRow(["name"]); sheet.addRow([{ formula: '"unsafe"', result: "value" }]);
    await agents[0].post(endpoint).send({ action: "parse", fileName: "formula.xlsx", base64: Buffer.from(await workbook.xlsx.writeBuffer()).toString("base64") }).expect(400);
    await agents[0].post(endpoint).send({ action: "preview", document: { ...doc(), rows: Array(501).fill(["اسم", null]) } }).expect(400);
  });
  it("allows company-local reuse, rejects file/existing duplicates and never updates a previous supplier", async () => {
    const d = doc(), p0 = await preview(d), p1 = await preview(d, 1);
    const before = await facts();
    const a = await send(p0.token).expect(200), b = await send(p1.token, randomUUID(), "commit", 1).expect(200);
    expect(a.body.suppliers[0].id).not.toBe(b.body.suppliers[0].id);
    const p = await preview(d); expect(p.canCommit).toBe(false);
    expect(p.errors[0].message).toContain(`#${a.body.suppliers[0].id}`);
    const duplicates = await preview({ ...doc(), rows: [["أ", "double"], ["ب", "double"]] });
    expect(duplicates.canCommit).toBe(false);
    expect((await facts()).slice(0, before.length)).toEqual(before);
  });
  it("never merges missing-VAT same names; requires explicit review tied to exact match facts", async () => {
    const name = `متشابه ${randomUUID()}`, d = doc(name, "");
    const original = await agents[0].post("/api/suppliers").send({ name, vatNumber: `old-${tag}` }).expect(201);
    const before = await facts();
    const p = await preview(d); expect(p.canCommit).toBe(false); expect(p.warnings[0].matches[0].id).toBe(original.body.id);
    const confirmed = await preview(d, 0, true); expect(confirmed.canCommit).toBe(true);
    const created = await send(confirmed.token).expect(200);
    expect(created.body.suppliers[0].id).not.toBe(original.body.id);
    expect(created.body.suppliers[0].vatNumber).toBeNull();
    expect((await facts()).slice(0, before.length)).toEqual(before);
    const stale = await preview(d, 0, true), key = randomUUID();
    await agents[0].post("/api/suppliers").send({ name }).expect(201);
    await send(stale.token, key).expect(409);
    await send(stale.token, key, "close").expect(200);
  });
  it("binds token to actor/company/purpose and refuses modified reviewed content", async () => {
    const p = await preview();
    await send(p.token, randomUUID(), "commit", 1).expect(403);
    await send(p.token.slice(0, -1) + (p.token.endsWith("a") ? "b" : "a")).expect(400);
    await agents[0].post(endpoint).set("Idempotency-Key", randomUUID()).send({ action: "commit", token: p.token, rows: [] }).expect(400);
    await send(signImport(companies[0], users[0], doc())).expect(400);
  });
  it("expires reviewed creation but permits durable safe closure and recovery after expiry", async () => {
    const p = await preview(), key = randomUUID();
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now + 901000);
    try {
      await send(p.token, key).expect(409);
      expect((await send(p.token, key, "close").expect(200)).body.state).toBe("closed");
      expect((await send(p.token, key, "recover").expect(200)).body.state).toBe("closed");
    } finally { clock.mockRestore(); }
  });
  it("saves one full batch and receipt under concurrent original attempts, recovers exact result and protects read authority", async () => {
    const d = doc(), p = await preview(d), key = randomUUID();
    const replies = await Promise.all([send(p.token, key), send(p.token, key)]);
    expect(replies.map(r => r.status)).toEqual([200, 200]);
    expect(replies[0].body).toEqual(replies[1].body);
    const recovered = await send(p.token, key, "recover").expect(200);
    expect(recovered.body).toEqual(replies[0].body);
    await send(p.token, key, "close").expect(200); // Completed work cannot be erased by closure.
    const saved = await rows("SELECT id,balance::text FROM suppliers WHERE company_id=$1 AND vat_number=$2", [companies[0], d.rows[0][1]]);
    expect(saved).toHaveLength(1); expect(saved[0].balance).toBe("0.00");
    expect((await rows("SELECT request_key FROM financial_requests WHERE company_id=$1 AND request_key=$2", [companies[0], key]))).toHaveLength(1);
    await rows("UPDATE user_companies SET role='auditor' WHERE company_id=$1 AND user_id=$2", [companies[0], users[0]]);
    await send(p.token, key, "recover").expect(200);
    await send((await preview(doc(), 1)).token, randomUUID(), "commit", 0).expect(403);
    await rows("DELETE FROM user_companies WHERE company_id=$1 AND user_id=$2", [companies[0], users[0]]);
    expect([401,403]).toContain((await send(p.token, key, "recover")).status);
    await db.insert(userCompaniesTable).values({ companyId: companies[0], userId: users[0], role: "owner", isDefault: true });
  });
  it("durably closes rejected work and refuses delayed original execution or reuse of its key", async () => {
    const d = doc(), p = await preview(d), key = randomUUID();
    await agents[0].post("/api/suppliers").send({ name: "تعارض", vatNumber: d.rows[0][1] }).expect(201);
    await send(p.token, key).expect(409);
    await send(p.token, key, "recover").expect(409);
    const closed = await send(p.token, key, "close").expect(200); expect(closed.body.state).toBe("closed");
    await send(p.token, key).expect(409);
    const changed = await preview();
    await send(changed.token, key).expect(409);
    const result = await send(changed.token, randomUUID()).expect(200); expect(result.body.accepted).toBe(1);
  });
  it("rechecks authority after an actual PostgreSQL lock wait", async () => {
    const d = doc(), p = await preview(d), key = randomUUID(), blocker = await pool.connect();
    let pending: Promise<request.Response> | undefined;
    try {
      await blocker.query("BEGIN"); await blocker.query("LOCK TABLE suppliers IN SHARE MODE");
      const pid = (await blocker.query("SELECT pg_backend_pid() pid")).rows[0].pid;
      pending = send(p.token, key).then(r => r);
      await waiting(pid, "LOCK TABLE suppliers");
      // Revocation uses its own real transaction and the original writer fence.
      const admin = await pool.connect();
      try {
        await admin.query("BEGIN"); await admin.query("SELECT pg_advisory_xact_lock(174223,35)");
        await admin.query("UPDATE user_companies SET role='auditor' WHERE company_id=$1 AND user_id=$2", [companies[0], users[0]]);
        await admin.query("COMMIT");
      } finally { admin.release(); }
      await blocker.query("COMMIT");
      expect((await pending).status).toBe(403);
      expect(await rows("SELECT id FROM suppliers WHERE company_id=$1 AND vat_number=$2", [companies[0], d.rows[0][1]])).toHaveLength(0);
    } finally {
      await blocker.query("ROLLBACK"); blocker.release(); if (pending) await pending;
      await rows("UPDATE user_companies SET role='owner' WHERE company_id=$1 AND user_id=$2", [companies[0], users[0]]);
    }
  });
  it.each(["create", "edit"])("rejects entire import after a concurrent original supplier %s wins", async kind => {
    const d = doc(), p = await preview(d), key = randomUUID();
    const original = kind === "edit" ? await agents[0].post("/api/suppliers").send({ name: "سابق" }).expect(201) : null;
    const blocker = await pool.connect(); let writer: Promise<request.Response> | undefined, pending: Promise<request.Response> | undefined;
    try {
      await blocker.query("BEGIN"); await blocker.query("LOCK TABLE suppliers IN SHARE MODE");
      const pid = (await blocker.query("SELECT pg_backend_pid() pid")).rows[0].pid;
      writer = (kind === "create" ? agents[0].post("/api/suppliers").send({ name: "متزامن", vatNumber: d.rows[0][1] })
        : agents[0].patch(`/api/suppliers/${original!.body.id}`).send({ vatNumber: d.rows[0][1] })).then(r => r);
      await waiting(pid, kind === "create" ? 'insert into "suppliers"' : 'update "suppliers"');
      pending = send(p.token, key).then(r => r); await waiting(pid, "LOCK TABLE suppliers");
      await blocker.query("COMMIT");
      expect((await writer).status).toBe(kind === "create" ? 201 : 200);
      expect((await pending).status).toBe(409);
      expect(await rows("SELECT id FROM suppliers WHERE company_id=$1 AND vat_number=$2", [companies[0], d.rows[0][1]])).toHaveLength(1);
      await send(p.token, key, "close").expect(200);
    } finally { await blocker.query("ROLLBACK"); blocker.release(); await writer; await pending; }
  });
  it("does not wait on a queued authority writer while holding the supplier relation lock", async () => {
    const p = await preview(), key = randomUUID(), admin = await pool.connect();
    try {
      await admin.query("BEGIN");
      await admin.query("SELECT pg_advisory_xact_lock(174223,35)");
      const response = await send(p.token, key);
      expect(response.status).toBe(409);
      expect(response.body.error).toContain("للصلاحيات");
      expect(await rows("SELECT request_key FROM financial_requests WHERE company_id=$1 AND request_key=$2", [companies[0], key])).toHaveLength(0);
      await admin.query("COMMIT");
      const recovered = await send(p.token, key, "recover").expect(409);
      expect(recovered.body.error).toContain("لا توجد نتيجة");
      await send(p.token, key, "close").expect(200);
    } finally { await admin.query("ROLLBACK"); admin.release(); }
  });
  it("serializes closure versus execution in both PostgreSQL start orders", async () => {
    for (const first of ["commit", "close"]) {
      const p = await preview(), key = randomUUID(), blocker = await pool.connect();
      const operation = "POST:/api:/suppliers/imports";
      const lock = JSON.stringify([companies[0], users[0], operation, key]);
      let a: Promise<request.Response> | undefined, b: Promise<request.Response> | undefined;
      try {
        await blocker.query("BEGIN"); await blocker.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [lock]);
        const pid = (await blocker.query("SELECT pg_backend_pid() pid")).rows[0].pid;
        a = send(p.token, key, first).then(r => r); await waiting(pid, "pg_advisory_xact_lock(hashtextextended");
        b = send(p.token, key, first === "commit" ? "close" : "commit").then(r => r);
        for (let n=0;n<100;n++) {
          const w = await rows("SELECT pid FROM pg_stat_activity WHERE query LIKE '%pg_advisory_xact_lock(hashtextextended%' AND wait_event_type='Lock'");
          if (w.length>=2) break; await new Promise(r=>setTimeout(r,10));
          if (n===99) throw new Error("Second contender did not reach PostgreSQL barrier");
        }
        await blocker.query("COMMIT");
        const x = await a, y = await b;
        expect(x.status).toBe(200); expect(y.status).toBe(first === "commit" ? 200 : 409);
        const result = await send(p.token, key, "recover").expect(200);
        expect(result.body.state).toBe(first === "commit" ? "completed" : "closed");
      } finally { await blocker.query("ROLLBACK"); blocker.release(); await a; await b; }
    }
  });
  it("enforces managed grants, template inheritance and an individual upper denial on original import routes", async () => {
    const f = await posTemplateFixture(), person = f.people[0];
    const actions = ["procurement.read", "procurement.suppliers.read", "procurement.suppliers.create"];
    const t = ok(await f.owner.post("/api/team/templates").send({ name: "استيراد دليل فقط", resource: "procurement", actions }), 201);
    const update = async (old: typeof person, deniedActions: string[]) => ok(await f.owner.put(`/api/team/people/${old.personId}/access`).send({
      expectedRevision: old.revision, suspended: false, person: { ...personInput(old), loginKinds: ["platform"], deniedActions,
        grants: [{ resource: "procurement", branchId: f.branches[0].id, warehouseIds: [], actions, amountLimit: "100",
          startsAt: null, endsAt: null, templateId: t.id, templateRevision: 1, templateMode: "inherit" }] },
    }));
    const enabled = await update(person, []);
    const selected = () => f.actors[0].post(endpoint).set("X-Workspace-Responsibility", String(enabled.grants[0].id));
    const p = ok(await selected().send({ action: "preview", document: doc() }));
    expect(p.canCommit).toBe(true);
    const denied = await update(enabled, ["procurement.suppliers.create"]);
    ok(await f.actors[0].get(endpoint).set("X-Workspace-Responsibility", String(denied.grants[0].id)), 403);
    ok(await f.actors[0].post(endpoint).set("X-Workspace-Responsibility", String(denied.grants[0].id))
      .set("Idempotency-Key", randomUUID()).send({ action: "commit", token: p.token }), 403);
    ok(await f.actors[0].get("/api/suppliers").set("X-Workspace-Responsibility", String(denied.grants[0].id)));
  });
});
