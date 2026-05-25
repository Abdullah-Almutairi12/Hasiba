import { Router } from "express";
import { db, intercompanyLinksTable, companiesTable } from "@workspace/db";
import { desc, eq, sql } from "drizzle-orm";
import { financeGuard } from "../middlewares/require-role";
import { handleRouteError } from "../lib/handle-error";
import { getCompanyId } from "../lib/scoped-db";
import { voidMirror, resyncMirror, IntercompanyMirrorError } from "../lib/intercompany-mirror";
import { recordAudit } from "../lib/audit";

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

export default router;
