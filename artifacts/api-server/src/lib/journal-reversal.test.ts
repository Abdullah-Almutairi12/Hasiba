import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { and, eq, inArray } from "drizzle-orm";
import {
  db, pool, accountsTable, companiesTable, usersTable, userCompaniesTable,
  fiscalYearsTable, fiscalPeriodsTable, journalEntriesTable, journalEntryLinesTable,
  auditLogsTable,
} from "@workspace/db";
import app, { assertApplicationReady } from "../app";
import { seedCompanyFiscalCalendar } from "./fiscal-calendar";
import { postJournalEntry, reverseJournalEntry } from "./journal-posting";

const tag = `journal-reversal-${Date.now()}`;
const today = new Date().toISOString().slice(0, 10);
const companies: number[] = [];
const users: number[] = [];
const agents: request.Agent[] = [];
let bankId: number;
let revenueId: number;

beforeAll(async () => {
  await assertApplicationReady();
  const accounts = await db.select().from(accountsTable);
  bankId = accounts.find((a) => a.systemKey === "bank")!.id;
  revenueId = accounts.find((a) => a.type === "revenue" && !a.isGroup)!.id;
  const passwordHash = await bcrypt.hash("SyntheticReverse123!", 4);
  for (let n = 0; n < 2; n++) {
    const [company] = await db.insert(companiesTable).values({ name: `${tag}-${n}` }).returning();
    companies.push(company.id);
    await seedCompanyFiscalCalendar(company.id);
    const [user] = await db.insert(usersTable).values({
      name: `${tag}-${n}`, email: `${tag}-${n}@test.local`,
      passwordHash, role: "owner", isActive: true,
    }).returning();
    users.push(user.id);
    await db.insert(userCompaniesTable).values({
      companyId: company.id, userId: user.id, role: "owner", isDefault: true,
    });
    const agent = request.agent(app);
    await agent.post("/api/auth/login")
      .send({ email: user.email, password: "SyntheticReverse123!" }).expect(200);
    agents.push(agent);
  }
});

afterAll(async () => {
  if (!companies.length) return;
  await db.delete(journalEntriesTable).where(inArray(journalEntriesTable.companyId, companies));
  await db.delete(fiscalYearsTable).where(inArray(fiscalYearsTable.companyId, companies));
  if (users.length) {
    await db.delete(auditLogsTable).where(inArray(auditLogsTable.userId, users));
    await db.delete(usersTable).where(inArray(usersTable.id, users));
  }
  await db.delete(companiesTable).where(inArray(companiesTable.id, companies));
});

async function original(company = 0) {
  return db.transaction((tx) => postJournalEntry(tx, {
    companyId: companies[company], entryDate: today, description: tag,
    // Distinct transaction/base amounts prove historical FX is swapped exactly.
    currencyCode: "SAR", exchangeRate: 3.75, createdBy: users[company],
  }, [
    { accountId: bankId, debit: 80 },
    { accountId: revenueId, credit: 80 },
  ]));
}

async function entry(id: number) {
  const [row] = await db.select().from(journalEntriesTable).where(eq(journalEntriesTable.id, id));
  return row;
}
async function reversals(id: number) {
  return db.select().from(journalEntriesTable).where(eq(journalEntriesTable.reversalOf, id));
}
const reverse = (id: number, company = 0) => agents[company]
  .post(`/api/accounting/journal-entries/${id}/reverse`).send({ reason: "Synthetic correction" });

