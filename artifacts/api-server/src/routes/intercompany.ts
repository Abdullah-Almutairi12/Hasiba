import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import {
  db,
  intercompanyLinksTable,
  companiesTable,
  customerInvoicesTable,
  invoicesTable,
  purchaseOrdersTable,
  salesOrdersTable,
  auditLogsTable,
} from "@workspace/db";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { adminGuard, financeGuard } from "../middlewares/require-role";
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
import {
  consumeEmailActionToken,
  resolveEmailActionToken,
} from "../lib/intercompany-email-action";
import { getIntercompanyGroups } from "../lib/intercompany-imbalance-cron";
import {
  defaultsForAnchor,
  getOrCreateUserPrefs,
  loadGroupPrefsMap,
  lookupByUnsubscribeToken,
  setUserOptedOut,
  upsertGroupPrefs,
  validateGroupPrefs,
  type UpdateGroupPrefsInput,
} from "../lib/intercompany-digest-prefs";

const router = Router();

/**
 * Public router for the email-footer unsubscribe link. Mounted before
 * the session-auth middleware so finance users can click the link
 * from their mail client without being signed in.
 */
export const intercompanyPublicRouter = Router();

intercompanyPublicRouter.get("/intercompany/digest/unsubscribe", async (req, res) => {
  try {
    const token =
      typeof req.query.token === "string" ? req.query.token : "";
    const match = await lookupByUnsubscribeToken(token);
    if (!match) {
      res.status(404).type("html").send(
        `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8">` +
          `<title>رابط غير صالح</title>` +
          `<body style="font-family:system-ui;padding:2rem;max-width:480px;margin:auto">` +
          `<h2>رابط الإلغاء غير صالح أو منتهي</h2>` +
          `<p>تأكد من نسخ الرابط الكامل من البريد، أو سجّل الدخول وحدّث تفضيلاتك من صفحة المعاملات بين الشركات.</p>` +
          `</body></html>`,
      );
      return;
    }
    await setUserOptedOut(match.user.id, true);
    res.type("html").send(
      `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8">` +
        `<title>تم إلغاء الاشتراك</title>` +
        `<body style="font-family:system-ui;padding:2rem;max-width:480px;margin:auto">` +
        `<h2>تم إلغاء اشتراكك في موجز المعاملات بين الشركات</h2>` +
        `<p>لن تصلك رسائل الموجز اليومية بعد الآن.</p>` +
        `<p>يمكنك إعادة التفعيل في أي وقت من حسابك ← صفحة المعاملات بين الشركات ← تبويب "تفضيلات الموجز".</p>` +
        `</body></html>`,
    );
  } catch (err) {
    req.log.error({ err }, "intercompany digest unsubscribe failed");
    res.status(500).type("html").send("خطأ غير متوقع");
  }
});

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

/**
 * GET /intercompany/imbalances/last-scan — the most recent nightly
 * scan audit row that touched the active company. Nightly cron stamps
 * `action=scan_nightly, entity=intercompany_imbalance` against the
 * lowest companyId in each connected group, with details:
 *   `group=[1,2,3] subtotal=N open=N resolved=N`
 * We match by a word-boundary regex on the companyId inside the
 * `group=[…]` list so non-anchor companies still see their scan.
 * Returns `null` if there is no audit row yet (fresh tenant or scan
 * has not run since boot).
 */
/**
 * Threshold for flagging the nightly scan as stale. The cron runs
 * every 24h, so a ~26h ceiling gives 2h of slack for clock skew,
 * boot delay, and long-running scans before we surface a warning.
 */
const STALE_SCAN_MS = 26 * 60 * 60 * 1000;

