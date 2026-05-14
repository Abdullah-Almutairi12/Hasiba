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
import { processInvoiceForZatca } from "../lib/integrations/zatca-phase2";
import { recordStockMove } from "../lib/stock-engine";
import { eq, gte, sql, desc, inArray, and, isNull } from "drizzle-orm";
import { CreatePosSessionBody, CreatePosOrderBody } from "@workspace/api-zod";
import { posGuard, posReadGuard } from "../middlewares/require-role";
import { postJournalEntry } from "../lib/journal-posting";
import {
  customerReceiptsTable,
  customerReceiptAllocationsTable,
  posOrderPaymentsTable,
  paymentGatewaysTable,
  paymentIntentsTable,
  usersTable,
} from "@workspace/db";
import { checkFinancialLimit } from "../lib/workflow-engine";
import { recordAudit } from "../lib/audit";
import { z } from "zod";
import { createCheckout } from "../lib/integrations/payments";
import bcrypt from "bcryptjs";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";

// Brute-force protection for inline manager dual-authorization on POS
// orders. Keyed by (IP, attempted manager email) so a single station
// cannot attempt more than 10 manager credentials per 15 minutes. We
// skip entirely when no managerOverride payload is present so regular
// POS traffic is not throttled.
const posOverrideLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const ip = ipKeyGenerator(req.ip ?? "");
    const email = (
      (req.body as { managerOverride?: { email?: unknown } } | undefined)
        ?.managerOverride?.email
    );
    const emailKey =
      typeof email === "string" ? email.toLowerCase().trim().slice(0, 254) : "";
    return `pos-override:${ip}:${emailKey}`;
  },
  skip: (req) => {
    const ov = (req.body as { managerOverride?: unknown } | undefined)
      ?.managerOverride;
    return !ov || typeof ov !== "object";
  },
  message: { error: "محاولات تجاوز كثيرة، حاول لاحقاً" },
});

const router = Router();

class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

// Thrown from inside the POS transaction when a per-role financial cap
// (discount % or refund cash) is exceeded. We throw so the surrounding
// `db.transaction(...)` rolls back the in-progress stock moves; the
// outer catch turns it into a 403 + audit log entry.
class FinancialLimitError extends Error {
  actionKey: string;
  max: number | null;
  attempted: number;
  constructor(actionKey: string, max: number | null, attempted: number, message: string) {
    super(message);
    this.name = "FinancialLimitError";
    this.actionKey = actionKey;
    this.max = max;
    this.attempted = attempted;
  }
}

// =============================================================
// Payment-gateway plumbing for the till. Lets the cashier pick any
// enabled gateway, kick off a hosted checkout, poll its status,
// and link the resulting payment_intent to the finalised pos_order
// so accounting + reporting reconcile cleanly.
// =============================================================
// Resolve the caller's branchId from the users table. Owners/managers
// (no branch assigned) see global + every branch's gateways; cashiers
// see only their own branch + global (branchId IS NULL) gateways.
async function getCallerBranchId(userId: number): Promise<number | null> {
  const [u] = await db
    .select({ branchId: usersTable.branchId })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  return u?.branchId ?? null;
}

router.get("/pos/payment-gateways", posReadGuard, async (req, res) => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      res.status(401).json({ error: "غير مصرّح" });
      return;
    }
    const callerBranch = await getCallerBranchId(userId);
    const role = (req.session as { role?: string } | undefined)?.role;
    const isPrivileged = role === "owner" || role === "manager";
    // Branch-scoped gateways visible to a cashier: their own branch +
    // any global (NULL) gateway. Owners/managers see everything.
    const where = isPrivileged
      ? eq(paymentGatewaysTable.isEnabled, true)
      : callerBranch === null
      ? and(
          eq(paymentGatewaysTable.isEnabled, true),
          isNull(paymentGatewaysTable.branchId),
        )
      : and(
          eq(paymentGatewaysTable.isEnabled, true),
          sql`(${paymentGatewaysTable.branchId} = ${callerBranch} OR ${paymentGatewaysTable.branchId} IS NULL)`,
        );
    const rows = await db
      .select({
        id: paymentGatewaysTable.id,
        provider: paymentGatewaysTable.provider,
        displayName: paymentGatewaysTable.displayName,
        environment: paymentGatewaysTable.environment,
        branchId: paymentGatewaysTable.branchId,
      })
      .from(paymentGatewaysTable)
      .where(where)
      .orderBy(paymentGatewaysTable.provider);
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Error listing POS gateways");
    res.status(500).json({ error: "Internal server error" });
  }
});

