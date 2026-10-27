import { Router } from "express";
import { db, productsTable, categoriesTable } from "@workspace/db";
import { and, eq, sql, desc } from "drizzle-orm";
import { CreateProductBody, UpdateProductBody } from "@workspace/api-zod";
import { inventoryGuard } from "../middlewares/require-role";
import { recordStockMove, getDefaultWarehouseId } from "../lib/stock-engine";
import { ScopedDb, getCompanyId } from "../lib/scoped-db";
import { parsePagination } from "../lib/pagination";

const router = Router();

router.get("/products", async (req, res) => {
  try {
    const { category, search, lowStock } = req.query;
    const scoped = new ScopedDb(getCompanyId(req));
    const { limit, offset } = parsePagination(req);

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
        availableQuantity: sql<string>`CASE WHEN ${productsTable.trackingMode}='lot' THEN
          coalesce((SELECT sum(q.quantity) FROM stock_quants q JOIN warehouses w ON w.id=q.warehouse_id
           JOIN stock_lots l ON l.id=q.lot_id AND l.product_id=q.product_id
           WHERE q.product_id=${productsTable.id} AND w.company_id=${productsTable.companyId} AND NOT w.is_scrap
            AND (l.expiry_date IS NULL OR l.expiry_date>=${new Date().toISOString().slice(0,10)}::date)),0)
          ELSE ${productsTable.stock} END::text`,
        minStock: productsTable.minStock,
        unit: productsTable.unit,
        imageUrl: productsTable.imageUrl,
        isActive: productsTable.isActive,
        barcode: productsTable.barcode,
        trackingMode: productsTable.trackingMode,
        costingMethod: productsTable.costingMethod,
        createdAt: productsTable.createdAt,
      })
      .from(productsTable)
      .leftJoin(categoriesTable, eq(productsTable.categoryId, categoriesTable.id))
      .where(
        and(
          scoped.scope(productsTable),
          sql`${productsTable.isActive} = true
            ${category ? sql`and ${categoriesTable.id} = ${Number(category)}` : sql``}
            ${search ? sql`and (${productsTable.nameAr} ilike ${'%' + search + '%'} or ${productsTable.name} ilike ${'%' + search + '%'})` : sql``}
            ${lowStock === 'true' ? sql`and ${productsTable.stock} <= ${productsTable.minStock}` : sql``}
          `,
        ),
      )
      .orderBy(desc(productsTable.createdAt))
      .limit(limit)
      .offset(offset);

    res.json(
      rows.map((p) => ({
        ...p,
        price: Number(p.price),
        costPrice: Number(p.costPrice),
        stock: Number(p.stock),
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
    const scoped = new ScopedDb(getCompanyId(req));
    const { broadcastProductChange } = await import("../lib/integrations/marketplaces");
    const product = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(productsTable)
        .values(scoped.stamp({
          name: body.name,
          nameAr: body.nameAr,
          sku: body.sku,
          categoryId: body.categoryId,
          price: String(body.price),
          costPrice: String(body.costPrice),
          stock: "0",
          minStock: body.minStock,
          unit: body.unit,
          imageUrl: body.imageUrl ?? null,
          barcode: body.barcode ?? null,
          trackingMode: body.trackingMode ?? "none",
          costingMethod: body.costingMethod ?? "average",
        }))
        .returning();
      // Initial stock is recorded as a real receipt move so quants and the
      // ledger stay in sync. Direct writes to products.stock are not allowed.
      if (body.stock && body.stock > 0) {
        const wh = await getDefaultWarehouseId(tx);
        await recordStockMove(tx, {
          productId: created.id,
          quantity: body.stock,
          unitCost: Number(body.costPrice ?? 0),
          kind: "receipt",
          toWarehouseId: wh,
          sourceType: "product_create",
          sourceRef: `PROD-${created.id}`,
          createdBy: req.session?.userId ?? null,
          notes: "رصيد افتتاحي",
        });
        created.stock = String(body.stock);
      }
      return created;
    });

    broadcastProductChange(product.id);

    const category = await db.select().from(categoriesTable).where(eq(categoriesTable.id, product.categoryId)).limit(1);

    res.status(201).json({
      ...product,
      price: Number(product.price),
      costPrice: Number(product.costPrice),
      stock: Number(product.stock),
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
    // Categories themselves are a shared lookup, but `productCount` must
    // only reflect THIS tenant's products. Scope the LEFT JOIN side.
    const scoped = new ScopedDb(getCompanyId(req));
    const categories = await db
      .select({
        id: categoriesTable.id,
        name: categoriesTable.name,
        nameAr: categoriesTable.nameAr,
        productCount: sql<number>`count(${productsTable.id})`,
      })
      .from(categoriesTable)
      .leftJoin(
        productsTable,
        and(eq(productsTable.categoryId, categoriesTable.id), scoped.scope(productsTable)),
      )
      .groupBy(categoriesTable.id);

    res.json(categories.map((c) => ({ ...c, productCount: Number(c.productCount) })));
  } catch (err) {
    req.log.error({ err }, "Error fetching categories");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/products/stats", async (req, res) => {
  try {
    const scoped = new ScopedDb(getCompanyId(req));
    const [stats] = await db
      .select({
        totalProducts: sql<number>`count(*)`,
        lowStockCount: sql<number>`count(*) filter (where ${productsTable.stock} <= ${productsTable.minStock})`,
        totalInventoryValue: sql<number>`coalesce(sum(${productsTable.costPrice}::numeric * ${productsTable.stock}), 0)`,
        outOfStockCount: sql<number>`count(*) filter (where ${productsTable.stock} = 0)`,
      })
      .from(productsTable)
      .where(and(sql`${productsTable.isActive} = true`, scoped.scope(productsTable)));

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
    const scoped = new ScopedDb(getCompanyId(req));
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
        barcode: productsTable.barcode,
        trackingMode: productsTable.trackingMode,
        costingMethod: productsTable.costingMethod,
        createdAt: productsTable.createdAt,
      })
      .from(productsTable)
      .leftJoin(categoriesTable, eq(productsTable.categoryId, categoriesTable.id))
      .where(and(eq(productsTable.id, id), scoped.scope(productsTable)));

    if (!product) return res.status(404).json({ error: "Not found" });

    return res.json({
      ...product,
      price: Number(product.price),
      costPrice: Number(product.costPrice),
      stock: Number(product.stock),
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
    const scoped = new ScopedDb(getCompanyId(req));

    const updateData: Record<string, unknown> = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.nameAr !== undefined) updateData.nameAr = body.nameAr;
    if (body.price !== undefined) updateData.price = String(body.price);
    if (body.costPrice !== undefined) updateData.costPrice = String(body.costPrice);
    // body.stock is intentionally ignored. Stock changes go through the
    // /api/inventory/moves adjustment endpoint so they hit the ledger.
    if (body.minStock !== undefined) updateData.minStock = body.minStock;
    if (body.isActive !== undefined) updateData.isActive = body.isActive;
    if (body.barcode !== undefined) updateData.barcode = body.barcode;
    if (body.trackingMode !== undefined) updateData.trackingMode = body.trackingMode;
    if (body.costingMethod !== undefined) updateData.costingMethod = body.costingMethod;

    // Tenant scope: WHERE id = ? AND company_id = session.companyId so a
    // user cannot mutate another tenant's product even if they know the ID.
    const [updated] = await db
      .update(productsTable)
      .set(updateData)
      .where(and(eq(productsTable.id, id), scoped.scope(productsTable)))
      .returning();
    if (!updated) return res.status(404).json({ error: "Not found" });

    const { broadcastProductChange } = await import("../lib/integrations/marketplaces");
    broadcastProductChange(updated.id);

    const category = await db.select().from(categoriesTable).where(eq(categoriesTable.id, updated.categoryId)).limit(1);

    return res.json({
      ...updated,
      price: Number(updated.price),
      costPrice: Number(updated.costPrice),
      stock: Number(updated.stock),
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
    const scoped = new ScopedDb(getCompanyId(req));
    // Soft-delete: tenant-scoped UPDATE. If no row matches under
    // the caller's company scope we return 404 (hides existence of
    // cross-tenant rows; mirrors PATCH semantics).
    const [row] = await db
      .update(productsTable)
      .set({ isActive: false })
      .where(and(eq(productsTable.id, id), scoped.scope(productsTable)))
      .returning({ id: productsTable.id });
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Error deleting product");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
