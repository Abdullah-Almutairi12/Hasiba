import { writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { db, pool, companiesTable, usersTable, userCompaniesTable } from "@workspace/db";

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
  accounts.push({ email, password, companyId: company.id, role });
}
writeFileSync(process.env.HASBA_BROWSER_STATE, JSON.stringify({
  // Both URLs point only to the generated, disposable loopback cluster.
  env: { DATABASE_URL: process.env.TEST_DATABASE_URL, TEST_DATABASE_URL: process.env.TEST_DATABASE_URL, VITEST: "true" },
  accounts,
}), { mode: 0o600 });
await pool.end();
