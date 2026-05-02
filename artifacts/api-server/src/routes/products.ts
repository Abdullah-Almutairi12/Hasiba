import { Router } from "express";
import { db, productsTable, categoriesTable } from "@workspace/db";
import { eq, sql, desc } from "drizzle-orm";
import { CreateProductBody, UpdateProductBody } from "@workspace/api-zod";
import { inventoryGuard } from "../middlewares/require-role";

const router = Router();

router.get("/products", async (req, res) => {
  try {
    const { category, search, lowStock } = req.query;

    const rows = await db
      .select({
        id: productsTable.id,
        name: productsTable.name,
        nameAr: productsTable.nameAr,
        sku: productsTable.sku,
        categoryId: productsTable.categoryId,
        categoryName: categoriesTable.nameAr,
        price: productsTable.price,
        costPrice: productsTable.costPrice,
        stock: productsTable.stock,
        minStock: productsTable.minStock,
        unit: productsTable.unit,
        imageUrl: productsTable.imageUrl,
        isActive: productsTable.isActive,
        createdAt: productsTable.createdAt,
      })
      .from(productsTable)
      .leftJoin(categoriesTable, eq(productsTable.categoryId, categoriesTable.id))
      .where(
        sql`${productsTable.isActive} = true
          ${category ? sql`and ${categoriesTable.id} = ${Number(category)}` : sql``}
          ${search ? sql`and (${productsTable.nameAr} ilike ${'%' + search + '%'} or ${productsTable.name} ilike ${'%' + search + '%'})` : sql``}
          ${lowStock === 'true' ? sql`and ${productsTable.stock} <= ${productsTable.minStock}` : sql``}
        `
      )
      .orderBy(desc(productsTable.createdAt));

    res.json(
      rows.map((p) => ({
        ...p,
        price: Number(p.price),
        costPrice: Number(p.costPrice),
        createdAt: p.createdAt.toISOString(),
      }))
    );
  } catch (err) {
    req.log.error({ err }, "Error fetching products");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/products", inventoryGuard, async (req, res) => {
  try {
    const body = CreateProductBody.parse(req.body);
    const [product] = await db
      .insert(productsTable)
      .values({
        name: body.name,
        nameAr: body.nameAr,
        sku: body.sku,
        categoryId: body.categoryId,
        price: String(body.price),
        costPrice: String(body.costPrice),
        stock: body.stock,
        minStock: body.minStock,
        unit: body.unit,
        imageUrl: body.imageUrl ?? null,
      })
      .returning();

    const category = await db.select().from(categoriesTable).where(eq(categoriesTable.id, product.categoryId)).limit(1);

    res.status(201).json({
      ...product,
      price: Number(product.price),
      costPrice: Number(product.costPrice),
      categoryName: category[0]?.nameAr ?? "",
      createdAt: product.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Error creating product");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/products/categories", async (req, res) => {
  try {
    const categories = await db
      .select({
        id: categoriesTable.id,
        name: categoriesTable.name,
        nameAr: categoriesTable.nameAr,
        productCount: sql<number>`count(${productsTable.id})`,
      })
      .from(categoriesTable)
      .leftJoin(productsTable, eq(productsTable.categoryId, categoriesTable.id))
      .groupBy(categoriesTable.id);

    res.json(categories.map((c) => ({ ...c, productCount: Number(c.productCount) })));
  } catch (err) {
    req.log.error({ err }, "Error fetching categories");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/products/stats", async (req, res) => {
  try {
    const [stats] = await db
      .select({
        totalProducts: sql<number>`count(*)`,
        lowStockCount: sql<number>`count(*) filter (where ${productsTable.stock} <= ${productsTable.minStock})`,
        totalInventoryValue: sql<number>`coalesce(sum(${productsTable.costPrice}::numeric * ${productsTable.stock}), 0)`,
        outOfStockCount: sql<number>`count(*) filter (where ${productsTable.stock} = 0)`,
      })
      .from(productsTable)
      .where(sql`${productsTable.isActive} = true`);

    res.json({
      totalProducts: Number(stats.totalProducts),
      lowStockCount: Number(stats.lowStockCount),
      totalInventoryValue: Number(stats.totalInventoryValue),
      outOfStockCount: Number(stats.outOfStockCount),
    });
  } catch (err) {
    req.log.error({ err }, "Error fetching product stats");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/products/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [product] = await db
      .select({
        id: productsTable.id,
        name: productsTable.name,
        nameAr: productsTable.nameAr,
        sku: productsTable.sku,
        categoryId: productsTable.categoryId,
        categoryName: categoriesTable.nameAr,
        price: productsTable.price,
        costPrice: productsTable.costPrice,
        stock: productsTable.stock,
        minStock: productsTable.minStock,
        unit: productsTable.unit,
        imageUrl: productsTable.imageUrl,
        isActive: productsTable.isActive,
        createdAt: productsTable.createdAt,
      })
      .from(productsTable)
      .leftJoin(categoriesTable, eq(productsTable.categoryId, categoriesTable.id))
      .where(eq(productsTable.id, id));

    if (!product) return res.status(404).json({ error: "Not found" });

    return res.json({
      ...product,
      price: Number(product.price),
      costPrice: Number(product.costPrice),
      createdAt: product.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Error fetching product");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/products/:id", inventoryGuard, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const body = UpdateProductBody.parse(req.body);

    const updateData: Record<string, unknown> = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.nameAr !== undefined) updateData.nameAr = body.nameAr;
    if (body.price !== undefined) updateData.price = String(body.price);
    if (body.costPrice !== undefined) updateData.costPrice = String(body.costPrice);
    if (body.stock !== undefined) updateData.stock = body.stock;
    if (body.minStock !== undefined) updateData.minStock = body.minStock;
    if (body.isActive !== undefined) updateData.isActive = body.isActive;

    const [updated] = await db.update(productsTable).set(updateData).where(eq(productsTable.id, id)).returning();
    if (!updated) return res.status(404).json({ error: "Not found" });

    const category = await db.select().from(categoriesTable).where(eq(categoriesTable.id, updated.categoryId)).limit(1);

    return res.json({
      ...updated,
      price: Number(updated.price),
      costPrice: Number(updated.costPrice),
      categoryName: category[0]?.nameAr ?? "",
      createdAt: updated.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Error updating product");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/products/:id", inventoryGuard, async (req, res) => {
  try {
    const id = Number(req.params.id);
    await db.update(productsTable).set({ isActive: false }).where(eq(productsTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Error deleting product");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
