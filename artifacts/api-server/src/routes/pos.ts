import { randomUUID } from "node:crypto";
import { returnAuthorize } from "../lib/return-access";
import { scopedPosOrderVisible } from "../lib/scoped-pos-operations";
import { Router } from "express";
import { posDeviceAuthority } from "../lib/pos-device-authority";
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
  companiesTable,
  salesOrdersTable,
  salesOrderLinesTable,
  deliveryOrdersTable,
  deliveryOrderLinesTable,
} from "@workspace/db";
import { nextRef } from "../lib/sales-engine";
import { buildZatcaQrBase64 } from "../lib/zatca-qr";
import { captureIssuer, saveIssuer } from "../lib/document-identity";
import { recordSaleSellers } from "../lib/seller-ledger";
import { getCompanyInfo } from "../lib/pdf/purchase-order";
import { parsePagination } from "../lib/pagination";
import { processInvoiceForZatca } from "../lib/integrations/zatca-phase2";
import { recordStockMove,StockAvailabilityError } from "../lib/stock-engine";
import { stockMovesTable } from "@workspace/db";
import { eq, gte, sql, desc, inArray, and, isNull } from "drizzle-orm";
import { CreatePosSessionBody, CreatePosOrderBody } from "@workspace/api-zod";
import { posGuard, posReadGuard } from "../middlewares/require-role";
import { postJournalEntry } from "../lib/journal-posting";
import { getCompanyId } from "../lib/scoped-db";
import { financialTransaction, FinancialRequestError } from "../lib/financial-transaction";
import {
  customerReceiptsTable,
  customerReceiptAllocationsTable,
  posOrderPaymentsTable,
  paymentGatewaysTable,
  paymentIntentsTable,
  usersTable,
  approvalRequestsTable,
} from "@workspace/db";
import { assertDeferredPosApproval, checkFinancialLimit, submitForApproval } from "../lib/workflow-engine";
import { lockApprovalAuthority } from "../lib/approval-authority";
import { managedProfile, selectedResponsibility, recordPosResponsibility } from "../lib/responsibility-context";
import { verifyAccountPassword } from "../lib/account-password";
import { approvalSourceFingerprint, approvalSourceMatches } from "../lib/approval-source";
import { matchesPosApprovalNotes, posApprovalNotes } from "../lib/pos-approval-intent";
import { recordAudit } from "../lib/audit";
import { evaluateAnomalies } from "../lib/anomaly-engine";
import { z } from "zod";
import { createCheckout } from "../lib/integrations/payments";
import bcrypt from "bcryptjs";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { branchScope } from "../lib/company-access";
import { ensurePosWalkinCustomer } from "../lib/pos-walkin-customer";

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
// see all branches in the active company; cashiers see only their own
// branch within that company. Branchless legacy gateways are not owned.
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
    const where = and(
      eq(paymentGatewaysTable.isEnabled, true),
      branchScope(paymentGatewaysTable.branchId, req.session.companyId!),
      isPrivileged ? undefined : eq(paymentGatewaysTable.branchId, callerBranch ?? -1),
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
    // gateway in the active company, narrowed to their own branch.
    // Owners/managers manage all branches within that company only.
    const [gw] = await db
      .select({
        id: paymentGatewaysTable.id,
        branchId: paymentGatewaysTable.branchId,
        isEnabled: paymentGatewaysTable.isEnabled,
      })
      .from(paymentGatewaysTable)
      .where(and(eq(paymentGatewaysTable.id, body.gatewayId),
        branchScope(paymentGatewaysTable.branchId, req.session.companyId!)))
      .limit(1);
    if (!gw || !gw.isEnabled) {
      res.status(404).json({ error: "بوابة الدفع غير متاحة" });
      return;
    }
    const role = (req.session as { role?: string } | undefined)?.role;
    const isPrivileged = role === "owner" || role === "manager";
    if (!isPrivileged) {
      const callerBranch = await getCallerBranchId(userId);
      if (gw.branchId !== callerBranch) {
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
    }, req.session.companyId!);
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
      .innerJoin(
        paymentGatewaysTable,
        eq(paymentGatewaysTable.id, paymentIntentsTable.gatewayId),
      )
      .where(and(eq(paymentIntentsTable.id, id),
        branchScope(paymentGatewaysTable.branchId, req.session.companyId!)));
    if (!row) {
      res.status(404).json({ error: "لم يتم العثور على عملية الدفع" });
      return;
    }
    const role = (req.session as { role?: string } | undefined)?.role;
    const isPrivileged = role === "owner" || role === "manager";
    if (!isPrivileged) {
      const callerBranch = await getCallerBranchId(userId);
      if (
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
    // Tenant scope: pos_sessions has no direct company_id, so we
    // enforce isolation via INNER JOIN on branches.company_id —
    // sessions belonging to other tenants' branches are filtered out.
    const companyId = getCompanyId(req);
    const actor = await returnAuthorize(req.session.userId!, companyId, "view");
    const device = posDeviceAuthority.getStore();
    const sessions = await db
      .select({
        id: posSessionsTable.id,
        sessionNumber: posSessionsTable.sessionNumber,
        posStationId: posSessionsTable.posStationId,
        cashierUserId: posSessionsTable.cashierUserId,
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
      .innerJoin(
        branchesTable,
        and(
          eq(posSessionsTable.branchId, branchesTable.id),
          eq(branchesTable.companyId, companyId),
        ),
      )
      .where(and(
        actor.branches ? inArray(posSessionsTable.branchId, actor.branches) : undefined,
        device ? eq(posSessionsTable.branchId, device.branchId) : undefined,
        device ? eq(posSessionsTable.posStationId, device.stationId) : undefined,
        device ? eq(posSessionsTable.cashierUserId, device.userId) : undefined,
      ))
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
    if (err instanceof FinancialRequestError) { res.status(err.status).json({ error: err.message, diagnosticRef: String(req.id) }); return; }
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/pos/sessions", posGuard, async (req, res) => {
  try {
    const body = CreatePosSessionBody.parse(req.body);
    const sessionNumber = `WRD-${Date.now()}-${randomUUID().slice(0,8)}`;
    // Tenant ownership: refuse to open a POS session on a branch
    // that belongs to a different company. Returns 404 to hide
    // existence of foreign branches.
    const companyId = getCompanyId(req);
    const { session, branch } = await financialTransaction(req, async tx => {
    await lockApprovalAuthority(tx);
    let cashierName = body.cashierName;
    if (await managedProfile(req.session.userId!, companyId, tx)) {
      const grant = await selectedResponsibility(req.session.userId!, companyId, tx);
      if (!grant || grant.resource !== "pos" || !grant.actions.includes("pos.shift.open") || grant.branchId !== body.branchId) {
        throw new FinancialRequestError("فتح الوردية خارج المسؤولية الحالية", 403);
      }
      const names = await tx.execute(sql`SELECT e.name_ar FROM employees e
        JOIN employee_access a ON a.employee_id=e.id AND a.company_id=e.company_id
        WHERE a.user_id=${req.session.userId!} AND a.company_id=${companyId}`);
      cashierName = String(names.rows[0]?.name_ar ?? "");
      if (!cashierName) throw new FinancialRequestError("تعذر إثبات هوية فاتح الوردية", 403);
    } else await returnAuthorize(req.session.userId!, companyId, "sell", body.branchId, tx);
    const [branchRow] = await tx
      .select()
      .from(branchesTable)
      .where(and(eq(branchesTable.id, body.branchId), eq(branchesTable.companyId, companyId)))
      .limit(1);
    if (!branchRow) {
      throw new FinancialRequestError("الفرع غير موجود", 404);
    }

    const [session] = await tx
      .insert(posSessionsTable)
      .values({
        posStationId: posDeviceAuthority.getStore()?.stationId ?? null,
        cashierUserId: req.session.userId!,
        sessionNumber,
        branchId: body.branchId,
        cashierName,
        openingCash: String(body.openingCash),
      })
      .returning();

    return { session, branch: [branchRow] };
    });

    res.status(201).json({
      ...session,
      branchName: branch[0]?.nameAr ?? "",
      totalSales: Number(session.totalSales),
      openedAt: session.openedAt.toISOString(),
      closedAt: null,
    });
  } catch (err) {
    req.log.error({ err }, "Error creating POS session");
    if (err instanceof FinancialRequestError) { res.status(err.status).json({ error: err.message, diagnosticRef: String(req.id) }); return; }
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/pos/orders", posReadGuard, async (req, res) => {
  try {
    const { sessionId, date } = req.query;
    // Tenant scope: pos_orders.company_id is NOT NULL — enforce per-tenant.
    const companyId = getCompanyId(req);
    const { limit, offset } = parsePagination(req);
    const actor = await returnAuthorize(req.session.userId!, companyId, "view");
    const responsibility=await managedProfile(req.session.userId!,companyId)
      ? await selectedResponsibility(req.session.userId!,companyId) : null;
    const warehouseFilter=responsibility ? sql`EXISTS(SELECT 1 FROM sales_orders so WHERE so.company_id=${companyId}
      AND so.source='pos' AND so.notes='POS '||${posOrdersTable.orderNumber}
      AND so.warehouse_id=ANY(${sql.param(responsibility.warehouseIds)}::integer[]))` : sql`true`;
    const branchFilter = actor.branches == null ? sql`true` : actor.branches.length
      ? inArray(posOrdersTable.sessionId, db.select({ id: posSessionsTable.id }).from(posSessionsTable).where(inArray(posSessionsTable.branchId, actor.branches)))
      : sql`false`;

    const orders = await db
      .select()
      .from(posOrdersTable)
      .where(
        sql`${posOrdersTable.companyId} = ${companyId} and ${branchFilter} and ${warehouseFilter}
          ${sessionId ? sql`and ${posOrdersTable.sessionId} = ${Number(sessionId)}` : sql``}
          ${date ? sql`and date(${posOrdersTable.createdAt}) = ${date}` : sql``}`
      )
      .orderBy(desc(posOrdersTable.createdAt))
      .limit(limit)
      .offset(offset);

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
    if (err instanceof FinancialRequestError) { res.status(err.status).json({ error: err.message, diagnosticRef: String(req.id) }); return; }
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/pos/orders/:id", posReadGuard, async (req, res, next) => {
  try {
    // Disambiguate from sibling literal routes like /pos/orders/parked
    // that are declared later in the file. Express matches by registration
    // order, so without this forward the literal handler is shadowed.
    if (req.params.id === "parked") {
      next();
      return;
    }
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "معرّف الطلب غير صالح" });
      return;
    }
    // Tenant scope: cross-tenant GET returns 404 (hide existence).
    const companyId = getCompanyId(req);
    const [order] = await db
      .select()
      .from(posOrdersTable)
      .where(and(eq(posOrdersTable.id, id), eq(posOrdersTable.companyId, companyId)))
      .limit(1);
    if (!order) {
      res.status(404).json({ error: "الطلب غير موجود" });
      return;
    }
    const [sourceSession]=await db.select({branchId:posSessionsTable.branchId}).from(posSessionsTable)
      .where(eq(posSessionsTable.id,order.sessionId)).limit(1);
    if(!sourceSession) throw new FinancialRequestError("الوردية غير متاحة",404);
    await returnAuthorize(req.session.userId!,companyId,"view",sourceSession.branchId);
    await scopedPosOrderVisible(db,req.session.userId!,companyId,id);
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
    if (err instanceof FinancialRequestError) { res.status(err.status).json({ error: err.message, diagnosticRef: String(req.id) }); return; }
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post(
  "/pos/orders",
  posGuard,
  posOverrideLimiter,
  async (req, res) => {
  let approvalQuote: Record<string, unknown> | null = null;
  try {
    const parsed = CreatePosOrderBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "بيانات البيع غير صالحة. راجع الحقول والكميات الموجبة؛ المرتجع يتم من الفاتورة الأصلية.",
        details: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      });
      return;
    }
    const body = parsed.data;

    const discount = body.discount ?? 0;
    let requestOnlyDiscount = false;
    const orderNumber = `ORD-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const paymentIntentId = (body as { paymentIntentId?: number | null })
      .paymentIntentId ?? null;

    // ============ Manager dual-authorization (four-eyes) ============
    // The cashier may attach { managerOverride: { email, password } } to
    // exceed their per-role financial limit (discount %, refund cash) on
    // this single transaction. We verify credentials AFTER replay lookup
    // and before checkout writes, then use the manager's role for the
    // limit check so cashiers can ring large discounts/refunds only when
    // a manager is physically present and types their PIN.
    const rawOverride = (req.body as { managerOverride?: { email?: unknown; password?: unknown; reason?: unknown } } | undefined)?.managerOverride;
    const rawApprovalReqId = (req.body as { approvalRequestId?: unknown } | undefined)?.approvalRequestId;
    let overrideRoleEffective: string | null = null;
    let overrideUserId: number | null = null;
    let overrideUserName: string | null = null;
    let overrideReason: string | null = null;
    let consumedApprovalRequestId: number | null = null;

    // Async path: the cashier can attach an `approvalRequestId` that a
    // manager already approved from /approvals. We validate AND consume
    // it atomically (status approved → consumed) inside checkout
    // so it can be used exactly once. Must match docType=pos_over_limit
    // and the same POS session, so an approval for one till cannot be
    // replayed at another.
    // Pending approval data — validated up-front, but consumed atomically
    // INSIDE the main transaction so the consume is bound to the exact
    // attempted amount/action and is rolled back if the order fails.
    let pendingApprovalRow: {
      id: number;
      approvedAmount: number;
      actionKey: string | null;
      submittedByName: string | null;
      notes: string | null;
    } | null = null;
    const companyId = getCompanyId(req);
    const [companyRow] = await db.select({ vatRegistrationStatus: companiesTable.vatRegistrationStatus })
      .from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1);
    const vatEnabled = companyRow?.vatRegistrationStatus === "registered" || companyRow?.vatRegistrationStatus === "voluntary";
    // Replay lookup runs before one-use approval/manager validation.
    // New intents still validate and consume approval in this transaction.
    const result = await financialTransaction(req, async (tx) => {
      await lockApprovalAuthority(tx);
      const issuer = await captureIssuer(tx, companyId);
      const vatEnabled = issuer.vatEnabled;
      const sellerNameForZatca = issuer.nameAr;
      const sellerVatForZatca = issuer.vatNumber;
    if (typeof rawApprovalReqId === "number" && Number.isFinite(rawApprovalReqId)) {
      const sessionIdRaw = (req.body as { sessionId?: unknown } | undefined)?.sessionId;
      const sessionId = typeof sessionIdRaw === "number" ? sessionIdRaw : null;
      if (sessionId == null) throw new FinancialRequestError("يلزم تحديد وردية الاعتماد", 400);
      // Source then approval row: same order as submission and decisions.
      await approvalSourceFingerprint(companyId, "pos_over_limit", sessionId, tx);
      const [reqRow] = await tx
        .select()
        .from(approvalRequestsTable)
        .where(and(eq(approvalRequestsTable.id, rawApprovalReqId),
          eq(approvalRequestsTable.companyId, companyId)))
        .limit(1).for("update");
      if (
        !reqRow ||
        !reqRow.sourceFingerprint || reqRow.sourceFingerprintVersion !== 1 ||
        reqRow.docType !== "pos_over_limit" ||
        reqRow.status !== "approved" ||
        reqRow.recordId !== sessionId
      ) {
        throw new FinancialRequestError("طلب الموافقة غير صالح أو مستهلك", 403);
      }
      if (reqRow.reviewInvalidatedAt || !await approvalSourceMatches(reqRow, tx)) {
        throw new FinancialRequestError("المراجعة لا تطابق حقائق الوردية ونية البيع الحالية؛ يلزم اعتماد جديد", 409);
      }
      await assertDeferredPosApproval(reqRow, tx);
      // Recover the original action key from recordRef which was written
      // as `POS session #<id> — <actionKey>`. Used to refuse mismatches
      // (a discount approval cannot be consumed by a refund attempt).
      const actionKey =
        reqRow.recordRef && reqRow.recordRef.includes("— ")
          ? reqRow.recordRef.split("— ")[1]?.trim() ?? null
          : null;
      pendingApprovalRow = {
        id: reqRow.id,
        approvedAmount: Number(reqRow.amount ?? 0),
        actionKey,
        submittedByName: reqRow.submittedByName,
        notes: reqRow.notes,
      };
      overrideUserName = reqRow.submittedByName ?? "approved-via-inbox";
      overrideUserId = null;
      overrideReason = reqRow.notes ?? "موافقة عبر الصندوق الوارد";
    }
    if (rawOverride && typeof rawOverride.email === "string" && typeof rawOverride.password === "string") {
      // Cap field sizes BEFORE any DB hit or bcrypt compare so an attacker
      // can't waste CPU with multi-MB passwords or oversized emails.
      const email = rawOverride.email.toLowerCase().trim().slice(0, 254);
      const password = rawOverride.password.slice(0, 200);
      if (!email || !password) {
        throw new FinancialRequestError("بيانات المدير غير صحيحة", 401);
      }
      const [mgr] = await tx
        .select()
        .from(usersTable)
        .where(eq(usersTable.email, email));
      if (!mgr || !mgr.passwordHash || !mgr.isActive) {
        throw new FinancialRequestError("بيانات المدير غير صحيحة", 401);
      }
      if (mgr.role !== "manager" && mgr.role !== "owner") {
        throw new FinancialRequestError("هذا المستخدم لا يملك صلاحية اعتماد التجاوز", 403);
      }
      if (mgr.id === req.session?.userId) {
        throw new FinancialRequestError("لا يمكنك اعتماد تجاوز لنفسك (مبدأ فصل المهام)", 403);
      }
      const ok = await verifyAccountPassword(password, mgr.passwordHash);
      if (!ok) {
        // Audit the failed attempt so brute-force shows up in the log.
        void recordAudit(req, {
          action: "override_failed",
          entity: "pos_order",
          details: `محاولة تجاوز فاشلة باسم ${email}`,
        });
        throw new FinancialRequestError("بيانات المدير غير صحيحة", 401);
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
      // Resolve the session's branch and the warehouse to issue stock from.
      // Require a warehouse owned by this company and this branch.
      // We refuse to sell when no warehouse is configured rather
      // than silently bypassing the ledger.
      // Tenant ownership: cross-tenant sessionId is rejected via INNER JOIN
      // on branches.company_id (sessions inherit tenancy from branch).
      const [session] = await tx
        .select({ branchId: posSessionsTable.branchId, status: posSessionsTable.status,
          posStationId: posSessionsTable.posStationId, cashierUserId: posSessionsTable.cashierUserId })
        .from(posSessionsTable)
        .innerJoin(
          branchesTable,
          and(
            eq(branchesTable.id, posSessionsTable.branchId),
            eq(branchesTable.companyId, companyId),
          ),
        )
        .where(eq(posSessionsTable.id, body.sessionId))
        .limit(1)
        .for("update", { of: posSessionsTable });
      if (!session) throw new FinancialRequestError("جلسة نقطة البيع غير موجودة", 404);
      const deviceContext = posDeviceAuthority.getStore();
      if (deviceContext && (session.posStationId !== deviceContext.stationId || session.cashierUserId !== deviceContext.userId)) {
        throw new FinancialRequestError("الوردية ليست للكاشير ونقطة البيع المرتبطين بهذا الجهاز", 403);
      }
      await returnAuthorize(req.session.userId!, companyId, "sell", session.branchId, tx);
      if (session.status !== "open") {
        throw new FinancialRequestError("الوردية مغلقة. افتح وردية جديدة قبل إتمام البيع.", 409);
      }
      if (body.items.length === 0) {
        throw new FinancialRequestError("السلة فارغة. أضف منتجًا قبل إتمام البيع.", 400);
      }
      const [branchWh] = await tx
        .select({ id: warehousesTable.id })
        .from(warehousesTable)
        .where(and(
          eq(warehousesTable.branchId, session.branchId),
          eq(warehousesTable.companyId, companyId),
          eq(warehousesTable.isScrap, false),
        ))
        .orderBy(desc(warehousesTable.isDefault))
        .limit(1);
      const issueWarehouseId = branchWh?.id;
      if (await managedProfile(req.session.userId!, companyId, tx)) {
        const grant = await selectedResponsibility(req.session.userId!, companyId, tx);
        if (!grant || grant.resource !== "pos" || !grant.actions.includes("pos.sell") ||
          grant.branchId !== session.branchId || !issueWarehouseId || !grant.warehouseIds.includes(issueWarehouseId)) {
          throw new FinancialRequestError("المسؤولية لا تجيز مستودع الصرف أو فرع العملية", 403);
        }
        requestOnlyDiscount = !grant.actions.includes("pos.discount") && grant.actions.includes("pos.discount.request");
        // These restrictions concern NEW writes, not an already committed
        // receipt. Keep them after replay lookup and inside the authority fence.
        const rawBody = req.body ?? {};
        if (rawBody.paymentIntentId != null || rawBody.approvalId != null ||
          rawBody.approvalRequestId != null && !grant.actions.some(a => a === "pos.discount" || a === "pos.discount.request") ||
          rawBody.managerPassword || rawBody.managerOverride) {
          throw new FinancialRequestError("دخول المدير والدفع الشبكي غير مفعلين لهذا المسار المقيد", 403);
        }
        if (discount > 0 && !grant.actions.includes("pos.discount") && !requestOnlyDiscount ||
          !grant.actions.includes("pos.payment.record") && (
            body.paymentMethod !== "cash" || body.payments?.some(p => p.method !== "cash"))) {
          throw new FinancialRequestError("سحبت صلاحية الخصم أو التحصيل قبل تنفيذ البيع", 403);
        }
      }
      if (!issueWarehouseId) {
        throw new FinancialRequestError("لم يتم تعريف مستودع صالح لهذا الفرع. راجع إعدادات المستودعات قبل الدفع.", 409);
      }

      const orderItems: Array<{
        productId: number;
        productName: string;
        quantity: number;
        unitPrice: number;
        costPrice: number;
        stockMoveIds: number[];
        total: number;
      }> = [];
      let subtotal = 0;
      let totalCost = 0;

      for (const item of body.items) {
        // Tenant ownership: refuse to price/issue stock for a product
        // that belongs to another company.
        const [product] = await tx
          .select()
          .from(productsTable)
          .where(and(eq(productsTable.id, item.productId), eq(productsTable.companyId, companyId)))
          .limit(1);
        if (!product) {
          // Reject the entire cart, including stock moves for preceding lines.
          // Do not reveal whether the unavailable product belongs to another tenant.
          throw new FinancialRequestError("أحد منتجات السلة غير متاح لهذه المنشأة. راجع السلة قبل الدفع.", 404);
        }

        const unitPrice = Number(product.price);
        const lineTotal = unitPrice * item.quantity;
        subtotal += lineTotal;

        // Issue inventory through the engine. Pass no unitCost so the engine
        // applies the product's costing method (FIFO consumes layers, average
        // and standard issues read the source quant's carrying cost). The cost
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
          stockMoveIds: moveResult.moveIds,
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
      // These values came from product prices, stock costing and company
      // configuration in this attempt, not the browser's alleged prices.
      // Exclude generated move IDs: a rolled-back attempt must reproduce
      // the same quote rather than commit inventory just to request review.
      approvalQuote = {
        companyId, branchId: session.branchId, warehouseId: issueWarehouseId,
        vatRegistrationStatus: companyRow?.vatRegistrationStatus ?? null,
        subtotal, discount,
        items: orderItems.map(({ productId, productName, quantity, unitPrice, costPrice, total }) =>
          ({ productId, productName, quantity, unitPrice, costPrice, total })),
      };
      if (pendingApprovalRow && !matchesPosApprovalNotes(req.body, pendingApprovalRow.notes, approvalQuote)) {
        const key = pendingApprovalRow.actionKey ?? "pos.discount_pct";
        throw new FinancialLimitError(key, pendingApprovalRow.approvedAmount,
          key === "pos.discount_pct" ? trustedDiscountPct : refundCash,
          "تغيرت تفاصيل السلة المحسوبة في الخادم؛ يلزم اعتماد جديد قبل الدفع");
      }
      if (requestOnlyDiscount && trustedDiscountPct > 0 && !pendingApprovalRow) {
        throw new FinancialLimitError("pos.discount_pct", 0, trustedDiscountPct, "هذه المسؤولية تطلب استثناء خصم ولا تنفذه قبل اعتماد مستقل للعملية");
      }
      const dCheck = await checkFinancialLimit(companyId, overrideUserId ?? req.session.userId!, "pos.discount_pct", trustedDiscountPct, session.branchId, pendingApprovalRow?.id, tx);
      if (!dCheck.allowed) {
        throw new FinancialLimitError(
          "pos.discount_pct",
          dCheck.max,
          trustedDiscountPct,
          dCheck.reason ?? "تجاوزت الحد المسموح للخصم",
        );
      }
      if (refundCash > 0) {
        // Policy: ANY POS refund/void cash-out requires manager dual auth,
        // not just amounts above the cashier cap. If the effective role is
        // still a cashier (no override token was consumed), force the
        // approval flow even when the amount is within the cashier's
        // financial_limits row. Manager/owner/sales roles can refund up
        // to their own cap directly.
        if (role !== "manager" && role !== "owner") {
          const rCheck = await checkFinancialLimit(companyId, overrideUserId ?? req.session.userId!, "pos.refund_amount", refundCash, session.branchId, pendingApprovalRow?.id, tx);
          if (role === "cashier" || !rCheck.allowed) {
            throw new FinancialLimitError(
              "pos.refund_amount",
              rCheck.max,
              refundCash,
              "أي عملية إرجاع/إلغاء نقدية تتطلب اعتماد المدير",
            );
          }
        }
      }

      // Async-approval binding: if the cashier is using an inbox-approved
      // request, refuse it when the current attempt would exceed the
      // approved amount or doesn't match the approved actionKey. This
      // stops a manager-approved 1000 SAR discount being silently reused
      // for a 5000 SAR refund in the same session.
      if (pendingApprovalRow) {
        const attemptedNow = Math.max(trustedDiscountPct, refundCash);
        const approvedAk = pendingApprovalRow.actionKey;
        const usingDiscount = trustedDiscountPct > 0;
        const usingRefund = refundCash > 0;
        const akMatches =
          !approvedAk ||
          (approvedAk === "pos.discount_pct" && usingDiscount && !usingRefund) ||
          (approvedAk === "pos.refund_amount" && usingRefund && !usingDiscount);
        if (!akMatches) {
          throw new FinancialLimitError(
            approvedAk ?? "pos.limit",
            pendingApprovalRow.approvedAmount,
            attemptedNow,
            "الموافقة المعتمدة لا تطابق نوع العملية الحالية",
          );
        }
        const attemptedBound =
          approvedAk === "pos.refund_amount" ? refundCash : trustedDiscountPct;
        if (attemptedBound > pendingApprovalRow.approvedAmount + 1e-6) {
          throw new FinancialLimitError(
            approvedAk ?? "pos.limit",
            pendingApprovalRow.approvedAmount,
            attemptedBound,
            "القيمة الحالية تتجاوز القيمة المعتمدة",
          );
        }
        // Atomic single-use consume inside the same transaction so a
        // downstream failure rolls it back automatically.
        const consumed = await tx
          .update(approvalRequestsTable)
          .set({ status: "consumed" })
          .where(
            and(
              eq(approvalRequestsTable.id, pendingApprovalRow.id),
              eq(approvalRequestsTable.status, "approved"),
              sql`${approvalRequestsTable.reviewInvalidatedAt} IS NULL`,
            ),
          )
          .returning({ id: approvalRequestsTable.id });
        if (consumed.length === 0) {
          throw new ValidationError("تم استهلاك طلب الموافقة مسبقاً");
        }
        consumedApprovalRequestId = pendingApprovalRow.id;
      }

      const tax = vatEnabled ? (subtotal - discount) * 0.15 : 0;
      const total = subtotal - discount + tax;
      if (await managedProfile(req.session.userId!, companyId, tx)) {
        const grant = await selectedResponsibility(req.session.userId!, companyId, tx);
        if (!grant) throw new FinancialRequestError("سحب الوصول قبل تنفيذ العملية", 403);
        if (grant.amountLimit != null) {
          const check = await tx.execute(sql`SELECT ${total.toFixed(2)}::numeric > ${grant.amountLimit}::numeric AS exceeded`);
          if (check.rows[0]?.exceeded) throw new FinancialRequestError("المبلغ يتجاوز الحد المباشر لهذه المسؤولية؛ لم ينفذ البيع", 403);
        }
      }
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
        // the same owned branch as the POS session. Legacy global
        // gateways cannot establish tenant ownership.
        const [intentGw] = await tx
          .select({ branchId: paymentGatewaysTable.branchId })
          .from(paymentGatewaysTable)
          .where(and(eq(paymentGatewaysTable.id, pi.gatewayId),
            branchScope(paymentGatewaysTable.branchId, req.session.companyId!)))
          .limit(1);
        if (
          !intentGw || intentGw.branchId !== session.branchId
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
          companyId: getCompanyId(req),
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
      // tenant-owned "POS-WALKIN" customer, provisioned transactionally.
      let invoiceCustomerId = body.customerId ?? null;
      let invoiceCustomerName: string | null = null;
      if (invoiceCustomerId) {
        // Tenant ownership: refuse to bind the POS invoice to a customer
        // who belongs to another company.
        const [c] = await tx
          .select({ name: customersTable.name })
          .from(customersTable)
          .where(and(eq(customersTable.id, invoiceCustomerId), eq(customersTable.companyId, companyId)))
          .limit(1);
        if (!c) throw new FinancialRequestError("العميل غير موجود", 404);
        invoiceCustomerName = c.name;
      }
      if (!invoiceCustomerId) {
        const walkin = await ensurePosWalkinCustomer(tx, companyId);
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
          companyId: getCompanyId(req),
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
            taxRate: vatEnabled ? "15" : "0",
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
          companyId: getCompanyId(req),
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
      // Non-registered tenants do not get a ZATCA QR — the badge is
      // reserved for VAT-registered sellers per ZATCA Phase 1.
      const zatcaQr = vatEnabled && !!sellerVatForZatca
        ? buildZatcaQrBase64({
            timestamp: new Date(),
            totalWithVat: total,
            vatAmount: tax,
            sellerName: sellerNameForZatca,
            vatNumber: sellerVatForZatca,
          })
        : null;
      const [posInvoice] = await tx
        .insert(customerInvoicesTable)
        .values({
          companyId: getCompanyId(req),
          reference: invRef,
          soId: posSo.id,
          branchId: session.branchId,
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
      await saveIssuer(tx, "invoice", posInvoice.id, issuer);
      await saveIssuer(tx, "pos", created.id, issuer);
      for (let i = 0; i < orderItems.length; i++) {
        const li = orderItems[i];
        const [invoiceLine] = await tx.insert(customerInvoiceLinesTable).values({
          invoiceId: posInvoice.id,
          soLineId: soLineByItemIdx[i],
          productId: li.productId,
          description: li.productName,
          quantity: String(li.quantity),
          unitPrice: String(li.unitPrice),
          discountPct: "0",
          taxRate: vatEnabled ? "15" : "0",
          lineTotal: String(li.total),
        }).returning();
        for (const moveId of li.stockMoveIds) {
          await tx.update(stockMovesTable).set({ invoiceLineId: invoiceLine.id })
            .where(eq(stockMovesTable.id, moveId));
        }
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
          companyId: getCompanyId(req),
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
            companyId: getCompanyId(req),
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
            companyId: getCompanyId(req),
          },
          [
            { systemKey: "cogs", debit: totalCost },
            { systemKey: "inventory", credit: totalCost },
          ],
        );
      }

      const attribution=await recordSaleSellers(tx,companyId,posInvoice.id,req.session.userId!,req.body);
      const sellerAttribution=attribution.map(l=>({invoiceLineId:l.invoice_line_id,employeeId:l.employee_id,sellerName:l.seller_name,revision:l.revision}));
      await recordPosResponsibility(tx, req.session.userId!, companyId, created.id);
      return {
        order: {...created,sellerAttribution},
        sellerAttribution,
        sellerNameForZatca,
        sellerVatForZatca,
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
    }, async (tx, previous) => {
      await lockApprovalAuthority(tx);
      if (!await managedProfile(req.session.userId!, companyId, tx)) return;
      const grant = await selectedResponsibility(req.session.userId!, companyId, tx);
      if (!grant || grant.resource !== "pos" || !grant.actions.includes("pos.read")) {
        throw new FinancialRequestError("لا يوجد إذن حالي لقراءة نتيجة البيع", 403);
      }
      // Match the original issued invoice/order graph, not today's default
      // warehouse, the browser's branch fields, or a different readable till.
      const source = await tx.execute(sql`SELECT i.id FROM customer_invoices i
        JOIN sales_orders so ON so.id=i.so_id AND so.company_id=i.company_id
        JOIN warehouses w ON w.id=so.warehouse_id AND w.company_id=i.company_id AND w.branch_id=i.branch_id
        JOIN pos_orders o ON o.order_number=i.source_ref
        JOIN pos_sessions s ON s.id=o.session_id AND s.branch_id=i.branch_id
        JOIN branches b ON b.id=s.branch_id AND b.company_id=i.company_id
        WHERE i.id=${previous.invoiceId} AND o.id=${previous.order.id}
          AND i.company_id=${companyId} AND i.branch_id=${grant.branchId}
          AND w.id=ANY(${sql.param(grant.warehouseIds)}::integer[])`);
      if (!source.rows.length) throw new FinancialRequestError("نتيجة البيع خارج نطاق القراءة الحالي", 403);
    });

    if (res.getHeader("Idempotency-Replayed")) {
      res.status(201).json({
        ...result.order, sellerAttribution:result.sellerAttribution,items: result.orderItems, subtotal: result.subtotal,
        tax: result.tax, discount, total: result.total, payments: result.payments,
        createdAt: result.order.createdAt.toISOString(),
      }); return;
    }
    // Module hook: auto-submit the just-issued POS invoice to ZATCA
    // (simplified / "reporting" subset). Fire-and-forget after the
    // transaction commits so checkout is never blocked by Fatoora
    // latency. Failures land in the retry queue.
    void processInvoiceForZatca({
      invoiceId: result.invoiceId,
      invoiceNumber: result.invoiceRef,
      issueDate: new Date(),
      invoiceType: "simplified",
      sellerName: result.sellerNameForZatca,
      sellerVat: result.sellerVatForZatca,
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
    if ((overrideRoleEffective && overrideUserId) || consumedApprovalRequestId) {
      const who = overrideUserId
        ? `${overrideUserName} (#${overrideUserId})`
        : `موافقة #${consumedApprovalRequestId} — ${overrideUserName ?? "—"}`;
      void recordAudit(req, {
        action: "override",
        entity: "pos_order",
        details: `اعتماد ${who} لتجاوز حد الكاشير على الطلب ${orderNumber} (orderId=${result.order.id})${overrideReason ? " — " + overrideReason : ""}`,
      });
    }

    // Anomaly detection: fire-and-forget signal evaluation for this
    // order. Refund / void / discount / missing-customer events feed
    // the rule engine, which fans out manager notifications when any
    // sliding-window threshold is exceeded.
    {
      const actorId = req.session?.userId ?? null;
      const actorName =
        (req.session as { userName?: string } | undefined)?.userName ?? null;
      const isRefund = result.orderItems.some((it) => (it.quantity ?? 0) < 0);
      const isVoid = result.total === 0 && result.orderItems.length > 0;
      const orderId = result.order.id;
      const customerId = body.customerId ?? null;
      const fire = (type: Parameters<typeof evaluateAnomalies>[0]["type"], extra: Record<string, unknown> = {}) =>
        void evaluateAnomalies({
          type,
          actorId,
          actorName,
          refTable: "pos_orders",
          refId: orderId,
          payload: { orderNumber: result.order.orderNumber, customerId, ...extra },
        });
      if (isRefund) fire("pos.refund", { total: result.total });
      if (isVoid) fire("pos.void");
      if (discount > 0) fire("pos.discount", { discount, customerId });
      if (!customerId) fire("pos.no_customer");
    }

    res.status(201).json({
      ...result.order,
      sellerAttribution:result.sellerAttribution,
      items: result.orderItems,
      subtotal: result.subtotal,
      tax: result.tax,
      discount,
      total: result.total,
      payments: result.payments,
      createdAt: result.order.createdAt.toISOString(),
    });
  } catch (err) {
    if (err instanceof FinancialRequestError) { res.status(err.status).json({ error: err.message }); return; }
    if (err instanceof FinancialLimitError) {
      const role = (req.session as { role?: string } | undefined)?.role ?? "unknown";
      void recordAudit(req, {
        action: "financial_limit_exceeded",
        entity: err.actionKey,
        details: `الدور ${role} حاول إجراء بقيمة ${err.attempted.toFixed(2)} وتجاوز الحد المسموح (${err.max ?? "—"}) لـ ${err.actionKey}`,
        severity: "warning",
      });
      req.log.warn({ err }, "POS order rejected — financial limit exceeded");

      // Open a pending approval_request so the manager sees this in
      // their inbox (the asynchronous "approve from inbox" path), in
      // parallel to the synchronous manager-PIN override path the UI
      // exposes via requiresManagerApproval. Either path can resolve
      // the over-limit transaction. recordId is the POS session so
      // submitForApproval's idempotency check dedupes repeated tries
      // from the same till.
      let pendingRequestId: number | undefined;
      try {
        const sess = req.session as
          | { userId?: number; userName?: string }
          | undefined;
        const sessionIdRaw = (req.body as { sessionId?: unknown } | undefined)
          ?.sessionId;
        const sessionId = typeof sessionIdRaw === "number" ? sessionIdRaw : 0;
        const result = await submitForApproval({
          companyId: req.session.companyId!,
          docType: "pos_over_limit",
          recordId: sessionId,
          recordRef: `POS session #${sessionId} — ${err.actionKey}`,
          amount: err.attempted,
          submittedByUserId: sess?.userId ?? null,
          submittedByName: sess?.userName ?? null,
          notes: posApprovalNotes(req.body, `تجاوز ${err.actionKey} — المحاولة ${err.attempted.toFixed(2)} والحد ${err.max ?? "—"}`, approvalQuote),
          forceRoles: ["manager", "owner"],
          forceReason: "POS over-limit",
        });
        if (result.requestId) pendingRequestId = result.requestId;
      } catch (subErr) {
        req.log.warn({ err: subErr }, "failed to open pos_over_limit approval");
      }

      // The UI uses requiresManagerApproval as the signal to pop the
      // manager-PIN dialog; the cashier then retries with the same body
      // plus { managerOverride: { email, password } }. Alternatively a
      // manager can approve the pendingRequestId from /approvals.
      res.status(403).json({
        error: err.message,
        actionKey: err.actionKey,
        max: err.max,
        attempted: err.attempted,
        requiresManagerApproval: true,
        approvalRequestId: pendingRequestId ?? null,
      });
      return;
    }
    if (err instanceof ValidationError || err instanceof StockAvailabilityError) {
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

// =============================================================
// Order Parking (Hold/Resume). Lets the cashier set aside a basket
// (e.g. customer left to grab another item, dine-in table waiting)
// and resume it later. Parked orders are inserted with `status='parked'`
// — they are excluded from `/pos/summary` aggregates and from session
// totals (parked rows have total=0 marker payments OR are recreated
// in-cart on resume). To stay simple AND avoid the
// pos_payments_match_order_total trigger, we DO NOT persist any
// pos_order_payments rows for parked orders; the parked row is a
// pure header (items jsonb + totals snapshot, status='parked'). On
// resume, we delete the parked row server-side and the client recreates
// the cart from the returned items.
// =============================================================

const ParkOrderBody = z.object({
  sessionId: z.number().int().positive(),
  label: z.string().trim().min(1).max(60).optional().nullable(),
  customerId: z.number().int().positive().optional().nullable(),
  items: z
    .array(
      z.object({
        productId: z.number().int().positive(),
        quantity: z.number().int().positive(),
        priceSnapshot: z.number().nonnegative().optional(),
        nameSnapshot: z.string().max(200).optional(),
      }),
    )
    .min(1),
  subtotal: z.number().nonnegative(),
  tax: z.number().nonnegative().default(0),
  discount: z.number().nonnegative().default(0),
  total: z.number().nonnegative(),
});

router.post("/pos/orders/park", posGuard, async (req, res) => {
  try {
    const parsed = ParkOrderBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "بيانات غير صحيحة" });
      return;
    }
    const body = parsed.data;
    const companyId = getCompanyId(req);

    // Verify the session belongs to the caller's tenant and is open.
    const [sess] = await db
      .select({
        id: posSessionsTable.id,
        status: posSessionsTable.status,
        branchId: posSessionsTable.branchId,
      })
      .from(posSessionsTable)
      .innerJoin(branchesTable, eq(branchesTable.id, posSessionsTable.branchId))
      .where(
        and(
          eq(posSessionsTable.id, body.sessionId),
          eq(branchesTable.companyId, companyId),
        ),
      )
      .limit(1);
    if (!sess) {
      res.status(404).json({ error: "جلسة البيع غير موجودة" });
      return;
    }
    if (sess.status !== "open") {
      res.status(409).json({ error: "جلسة البيع مغلقة" });
      return;
    }

    const inserted = await db.transaction(async (tx) => {
      const orderNumber = await nextRef(tx, "POS-PARK");
      const [row] = await tx
        .insert(posOrdersTable)
        .values({
          orderNumber,
          sessionId: body.sessionId,
          customerId: body.customerId ?? null,
          items: body.items,
          subtotal: body.subtotal.toFixed(2),
          tax: body.tax.toFixed(2),
          discount: body.discount.toFixed(2),
          total: body.total.toFixed(2),
          paymentMethod: "cash",
          status: "parked",
          parkedLabel: body.label ?? null,
          companyId,
        })
        .returning();
      return row;
    });

    await recordAudit(req, {
      action: "create",
      entity: `pos_order#${inserted.id}`,
      details: `parked label=${body.label ?? ""} items=${body.items.length}`,
    });

    res.status(201).json({
      id: inserted.id,
      orderNumber: inserted.orderNumber,
      parkedLabel: inserted.parkedLabel,
      total: Number(inserted.total),
      createdAt: inserted.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Park POS order failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/pos/orders/parked", posReadGuard, async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const sessionIdRaw = req.query.sessionId;
    const sessionId =
      typeof sessionIdRaw === "string" ? Number(sessionIdRaw) : null;
    if (sessionId === null || !Number.isInteger(sessionId)) {
      res.status(400).json({ error: "sessionId مطلوب" });
      return;
    }
    const rows = await db
      .select()
      .from(posOrdersTable)
      .where(
        and(
          eq(posOrdersTable.companyId, companyId),
          eq(posOrdersTable.sessionId, sessionId),
          eq(posOrdersTable.status, "parked"),
        ),
      )
      .orderBy(desc(posOrdersTable.createdAt))
      .limit(50);
    res.json(
      rows.map((r) => ({
        id: r.id,
        orderNumber: r.orderNumber,
        parkedLabel: r.parkedLabel,
        customerId: r.customerId,
        items: r.items,
        subtotal: Number(r.subtotal),
        tax: Number(r.tax),
        discount: Number(r.discount),
        total: Number(r.total),
        createdAt: r.createdAt.toISOString(),
      })),
    );
  } catch (err) {
    req.log.error({ err }, "List parked POS orders failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

const ResumeOrderBody = z.object({
  sessionId: z.number().int().positive(),
});

router.post("/pos/orders/:id/resume", posGuard, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "معرّف غير صالح" });
      return;
    }
    const parsed = ResumeOrderBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "sessionId مطلوب" });
      return;
    }
    const { sessionId } = parsed.data;
    const companyId = getCompanyId(req);
    // Atomic resume: only deletes a row that is still parked, belongs
    // to this tenant AND belongs to the caller's stated session —
    // prevents double-resume races and cross-session resume of a
    // parked order from another station/branch in the same company.
    const deleted = await db
      .delete(posOrdersTable)
      .where(
        and(
          eq(posOrdersTable.id, id),
          eq(posOrdersTable.companyId, companyId),
          eq(posOrdersTable.sessionId, sessionId),
          eq(posOrdersTable.status, "parked"),
        ),
      )
      .returning();
    if (deleted.length === 0) {
      res.status(404).json({ error: "الطلب غير موجود أو تم استئنافه" });
      return;
    }
    const row = deleted[0];
    await recordAudit(req, {
      action: "delete",
      entity: `pos_order#${row.id}`,
      details: `resumed parked label=${row.parkedLabel ?? ""}`,
    });
    res.json({
      id: row.id,
      orderNumber: row.orderNumber,
      parkedLabel: row.parkedLabel,
      customerId: row.customerId,
      items: row.items,
      subtotal: Number(row.subtotal),
      tax: Number(row.tax),
      discount: Number(row.discount),
      total: Number(row.total),
    });
  } catch (err) {
    req.log.error({ err }, "Resume parked POS order failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/pos/summary", posReadGuard, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    // Tenant scope: every aggregate is filtered by the caller's
    // company so today's KPIs never include other tenants' sales.
    const companyId = getCompanyId(req);

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
           where po.created_at >= ${today} and po.company_id = ${companyId} and pp.method = 'cash'
        ), 0)`,
        cardSales: sql<number>`coalesce((
          select sum(pp.amount::numeric)
            from ${posOrderPaymentsTable} pp
            join ${posOrdersTable} po on po.id = pp.order_id
           where po.created_at >= ${today} and po.company_id = ${companyId} and pp.method = 'card'
        ), 0)`,
        transferSales: sql<number>`coalesce((
          select sum(pp.amount::numeric)
            from ${posOrderPaymentsTable} pp
            join ${posOrdersTable} po on po.id = pp.order_id
           where po.created_at >= ${today} and po.company_id = ${companyId} and pp.method = 'transfer'
        ), 0)`,
        stcSales: sql<number>`coalesce((
          select sum(pp.amount::numeric)
            from ${posOrderPaymentsTable} pp
            join ${posOrdersTable} po on po.id = pp.order_id
           where po.created_at >= ${today} and po.company_id = ${companyId} and pp.method = 'stc'
        ), 0)`,
        deferredSales: sql<number>`coalesce((
          select sum(pp.amount::numeric)
            from ${posOrderPaymentsTable} pp
            join ${posOrdersTable} po on po.id = pp.order_id
           where po.created_at >= ${today} and po.company_id = ${companyId} and pp.method = 'deferred'
        ), 0)`,
      })
      .from(posOrdersTable)
      .where(
        and(
          gte(posOrdersTable.createdAt, today),
          eq(posOrdersTable.companyId, companyId),
          // Exclude parked (hold) orders — they are non-finalized
          // header-only snapshots and must not inflate today's KPIs
          // until resumed and paid.
          eq(posOrdersTable.status, "paid"),
        ),
      );

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