router.get("/intercompany/imbalances/last-scan", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const [row, linkCountRow] = await Promise.all([
      db
        .select({
          createdAt: auditLogsTable.createdAt,
          details: auditLogsTable.details,
        })
        .from(auditLogsTable)
        .where(
          and(
            eq(auditLogsTable.action, "scan_nightly"),
            eq(auditLogsTable.entity, "intercompany_imbalance"),
            sql`${auditLogsTable.details} ~ ${`group=\\[(.*,)?${companyId}(,.*)?\\]`}`,
          ),
        )
        .orderBy(desc(auditLogsTable.createdAt))
        .limit(1),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(intercompanyLinksTable)
        .where(
          sql`${intercompanyLinksTable.sourceCompanyId} = ${companyId} OR ${intercompanyLinksTable.targetCompanyId} = ${companyId}`,
        ),
    ]);
    const hasLinks = (linkCountRow[0]?.n ?? 0) > 0;
    if (row.length === 0) {
      // Fresh tenant with no links — no scan is expected yet, so this
      // is not stale. Once any intercompany link exists, a missing
      // audit row IS stale (the nightly cron should have written one).
      res.json({
        ranAt: null,
        newCount: 0,
        resolvedCount: 0,
        isStale: hasLinks,
        ageHours: null,
        staleThresholdHours: 26,
        hasLinks,
      });
      return;
    }
    const r = row[0]!;
    const details = r.details ?? "";
    const num = (k: string): number => {
      const m = details.match(new RegExp(`${k}=(-?\\d+)`));
      return m ? Number(m[1]) : 0;
    };
    const subtotal = num("subtotal");
    const open = num("open");
    const resolved = num("resolved");
    const ageMs = Date.now() - r.createdAt.getTime();
    const ageHours = Math.round((ageMs / (60 * 60 * 1000)) * 10) / 10;
    res.json({
      ranAt: r.createdAt.toISOString(),
      newCount: subtotal + open,
      resolvedCount: resolved,
      isStale: ageMs > STALE_SCAN_MS,
      ageHours,
      staleThresholdHours: 26,
      hasLinks,
    });
  } catch (err) {
    req.log.error({ err }, "fetch last nightly imbalance scan failed");
    handleRouteError(err, res);
  }
});

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

/**
 * Task 150 — public (no session) endpoints backing the morning-digest
 * one-click action links. Token authenticates the request: it binds
 * (recipient user, imbalance, action) and is enforced single-use +
 * expiring + access-revalidated by `resolveEmailActionToken`. Mounted
 * BEFORE `requireAuth` so that opening the link from an inbox does not
 * bounce the user through a login.
 */
export const intercompanyEmailActionRouter: IRouter = Router();

const emailActionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "محاولات كثيرة جداً، يرجى المحاولة لاحقاً" },
});

intercompanyEmailActionRouter.use(
  "/intercompany/email-action",
  emailActionLimiter,
);

/**
 * GET /intercompany/email-action/preview?token=… — returns the action
 * details so the confirmation modal can render the actor's intent
 * before they confirm. Does NOT consume the token; the user still has
 * to click "تأكيد" which POSTs to /confirm. This split is deliberate:
 * a generic email-link prefetcher (Outlook safe-link, Gmail preview
 * scanner) must not be able to silently consume the token by GETting
 * the URL.
 */
intercompanyEmailActionRouter.get(
  "/intercompany/email-action/preview",
  async (req, res) => {
    try {
      const token = String(req.query.token ?? "");
      const result = await resolveEmailActionToken(token);
      if (!result.ok) {
        const status =
          result.error.code === "CONSUMED"
            ? 410
            : result.error.code === "EXPIRED"
              ? 410
              : result.error.code === "FORBIDDEN"
                ? 403
                : 404;
        res.status(status).json({
          ok: false,
          error: result.error.code,
          message: result.error.message,
        });
        return;
      }
      const { ctx } = result;
      res.json({
        ok: true,
        imbalanceId: ctx.imbalanceId,
        action: ctx.action,
        sourceRef: ctx.sourceRef,
        targetRef: ctx.targetRef,
        difference: ctx.difference,
        basis: ctx.basis,
        status: ctx.status,
        linkStatus: ctx.linkStatus,
        expiresAt: ctx.expiresAt.toISOString(),
      });
    } catch (err) {
      req.log.error({ err }, "intercompany email-action preview failed");
      res.status(500).json({ ok: false, error: "SERVER", message: "حدث خطأ في الخادم" });
    }
  },
);

/**
 * POST /intercompany/email-action/confirm  { token } — consumes the
 * token (atomic flip of consumedAt under "still-null" guard so a
 * concurrent double-click 410s on the loser) and performs the bound
 * action. Stamps an audit row tagged `via=email` so the trail records
 * the action originated from the morning digest.
 */
