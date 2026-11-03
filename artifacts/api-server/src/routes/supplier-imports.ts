import { Router, type Response } from "express";
import { z } from "zod/v4";
import { db, suppliersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { financialTransaction, FinancialRequestError, closedFinancialIntent, isClosedFinancialIntent } from "../lib/financial-transaction";
import { requestProcurementActor, procurementAudit } from "../lib/procurement-authority";
import { IMPORT_LIMITS, importDocument, parseImportFile, readImport, signImport } from "../lib/product-import";
import { SUPPLIER_IMPORT_FIELDS, validateSupplierImport, supplierReviewFacts } from "../lib/supplier-import";
import { supplierVatConflict } from "../lib/supplier-identity";
import type { DbOrTx } from "../lib/journal-posting";
import { tryLockApprovalAuthority } from "../lib/approval-authority";

const router = Router();
const action = (write: boolean) => `procurement.suppliers.${write ? "create" : "read"}`;
async function checked(tx: DbOrTx, companyId: number, doc: z.infer<typeof importDocument>) {
  const existing = await tx.select({ id: suppliersTable.id, name: suppliersTable.name, vatNumber: suppliersTable.vatNumber })
    .from(suppliersTable).where(eq(suppliersTable.companyId, companyId));
  return validateSupplierImport(doc, existing);
}
function fail(res: Response, error: unknown) {
  if (error instanceof FinancialRequestError) return res.status(error.status).json({ error: error.message });
  if (error instanceof z.ZodError) return res.status(400).json({ error: "حقول غير صالحة أو غير مدعومة؛ لم تُحفظ الدفعة", issues: error.issues.map(i => ({ path: i.path, message: i.message })) });
  if (supplierVatConflict(error)) return res.status(409).json({ error: "تعارض رقم ضريبي داخل الشركة؛ لم تُحفظ الدفعة. احتفظ بالمحاولة حتى إغلاقها بأمان." });
  return res.status(503).json({ error: "تعذر تأكيد النتيجة؛ احتفظ بالمحاولة الأصلية واسترجعها أو أغلقها بأمان." });
}
router.get("/suppliers/imports", async (req, res) => {
  try {
    await requestProcurementActor(req, action(true));
    res.json({ fields: SUPPLIER_IMPORT_FIELDS, required: ["name"], limits: IMPORT_LIMITS, mode: "create-only", atomic: true });
  } catch (e) { fail(res, e); }
});
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("parse"), fileName: z.string().min(1).max(180), base64: z.string().max(349528) }).strict(),
  z.object({ action: z.literal("preview"), document: importDocument, confirmSimilarNames: z.boolean().default(false) }).strict(),
  z.object({ action: z.enum(["commit", "recover", "close"]), token: z.string().min(10).max(900000) }).strict(),
]);
router.post("/suppliers/imports", async (req, res) => {
  try {
    const body = input.parse(req.body);
    if (body.action === "parse" || body.action === "preview") {
      const actor = await requestProcurementActor(req, action(true));
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
      res.json({ ...result, canCommit, token: canCommit
        ? signImport(actor.companyId, actor.userId, body.document, "suppliers", supplierReviewFacts(result)) : null });
      return;
    }
    if (!req.get("Idempotency-Key")) throw new FinancialRequestError("يلزم معرّف محاولة ثابت", 400);
    // This preliminary check is autocommit. Holding membership FOR SHARE
    // inside the intent transaction before the table wait blocks revocation.
    await requestProcurementActor(req, action(body.action === "commit"));
    req.body = { action: "commit", token: body.token };
    const result = await financialTransaction(req, async tx => {
      if (body.action === "commit") {
        await tx.execute(sql`LOCK TABLE suppliers IN SHARE ROW EXCLUSIVE MODE`);
        if (!await tryLockApprovalAuthority(tx))
          throw new FinancialRequestError("تجري مراجعة للصلاحيات بالتزامن؛ لم تُحفظ الدفعة. احتفظ بالمحاولة واسترجعها أو أغلقها بأمان", 409);
      }
      const actor = await requestProcurementActor(req, action(body.action === "commit"), tx, body.action === "commit");
      if (body.action === "recover") throw new FinancialRequestError("لا توجد نتيجة محفوظة مؤكدة؛ احتفظ بالمحاولة الأصلية أو أغلقها بأمان", 409);
      const doc = readImport(body.token, actor.companyId, actor.userId, body.action === "close", "suppliers");
      if (body.action === "close") {
        await procurementAudit(tx, actor, "supplier_import.closed", { rows: doc.rows.length });
        return closedFinancialIntent;
      }
      // Covers existing create/edit/from-scan writers as well as other imports.
      // The table lock precedes both the authority fence and membership reads:
      // a revocation committed while waiting is visible at authorization above.
      const current = await checked(tx, actor.companyId, doc);
      if (!current.canCommit) throw new FinancialRequestError("تغيرت البيانات أو ظهرت تكرارات؛ لم تُحفظ الدفعة. أغلق المحاولة بأمان ثم أعد المعاينة", 409);
      readImport(body.token, actor.companyId, actor.userId, false, "suppliers", supplierReviewFacts(current));
      const suppliers = await tx.insert(suppliersTable).values(current.suppliers.map(s => ({
        ...s, companyId: actor.companyId, balance: "0", linkedCompanyId: null,
      }))).returning({ id: suppliersTable.id, name: suppliersTable.name, vatNumber: suppliersTable.vatNumber });
      await procurementAudit(tx, actor, "supplier_import.committed", { supplierIds: suppliers.map(s => s.id), rows: suppliers.length });
      return { state: "completed" as const, accepted: suppliers.length, rejected: 0, suppliers };
    }, async tx => { await requestProcurementActor(req, action(false), tx); }, { acceptClosedReceipt: body.action !== "commit" });
    res.json(isClosedFinancialIntent(result) ? { state: "closed", accepted: 0, rejected: 0 } : result);
  } catch (e) { fail(res, e); }
});
export default router;
