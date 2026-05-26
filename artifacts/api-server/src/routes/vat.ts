import { Router } from "express";
import { db, companiesTable, alertsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { handleRouteError } from "../lib/handle-error";
import { recordAudit } from "../lib/audit";
import { getCompanyId } from "../lib/scoped-db";
import {
  getVatThresholdSnapshot,
  VAT_MANDATORY_THRESHOLD_SAR,
  VAT_VOLUNTARY_THRESHOLD_SAR,
  type VatRegistrationStatus,
} from "../lib/vat-threshold";
import { requireRole } from "../middlewares/require-role";

const router = Router();

const UpdateRegistrationBody = z.object({
  status: z.enum(["registered", "voluntary", "not_registered"]),
  vatNumber: z.string().trim().min(1).max(50).nullable().optional(),
  vatRegistrationDate: z.string().datetime().nullable().optional(),
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
    res.json({
      ...snap,
      mandatoryThreshold: VAT_MANDATORY_THRESHOLD_SAR,
      voluntaryThreshold: VAT_VOLUNTARY_THRESHOLD_SAR,
    });
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
      const snap = await getVatThresholdSnapshot(companyId);

      // Only consider tenants that are NOT yet registered — registered
      // tenants do not need a reminder to register.
      if (snap.status !== "not_registered") {
        res.json({ snapshot: snap, alertEmitted: null });
        return;
      }

      const [company] = await db
        .select({
          a80: companiesTable.vatThreshold80AlertedAt,
          a100: companiesTable.vatThreshold100AlertedAt,
        })
        .from(companiesTable)
        .where(eq(companiesTable.id, companyId))
        .limit(1);

      let alertEmitted: "near80" | "mandatory" | null = null;
      // Crossing mandatory subsumes near-80: stamp both debounce columns
      // in the same transaction so a subsequent sweep cannot regress and
      // emit a downgraded near-80 warning after a mandatory alert.
      if (snap.crossedMandatory && !company?.a100) {
        await db.transaction(async (tx) => {
          await tx.insert(alertsTable).values({
            companyId,
            type: "danger",
            title: "تجاوزت حد التسجيل الإلزامي في ضريبة القيمة المضافة",
            message: `وصلت مبيعاتك خلال آخر 12 شهرًا إلى ${snap.rolling12mSales.toLocaleString("ar-SA")} ر.س — يجب التسجيل في ZATCA خلال 30 يومًا.`,
          });
          const now = new Date();
          await tx
            .update(companiesTable)
            .set({
              vatThreshold100AlertedAt: now,
              // Also stamp 80 to suppress the lower-severity warning forever
              // (until a registration-status change clears both timestamps).
              vatThreshold80AlertedAt: company?.a80 ?? now,
            })
            .where(eq(companiesTable.id, companyId));
        });
        alertEmitted = "mandatory";
      } else if (snap.near80 && !snap.crossedMandatory && !company?.a80) {
        await db.transaction(async (tx) => {
          await tx.insert(alertsTable).values({
            companyId,
            type: "warning",
            title: "اقتربت من حد التسجيل الإلزامي في ضريبة القيمة المضافة",
            message: `وصلت إلى ${snap.percentOfMandatory.toFixed(1)}٪ من الحد الإلزامي (375,000 ر.س). يُنصح بالاستعداد للتسجيل.`,
          });
          await tx
            .update(companiesTable)
            .set({ vatThreshold80AlertedAt: new Date() })
            .where(eq(companiesTable.id, companyId));
        });
        alertEmitted = "near80";
      }

      res.json({ snapshot: snap, alertEmitted });
    } catch (err) {
      req.log.error({ err }, "POST /vat/threshold/check failed");
      handleRouteError(err, res);
    }
  },
);

// Re-export the status type so importers (e.g. tests) can use it.
export type { VatRegistrationStatus };
export default router;
