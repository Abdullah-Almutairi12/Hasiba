import { Router } from "express";
import { db, branchesTable, warehousesTable, insertWarehouseSchema } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { inventoryGuard } from "../middlewares/require-role";
import { ScopedDb, getCompanyId } from "../lib/scoped-db";

const router = Router();

router.get("/warehouses", async (req, res) => {
  try {
    const scoped = new ScopedDb(getCompanyId(req));
    const branchId = req.query.branchId ? Number(req.query.branchId) : undefined;
    // By default, scrap warehouses are hidden from pickers; pass
    // `?includeScrap=1` to retrieve them (used by reporting/admin UIs).
    const includeScrap = req.query.includeScrap === "1" || req.query.includeScrap === "true";
    const conds = [scoped.scope(warehousesTable)];
    if (branchId) conds.push(eq(warehousesTable.branchId, branchId));
    if (!includeScrap) conds.push(eq(warehousesTable.isScrap, false));
    const rows = await db
      .select()
      .from(warehousesTable)
      .where(conds.length === 1 ? conds[0] : and(...conds));
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Error fetching warehouses");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/warehouses", inventoryGuard, async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    // The public client contract deliberately contains no companyId.
    const parsed = insertWarehouseSchema.parse({ ...req.body, companyId });
    if (!parsed.name.trim() || !parsed.nameAr.trim()) {
      res.status(400).json({ error: "أدخل اسم المستودع." });
      return;
    }
    const scoped = new ScopedDb(companyId);
    const created = await db.transaction(async tx => {
      const [branch] = await tx.select({ id: branchesTable.id }).from(branchesTable).where(and(
        eq(branchesTable.id, parsed.branchId), eq(branchesTable.companyId, companyId),
        eq(branchesTable.isActive, true),
      )).for("share");
      if (!branch) return null;
      const [row] = await tx.insert(warehousesTable).values(scoped.stamp({
        ...parsed, name: parsed.name.trim(), nameAr: parsed.nameAr.trim(),
      })).returning();
      return row;
    });
    if (!created) {
      res.status(404).json({ error: "الفرع غير متاح ضمن الشركة الحالية؛ حدّث قائمة الفروع." });
      return;
    }
    res.status(201).json(created);
  } catch (err) {
    req.log.error({ err }, "Error creating warehouse");
    res.status(400).json({ error: "Invalid request" });
  }
});

export default router;
