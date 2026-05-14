import { Router } from "express";
import {
  db,
  anomalyRulesTable,
  anomalyEventsTable,
} from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { adminGuard, requireRole } from "../middlewares/require-role";
import { recordAudit } from "../lib/audit";

const router = Router();

// Reading rules + events is open to managers + auditors; mutating
// rules and acknowledging events stays manager-only.
const anomalyReadGuard = requireRole("owner", "manager", "auditor");

function serializeRule(r: typeof anomalyRulesTable.$inferSelect) {
  return {
    id: r.id,
    ruleKey: r.ruleKey,
    name: r.name,
    description: r.description,
    eventType: r.eventType,
    windowMinutes: r.windowMinutes,
    threshold: r.threshold,
    severity: r.severity,
    isEnabled: r.isEnabled,
    updatedAt: r.updatedAt.toISOString(),
  };
}

function serializeEvent(e: typeof anomalyEventsTable.$inferSelect) {
  return {
    id: e.id,
    ruleKey: e.ruleKey,
    ruleName: e.ruleName,
    actorId: e.actorId,
    actorName: e.actorName,
    refTable: e.refTable,
    refId: e.refId,
    payload: e.payload,
    severity: e.severity,
    status: e.status,
    createdAt: e.createdAt.toISOString(),
    acknowledgedAt: e.acknowledgedAt?.toISOString() ?? null,
    acknowledgedByName: e.acknowledgedByName,
  };
}

router.get("/anomalies/rules", anomalyReadGuard, async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(anomalyRulesTable)
      .orderBy(anomalyRulesTable.ruleKey);
    res.json(rows.map(serializeRule));
  } catch (err) {
    req.log.error({ err }, "List anomaly rules failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

const UpdateRuleBody = z.object({
  windowMinutes: z.coerce.number().int().min(1).max(10080).optional(),
  threshold: z.coerce.number().int().min(1).max(1000).optional(),
  severity: z.enum(["low", "medium", "high", "critical"]).optional(),
  isEnabled: z.boolean().optional(),
});

router.patch("/anomalies/rules/:key", adminGuard, async (req, res) => {
  try {
    const key = String(req.params.key);
    const body = UpdateRuleBody.parse(req.body);
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (body.windowMinutes !== undefined) set.windowMinutes = body.windowMinutes;
    if (body.threshold !== undefined) set.threshold = body.threshold;
    if (body.severity !== undefined) set.severity = body.severity;
    if (body.isEnabled !== undefined) set.isEnabled = body.isEnabled;
    const [updated] = await db
      .update(anomalyRulesTable)
      .set(set)
      .where(eq(anomalyRulesTable.ruleKey, key))
      .returning();
    if (!updated) return res.status(404).json({ error: "القاعدة غير موجودة" });
    void recordAudit(req, {
      action: "update",
      entity: "anomaly_rule",
      details: `تحديث قاعدة ${key}: ${JSON.stringify(body)}`,
    });
    return res.json(serializeRule(updated));
  } catch (err) {
    req.log.error({ err }, "Update anomaly rule failed");
    return res.status(400).json({ error: "بيانات غير صحيحة" });
  }
});

const ListEventsQuery = z.object({
  status: z.enum(["open", "acknowledged", "dismissed"]).optional(),
  severity: z.enum(["low", "medium", "high", "critical"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

router.get("/anomalies/events", anomalyReadGuard, async (req, res) => {
  try {
    const q = ListEventsQuery.parse(req.query);
    const conds = [] as Array<ReturnType<typeof eq>>;
    if (q.status) conds.push(eq(anomalyEventsTable.status, q.status));
    if (q.severity) conds.push(eq(anomalyEventsTable.severity, q.severity));
    const rows = await db
      .select()
      .from(anomalyEventsTable)
      .where(conds.length ? and(...conds) : sql`true`)
      .orderBy(desc(anomalyEventsTable.createdAt))
      .limit(q.limit ?? 100);
    res.json(rows.map(serializeEvent));
  } catch (err) {
    req.log.error({ err }, "List anomaly events failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

const UpdateEventBody = z.object({
  status: z.enum(["acknowledged", "dismissed"]),
});

router.patch("/anomalies/events/:id", adminGuard, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: "معرّف غير صالح" });
    }
    const body = UpdateEventBody.parse(req.body);
    const userId = req.session?.userId ?? null;
    const userName =
      (req.session as { userName?: string } | undefined)?.userName ?? null;
    const [updated] = await db
      .update(anomalyEventsTable)
      .set({
        status: body.status,
        acknowledgedAt: new Date(),
        acknowledgedByUserId: userId,
        acknowledgedByName: userName,
      })
      .where(eq(anomalyEventsTable.id, id))
      .returning();
    if (!updated) return res.status(404).json({ error: "التنبيه غير موجود" });
    void recordAudit(req, {
      action: body.status === "acknowledged" ? "acknowledge" : "dismiss",
      entity: "anomaly_event",
      details: `${body.status} للتنبيه #${id} (${updated.ruleKey})`,
    });
    return res.json(serializeEvent(updated));
  } catch (err) {
    req.log.error({ err }, "Update anomaly event failed");
    return res.status(400).json({ error: "بيانات غير صحيحة" });
  }
});

router.get("/anomalies/stats", anomalyReadGuard, async (req, res) => {
  try {
    const [row] = await db
      .select({
        openCount: sql<number>`count(*) filter (where ${anomalyEventsTable.status} = 'open')::int`,
        criticalOpen: sql<number>`count(*) filter (where ${anomalyEventsTable.status} = 'open' and ${anomalyEventsTable.severity} in ('high','critical'))::int`,
        last24h: sql<number>`count(*) filter (where ${anomalyEventsTable.createdAt} >= now() - interval '24 hours')::int`,
        total: sql<number>`count(*)::int`,
      })
      .from(anomalyEventsTable);
    res.json({
      openCount: Number(row?.openCount ?? 0),
      criticalOpen: Number(row?.criticalOpen ?? 0),
      last24h: Number(row?.last24h ?? 0),
      total: Number(row?.total ?? 0),
    });
  } catch (err) {
    req.log.error({ err }, "Anomaly stats failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
