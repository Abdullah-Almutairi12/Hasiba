import { Router } from "express";
import {
  db,
  intercompanyLinksTable,
  companiesTable,
  customerInvoicesTable,
  invoicesTable,
  purchaseOrdersTable,
  salesOrdersTable,
} from "@workspace/db";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { financeGuard } from "../middlewares/require-role";
import { handleRouteError } from "../lib/handle-error";
import { getCompanyId } from "../lib/scoped-db";
import { voidMirror, resyncMirror, IntercompanyMirrorError } from "../lib/intercompany-mirror";
import { recordAudit } from "../lib/audit";
import {
  listImbalancesForCompany,
  scanImbalancesForCompanies,
  setImbalanceStatus,
} from "../lib/intercompany-imbalances";
import { userCompaniesTable } from "@workspace/db";

const router = Router();

router.use("/intercompany", financeGuard);

/**
 * GET /intercompany/links — list every mirror link involving the active
 * company (either as source OR target). Joined with companiesTable so the
 * UI can show human-readable counterparty names.
 */
router.get("/intercompany/links", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const srcCo = { id: companiesTable.id, name: companiesTable.name };
    const rows = await db
      .select({
        id: intercompanyLinksTable.id,
        kind: intercompanyLinksTable.kind,
        status: intercompanyLinksTable.status,
        sourceCompanyId: intercompanyLinksTable.sourceCompanyId,
        sourceDocId: intercompanyLinksTable.sourceDocId,
        sourceRef: intercompanyLinksTable.sourceRef,
        targetCompanyId: intercompanyLinksTable.targetCompanyId,
        targetDocId: intercompanyLinksTable.targetDocId,
        targetRef: intercompanyLinksTable.targetRef,
        createdAt: intercompanyLinksTable.createdAt,
        updatedAt: intercompanyLinksTable.updatedAt,
        sourceCompanyName: sql<string>`(select name from ${companiesTable} where id = ${intercompanyLinksTable.sourceCompanyId})`,
        targetCompanyName: sql<string>`(select name from ${companiesTable} where id = ${intercompanyLinksTable.targetCompanyId})`,
      })
      .from(intercompanyLinksTable)
      .where(
        sql`${intercompanyLinksTable.sourceCompanyId} = ${companyId} OR ${intercompanyLinksTable.targetCompanyId} = ${companyId}`,
      )
      .orderBy(desc(intercompanyLinksTable.createdAt))
      .limit(500);
    void srcCo;
    res.json(
      rows.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
        direction: r.sourceCompanyId === companyId ? "outbound" : "inbound",
      })),
    );
  } catch (err) {
    req.log.error({ err }, "list intercompany links failed");
    handleRouteError(err, res);
  }
});

/**
 * POST /intercompany/links/:id/void — mark mirror as void and neutralise
 * the mirror document (status='cancelled'). Reserved for finance.
 */
router.post("/intercompany/links/:id/void", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "bad id" });
      return;
    }
    await voidMirror(id, {
      userId: req.session?.userId ?? null,
      userName: null,
    });
    void recordAudit(req, { action: "void", entity: "intercompany_link", details: `link ${id}` });
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof IntercompanyMirrorError) {
      const code = err.code === "FORBIDDEN" ? 403 : 400;
      res.status(code).json({ error: err.message, code: err.code });
      return;
    }
    req.log.error({ err }, "void intercompany link failed");
    handleRouteError(err, res);
  }
});

/**
 * POST /intercompany/links/:id/resync — recreate the mirror document
 * from the current source state ("Send to counterparty").
 */
router.post("/intercompany/links/:id/resync", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "bad id" });
      return;
    }
    await resyncMirror(id, {
      userId: req.session?.userId ?? null,
      userName: null,
    });
    void recordAudit(req, { action: "resync", entity: "intercompany_link", details: `link ${id}` });
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof IntercompanyMirrorError) {
      const code = err.code === "FORBIDDEN" ? 403 : 400;
      res.status(code).json({ error: err.message, code: err.code });
      return;
    }
    req.log.error({ err }, "resync intercompany link failed");
    handleRouteError(err, res);
  }
});