const PosCheckoutBody = z.object({
  gatewayId: z.coerce.number().int().positive(),
  amount: z.coerce.number().positive(),
  description: z.string().min(1).max(200).optional(),
  customerId: z.coerce.number().int().positive().optional(),
  callbackUrl: z.string().url(),
  cartRef: z.string().min(1).max(64).optional(),
});

router.post("/pos/payment/checkout", posGuard, async (req, res) => {
  try {
    const body = PosCheckoutBody.parse(req.body);
    const userId = req.session?.userId;
    if (!userId) {
      res.status(401).json({ error: "غير مصرّح" });
      return;
    }
    // Tenant guard: a cashier can only initiate charges through a
    // gateway that belongs to their branch (or to a global config).
    // Owners/managers bypass this since they manage every branch.
    const [gw] = await db
      .select({
        id: paymentGatewaysTable.id,
        branchId: paymentGatewaysTable.branchId,
        isEnabled: paymentGatewaysTable.isEnabled,
      })
      .from(paymentGatewaysTable)
      .where(eq(paymentGatewaysTable.id, body.gatewayId))
      .limit(1);
    if (!gw || !gw.isEnabled) {
      res.status(404).json({ error: "بوابة الدفع غير متاحة" });
      return;
    }
    const role = (req.session as { role?: string } | undefined)?.role;
    const isPrivileged = role === "owner" || role === "manager";
    if (!isPrivileged) {
      const callerBranch = await getCallerBranchId(userId);
      if (gw.branchId !== null && gw.branchId !== callerBranch) {
        res.status(403).json({ error: "بوابة الدفع تخص فرعاً آخر" });
        return;
      }
    }
    const out = await createCheckout({
      gatewayId: body.gatewayId,
      amount: body.amount,
      currency: "SAR",
      description: body.description ?? `POS ${body.cartRef ?? "cart"}`,
      customerId: body.customerId,
      callbackUrl: body.callbackUrl,
      metadata: { source: "pos", cartRef: body.cartRef ?? "" },
    });
    res.status(201).json(out);
  } catch (err) {
    req.log.warn({ err }, "POS gateway checkout failed");
    const msg = err instanceof Error ? err.message : "تعذّر بدء الدفع";
    res.status(400).json({ error: msg });
  }
});

