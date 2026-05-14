import { Router } from "express";
import os from "os";
import {
  db,
  supportTicketsTable,
  announcementsTable,
  featureFlagsTable,
  permissionOverridesTable,
  usersTable,
} from "@workspace/db";
import { eq, sql, desc, and, gt, or, isNull } from "drizzle-orm";
import {
  getPermissionMatrixPayload,
  refreshPermissionOverridesCache,
} from "../lib/permission-overrides";
import { z } from "zod";
import { adminGuard } from "../middlewares/require-role";

const router = Router();

const adminOnly = adminGuard;

const APP_VERSION = process.env["APP_VERSION"] ?? "1.0.0";
const APP_STARTED_AT = new Date();

// ============== Stats ==============
router.get("/admin/stats", adminOnly, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [tStats] = await db
      .select({
        openTickets: sql<number>`count(*) filter (where ${supportTicketsTable.status} in ('open', 'in_progress'))`,
        criticalTickets: sql<number>`count(*) filter (where ${supportTicketsTable.priority} = 'critical' and ${supportTicketsTable.status} != 'resolved')`,
        resolvedToday: sql<number>`count(*) filter (where ${supportTicketsTable.resolvedAt} >= ${today.toISOString()})`,
      })
      .from(supportTicketsTable);

    const [uStats] = await db
      .select({
        activeUsers: sql<number>`count(*) filter (where ${usersTable.isActive} = true)`,
        totalUsers: sql<number>`count(*)`,
      })
      .from(usersTable);

    const [aStats] = await db
      .select({
        activeAnnouncements: sql<number>`count(*) filter (where ${announcementsTable.isActive} = true)`,
      })
      .from(announcementsTable);

    const [fStats] = await db
      .select({
        enabledFeatures: sql<number>`count(*) filter (where ${featureFlagsTable.isEnabled} = true)`,
        totalFeatures: sql<number>`count(*)`,
      })
      .from(featureFlagsTable);

    res.json({
      openTickets: Number(tStats.openTickets),
      criticalTickets: Number(tStats.criticalTickets),
      resolvedToday: Number(tStats.resolvedToday),
      activeUsers: Number(uStats.activeUsers),
      totalUsers: Number(uStats.totalUsers),
      activeAnnouncements: Number(aStats.activeAnnouncements),
      enabledFeatures: Number(fStats.enabledFeatures),
      totalFeatures: Number(fStats.totalFeatures),
    });
  } catch (err) {
    req.log.error({ err }, "Admin stats failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============== System Health ==============
router.get("/admin/system", adminOnly, async (req, res) => {
  try {
    const t0 = Date.now();
    let dbOk = false;
    let dbLatency = 0;
    try {
      await db.execute(sql`select 1`);
      dbLatency = Date.now() - t0;
      dbOk = true;
    } catch {
      dbOk = false;
    }

    const mem = process.memoryUsage();
    const totalMem = os.totalmem();

    res.json({
      databaseOk: dbOk,
      databaseLatencyMs: dbLatency,
      uptimeSeconds: Math.round(process.uptime()),
      memoryUsedMb: Math.round(mem.rss / 1024 / 1024),
      memoryTotalMb: Math.round(totalMem / 1024 / 1024),
      nodeVersion: process.version,
      appVersion: APP_VERSION,
      environment: process.env["NODE_ENV"] ?? "development",
      startedAt: APP_STARTED_AT.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "System health failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============== Tickets ==============
function serializeTicket(t: typeof supportTicketsTable.$inferSelect) {
  return {
    ...t,
    createdAt: t.createdAt.toISOString(),
    resolvedAt: t.resolvedAt?.toISOString() ?? null,
  };
}

router.get("/admin/tickets", adminOnly, async (req, res) => {
  try {
    const { status } = req.query;
    const rows = await db
      .select()
      .from(supportTicketsTable)
      .where(status ? eq(supportTicketsTable.status, String(status)) : sql`true`)
      .orderBy(desc(supportTicketsTable.createdAt));
    res.json(rows.map(serializeTicket));
  } catch (err) {
    req.log.error({ err }, "List tickets failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

const CreateTicketBody = z.object({
  subject: z.string().min(2).max(200),
  message: z.string().min(2).max(5000),
  customerName: z.string().min(2).max(200),
  customerEmail: z.string().email(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
  category: z.string().optional(),
});

router.post("/admin/tickets", adminOnly, async (req, res) => {
  try {
    const body = CreateTicketBody.parse(req.body);
    const [created] = await db
      .insert(supportTicketsTable)
      .values({
        subject: body.subject,
        message: body.message,
        customerName: body.customerName,
        customerEmail: body.customerEmail,
        priority: body.priority ?? "medium",
        category: body.category ?? "general",
      })
      .returning();
    res.status(201).json(serializeTicket(created));
  } catch (err) {
    req.log.error({ err }, "Create ticket failed");
    res.status(400).json({ error: "بيانات غير صحيحة" });
  }
});

const UpdateTicketBody = z.object({
  status: z.enum(["open", "in_progress", "resolved"]).optional(),
  reply: z.string().max(5000).optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
});

router.patch("/admin/tickets/:id", adminOnly, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const body = UpdateTicketBody.parse(req.body);
    const update: Record<string, unknown> = {};
    if (body.status) update.status = body.status;
    if (body.reply !== undefined) update.reply = body.reply;
    if (body.priority) update.priority = body.priority;
    if (body.status === "resolved") update.resolvedAt = new Date();

    const [updated] = await db
      .update(supportTicketsTable)
      .set(update)
      .where(eq(supportTicketsTable.id, id))
      .returning();
    if (!updated) return res.status(404).json({ error: "Not found" });
    return res.json(serializeTicket(updated));
  } catch (err) {
    req.log.error({ err }, "Update ticket failed");
    return res.status(400).json({ error: "بيانات غير صحيحة" });
  }
});

// ============== Announcements ==============
function serializeAnnouncement(a: typeof announcementsTable.$inferSelect) {
  return {
    id: a.id,
    title: a.title,
    message: a.message,
    type: a.type,
    isActive: a.isActive,
    publishedAt: a.publishedAt.toISOString(),
    expiresAt: a.expiresAt?.toISOString() ?? null,
  };
}

router.get("/admin/announcements", adminOnly, async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(announcementsTable)
      .orderBy(desc(announcementsTable.publishedAt));
    res.json(rows.map(serializeAnnouncement));
  } catch (err) {
    req.log.error({ err }, "List announcements failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/active-announcements", adminOnly, async (req, res) => {
  try {
    const now = new Date();
    const rows = await db
      .select()
      .from(announcementsTable)
      .where(
        and(
          eq(announcementsTable.isActive, true),
          or(isNull(announcementsTable.expiresAt), gt(announcementsTable.expiresAt, now)),
        ),
      )
      .orderBy(desc(announcementsTable.publishedAt))
      .limit(5);
    res.json(rows.map(serializeAnnouncement));
  } catch (err) {
    req.log.error({ err }, "List active announcements failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

const CreateAnnouncementBody = z.object({
  title: z.string().min(2).max(200),
  message: z.string().min(2).max(2000),
  type: z.enum(["info", "update", "maintenance", "warning"]),
  expiresAt: z.string().nullish(),
});

router.post("/admin/announcements", adminOnly, async (req, res) => {
  try {
    const body = CreateAnnouncementBody.parse(req.body);
    const [created] = await db
      .insert(announcementsTable)
      .values({
        title: body.title,
        message: body.message,
        type: body.type,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
        createdByUserId: req.session.userId ?? null,
      })
      .returning();
    res.status(201).json(serializeAnnouncement(created));
  } catch (err) {
    req.log.error({ err }, "Create announcement failed");
    res.status(400).json({ error: "بيانات غير صحيحة" });
  }
});

router.delete("/admin/announcements/:id", adminOnly, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const result = await db.delete(announcementsTable).where(eq(announcementsTable.id, id));
    if (!result.rowCount) return res.status(404).json({ error: "Not found" });
    return res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Delete announcement failed");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ============== Feature Flags ==============
function serializeFlag(f: typeof featureFlagsTable.$inferSelect) {
  return {
    id: f.id,
    key: f.key,
    name: f.name,
    description: f.description,
    isEnabled: f.isEnabled,
    category: f.category,
    updatedAt: f.updatedAt.toISOString(),
  };
}

router.get("/admin/feature-flags", adminOnly, async (req, res) => {
  try {
    const rows = await db.select().from(featureFlagsTable).orderBy(featureFlagsTable.category, featureFlagsTable.name);
    res.json(rows.map(serializeFlag));
  } catch (err) {
    req.log.error({ err }, "List feature flags failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

const UpdateFlagBody = z.object({ isEnabled: z.boolean() });

router.patch("/admin/feature-flags/:key", adminOnly, async (req, res) => {
  try {
    const key = String(req.params.key);
    const { isEnabled } = UpdateFlagBody.parse(req.body);
    const [updated] = await db
      .update(featureFlagsTable)
      .set({ isEnabled, updatedAt: new Date() })
      .where(eq(featureFlagsTable.key, key))
      .returning();
    if (!updated) return res.status(404).json({ error: "Feature flag not found" });
    return res.json(serializeFlag(updated));
  } catch (err) {
    req.log.error({ err }, "Update feature flag failed");
    return res.status(400).json({ error: "بيانات غير صحيحة" });
  }
});

// ============== Permission matrix ==============
router.get("/admin/permissions", adminOnly, async (req, res) => {
  try {
    const payload = await getPermissionMatrixPayload();
    res.json(payload);
  } catch (err) {
    req.log.error({ err }, "List permission matrix failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

const SetPermissionBody = z.object({
  role: z.string().min(1).max(64),
  permissionKey: z.string().min(1).max(128),
  enabled: z.boolean(),
});

router.put("/admin/permissions", adminOnly, async (req, res) => {
  try {
    const { role, permissionKey, enabled } = SetPermissionBody.parse(req.body);
    // Atomic upsert against the (role, permission_key) unique index so
    // concurrent admin toggles can never insert duplicate rows.
    await db
      .insert(permissionOverridesTable)
      .values({ role, permissionKey, enabled })
      .onConflictDoUpdate({
        target: [permissionOverridesTable.role, permissionOverridesTable.permissionKey],
        set: { enabled, updatedAt: new Date() },
      });
    await refreshPermissionOverridesCache();
    const payload = await getPermissionMatrixPayload();
    return res.json(payload);
  } catch (err) {
    req.log.error({ err }, "Set permission cell failed");
    return res.status(400).json({ error: "بيانات غير صحيحة" });
  }
});

export default router;
