import { Router } from "express";
import { db, customersTable } from "@workspace/db";
import { ilike, or, sql, desc } from "drizzle-orm";
import { CreateCustomerBody } from "@workspace/api-zod";
import { salesWriteGuard, customerReadGuard } from "../middlewares/require-role";

const router = Router();

router.get("/customers", customerReadGuard, async (req, res) => {
  try {
    const { search } = req.query;
    const customers = await db
      .select()
      .from(customersTable)
      .where(
        search
          ? or(
              ilike(customersTable.name, `%${search}%`),
              ilike(customersTable.phone ?? "", `%${search}%`)
            )
          : sql`true`
      )
      .orderBy(desc(customersTable.createdAt));

    res.json(
      customers.map((c) => ({
        ...c,
        totalSpent: Number(c.totalSpent),
        createdAt: c.createdAt.toISOString(),
      }))
    );
  } catch (err) {
    req.log.error({ err }, "Error fetching customers");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/customers", salesWriteGuard, async (req, res) => {
  try {
    const body = CreateCustomerBody.parse(req.body);
    const [customer] = await db
      .insert(customersTable)
      .values({
        name: body.name,
        phone: body.phone ?? null,
        email: body.email ?? null,
      })
      .returning();

    res.status(201).json({
      ...customer,
      totalSpent: Number(customer.totalSpent),
      createdAt: customer.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Error creating customer");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
