import { Router } from "express";
import { db, warehousesTable, insertWarehouseSchema } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { inventoryGuard } from "../middlewares/require-role";

const router = Router();

router.get("/warehouses", async (req, res) => {
  try {
    const branchId = req.query.branchId ? Number(req.query.branchId) : undefined;
    // By default, scrap warehouses are hidden from pickers; pass
    // `?includeScrap=1` to retrieve them (used by reporting/admin UIs).
    const includeScrap = req.query.includeScrap === "1" || req.query.includeScrap === "true";
    const conds = [];
    if (branchId) conds.push(eq(warehousesTable.branchId, branchId));
    if (!includeScrap) conds.push(eq(warehousesTable.isScrap, false));
    const rows = conds.length
      ? await db.select().from(warehousesTable).where(conds.length === 1 ? conds[0] : and(...conds))
      : await db.select().from(warehousesTable);
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Error fetching warehouses");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/warehouses", inventoryGuard, async (req, res) => {
  try {
    const parsed = insertWarehouseSchema.parse(req.body);
    const [created] = await db.insert(warehousesTable).values(parsed).returning();
    res.status(201).json(created);
  } catch (err) {
    req.log.error({ err }, "Error creating warehouse");
    res.status(400).json({ error: "Invalid request" });
  }
});

export default router;