/**
 * GET /intercompany/elimination — consolidation report for matched
 * mirror links. For each matched link, returns the source amount, the
 * target amount and the eliminationAmount that should be removed when
 * consolidating sibling-company P&L (to avoid double-counting revenue +
 * matching expense across the group).
 *
 * Excluded by design: status='void' and status='resynced' links — only
 * 'matched' rows feed elimination. 'unmatched' is also skipped because
 * amounts diverge and require manual review.
 *
 * Amount basis (subtotal, VAT-exclusive — VAT is recoverable and does
 * not hit P&L):
 *   - sales_invoice : customer_invoices.subtotal  vs  invoices.amount
 *                     (mirror supplier invoice stores total in `amount`;
 *                     for the matched case both equal the original total)
 *   - purchase_order: purchase_orders.subtotal    vs  sales_orders.subtotal
 *
 * Query params:
 *   - from, to (YYYY-MM-DD) — optional, defaults to last 12 months.
 */
router.get("/intercompany/elimination", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const to = typeof req.query.to === "string" ? new Date(req.query.to) : new Date();
    const defaultFrom = new Date(to);
    defaultFrom.setFullYear(defaultFrom.getFullYear() - 1);
    const from =
      typeof req.query.from === "string" ? new Date(req.query.from) : defaultFrom;
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      res.status(400).json({ error: "invalid from/to" });
      return;
    }

    // Date filter is applied in SQL against each kind's document date
    // (customer_invoices.invoice_date / purchase_orders.order_date), not
    // against intercompanyLinks.createdAt. We also do NOT cap the result
    // set: this is a consolidation working paper, every matched link in
    // the range must appear or the eliminations will be understated.
    const fromIso = from.toISOString().slice(0, 10);
    const toIso = to.toISOString().slice(0, 10);
    const companyScope = sql`(${intercompanyLinksTable.sourceCompanyId} = ${companyId} OR ${intercompanyLinksTable.targetCompanyId} = ${companyId})`;
    const sourceCompanyNameSql = sql<string>`(select name from ${companiesTable} where id = ${intercompanyLinksTable.sourceCompanyId})`;
    const targetCompanyNameSql = sql<string>`(select name from ${companiesTable} where id = ${intercompanyLinksTable.targetCompanyId})`;

    const [salesRows, poRows] = await Promise.all([
      db
        .select({
          id: intercompanyLinksTable.id,
          kind: intercompanyLinksTable.kind,
          sourceCompanyId: intercompanyLinksTable.sourceCompanyId,
          sourceRef: intercompanyLinksTable.sourceRef,
          targetCompanyId: intercompanyLinksTable.targetCompanyId,
          targetRef: intercompanyLinksTable.targetRef,
          createdAt: intercompanyLinksTable.createdAt,
          sourceCompanyName: sourceCompanyNameSql,
          targetCompanyName: targetCompanyNameSql,
          ciSubtotal: customerInvoicesTable.subtotal,
          ciTotal: customerInvoicesTable.total,
          ciInvoiceDate: customerInvoicesTable.invoiceDate,
          invAmount: invoicesTable.amount,
        })
        .from(intercompanyLinksTable)
        .innerJoin(
          customerInvoicesTable,
          eq(customerInvoicesTable.id, intercompanyLinksTable.sourceDocId),
        )
        .innerJoin(
          invoicesTable,
          eq(invoicesTable.id, intercompanyLinksTable.targetDocId),
        )
        .where(
          and(
            eq(intercompanyLinksTable.kind, "sales_invoice"),
            eq(intercompanyLinksTable.status, "matched"),
            companyScope,
            gte(customerInvoicesTable.invoiceDate, fromIso),
            lte(customerInvoicesTable.invoiceDate, toIso),
          ),
        )
        .orderBy(desc(customerInvoicesTable.invoiceDate)),
      db
        .select({
          id: intercompanyLinksTable.id,
          kind: intercompanyLinksTable.kind,
          sourceCompanyId: intercompanyLinksTable.sourceCompanyId,
          sourceRef: intercompanyLinksTable.sourceRef,
          targetCompanyId: intercompanyLinksTable.targetCompanyId,
          targetRef: intercompanyLinksTable.targetRef,
          createdAt: intercompanyLinksTable.createdAt,
          sourceCompanyName: sourceCompanyNameSql,
          targetCompanyName: targetCompanyNameSql,
          poSubtotal: purchaseOrdersTable.subtotal,
          poOrderDate: purchaseOrdersTable.orderDate,
          soSubtotal: salesOrdersTable.subtotal,
        })
        .from(intercompanyLinksTable)
        .innerJoin(
          purchaseOrdersTable,
          eq(purchaseOrdersTable.id, intercompanyLinksTable.sourceDocId),
        )
        .innerJoin(
          salesOrdersTable,
          eq(salesOrdersTable.id, intercompanyLinksTable.targetDocId),
        )
        .where(
          and(
            eq(intercompanyLinksTable.kind, "purchase_order"),
            eq(intercompanyLinksTable.status, "matched"),
            companyScope,
            gte(purchaseOrdersTable.orderDate, fromIso),
            lte(purchaseOrdersTable.orderDate, toIso),
          ),
        )
        .orderBy(desc(purchaseOrdersTable.orderDate)),
    ]);

    interface Row {
      id: number;
      kind: string;
      period: string; // YYYY-MM
      docDate: string;
      sourceCompanyId: number;
      sourceCompanyName: string;
      sourceRef: string;
      targetCompanyId: number;
      targetCompanyName: string;
      targetRef: string;
      sourceAmount: number;
      targetAmount: number;
      eliminationAmount: number;
    }

    const rows: Row[] = [];

    for (const r of salesRows) {
      const sourceAmount = Number(r.ciSubtotal);
      // Supplier invoice mirror stores total in `amount`. If amount
      // equals customer invoice total, both sides post the same VAT and
      // the comparable P&L figure is the subtotal; otherwise expose
      // amount as-is.
      const invAmount = Number(r.invAmount);
      const ciTotal = Number(r.ciTotal);
      const targetAmount =
        Math.abs(invAmount - ciTotal) < 0.01 ? Number(r.ciSubtotal) : invAmount;
      const docDate = new Date(r.ciInvoiceDate);
      const period = `${docDate.getUTCFullYear()}-${String(docDate.getUTCMonth() + 1).padStart(2, "0")}`;
      rows.push({
        id: r.id,
        kind: r.kind,
        period,
        docDate: docDate.toISOString(),
        sourceCompanyId: r.sourceCompanyId,
        sourceCompanyName: r.sourceCompanyName ?? "",
        sourceRef: r.sourceRef,
        targetCompanyId: r.targetCompanyId,
        targetCompanyName: r.targetCompanyName ?? "",
        targetRef: r.targetRef,
        sourceAmount,
        targetAmount,
        eliminationAmount: Math.min(sourceAmount, targetAmount),
      });
    }

    for (const r of poRows) {
      const sourceAmount = Number(r.poSubtotal);
      const targetAmount = Number(r.soSubtotal);
      const docDate = new Date(r.poOrderDate);
      const period = `${docDate.getUTCFullYear()}-${String(docDate.getUTCMonth() + 1).padStart(2, "0")}`;
      rows.push({
        id: r.id,
        kind: r.kind,
        period,
        docDate: docDate.toISOString(),
        sourceCompanyId: r.sourceCompanyId,
        sourceCompanyName: r.sourceCompanyName ?? "",
        sourceRef: r.sourceRef,
        targetCompanyId: r.targetCompanyId,
        targetCompanyName: r.targetCompanyName ?? "",
        targetRef: r.targetRef,
        sourceAmount,
        targetAmount,
        eliminationAmount: Math.min(sourceAmount, targetAmount),
      });
    }

    rows.sort((a, b) => b.docDate.localeCompare(a.docDate));

    // Aggregate per (period, sourceCompanyId, targetCompanyId).
    const groupKey = (r: Row) => `${r.period}|${r.sourceCompanyId}|${r.targetCompanyId}`;
    const groupMap = new Map<
      string,
      {
        period: string;
        sourceCompanyId: number;
        sourceCompanyName: string;
        targetCompanyId: number;
        targetCompanyName: string;
        sourceAmount: number;
        targetAmount: number;
        eliminationAmount: number;
        count: number;
      }
    >();
    for (const r of rows) {
      const k = groupKey(r);
      const g = groupMap.get(k);
      if (g) {
        g.sourceAmount += r.sourceAmount;
        g.targetAmount += r.targetAmount;
        g.eliminationAmount += r.eliminationAmount;
        g.count += 1;
      } else {
        groupMap.set(k, {
          period: r.period,
          sourceCompanyId: r.sourceCompanyId,
          sourceCompanyName: r.sourceCompanyName,
          targetCompanyId: r.targetCompanyId,
          targetCompanyName: r.targetCompanyName,
          sourceAmount: r.sourceAmount,
          targetAmount: r.targetAmount,
          eliminationAmount: r.eliminationAmount,
          count: 1,
        });
      }
    }

    const totals = rows.reduce(
      (acc, r) => {
        acc.sourceAmount += r.sourceAmount;
        acc.targetAmount += r.targetAmount;
        acc.eliminationAmount += r.eliminationAmount;
        return acc;
      },
      { sourceAmount: 0, targetAmount: 0, eliminationAmount: 0 },
    );

    res.json({
      from: from.toISOString(),
      to: to.toISOString(),
      rows,
      groups: Array.from(groupMap.values()).sort((a, b) =>
        a.period === b.period
          ? a.sourceCompanyId - b.sourceCompanyId
          : b.period.localeCompare(a.period),
      ),
      totals: { ...totals, count: rows.length },
    });
  } catch (err) {
    req.log.error({ err }, "intercompany elimination report failed");
    handleRouteError(err, res);
  }
});

