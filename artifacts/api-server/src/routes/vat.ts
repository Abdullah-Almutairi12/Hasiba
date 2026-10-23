import { Router } from "express";
import { db, companiesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { handleRouteError } from "../lib/handle-error";
import { recordAudit } from "../lib/audit";
import { getCompanyId } from "../lib/scoped-db";
import {
  getVatThresholdSnapshot,
  computeRolling12mSales,
  simulateVatTrajectory,
  type VatRegistrationStatus,
} from "../lib/vat-threshold";
import { evaluateAndEmit } from "../lib/vat-threshold-sweep";
import { computeVatReturn } from "../lib/vat-return";
import { buildVatReturnPdf } from "../lib/pdf/business-documents";
import { getPrintCompany as getCompanyInfo } from "../lib/pdf/print-company";
import { aggregatePrintGuard } from "../lib/print-permissions";
import { requireRole, financeGuard } from "../middlewares/require-role";

const router = Router();

const UpdateRegistrationBody = z.object({
  status: z.enum(["registered", "voluntary", "not_registered"]),
  vatNumber: z.string().trim().min(1).max(50).nullable().optional(),
  vatRegistrationDate: z.string().datetime().nullable().optional(),
  vatDeregistrationDate: z.string().datetime().nullable().optional(),
});

/**
 * GET /vat/status — current tenant's VAT registration snapshot:
 * persisted status + rolling 12-month sales + threshold breakdown.
 * Used by the dashboard card, onboarding wizard and the
 * `useVatEnabled()` hook to gate VAT UI when not registered.
 */
router.get("/vat/status", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const snap = await getVatThresholdSnapshot(companyId);
    res.json(snap);
  } catch (err) {
    req.log.error({ err }, "GET /vat/status failed");
    handleRouteError(err, res);
  }
});

/**
 * PATCH /vat/registration — owner/manager/accountant updates the
 * tenant's VAT registration status (used by the onboarding wizard and
 * the "ابدأ التسجيل" call-to-action on the dashboard card). Triggering
 * a status change also wipes the alert-debounce timestamps so a
 * subsequent threshold crossing emits a fresh dashboard banner.
 */
router.patch(
  "/vat/registration",
  requireRole("owner", "manager", "accountant"),
  async (req, res) => {
    try {
      const companyId = getCompanyId(req);
      const body = UpdateRegistrationBody.parse(req.body);

      const patch: Record<string, unknown> = {
        vatRegistrationStatus: body.status,
        updatedAt: new Date(),
        // reset debounce so the next threshold sweep can re-emit
        vatThreshold80AlertedAt: null,
        vatThreshold100AlertedAt: null,
      };
      if (body.vatNumber !== undefined) patch["vatNumber"] = body.vatNumber;
      if (body.vatRegistrationDate !== undefined) {
        patch["vatRegistrationDate"] = body.vatRegistrationDate
          ? new Date(body.vatRegistrationDate)
          : null;
      }
      if (body.vatDeregistrationDate !== undefined) {
        patch["vatDeregistrationDate"] = body.vatDeregistrationDate
          ? new Date(body.vatDeregistrationDate)
          : null;
      }

      const [updated] = await db
        .update(companiesTable)
        .set(patch)
        .where(eq(companiesTable.id, companyId))
        .returning({
          id: companiesTable.id,
          vatRegistrationStatus: companiesTable.vatRegistrationStatus,
          vatNumber: companiesTable.vatNumber,
          vatRegistrationDate: companiesTable.vatRegistrationDate,
        });

      await recordAudit(req, {
        action: "vat.registration.update",
        entity: `company#${companyId}`,
        details: `تحديث حالة تسجيل الضريبة: ${body.status}`,
        severity: "warning",
      });

      res.json(updated);
    } catch (err) {
      req.log.error({ err }, "PATCH /vat/registration failed");
      handleRouteError(err, res);
    }
  },
);

/**
 * POST /vat/threshold/check — manually trigger a threshold sweep for
 * the current tenant. Returns the snapshot plus an `alertEmitted`
 * flag. Idempotent: re-running within the same period is a no-op
 * because the debounce timestamps are only cleared on a registration
 * status change or after the alert is dismissed at the DB level.
 */
