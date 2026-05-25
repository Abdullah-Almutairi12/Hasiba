import { Router } from "express";
import { z } from "zod";
import {
  db,
  opportunitiesTable,
  opportunityStagesTable,
  customersTable,
  usersTable,
  leadsTable,
} from "@workspace/db";
import { and, desc, eq, sql, asc, inArray } from "drizzle-orm";
import { handleRouteError } from "../lib/handle-error";
import { getCompanyId } from "../lib/scoped-db";
import {
  adminGuard,
  customerReadGuard,
  requireRole,
  salesWriteGuard,
} from "../middlewares/require-role";

const router = Router();

// Lightweight sales rep listing — accessible to anyone who can read CRM,
// so the per-rep funnel filter works for non-admin sales managers.
router.get("/crm/sales-reps", customerReadGuard, async (_req, res) => {
  try {
    const rows = await db
      .select({ id: usersTable.id, name: usersTable.name })
      .from(usersTable)
      .where(inArray(usersTable.role, ["sales", "manager", "owner"]))
      .orderBy(asc(usersTable.name));
    res.json(rows);
  } catch (err) {
    handleRouteError(err, res);
  }
});

// ===== Stages =====
router.get("/crm/stages", customerReadGuard, async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(opportunityStagesTable)
      .where(eq(opportunityStagesTable.isActive, true))
      .orderBy(asc(opportunityStagesTable.sequence));
    res.json(rows);
  } catch (err) {
    handleRouteError(err, res);
  }
});

router.post("/crm/stages", adminGuard, async (req, res) => {
  try {
    const Body = z.object({
      name: z.string(),
      nameAr: z.string(),
      sequence: z.number().int().default(0),
      probability: z.number().int().min(0).max(100).default(0),
      isWon: z.boolean().default(false),
      isLost: z.boolean().default(false),
      isActive: z.boolean().default(true),
    });
    const [row] = await db.insert(opportunityStagesTable).values(Body.parse(req.body)).returning();
    res.status(201).json(row);
  } catch (err) {
    handleRouteError(err, res);
  }
});