/**
 * GET /intercompany/imbalances — persisted pricing-policy mismatch queue
 * for the active company (involved as source OR target). By default
 * returns only `open` rows; pass `?status=open,resolved,ignored` to
 * widen.
 */
router.get("/intercompany/imbalances", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const allowed: Array<"open" | "resolved" | "ignored"> = [
      "open",
      "resolved",
      "ignored",
    ];
    const raw =
      typeof req.query.status === "string" ? req.query.status : "open";
    const statuses = raw
      .split(",")
      .map((s) => s.trim())
      .filter((s): s is "open" | "resolved" | "ignored" =>
        (allowed as string[]).includes(s),
      );
    const rows = await listImbalancesForCompany(
      companyId,
      statuses.length > 0 ? statuses : ["open"],
    );
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "list intercompany imbalances failed");
    handleRouteError(err, res);
  }
});

/**
 * POST /intercompany/imbalances/scan — rerun the source-vs-mirror
 * comparison across every company the caller has access to (via
 * user_companies). Persists any new offenders and auto-resolves any
 * previously-open rows whose amounts now agree.
 */
async function getAllowedCompanyIds(userId: number): Promise<number[]> {
  const rows = await db
    .select({ companyId: userCompaniesTable.companyId })
    .from(userCompaniesTable)
    .where(eq(userCompaniesTable.userId, userId));
  return Array.from(new Set(rows.map((r) => r.companyId)));
}

