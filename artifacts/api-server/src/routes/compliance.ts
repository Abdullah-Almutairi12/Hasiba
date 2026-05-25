/**
 * Phase 3 — Compliance console API.
 *
 * Surfaces the durable `compliance_alerts` queue and the
 * `intercompany_agreements` PDF registry to the `/compliance`
 * front-end page.
 *
 * Read endpoints are gated by `reportReadGuard` (owner, manager,
 * accountant, auditor — the standard "finance + audit" cohort).
 * Writes that change the compliance state (resolve alerts, manage
 * agreements, manually trigger the zakat scan) are gated by
 * `financeGuard`.
 *
 * Tenant scoping: every query is filtered through `getCompanyId(req)`
 * so a user holding multiple memberships can only see findings for
 * the currently-selected company.
 */

import { Router } from "express";
import { z } from "zod/v4";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  complianceAlertsTable,
  intercompanyAgreementsTable,
  companiesTable,
  userCompaniesTable,
} from "@workspace/db";
import { financeGuard, reportReadGuard } from "../middlewares/require-role";
import { handleRouteError } from "../lib/handle-error";
import { getCompanyId } from "../lib/scoped-db";
import { runZakatComplianceCheck } from "../lib/compliance/zakat";

const router = Router();

const listAlertsQuerySchema = z.object({
  status: z.enum(["open", "resolved", "dismissed"]).optional(),
  kind: z.enum(["transfer_pricing", "agreement_missing", "zakat"]).optional(),
});

router.get("/compliance/alerts", reportReadGuard, async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const { status, kind } = listAlertsQuerySchema.parse(req.query);
    const conds = [eq(complianceAlertsTable.companyId, companyId)];
    if (status) conds.push(eq(complianceAlertsTable.status, status));
    if (kind) conds.push(eq(complianceAlertsTable.kind, kind));
    const rows = await db
      .select()
      .from(complianceAlertsTable)
      .where(and(...conds))
      .orderBy(desc(complianceAlertsTable.createdAt))
      .limit(500);
    res.json(rows);
  } catch (err) {
    handleRouteError(err, res);
  }
});

const resolveBodySchema = z.object({
  note: z.string().max(500).optional(),
  status: z.enum(["resolved", "dismissed"]).default("resolved"),
});

router.post(
  "/compliance/alerts/:id/resolve",
  financeGuard,
  async (req, res) => {
    try {
      const companyId = getCompanyId(req);
      const id = Number(req.params["id"]);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: "invalid id" });
        return;
      }
      const { note, status } = resolveBodySchema.parse(req.body ?? {});
      const userId =
        typeof req.session?.userId === "number" ? req.session.userId : null;
      const [updated] = await db
        .update(complianceAlertsTable)
        .set({
          status,
          resolvedAt: new Date(),
          resolvedBy: userId,
          resolvedNote: note ?? null,
        })
        .where(
          and(
            eq(complianceAlertsTable.id, id),
            eq(complianceAlertsTable.companyId, companyId),
          ),
        )
        .returning();
      if (!updated) {
        res.status(404).json({ error: "alert not found" });
        return;
      }
      res.json(updated);
    } catch (err) {
      handleRouteError(err, res);
    }
  },
);

router.get("/compliance/agreements", reportReadGuard, async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const rows = await db
      .select({
        id: intercompanyAgreementsTable.id,
        companyId: intercompanyAgreementsTable.companyId,
        counterpartyCompanyId:
          intercompanyAgreementsTable.counterpartyCompanyId,
        counterpartyName: companiesTable.name,
        title: intercompanyAgreementsTable.title,
        pdfUrl: intercompanyAgreementsTable.pdfUrl,
        pdfFilename: intercompanyAgreementsTable.pdfFilename,
        effectiveFrom: intercompanyAgreementsTable.effectiveFrom,
        effectiveTo: intercompanyAgreementsTable.effectiveTo,
        isActive: intercompanyAgreementsTable.isActive,
        uploadedAt: intercompanyAgreementsTable.uploadedAt,
        notes: intercompanyAgreementsTable.notes,
      })
      .from(intercompanyAgreementsTable)
      .innerJoin(
        companiesTable,
        eq(
          companiesTable.id,
          intercompanyAgreementsTable.counterpartyCompanyId,
        ),
      )
      .where(eq(intercompanyAgreementsTable.companyId, companyId))
      .orderBy(desc(intercompanyAgreementsTable.uploadedAt));
    res.json(rows);
  } catch (err) {
    handleRouteError(err, res);
  }
});

const createAgreementSchema = z.object({
  counterpartyCompanyId: z.number().int().positive(),
  title: z.string().min(1).max(200),
  pdfUrl: z
    .string()
    .min(1)
    .max(500)
    .regex(/^\/api\/storage\/objects\//, "pdfUrl must be a /api/storage/objects/ URL"),
  pdfFilename: z.string().max(200).optional(),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  effectiveTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  notes: z.string().max(2000).optional(),
});

router.post("/compliance/agreements", financeGuard, async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const body = createAgreementSchema.parse(req.body);
    if (body.counterpartyCompanyId === companyId) {
      res
        .status(400)
        .json({ error: "counterparty cannot equal source company" });
      return;
    }
    // Make sure the counterparty company is one this user actually
    // has access to — prevents leaking unrelated company names via
    // the agreement registry.
    const userId =
      typeof req.session?.userId === "number" ? req.session.userId : null;
    if (userId !== null) {
      const [link] = await db
        .select({ id: userCompaniesTable.id })
        .from(userCompaniesTable)
        .where(
          and(
            eq(userCompaniesTable.userId, userId),
            eq(userCompaniesTable.companyId, body.counterpartyCompanyId),
          ),
        )
        .limit(1);
      if (!link) {
        res
          .status(403)
          .json({ error: "no membership on counterparty company" });
        return;
      }
    }
    const [created] = await db
      .insert(intercompanyAgreementsTable)
      .values({
        companyId,
        counterpartyCompanyId: body.counterpartyCompanyId,
        title: body.title,
        pdfUrl: body.pdfUrl,
        pdfFilename: body.pdfFilename ?? null,
        effectiveFrom: body.effectiveFrom,
        effectiveTo: body.effectiveTo ?? null,
        notes: body.notes ?? null,
        uploadedBy: userId,
      })
      .returning();
    res.status(201).json(created);
  } catch (err) {
    handleRouteError(err, res);
  }
});

router.delete(
  "/compliance/agreements/:id",
  financeGuard,
  async (req, res) => {
    try {
      const companyId = getCompanyId(req);
      const id = Number(req.params["id"]);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: "invalid id" });
        return;
      }
      const [updated] = await db
        .update(intercompanyAgreementsTable)
        .set({ isActive: false })
        .where(
          and(
            eq(intercompanyAgreementsTable.id, id),
            eq(intercompanyAgreementsTable.companyId, companyId),
          ),
        )
        .returning({ id: intercompanyAgreementsTable.id });
      if (!updated) {
        res.status(404).json({ error: "agreement not found" });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      handleRouteError(err, res);
    }
  },
);

router.post("/compliance/zakat/run", financeGuard, async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const result = await runZakatComplianceCheck(companyId);
    res.json(result);
  } catch (err) {
    handleRouteError(err, res);
  }
});

export default router;
