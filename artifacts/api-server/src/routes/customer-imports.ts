import { Router, type Response } from "express";
import { z } from "zod/v4";
import { db, customersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { financialTransaction, FinancialRequestError, closedFinancialIntent, isClosedFinancialIntent } from "../lib/financial-transaction";
import { IMPORT_LIMITS, importDocument, parseImportFile, readImport, signImport } from "../lib/product-import";
import { CUSTOMER_IMPORT_FIELDS, validateCustomerImport, customerReviewFacts } from "../lib/customer-import";
import { customerDirectoryActor } from "../lib/customer-directory-access";
import type { DbOrTx } from "../lib/journal-posting";
import { tryLockApprovalAuthority } from "../lib/approval-authority";

const router = Router();
async function checked(tx: DbOrTx, companyId: number, doc: z.infer<typeof importDocument>) {
  const existing = await tx.select({ id: customersTable.id, name: customersTable.name, phone: customersTable.phone,
    email: customersTable.email, taxNumber: customersTable.taxNumber }).from(customersTable).where(eq(customersTable.companyId, companyId));
  return validateCustomerImport(doc, existing);
}
function fail(res: Response, error: unknown) {
  if (error instanceof FinancialRequestError) return res.status(error.status).json({ error: error.message });
  if (error instanceof z.ZodError) return res.status(400).json({ error: "حقول غير صالحة أو غير مدعومة؛ لم تُحفظ الدفعة",
    issues: error.issues.map(i => ({ path: i.path, message: i.message })) });
  return res.status(503).json({ error: "تعذر تأكيد النتيجة؛ احتفظ بالمحاولة الأصلية واسترجعها أو أغلقها بأمان." });
}
router.get("/customers/imports", async (req, res) => {
  try {
    const actor = await customerDirectoryActor(req, true);
    res.json({ fields: CUSTOMER_IMPORT_FIELDS, required: ["name"], limits: IMPORT_LIMITS, mode: "create-only", atomic: true,
      directoryOnly: !!actor.grant });
  } catch (e) { fail(res, e); }
});
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("parse"), fileName: z.string().min(1).max(180), base64: z.string().max(349528) }).strict(),
  z.object({ action: z.literal("preview"), document: importDocument, confirmSimilarNames: z.boolean().default(false) }).strict(),
  z.object({ action: z.enum(["commit", "recover", "close"]), token: z.string().min(10).max(900000) }).strict(),
]);
router.post("/customers/imports", async (req, res) => {
  try {
    const body = input.parse(req.body);
    if (body.action === "parse" || body.action === "preview") {
      const actor = await customerDirectoryActor(req, true);
      if (body.action === "parse") {
        try { res.json(await parseImportFile(body.fileName, body.base64)); }
        catch (e) {
          if (e instanceof FinancialRequestError || e instanceof z.ZodError) throw e;
          throw new FinancialRequestError("ملف CSV/UTF-8 أو XLSX غير صالح أو يتجاوز حدود فك الضغط", 400);
        }
        return;
      }
      const result = await checked(db, actor.companyId, body.document);
      const canCommit = result.canCommit && (!result.warnings.length || body.confirmSimilarNames);
      res.json({ ...result, canCommit, token: canCommit ?
        signImport(actor.companyId, actor.userId, body.document, "customers", customerReviewFacts(result)) : null });
      return;
    }
    if (!req.get("Idempotency-Key")) throw new FinancialRequestError("يلزم معرّف محاولة ثابت", 400);
    await customerDirectoryActor(req, body.action === "commit");
    req.body = { action: "commit", token: body.token };
    const result = await financialTransaction(req, async tx => {
      if (body.action === "commit") {
        await tx.execute(sql`LOCK TABLE customers IN SHARE ROW EXCLUSIVE MODE`);
        if (!await tryLockApprovalAuthority(tx))
          throw new FinancialRequestError("تجري مراجعة للصلاحيات بالتزامن؛ احتفظ بالمحاولة واسترجعها أو أغلقها بأمان", 409);
      }
      const actor = await customerDirectoryActor(req, body.action === "commit", tx);
      if (body.action === "recover") throw new FinancialRequestError("لا توجد نتيجة محفوظة مؤكدة؛ احتفظ بالمحاولة أو أغلقها بأمان", 409);
      const doc = readImport(body.token, actor.companyId, actor.userId, body.action === "close", "customers");
      if (body.action === "close") {
        await audit(tx, actor, "customer_import.closed", { rows: doc.rows.length });
        return closedFinancialIntent;
      }
      const current = await checked(tx, actor.companyId, doc);
      if (!current.canCommit) throw new FinancialRequestError("تغيرت بيانات المعاينة؛ أغلق المحاولة بأمان وأعد المراجعة", 409);
      readImport(body.token, actor.companyId, actor.userId, false, "customers", customerReviewFacts(current));
      const customers = await tx.insert(customersTable).values(current.customers.map(c => ({
        ...c, companyId: actor.companyId, totalOrders: 0, totalSpent: "0", creditLimit: "0",
        paymentTermsDays: 0, defaultPricelistId: null, linkedCompanyId: null,
      }))).returning({ id: customersTable.id, name: customersTable.name });
      await audit(tx, actor, "customer_import.committed", { customerIds: customers.map(c => c.id), rows: customers.length });
      return { state: "completed" as const, accepted: customers.length, rejected: 0, customers };
    }, async tx => { await customerDirectoryActor(req, false, tx); }, { acceptClosedReceipt: body.action !== "commit" });
    res.json(isClosedFinancialIntent(result) ? { state: "closed", accepted: 0, rejected: 0 } : result);
  } catch (e) { fail(res, e); }
});
async function audit(tx: DbOrTx, actor: Awaited<ReturnType<typeof customerDirectoryActor>>, action: string, source: unknown) {
  await tx.execute(sql`INSERT INTO audit_logs(user_id,user_name,company_id,action,entity,details)
    SELECT id,name,${actor.companyId},${action},'customer_import',
    ${JSON.stringify({ source, grant: actor.grant })} FROM users WHERE id=${actor.userId}`);
}
export default router;
