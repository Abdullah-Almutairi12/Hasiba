import { cleanupCompanyDefaults } from "../test/cleanup-company-defaults";
/**
 * Multi-Company Phase 6 — consolidated reports integration tests.
 *
 * Seeds two real companies (A & B) plus a matched intercompany
 * sales-invoice pair and an intentionally-imbalanced pair, then
 * exercises the HTTP layer end-to-end via supertest:
 *
 *   1. P&L /api/reports/consolidated/pl
 *      - Revenue is fully eliminated on the matched line
 *      - Validation surfaces the imbalanced pair (>0.01 diff)
 *   2. BS /api/reports/consolidated/bs
 *      - AR (source) and AP (target) net to zero after elimination
 *      - Sheet stays balanced (assets == liabilities + equity)
 *   3. 403 when a logged-in user lacks user_companies on every selected
 *      company
 *   4. CF /api/reports/consolidated/cf
 *      - Sums cash movements across both companies
 *      - `eliminations` is empty (intercompany cash is real)
 *
 * Fixtures are tagged with a per-run timestamp and torn down in
 * `afterAll`. Tests reuse one login per user to stay under the
 * /auth/login rate limiter.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  companiesTable,
  usersTable,
  userCompaniesTable,
  customersTable,
  suppliersTable,
  customerInvoicesTable,
  invoicesTable,
  intercompanyLinksTable,
  accountsTable,
  journalEntriesTable,
  journalEntryLinesTable,
  auditLogsTable,
  warehousesTable,
} from "@workspace/db";
import app from "../app";

const RUN_TAG = `vitest-consol-${Date.now()}`;
const PASSWORD = "Test1234!";

let companyAId = 0;
let companyBId = 0;
let userBothId = 0;
let userOnlyAId = 0;

let customerAId = 0;
let supplierBId = 0;

// Pair 1 — matched amounts (subtotal 100 / vat 15 / total 115)
let srcInv1Id = 0;
let tgtInv1Id = 0;
let link1Id = 0;
const srcRef1 = `SI-${RUN_TAG}-1`;
const tgtRef1 = `IC-${srcRef1}-CB`;

// Pair 2 — IMBALANCED (source subtotal 200, target notes.subtotal 150)
let srcInv2Id = 0;
let tgtInv2Id = 0;
let link2Id = 0;
const srcRef2 = `SI-${RUN_TAG}-2`;
const tgtRef2 = `IC-${srcRef2}-CB`;

// Journal entries we create so cleanup can drop them
const createdEntryIds: number[] = [];

let agentBoth: request.Agent;
let agentOnlyA: request.Agent;

const TODAY = new Date().toISOString().slice(0, 10);

interface JeLine {
  systemKey: string;
  debit?: number;
  credit?: number;
}

async function postJournal(
  companyId: number,
  reference: string,
  description: string,
  lines: JeLine[],
  accountIdBySystemKey: Map<string, number>,
): Promise<number> {
  const entryNumber = `JE-${RUN_TAG}-${reference}`;
  const [entry] = await db
    .insert(journalEntriesTable)
    .values({
      entryNumber,
      entryDate: TODAY,
      description,
      reference,
      status: "posted",
      source: "manual",
      sourceRef: null,
      companyId,
    })
    .returning({ id: journalEntriesTable.id });
  createdEntryIds.push(entry.id);
  let lineNumber = 1;
  for (const ln of lines) {
    const accountId = accountIdBySystemKey.get(ln.systemKey);
    if (!accountId) throw new Error(`missing seeded account: ${ln.systemKey}`);
    const debit = (ln.debit ?? 0).toFixed(2);
    const credit = (ln.credit ?? 0).toFixed(2);
    await db.insert(journalEntryLinesTable).values({
      entryId: entry.id,
      lineNumber: lineNumber++,
      accountId,
      debit,
      credit,
      baseDebit: debit,
      baseCredit: credit,
    });
  }
  return entry.id;
}

beforeAll(async () => {
  // ---- companies + users ----
  const [a] = await db
    .insert(companiesTable)
    .values({ name: `Consol Co A ${RUN_TAG}`, baseCurrency: "SAR" })
    .returning();
  const [b] = await db
    .insert(companiesTable)
    .values({ name: `Consol Co B ${RUN_TAG}`, baseCurrency: "SAR" })
    .returning();
  companyAId = a.id;
  companyBId = b.id;

  const hash = await bcrypt.hash(PASSWORD, 4);
  const [uBoth] = await db
    .insert(usersTable)
    .values({
      name: `Both ${RUN_TAG}`,
      email: `both-${RUN_TAG}@test.local`,
      passwordHash: hash,
      role: "owner",
      isActive: true,
    })
    .returning();
  const [uOnlyA] = await db
    .insert(usersTable)
    .values({
      name: `OnlyA ${RUN_TAG}`,
      email: `onlya-${RUN_TAG}@test.local`,
      passwordHash: hash,
      role: "owner",
      isActive: true,
    })
    .returning();
  userBothId = uBoth.id;
  userOnlyAId = uOnlyA.id;

  await db.insert(userCompaniesTable).values([
    { userId: userBothId, companyId: companyAId, role: "owner", isDefault: true },
    { userId: userBothId, companyId: companyBId, role: "owner", isDefault: false },
    { userId: userOnlyAId, companyId: companyAId, role: "owner", isDefault: true },
  ]);

  // ---- counterparties ----
  const [cA] = await db
    .insert(customersTable)
    .values({
      name: `Consol Co B ${RUN_TAG}`,
      companyId: companyAId,
      linkedCompanyId: companyBId,
    })
    .returning();
  customerAId = cA.id;
  const [sB] = await db
    .insert(suppliersTable)
    .values({
      name: `Consol Co A ${RUN_TAG}`,
      companyId: companyBId,
      linkedCompanyId: companyAId,
    })
    .returning();
  supplierBId = sB.id;

  // ---- two intercompany sales-invoice pairs ----
  // Pair 1 — matched 100 / 15 / 115
  const [si1] = await db
    .insert(customerInvoicesTable)
    .values({
      reference: srcRef1,
      companyId: companyAId,
      customerId: customerAId,
      customerName: cA.name,
      status: "open",
      invoiceDate: TODAY,
      subtotal: "100.00",
      vat: "15.00",
      total: "115.00",
      amountPaid: "0.00",
      source: "manual",
      isIntercompany: false,
      counterpartyCompanyId: companyBId,
    })
    .returning();
  srcInv1Id = si1.id;
  const [ti1] = await db
    .insert(invoicesTable)
    .values({
      invoiceNumber: tgtRef1,
      supplierId: supplierBId,
      supplierName: `Consol Co A ${RUN_TAG}`,
      amount: "115.00",
      status: "pending",
      notes: JSON.stringify({
        mirrorOf: { kind: "sales_invoice", id: si1.id, reference: srcRef1 },
        subtotal: 100,
        vat: 15,
        total: 115,
      }),
      companyId: companyBId,
      isIntercompany: true,
      counterpartyCompanyId: companyAId,
    })
    .returning();
  tgtInv1Id = ti1.id;
  const [lk1] = await db
    .insert(intercompanyLinksTable)
    .values({
      kind: "sales_invoice",
      sourceCompanyId: companyAId,
      sourceDocId: srcInv1Id,
      sourceRef: srcRef1,
      targetCompanyId: companyBId,
      targetDocId: tgtInv1Id,
      targetRef: tgtRef1,
      status: "matched",
    })
    .returning({ id: intercompanyLinksTable.id });
  link1Id = lk1.id;

  // Pair 2 — imbalanced (source subtotal 200, mirror notes.subtotal 150).
  // BS open amounts still match at 230/230 so only the P&L flags it.
  const [si2] = await db
    .insert(customerInvoicesTable)
    .values({
      reference: srcRef2,
      companyId: companyAId,
      customerId: customerAId,
      customerName: cA.name,
      status: "open",
      invoiceDate: TODAY,
      subtotal: "200.00",
      vat: "30.00",
      total: "230.00",
      amountPaid: "0.00",
      source: "manual",
      isIntercompany: false,
      counterpartyCompanyId: companyBId,
    })
    .returning();
  srcInv2Id = si2.id;
  const [ti2] = await db
    .insert(invoicesTable)
    .values({
      invoiceNumber: tgtRef2,
      supplierId: supplierBId,
      supplierName: `Consol Co A ${RUN_TAG}`,
      amount: "230.00",
      status: "pending",
      notes: JSON.stringify({
        mirrorOf: { kind: "sales_invoice", id: si2.id, reference: srcRef2 },
        subtotal: 150, // <- intentional drift from source 200
        vat: 30,
        total: 230,
      }),
      companyId: companyBId,
      isIntercompany: true,
      counterpartyCompanyId: companyAId,
    })
    .returning();
  tgtInv2Id = ti2.id;
  const [lk2] = await db
    .insert(intercompanyLinksTable)
    .values({
      kind: "sales_invoice",
      sourceCompanyId: companyAId,
      sourceDocId: srcInv2Id,
      sourceRef: srcRef2,
      targetCompanyId: companyBId,
      targetDocId: tgtInv2Id,
      targetRef: tgtRef2,
      status: "matched",
    })
    .returning({ id: intercompanyLinksTable.id });
  link2Id = lk2.id;

  // ---- back-fill posted journal entries that mirror what the live
  // routes would have produced. Source side hits AR/sales/VAT-output,
  // target side hits inventory/VAT-input/AP. References match how
  // `fetchInvoiceJournalLines` looks them up. ----
  const keys = [
    "ar",
    "ap",
    "sales_revenue",
    "vat_output",
    "vat_input",
    "inventory",
    "cash",
  ];
  const accountRows = await db
    .select({ id: accountsTable.id, systemKey: accountsTable.systemKey })
    .from(accountsTable)
    .where(inArray(accountsTable.systemKey, keys));
  const accIdByKey = new Map<string, number>();
  for (const r of accountRows) if (r.systemKey) accIdByKey.set(r.systemKey, r.id);

  // Source-side JE for both pairs (company A, reference == source invoice ref)
  await postJournal(companyAId, srcRef1, `فاتورة ${srcRef1}`, [
    { systemKey: "ar", debit: 115 },
    { systemKey: "sales_revenue", credit: 100 },
    { systemKey: "vat_output", credit: 15 },
  ], accIdByKey);
  await postJournal(companyAId, srcRef2, `فاتورة ${srcRef2}`, [
    { systemKey: "ar", debit: 230 },
    { systemKey: "sales_revenue", credit: 200 },
    { systemKey: "vat_output", credit: 30 },
  ], accIdByKey);
  // Target-side JE for both pairs (company B, reference == target invoice ref)
  await postJournal(companyBId, tgtRef1, `استلام ${tgtRef1}`, [
    { systemKey: "inventory", debit: 100 },
    { systemKey: "vat_input", debit: 15 },
    { systemKey: "ap", credit: 115 },
  ], accIdByKey);
  await postJournal(companyBId, tgtRef2, `استلام ${tgtRef2}`, [
    { systemKey: "inventory", debit: 200 },
    { systemKey: "vat_input", debit: 30 },
    { systemKey: "ap", credit: 230 },
  ], accIdByKey);

  // Cash movements so the CF test has something to sum across both tenants.
  await postJournal(companyAId, `CASH-A-${RUN_TAG}`, "إيداع رأس مال A", [
    { systemKey: "cash", debit: 500 },
    { systemKey: "ap", credit: 500 },
  ], accIdByKey);
  await postJournal(companyBId, `CASH-B-${RUN_TAG}`, "إيداع رأس مال B", [
    { systemKey: "cash", debit: 700 },
    { systemKey: "ap", credit: 700 },
  ], accIdByKey);

  // ---- logins ----
  agentBoth = request.agent(app);
  agentOnlyA = request.agent(app);
  const l1 = await agentBoth
    .post("/api/auth/login")
    .send({ email: `both-${RUN_TAG}@test.local`, password: PASSWORD });
  const l2 = await agentOnlyA
    .post("/api/auth/login")
    .send({ email: `onlya-${RUN_TAG}@test.local`, password: PASSWORD });
  if (l1.status !== 200 || l2.status !== 200) {
    throw new Error(
      `login failed — both=${l1.status} ${JSON.stringify(l1.body)} onlyA=${l2.status} ${JSON.stringify(l2.body)}`,
    );
  }
});

afterAll(async () => {
  const linkIds = [link1Id, link2Id].filter((n) => n > 0);
  if (linkIds.length > 0) {
    await db.delete(intercompanyLinksTable).where(inArray(intercompanyLinksTable.id, linkIds));
  }
  if (createdEntryIds.length > 0) {
    // journal_entry_lines cascades on entry delete
    await db.delete(journalEntriesTable).where(inArray(journalEntriesTable.id, createdEntryIds));
  }
  const tgtIds = [tgtInv1Id, tgtInv2Id].filter((n) => n > 0);
  if (tgtIds.length > 0) {
    await db.delete(invoicesTable).where(inArray(invoicesTable.id, tgtIds));
  }
  const srcIds = [srcInv1Id, srcInv2Id].filter((n) => n > 0);
  if (srcIds.length > 0) {
    await db.delete(customerInvoicesTable).where(inArray(customerInvoicesTable.id, srcIds));
  }
  if (supplierBId) await db.delete(suppliersTable).where(eq(suppliersTable.id, supplierBId));
  if (customerAId) await db.delete(customersTable).where(eq(customersTable.id, customerAId));
  const uids = [userBothId, userOnlyAId].filter((n) => n > 0);
  if (uids.length > 0) {
    await db.delete(userCompaniesTable).where(inArray(userCompaniesTable.userId, uids));
    await db.delete(usersTable).where(inArray(usersTable.id, uids));
  }
  const coIds = [companyAId, companyBId].filter((n) => n > 0);
  if (coIds.length > 0) {
    await db.delete(auditLogsTable).where(inArray(auditLogsTable.companyId, coIds));
    await db.delete(warehousesTable).where(inArray(warehousesTable.companyId, coIds));
    await cleanupCompanyDefaults(coIds);
    await db.delete(companiesTable).where(inArray(companiesTable.id, coIds));
  }
});

describe("Consolidated P&L — revenue elimination & imbalance detection", () => {
  it("eliminates sales_revenue on the matched account and flags the imbalanced pair", async () => {
    const res = await agentBoth.get(
      `/api/reports/consolidated/pl?companies=${companyAId},${companyBId}&from=${TODAY}&to=${TODAY}`,
    );
    expect(res.status).toBe(200);
    const body = res.body as {
      revenue: { code: string; gross: number; eliminated: number; amount: number }[];
      totalRevenue: number;
      totalRevenueEliminated: number;
      eliminations: { linkId: number; sourceAmount: number; targetAmount: number; imbalance: boolean }[];
      imbalance: number;
      hasImbalance: boolean;
    };
    const sales = body.revenue.find((r) => r.code === "4110");
    expect(sales, "sales_revenue row must be present in consolidated P&L").toBeTruthy();
    // gross = 100 + 200 across both source JEs, fully eliminated → net 0
    expect(sales!.gross).toBeCloseTo(300, 2);
    expect(sales!.eliminated).toBeCloseTo(300, 2);
    expect(sales!.amount).toBeCloseTo(0, 2);
    expect(body.totalRevenueEliminated).toBeCloseTo(300, 2);
    expect(body.totalRevenue).toBeCloseTo(0, 2);

    // Both pairs in scope must surface as elimination rows
    const ourLinks = body.eliminations.filter((e) => e.linkId === link1Id || e.linkId === link2Id);
    expect(ourLinks).toHaveLength(2);
    const matched = ourLinks.find((e) => e.linkId === link1Id)!;
    expect(matched.sourceAmount).toBeCloseTo(100, 2);
    expect(matched.targetAmount).toBeCloseTo(100, 2);
    expect(matched.imbalance).toBe(false);
    const drifted = ourLinks.find((e) => e.linkId === link2Id)!;
    expect(drifted.sourceAmount).toBeCloseTo(200, 2);
    expect(drifted.targetAmount).toBeCloseTo(150, 2);
    expect(drifted.imbalance).toBe(true);
    // |200 - 150| = 50 drives the report-level imbalance flag
    expect(body.imbalance).toBeGreaterThanOrEqual(50);
    expect(body.hasImbalance).toBe(true);
  });
});

describe("Consolidated Balance Sheet — AR/AP elimination", () => {
  it("eliminates AR (source) and AP (target) and keeps the sheet balanced", async () => {
    const res = await agentBoth.get(
      `/api/reports/consolidated/bs?companies=${companyAId},${companyBId}&asOf=${TODAY}`,
    );
    expect(res.status).toBe(200);
    const body = res.body as {
      assets: { code: string; gross: number; eliminated: number; amount: number }[];
      liabilities: { code: string; gross: number; eliminated: number; amount: number }[];
      totalAssets: number;
      totalLiabilities: number;
      totalEquity: number;
      isBalanced: boolean;
      totalArEliminated: number;
      totalApEliminated: number;
      eliminations: { linkId: number }[];
    };
    const ar = body.assets.find((r) => r.code === "1130");
    const ap = body.liabilities.find((r) => r.code === "2110");
    expect(ar, "AR account 1130 expected in consolidated BS").toBeTruthy();
    expect(ap, "AP account 2110 expected in consolidated BS").toBeTruthy();
    // Source AR gross = 115 + 230 = 345, fully eliminated → 0
    expect(ar!.gross).toBeCloseTo(345, 2);
    expect(ar!.eliminated).toBeCloseTo(345, 2);
    expect(ar!.amount).toBeCloseTo(0, 2);
    // Target AP gross = 115 + 230 + 500 (cash JE) + 700 (cash JE) = 1545.
    // Only the 115 + 230 intercompany portion is eliminated.
    expect(ap!.gross).toBeCloseTo(1545, 2);
    expect(ap!.eliminated).toBeCloseTo(345, 2);
    expect(ap!.amount).toBeCloseTo(1200, 2);
    expect(body.totalArEliminated).toBeCloseTo(345, 2);
    expect(body.totalApEliminated).toBeCloseTo(345, 2);
    // assets == liabilities + equity within tolerance
    expect(body.isBalanced).toBe(true);
    expect(Math.abs(body.totalAssets - (body.totalLiabilities + body.totalEquity))).toBeLessThan(0.01);
    // Both intercompany pairs still listed as eliminations
    const ourLinks = body.eliminations.filter((e) => e.linkId === link1Id || e.linkId === link2Id);
    expect(ourLinks).toHaveLength(2);
  });
});

describe("Consolidated reports — access control", () => {
  it("returns 403 when caller lacks user_companies access to a selected company", async () => {
    const res = await agentOnlyA.get(
      `/api/reports/consolidated/pl?companies=${companyAId},${companyBId}&from=${TODAY}&to=${TODAY}`,
    );
    expect(res.status).toBe(403);
    const body = res.body as { code?: string; missing?: number[] };
    expect(body.code).toBe("FORBIDDEN");
    expect(body.missing).toContain(companyBId);
    expect(body.missing).not.toContain(companyAId);
  });

  it("allows the same user to scope to companies they DO have access to", async () => {
    const res = await agentOnlyA.get(
      `/api/reports/consolidated/pl?companies=${companyAId}&from=${TODAY}&to=${TODAY}`,
    );
    expect(res.status).toBe(200);
  });
});

describe("Consolidated Cash Flow — sums without eliminations", () => {
  it("aggregates cash movements across both tenants and emits no eliminations", async () => {
    const res = await agentBoth.get(
      `/api/reports/consolidated/cf?companies=${companyAId},${companyBId}&from=${TODAY}&to=${TODAY}`,
    );
    expect(res.status).toBe(200);
    const body = res.body as {
      inflow: number;
      outflow: number;
      net: number;
      byCompany: { companyId: number; amount: number }[];
      eliminations: unknown[];
    };
    // Seeded: A deposited 500, B deposited 700 → at least 1200 inflow
    expect(body.inflow).toBeGreaterThanOrEqual(1200);
    expect(body.net).toBeGreaterThanOrEqual(1200);
    const seenA = body.byCompany.find((c) => c.companyId === companyAId);
    const seenB = body.byCompany.find((c) => c.companyId === companyBId);
    expect(seenA?.amount).toBeGreaterThanOrEqual(500);
    expect(seenB?.amount).toBeGreaterThanOrEqual(700);
    // CF intentionally skips intercompany elimination
    expect(body.eliminations).toEqual([]);
  });
});