router.post("/intercompany/imbalances/scan", async (req, res) => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      res.status(401).json({ error: "غير مسجل دخول" });
      return;
    }
    const ids = await getAllowedCompanyIds(userId);
    const result = await scanImbalancesForCompanies(ids);
    void recordAudit(req, {
      action: "scan",
      entity: "intercompany_imbalance",
      details: `companies=${ids.length} subtotal=${result.subtotal} open=${result.open} resolved=${result.resolved}`,
    });
    res.json({ ok: true, scope: ids, ...result });
  } catch (err) {
    req.log.error({ err }, "scan intercompany imbalances failed");
    handleRouteError(err, res);
  }
});

/**
 * POST /intercompany/imbalances/:id/ignore — finance accepted the
 * difference (e.g. legitimate FX or rounding). Row stays in history
 * but is excluded from the default `open` queue and won't auto-reopen.
 */
router.post("/intercompany/imbalances/:id/ignore", async (req, res) => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      res.status(401).json({ error: "غير مسجل دخول" });
      return;
    }
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "bad id" });
      return;
    }
    const notes =
      typeof req.body?.notes === "string" ? (req.body.notes as string) : null;
    const allowed = await getAllowedCompanyIds(userId);
    const ok = await setImbalanceStatus(id, "ignored", userId, notes, allowed);
    if (!ok) {
      // 404 covers both "missing" and "exists-but-not-yours" so the
      // route does not leak the existence of imbalances on other tenants.
      res.status(404).json({ error: "not found" });
      return;
    }
    void recordAudit(req, {
      action: "ignore",
      entity: "intercompany_imbalance",
      details: `imbalance ${id}`,
    });
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "ignore intercompany imbalance failed");
    handleRouteError(err, res);
  }
});

/**
 * POST /intercompany/imbalances/:id/reopen — re-queue a previously
 * ignored or resolved imbalance so it appears in the default queue
 * again on the next scan.
 */
router.post("/intercompany/imbalances/:id/reopen", async (req, res) => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      res.status(401).json({ error: "غير مسجل دخول" });
      return;
    }
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "bad id" });
      return;
    }
    const allowed = await getAllowedCompanyIds(userId);
    const ok = await setImbalanceStatus(id, "open", null, null, allowed);
    if (!ok) {
      res.status(404).json({ error: "not found" });
      return;
    }
    void recordAudit(req, {
      action: "reopen",
      entity: "intercompany_imbalance",
      details: `imbalance ${id}`,
    });
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "reopen intercompany imbalance failed");
    handleRouteError(err, res);
  }
});

export default router;
