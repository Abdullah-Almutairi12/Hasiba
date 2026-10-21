import { beforeAll, afterAll, describe, it, expect } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { and, eq, inArray } from "drizzle-orm";
import {
  db, companiesTable, usersTable, userCompaniesTable, accountsTable,
  fiscalYearsTable, fiscalPeriodsTable, journalEntriesTable, journalEntryLinesTable,
  bankAccountsTable, bankStatementsTable, bankStatementLinesTable, reportDefinitionsTable,
  auditLogsTable, reportSubscriptionsTable, kpiAlertsTable,
} from "@workspace/db";
import app, { assertApplicationReady } from "../app";
import { seedCompanyFiscalCalendar } from "./fiscal-calendar";
import { runReport } from "./query-builder";

const tag = `finance-tenants-${Date.now()}`;
const date = `${new Date().getUTCFullYear()}-02-15`;
const companies: number[] = [];
const users: number[] = [];
const banks: number[] = [];
const statements: number[] = [];
const statementLines: number[] = [];
const entryLines: number[] = [];
const years: number[] = [];
const periods: number[] = [];
const agents: request.Agent[] = [];
let bankGl = 0;
let revenueGl = 0;

beforeAll(async () => {
  await assertApplicationReady();
  const accounts = await db.select().from(accountsTable);
  bankGl = accounts.find(a => a.systemKey === "bank")!.id;
  revenueGl = accounts.find(a => a.type === "revenue" && !a.isGroup)!.id;
  const hash = await bcrypt.hash("FinanceTest123!", 4);
  for (let n = 0; n < 2; n++) {
    const [co] = await db.insert(companiesTable).values({ name: `${tag}-${n}` }).returning();
    companies.push(co.id);
    await seedCompanyFiscalCalendar(co.id);
    const [fy] = await db.select().from(fiscalYearsTable).where(and(
      eq(fiscalYearsTable.companyId, co.id), eq(fiscalYearsTable.name, date.slice(0, 4)),
    ));
    years.push(fy.id);
    const [period] = await db.select().from(fiscalPeriodsTable).where(and(
      eq(fiscalPeriodsTable.fiscalYearId, fy.id), eq(fiscalPeriodsTable.code, `${date.slice(0, 4)}-M02`),
    ));
    periods.push(period.id);
    const [user] = await db.insert(usersTable).values({
      name: `${tag}-${n}`, email: `${tag}-${n}@test.local`,
      passwordHash: hash, role: "owner", isActive: true,
    }).returning();
    users.push(user.id);
    await db.insert(userCompaniesTable).values({ companyId: co.id, userId: user.id, role: "owner", isDefault: true });
    const [bank] = await db.insert(bankAccountsTable).values({
      companyId: co.id, name: `${tag}-${n}`, bankName: "Synthetic bank",
      accountNumber: `private-${n}`, glAccountId: bankGl,
    }).returning();
    banks.push(bank.id);
    const [statement] = await db.insert(bankStatementsTable).values({
      bankAccountId: bank.id, statementDate: date, startingBalance: "0", endingBalance: "10",
    }).returning();
    statements.push(statement.id);
    const [line] = await db.insert(bankStatementLinesTable).values({
      statementId: statement.id, txDate: date, description: `${tag}-${n}`, amount: "10",
    }).returning();
    statementLines.push(line.id);
    const [entry] = await db.insert(journalEntriesTable).values({
      companyId: co.id, entryDate: date, periodId: period.id, status: "posted",
      entryNumber: `${tag}-${n}`, description: `private-${n}`,
    }).returning();
    const amount = String(n === 0 ? 10 : 900);
    const [jl] = await db.insert(journalEntryLinesTable).values([
      { entryId: entry.id, accountId: bankGl, lineNumber: 1, debit: amount, baseDebit: amount },
      { entryId: entry.id, accountId: revenueGl, lineNumber: 2, credit: amount, baseCredit: amount },
    ]).returning();
    entryLines.push(jl.id);
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ email: user.email, password: "FinanceTest123!" }).expect(200);
    agents.push(agent);
  }
  // Same-company peer exercises private report access separately from tenancy.
  const [peer] = await db.insert(usersTable).values({
    name: `${tag}-peer`, email: `${tag}-peer@test.local`, passwordHash: hash, role: "owner", isActive: true,
  }).returning();
  users.push(peer.id);
  await db.insert(userCompaniesTable).values({ userId: peer.id, companyId: companies[0], role: "owner", isDefault: true });
  const agent = request.agent(app);
  await agent.post("/api/auth/login").send({ email: peer.email, password: "FinanceTest123!" }).expect(200);
  agents.push(agent);
});

