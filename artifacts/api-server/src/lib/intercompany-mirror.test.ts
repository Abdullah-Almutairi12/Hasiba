import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  db, companiesTable, usersTable, userCompaniesTable, suppliersTable,
  customersTable, purchaseOrdersTable, salesOrdersTable,
  intercompanyLinksTable, customerInvoicesTable, invoicesTable,
} from "@workspace/db";
import { mirrorPurchaseOrder, mirrorSalesInvoice } from "./intercompany-mirror";

// All fixtures live in the disposable cluster created by test:isolated.
const tag = `mirror-${Date.now()}`;
let source: number;
let target: number;
let userId: number;
let supplierId: number;
let customerId: number;
const actor = () => ({ userId, userName: "test-finance" });

beforeAll(async () => {
  const [a, b] = await db.insert(companiesTable).values([
    { name: `${tag}-source` }, { name: `${tag}-target` },
  ]).returning();
  source = a.id;
  target = b.id;
  const [user] = await db.insert(usersTable).values({
    name: tag, email: `${tag}@example.invalid`, passwordHash: "not-a-login-hash", role: "accountant",
  }).returning();
  userId = user.id;
  await db.insert(userCompaniesTable).values({ userId, companyId: source, role: "accountant", isDefault: true });
  const [supplier] = await db.insert(suppliersTable).values({
    name: tag, companyId: source, linkedCompanyId: target,
  }).returning();
  supplierId = supplier.id;
  const [customer] = await db.insert(customersTable).values({
    name: tag, companyId: source, linkedCompanyId: target,
  }).returning();
  customerId = customer.id;
});

async function order(suffix: string) {
  const [row] = await db.insert(purchaseOrdersTable).values({
    companyId: source, reference: `${tag}-${suffix}`, supplierId,
    supplierName: tag, orderDate: "2026-01-01", subtotal: "100", vat: "15", total: "115",
  }).returning();
  return row;
}

describe("intercompany ownership and transaction boundaries", () => {
  it("rejects a user without finance access to the target; creates no mirror", async () => {
    const po = await order("denied");
    await expect(mirrorPurchaseOrder({ poId: po.id, sourceCompanyId: source, actor: actor() }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    const links = await db.select().from(intercompanyLinksTable).where(
      and(eq(intercompanyLinksTable.kind, "purchase_order"), eq(intercompanyLinksTable.sourceDocId, po.id)),
    );
    expect(links).toHaveLength(0);
  });

  it("stamps the target company and serializes duplicate/concurrent requests", async () => {
    await db.insert(userCompaniesTable).values({ userId, companyId: target, role: "accountant" });
    const po = await order("allowed");
    const input = { poId: po.id, sourceCompanyId: source, actor: actor() };
    const [first, retry] = await Promise.all([mirrorPurchaseOrder(input), mirrorPurchaseOrder(input)]);
    expect(first).not.toBeNull();
    expect(retry).toEqual(first);
    const [mirror] = await db.select().from(salesOrdersTable).where(eq(salesOrdersTable.id, first!.targetSoId));
    expect(mirror.companyId).toBe(target);
    expect(Number(mirror.total)).toBe(115);
    const links = await db.select().from(intercompanyLinksTable).where(
      and(eq(intercompanyLinksTable.kind, "purchase_order"), eq(intercompanyLinksTable.sourceDocId, po.id)),
    );
    expect(links).toHaveLength(1);
  });

  it("rejects a forged source company even when the user has access to both", async () => {
    const po = await order("forged-source");
    await expect(mirrorPurchaseOrder({ poId: po.id, sourceCompanyId: target, actor: actor() }))
      .rejects.toMatchObject({ code: "INVALID_REFERENCE" });
  });

  it("rolls back the source, mirror, link and counterparty when a later transaction step fails", async () => {
    const reference = `${tag}-rollback`;
    await expect(db.transaction(async (tx) => {
      const [po] = await tx.insert(purchaseOrdersTable).values({
        companyId: source, reference, supplierId, supplierName: tag, orderDate: "2026-01-01",
      }).returning();
      await mirrorPurchaseOrder({ poId: po.id, sourceCompanyId: source, actor: actor(), tx });
      throw new Error("deliberate downstream failure");
    })).rejects.toThrow("deliberate downstream failure");
    expect(await db.select().from(purchaseOrdersTable).where(eq(purchaseOrdersTable.reference, reference))).toHaveLength(0);
    expect(await db.select().from(salesOrdersTable).where(eq(salesOrdersTable.reference, `IC-${reference}-C${target}`))).toHaveLength(0);
    expect(await db.select().from(intercompanyLinksTable).where(eq(intercompanyLinksTable.sourceRef, reference))).toHaveLength(0);
  });

  it("sales-invoice mirrors use the linked company's ID and remain idempotent", async () => {
    const [invoice] = await db.insert(customerInvoicesTable).values({
      companyId: source, reference: `${tag}-invoice`, customerId, customerName: tag,
      invoiceDate: "2026-01-01", subtotal: "100", vat: "15", total: "115",
    }).returning();
    const input = { invoiceId: invoice.id, sourceCompanyId: source, actor: actor() };
    const first = await mirrorSalesInvoice(input);
    const retry = await mirrorSalesInvoice(input);
    expect(first).not.toBeNull();
    expect(retry).toEqual(first);
    const [mirror] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, first!.targetInvoiceId));
    expect(mirror.companyId).toBe(target);
    await expect(mirrorSalesInvoice({ ...input, sourceCompanyId: target })).rejects.toMatchObject({ code: "INVALID_REFERENCE" });
  });
});
