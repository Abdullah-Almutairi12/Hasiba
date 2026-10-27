import type { Request, Response, NextFunction } from "express";
import { db, branchesTable, warehousesTable, categoriesTable } from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { currentResponsibilities, managedProfile, responsibilityContext } from "../lib/responsibility-context";
import { teamRows } from "../lib/team-store";
import { administrativeRights } from "../lib/administration-authority";
import { procurementAction,requestProcurementActor,procurementOrderScope } from "../lib/procurement-authority";
import { assertSupplierInvoice } from "../lib/supplier-invoice-access";
import { FinancialRequestError } from "../lib/financial-transaction";

export const SCOPED_ROUTES = [
  ["GET", "/sales/invoices", "sales.read"],
  ["GET", "/sales/invoices/:id", "sales.read"],
  ["GET", "/sales/invoices/:id/pdf", "sales.invoices.print"],
  ["GET", "/workspace/access", "self"],
  ["GET", "/workspace/inventory", "inventory.read"],
  ["GET", "/workspace/inventory/transfers", "inventory.read"],
  ["GET", "/workspace/inventory/movement-options", "inventory.read"],
  ["POST", "/workspace/inventory/movement-attempts/close", "inventory.read"],
  ["POST", "/inventory/moves", "inventory.read"],
  ["POST", "/inventory/transfers", "inventory.read"],
  // Execution is rechecked inside the fresh stock transaction; committed replays require destination read.
  ["POST", "/inventory/transfers/:id/receive", "inventory.read"],
  // Count writes check live execution authority inside the transaction. A
  // committed replay needs only current read access to the SAME stocktake.
  ["GET", "/inventory/stock-takes", "inventory.read"],
  ["GET", "/inventory/stock-takes/:id", "inventory.read"],
  ["GET", "/inventory/stock-takes/:id/lookup", "inventory.read"],
  ["POST", "/inventory/stock-takes/:id/lines", "inventory.read"],
  ["PATCH", "/inventory/stock-takes/:id/lines/:lineId", "inventory.read"],
  ["POST", "/inventory/stock-takes/:id/checkpoint", "inventory.read"],
  ["POST", "/inventory/stock-takes/:id/approve", "inventory.read"],
  ["POST", "/inventory/stock-takes/:id/complete", "inventory.read"],
  ["GET", "/users/permissions", "self"],
  ["GET", "/companies", "self"],
  ["GET", "/branches", "metadata"],
  ["GET", "/warehouses", "metadata"],
  ["GET", "/products", "catalog"],
  ["GET", "/categories", "catalog"],
  ["GET", "/products/categories", "catalog"],
  ["GET", "/print/profile", "pos.read"],
  ["GET", "/sales/sellers/workspace", "pos.read"],
  ["GET", "/pos/sessions", "pos.read"],
  ["GET", "/pos/sessions/:id", "pos.read"],
  ["POST", "/pos/sessions", "pos.shift.open"],
  // A committed response is recoverable with current source read authority.
  // Fresh checkout rechecks sell and tender/discount authority inside its
  // financial transaction, after receipt lookup and under the authority fence.
  ["POST", "/pos/orders", "pos.read"],
  ["GET", "/pos/orders/:id/receipt.pdf", "pos.read"],
  ["GET", "/sales/credit-notes/:id/pdf", "pos.read"],
  ["GET", "/pos/refunds/:id/pdf", "pos.read"],
  ["GET", "/pos/sessions/:id/closing.pdf", "pos.read"],
  ["GET", "/pos/orders", "pos.read"],
  ["GET", "/pos/orders/:id", "pos.read"],
  ["GET", "/pos/returns/workspace", "pos.read"],
  ["GET", "/workflow/approval-requests/:id", "pos.read"],
  ["POST", "/pos/returns/actions", "pos.operation"],
] as const;
export function scopedRouteAction(method: string, path: string) {
  return SCOPED_ROUTES.find(([m, p]) => m === method &&
    new RegExp(`^${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/:lineId|:id/g, "\\d+")}$`).test(path))?.[2];
}
export async function managedAccessGate(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.session.userId;
    const companyId = req.session.companyId;
    if (!userId || !companyId || req.session.purpose === "administration_receipt")
      return void res.status(403).json({ error: "يلزم سياق منشأة تشغيلي موثوق قبل فحص الصلاحيات" });
    // Administrative endpoints enforce their own live company-local rights.
    // Never bypass the financial/operational route gate for administrators.
    if (/^\/administration(?:\/|$)/.test(req.path)) return next();
    // Read is field-redacted by the original settings service; writes require
    // its live company-local administrative responsibility, never a role alias.
    if(req.path==="/settings"&&(req.method==="GET"||(await administrativeRights(companyId,userId)).includes("settings")))return next();
    if (/^\/team(?:\/|$)/.test(req.path) && (await administrativeRights(companyId,userId)).length) return next();
    const profile = await managedProfile(userId, companyId);
    if (!profile) return next();
    let action: string | undefined = procurementAction(req.method, req.path) ?? scopedRouteAction(req.method, req.path);
    const approvalPath=/^\/workflow\/approval-requests(?:\/(\d+)(?:\/(act))?)?$/.exec(req.path);
    if(!action&&approvalPath&&(req.method==="GET"||req.method==="POST"&&approvalPath[2]==="act"))action="approval.workspace";
    if (action === "procurement.orders.print" && req.query.download === "1") action = "procurement.orders.export";
    if (action === "procurement.invoices.print" && req.query.download === "1") action = "procurement.invoices.export";
    if (action === "sales.invoices.print" && req.query.download === "1") action = "sales.invoices.export";
    if (action === "pos.operation") {
      action = ({
        request: "pos.return.request", re_review: "pos.return.request", approve: "pos.return.approve", receive: "pos.return.receive", payout: "pos.return.payout",
        cancel_payout: "pos.return.payout", confirm_external: "pos.return.external",
        close: "pos.shift.close", approve_close: "pos.shift.difference", responsibility: "pos.shift.responsibility",
      } as Record<string, string>)[String(req.body?.action)];
    }
    if (!action) return void res.status(403).json({ error: "هذا المسار غير ممنوح للوصول المحدد؛ لا تكفي الباقة أو المسمى الوظيفي" });
    if (action === "self") return next();
    if (profile.status !== "active") return void res.status(403).json({ error: "الوصول معلق أو غير مفعل" });
    const grants = await currentResponsibilities(userId, companyId);
    const header = Number(req.get("X-Workspace-Responsibility"));
    const grant = grants.find(g => g.id === header);
    if(approvalPath&&grant?.resource==="procurement"&&(req.method==="GET"||req.method==="POST"&&approvalPath[2]==="act")){
      if(!grant.actions.includes("procurement.read")||!["procurement.invoices.read","procurement.orders.read"].some(a=>grant.actions.includes(a)))
        return void res.status(403).json({error:"الموافقة لا تمنح قراءة مصدرها ضمنيًا"});
      await responsibilityContext.run({userId,companyId,grantId:grant.id},async()=>{
        if(approvalPath[1]){
          const result=await db.execute(sql`SELECT doc_type,record_id,branch_id,amount FROM approval_requests
            WHERE id=${Number(approvalPath[1])} AND company_id=${companyId}`);
          const source=result.rows[0];
          if(!source)throw new FinancialRequestError("طلب الاعتماد غير متاح",404);
          if(Number(source.branch_id)!==grant.branchId||grant.amountLimit!=null&&Math.abs(Number(source.amount))>Number(grant.amountLimit))
            throw new FinancialRequestError("طلب الاعتماد خارج نطاق المسؤولية",404);
          const verb=req.method==="POST"&&req.body.action!=="comment"?"approve":"read";
          if(source.doc_type==="supplier_invoice"){
            await assertSupplierInvoice(req,Number(source.record_id),verb);
          }else if(source.doc_type==="purchase_order"){
            const actor=await requestProcurementActor(req,`procurement.orders.${verb}`);
            const owned=await db.execute(sql`SELECT id FROM purchase_orders WHERE id=${Number(source.record_id)}
              AND ${procurementOrderScope(actor)}`);
            if(!owned.rows.length)throw new FinancialRequestError("مصدر الاعتماد خارج النطاق",404);
          }else throw new FinancialRequestError("المصدر ليس ضمن مسؤولية المشتريات",403);
        }
        next();
      });
      return;
    }
    if(action==="procurement.orders.read"&&grant?.resource==="procurement"&&
      !grant.actions.includes(action)&&grant.actions.includes("procurement.receipts.read")) action="procurement.receipts.read";
    // Names used by the assignment selector reveal only branches/warehouses
    // already in the user's own live responsibilities, never financial data.
    if (action === "metadata") {
      const allowed = grant ? [grant] : req.get("X-Workspace-Responsibility") ? [] : grants;
      const branchIds = [...new Set(allowed.map(g => g.branchId))];
      const warehouseIds = [...new Set(allowed.flatMap(g => g.warehouseIds))];
      if (req.path === "/branches") {
        res.json(branchIds.length ? await db.select().from(branchesTable).where(and(
          eq(branchesTable.companyId, companyId), inArray(branchesTable.id, branchIds))) : []);
      } else {
        const wholeBranches=allowed.filter(g=>g.resource==="procurement"&&!g.warehouseIds.length).map(g=>g.branchId);
        res.json(warehouseIds.length||wholeBranches.length ? await db.select().from(warehousesTable).where(and(
          eq(warehousesTable.companyId, companyId), sql`(${warehousesTable.id}=ANY(${sql.param(warehouseIds)}::integer[])
            OR ${warehousesTable.branchId}=ANY(${sql.param(wholeBranches)}::integer[]))`)) : []);
      }
      return;
    }
    if (!grant || !(action === "catalog"
      ? grant.actions.includes(`${grant.resource}.read`) : grant.actions.includes(action))) {
      return void res.status(403).json({ error: "اختر مسؤولية فعالة تجيز هذا الفعل في هذا النطاق" });
    }
    if (action.startsWith("pos.") && grant.resource !== "pos") {
      return void res.status(403).json({ error: "مسؤولية المخزون لا تمنح البيع في فرع آخر" });
    }
    if (action === "catalog") {
      if(grant.resource==="procurement"&&!grant.actions.includes("procurement.orders.create"))
        return void res.status(403).json({error:"دليل الموردين لا يمنح بيانات المنتجات"});
      if (req.path === "/categories" || req.path === "/products/categories") {
        res.json(await db.select().from(categoriesTable).where(sql`EXISTS(
          SELECT 1 FROM products p WHERE p.company_id=${companyId} AND p.category_id=${categoriesTable.id} AND p.is_active)`));
      } else {
        const search = typeof req.query.search === "string" ? req.query.search.slice(0, 200) : "";
        const category = req.query.category == null || req.query.category === "" ? null : Number(req.query.category);
        if (category != null && (!Number.isInteger(category) || category <= 0)) {
          return void res.status(400).json({ error: "تصنيف غير صالح" });
        }
        const products = await teamRows(db, sql`SELECT p.id,p.name,p.name_ar AS "nameAr",p.sku,p.category_id AS "categoryId",
          c.name_ar AS "categoryName",p.price::float8 AS price,p.min_stock AS "minStock",p.unit,p.image_url AS "imageUrl",
          p.is_active AS "isActive",p.barcode,p.tracking_mode AS "trackingMode",p.costing_method AS "costingMethod",
          p.created_at AS "createdAt",
          coalesce((SELECT sum(q.quantity) FROM stock_quants q JOIN warehouses w ON w.id=q.warehouse_id
            WHERE q.product_id=p.id AND w.company_id=${companyId} AND w.branch_id=${grant.branchId}
            AND w.id=ANY(${sql.param(grant.warehouseIds)}::integer[])),0)::float8 AS stock
          FROM products p LEFT JOIN categories c ON c.id=p.category_id
          WHERE p.company_id=${companyId} AND p.is_active ${category == null ? sql`` : sql`AND p.category_id=${category}`} AND
          (${search}='' OR p.name ILIKE ${`%${search}%`} OR p.name_ar ILIKE ${`%${search}%`} OR p.barcode=${search})
          ORDER BY p.id LIMIT 500`);
        // Cost is deliberately absent, not fabricated as zero. Scoped cost
        // access is provided by /workspace/inventory using actual quants.
        res.json(grant.resource==="procurement"?products.map(({stock,...p})=>p):products);
      }
      return;
    }
    if (req.path.startsWith("/workflow/approval-requests/")) {
      const requestId = Number(req.path.split("/").at(-1));
      const allowed = await db.execute(sql`SELECT r.id FROM approval_requests r
        JOIN pos_sessions s ON s.id=r.record_id AND s.branch_id=r.branch_id
        JOIN branches b ON b.id=s.branch_id AND b.company_id=r.company_id
        WHERE r.id=${requestId} AND r.company_id=${companyId} AND r.doc_type='pos_over_limit'
          AND r.submitted_by_user_id=${userId} AND r.branch_id=${grant.branchId}
          AND EXISTS(SELECT 1 FROM warehouses w WHERE w.company_id=${companyId}
            AND w.branch_id=${grant.branchId} AND w.id IN
              (SELECT jsonb_array_elements_text(${JSON.stringify(grant.warehouseIds)}::jsonb)::int))`);
      if (!allowed.rows.length) return void res.status(403).json({ error: "طلب الاستثناء خارج المصدر أو نطاق مسؤوليتك" });
    }
    if (req.path === "/sales/sellers/workspace" && req.query.branchId != null &&
      Number(req.query.branchId) !== grant.branchId) {
      return void res.status(403).json({ error: "الفرع خارج مسؤولية نقطة البيع" });
    }
    responsibilityContext.run({ userId, companyId, grantId: grant.id }, next);
  } catch (err) {
    if(err instanceof FinancialRequestError){res.status(err.status).json({error:err.message});return;}
    next(err);
  }
}
