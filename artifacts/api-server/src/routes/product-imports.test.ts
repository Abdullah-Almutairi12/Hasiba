import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import ExcelJS from "exceljs";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, companiesTable, usersTable, userCompaniesTable, productsTable, categoriesTable, financialRequestsTable, auditLogsTable } from "@workspace/db";
import app, { assertApplicationReady } from "../app";
import { IMPORT_FIELDS, signImport, type ImportDocument } from "../lib/product-import";
import { lockApprovalAuthorityWrite } from "../lib/approval-authority";

const tag = `catalog-${Date.now()}`, password = `synthetic-${tag}`;
const companies: number[] = [], users: number[] = [], agents: request.Agent[] = [];
let category = 0, serial = 0;
const path = "/api/products/imports";
beforeAll(async () => {
  expect(new URL(process.env.TEST_DATABASE_URL!).hostname).toBe("127.0.0.1");
  await assertApplicationReady();
  category = (await db.insert(categoriesTable).values({ name: tag, nameAr: "تصنيف اختبار اصطناعي" }).returning())[0].id;
  const passwordHash = await bcrypt.hash(password, 4);
  for (let i = 0; i < 3; i++) {
    if (i < 2) companies.push((await db.insert(companiesTable).values({ name: `${tag}-${i}` }).returning())[0].id);
    const role = i === 2 ? "cashier" : "owner";
    const user = (await db.insert(usersTable).values({ name: "مستخدم اختبار", email: `${tag}-${i}@test.local`, passwordHash, role, isActive: true }).returning())[0];
    users.push(user.id);
    await db.insert(userCompaniesTable).values({ userId: user.id, companyId: companies[i === 1 ? 1 : 0], role, isDefault: true });
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ email: user.email, password }).expect(200);
    agents.push(agent);
  }
});
afterAll(async () => {
  await db.delete(financialRequestsTable).where(inArray(financialRequestsTable.companyId, companies));
  await db.delete(auditLogsTable).where(inArray(auditLogsTable.companyId, companies));
  await db.delete(productsTable).where(inArray(productsTable.companyId, companies));
  await db.delete(userCompaniesTable).where(inArray(userCompaniesTable.userId, users));
  await db.delete(usersTable).where(inArray(usersTable.id, users));
  await db.delete(companiesTable).where(inArray(companiesTable.id, companies));
  await db.delete(categoriesTable).where(eq(categoriesTable.id, category));
});
function document(): ImportDocument {
  const code = `000${tag}-${++serial}`;
  return { headers: [...IMPORT_FIELDS], mapping: Object.fromEntries(IMPORT_FIELDS.map((f, i) => [f, i])),
    rows: [["قهوة عربية", "Arabic coffee", code, category, "12.30", "4.56", "قطعة", `00${code}`]] };
}
const send = (action: string, token: string, key: string, agent = agents[0]) => agent.post(path).set("Idempotency-Key", key).send({ action, token });
async function reviewed(doc = document()) {
  const r = await agents[0].post(path).send({ action: "preview", document: doc }).expect(200);
  expect(r.body.errors).toEqual([]); expect(r.body.canCommit).toBe(true);
  return { doc, token: r.body.token as string, key: `${tag}-request-${++serial}` };
}
async function counts() {
  return (await db.execute(sql`SELECT
    (SELECT count(*) FROM stock_moves)::text AS moves,
    (SELECT count(*) FROM stock_quants)::text AS quants,
    (SELECT count(*) FROM stock_layers)::text AS layers,
    (SELECT count(*) FROM journal_entries)::text AS journals,
    (SELECT count(*) FROM journal_entry_lines)::text AS lines`)).rows[0];
}
async function upload(name: string, bytes: Uint8Array) {
  return agents[0].post(path).send({ action: "parse", fileName: name, base64: Buffer.from(bytes).toString("base64") });
}
describe("basic catalogue import: original products, atomic receipts and tenant safety", () => {
  it("requires authentication and existing catalogue-create authority", async () => {
    await request(app).get(path).expect(401);
    await agents[2].get(path).expect(403);
    const r = await agents[0].get(path).expect(200);
    expect(r.body.atomic).toBe(true); expect(r.body.defaults.stock).toBe(0);
  });
  it("parses Arabic UTF8 CSV and preserves literal leading zeros without preview writes", async () => {
    const doc = document(), before = await db.select().from(productsTable).where(eq(productsTable.companyId, companies[0]));
    const parsed = await upload("عربي.csv", Buffer.from("\uFEFF" + [doc.headers, ...doc.rows].map(row => row.join(",")).join("\r\n")));
    expect(parsed.status).toBe(200); expect(parsed.body.rows[0][2]).toBe(doc.rows[0][2]);
    expect(parsed.body.rows[0][7]).toBe(doc.rows[0][7]); await reviewed({ ...parsed.body, mapping: doc.mapping });
    expect(await db.select().from(productsTable).where(eq(productsTable.companyId, companies[0]))).toEqual(before);
  });
  it("commits a valid XLSX atomically, preserving exact prices, names and text codes; creates no stock or GL", async () => {
    const doc = document(), book = new ExcelJS.Workbook(); book.addWorksheet("أصناف").addRows([doc.headers, ...doc.rows]);
    const parsed = await upload("أصناف.xlsx", new Uint8Array(await book.xlsx.writeBuffer()));
    expect(parsed.status).toBe(200);
    const r = await reviewed({ ...parsed.body, mapping: doc.mapping }), before = await counts();
    const saved = await send("commit", r.token, r.key).expect(200);
    expect(saved.body.state).toBe("completed"); expect(saved.body.accepted).toBe(1);
    const [p] = await db.select().from(productsTable).where(eq(productsTable.id, saved.body.products[0].id));
    expect(p).toMatchObject({ companyId: companies[0], nameAr: "قهوة عربية", sku: doc.rows[0][2], barcode: doc.rows[0][7], price: "12.30", costPrice: "4.56", stock: "0.0000", trackingMode: "none" });
    expect(await counts()).toEqual(before);
  });
  it.each([",", ";"])("parses, maps, previews and commits quoted-punctuation CSV (%s) without stock or GL", async sep => {
    const doc = document(), other = sep === "," ? ";" : ",";
    doc.headers[0] = `الاسم${other} العربي${other} حسب${other} المورد${other.repeat(8)}`;
    doc.rows[0][0] = `قهوة "${other}عربية"\nحسب المورد`;
    const encode = (value: unknown) => `"${String(value).replace(/"/g, '""')}"`;
    const csv = [doc.headers, ...doc.rows].map(row => row.map(encode).join(sep)).join("\r\n");
    const initial = await db.select().from(productsTable).where(eq(productsTable.companyId, companies[0]));
    const protectedBefore = await counts();
    const parsed = await upload("quoted.csv", Buffer.from(csv));
    expect(parsed.status).toBe(200);
    expect(parsed.body).toEqual({ headers: doc.headers, rows: doc.rows.map(row => row.map(String)) });
    const r = await reviewed({ ...parsed.body, mapping: doc.mapping });
    expect(await db.select().from(productsTable).where(eq(productsTable.companyId, companies[0]))).toEqual(initial);
    expect(await counts()).toEqual(protectedBefore);
    const saved = await send("commit", r.token, r.key).expect(200);
    expect(saved.body.accepted).toBe(1);
    const [p] = await db.select().from(productsTable).where(eq(productsTable.id, saved.body.products[0].id));
    expect(p).toMatchObject({ nameAr: doc.rows[0][0], name: doc.rows[0][1], sku: doc.rows[0][2],
      barcode: doc.rows[0][7], companyId: companies[0], price: "12.30", costPrice: "4.56", stock: "0.0000" });
    expect(await counts()).toEqual(protectedBefore);
    expect((await send("recover", r.token, r.key).expect(200)).body).toEqual(saved.body);
    expect(await db.select().from(productsTable).where(eq(productsTable.companyId, companies[0]))).toHaveLength(initial.length + 1);
    expect(await counts()).toEqual(protectedBefore);
  });
  it("rejects numeric spreadsheet codes instead of guessing lost zeroes", async () => {
    const doc = document(); doc.rows[0][2] = 123;
    const r = await agents[0].post(path).send({ action: "preview", document: doc }).expect(200);
    expect(r.body.canCommit).toBe(false); expect(r.body.errors.some((e: { field: string }) => e.field === "sku")).toBe(true);
  });
  it.each(["bad.json", "bad.xls", "bad.exe"])("rejects unsupported extension %s", async name => {
    expect((await upload(name, Buffer.from("a,b\nc,d"))).status).toBe(400);
  });
  it("rejects malformed UTF8, oversized files and malformed CSV quotes", async () => {
    expect((await upload("a.csv", Buffer.from([255, 255]))).status).toBe(400);
    expect((await upload("a.csv", Buffer.alloc(262145, 65))).status).toBe(400);
    expect((await upload("a.csv", Buffer.from('a,b\n"bad'))).status).toBe(400);
  });
  it("rejects formulas and multiple XLSX worksheets", async () => {
    const book = new ExcelJS.Workbook(); book.addWorksheet("أصناف").getCell("A1").value = { formula: "1+1", result: 2 };
    expect((await upload("f.xlsx", new Uint8Array(await book.xlsx.writeBuffer()))).status).toBe(400);
    const many = new ExcelJS.Workbook(); many.addWorksheet("one"); many.addWorksheet("two");
    expect((await upload("f.xlsx", new Uint8Array(await many.xlsx.writeBuffer()))).status).toBe(400);
  });
  it("bounds inflated XLSX entries and signed preview transport size", async () => {
    const book = new ExcelJS.Workbook();
    book.addWorksheet("one").getCell("A1").value = "a".repeat(4 * 1024 * 1024 + 1);
    const bytes = new Uint8Array(await book.xlsx.writeBuffer());
    expect(bytes.byteLength).toBeLessThan(262144);
    expect((await upload("compressed.xlsx", bytes)).status).toBe(400);
    const doc = document();
    doc.rows = Array.from({ length: 500 }, () => Array.from({ length: 8 }, () => "أ".repeat(128)));
    expect(() => signImport(companies[0], users[0], doc)).toThrow(/450000/);
  });
  it("rejects missing fields, invalid units, money, categories and unsupported stock columns", async () => {
    const doc = document(); doc.rows[0][0] = ""; doc.rows[0][3] = -1; doc.rows[0][4] = "-0.01"; doc.rows[0][6] = "unknown";
    doc.headers.push("stock"); doc.rows[0].push("100");
    const r = await agents[0].post(path).send({ action: "preview", document: doc }).expect(200);
    expect(r.body.token).toBeNull(); expect(r.body.canCommit).toBe(false);
    expect(r.body.errors.length).toBeGreaterThanOrEqual(5);
  });
  it("reports all duplicates, but does not match by product name", async () => {
    const doc = document(); doc.rows.push([...doc.rows[0]]);
    const r = await agents[0].post(path).send({ action: "preview", document: doc }).expect(200);
    expect(r.body.errors.filter((e: { row: number }) => e.row === 3).length).toBe(2);
    const different = document(); different.rows.push(document().rows[0]);
    expect((await reviewed(different)).token).toBeTruthy();
  });
  it("recovers a deliberately ignored committed response with exactly the original saved IDs and one audit", async () => {
    const auditWhere = and(eq(auditLogsTable.companyId, companies[0]), eq(auditLogsTable.action, "product_import.committed"));
    const beforeAudit = (await db.select().from(auditLogsTable).where(auditWhere)).length;
    const r = await reviewed(); const committed = await send("commit", r.token, r.key).expect(200);
    const recovered = await send("recover", r.token, r.key).expect(200);
    expect(recovered.body).toEqual(committed.body); expect(recovered.headers["idempotency-replayed"]).toBe("true");
    const rows = await db.select().from(productsTable).where(and(eq(productsTable.companyId, companies[0]), eq(productsTable.sku, String(r.doc.rows[0][2]))));
    expect(rows).toHaveLength(1);
    expect((await send("close", r.token, r.key).expect(200)).body).toEqual(committed.body);
    expect((await db.select().from(auditLogsTable).where(auditWhere)).length).toBe(beforeAudit + 1);
  });
  it("serializes simultaneous same-key commits and competing new-key copies", async () => {
    const r = await reviewed();
    const same = await Promise.all([send("commit", r.token, r.key), send("commit", r.token, r.key)]);
    expect(same.map(x => x.status)).toEqual([200, 200]); expect(same[0].body).toEqual(same[1].body);
    const next = await reviewed();
    const competing = await Promise.all([send("commit", next.token, next.key), send("commit", next.token, next.key + "-other")]);
    expect(competing.map(x => x.status).sort()).toEqual([200, 409]);
  });
  it("safely closes an absent intent and rejects a delayed original without product writes", async () => {
    const r = await reviewed();
    await send("recover", r.token, r.key).expect(409);
    expect((await send("close", r.token, r.key).expect(200)).body.state).toBe("closed");
    await send("commit", r.token, r.key).expect(409);
    expect((await db.select().from(productsTable).where(eq(productsTable.sku, String(r.doc.rows[0][2]))))).toHaveLength(0);
  });
  it.each(["commit-first", "close-first"])("serializes execution and closure with actual PostgreSQL barriers: %s", async order => {
    const r = await reviewed(), before = await counts();
    let executing: Promise<request.Response> | undefined, closing: Promise<request.Response> | undefined;
    await db.transaction(async tx => {
      if (order === "commit-first") await tx.execute(sql`LOCK TABLE products IN SHARE ROW EXCLUSIVE MODE`);
      else await lockApprovalAuthorityWrite(tx);
      if (order === "commit-first") executing = send("commit", r.token, r.key).then(x => x);
      else closing = send("close", r.token, r.key).then(x => x);
      let observed = false;
      for (let i = 0; i < 100; i++) {
        const rows = order === "commit-first"
          ? await db.execute(sql`SELECT pid FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'LOCK TABLE products%'`)
          : await db.execute(sql`SELECT pid FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%pg_advisory_xact_lock_shared%'`);
        if (rows.rows.length) { observed = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(observed).toBe(true);
      if (order === "commit-first") closing = send("close", r.token, r.key).then(x => x);
      else executing = send("commit", r.token, r.key).then(x => x);
      // Do not await a receipt/fence waiter while retaining its blocker.
    });
    const [execution, closure] = await Promise.all([executing!, closing!]);
    expect(execution.status).toBe(order === "commit-first" ? 200 : 409);
    expect(closure.status).toBe(200);
    expect(closure.body.state).toBe(order === "commit-first" ? "completed" : "closed");
    const records = await db.select().from(productsTable).where(eq(productsTable.sku, String(r.doc.rows[0][2])));
    expect(records).toHaveLength(order === "commit-first" ? 1 : 0);
    expect(await counts()).toEqual(before);
    console.info("[catalog-import-barrier]", { order, execution: execution.status, closure: closure.body.state, records: records.length, financialAndStockUnchanged: true });
  });
  it("reimport and changed facts cannot update an existing catalogue item", async () => {
    const r = await reviewed(); await send("commit", r.token, r.key).expect(200);
    const check = await agents[0].post(path).send({ action: "preview", document: r.doc }).expect(200);
    expect(check.body.canCommit).toBe(false);
    await send("commit", r.token, r.key + "-again").expect(409);
  });
  it("binds previews and receipts to both company and actor, without trusting companyId from clients", async () => {
    const r = await reviewed();
    await send("commit", r.token, r.key, agents[1]).expect(403);
    await agents[0].post(path).send({ action: "preview", document: r.doc, companyId: companies[1] }).expect(400);
    await send("commit", r.token, r.key).expect(200);
    await send("recover", r.token, r.key, agents[1]).expect(409);
  });
  it("rejects forged previews and reuse of a key with changed facts", async () => {
    const r = await reviewed(); await send("commit", r.token + "a", r.key).expect(400);
    await send("commit", r.token, r.key).expect(200);
    const next = await reviewed(); await send("commit", next.token, r.key).expect(409);
  });
  it("preserves recovery after execution permission is revoked, but denies after membership is removed", async () => {
    const saved = await reviewed(); await send("commit", saved.token, saved.key).expect(200);
    const pending = await reviewed();
    await db.update(userCompaniesTable).set({ role: "cashier" }).where(eq(userCompaniesTable.userId, users[0]));
    await send("commit", pending.token, pending.key).expect(403);
    await send("recover", saved.token, saved.key).expect(200);
    await db.delete(userCompaniesTable).where(eq(userCompaniesTable.userId, users[0]));
    await send("recover", saved.token, saved.key).expect(403);
    await db.insert(userCompaniesTable).values({ userId: users[0], companyId: companies[0], role: "owner", isDefault: true });
  });
  it("orders an already-authorized execution before revocation without deadlocking the real PostgreSQL fences", async () => {
    const r = await reviewed(), later = await reviewed();
    let pending: Promise<request.Response> | undefined, revoking: Promise<unknown> | undefined;
    await db.transaction(async tx => {
      await tx.execute(sql`LOCK TABLE products IN SHARE ROW EXCLUSIVE MODE`);
      pending = send("commit", r.token, r.key).then(x => x);
      let waiting = false;
      for (let i = 0; i < 100; i++) {
        const rows = await db.execute(sql`SELECT pid FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'LOCK TABLE products%' AND pid<>pg_backend_pid()`);
        if (rows.rows.length) { waiting = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      // The existing trigger serializes membership writers at the authority
      // fence. Awaiting that writer here would manufacture an application-level
      // cycle: blocker -> writer -> execution -> blocker.
      revoking = db.update(userCompaniesTable).set({ role: "cashier" })
        .where(eq(userCompaniesTable.userId, users[0])).then(x => x);
    });
    expect((await pending!).status).toBe(200); await revoking!;
    await send("commit", later.token, later.key).expect(403);
    console.info("[catalog-import-barrier] execution-first: relation wait observed; one commit, then revocation, subsequent execution denied");
    await db.update(userCompaniesTable).set({ role: "owner" }).where(eq(userCompaniesTable.userId, users[0]));
  });
  it("denies execution after a revocation that wins the PostgreSQL authority fence", async () => {
    const r = await reviewed(); let pending: Promise<request.Response> | undefined;
    await db.transaction(async tx => {
      await lockApprovalAuthorityWrite(tx);
      pending = send("commit", r.token, r.key).then(x => x);
      let waiting = false;
      for (let i = 0; i < 100; i++) {
        const rows = await db.execute(sql`SELECT pid FROM pg_stat_activity WHERE wait_event_type='Lock'
          AND query LIKE '%pg_advisory_xact_lock_shared%' AND pid<>pg_backend_pid()`);
        if (rows.rows.length) { waiting = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      await tx.update(userCompaniesTable).set({ role: "cashier" }).where(eq(userCompaniesTable.userId, users[0]));
    });
    expect((await pending!).status).toBe(403);
    expect(await db.select().from(productsTable).where(eq(productsTable.sku, String(r.doc.rows[0][2])))).toHaveLength(0);
    console.info("[catalog-import-barrier] revocation-first: advisory wait observed; zero catalogue execution");
    await db.update(userCompaniesTable).set({ role: "owner" }).where(eq(userCompaniesTable.userId, users[0]));
  });
  it("rejects expired fresh previews without touching financial or stock tables", async () => {
    const doc = document(), before = await counts();
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() - 1000000);
    const token = signImport(companies[0], users[0], doc); clock.mockRestore();
    await send("commit", token, `${tag}-expired`).expect(409);
    expect(await counts()).toEqual(before);
  });
});