describe("atomic journal reversal on disposable PostgreSQL", () => {
  it("serializes two simultaneous HTTP requests and rejects a later reversal without changing GL", async () => {
    const orig = await original();
    // Hold the target row until BOTH HTTP handlers reach their row lock.
    // This proves overlap rather than relying on Promise scheduling.
    const blocker = await pool.connect();
    let pending: Array<Promise<request.Response>> = [];
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT id FROM journal_entries WHERE id=$1 FOR UPDATE", [orig.id]);
      pending = [reverse(orig.id).then((r) => r), reverse(orig.id).then((r) => r)];
      await expect.poll(async () => {
        const { rows } = await pool.query(`
          SELECT count(*)::int AS n FROM pg_stat_activity
           WHERE datname=current_database() AND wait_event_type='Lock'
             AND query ILIKE '%journal_entries%' AND query ILIKE '%for update%'
        `);
        return rows[0].n;
      }, { timeout: 5000 }).toBeGreaterThanOrEqual(2);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
    }
    const responses = await Promise.all(pending);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    const [rev] = await reversals(orig.id);
    expect(await reversals(orig.id)).toHaveLength(1);
    expect(responses.find((r) => r.status === 200)!.body.id).toBe(rev.id);
    expect(rev.companyId).toBe(companies[0]);
    expect(rev.status).toBe("posted");
    expect(rev.exchangeRate).toBe("3.75000000");
    const saved = await entry(orig.id);
    expect(saved.status).toBe("posted");
    expect(saved.reversedAt).toBeInstanceOf(Date);
    expect(saved.reversedBy).toBe(users[0]);
    const lines = await db.select().from(journalEntryLinesTable)
      .where(inArray(journalEntryLinesTable.entryId, [orig.id, rev.id]));
    expect(lines).toHaveLength(4);
    for (const accountId of [bankId, revenueId]) {
      const pair = lines.filter((l) => l.accountId === accountId);
      expect(pair.reduce((sum, l) => sum + Number(l.debit) - Number(l.credit), 0)).toBe(0);
      expect(pair.reduce((sum, l) => sum + Number(l.baseDebit) - Number(l.baseCredit), 0)).toBe(0);
    }
    const ledger = await agents[0].get(`/api/reports/general-ledger/${bankId}`).expect(200);
    expect(ledger.body.lines).toHaveLength(2);
    expect(ledger.body.closingBalance).toBe(0);
    await reverse(orig.id).expect(409);
    expect(await entry(orig.id)).toEqual(saved);
    expect(await reversals(orig.id)).toHaveLength(1);
    const after = await agents[0].get(`/api/reports/general-ledger/${bankId}`).expect(200);
    expect(after.body).toEqual(ledger.body);
  });

  it("protects direct database callers as well as callers inside an outer transaction", async () => {
    const orig = await original();
    const results = await Promise.allSettled([
      reverseJournalEntry(db, orig.id, users[0], companies[0]),
      db.transaction((tx) => reverseJournalEntry(tx, orig.id, users[0], companies[0])),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(await reversals(orig.id)).toHaveLength(1);
    expect((await entry(orig.id)).status).toBe("posted");
  });

  it("refuses either legacy evidence of reversal without repairing history", async () => {
    const marked = await original();
    await db.update(journalEntriesTable).set({ reversedAt: new Date(), reversedBy: users[0] })
      .where(eq(journalEntriesTable.id, marked.id));
    await reverse(marked.id).expect(409);
    expect(await reversals(marked.id)).toHaveLength(0);

    const linked = await original();
    await reverse(linked.id).expect(200);
    // Simulate old incomplete metadata while retaining the counter-entry.
    await db.update(journalEntriesTable).set({ reversedAt: null, reversedBy: null })
      .where(eq(journalEntriesTable.id, linked.id));
    await reverse(linked.id).expect(409);
    expect(await reversals(linked.id)).toHaveLength(1);
    expect((await entry(linked.id)).reversedAt).toBeNull();
  });

  it("rejects closed and locked periods atomically, then permits a retry after reopening", async () => {
    const orig = await original();
    const before = await entry(orig.id);
    for (const status of ["closed", "locked"]) {
      await db.update(fiscalPeriodsTable).set({ status })
        .where(eq(fiscalPeriodsTable.id, before.periodId!));
      try {
        await reverse(orig.id).expect(403);
        expect(await entry(orig.id)).toEqual(before);
        expect(await reversals(orig.id)).toHaveLength(0);
      } finally {
        await db.update(fiscalPeriodsTable).set({ status: "open" })
          .where(eq(fiscalPeriodsTable.id, before.periodId!));
      }
    }
    await reverse(orig.id).expect(200);
    expect(await reversals(orig.id)).toHaveLength(1);
  });

  it("enforces company scope at HTTP and shared-helper boundaries", async () => {
    const foreign = await original(1);
    const before = await entry(foreign.id);
    await reverse(foreign.id).expect(404);
    await expect(reverseJournalEntry(db, foreign.id, users[0], companies[0]))
      .rejects.toThrow("القيد غير موجود");
    expect(await entry(foreign.id)).toEqual(before);
    expect(await reversals(foreign.id)).toHaveLength(0);
    await reverse(foreign.id, 1).expect(200);
    const [rev] = await reversals(foreign.id);
    expect(rev.companyId).toBe(companies[1]);
    const own = await db.select().from(journalEntriesTable).where(and(
      eq(journalEntriesTable.companyId, companies[0]),
      eq(journalEntriesTable.reversalOf, foreign.id),
    ));
    expect(own).toHaveLength(0);
  });

  it("does not reverse drafts and rolls back a reversal when its outer transaction fails", async () => {
    const orig = await original();
    await db.update(journalEntriesTable).set({ status: "draft" })
      .where(eq(journalEntriesTable.id, orig.id));
    await reverse(orig.id).expect(400);
    expect(await reversals(orig.id)).toHaveLength(0);
    await db.update(journalEntriesTable).set({ status: "posted" })
      .where(eq(journalEntriesTable.id, orig.id));
    const before = await entry(orig.id);
    await expect(db.transaction(async (tx) => {
      await reverseJournalEntry(tx, orig.id, users[0], companies[0]);
      throw new Error("Synthetic document failure");
    })).rejects.toThrow("Synthetic document failure");
    expect(await reversals(orig.id)).toHaveLength(0);
    expect(await entry(orig.id)).toEqual(before);
    await reverse(orig.id).expect(200);
  });
});
