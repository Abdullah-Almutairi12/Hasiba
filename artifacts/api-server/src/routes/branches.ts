import { Router } from "express";
import { db, branchesTable } from "@workspace/db";
import { sql } from "drizzle-orm";

const router = Router();

router.get("/branches", async (req, res) => {
  try {
    const branches = await db
      .select()
      .from(branchesTable)
      .where(sql`${branchesTable.isActive} = true`);

    res.json(branches.map((b) => ({ ...b, createdAt: undefined })));
  } catch (err) {
    req.log.error({ err }, "Error fetching branches");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
