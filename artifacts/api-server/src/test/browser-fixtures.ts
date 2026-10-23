import { writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { db, pool, companiesTable, usersTable, userCompaniesTable, customersTable, fiscalYearsTable, fiscalPeriodsTable, categoriesTable, productsTable, customerInvoicesTable, customerInvoiceLinesTable } from "@workspace/db";
import { branchesTable, warehousesTable } from "@workspace/db";
import { posSessionsTable } from "@workspace/db";
import { accountsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { recordStockMove } from "../lib/stock-engine";

if (!process.env.HASBA_BROWSER_STATE || !process.env.TEST_DATABASE_URL) {
  throw new Error("Run through node scripts/test-isolated.mjs --browser");
}
const tag = randomUUID().slice(0, 8);
const password = randomUUID();
const hash = await bcrypt.hash(password, 10);
const accounts = [];
for (const role of ["owner", "sales"] as const) {
  const [company] = await db.insert(companiesTable).values({
    name: `Verification ${role} ${tag}`,
    ...(role === "owner" && process.env.HASBA_BROWSER_POS === "true" ? { businessType: "retail" } : {}),
    ...(role === "owner" && process.env.HASBA_BROWSER_RETURN_SETTLEMENT === "true" ? { vatRegistrationStatus: "not_registered" } : {}),
  }).returning();
  const email = `verify-${role}-${tag}@example.invalid`;
  const [user] = await db.insert(usersTable).values({
    name: `Verification ${role}`, email, passwordHash: hash, role, isActive: true, has2fa: false,
  }).returning();
  await db.insert(userCompaniesTable).values({ companyId: company.id, userId: user.id, role, isDefault: true });
  const year = new Date().getUTCFullYear();
  const [fiscalYear] = await db.insert(fiscalYearsTable).values({
    companyId: company.id, name: `Verification ${year}`, startDate: `${year}-01-01`, endDate: `${year}-12-31`,
  }).returning();
  await db.insert(fiscalPeriodsTable).values({
    fiscalYearId: fiscalYear.id, name: "Verification", startDate: `${year}-01-01`, endDate: `${year}-12-31`,
  });
  const [customer] = await db.insert(customersTable).values({ companyId: company.id, name: `Verification customer ${tag}` }).returning();
  const [category] = await db.insert(categoriesTable).values({ name: `Verification ${role} ${tag}`, nameAr: "تجربة" }).returning();
  const [product] = await db.insert(productsTable).values({
    companyId: company.id, categoryId: category.id, name: `Verification product ${tag}`,
    nameAr: "منتج اختبار", sku: `verify-${role}-${tag}`, price: "100", costPrice: "50", stock: "0",
  }).returning();
  let posSession;
  if (role === "owner" && process.env.HASBA_BROWSER_POS === "true") {
    const [branch] = await db.insert(branchesTable).values({
      companyId: company.id, name: `POS ${tag}`, nameAr: "فرع اختبار البيع", city: "Riyadh",
    }).returning();
    const [warehouse] = await db.insert(warehousesTable).values({
      companyId: company.id, branchId: branch.id, name: `POS ${tag}`, nameAr: "مستودع اختبار البيع", isDefault: true,
    }).returning();
    await db.transaction((tx) => recordStockMove(tx, {
      companyId: company.id, productId: product.id, toWarehouseId: warehouse.id,
      quantity: 20, unitCost: 50, kind: "receipt", createdBy: user.id,
    }));
    const [session] = await db.insert(posSessionsTable).values({
      branchId: branch.id, sessionNumber: `POS-VERIFY-${tag}`, cashierName: "كاشير الاختبار", openingCash: "0",
    }).returning();
    posSession = { id: session.id, branchId: branch.id, warehouseId: warehouse.id };
    if (process.env.HASBA_BROWSER_RETURN_SETTLEMENT === "true") {
      for (const staffRole of ["cashier", "manager"] as const) {
        const email = `verify-${staffRole}-${tag}@example.invalid`;
        const [staff] = await db.insert(usersTable).values({ name: `Verification ${staffRole}`, email,
          passwordHash: hash, role: staffRole, branchId: branch.id, isActive: true, has2fa: false }).returning();
        await db.insert(userCompaniesTable).values({ companyId: company.id, userId: staff.id, role: staffRole, isDefault: true });
        accounts.push({ role: staffRole, companyId: company.id, userId: staff.id, email, password, customerId: customer.id,
          productId: product.id, posSession });
      }
    }
  }
  let receiptInvoice;
  let receiptInvoices;
  let returnInvoice;
  if (role === "owner" && process.env.HASBA_BROWSER_REVALUATIONS === "true") {
    const [branch] = await db.insert(branchesTable).values({
      companyId: company.id, name: `Revaluation ${tag}`, nameAr: "فرع إعادة تقييم", city: "Test",
    }).returning();
    const [warehouse] = await db.insert(warehousesTable).values({
      companyId: company.id, branchId: branch.id, name: `Revaluation ${tag}`, nameAr: "مستودع إعادة تقييم", isDefault: true,
    }).returning();
    await db.update(productsTable).set({ costingMethod: "standard", costPrice: "30" }).where(eq(productsTable.id, product.id));
    await db.transaction((tx) => recordStockMove(tx, {
      companyId: company.id, productId: product.id, toWarehouseId: warehouse.id,
      quantity: 6, unitCost: 10, kind: "receipt", createdBy: user.id,
    }));
    await db.insert(accountsTable).values({
      code: `REVAL-${tag}`, name: `Revaluation variance ${tag}`, nameAr: "فرق إعادة تقييم الاختبار", type: "expense",
    });
    const creatorEmail = `verify-inventory-${tag}@example.invalid`;
    const [creator] = await db.insert(usersTable).values({
      name: "Verification inventory", email: creatorEmail, passwordHash: hash, role: "inventory", isActive: true, has2fa: false,
    }).returning();
    await db.insert(userCompaniesTable).values({ companyId: company.id, userId: creator.id, role: "inventory", isDefault: true });
    accounts.push({ email: creatorEmail, password, companyId: company.id, role: "inventory" });
  }
  if (role === "owner" && process.env.HASBA_BROWSER_RETURNS === "true") {
    const [branch] = await db.insert(branchesTable).values({
      companyId: company.id, name: `Verification ${tag}`, nameAr: "فرع اختبار", city: "Test",
    }).returning();
    const [warehouse] = await db.insert(warehousesTable).values({
      companyId: company.id, branchId: branch.id, name: `Verification ${tag}`,
      nameAr: "مستودع اختبار", isDefault: true,
    }).returning();
    const [invoice] = await db.insert(customerInvoicesTable).values({
      companyId: company.id, customerId: customer.id, customerName: customer.name,
      reference: `SINV-RETURN-${tag}`, status: "open",
      invoiceDate: new Date().toISOString().slice(0, 10),
      subtotal: "400", total: "400", amountPaid: "0", createdBy: user.id,
    }).returning();
    const [line] = await db.insert(customerInvoiceLinesTable).values({
      invoiceId: invoice.id, productId: product.id, description: "Synthetic return item",
      quantity: "4", unitPrice: "100", lineTotal: "400", taxRate: "0",
    }).returning();
    const issue = await db.transaction(async (tx) => {
      const common = { companyId: company.id, productId: product.id, quantity: 4,
        unitCost: 50, createdBy: user.id, skipJournal: true };
      await recordStockMove(tx, { ...common, kind: "receipt", toWarehouseId: warehouse.id });
      return recordStockMove(tx, { ...common, kind: "issue", fromWarehouseId: warehouse.id,
        invoiceLineId: line.id, sourceType: "invoice", sourceId: invoice.id });
    });
    returnInvoice = { id: invoice.id, reference: invoice.reference, lineId: line.id,
      productId: product.id, warehouseId: warehouse.id, issueMoveId: issue.moveId,
      soldQuantity: 4, returnQuantity: 1, unitCost: 50, description: line.description };
  }
  if (role === "owner" && process.env.HASBA_BROWSER_RECEIPTS === "true") {
    const [invoice] = await db.insert(customerInvoicesTable).values({
      companyId: company.id, customerId: customer.id, customerName: customer.name,
      reference: `SINV-VERIFY-${tag}`, status: "open",
      invoiceDate: new Date().toISOString().slice(0, 10),
      subtotal: "300", total: "300", amountPaid: "0", createdBy: user.id,
    }).returning();
    await db.insert(customerInvoiceLinesTable).values({
      invoiceId: invoice.id, description: "Synthetic receipt balance", quantity: "1",
      unitPrice: "300", lineTotal: "300", taxRate: "0",
    });
    receiptInvoice = { id: invoice.id, reference: invoice.reference, total: 300, receiptAmount: 50 };
    if (process.env.HASBA_BROWSER_MULTI_RECEIPTS === "true") {
      const [second] = await db.insert(customerInvoicesTable).values({
        companyId: company.id, customerId: customer.id, customerName: customer.name,
        reference: `SINV-VERIFY-SECOND-${tag}`, status: "open",
        invoiceDate: new Date().toISOString().slice(0, 10),
        subtotal: "200", total: "200", amountPaid: "0", createdBy: user.id,
      }).returning();
      await db.insert(customerInvoiceLinesTable).values({
        invoiceId: second.id, description: "Second synthetic receipt balance", quantity: "1",
        unitPrice: "200", lineTotal: "200", taxRate: "0",
      });
      receiptInvoices = [
        { id: invoice.id, reference: invoice.reference, total: 300, allocation: 20 },
        { id: second.id, reference: second.reference, total: 200, allocation: 30 },
      ];
    }
  }
  accounts.push({ email, password, companyId: company.id, role, customerId: customer.id, customerName: customer.name, productId: product.id, posSession, receiptInvoice, receiptInvoices, returnInvoice });
}
writeFileSync(process.env.HASBA_BROWSER_STATE, JSON.stringify({
  // Both URLs point only to the generated, disposable loopback cluster.
  env: { DATABASE_URL: process.env.TEST_DATABASE_URL, TEST_DATABASE_URL: process.env.TEST_DATABASE_URL, VITEST: "true" },
  accounts,
}), { mode: 0o600 });
await pool.end();
