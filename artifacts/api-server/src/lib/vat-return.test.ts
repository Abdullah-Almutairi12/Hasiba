import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  db,
  companiesTable,
  branchesTable,
  customersTable,
  posSessionsTable,
  posOrdersTable,
  posOrderPaymentsTable,
  customerInvoicesTable,
  customerInvoiceLinesTable,
  accountsTable,
  fiscalYearsTable,
  fiscalPeriodsTable,
  journalEntriesTable,
  journalEntryLinesTable,
  creditNotesTable,creditNoteLinesTable,salesOrdersTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { computeVatReturn, quarterRangeUTC } from "./vat-return";

const TAG = `vitest-vatret-${Date.now()}`;

let companyId: number;
let branchId: number;
let sessionId: number;
let customerId: number;
let vatInputAccountId: number;
let arAccountId: number;
let fyId: number;
let periodId: number;

beforeAll(async () => {
  const [c] = await db
    .insert(companiesTable)
    .values({ name: `${TAG}-co`, baseCurrency: "SAR", vatNumber: "300000000000003" })
    .returning({ id: companiesTable.id });
  companyId = c.id;

  const [b] = await db
    .insert(branchesTable)
    .values({ name: `${TAG}-br`, nameAr: `${TAG}-fr`, city: "Riyadh", companyId })
    .returning({ id: branchesTable.id });
  branchId = b.id;

  const [s] = await db
    .insert(posSessionsTable)
    .values({ branchId, sessionNumber: `${TAG}-sess`, cashierName: TAG })
    .returning({ id: posSessionsTable.id });
  sessionId = s.id;

  const [cust] = await db
    .insert(customersTable)
    .values({ name: `${TAG}-cust`, companyId })
    .returning({ id: customersTable.id });
  customerId = cust.id;

  // Ensure a `vat_input` account exists. accounts.code is unique so use
  // a unique tagged code; systemKey is unique too, so reuse an existing
  // row if present.
  const existing = await db
    .select({ id: accountsTable.id })
    .from(accountsTable)
    .where(eq(accountsTable.systemKey, "vat_input"))
    .limit(1);
  if (existing[0]) {
    vatInputAccountId = existing[0].id;
  } else {
    const [a] = await db
      .insert(accountsTable)
      .values({
        code: `${TAG}-1140`,
        name: "VAT Input",
        nameAr: "ضريبة المدخلات",
        type: "asset",
        systemKey: "vat_input",
      })
      .returning({ id: accountsTable.id });
    vatInputAccountId = a.id;
  }
  // Counter-party account for the JE — just any asset/liability.
  const [ar] = await db
    .insert(accountsTable)
    .values({
      code: `${TAG}-2100`,
      name: "AP",
      nameAr: "موردون",
      type: "liability",
    })
    .returning({ id: accountsTable.id });
  arAccountId = ar.id;

  // A fiscal year + period covering 2024-Q1 (we'll post JEs there).
  const [fy] = await db
    .insert(fiscalYearsTable)
    .values({ companyId, name: `${TAG}-fy`, startDate: "2024-01-01", endDate: "2024-12-31" })
    .returning({ id: fiscalYearsTable.id });
  fyId = fy.id;
  const [p] = await db
    .insert(fiscalPeriodsTable)
    .values({
      fiscalYearId: fyId,
      code: `${TAG}-Q1`,
      name: `${TAG}-Q1`,
      startDate: "2024-01-01",
      endDate: "2024-03-31",
    })
    .returning({ id: fiscalPeriodsTable.id });
  periodId = p.id;
});

