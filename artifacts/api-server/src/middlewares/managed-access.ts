import type { Request, Response, NextFunction } from "express";
import { db, branchesTable, warehousesTable, categoriesTable } from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { currentResponsibilities, managedProfile, responsibilityContext } from "../lib/responsibility-context";
import { teamRows } from "../lib/team-store";

export const SCOPED_ROUTES = [
  ["GET", "/workspace/access", "self"],
  ["GET", "/workspace/inventory", "inventory.read"],
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
  ["POST", "/pos/orders", "pos.sell"],
  ["GET", "/pos/orders/:id/receipt", "pos.read"],
] as const;
export function scopedRouteAction(method: string, path: string) {
  return SCOPED_ROUTES.find(([m, p]) => m === method &&
    new RegExp(`^${p.replace(/:id/g, "\\d+")}$`).test(path))?.[2];
}
export async function managedAccessGate(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.session.userId;
    const companyId = req.session.companyId;
    if (!userId || !companyId) return next();
    const profile = await managedProfile(userId, companyId);
    if (!profile) return next();
    const action = scopedRouteAction(req.method, req.path);
    if (!action) return void res.status(403).json({ error: "هذا المسار غير ممنوح للوصول المحدد؛ لا تكفي الباقة أو المسمى الوظيفي" });
    if (action === "self") return next();
    if (profile.status !== "active") return void res.status(403).json({ error: "الوصول معلق أو غير مفعل" });
    const grants = await currentResponsibilities(userId, companyId);
    const header = Number(req.get("X-Workspace-Responsibility"));
    const grant = grants.find(g => g.id === header);
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
        res.json(warehouseIds.length ? await db.select().from(warehousesTable).where(and(
          eq(warehousesTable.companyId, companyId), inArray(warehousesTable.id, warehouseIds))) : []);
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
        res.json(products);
      }
      return;
    }
    if (action === "pos.sell") {
      const body = req.body ?? {};
      if (Number(body.discount ?? 0) !== 0 || body.paymentIntentId != null || body.approvalId != null || body.approvalRequestId != null ||
        Array.isArray(body.items) && body.items.some((i: { quantity: number }) => Number(i?.quantity) <= 0) ||
        body.managerPassword || body.managerOverride || Array.isArray(body.payments) && body.payments.some((p: { method: string }) => p.method !== "cash") ||
        body.paymentMethod && body.paymentMethod !== "cash") {
        return void res.status(403).json({ error: "هذه المسؤولية للبيع النقدي دون تجاوز أو خصم؛ لم تمنح صلاحية هذا الاستثناء" });
      }
    }
    if (req.path === "/sales/sellers/workspace" && req.query.branchId != null &&
      Number(req.query.branchId) !== grant.branchId) {
      return void res.status(403).json({ error: "الفرع خارج مسؤولية نقطة البيع" });
    }
    responsibilityContext.run({ userId, companyId, grantId: grant.id }, next);
  } catch (err) { next(err); }
}