// ===== Opportunities =====
const OppBody = z.object({
  name: z.string().min(1),
  customerId: z.number().int().nullable().optional(),
  customerName: z.string().nullable().optional(),
  salesRepId: z.number().int().nullable().optional(),
  stageId: z.number().int(),
  expectedRevenue: z.number().min(0).default(0),
  probability: z.number().int().min(0).max(100).optional(),
  expectedCloseDate: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

router.get("/crm/opportunities", customerReadGuard, async (req, res) => {
  try {
    const { stageId, salesRepId, customerId } = req.query;
    const rows = await db
      .select({
        id: opportunitiesTable.id,
        name: opportunitiesTable.name,
        customerId: opportunitiesTable.customerId,
        customerName: opportunitiesTable.customerName,
        salesRepId: opportunitiesTable.salesRepId,
        salesRepName: usersTable.name,
        stageId: opportunitiesTable.stageId,
        stageName: opportunityStagesTable.nameAr,
        stageSequence: opportunityStagesTable.sequence,
        isWon: opportunityStagesTable.isWon,
        isLost: opportunityStagesTable.isLost,
        expectedRevenue: opportunitiesTable.expectedRevenue,
        probability: opportunitiesTable.probability,
        expectedCloseDate: opportunitiesTable.expectedCloseDate,
        closedAt: opportunitiesTable.closedAt,
        notes: opportunitiesTable.notes,
        createdAt: opportunitiesTable.createdAt,
        updatedAt: opportunitiesTable.updatedAt,
      })
      .from(opportunitiesTable)
      .leftJoin(opportunityStagesTable, eq(opportunityStagesTable.id, opportunitiesTable.stageId))
      .leftJoin(usersTable, eq(usersTable.id, opportunitiesTable.salesRepId))
      .where(
        and(
          stageId ? eq(opportunitiesTable.stageId, Number(stageId)) : sql`true`,
          salesRepId ? eq(opportunitiesTable.salesRepId, Number(salesRepId)) : sql`true`,
          customerId ? eq(opportunitiesTable.customerId, Number(customerId)) : sql`true`,
        ),
      )
      .orderBy(desc(opportunitiesTable.updatedAt))
      .limit(500);
    res.json(rows.map((r) => ({ ...r, expectedRevenue: Number(r.expectedRevenue) })));
  } catch (err) {
    handleRouteError(err, res);
  }
});

router.post("/crm/opportunities", salesWriteGuard, async (req, res) => {
  try {
    const b = OppBody.parse(req.body);
    const [stage] = await db.select().from(opportunityStagesTable).where(eq(opportunityStagesTable.id, b.stageId));
    if (!stage) { res.status(400).json({ error: "المرحلة غير موجودة" }); return; }
    let customerName = b.customerName ?? null;
    if (b.customerId && !customerName) {
      // Tenant scope: only resolve customers belonging to the caller's company.
      const companyId = getCompanyId(req);
      const [c] = await db
        .select()
        .from(customersTable)
        .where(and(eq(customersTable.id, b.customerId), eq(customersTable.companyId, companyId)));
      customerName = c?.name ?? null;
    }
    const [row] = await db
      .insert(opportunitiesTable)
      .values({
        name: b.name,
        customerId: b.customerId ?? null,
        customerName,
        salesRepId: b.salesRepId ?? req.session?.userId ?? null,
        stageId: b.stageId,
        expectedRevenue: String(b.expectedRevenue),
        probability: b.probability ?? stage.probability,
        expectedCloseDate: b.expectedCloseDate ?? null,
        notes: b.notes ?? null,
        closedAt: stage.isWon || stage.isLost ? new Date() : null,
        createdBy: req.session?.userId ?? null,
      })
      .returning();
    res.status(201).json({ ...row, expectedRevenue: Number(row.expectedRevenue) });
  } catch (err) {
    req.log.error({ err }, "create opp");
    handleRouteError(err, res);
  }
});

router.patch("/crm/opportunities/:id", salesWriteGuard, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const Body = OppBody.partial().extend({
      winLossReason: z.string().nullable().optional(),
    });
    const b = Body.parse(req.body);
    const patch: Partial<typeof opportunitiesTable.$inferInsert> = { updatedAt: new Date() };
    if (b.name != null) patch.name = b.name;
    if (b.customerId !== undefined) patch.customerId = b.customerId;
    if (b.customerName !== undefined) patch.customerName = b.customerName;
    if (b.salesRepId !== undefined) patch.salesRepId = b.salesRepId;
    if (b.expectedRevenue != null) patch.expectedRevenue = String(b.expectedRevenue);
    if (b.probability != null) patch.probability = b.probability;
    if (b.expectedCloseDate !== undefined) patch.expectedCloseDate = b.expectedCloseDate;
    if (b.notes !== undefined) patch.notes = b.notes;
    if (b.winLossReason !== undefined) patch.winLossReason = b.winLossReason;
    if (b.stageId != null) {
      const [stage] = await db.select().from(opportunityStagesTable).where(eq(opportunityStagesTable.id, b.stageId));
      if (!stage) { res.status(400).json({ error: "المرحلة غير موجودة" }); return; }
      patch.stageId = b.stageId;
      if (stage.isWon || stage.isLost) patch.closedAt = new Date();
      if (b.probability == null) patch.probability = stage.probability;
    }
    const [row] = await db.update(opportunitiesTable).set(patch).where(eq(opportunitiesTable.id, id)).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ ...row, expectedRevenue: Number(row.expectedRevenue) });
  } catch (err) {
    handleRouteError(err, res);
  }
});

router.delete("/crm/opportunities/:id", salesWriteGuard, async (req, res) => {
  try {
    await db.delete(opportunitiesTable).where(eq(opportunitiesTable.id, Number(req.params.id)));
    res.json({ ok: true });
  } catch (err) {
    handleRouteError(err, res);
  }
});

// Pipeline / funnel report
router.get("/crm/pipeline", customerReadGuard, async (req, res) => {
  try {
    // Optional ?salesRepId= scopes the pipeline to a single rep so the funnel
    // chart can be rendered per-rep for coaching / performance reviews.
    const salesRepId = req.query.salesRepId ? Number(req.query.salesRepId) : null;
    const stages = await db
      .select()
      .from(opportunityStagesTable)
      .where(eq(opportunityStagesTable.isActive, true))
      .orderBy(asc(opportunityStagesTable.sequence));
    const rows = await db
      .select({
        stageId: opportunitiesTable.stageId,
        count: sql<number>`count(*)::int`,
        value: sql<number>`coalesce(sum(${opportunitiesTable.expectedRevenue}::numeric), 0)`,
        weighted: sql<number>`coalesce(sum(${opportunitiesTable.expectedRevenue}::numeric * ${opportunitiesTable.probability} / 100.0), 0)`,
      })
      .from(opportunitiesTable)
      .where(salesRepId ? eq(opportunitiesTable.salesRepId, salesRepId) : sql`true`)
      .groupBy(opportunitiesTable.stageId);
    const byStage = new Map(rows.map((r) => [r.stageId, r]));
    res.json({
      salesRepId,
      stages: stages.map((s) => {
        const r = byStage.get(s.id);
        return {
          stageId: s.id,
          name: s.nameAr,
          sequence: s.sequence,
          isWon: s.isWon,
          isLost: s.isLost,
          count: r?.count ?? 0,
          value: Number(r?.value ?? 0),
          weighted: Number(r?.weighted ?? 0),
        };
      }),
    });
  } catch (err) {
    handleRouteError(err, res);
  }
});

