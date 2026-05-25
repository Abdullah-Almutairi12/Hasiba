import { Router } from "express";
import { db, campaignsTable, leadsTable } from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { marketingGuard } from "../middlewares/require-role";
import { handleRouteError } from "../lib/handle-error";
import { ScopedDb, getCompanyId } from "../lib/scoped-db";

const router = Router();

// Marketing: any authenticated user can read. Marketing role + admins can mutate.
const mktWriteGuard = marketingGuard;

router.get("/marketing/campaigns", async (req, res) => {
  try {
    const scoped = new ScopedDb(getCompanyId(req));
    const rows = await db
      .select()
      .from(campaignsTable)
      .where(scoped.scope(campaignsTable))
      .orderBy(desc(campaignsTable.createdAt));
    res.json(
      rows.map((r) => ({
        ...r,
        budget: Number(r.budget),
        spent: Number(r.spent),
        createdAt: r.createdAt.toISOString(),
      }))
    );
  } catch (err) {
    req.log.error({ err }, "marketing/campaigns");
    res.status(500).json({ error: "Internal server error" });
  }
});

const CreateCampaignBody = z.object({
  name: z.string().min(2),
  channel: z.enum(["email", "social", "sms", "ads", "event"]).optional(),
  status: z.enum(["draft", "scheduled", "active", "paused", "completed"]).optional(),
  budget: z.number().nonnegative().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  description: z.string().optional(),
});

router.post("/marketing/campaigns", mktWriteGuard, async (req, res) => {
  try {
    const body = CreateCampaignBody.parse(req.body);
    const scoped = new ScopedDb(getCompanyId(req));
    const [row] = await db
      .insert(campaignsTable)
      .values(scoped.stamp({
        name: body.name,
        channel: body.channel ?? "email",
        status: body.status ?? "draft",
        budget: String(body.budget ?? 0),
        startDate: body.startDate ?? null,
        endDate: body.endDate ?? null,
        description: body.description ?? null,
      }))
      .returning();
    res.status(201).json({
      ...row,
      budget: Number(row.budget),
      spent: Number(row.spent),
      createdAt: row.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "marketing/campaigns POST");
    handleRouteError(err, res);
  }
});

router.get("/marketing/leads", async (req, res) => {
  try {
    const scoped = new ScopedDb(getCompanyId(req));
    const rows = await db
      .select({
        id: leadsTable.id,
        fullName: leadsTable.fullName,
        email: leadsTable.email,
        phone: leadsTable.phone,
        company: leadsTable.company,
        source: leadsTable.source,
        campaignId: leadsTable.campaignId,
        campaignName: campaignsTable.name,
        ownerId: leadsTable.ownerId,
        status: leadsTable.status,
        estimatedValue: leadsTable.estimatedValue,
        score: leadsTable.score,
        notes: leadsTable.notes,
        createdAt: leadsTable.createdAt,
      })
      .from(leadsTable)
      .leftJoin(campaignsTable, eq(campaignsTable.id, leadsTable.campaignId))
      .where(scoped.scope(leadsTable))
      .orderBy(desc(leadsTable.createdAt));
    res.json(
      rows.map((r) => ({
        ...r,
        estimatedValue: Number(r.estimatedValue),
        createdAt: r.createdAt.toISOString(),
      }))
    );
  } catch (err) {
    req.log.error({ err }, "marketing/leads");
    res.status(500).json({ error: "Internal server error" });
  }
});

const CreateLeadBody = z.object({
  fullName: z.string().min(2),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  company: z.string().optional(),
  source: z.enum(["manual", "web", "campaign", "referral"]).optional(),
  campaignId: z.number().int().optional(),
  ownerId: z.number().int().optional(),
  status: z.enum(["new", "contacted", "qualified", "proposal", "won", "lost"]).optional(),
  estimatedValue: z.number().nonnegative().optional(),
  score: z.number().int().min(0).max(100).optional(),
  notes: z.string().optional(),
});

router.post("/marketing/leads", mktWriteGuard, async (req, res) => {
  try {
    const body = CreateLeadBody.parse(req.body);
    const scoped = new ScopedDb(getCompanyId(req));
    const [row] = await db
      .insert(leadsTable)
      .values(scoped.stamp({
        fullName: body.fullName,
        email: body.email ?? null,
        phone: body.phone ?? null,
        company: body.company ?? null,
        source: body.source ?? "manual",
        campaignId: body.campaignId ?? null,
        ownerId: body.ownerId ?? null,
        status: body.status ?? "new",
        estimatedValue: String(body.estimatedValue ?? 0),
        score: body.score ?? 0,
        notes: body.notes ?? null,
      }))
      .returning();
    res.status(201).json({
      ...row,
      estimatedValue: Number(row.estimatedValue),
      createdAt: row.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "marketing/leads POST");
    handleRouteError(err, res);
  }
});

router.get("/marketing/summary", async (req, res) => {
  try {
    const scoped = new ScopedDb(getCompanyId(req));
    const [{ totalCampaigns }] = await db
      .select({ totalCampaigns: sql<number>`count(*)::int` })
      .from(campaignsTable)
      .where(scoped.scope(campaignsTable));
    const [{ activeCampaigns }] = await db
      .select({ activeCampaigns: sql<number>`count(*) filter (where ${campaignsTable.status} = 'active')::int` })
      .from(campaignsTable)
      .where(scoped.scope(campaignsTable));
    const [{ totalLeads }] = await db
      .select({ totalLeads: sql<number>`count(*)::int` })
      .from(leadsTable)
      .where(scoped.scope(leadsTable));
    const [{ wonLeads }] = await db
      .select({ wonLeads: sql<number>`count(*) filter (where ${leadsTable.status} = 'won')::int` })
      .from(leadsTable)
      .where(scoped.scope(leadsTable));
    const [{ pipelineValue }] = await db
      .select({ pipelineValue: sql<number>`coalesce(sum(${leadsTable.estimatedValue}) filter (where ${leadsTable.status} not in ('won','lost')), 0)::numeric` })
      .from(leadsTable)
      .where(scoped.scope(leadsTable));
    res.json({
      totalCampaigns,
      activeCampaigns,
      totalLeads,
      wonLeads,
      pipelineValue: Number(pipelineValue),
      conversionRate: totalLeads > 0 ? Math.round((wonLeads / totalLeads) * 100) : 0,
    });
  } catch (err) {
    req.log.error({ err }, "marketing/summary");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
