import { writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { db, pool, companiesTable, usersTable, userCompaniesTable, customersTable, fiscalYearsTable, fiscalPeriodsTable, categoriesTable, productsTable, customerInvoicesTable, customerInvoiceLinesTable } from "@workspace/db";

if (!process.env.HASBA_BROWSER_STATE || !process.env.TEST_DATABASE_URL) {
  throw new Error("Run through node scripts/test-isolated.mjs --browser");
}
const tag = randomUUID().slice(0, 8);
const password = randomUUID();
const hash = await bcrypt.hash(password, 10);
const accounts = [];
for (const role of ["owner", "sales"] as const) {
  const [company] = await db.insert(companiesTable).values({ name: `Verification ${role} ${tag}` }).returning();
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
  await db.insert(productsTable).values({
    companyId: company.id, categoryId: category.id, name: `Verification product ${tag}`,
    nameAr: "منتج اختبار", sku: `verify-${role}-${tag}`, price: "100", costPrice: "50", stock: "0",
  });
  let receiptInvoice;
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
  }
  accounts.push({ email, password, companyId: company.id, role, customerId: customer.id, customerName: customer.name, receiptInvoice });
}
writeFileSync(process.env.HASBA_BROWSER_STATE, JSON.stringify({
  // Both URLs point only to the generated, disposable loopback cluster.
  env: { DATABASE_URL: process.env.TEST_DATABASE_URL, TEST_DATABASE_URL: process.env.TEST_DATABASE_URL, VITEST: "true" },
  accounts,
}), { mode: 0o600 });
await pool.end();
