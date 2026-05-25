import { Router } from "express";
import { db, branchesTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { CreateBranchBody } from "@workspace/api-zod";
import { adminGuard } from "../middlewares/require-role";
import { ScopedDb, getCompanyId } from "../lib/scoped-db";

const router = Router();

router.get("/branches", async (req, res) => {
  try {
    const scoped = new ScopedDb(getCompanyId(req));
    const branches = await db
      .select()
      .from(branchesTable)
      .where(and(sql`${branchesTable.isActive} = true`, scoped.scope(branchesTable)));

    res.json(branches.map((b) => ({ ...b, createdAt: undefined })));
  } catch (err) {
    req.log.error({ err }, "Error fetching branches");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/branches", adminGuard, async (req, res) => {
  try {
    const body = CreateBranchBody.parse(req.body);
    const scoped = new ScopedDb(getCompanyId(req));
    const [branch] = await db
      .insert(branchesTable)
      .values(scoped.stamp({
        name: body.name,
        nameAr: body.nameAr,
        city: body.city,
        isActive: body.isActive ?? true,
      }))
      .returning();

    res.status(201).json({
      id: branch.id,
      name: branch.name,
      nameAr: branch.nameAr,
      city: branch.city,
      isActive: branch.isActive,
    });
  } catch (err) {
    req.log.error({ err }, "Error creating branch");
    res.status(400).json({ error: "بيانات غير صحيحة" });
  }
});

export default router;