router.get("/pos/payment/intent/:id", posReadGuard, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "معرّف غير صالح" });
      return;
    }
    const userId = req.session?.userId;
    if (!userId) {
      res.status(401).json({ error: "غير مصرّح" });
      return;
    }
    // Read intent with its gateway's branchId so we can refuse to
    // leak intent state across branches (would otherwise enable a
    // cashier to discover/poll another branch's payments).
    const [row] = await db
      .select({
        id: paymentIntentsTable.id,
        status: paymentIntentsTable.status,
        providerRef: paymentIntentsTable.providerRef,
        checkoutUrl: paymentIntentsTable.checkoutUrl,
        amount: paymentIntentsTable.amount,
        gatewayId: paymentIntentsTable.gatewayId,
        gatewayBranchId: paymentGatewaysTable.branchId,
        posOrderId: paymentIntentsTable.posOrderId,
        failureReason: paymentIntentsTable.failureReason,
        updatedAt: paymentIntentsTable.updatedAt,
      })
      .from(paymentIntentsTable)
      .leftJoin(
        paymentGatewaysTable,
        eq(paymentGatewaysTable.id, paymentIntentsTable.gatewayId),
      )
      .where(eq(paymentIntentsTable.id, id));
    if (!row) {
      res.status(404).json({ error: "لم يتم العثور على عملية الدفع" });
      return;
    }
    const role = (req.session as { role?: string } | undefined)?.role;
    const isPrivileged = role === "owner" || role === "manager";
    if (!isPrivileged) {
      const callerBranch = await getCallerBranchId(userId);
      if (
        row.gatewayBranchId !== null &&
        row.gatewayBranchId !== callerBranch
      ) {
        res.status(404).json({ error: "لم يتم العثور على عملية الدفع" });
        return;
      }
    }
    const { gatewayBranchId: _omit, ...safe } = row;
    void _omit;
    res.json({ ...safe, amount: Number(row.amount) });
  } catch (err) {
    req.log.error({ err }, "Error fetching payment intent");
    res.status(500).json({ error: "Internal server error" });
  }
});

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

    const ids = orders.map((o) => o.id);
    const payRows = ids.length
      ? await db
          .select()
          .from(posOrderPaymentsTable)
          .where(inArray(posOrderPaymentsTable.orderId, ids))
      : [];
    const payByOrder = new Map<number, Array<{ method: string; amount: number; reference: string | null; payerName: string | null }>>();
    for (const p of payRows) {
      const list = payByOrder.get(p.orderId) ?? [];
      list.push({ method: p.method, amount: Number(p.amount), reference: p.reference ?? null, payerName: p.payerName ?? null });
      payByOrder.set(p.orderId, list);
    }

    res.json(
      orders.map((o) => ({
        ...o,
        subtotal: Number(o.subtotal),
        tax: Number(o.tax),
        discount: Number(o.discount),
        total: Number(o.total),
        payments: payByOrder.get(o.id) ?? [],
        createdAt: o.createdAt.toISOString(),
      }))
    );
  } catch (err) {
    req.log.error({ err }, "Error fetching POS orders");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/pos/orders/:id", posReadGuard, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "معرّف الطلب غير صالح" });
      return;
    }
    const [order] = await db
      .select()
      .from(posOrdersTable)
      .where(eq(posOrdersTable.id, id))
      .limit(1);
    if (!order) {
      res.status(404).json({ error: "الطلب غير موجود" });
      return;
    }
    const payRows = await db
      .select()
      .from(posOrderPaymentsTable)
      .where(eq(posOrderPaymentsTable.orderId, id));
    res.json({
      ...order,
      subtotal: Number(order.subtotal),
      tax: Number(order.tax),
      discount: Number(order.discount),
      total: Number(order.total),
      payments: payRows.map((p) => ({
        method: p.method,
        amount: Number(p.amount),
        reference: p.reference ?? null,
        payerName: p.payerName ?? null,
      })),
      createdAt: order.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Error fetching POS order");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post(
  "/pos/orders",
  posGuard,
  posOverrideLimiter,
  async (req, res) => {
  try {
    const body = CreatePosOrderBody.parse(req.body);

    const discount = body.discount ?? 0;
    const orderNumber = `ORD-${Date.now()}`;
    const paymentIntentId = (body as { paymentIntentId?: number | null })
      .paymentIntentId ?? null;

    // ============ Manager dual-authorization (four-eyes) ============
    // The cashier may attach { managerOverride: { email, password } } to
    // exceed their per-role financial limit (discount %, refund cash) on
    // this single transaction. We verify the credentials BEFORE the
    // transaction starts, audit it, and use the manager's role for the
    // limit check so cashiers can ring large discounts/refunds only when
    // a manager is physically present and types their PIN.
    const rawOverride = (req.body as { managerOverride?: { email?: unknown; password?: unknown; reason?: unknown } } | undefined)?.managerOverride;
    let overrideRoleEffective: string | null = null;
    let overrideUserId: number | null = null;
    let overrideUserName: string | null = null;
    let overrideReason: string | null = null;
    if (rawOverride && typeof rawOverride.email === "string" && typeof rawOverride.password === "string") {
      // Cap field sizes BEFORE any DB hit or bcrypt compare so an attacker
      // can't waste CPU with multi-MB passwords or oversized emails.
      const email = rawOverride.email.toLowerCase().trim().slice(0, 254);
      const password = rawOverride.password.slice(0, 200);
      if (!email || !password) {
        res.status(401).json({ error: "بيانات المدير غير صحيحة" });
        return;
      }
      const [mgr] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.email, email));
      if (!mgr || !mgr.passwordHash || !mgr.isActive) {
        res.status(401).json({ error: "بيانات المدير غير صحيحة" });
        return;
      }
      if (mgr.role !== "manager" && mgr.role !== "owner") {
        res.status(403).json({ error: "هذا المستخدم لا يملك صلاحية اعتماد التجاوز" });
        return;
      }
      if (mgr.id === req.session?.userId) {
        res.status(403).json({ error: "لا يمكنك اعتماد تجاوز لنفسك (مبدأ فصل المهام)" });
        return;
      }
      const ok = await bcrypt.compare(password, mgr.passwordHash);
      if (!ok) {
        // Audit the failed attempt so brute-force shows up in the log.
        void recordAudit(req, {
          action: "override_failed",
          entity: "pos_order",
          details: `محاولة تجاوز فاشلة باسم ${email}`,
        });
        res.status(401).json({ error: "بيانات المدير غير صحيحة" });
        return;
      }
      overrideRoleEffective = mgr.role;
      overrideUserId = mgr.id;
      overrideUserName = mgr.name;
      overrideReason = typeof rawOverride.reason === "string" ? rawOverride.reason.slice(0, 500) : null;
      // Note: we record the success audit AFTER the transaction commits
      // (below) so the audit row is linked to the actual orderNumber and
      // we don't get phantom override approvals for orders that failed.
    }

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

      // ============== Per-role financial limits ==============
      // We enforce caps using ONLY trusted values: `orderItems` was just
      // built from `productsTable.price` (server-side), so the client
      // cannot bypass either ceiling by sending bogus unitPrices.
      // Caps are seeded in `financial_limits` (see workflow-init):
      //   pos.discount_pct  — cashier=5%, sales=10%, manager=20%, owner=∞
      //   pos.refund_amount — cashier=500, manager=5000, owner=∞
      // Returns at the POS are modeled as negative-quantity items; cash
      // given back beyond the items' positive subtotal is also a refund.
      const sessionRole = (req.session as { role?: string } | undefined)?.role;
      if (!sessionRole) throw new ValidationError("غير مصرّح");
      // If a valid manager override is attached, the financial-limit
      // check runs against the manager's role (effectively granting the
      // higher cap for this one transaction). Otherwise the cashier's
      // own role is used.
      const role = overrideRoleEffective ?? sessionRole;
      let positiveSubtotal = 0;
      let refundFromReturns = 0;
      for (const ln of orderItems) {
        if (ln.quantity < 0) refundFromReturns += -ln.total;
        else positiveSubtotal += ln.total;
      }
      const trustedDiscountPct =
        positiveSubtotal > 0 && discount > 0 ? (discount / positiveSubtotal) * 100 : 0;
      const refundCash = refundFromReturns + Math.max(0, discount - positiveSubtotal);
      const dCheck = await checkFinancialLimit(role, "pos.discount_pct", trustedDiscountPct);
      if (!dCheck.allowed) {
        throw new FinancialLimitError(
          "pos.discount_pct",
          dCheck.max,
          trustedDiscountPct,
          dCheck.reason ?? "تجاوزت الحد المسموح للخصم",
        );
      }
      if (refundCash > 0) {
        const rCheck = await checkFinancialLimit(role, "pos.refund_amount", refundCash);
        if (!rCheck.allowed) {
          throw new FinancialLimitError(
            "pos.refund_amount",
            rCheck.max,
            refundCash,
            rCheck.reason ?? "تجاوزت الحد المسموح للاسترداد",
          );
        }
      }

      const tax = (subtotal - discount) * 0.15;
      const total = subtotal - discount + tax;
      const EPS = 0.01;

      // ===== Gateway intent validation (inside the txn) =====
      // We validate amount + currency + status + uniqueness HERE — not
      // in a pre-flight read — so the row is locked, the consumption
      // is atomic, and an underpaying intent can never be bound to a
      // higher-value order. The conditional UPDATE at link time
      // guarantees only one POS order can ever consume a given intent.
      let validatedIntent:
        | (typeof paymentIntentsTable.$inferSelect)
        | null = null;
      if (paymentIntentId) {
        const [pi] = await tx
          .select()
          .from(paymentIntentsTable)
          .where(eq(paymentIntentsTable.id, paymentIntentId))
          .for("update");
        if (!pi) throw new ValidationError("عملية الدفع غير موجودة");
        // Cross-branch IDOR guard: the intent's gateway must belong to
        // the same branch as the POS session (or be a global gateway).
        const [intentGw] = await tx
          .select({ branchId: paymentGatewaysTable.branchId })
          .from(paymentGatewaysTable)
          .where(eq(paymentGatewaysTable.id, pi.gatewayId))
          .limit(1);
        if (
          intentGw &&
          intentGw.branchId !== null &&
          intentGw.branchId !== session.branchId
        ) {
          throw new ValidationError("عملية الدفع تخص فرعاً آخر");
        }
        if (pi.status !== "captured" && pi.status !== "paid") {
          throw new ValidationError(
            `عملية الدفع لم تكتمل بعد (${pi.status})`,
          );
        }
        if (pi.posOrderId) {
          throw new ValidationError(
            `هذه العملية مرتبطة بطلب ${pi.posOrderId} بالفعل`,
          );
        }
        if ((pi.currency ?? "SAR").toUpperCase() !== "SAR") {
          throw new ValidationError(
            `عملة بوابة الدفع (${pi.currency}) لا تطابق عملة الفاتورة (SAR)`,
          );
        }
        const intentAmount = Number(pi.amount);
        if (Math.abs(intentAmount - total) > EPS) {
          throw new ValidationError(
            `قيمة الدفع (${intentAmount.toFixed(2)}) لا تساوي إجمالي الفاتورة (${total.toFixed(2)})`,
          );
        }
        validatedIntent = pi;
      }

      // ===== Tender ↔ intent classification consistency =====
      // If a gateway intent was attached, every tendered line must
      // be a non-cash electronic settlement (card / transfer / stc),
      // and the bank-side amount must equal the intent amount. This
      // blocks a tampered client from binding a captured intent to a
      // cash receipt and forcing the JE into the wrong account.
      const checkTenderForIntent = (
        rows: Array<{ method: string; amount: number }>,
      ) => {
        if (!paymentIntentId) return;
        const allowed = new Set(["card", "transfer", "stc"]);
        const bankSide = rows.filter((r) => allowed.has(r.method));
        const cashOrDeferred = rows.filter(
          (r) => r.method === "cash" || r.method === "deferred",
        );
        if (cashOrDeferred.length > 0) {
          throw new ValidationError(
            "لا يمكن إقران دفعة نقدية أو آجلة مع عملية بوابة دفع",
          );
        }
        const settled = bankSide.reduce((a, r) => a + r.amount, 0);
        if (Math.abs(settled - total) > EPS) {
          throw new ValidationError(
            `مجموع الدفعات الإلكترونية (${settled.toFixed(2)}) لا يطابق إجمالي الفاتورة (${total.toFixed(2)})`,
          );
        }
      };

      // Resolve the tendered payments. The split-bill flow sends a
      // `payments[]` array (one row per method); the legacy single-method
      // flow sends `paymentMethod`. We normalise both into a single
      // `tenderedPayments` list and validate the sum matches the order
      // total — refusing the sale rather than silently posting an
      // unbalanced receipt.
      type Tender = { method: "cash" | "card" | "transfer" | "stc" | "deferred"; amount: number; reference?: string | null; payerName?: string | null };
      let tenderedPayments: Tender[];
      if (body.payments && body.payments.length > 0) {
        const sum = body.payments.reduce((a, p) => a + Number(p.amount), 0);
        if (Math.abs(sum - total) > EPS) {
          throw new ValidationError(`مجموع الدفعات (${sum.toFixed(2)}) لا يساوي إجمالي الفاتورة (${total.toFixed(2)})`);
        }
        for (const p of body.payments) {
          if (Number(p.amount) <= 0) throw new ValidationError("قيمة الدفعة يجب أن تكون أكبر من صفر");
        }
        tenderedPayments = body.payments.map((p) => ({
          method: p.method,
          amount: Number(p.amount),
          reference: p.reference ?? null,
          payerName: p.payerName ?? null,
        }));
      } else {
        if (!body.paymentMethod) throw new ValidationError("طريقة الدفع مطلوبة");
        tenderedPayments = [{ method: body.paymentMethod, amount: total, reference: null, payerName: null }];
      }
      checkTenderForIntent(tenderedPayments);
      const isSplit = tenderedPayments.length > 1;
      const headerPaymentMethod = isSplit ? "split" : tenderedPayments[0].method;
      const settledTotalUpfront = +tenderedPayments
        .filter((p) => p.method !== "deferred")
        .reduce((a, p) => a + p.amount, 0)
        .toFixed(2);
      const deferredTotal = +(total - settledTotalUpfront).toFixed(2);
      const invoiceStatus =
        deferredTotal <= 0.005
          ? "paid"
          : settledTotalUpfront <= 0.005
            ? "open"
            : "partially_paid";

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
          reference: p.reference ?? (validatedIntent && p.method !== "cash" && p.method !== "deferred"
            ? validatedIntent.providerRef ?? `intent#${validatedIntent.id}`
            : null),
          payerName: p.payerName,
        });
      }

      // Link the gateway intent back to this finalised POS order so
      // ops/reporting can reconcile gateway captures ↔ POS sales.
      // Conditional WHERE pos_order_id IS NULL guarantees that two
      // concurrent sales can never both consume the same intent —
      // exactly one will get the row, the other rolls back.
      if (validatedIntent) {
        const linked = await tx
          .update(paymentIntentsTable)
          .set({ posOrderId: created.id, updatedAt: new Date() })
          .where(
            and(
              eq(paymentIntentsTable.id, validatedIntent.id),
              isNull(paymentIntentsTable.posOrderId),
            ),
          )
          .returning({ id: paymentIntentsTable.id });
        if (linked.length === 0) {
          throw new ValidationError(
            "تم استهلاك عملية الدفع من قبل طلب آخر",
          );
        }
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
          status: invoiceStatus,
          invoiceDate: todayStr,
          dueDate: todayStr,
          subtotal: String(subtotal),
          discount: String(discount),
          vat: String(tax),
          total: String(total),
          amountPaid: String(settledTotalUpfront),
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
      // 'deferred' tenders represent credit sales — the AR row created by
      // the invoice JE stays open for that portion. Only settled tenders
      // (cash/bank) drive the receipt JE and customer_receipts.
      const settledPayments = tenderedPayments.filter((p) => p.method !== "deferred");
      const bucketTotals: Record<string, number> = {};
      for (const p of settledPayments) {
        const k = cashKeyFor(p.method);
        bucketTotals[k] = (bucketTotals[k] ?? 0) + p.amount;
      }
      const settledTotal = +settledPayments.reduce((a, p) => a + p.amount, 0).toFixed(2);
      const bucketEntries = Object.entries(bucketTotals).map(
        ([k, v]) => [k, +v.toFixed(2)] as [string, number],
      );
      // Absorb any sub-cent drift so debits exactly equal the AR credit.
      const bucketSum = +bucketEntries.reduce((a, [, v]) => a + v, 0).toFixed(2);
      const drift = +(settledTotal - bucketSum).toFixed(2);
      if (Math.abs(drift) > 0 && bucketEntries.length > 0) {
        const last = bucketEntries[bucketEntries.length - 1];
        last[1] = +(last[1] + drift).toFixed(2);
      }
      let rcptJeId: number | null = null;
      if (settledTotal > 0 && bucketEntries.length > 0) {
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
            { systemKey: "ar", credit: settledTotal, description: "تسوية ذمم — POS" },
          ],
        );
        rcptJeId = rcptJe.id;
      }
      for (const p of settledPayments) {
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
            journalEntryId: rcptJeId,
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

      return {
        order: created,
        total,
        subtotal,
        tax,
        orderItems,
        invoiceId: posInvoice.id,
        invoiceRef: invRef,
        invoiceBranchId: posInvoice.branchId ?? null,
        invoiceCustomerName: invoiceCustomerName ?? "عميل نقدي",
        payments: tenderedPayments.map((p) => ({
          method: p.method,
          amount: p.amount,
          reference: p.reference ?? null,
          payerName: p.payerName ?? null,
        })),
      };
    });

    // Module hook: auto-submit the just-issued POS invoice to ZATCA
    // (simplified / "reporting" subset). Fire-and-forget after the
    // transaction commits so checkout is never blocked by Fatoora
    // latency. Failures land in the retry queue.
    void processInvoiceForZatca({
      invoiceId: result.invoiceId,
      invoiceNumber: result.invoiceRef,
      issueDate: new Date(),
      invoiceType: "simplified",
      sellerName: process.env["ZATCA_SELLER_NAME"] ?? "حاسبة AI",
      sellerVat: process.env["ZATCA_VAT_NUMBER"] ?? "300000000000003",
      buyerName: result.invoiceCustomerName,
      buyerVat: null,
      totalExclVat: Number(result.subtotal.toFixed(2)),
      vatAmount: Number(result.tax.toFixed(2)),
      totalInclVat: Number(result.total.toFixed(2)),
      branchId: result.invoiceBranchId,
    }).catch((e: unknown) => {
      req.log.warn(
        { err: e, invoiceId: result.invoiceId },
        "ZATCA auto-submit failed (queued for retry)",
      );
    });

    // Now that the order is committed, record the override audit linked to
    // the actual order id/number so forensic queries can trace who approved
    // which transaction.
    if (overrideUserId && overrideUserName) {
      void recordAudit(req, {
        action: "override",
        entity: "pos_order",
        details: `اعتماد ${overrideUserName} (#${overrideUserId}) لتجاوز حد الكاشير على الطلب ${orderNumber} (orderId=${result.order.id})${overrideReason ? " — " + overrideReason : ""}`,
      });
    }

    res.status(201).json({
      ...result.order,
      items: result.orderItems,
      subtotal: result.subtotal,
      tax: result.tax,
      discount,
      total: result.total,
      payments: result.payments,
      createdAt: result.order.createdAt.toISOString(),
    });
  } catch (err) {
    if (err instanceof FinancialLimitError) {
      const role = (req.session as { role?: string } | undefined)?.role ?? "unknown";
      void recordAudit(req, {
        action: "financial_limit_exceeded",
        entity: err.actionKey,
        details: `الدور ${role} حاول إجراء بقيمة ${err.attempted.toFixed(2)} وتجاوز الحد المسموح (${err.max ?? "—"}) لـ ${err.actionKey}`,
        severity: "warning",
      });
      req.log.warn({ err }, "POS order rejected — financial limit exceeded");
      // The UI uses requiresManagerApproval as the signal to pop the
      // manager-PIN dialog; the cashier then retries with the same body
      // plus { managerOverride: { email, password } }.
      res.status(403).json({
        error: err.message,
        actionKey: err.actionKey,
        max: err.max,
        attempted: err.attempted,
        requiresManagerApproval: true,
      });
      return;
    }
    if (err instanceof ValidationError) {
      req.log.warn({ err }, "POS order validation failed");
      res.status(400).json({ error: err.message });
      return;
    }
    const msg = err instanceof Error ? err.message : "";
    if (
      /لا يمكن إصدار مخزون|الكمية المتاحة|رصيد|stock|insufficient/i.test(msg)
    ) {
      req.log.warn({ err }, "POS order rejected — stock issue");
      res.status(400).json({ error: msg || "لا يوجد رصيد كافٍ في المخزون" });
      return;
    }
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
        // Per-tender bucketing reads from pos_order_payments which now has
        // one row per tender for every order (legacy single-method orders
        // included), so we don't need to fall back to pos_orders.payment_method.
        cashSales: sql<number>`coalesce((
          select sum(pp.amount::numeric)
            from ${posOrderPaymentsTable} pp
            join ${posOrdersTable} po on po.id = pp.order_id
           where po.created_at >= ${today} and pp.method = 'cash'
        ), 0)`,
        cardSales: sql<number>`coalesce((
          select sum(pp.amount::numeric)
            from ${posOrderPaymentsTable} pp
            join ${posOrdersTable} po on po.id = pp.order_id
           where po.created_at >= ${today} and pp.method = 'card'
        ), 0)`,
        transferSales: sql<number>`coalesce((
          select sum(pp.amount::numeric)
            from ${posOrderPaymentsTable} pp
            join ${posOrdersTable} po on po.id = pp.order_id
           where po.created_at >= ${today} and pp.method = 'transfer'
        ), 0)`,
        stcSales: sql<number>`coalesce((
          select sum(pp.amount::numeric)
            from ${posOrderPaymentsTable} pp
            join ${posOrdersTable} po on po.id = pp.order_id
           where po.created_at >= ${today} and pp.method = 'stc'
        ), 0)`,
        deferredSales: sql<number>`coalesce((
          select sum(pp.amount::numeric)
            from ${posOrderPaymentsTable} pp
            join ${posOrdersTable} po on po.id = pp.order_id
           where po.created_at >= ${today} and pp.method = 'deferred'
        ), 0)`,
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
      transferSales: Number(summary.transferSales),
      stcSales: Number(summary.stcSales),
      deferredSales: Number(summary.deferredSales),
    });
  } catch (err) {
    req.log.error({ err }, "Error fetching POS summary");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