intercompanyEmailActionRouter.post(
  "/intercompany/email-action/confirm",
  async (req, res) => {
    try {
      const token = String(req.body?.token ?? "");
      const resolved = await resolveEmailActionToken(token);
      if (!resolved.ok) {
        const status =
          resolved.error.code === "CONSUMED"
            ? 410
            : resolved.error.code === "EXPIRED"
              ? 410
              : resolved.error.code === "FORBIDDEN"
                ? 403
                : 404;
        res.status(status).json({
          ok: false,
          error: resolved.error.code,
          message: resolved.error.message,
        });
        return;
      }
      const ctx = resolved.ctx;
      const ip =
        (req.headers["x-forwarded-for"] as string | undefined)
          ?.split(",")[0]
          ?.trim() ||
        req.socket.remoteAddress ||
        null;
      const consumed = await consumeEmailActionToken(ctx.tokenRowId, ip);
      if (!consumed) {
        res.status(410).json({
          ok: false,
          error: "CONSUMED",
          message: "تم استخدام هذا الرابط مسبقاً",
        });
        return;
      }

      const actor = { userId: ctx.userId, userName: null };
      try {
        if (ctx.action === "resync") {
          if (ctx.linkStatus === "void") {
            res.status(409).json({
              ok: false,
              error: "LINK_VOID",
              message: "لا يمكن إعادة مزامنة رابط ملغى",
            });
            return;
          }
          await resyncMirror(ctx.linkId, actor);
        } else if (ctx.action === "ignore") {
          const ok = await setImbalanceStatus(
            ctx.imbalanceId,
            "ignored",
            ctx.userId,
            "تم التجاهل من رسالة البريد الصباحية",
            [ctx.sourceCompanyId, ctx.targetCompanyId],
          );
          if (!ok) {
            res.status(404).json({
              ok: false,
              error: "NOT_FOUND",
              message: "لم يعد السجل موجوداً",
            });
            return;
          }
        }
      } catch (err) {
        if (err instanceof IntercompanyMirrorError) {
          res.status(err.code === "FORBIDDEN" ? 403 : 400).json({
            ok: false,
            error: err.code,
            message: err.message,
          });
          return;
        }
        throw err;
      }

      // Stamp audit row tagged via=email so the trail captures the
      // morning-digest origin. We bypass recordAudit() because it
      // relies on a session-bound companyId; here we stamp the
      // source company explicitly.
      try {
        await db.insert(auditLogsTable).values({
          userId: ctx.userId,
          userName: ctx.email,
          action: ctx.action === "resync" ? "resync" : "ignore",
          entity: "intercompany_imbalance",
          details:
            `imbalance ${ctx.imbalanceId} link ${ctx.linkId} ` +
            `via=email token=${ctx.tokenRowId}`,
          ipAddress: ip ?? "unknown",
          severity: "info",
          companyId: ctx.sourceCompanyId,
        });
      } catch (err) {
        req.log.warn(
          { err, imbalanceId: ctx.imbalanceId },
          "intercompany email-action audit insert failed",
        );
      }

      res.json({
        ok: true,
        action: ctx.action,
        imbalanceId: ctx.imbalanceId,
      });
    } catch (err) {
      req.log.error({ err }, "intercompany email-action confirm failed");
      res.status(500).json({ ok: false, error: "SERVER", message: "حدث خطأ في الخادم" });
    }
  },
);

// -------- Task #151: digest preferences --------

/**
 * For the caller's currently-active company, return:
 *   - the anchor (lowest companyId) of every connected group the caller
 *     can administer (i.e. holds owner/manager on the anchor)
 *   - the prefs row for each (defaults if not yet persisted)
 *   - the company names so the UI can label each group
 *   - the caller's own user prefs (opt-out + unsubscribe token)
 *
 * The caller is only allowed to mutate groups whose anchor is one of
 * `manageableAnchors` (enforced by the PUT below).
 */
router.get("/intercompany/digest/preferences", async (req, res) => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      res.status(401).json({ error: "غير مسجل دخول" });
      return;
    }
    const groups = await getIntercompanyGroups();
    if (groups.length === 0) {
      const userPrefs = await getOrCreateUserPrefs(userId);
      res.json({
        groups: [],
        manageableAnchors: [],
        user: { optedOut: userPrefs.optedOut },
      });
      return;
    }

    // The caller can only see/manage groups they actually belong to.
    const myMemberships = await db
      .select({
        companyId: userCompaniesTable.companyId,
        role: userCompaniesTable.role,
      })
      .from(userCompaniesTable)
      .where(eq(userCompaniesTable.userId, userId));
    const myCompanyIds = new Set(myMemberships.map((m) => m.companyId));
    const adminRoles = new Set(["owner", "manager"]);
    const adminCompanyIds = new Set(
      myMemberships
        .filter((m) => adminRoles.has(m.role))
        .map((m) => m.companyId),
    );

    const visibleGroups = groups.filter((g) =>
      g.some((id) => myCompanyIds.has(id)),
    );
    const anchors = visibleGroups.map((g) => g[0]!);
    const prefsByAnchor = await loadGroupPrefsMap(anchors);

    const allCompanyIds = Array.from(
      new Set(visibleGroups.flatMap((g) => g)),
    );
    const companies =
      allCompanyIds.length > 0
        ? await db
            .select({ id: companiesTable.id, name: companiesTable.name })
            .from(companiesTable)
            .where(inArray(companiesTable.id, allCompanyIds))
        : [];
    const nameById = new Map(companies.map((c) => [c.id, c.name]));

    const manageableAnchors = visibleGroups
      .filter((g) => g.some((id) => adminCompanyIds.has(id)))
      .map((g) => g[0]!);

    const userPrefs = await getOrCreateUserPrefs(userId);

    res.json({
      groups: visibleGroups.map((g) => {
        const anchor = g[0]!;
        const prefs = prefsByAnchor.get(anchor) ?? defaultsForAnchor(anchor);
        return {
          anchorCompanyId: anchor,
          companyIds: g,
          companyNames: g.map((id) => nameById.get(id) ?? `#${id}`),
          canManage: g.some((id) => adminCompanyIds.has(id)),
          prefs,
        };
      }),
      manageableAnchors,
      user: { optedOut: userPrefs.optedOut },
    });
  } catch (err) {
    req.log.error({ err }, "load intercompany digest prefs failed");
    handleRouteError(err, res);
  }
});

