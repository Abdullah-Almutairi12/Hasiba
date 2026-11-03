import { beforeAll, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import request from "supertest";
import bcrypt from "bcryptjs";
import { db, pool, companiesTable, usersTable, userCompaniesTable, fiscalYearsTable, fiscalPeriodsTable } from "@workspace/db";
import app, { assertApplicationReady } from "../app";
import { findOrCreateSupplier } from "./suppliers";

const tag = randomUUID(), companies: number[] = [], users: number[] = [], actors: request.Agent[] = [];
const rows = async (q: string, args: unknown[] = []) => (await pool.query(q, args)).rows;
beforeAll(async () => {
  expect(new URL(process.env.TEST_DATABASE_URL!).hostname).toBe("127.0.0.1");
  await assertApplicationReady();
  const password = `synthetic-${tag}`, passwordHash = await bcrypt.hash(password, 4);
  for (let i = 0; i < 2; i++) {
    const c = (await db.insert(companiesTable).values({ name: `VAT-${tag}-${i}` }).returning())[0];
    companies.push(c.id);
    const year = new Date().getUTCFullYear();
    const [fy] = await db.insert(fiscalYearsTable).values({ companyId: c.id, name: tag,
      startDate: `${year}-01-01`, endDate: `${year}-12-31` }).returning();
    await db.insert(fiscalPeriodsTable).values({ fiscalYearId: fy.id, name: tag,
      startDate: `${year}-01-01`, endDate: `${year}-12-31`, status: "open" });
    const u = (await db.insert(usersTable).values({ name: "اختبار مورد", email: `${tag}-${i}@example.invalid`,
      passwordHash, role: "owner", isActive: true }).returning())[0];
    users.push(u.id);
    await db.insert(userCompaniesTable).values({ userId: u.id, companyId: c.id, role: "owner", isDefault: true });
    const a = request.agent(app); await a.post("/api/auth/login").send({ email: u.email, password }).expect(200);
    actors.push(a);
  }
});

describe.sequential("company-local supplier VAT identity on real PostgreSQL", () => {
  it("lets two companies independently create the same VAT and isolates search, detail, edit and invoices", async () => {
    const vatNumber = `003${tag}`;
    const a = await actors[0].post("/api/suppliers").send({ name: "مورد مشترك", vatNumber }).expect(201);
    const b = await actors[1].post("/api/suppliers").send({ name: "مورد مشترك", vatNumber }).expect(201);
    expect(a.body.id).not.toBe(b.body.id);
    for (const [i, own, foreign] of [[0, a.body, b.body], [1, b.body, a.body]] as const) {
      const list = await actors[i].get("/api/suppliers").query({ search: vatNumber, companyId: foreign.companyId }).expect(200);
      expect(list.body.map((r: { id: number }) => r.id)).toEqual([own.id]);
      await actors[i].get(`/api/suppliers/${foreign.id}`).expect(404);
      await actors[i].patch(`/api/suppliers/${foreign.id}`).send({ name: "محاولة خارج النطاق" }).expect(404);
      const [inv] = await rows(`INSERT INTO invoices(company_id,supplier_id,invoice_number,supplier_name,amount)
        VALUES($1,$2,$3,'تاريخ اصطناعي',17.25) RETURNING id`, [companies[1 - i], foreign.id, randomUUID()]);
      await actors[i].get(`/api/invoices/${inv.id}`).expect(404);
    }
  });
  it("rejects local duplicate creates and updates including concurrent requests", async () => {
    const vatNumber = `race-${tag}`;
    const replies = await Promise.all(Array.from({ length: 3 }, () =>
      actors[0].post("/api/suppliers").send({ name: "تزامن", vatNumber })));
    expect(replies.map(r => r.status).sort()).toEqual([201, 409, 409]);
    const other = await actors[0].post("/api/suppliers").send({ name: "مستقل", vatNumber: `other-${tag}` }).expect(201);
    const failed = await actors[0].patch(`/api/suppliers/${other.body.id}`).send({ vatNumber }).expect(409);
    expect(failed.body.error).toContain("الشركة");
    const original = replies.find(r => r.status === 201)!.body;
    const edits = await Promise.all([original.id, other.body.id].map(id =>
      actors[0].patch(`/api/suppliers/${id}`).send({ vatNumber: `update-${tag}` })));
    expect(edits.map(r => r.status).sort()).toEqual([200, 409]);
    expect((await rows("SELECT balance::text FROM suppliers WHERE id=ANY($1::int[])",
      [[original.id, other.body.id]])).every(r => r.balance === "0.00")).toBe(true);
  });
  it("treats absent, empty and whitespace-only VAT as absent without inferring registration", async () => {
    for (const vatNumber of [undefined, null, "", "   ", ""]) {
      const r = await actors[0].post("/api/suppliers").send({ name: "بلا دليل تسجيل", vatNumber }).expect(201);
      expect(r.body.vatNumber).toBeNull();
      const p = await actors[0].patch(`/api/suppliers/${r.body.id}`).send({ vatNumber: " " }).expect(200);
      expect(p.body.vatNumber).toBeNull();
    }
  });
  it("rejects forged company ownership on create and edit", async () => {
    await actors[0].post("/api/suppliers").send({ name: "تزوير", companyId: companies[1] }).expect(400);
    const s = await actors[0].post("/api/suppliers").send({ name: "خاص" }).expect(201);
    await actors[0].patch(`/api/suppliers/${s.body.id}`).send({ companyId: companies[1] }).expect(400);
  });
  it("matches VAT within company, never overwrites a same-name supplier and serializes find-or-create", async () => {
    const name = `اسم متشابه ${tag}`;
    const old = await actors[0].post("/api/suppliers").send({ name, vatNumber: `old-${tag}` }).expect(201);
    const original = (await rows("SELECT to_jsonb(s) value FROM suppliers s WHERE id=$1", [old.body.id]))[0].value;
    const vatNumber = `new-${tag}`;
    const ids = await Promise.all(Array.from({ length: 4 }, () => findOrCreateSupplier({ companyId: companies[0], name, vatNumber })));
    expect(new Set(ids).size).toBe(1); expect(ids[0]).not.toBe(old.body.id);
    const foreign = await findOrCreateSupplier({ companyId: companies[1], name, vatNumber });
    expect(foreign).not.toBe(ids[0]);
    const noVat = await Promise.all(Array.from({ length: 3 }, () => findOrCreateSupplier({ companyId: companies[0], name })));
    expect(new Set(noVat).size).toBe(1); expect(noVat[0]).not.toBe(old.body.id); expect(noVat[0]).not.toBe(ids[0]);
    expect((await rows("SELECT to_jsonb(s) value FROM suppliers s WHERE id=$1", [old.body.id]))[0].value).toEqual(original);
  });
  it("finds/creates suppliers on the real scan route once per company and replays financial receipts without posting twice", async () => {
    const supplierVatNumber = `scan-${tag}`, supplierName = `مورد فاتورة ${tag}`;
    const body = { supplierName, supplierVatNumber, invoiceNumber: `scan-invoice-${tag}`, subtotal: 10, vat: 0, total: 10,
      confidence: 1, addToInventory: false, postToAccounting: true,
      items: [{ description: "اختبار أصلي", quantity: 1, unitPrice: 10, total: 10 }] };
    for (const i of [0, 1]) {
      const key = randomUUID();
      const send = () => actors[i].post("/api/invoices/from-scan").set("Idempotency-Key", key).send(body);
      const pair = await Promise.all([send(), send()]);
      expect(pair.map(r => r.status)).toEqual([200, 200]);
      expect(pair[1].body).toEqual(pair[0].body);
      await send().expect(200); // response loss: original body and identifier, same committed result
      const suppliers = await rows("SELECT id,balance::text FROM suppliers WHERE company_id=$1 AND vat_number=$2", [companies[i], supplierVatNumber]);
      expect(suppliers).toHaveLength(1); expect(suppliers[0].balance).toBe("10.00");
      expect(await rows("SELECT id FROM invoices WHERE company_id=$1 AND supplier_id=$2", [companies[i], suppliers[0].id])).toHaveLength(1);
      const sums = await rows(`SELECT sum(l.debit)::text debit,sum(l.credit)::text credit,count(DISTINCT j.id)::text entries
        FROM journal_entries j JOIN journal_entry_lines l ON l.entry_id=j.id
        WHERE j.company_id=$1 AND j.source='supplier_invoice' AND j.source_ref=$2`,
      [companies[i], `INV-${body.invoiceNumber}`]);
      expect(sums[0]).toEqual({ debit: "10.00", credit: "10.00", entries: "1" });
    }
  });
  it("denies the existing open session after membership revocation, without changing supplier facts", async () => {
    const before = await rows("SELECT to_jsonb(s) value FROM suppliers s WHERE company_id=$1 ORDER BY id", [companies[1]]);
    await pool.query("DELETE FROM user_companies WHERE user_id=$1 AND company_id=$2", [users[1], companies[1]]);
    const r = await actors[1].post("/api/suppliers").send({ name: "ممنوع" });
    expect([401, 403]).toContain(r.status);
    expect([401, 403]).toContain((await actors[1].get("/api/suppliers")).status);
    expect(await rows("SELECT to_jsonb(s) value FROM suppliers s WHERE company_id=$1 ORDER BY id", [companies[1]])).toEqual(before);
  });
});