afterAll(async () => {
  const entryIds = await db
    .select({ id: journalEntriesTable.id })
    .from(journalEntriesTable)
    .where(eq(journalEntriesTable.companyId, companyId));
  if (entryIds.length) {
    await db
      .delete(journalEntryLinesTable)
      .where(inArray(journalEntryLinesTable.entryId, entryIds.map((r) => r.id)));
    await db
      .delete(journalEntriesTable)
      .where(inArray(journalEntriesTable.id, entryIds.map((r) => r.id)));
  }
  await db.delete(fiscalPeriodsTable).where(eq(fiscalPeriodsTable.id, periodId));
  await db.delete(fiscalYearsTable).where(eq(fiscalYearsTable.id, fyId));
  await db.delete(accountsTable).where(eq(accountsTable.id, arAccountId));
  // Don't delete vat_input if it was pre-existing (created by coa template).
  await db.delete(posOrdersTable).where(eq(posOrdersTable.sessionId, sessionId));
  await db.delete(posSessionsTable).where(eq(posSessionsTable.id, sessionId));
  await db.delete(creditNotesTable).where(eq(creditNotesTable.companyId,companyId));
  await db
    .delete(customerInvoiceLinesTable)
    .where(
      inArray(
        customerInvoiceLinesTable.invoiceId,
        db
          .select({ id: customerInvoicesTable.id })
          .from(customerInvoicesTable)
          .where(eq(customerInvoicesTable.customerId, customerId)),
      ),
    );
  await db
    .delete(customerInvoicesTable)
    .where(eq(customerInvoicesTable.customerId, customerId));
  await db.delete(salesOrdersTable).where(eq(salesOrdersTable.companyId,companyId));
  await db.delete(customersTable).where(eq(customersTable.id, customerId));
  await db.delete(branchesTable).where(eq(branchesTable.id, branchId));
  await (await import("../test/cleanup-company-defaults")).cleanupCompanyDefaults([companyId]);
  await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
});

async function seedPosOrder(
  number: string,
  createdAt: Date,
  subtotal: number,
  tax: number,
  discount = 0,
) {
  const total = subtotal + tax - discount;
  await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(posOrdersTable)
      .values({
        orderNumber: number,
        sessionId,
        subtotal: String(subtotal),
        discount: String(discount),
        tax: String(tax),
        total: String(total),
        paymentMethod: "cash",
        companyId,
        createdAt,
      })
      .returning({ id: posOrdersTable.id });
    await tx.insert(posOrderPaymentsTable).values({
      orderId: row.id,
      method: "cash",
      amount: String(total),
    });
  });
}

async function seedCustomerInvoice(opts: {
  ref: string;
  invoiceDate: string;
  subtotal: number;
  vat: number;
  source?: "manual" | "pos" | "so";
  status?: "open" | "paid" | "draft" | "cancelled";
  lines: Array<{ taxRate: number; lineTotal: number }>;
}) {
  const total = opts.subtotal + opts.vat;
  const [inv] = await db
    .insert(customerInvoicesTable)
    .values({
      reference: opts.ref,
      companyId,
      customerId,
      customerName: `${TAG}-cust`,
      branchId,
      invoiceDate: opts.invoiceDate,
      subtotal: String(opts.subtotal),
      discount: "0",
      vat: String(opts.vat),
      total: String(total),
      status: opts.status ?? "open",
      source: opts.source ?? "manual",
    })
    .returning({ id: customerInvoicesTable.id });
  for (const ln of opts.lines) {
    await db.insert(customerInvoiceLinesTable).values({
      invoiceId: inv.id,
      description: "ln",
      quantity: "1",
      unitPrice: String(ln.lineTotal),
      taxRate: String(ln.taxRate),
      lineTotal: String(ln.lineTotal),
    });
  }
  return inv.id;
}

async function seedVatInputJournal(date: string, amount: number) {
  const debit=Math.max(0,amount),credit=Math.max(0,-amount);
  const [je] = await db
    .insert(journalEntriesTable)
    .values({
      entryNumber: `${TAG}-je-${date}-${amount}`,
      entryDate: date,
      periodId,
      description: "supplier VAT",
      status: "posted",
      source: "supplier_invoice",
      companyId,
    })
    .returning({ id: journalEntriesTable.id });
  await db.insert(journalEntryLinesTable).values([
    {
      entryId: je.id,
      lineNumber: 1,
      accountId: vatInputAccountId,
      debit: String(debit),
      credit: String(credit),
      baseDebit: String(debit),
      baseCredit: String(credit),
    },
    {
      entryId: je.id,
      lineNumber: 2,
      accountId: arAccountId,
      debit: String(credit),
      credit: String(debit),
      baseDebit: String(credit),
      baseCredit: String(debit),
    },
  ]);
}