// ===== Win-rate by stage =====
// For each terminal stage, count opportunities and report the % of
// closed opps that ended in that stage. Useful for funnel coaching.
router.get("/crm/reports/win-rate", customerReadGuard, async (req, res) => {
  try {
    const stages = await db.select().from(opportunityStagesTable);
    const counts = await db
      .select({ stageId: opportunitiesTable.stageId, count: sql<number>`count(*)::int` })
      .from(opportunitiesTable)
      .groupBy(opportunitiesTable.stageId);
    const countByStage = new Map(counts.map((c) => [c.stageId, c.count]));
    const closed = stages.filter((s) => s.isWon || s.isLost);
    const totalClosed = closed.reduce((a, s) => a + (countByStage.get(s.id) ?? 0), 0);
    const won = stages.filter((s) => s.isWon).reduce((a, s) => a + (countByStage.get(s.id) ?? 0), 0);
    res.json({
      totalClosed,
      won,
      lost: totalClosed - won,
      winRate: totalClosed > 0 ? +((won / totalClosed) * 100).toFixed(2) : 0,
      byStage: stages.map((s) => ({
        stageId: s.id,
        name: s.nameAr,
        sequence: s.sequence,
        isWon: s.isWon,
        isLost: s.isLost,
        count: countByStage.get(s.id) ?? 0,
        share: totalClosed > 0 ? +(((countByStage.get(s.id) ?? 0) / totalClosed) * 100).toFixed(2) : 0,
      })),
    });
  } catch (err) {
    handleRouteError(err, res);
  }
});

// ===== Convert a marketing Lead → CRM Opportunity =====
// Single source of truth: the lead is marked 'qualified' and an opportunity
// is created on the first stage (or one specified by the caller). The lead's
// estimated value seeds the opportunity's expected revenue. The link is
// preserved on opportunities.lead_id so the marketing team can trace
// pipeline back to the originating campaign.
router.post("/crm/leads/:leadId/convert", requireRole("owner", "manager", "sales", "marketing"), async (req, res) => {
  try {
    const leadId = Number(req.params.leadId);
    const Body = z.object({
      stageId: z.number().int().optional(),
      customerId: z.number().int().nullable().optional(),
      expectedCloseDate: z.string().nullable().optional(),
    });
    const b = Body.parse(req.body ?? {});
    const result = await db.transaction(async (tx) => {
      const [lead] = await tx.select().from(leadsTable).where(eq(leadsTable.id, leadId));
      if (!lead) throw new Error("لم يتم العثور على العميل المحتمل");

      // Idempotency: a lead may only spawn one opportunity. Without this
      // check the same lead could be converted repeatedly (the UI hides
      // the button after status changes, but the API was open) and inflate
      // the funnel + skew win-rate metrics. If a non-cancelled opportunity
      // already exists for this lead, return it instead of creating a new one.
      const existing = await tx
        .select()
        .from(opportunitiesTable)
        .where(eq(opportunitiesTable.leadId, leadId))
        .limit(1);
      if (existing.length > 0) {
        // Make sure the lead's status reflects the prior conversion.
        if (lead.status !== "qualified") {
          await tx.update(leadsTable).set({ status: "qualified" }).where(eq(leadsTable.id, leadId));
        }
        return existing[0];
      }

      let stageId = b.stageId;
      if (!stageId) {
        const [first] = await tx
          .select()
          .from(opportunityStagesTable)
          .where(eq(opportunityStagesTable.isActive, true))
          .orderBy(asc(opportunityStagesTable.sequence))
          .limit(1);
        if (!first) throw new Error("لا توجد مراحل CRM معرفة");
        stageId = first.id;
      }
      const [stage] = await tx.select().from(opportunityStagesTable).where(eq(opportunityStagesTable.id, stageId));
      if (!stage) throw new Error("المرحلة غير موجودة");

      const [opp] = await tx
        .insert(opportunitiesTable)
        .values({
          name: lead.fullName + (lead.company ? ` — ${lead.company}` : ""),
          customerId: b.customerId ?? null,
          customerName: lead.company ?? lead.fullName,
          leadId,
          stageId,
          expectedRevenue: String(lead.estimatedValue ?? 0),
          probability: stage.probability,
          expectedCloseDate: b.expectedCloseDate ?? null,
          notes: lead.notes,
          createdBy: req.session?.userId ?? null,
        })
        .returning();
      await tx.update(leadsTable).set({ status: "qualified" }).where(eq(leadsTable.id, leadId));
      return opp;
    });
    res.status(201).json({ ...result, expectedRevenue: Number(result.expectedRevenue) });
  } catch (err) {
    handleRouteError(err, res);
  }
});

export default router;