router.post(
  "/vat/threshold/check",
  requireRole("owner", "manager", "accountant"),
  async (req, res) => {
    try {
      const companyId = getCompanyId(req);
      // Single source of truth for in-app + email emission semantics.
      const { snapshot, alertEmitted } = await evaluateAndEmit(companyId);
      res.json({ snapshot, alertEmitted });
    } catch (err) {
      req.log.error({ err }, "POST /vat/threshold/check failed");
      handleRouteError(err, res);
    }
  },
);

/**
 * GET /vat/return?year=YYYY&quarter=1..4[&format=pdf]
 *
 * Quarterly VAT return for the current tenant. Returns JSON by
 * default; `format=pdf` streams the Arabic-shaped PDF intended for
 * upload to ZATCA's portal or to keep as the official filing record.
 */
const VatReturnQuery = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  quarter: z.coerce.number().int().min(1).max(4),
  format: z.enum(["json", "pdf"]).optional().default("json"),
});

router.get("/vat/return", financeGuard, aggregatePrintGuard,async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const { year, quarter, format } = VatReturnQuery.parse(req.query);
    const q = quarter as 1 | 2 | 3 | 4;
    if(req.query.branchId!=null){res.status(422).json({error:"التقرير الحالي على مستوى الشركة؛ قيود المدخلات غير موسومة بالفروع، ولا يمكن توزيعها دون بيانات موثوقة",diagnosticRef:String(req.id)});return;}
    const vr = await computeVatReturn(companyId, year, q,{timezone:"Asia/Riyadh"});
    if (format === "pdf") {
      const buf = await buildVatReturnPdf(vr, await getCompanyInfo(companyId), req.query.lang === "en" ? "en" : "ar");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Cache-Control","private, no-store");
      res.setHeader(
        "Content-Disposition",
        `inline; filename="vat-company-${companyId}-${year}-Q${q}-${req.query.lang==="en"?"en":"ar"}.pdf"`,
      );
      res.send(buf);
      return;
    }
    res.json(vr);
  } catch (err) {
    req.log.error({ errorName:err instanceof Error?err.name:"Unknown",diagnosticRef:String(req.id) }, "GET /vat/return failed");
    if(err instanceof z.ZodError){res.status(400).json({error:"اختر سنة وربعًا صالحين",diagnosticRef:String(req.id)});return;}
    const incomplete=err instanceof Error&&err.message==="VAT_REPORT_INCOMPLETE";
    res.status(incomplete?422:500).json({error:incomplete?"بيانات العملات غير كافية لإعداد تقرير موحد بالريال":"تعذر جلب بيانات التقرير أو توليد الملف؛ لم يُنشأ تقرير صفري",diagnosticRef:String(req.id)});
  }
});

/**
 * POST /vat/simulate — "what-if" VAT trajectory simulator.
 *
 * Owner/manager/accountant only. Defaults the baseline to the live
 * rolling-12m sales for the current tenant; clients can override (e.g.
 * for hypothetical scenarios where the user wants to model a yet-to-be
 * acquired business line). Returns a 12-36 month projection plus the
 * crossing month for the voluntary / mandatory thresholds.
 *
 * Pure compute on top of `simulateVatTrajectory` — no DB writes.
 */
const SimulateBody = z.object({
  baselineRolling12mSales: z.number().min(0).max(1e12).optional(),
  monthlyGrowthRate: z.number().min(-0.5).max(2).optional(),
  months: z.number().int().min(1).max(36).optional(),
  oneOffBoost: z.number().min(0).max(1e12).optional(),
  cashImpactRate: z.number().min(0).max(1).optional(),
  voluntaryRegistrationChoice: z.boolean().optional(),
  priceChangePct: z.number().min(-0.5).max(2).optional(),
});

router.post("/vat/simulate", financeGuard, async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const body = SimulateBody.parse(req.body ?? {});
    const baseline =
      body.baselineRolling12mSales ?? (await computeRolling12mSales(companyId));
    const result = simulateVatTrajectory({
      baselineRolling12mSales: baseline,
      monthlyGrowthRate: body.monthlyGrowthRate,
      months: body.months,
      oneOffBoost: body.oneOffBoost,
      cashImpactRate: body.cashImpactRate,
      voluntaryRegistrationChoice: body.voluntaryRegistrationChoice,
      priceChangePct: body.priceChangePct,
    });
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "POST /vat/simulate failed");
    handleRouteError(err, res);
  }
});

// Re-export the status type so importers (e.g. tests) can use it.
export type { VatRegistrationStatus };
export default router;