afterAll(async () => {
  if (!companies.length) return;
  const defs = await db.select().from(reportDefinitionsTable).where(inArray(reportDefinitionsTable.companyId, companies));
  if (defs.length) {
    const ids = defs.map(d => d.id);
    await db.delete(reportSubscriptionsTable).where(inArray(reportSubscriptionsTable.reportId, ids));
    await db.delete(kpiAlertsTable).where(inArray(kpiAlertsTable.reportId, ids));
  }
  await db.delete(reportDefinitionsTable).where(inArray(reportDefinitionsTable.companyId, companies));
  await db.delete(bankAccountsTable).where(inArray(bankAccountsTable.companyId, companies));
  await db.delete(journalEntriesTable).where(inArray(journalEntriesTable.companyId, companies));
  await db.delete(fiscalYearsTable).where(inArray(fiscalYearsTable.companyId, companies));
  await db.delete(auditLogsTable).where(inArray(auditLogsTable.userId, users));
  await db.delete(usersTable).where(inArray(usersTable.id, users));
  await db.delete(companiesTable).where(inArray(companiesTable.id, companies));
});

describe("finance object isolation", () => {
  it("lists only owned bank accounts and rejects foreign imports, reconciliation, and matches", async () => {
    const list = await agents[0].get("/api/accounting/bank-accounts").expect(200);
    expect(list.body.map((b: { id: number }) => b.id)).toEqual([banks[0]]);
    const imported = await agents[0].post("/api/accounting/bank-statements").send({
      bankAccountId: banks[1], statementDate: date, startingBalance: 0, endingBalance: 10,
      lines: [{ txDate: date, description: "forged", amount: 10 }],
    });
    expect(imported.status).toBeGreaterThanOrEqual(400);
    await agents[0].get(`/api/accounting/bank-statements/${statements[1]}/reconciliation`).expect(404);
    await agents[0].post(`/api/accounting/bank-statement-lines/${statementLines[1]}/match`)
      .send({ matchedLineId: entryLines[0] }).expect(404);
    await agents[0].post(`/api/accounting/bank-statement-lines/${statementLines[0]}/match`)
      .send({ matchedLineId: entryLines[1] }).expect(404);
    const own = await agents[0].get(`/api/accounting/bank-statements/${statements[0]}/reconciliation`).expect(200);
    expect(own.body.candidates.map((c: { id: number }) => c.id)).toEqual([entryLines[0]]);
    await agents[0].post(`/api/accounting/bank-statement-lines/${statementLines[0]}/match`)
      .send({ matchedLineId: entryLines[0] }).expect(200);
    const [foreign] = await db.select().from(bankStatementLinesTable).where(eq(bankStatementLinesTable.id, statementLines[1]));
    expect(foreign.matchedLineId).toBeNull();
    const statementCount = await db.select().from(bankStatementsTable).where(eq(bankStatementsTable.bankAccountId, banks[1]));
    expect(statementCount).toHaveLength(1);
  });

  it("stamps bank ownership from the session rather than the body", async () => {
    const created = await agents[0].post("/api/accounting/bank-accounts").send({
      companyId: companies[1], name: "new", bankName: "synthetic", accountNumber: "synthetic", glAccountId: bankGl,
    }).expect(201);
    expect(created.body.companyId).toBe(companies[0]);
  });

  it("scopes both fiscal period aliases and keeps posting controls independent", async () => {
    for (const path of ["periods", "fiscal-periods"]) {
      for (const action of ["close", "reopen"]) {
        await agents[0].post(`/api/accounting/${path}/${periods[1]}/${action}`).expect(404);
      }
    }
    const listed = await agents[0].get("/api/accounting/fiscal-years").expect(200);
    expect(listed.body.every((y: { companyId: number }) => y.companyId === companies[0])).toBe(true);
    await agents[0].post(`/api/accounting/periods/${periods[0]}/close`).expect(200);
    const body = { entryDate: date, description: "post", status: "posted",
      lines: [{ accountId: bankGl, debit: 1 }, { accountId: revenueGl, credit: 1 }] };
    await agents[0].post("/api/accounting/journal-entries").send(body).expect(403);
    await agents[1].post("/api/accounting/journal-entries").send({ ...body, status: "draft" }).expect(201);
    await agents[0].post(`/api/accounting/periods/${periods[0]}/reopen`).expect(200);
    const foreignClose = await agents[0].post("/api/accounting/close-year").send({ fiscalYearId: years[1] });
    expect(foreignClose.status).toBeGreaterThanOrEqual(400);
    const [foreign] = await db.select().from(fiscalYearsTable).where(eq(fiscalYearsTable.id, years[1]));
    expect(foreign.status).toBe("open");
  });
});

