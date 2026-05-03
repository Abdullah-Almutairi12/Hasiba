import { Router } from "express";
import { db, posSessionsTable, posOrdersTable, branchesTable, productsTable } from "@workspace/db";
import { eq, gte, sql, desc } from "drizzle-orm";
import { CreatePosSessionBody, CreatePosOrderBody } from "@workspace/api-zod";
import { posGuard, posReadGuard } from "../middlewares/require-role";
import { postJournalEntry } from "../lib/journal-posting";

const router = Router();

router.get("/pos/sessions", posReadGuard, async (req, res) => {
  try {
    const sessions = await db
      .select({
        id: posSessionsTable.id,
        sessionNumber: posSessionsTable.sessionNumber,
        branchId: posSessionsTable.branchId,
        branchName: branchesTable.nameAr,
        cashierName: posSessionsTable.cashierName,
        totalSales: posSessionsTable.totalSales,
        ordersCount: posSessionsTable.ordersCount,
        status: posSessionsTable.status,
        openedAt: posSessionsTable.openedAt,
        closedAt: posSessionsTable.closedAt,
      })
      .from(posSessionsTable)
      .leftJoin(branchesTable, eq(posSessionsTable.branchId, branchesTable.id))
      .orderBy(desc(posSessionsTable.openedAt))
      .limit(20);

    res.json(
      sessions.map((s) => ({
        ...s,
        totalSales: Number(s.totalSales),
        openedAt: s.openedAt.toISOString(),
        closedAt: s.closedAt?.toISOString() ?? null,
      }))
    );
  } catch (err) {
    req.log.error({ err }, "Error fetching POS sessions");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/pos/sessions", posGuard, async (req, res) => {
  try {
    const body = CreatePosSessionBody.parse(req.body);
    const sessionNumber = `WRD-${Date.now()}`;

    const [session] = await db
      .insert(posSessionsTable)
      .values({
        sessionNumber,
        branchId: body.branchId,
        cashierName: body.cashierName,
        openingCash: String(body.openingCash),
      })
      .returning();

    const branch = await db.select().from(branchesTable).where(eq(branchesTable.id, session.branchId)).limit(1);

    res.status(201).json({
      ...session,
      branchName: branch[0]?.nameAr ?? "",
      totalSales: Number(session.totalSales),
      openedAt: session.openedAt.toISOString(),
      closedAt: null,
    });
  } catch (err) {
    req.log.error({ err }, "Error creating POS session");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/pos/orders", posReadGuard, async (req, res) => {
  try {
    const { sessionId, date } = req.query;
    let query = db.select().from(posOrdersTable);

    const orders = await db
      .select()
      .from(posOrdersTable)
      .where(
        sql`${sessionId ? sql`${posOrdersTable.sessionId} = ${Number(sessionId)}` : sql`true`}
          ${date ? sql`and date(${posOrdersTable.createdAt}) = ${date}` : sql``}`
      )
      .orderBy(desc(posOrdersTable.createdAt))
      .limit(50);

    res.json(
      orders.map((o) => ({
        ...o,
        subtotal: Number(o.subtotal),
        tax: Number(o.tax),
        discount: Number(o.discount),
        total: Number(o.total),
        createdAt: o.createdAt.toISOString(),
      }))
    );
  } catch (err) {
    req.log.error({ err }, "Error fetching POS orders");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/pos/orders", posGuard, async (req, res) => {
  try {
    const body = CreatePosOrderBody.parse(req.body);

    const discount = body.discount ?? 0;
    const orderNumber = `ORD-${Date.now()}`;

    // Single transaction: product reads/stock decrements, order insert, session
    // update, and GL postings all succeed-or-rollback together. Any failure in
    // posting the journal entry now rolls back the order + stock changes too.
    const result = await db.transaction(async (tx) => {
      const orderItems: Array<{
        productId: number;
        productName: string;
        quantity: number;
        unitPrice: number;
        costPrice: number;
        total: number;
      }> = [];
      let subtotal = 0;
      let totalCost = 0;

      for (const item of body.items) {
        const [product] = await tx
          .select()
          .from(productsTable)
          .where(eq(productsTable.id, item.productId))
          .limit(1);
        if (!product) continue;

        const unitPrice = Number(product.price);
        const costPrice = Number(product.costPrice ?? 0);
        const lineTotal = unitPrice * item.quantity;
        subtotal += lineTotal;
        totalCost += costPrice * item.quantity;

        orderItems.push({
          productId: product.id,
          productName: product.nameAr,
          quantity: item.quantity,
          unitPrice,
          costPrice,
          total: lineTotal,
        });

        await tx
          .update(productsTable)
          .set({ stock: sql`${productsTable.stock} - ${item.quantity}` })
          .where(eq(productsTable.id, item.productId));
      }

      const tax = (subtotal - discount) * 0.15;
      const total = subtotal - discount + tax;

      const [created] = await tx
        .insert(posOrdersTable)
        .values({
          orderNumber,
          sessionId: body.sessionId,
          items: orderItems,
          subtotal: String(subtotal),
          tax: String(tax),
          discount: String(discount),
          total: String(total),
          paymentMethod: body.paymentMethod,
          customerId: body.customerId ?? null,
        })
        .returning();

      await tx
        .update(posSessionsTable)
        .set({
          totalSales: sql`${posSessionsTable.totalSales}::numeric + ${total}`,
          ordersCount: sql`${posSessionsTable.ordersCount} + 1`,
        })
        .where(eq(posSessionsTable.id, body.sessionId));

      // ===== Post the sale to the General Ledger (strict — failure aborts) =====
      // Dr Cash/Bank (total) / Cr Sales Revenue (subtotal-discount) / Cr VAT Output (tax)
      // Plus a separate cost-of-sale entry: Dr COGS / Cr Inventory if cost is known.
      const cashKey = body.paymentMethod === "cash" ? "cash" : "bank";
      const netRevenue = subtotal - discount;
      const saleLines: Array<{
        systemKey: string;
        debit?: number;
        credit?: number;
        description?: string;
      }> = [
        { systemKey: cashKey, debit: total, description: `قبض ${orderNumber}` },
      ];
      if (netRevenue > 0)
        saleLines.push({ systemKey: "sales_revenue", credit: netRevenue, description: "إيرادات مبيعات" });
      if (tax > 0)
        saleLines.push({ systemKey: "vat_output", credit: tax, description: "ضريبة مخرجات 15%" });
      await postJournalEntry(
        tx,
        {
          entryDate: new Date(),
          description: `بيع نقطة بيع — ${orderNumber}`,
          reference: orderNumber,
          source: "pos",
          sourceRef: orderNumber,
          createdBy: req.session?.userId ?? null,
          status: "posted",
        },
        saleLines,
      );

      if (totalCost > 0) {
        await postJournalEntry(
          tx,
          {
            entryDate: new Date(),
            description: `تكلفة بضاعة مباعة — ${orderNumber}`,
            reference: orderNumber,
            source: "pos",
            sourceRef: `${orderNumber}-COGS`,
            createdBy: req.session?.userId ?? null,
            status: "posted",
          },
          [
            { systemKey: "cogs", debit: totalCost },
            { systemKey: "inventory", credit: totalCost },
          ],
        );
      }

      return { order: created, total, subtotal, tax, orderItems };
    });

    res.status(201).json({
      ...result.order,
      items: result.orderItems,
      subtotal: result.subtotal,
      tax: result.tax,
      discount,
      total: result.total,
      createdAt: result.order.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Error creating POS order");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/pos/summary", posReadGuard, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [summary] = await db
      .select({
        totalSales: sql<number>`coalesce(sum(${posOrdersTable.total}::numeric), 0)`,
        ordersCount: sql<number>`count(*)`,
        cashSales: sql<number>`coalesce(sum(${posOrdersTable.total}::numeric) filter (where ${posOrdersTable.paymentMethod} = 'cash'), 0)`,
        cardSales: sql<number>`coalesce(sum(${posOrdersTable.total}::numeric) filter (where ${posOrdersTable.paymentMethod} = 'card'), 0)`,
      })
      .from(posOrdersTable)
      .where(gte(posOrdersTable.createdAt, today));

    const count = Number(summary.ordersCount);
    const total = Number(summary.totalSales);

    res.json({
      totalSales: total,
      ordersCount: count,
      avgOrderValue: count > 0 ? total / count : 0,
      topProduct: "لاتيه وسط",
      cashSales: Number(summary.cashSales),
      cardSales: Number(summary.cardSales),
    });
  } catch (err) {
    req.log.error({ err }, "Error fetching POS summary");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
