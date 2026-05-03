import { Router } from "express";
import {
  db,
  posSessionsTable,
  posOrdersTable,
  branchesTable,
  productsTable,
  warehousesTable,
  customersTable,
  customerInvoicesTable,
  customerInvoiceLinesTable,
  salesOrdersTable,
  salesOrderLinesTable,
  deliveryOrdersTable,
  deliveryOrderLinesTable,
} from "@workspace/db";
import { nextRef } from "../lib/sales-engine";
import { buildZatcaQrBase64 } from "../lib/zatca-qr";
import { recordStockMove } from "../lib/stock-engine";
import { eq, gte, sql, desc } from "drizzle-orm";
import { CreatePosSessionBody, CreatePosOrderBody } from "@workspace/api-zod";
import { posGuard, posReadGuard } from "../middlewares/require-role";
import { postJournalEntry } from "../lib/journal-posting";
import {
  customerReceiptsTable,
  customerReceiptAllocationsTable,
  posOrderPaymentsTable,
} from "@workspace/db";
import { requireFinancialLimit } from "../lib/workflow-engine";

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

router.post(
  "/pos/orders",
  posGuard,
  // Cashier discount cap — admins set per-role percentage caps in the
  // workflow tab as `pos.discount_pct` (matches workflow-init seed). We
  // compute the discount as a percentage of the order subtotal (lines
  // total before discount) so caps line up with the seeded
  // cashier=5%/sales=10%/manager=20% defaults.
  requireFinancialLimit("pos.discount_pct", (req) => {
    const lines = (req.body?.lines ?? []) as Array<{ quantity?: number; unitPrice?: number }>;
    const subtotal = lines.reduce(
      (s, l) => s + Number(l.quantity ?? 0) * Number(l.unitPrice ?? 0),
      0,
    );
    const discount = Number(req.body?.discount ?? 0);
    if (subtotal <= 0 || discount <= 0) return 0;
    return (discount / subtotal) * 100;
  }),
  async (req, res) => {
  try {
    const body = CreatePosOrderBody.parse(req.body);

    const discount = body.discount ?? 0;
    const orderNumber = `ORD-${Date.now()}`;

    // Single transaction: product reads/stock decrements, order insert, session
    // update, and GL postings all succeed-or-rollback together. Any failure in
    // posting the journal entry now rolls back the order + stock changes too.
    const result = await db.transaction(async (tx) => {
      // Resolve the session's branch and the warehouse to issue stock from.
      // Prefer the default warehouse for that branch; fall back to the global
      // default. We refuse to sell when no warehouse is configured rather
      // than silently bypassing the ledger.
      const [session] = await tx
        .select({ branchId: posSessionsTable.branchId })
        .from(posSessionsTable)
        .where(eq(posSessionsTable.id, body.sessionId))
        .limit(1);
      if (!session) throw new Error("جلسة نقطة البيع غير موجودة");
      const [branchWh] = await tx
        .select({ id: warehousesTable.id })
        .from(warehousesTable)
        .where(eq(warehousesTable.branchId, session.branchId))
        .orderBy(desc(warehousesTable.isDefault))
        .limit(1);
      const [globalWh] = branchWh
        ? [branchWh]
        : await tx
            .select({ id: warehousesTable.id })
            .from(warehousesTable)
            .where(eq(warehousesTable.isDefault, true))
            .limit(1);
      const issueWarehouseId = (branchWh ?? globalWh)?.id;
      if (!issueWarehouseId) throw new Error("لم يتم تعريف مستودع للفرع");

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
        const lineTotal = unitPrice * item.quantity;
        subtotal += lineTotal;

        // Issue inventory through the engine. Pass no unitCost so the engine
        // applies the product's costing method (FIFO consumes layers, average
        // reads the warehouse avg, standard uses product.costPrice). The cost
        // it returns is the actual COGS for this line.
        const moveResult = await recordStockMove(tx, {
          productId: product.id,
          quantity: item.quantity,
          kind: "issue",
          fromWarehouseId: issueWarehouseId,
          sourceType: "pos_order",
          sourceRef: orderNumber,
          createdBy: req.session?.userId ?? null,
          skipJournal: true,
        });
        const costPrice = moveResult.unitCost;
        totalCost += costPrice * item.quantity;

        orderItems.push({
          productId: product.id,
          productName: product.nameAr,
          quantity: item.quantity,
          unitPrice,
          costPrice,
          total: lineTotal,
        });
      }

      const tax = (subtotal - discount) * 0.15;
      const total = subtotal - discount + tax;

      // Resolve the tendered payments. The split-bill flow sends a
      // `payments[]` array (one row per method); the legacy single-method
      // flow sends `paymentMethod`. We normalise both into a single
      // `tenderedPayments` list and validate the sum matches the order
      // total — refusing the sale rather than silently posting an
      // unbalanced receipt.
      const EPS = 0.01;
      type Tender = { method: "cash" | "card" | "transfer" | "stc"; amount: number; reference?: string | null; payerName?: string | null };
      let tenderedPayments: Tender[];
      if (body.payments && body.payments.length > 0) {
        const sum = body.payments.reduce((a, p) => a + Number(p.amount), 0);
        if (Math.abs(sum - total) > EPS) {
          throw new Error(`مجموع الدفعات (${sum.toFixed(2)}) لا يساوي إجمالي الفاتورة (${total.toFixed(2)})`);
        }
        for (const p of body.payments) {
          if (Number(p.amount) <= 0) throw new Error("قيمة الدفعة يجب أن تكون أكبر من صفر");
        }
        tenderedPayments = body.payments.map((p) => ({
          method: p.method,
          amount: Number(p.amount),
          reference: p.reference ?? null,
          payerName: p.payerName ?? null,
        }));
      } else {
        if (!body.paymentMethod) throw new Error("طريقة الدفع مطلوبة");
        tenderedPayments = [{ method: body.paymentMethod, amount: total, reference: null, payerName: null }];
      }
      const isSplit = tenderedPayments.length > 1;
      const headerPaymentMethod = isSplit ? "split" : tenderedPayments[0].method;

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
          paymentMethod: headerPaymentMethod,
          customerId: body.customerId ?? null,
        })
        .returning();

      // Persist each tendered payment for accurate per-method reporting.
      for (const p of tenderedPayments) {
        await tx.insert(posOrderPaymentsTable).values({
          orderId: created.id,
          method: p.method,
          amount: String(p.amount),
          reference: p.reference,
          payerName: p.payerName,
        });
      }

      await tx
        .update(posSessionsTable)
        .set({
          totalSales: sql`${posSessionsTable.totalSales}::numeric + ${total}`,
          ordersCount: sql`${posSessionsTable.ordersCount} + 1`,
        })
        .where(eq(posSessionsTable.id, body.sessionId));

      // ===== Bridge to the unified Q2C ledger =====
      // POS is a cash-and-carry checkout — we still must produce the same
      // SO/Invoice/Receipt artefacts that the back-office sales flow does so
      // every sale (POS, online, manual) shares one ledger and one A/R view.
      // Walk-in tickets (no customer entered) are routed to the system
      // "POS-WALKIN" customer seeded in sales-init.
      const netRevenue = +(subtotal - discount).toFixed(2);
      let invoiceCustomerId = body.customerId ?? null;
      let invoiceCustomerName: string | null = null;
      if (invoiceCustomerId) {
        const [c] = await tx
          .select({ name: customersTable.name })
          .from(customersTable)
          .where(eq(customersTable.id, invoiceCustomerId))
          .limit(1);
        invoiceCustomerName = c?.name ?? null;
      }
      if (!invoiceCustomerId) {
        const [walkin] = await tx
          .select({ id: customersTable.id, name: customersTable.name })
          .from(customersTable)
          .where(eq(customersTable.taxNumber, "POS-WALKIN"))
          .limit(1);
        if (!walkin) throw new Error("نظام: لا يوجد عميل POS-WALKIN — إعادة تشغيل مطلوبة");
        invoiceCustomerId = walkin.id;
        invoiceCustomerName = walkin.name;
      }

      // Materialise an auto-confirmed SO + DO so POS sales appear in the
      // unified Q2C reporting alongside back-office orders. The SO/DO are
      // already fully fulfilled and invoiced (cash-and-carry), so we just
      // pre-fill quantities and statuses; no extra GL is needed because the
      // inventory issue + invoice + receipt JEs below already cover it.
      const todayStr = new Date().toISOString().slice(0, 10);
      const soRef = await nextRef(tx, "POS-SO");
      const [posSo] = await tx
        .insert(salesOrdersTable)
        .values({
          reference: soRef,
          customerId: invoiceCustomerId,
          customerName: invoiceCustomerName ?? "عميل نقدي",
          warehouseId: issueWarehouseId,
          status: "invoiced",
          orderDate: todayStr,
          subtotal: String(subtotal),
          discount: String(discount),
          vat: String(tax),
          total: String(total),
          notes: `POS ${orderNumber}`,
          source: "pos",
          createdBy: req.session?.userId ?? null,
        })
        .returning();
      const soLineByItemIdx: number[] = [];
      for (const li of orderItems) {
        const [sl] = await tx
          .insert(salesOrderLinesTable)
          .values({
            soId: posSo.id,
            productId: li.productId,
            description: li.productName,
            quantity: String(li.quantity),
            unitPrice: String(li.unitPrice),
            discountPct: "0",
            taxRate: "15",
            lineTotal: String(li.total),
            deliveredQty: String(li.quantity),
            invoicedQty: String(li.quantity),
          })
          .returning({ id: salesOrderLinesTable.id });
        soLineByItemIdx.push(sl.id);
      }
      const doRef = await nextRef(tx, "POS-DO");
      const [posDo] = await tx
        .insert(deliveryOrdersTable)
        .values({
          reference: doRef,
          soId: posSo.id,
          status: "delivered",
          deliveryDate: todayStr,
          warehouseId: issueWarehouseId,
          deliveredAt: new Date(),
          notes: `POS ${orderNumber}`,
          createdBy: req.session?.userId ?? null,
        })
        .returning();
      for (let i = 0; i < orderItems.length; i++) {
        const li = orderItems[i];
        await tx.insert(deliveryOrderLinesTable).values({
          doId: posDo.id,
          soLineId: soLineByItemIdx[i],
          productId: li.productId,
          description: li.productName,
          quantity: String(li.quantity),
        });
      }

      const invRef = await nextRef(tx, "PINV");
      const zatcaQr = buildZatcaQrBase64({
        timestamp: new Date(),
        totalWithVat: total,
        vatAmount: tax,
      });
      const [posInvoice] = await tx
        .insert(customerInvoicesTable)
        .values({
          reference: invRef,
          soId: posSo.id,
          customerId: invoiceCustomerId,
          customerName: invoiceCustomerName ?? "عميل نقدي",
          status: "paid",
          invoiceDate: todayStr,
          dueDate: todayStr,
          subtotal: String(subtotal),
          discount: String(discount),
          vat: String(tax),
          total: String(total),
          amountPaid: String(total),
          zatcaQr,
          source: "pos",
          sourceRef: orderNumber,
          createdBy: req.session?.userId ?? null,
        })
        .returning();
      for (let i = 0; i < orderItems.length; i++) {
        const li = orderItems[i];
        await tx.insert(customerInvoiceLinesTable).values({
          invoiceId: posInvoice.id,
          soLineId: soLineByItemIdx[i],
          productId: li.productId,
          description: li.productName,
          quantity: String(li.quantity),
          unitPrice: String(li.unitPrice),
          discountPct: "0",
          taxRate: "15",
          lineTotal: String(li.total),
        });
      }

      // Invoice JE — same shape as the back-office invoice route:
      //   Dr AR (total) / Cr Sales Revenue (net) / Cr VAT Output (tax)
      const invLines: Array<{
        systemKey: string;
        debit?: number;
        credit?: number;
        description?: string;
      }> = [
        { systemKey: "ar", debit: total, description: `فاتورة POS ${invRef}` },
      ];
      if (discount > 0)
        invLines.push({ systemKey: "sales_discount", debit: discount, description: "خصم POS" });
      if (subtotal > 0)
        invLines.push({ systemKey: "sales_revenue", credit: subtotal, description: "إيرادات POS" });
      if (tax > 0)
        invLines.push({ systemKey: "vat_output", credit: tax, description: "ضريبة 15%" });
      await postJournalEntry(
        tx,
        {
          entryDate: new Date(),
          description: `فاتورة POS — ${invRef}`,
          reference: invRef,
          source: "pos",
          sourceRef: orderNumber,
          createdBy: req.session?.userId ?? null,
          status: "posted",
        },
        invLines,
      );

      // Immediate receipt(s) + allocation against the invoice we just
      // posted — POS pays in full at the till. For split-bill orders we
      // create one customer receipt per tender (so per-method ledgers
      // stay accurate) and one combined journal entry with one debit
      // line per accounting bucket (cash vs bank). 'card' / 'transfer'
      // / 'stc' all settle through the bank account.
      const cashKeyFor = (m: Tender["method"]) => (m === "cash" ? "cash" : "bank");
      const bucketTotals: Record<string, number> = {};
      for (const p of tenderedPayments) {
        const k = cashKeyFor(p.method);
        bucketTotals[k] = (bucketTotals[k] ?? 0) + p.amount;
      }
      // Snap monetary amounts to 2 decimals and absorb any sub-cent drift
      // into the last bucket so debits exactly equal the AR credit.
      const totalRounded = +total.toFixed(2);
      const bucketEntries = Object.entries(bucketTotals).map(
        ([k, v]) => [k, +v.toFixed(2)] as [string, number],
      );
      const bucketSum = +bucketEntries.reduce((a, [, v]) => a + v, 0).toFixed(2);
      const drift = +(totalRounded - bucketSum).toFixed(2);
      if (Math.abs(drift) > 0 && bucketEntries.length > 0) {
        const last = bucketEntries[bucketEntries.length - 1];
        last[1] = +(last[1] + drift).toFixed(2);
      }
      const rcptJe = await postJournalEntry(
        tx,
        {
          entryDate: new Date(),
          description: isSplit
            ? `سند قبض POS مقسم — ${orderNumber}`
            : `سند قبض POS ${orderNumber}`,
          reference: orderNumber,
          source: "payment",
          sourceRef: orderNumber,
          createdBy: req.session?.userId ?? null,
          status: "posted",
        },
        [
          ...bucketEntries.map(([systemKey, amount]) => ({
            systemKey,
            debit: amount,
            description: `قبض ${orderNumber} — ${systemKey === "cash" ? "كاش" : "شبكة/تحويل"}`,
          })),
          { systemKey: "ar", credit: totalRounded, description: "تسوية ذمم — POS" },
        ],
      );
      for (const p of tenderedPayments) {
        const rctRef = await nextRef(tx, "RCT");
        const [posReceipt] = await tx
          .insert(customerReceiptsTable)
          .values({
            reference: rctRef,
            customerId: invoiceCustomerId,
            customerName: invoiceCustomerName ?? "عميل نقدي",
            receiptDate: todayStr,
            amount: String(p.amount),
            paymentMethod: p.method,
            journalEntryId: rcptJe.id,
            createdBy: req.session?.userId ?? null,
          })
          .returning();
        await tx.insert(customerReceiptAllocationsTable).values({
          receiptId: posReceipt.id,
          invoiceId: posInvoice.id,
          amount: String(p.amount),
        });
      }

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
        cashSales: sql<number>`coalesce((
          select sum(amount::numeric)
            from ${posOrderPaymentsTable} pp
            join ${posOrdersTable} po on po.id = pp.order_id
           where po.created_at >= ${today} and pp.method = 'cash'
        ), 0) + coalesce(sum(${posOrdersTable.total}::numeric) filter (where ${posOrdersTable.paymentMethod} = 'cash'), 0)`,
        cardSales: sql<number>`coalesce((
          select sum(amount::numeric)
            from ${posOrderPaymentsTable} pp
            join ${posOrdersTable} po on po.id = pp.order_id
           where po.created_at >= ${today} and pp.method in ('card','transfer','stc')
        ), 0) + coalesce(sum(${posOrdersTable.total}::numeric) filter (where ${posOrdersTable.paymentMethod} in ('card','transfer')), 0)`,
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
