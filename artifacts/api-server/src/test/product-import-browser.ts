/** Disposable native catalogue-import host. Never connects to ordinary data. */
import "reflect-metadata";
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
const state = JSON.parse(readFileSync("/tmp/hasba-browser-state.json", "utf8"));
const url = new URL(state.env.TEST_DATABASE_URL);
assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.username, "hasba_test");
assert.equal(url.pathname, "/hasba_test_verify"); assert.equal(state.env.DATABASE_URL, state.env.TEST_DATABASE_URL);
assert.equal(state.env.ACCOUNT_ISOLATED_TEST, "true");
Object.assign(process.env, state.env, { NODE_ENV: "test", VITEST: "true", LOG_LEVEL: "error",
  SMTP_HOST: "", SMTP_USER: "", SMTP_PASS: "", SENTRY_DSN: "", OPENAI_API_KEY: "", AI_INTEGRATIONS_OPENAI_API_KEY: "" });
const { default: app, assertApplicationReady } = await import("../app");
await assertApplicationReady();
const { db, companiesTable, usersTable, userCompaniesTable, categoriesTable } = await import("@workspace/db");
const { default: bcrypt } = await import("bcryptjs");
const { default: ExcelJS } = await import("exceljs");
const dir = resolve(import.meta.dirname, "../../../../generated-artifacts/product-import");
mkdirSync(resolve(dir, "fixtures"), { recursive: true });
mkdirSync(resolve(dir, "screenshots"), { recursive: true });
const privateFile = resolve(dir, "private-access.json");
if (!existsSync(privateFile)) {
  const tag = Date.now().toString(), password = randomBytes(24).toString("base64url");
  const hash = await bcrypt.hash(password, 10), memberships = [];
  for (let i = 0; i < 2; i++) {
    const [company] = await db.insert(companiesTable).values({ name: `متجر استيراد اصطناعي ${tag}-${i}` }).returning();
    const [user] = await db.insert(usersTable).values({ name: "مسؤول عرض اصطناعي", email: `import-${tag}-${i}@test.local`, passwordHash: hash, role: "owner", isActive: true }).returning();
    await db.insert(userCompaniesTable).values({ userId: user.id, companyId: company.id, role: "owner", isDefault: true });
    memberships.push({ companyId: company.id, userId: user.id, email: user.email });
  }
  const [category] = await db.insert(categoriesTable).values({ name: `import-${tag}`, nameAr: "فئة أصناف اختبار" }).returning();
  const headers = ["nameAr", "name", "sku", "categoryId", "price", "costPrice", "unit", "barcode"];
  const row = (n: number, label: string) => [label, `Synthetic item ${n}`, `0000${tag}-${n}`, category.id, "12.30", "4.50", "قطعة", `00099${tag}${n}`];
  const csv = (rows: unknown[][]) => "\uFEFF" + [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const validRows = [row(1, "بن عربي اصطناعي"), row(2, "شاي عربي اصطناعي")];
  writeFileSync(resolve(dir, "fixtures/valid.csv"), csv(validRows));
  const invalid = row(5, "صف غير صالح"); invalid[4] = "-1"; invalid[6] = "وحدة غير مدعومة";
  writeFileSync(resolve(dir, "fixtures/invalid.csv"), csv([invalid, [...invalid]]));
  const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet("أصناف");
  const xlsxRows = [row(3, "عصير عربي اصطناعي"), row(4, "بهار عربي اصطناعي")];
  sheet.addRows([headers, ...xlsxRows]); sheet.getColumn(3).numFmt = "@"; sheet.getColumn(8).numFmt = "@";
  await workbook.xlsx.writeFile(resolve(dir, "fixtures/valid.xlsx"));
  writeFileSync(resolve(dir, "fixtures/expected.json"), JSON.stringify({ categoryId: category.id, csvRows: validRows, xlsxRows }, null, 2));
  writeFileSync(privateFile, JSON.stringify({ password, memberships, categoryId: category.id }, null, 2), { mode: 0o600 });
}
const { verificationSource } = await import(new URL("../../../../scripts/verification-source.mjs", import.meta.url).href);
writeFileSync(resolve(dir, "host-source.json"), JSON.stringify({ startedAt: new Date().toISOString(),
  source: await verificationSource(resolve(dir, "../..")), isolated: true, taxGateOverridden: false, externalChannels: false }, null, 2));
app.listen(8080, "0.0.0.0", () => console.log("[catalog-import] isolated native API ready:8080"));
