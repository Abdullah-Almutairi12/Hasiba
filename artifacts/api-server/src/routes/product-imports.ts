import { Router } from "express";
import { z } from "zod/v4";
import { db, categoriesTable, productsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { financialTransaction, FinancialRequestError, closedFinancialIntent, isClosedFinancialIntent } from "../lib/financial-transaction";
import { lockApprovalAuthority } from "../lib/approval-authority";
import { inventoryActor, auditInventoryMutation } from "../lib/scoped-inventory-actor";
import type { DbOrTx } from "../lib/journal-posting";
import { IMPORT_FIELDS, IMPORT_LIMITS, IMPORT_UNITS, importDocument, parseImportFile, validateImport, signImport, readImport } from "../lib/product-import";
import type { Request } from "express";

const router = Router();
async function authority(tx: DbOrTx, req: Request, write: boolean) {
  await lockApprovalAuthority(tx);
  const actor = await inventoryActor(tx, req, null);
  // The existing catalogue writer uses inventoryGuard; a stock-movement grant
  // must not silently grant company-wide catalogue creation.
  if (write && (actor.grant || !["owner", "manager", "inventory"].includes(actor.role))) {
    throw new FinancialRequestError("يلزم إذن إنشاء الأصناف القائم؛ مسؤولية حركة المخزون وحدها لا تمنحه", 403);
  }
  return actor;
}
async function preview(tx: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0], companyId: number, document: z.infer<typeof importDocument>) {
  const categories = await tx.select({ id: categoriesTable.id }).from(categoriesTable);
  const existing = await tx.select({ sku: productsTable.sku, barcode: productsTable.barcode }).from(productsTable).where(eq(productsTable.companyId, companyId));
  return validateImport(document, new Set(categories.map(c => c.id)), existing);
}
function fail(res: import("express").Response, error: unknown) {
  if (error instanceof FinancialRequestError) return res.status(error.status).json({ error: error.message });
  if (error instanceof z.ZodError) return res.status(400).json({ error: "الحقول أو قيم الملف غير صالحة؛ لا يُحفظ أي صنف", issues: error.issues.map(i => ({ path: i.path, message: i.message })) });
  const code = (error as { cause?: { code?: string }; code?: string })?.cause?.code ?? (error as { code?: string })?.code;
  if (code === "23505") return res.status(409).json({ error: "تعارض في أحد أكواد الأصناف داخل الشركة الحالية؛ لم تُحفظ الدفعة. أغلق المحاولة بأمان ثم راجع الملف." });
  return res.status(503).json({ error: "تعذر تأكيد نتيجة الاستيراد. احتفظ بالمحاولة واسترجعها أو أغلقها بأمان قبل بدء غيرها." });
}
router.get("/products/imports", async (req, res) => {
  try {
    const result = await db.transaction(async tx => {
      await authority(tx, req, true);
      return { fields: IMPORT_FIELDS, required: IMPORT_FIELDS.filter(f => f !== "barcode"), units: IMPORT_UNITS,
        categories: await tx.select().from(categoriesTable), limits: IMPORT_LIMITS,
        mode: "create-only", atomic: true, defaults: { stock: 0, minStock: 5, trackingMode: "none", costingMethod: "average" } };
    });
    res.json(result);
  } catch (e) { fail(res, e); }
});
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("parse"), fileName: z.string().min(1).max(180), base64: z.string().max(349528) }).strict(),
  z.object({ action: z.literal("preview"), document: importDocument }).strict(),
  z.object({ action: z.enum(["commit", "recover", "close"]), token: z.string().min(10).max(900000) }).strict(),
]);
router.post("/products/imports", async (req, res) => {
  try {
    const body = input.parse(req.body);
    if (body.action === "parse" || body.action === "preview") {
      const result = await db.transaction(async tx => {
        const actor = await authority(tx, req, true);
        if (body.action === "parse") {
          try { return await parseImportFile(body.fileName, body.base64); }
          catch (e) {
            if (e instanceof FinancialRequestError || e instanceof z.ZodError) throw e;
            throw new FinancialRequestError("ملف CSV/UTF-8 أو XLSX غير صالح أو يتجاوز حدود فك الضغط", 400);
          }
        }
        const result = await preview(tx, actor.companyId, body.document);
        return { ...result, token: result.canCommit ? signImport(actor.companyId, actor.userId, body.document) : null };
      });
      res.json(result); return;
    }
    if (!req.get("Idempotency-Key")) throw new FinancialRequestError("يلزم معرّف محاولة ثابت قبل الاستيراد أو الاسترجاع", 400);
    // One original identity/hash across execution, recovery and durable closure.
    req.body = { action: "commit", token: body.token };
    const result = await financialTransaction(req, async tx => {
      const actor = await authority(tx, req, body.action === "commit");
      if (body.action === "recover") throw new FinancialRequestError("لا توجد نتيجة مؤكدة محفوظة. احتفظ بالمحاولة؛ يمكنك إعادة الطلب الأصلي أو إغلاقه بأمان.", 409);
      const document = readImport(body.token, actor.companyId, actor.userId, body.action === "close");
      if (body.action === "close") {
        await auditInventoryMutation(tx, actor, "product_import.closed", "products", 0);
        return closedFinancialIntent;
      }
      // Serialize against ALL existing catalogue writers, not only this importer.
      await tx.execute(sql`LOCK TABLE products IN SHARE ROW EXCLUSIVE MODE`);
      await authority(tx, req, true); // recheck after waiting, before validation/write
      const checked = await preview(tx, actor.companyId, document);
      if (!checked.canCommit) throw new FinancialRequestError("تغيرت البيانات أو ظهرت تكرارات؛ لم تُحفظ الدفعة. أغلق المحاولة بأمان ثم أعد المعاينة.", 409);
      const products = await tx.insert(productsTable).values(checked.products.map(p => ({
        ...p, companyId: actor.companyId, stock: "0", minStock: 5, trackingMode: "none", costingMethod: "average",
      }))).returning({ id: productsTable.id, sku: productsTable.sku, barcode: productsTable.barcode, nameAr: productsTable.nameAr });
      await auditInventoryMutation(tx, actor, "product_import.committed", "products", products[0].id);
      return { state: "completed" as const, accepted: products.length, rejected: 0, products };
    }, async tx => { await authority(tx, req, false); }, { acceptClosedReceipt: body.action !== "commit" });
    res.json(isClosedFinancialIntent(result) ? { state: "closed", accepted: 0, rejected: 0 } : result);
  } catch (e) { fail(res, e); }
});
export default router;