describe("vat-return service", () => {
  it("nets returns once, excludes SO-linked POS mirrors, and honors Riyadh boundaries",async()=>{
    await seedPosOrder(`${TAG}-riyadh-start`,new Date("2026-06-30T21:00:00Z"),100,15);
    await seedPosOrder(`${TAG}-riyadh-main`,new Date("2026-08-20T10:00:00Z"),1000,150);
    await seedPosOrder(`${TAG}-riyadh-excluded`,new Date("2026-09-30T21:00:00Z"),200,30);
    const mirror=await seedCustomerInvoice({ref:`${TAG}-so-mirror`,invoiceDate:"2026-08-20",subtotal:1000,vat:150,lines:[{taxRate:15,lineTotal:1000}]});
    const [so]=await db.insert(salesOrdersTable).values({companyId,reference:`${TAG}-so`,customerId,customerName:TAG,source:"pos",orderDate:"2026-08-20",subtotal:"1000",vat:"150",total:"1150"}).returning();
    await db.update(customerInvoicesTable).set({soId:so!.id}).where(eq(customerInvoicesTable.id,mirror));
    const manual=await seedCustomerInvoice({ref:`${TAG}-manual`,invoiceDate:"2026-08-20",subtotal:500,vat:75,lines:[{taxRate:15,lineTotal:500}]});
    for(const [invoiceId,net,vat] of [[mirror,100,15],[manual,50,7.5]] as const){
      const [note]=await db.insert(creditNotesTable).values({companyId,reference:`${TAG}-return-${invoiceId}`,invoiceId,customerId,customerName:TAG,noteDate:"2026-09-30",restock:false,status:"issued",subtotal:String(net),vat:String(vat),total:String(net+vat)}).returning();
      await db.insert(creditNoteLinesTable).values({noteId:note!.id,description:"Synthetic non-stock return",quantity:"1",unitPrice:String(net),taxRate:"15",lineTotal:String(net)});
    }
    const [fy]=await db.insert(fiscalYearsTable).values({companyId,name:`${TAG}-2026`,startDate:"2026-01-01",endDate:"2026-12-31"}).returning();
    const [p]=await db.insert(fiscalPeriodsTable).values({fiscalYearId:fy!.id,code:`${TAG}-2026-Q3`,name:"Q3",startDate:"2026-07-01",endDate:"2026-09-30"}).returning();
    const oldPeriod=periodId;periodId=p!.id;await seedVatInputJournal("2026-08-20",45);await seedVatInputJournal("2026-09-20",-7.5);periodId=oldPeriod;
    const vr=await computeVatReturn(companyId,2026,3,{timezone:"Asia/Riyadh"});
    expect(vr.outputVat).toEqual({pos:150,customerInvoices:67.5,total:217.5});
    expect(vr.supplies.standardRated).toBe(1450);
    expect(vr.inputVat.total).toBe(37.5);expect(vr.netPayable).toBe(180);
    expect(vr.periodStart).toBe("2026-07-01");expect(vr.periodEnd).toBe("2026-09-30");
    const {buildVatReturnPdf}=await import("./pdf/business-documents");
    const {getPrintCompany}=await import("./pdf/print-company");
    const {mkdir,writeFile}=await import("node:fs/promises");
    const output=new URL("../../../../generated-artifacts/print-quality/after/",import.meta.url);
    await mkdir(output,{recursive:true});
    await writeFile(new URL("vat-financial-Q3-2026.pdf",output),await buildVatReturnPdf(vr,await getPrintCompany(companyId)));
    await writeFile(new URL("vat-financial-Q3-2026.expected.json",output),JSON.stringify({scenario:"Synthetic ledger/invoice/return fixtures only",expected:{standardRated:1450,outputVat:217.5,inputVat:37.5,netPayable:180},actual:vr},null,2));
    await db.delete(journalEntryLinesTable).where(inArray(journalEntryLinesTable.entryId,db.select({id:journalEntriesTable.id}).from(journalEntriesTable).where(eq(journalEntriesTable.periodId,p!.id))));
    await db.delete(journalEntriesTable).where(eq(journalEntriesTable.periodId,p!.id));
    await db.delete(fiscalPeriodsTable).where(eq(fiscalPeriodsTable.id,p!.id));await db.delete(fiscalYearsTable).where(eq(fiscalYearsTable.id,fy!.id));
  });
  it("quarterRangeUTC returns the right half-open boundaries", () => {
    const q1 = quarterRangeUTC(2024, 1);
    expect(q1.start.toISOString()).toBe("2024-01-01T00:00:00.000Z");
    expect(q1.end.toISOString()).toBe("2024-04-01T00:00:00.000Z");
    const q4 = quarterRangeUTC(2024, 4);
    expect(q4.start.toISOString()).toBe("2024-10-01T00:00:00.000Z");
    expect(q4.end.toISOString()).toBe("2025-01-01T00:00:00.000Z");
  });

  it("rolls up POS + customer invoices into output VAT and nets against input VAT", async () => {
    // Q1 2024
    await seedPosOrder(
      `${TAG}-pos-in`,
      new Date(Date.UTC(2024, 1, 15)),
      1000,
      150, // 15% VAT
    );
    // Out of period: Q4 2023 — must be excluded
    await seedPosOrder(
      `${TAG}-pos-out`,
      new Date(Date.UTC(2023, 11, 31, 12)),
      500,
      75,
    );
    // Q2 2024 — must be excluded from Q1
    await seedPosOrder(
      `${TAG}-pos-q2`,
      new Date(Date.UTC(2024, 4, 2)),
      200,
      30,
    );

    await seedCustomerInvoice({
      ref: `${TAG}-inv-std`,
      invoiceDate: "2024-02-10",
      subtotal: 2000,
      vat: 300,
      lines: [{ taxRate: 15, lineTotal: 2000 }],
    });
    await seedCustomerInvoice({
      ref: `${TAG}-inv-zero`,
      invoiceDate: "2024-03-05",
      subtotal: 500,
      vat: 0,
      lines: [{ taxRate: 0, lineTotal: 500 }],
    });
    // POS-mirror invoice — must NOT double-count VAT
    await seedCustomerInvoice({
      ref: `${TAG}-inv-pos-mirror`,
      invoiceDate: "2024-02-15",
      subtotal: 1000,
      vat: 150,
      source: "pos",
      lines: [{ taxRate: 15, lineTotal: 1000 }],
    });
    // Cancelled — must be excluded
    await seedCustomerInvoice({
      ref: `${TAG}-inv-cancel`,
      invoiceDate: "2024-02-20",
      subtotal: 9999,
      vat: 1500,
      status: "cancelled",
      lines: [{ taxRate: 15, lineTotal: 9999 }],
    });

    // Input VAT — one in Q1, one outside
    await seedVatInputJournal("2024-01-20", 100);
    await seedVatInputJournal("2024-03-30", 50);
    await seedVatInputJournal("2024-04-10", 999); // excluded

    const vr = await computeVatReturn(companyId, 2024, 1);

    expect(vr.companyId).toBe(companyId);
    expect(vr.year).toBe(2024);
    expect(vr.quarter).toBe(1);
    expect(vr.periodStart).toBe("2024-01-01");
    expect(vr.periodEnd).toBe("2024-03-31");

    expect(vr.outputVat.pos).toBe(150);
    expect(vr.outputVat.customerInvoices).toBe(300);
    expect(vr.outputVat.total).toBe(450);

    expect(vr.inputVat.fromJournals).toBe(150);
    expect(vr.inputVat.total).toBe(150);

    expect(vr.netPayable).toBe(300);

    // POS net (1000) + invoice standard line (2000) = 3000
    expect(vr.supplies.standardRated).toBe(3000);
    expect(vr.supplies.zeroRated).toBe(500);
    expect(vr.supplies.exempt).toBeNull();
  });
});