/**
 * PUT /intercompany/digest/preferences/:anchorCompanyId — replace the
 * group's prefs. The caller must hold owner/manager on at least one
 * company in the group identified by that anchor.
 */
router.put(
  "/intercompany/digest/preferences/:anchorCompanyId",
  adminGuard,
  async (req, res) => {
    try {
      const userId = req.session?.userId;
      if (!userId) {
        res.status(401).json({ error: "غير مسجل دخول" });
        return;
      }
      const anchor = Number(req.params.anchorCompanyId);
      if (!Number.isFinite(anchor)) {
        res.status(400).json({ error: "bad anchor" });
        return;
      }
      const groups = await getIntercompanyGroups();
      const group = groups.find((g) => g[0] === anchor);
      if (!group) {
        res.status(404).json({ error: "group not found" });
        return;
      }
      const adminRows = await db
        .select({ companyId: userCompaniesTable.companyId })
        .from(userCompaniesTable)
        .where(
          and(
            eq(userCompaniesTable.userId, userId),
            inArray(userCompaniesTable.companyId, group),
            inArray(userCompaniesTable.role, ["owner", "manager"]),
          ),
        );
      if (adminRows.length === 0) {
        res.status(403).json({ error: "forbidden" });
        return;
      }
      const body = (req.body ?? {}) as Partial<UpdateGroupPrefsInput>;
      const input: UpdateGroupPrefsInput = {
        enabled: Boolean(body.enabled ?? true),
        sendHour: Number(body.sendHour ?? 8),
        sendMinute: Number(body.sendMinute ?? 0),
        timezone: String(body.timezone ?? "Asia/Riyadh"),
        weekdaysMask: Number(body.weekdaysMask ?? 127),
        ccEmails: Array.isArray(body.ccEmails) ? body.ccEmails : [],
        bccEmails: Array.isArray(body.bccEmails) ? body.bccEmails : [],
      };
      const err = validateGroupPrefs(input);
      if (err) {
        res.status(400).json({ error: err });
        return;
      }
      const prefs = await upsertGroupPrefs(anchor, input, userId);
      void recordAudit(req, {
        action: "update",
        entity: "intercompany_digest_prefs",
        details: `anchor=${anchor} enabled=${prefs.enabled} time=${prefs.sendHour}:${String(prefs.sendMinute).padStart(2, "0")} tz=${prefs.timezone} mask=${prefs.weekdaysMask}`,
      });
      res.json({ ok: true, prefs });
    } catch (err) {
      req.log.error({ err }, "update intercompany digest prefs failed");
      handleRouteError(err, res);
    }
  },
);

/**
 * PUT /intercompany/digest/me — caller toggles their own opt-out
 * without needing to use the email unsubscribe link.
 */
router.put("/intercompany/digest/me", async (req, res) => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      res.status(401).json({ error: "غير مسجل دخول" });
      return;
    }
    const optedOut = Boolean((req.body ?? {}).optedOut);
    const prefs = await setUserOptedOut(userId, optedOut);
    void recordAudit(req, {
      action: optedOut ? "opt_out" : "opt_in",
      entity: "intercompany_digest_prefs",
      details: `user ${userId}`,
    });
    res.json({ ok: true, optedOut: prefs.optedOut });
  } catch (err) {
    req.log.error({ err }, "update own intercompany digest opt-out failed");
    handleRouteError(err, res);
  }
});

export default router;
