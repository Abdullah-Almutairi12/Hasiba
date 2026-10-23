/** Extends ONLY the disposable --browser database; never imported by the app. */
import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
const file = "/tmp/hasba-browser-state.json";
const state = JSON.parse(readFileSync(file, "utf8"));
const url = new URL(state.env.TEST_DATABASE_URL);
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.username, "hasba_test");
assert.equal(url.pathname, "/hasba_test_verify");
assert.equal(state.env.DATABASE_URL, state.env.TEST_DATABASE_URL);
Object.assign(process.env, state.env);
const { db, pool, usersTable, userCompaniesTable, branchesTable } = await import("@workspace/db");
const { notify } = await import("../lib/workflow-notifications");
const [a, b] = state.accounts;
const [actor] = await db.select().from(usersTable).where(eq(usersTable.email, a.email));
assert.ok(actor && a.companyId !== b.companyId);
await db.insert(userCompaniesTable).values({ userId: actor.id, companyId: b.companyId, role: "manager" }).onConflictDoNothing();
for (const [account, suffix] of [[a, "أ"], [b, "ب"]] as const) {
  const [branch] = await db.insert(branchesTable).values({
    companyId: account.companyId, name: `Synthetic workflow ${suffix}`, nameAr: `فرع اختبار ${suffix}`, city: "Synthetic",
  }).returning();
  account.workflowBranchId = branch.id;
  await notify(actor.id, { companyId: account.companyId, type: "system", title: `تنبيه اختبار الشركة ${suffix}`, message: "بيانات مصطنعة لفحص العزل", channel: "inapp" });
}
await db.execute(sql`INSERT INTO notification_inbox(user_id,type,title,message) VALUES(${actor.id},'system','تنبيه مجهول الملكية لا يجب عرضه','legacy synthetic')`);
state.workflow = { sharedUserId: actor.id, companyA: a.companyId, companyB: b.companyId };
writeFileSync(file, JSON.stringify(state), { mode: 0o600 });
await pool.end();
console.log("Isolated workflow browser fixtures ready; two companies, shared membership, owned and quarantined notifications.");