describe("financial aggregates and report execution", () => {
  it("aggregates only the active company's journals across every financial report", async () => {
    const trial = await agents[0].get("/api/reports/trial-balance").expect(200);
    expect(trial.body.totalDebit).toBe(10);
    const pl = await agents[0].get("/api/reports/profit-loss").expect(200);
    expect(pl.body.totalRevenue).toBe(10);
    const bs = await agents[0].get("/api/reports/balance-sheet").expect(200);
    expect(bs.body.totalAssets).toBe(10);
    const cf = await agents[0].get("/api/reports/cash-flow").expect(200);
    expect(cf.body.net).toBe(10);
    const summary = await agents[0].get("/api/accounting/summary").expect(200);
    expect(summary.body.netCashFlow).toBe(10);
    const ledger = await agents[0].get(`/api/reports/general-ledger/${bankGl}`).expect(200);
    expect(ledger.body.lines).toHaveLength(1);
    expect(ledger.body.lines[0].description).toBe("private-0");
  });

  it("requires company context in the runner and prevents SQL alias injection", async () => {
    await expect(runReport("journal_entries", { columns: ["debit"] }, 0)).rejects.toThrow("Company context");
    await expect(runReport("journal_entries", {
      columns: ["debit"], aggregates: [{ column: "debit", fn: "sum", alias: 'x" from journal_entries --' }],
    }, companies[0])).rejects.toThrow("Invalid aggregate alias");
    const result = await agents[0].post("/api/reports/run").send({
      source: "journal_entries", companyId: companies[1],
      config: { columns: ["entry_number", "debit"], filters: [{ column: "entry_number", op: "eq", value: `${tag}-1` }] },
    }).expect(200);
    expect(result.body.rows).toEqual([]);
  });

  it("enforces private, role-shared, all-shared, and cross-company report access for run/export", async () => {
    const created = await agents[0].post("/api/reports/definitions").send({
      name: "Private", dataSource: "journal_entries", companyId: companies[1],
      config: { columns: ["entry_number", "description", "debit"] },
    }).expect(201);
    const id = created.body.id;
    expect(created.body.companyId).toBe(companies[0]);
    await agents[0].post(`/api/reports/definitions/${id}/run`).expect(200);
    for (const other of [agents[1], agents[2]]) {
      await other.post(`/api/reports/definitions/${id}/run`).expect(404);
      await other.get(`/api/reports/definitions/${id}/export?format=csv`).expect(404);
      await other.post("/api/reports/subscriptions").send({
        reportId: id, recipients: ["synthetic@test.local"],
      }).expect(404);
    }
    for (const sharedWithRole of ["owner", "all"]) {
      await agents[0].patch(`/api/reports/definitions/${id}`).send({ sharedWithRole }).expect(200);
      const result = await agents[2].post(`/api/reports/definitions/${id}/run`).expect(200);
      expect(result.body.rows.map((r: { description: string }) => r.description)).toEqual(["private-0", "private-0"]);
      const csv = await agents[2].get(`/api/reports/definitions/${id}/export?format=csv`).expect(200);
      expect(csv.text).not.toContain("private-1");
      await agents[1].post(`/api/reports/definitions/${id}/run`).expect(404);
      await agents[1].get(`/api/reports/definitions/${id}/export?format=csv`).expect(404);
    }
    await agents[0].patch(`/api/reports/definitions/${id}`).send({ sharedWithRole: "accountant" }).expect(200);
    await agents[2].post(`/api/reports/definitions/${id}/run`).expect(404);
    await agents[2].get(`/api/reports/definitions/${id}/export?format=csv`).expect(404);
    const list = await agents[1].get("/api/reports/definitions").expect(200);
    expect(list.body.some((d: { id: number }) => d.id === id)).toBe(false);
    await agents[1].patch(`/api/reports/definitions/${id}`).send({ name: "forged" }).expect(404);
    await agents[1].delete(`/api/reports/definitions/${id}`).expect(404);
  });

  it("closes a year using only its own profit and leaves the other company's periods open", async () => {
    const result = await agents[0].post("/api/accounting/close-year").send({ fiscalYearId: years[0] }).expect(201);
    expect(result.body.netResult).toBe(10);
    const foreign = await db.select().from(fiscalPeriodsTable).where(eq(fiscalPeriodsTable.fiscalYearId, years[1]));
    expect(foreign.every(p => p.status === "open")).toBe(true);
  });
});
