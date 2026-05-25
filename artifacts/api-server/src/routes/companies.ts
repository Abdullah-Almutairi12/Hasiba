import { Router } from "express";
import {
  db,
  companiesTable,
  userCompaniesTable,
  usersTable,
} from "@workspace/db";
import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { ownerOnly } from "../middlewares/require-role";
import { ALL_ROLES, isRole } from "../middlewares/require-role";
import { handleRouteError } from "../lib/handle-error";
import { recordAudit } from "../lib/audit";
import {
  countActiveCompanies,
  countActiveDataForCompany,
  provisionNewCompany,
} from "../lib/company-service";

const router = Router();

// ============== Validation schemas ==============

const RoleEnum = z.enum(ALL_ROLES);

const CreateCompanyBody = z.object({
  name: z.string().trim().min(2).max(120),
  nameEn: z.string().trim().min(1).max(120).optional().nullable(),
  vatNumber: z.string().trim().min(1).max(50).optional().nullable(),
  crNumber: z.string().trim().min(1).max(50).optional().nullable(),
  baseCurrency: z.string().trim().length(3).optional(),
  fiscalYearStartMonth: z.number().int().min(1).max(12).optional(),
  logoUrl: z.string().trim().url().optional().nullable(),
  address: z.record(z.unknown()).optional(),
});

const UpdateCompanyBody = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  nameEn: z.string().trim().min(1).max(120).nullable().optional(),
  vatNumber: z.string().trim().min(1).max(50).nullable().optional(),
  crNumber: z.string().trim().min(1).max(50).nullable().optional(),
  baseCurrency: z.string().trim().length(3).optional(),
  fiscalYearStartMonth: z.number().int().min(1).max(12).optional(),
  logoUrl: z.string().trim().url().nullable().optional(),
  address: z.record(z.unknown()).optional(),
});

const AssignUserBody = z.object({
  userId: z.number().int().positive(),
  role: RoleEnum,
  isDefault: z.boolean().optional(),
});

const IdParam = z.coerce.number().int().positive();

// ============== List companies ==============

/**
 * GET /admin/companies — list every company (owner-only). Multi-Company
 * Phase 3: this is the only place that returns the full tenant list,
 * regardless of session scope.
 */
router.get("/admin/companies", ownerOnly, async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(companiesTable)
      .orderBy(asc(companiesTable.name));
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "List companies failed");
    handleRouteError(err, res);
  }
});

// ============== Create company ==============

/**
 * POST /admin/companies — create a new tenant (owner-only). Also seeds
 * the default Chart of Accounts and grants the calling owner default
 * access to the new company.
 */
router.post("/admin/companies", ownerOnly, async (req, res) => {
  try {
    const body = CreateCompanyBody.parse(req.body);
    const callerId = req.session.userId;
    if (!callerId) {
      res.status(401).json({ error: "غير مسجل دخول" });
      return;
    }

    const newCompanyId = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(companiesTable)
        .values({
          name: body.name,
          nameEn: body.nameEn ?? null,
          vatNumber: body.vatNumber ?? null,
          crNumber: body.crNumber ?? null,
          baseCurrency: body.baseCurrency ?? "SAR",
          fiscalYearStartMonth: body.fiscalYearStartMonth ?? 1,
          logoUrl: body.logoUrl ?? null,
          address: body.address ?? {},
        })
        .returning({ id: companiesTable.id });
      // Grant the calling owner non-default access to the new company so
      // they can opt-in via /auth/switch-company. We deliberately do NOT
      // flip isDefault — that's the user's tenant of record.
      await tx.insert(userCompaniesTable).values({
        userId: callerId,
        companyId: created.id,
        role: "owner",
        isDefault: false,
      });
      return created.id;
    });

    await provisionNewCompany(newCompanyId);

    const [created] = await db
      .select()
      .from(companiesTable)
      .where(eq(companiesTable.id, newCompanyId))
      .limit(1);

    await recordAudit(req, {
      action: "company.create",
      entity: `company#${newCompanyId}`,
      details: `إنشاء شركة جديدة: ${body.name}`,
      severity: "warning",
    });

    res.status(201).json(created);
  } catch (err) {
    req.log.error({ err }, "Create company failed");
    handleRouteError(err, res);
  }
});

// ============== Update company ==============

/**
 * PATCH /admin/companies/:id — partially update a tenant (owner-only).
 */
router.patch("/admin/companies/:id", ownerOnly, async (req, res) => {
  try {
    const id = IdParam.parse(req.params.id);
    const body = UpdateCompanyBody.parse(req.body);

    const [existing] = await db
      .select({ id: companiesTable.id })
      .from(companiesTable)
      .where(eq(companiesTable.id, id))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "INVALID_REFERENCE", message: "الشركة غير موجودة" });
      return;
    }

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name !== undefined) patch["name"] = body.name;
    if (body.nameEn !== undefined) patch["nameEn"] = body.nameEn;
    if (body.vatNumber !== undefined) patch["vatNumber"] = body.vatNumber;
    if (body.crNumber !== undefined) patch["crNumber"] = body.crNumber;
    if (body.baseCurrency !== undefined) patch["baseCurrency"] = body.baseCurrency;
    if (body.fiscalYearStartMonth !== undefined) patch["fiscalYearStartMonth"] = body.fiscalYearStartMonth;
    if (body.logoUrl !== undefined) patch["logoUrl"] = body.logoUrl;
    if (body.address !== undefined) patch["address"] = body.address;

    const [updated] = await db
      .update(companiesTable)
      .set(patch)
      .where(eq(companiesTable.id, id))
      .returning();

    await recordAudit(req, {
      action: "company.update",
      entity: `company#${id}`,
      details: `تحديث بيانات الشركة (${Object.keys(patch).filter((k) => k !== "updatedAt").join(", ")})`,
      severity: "info",
    });

    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Update company failed");
    handleRouteError(err, res);
  }
});

// ============== Soft delete company ==============

/**
 * DELETE /admin/companies/:id — soft-deactivate a tenant (owner-only).
 * Refuses when:
 *   - it's the last remaining active company, OR
 *   - it still has any active business data (invoices, POS orders,
 *     journal entries).
 */
router.delete("/admin/companies/:id", ownerOnly, async (req, res) => {
  try {
    const id = IdParam.parse(req.params.id);

    const [existing] = await db
      .select()
      .from(companiesTable)
      .where(eq(companiesTable.id, id))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "INVALID_REFERENCE", message: "الشركة غير موجودة" });
      return;
    }
    if (!existing.isActive) {
      res.status(409).json({ error: "ALREADY_INACTIVE", message: "الشركة معطّلة بالفعل" });
      return;
    }

    const activeCount = await countActiveCompanies();
    if (activeCount <= 1) {
      res.status(409).json({
        error: "LAST_COMPANY",
        message: "لا يمكن حذف الشركة الوحيدة المتبقية",
      });
      return;
    }

    const counts = await countActiveDataForCompany(id);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    if (total > 0) {
      res.status(409).json({
        error: "HAS_ACTIVE_DATA",
        message: "لا يمكن حذف الشركة لاحتوائها على بيانات نشطة",
        counts,
      });
      return;
    }

    await db
      .update(companiesTable)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(companiesTable.id, id));

    await recordAudit(req, {
      action: "company.delete",
      entity: `company#${id}`,
      details: `تعطيل الشركة: ${existing.name}`,
      severity: "critical",
    });

    res.status(204).end();
  } catch (err) {
    req.log.error({ err }, "Delete company failed");
    handleRouteError(err, res);
  }
});

// ============== Company users matrix ==============

/**
 * GET /admin/companies/:id/users — list every user that has access to
 * the given company along with their per-company role.
 */
router.get("/admin/companies/:id/users", ownerOnly, async (req, res) => {
  try {
    const id = IdParam.parse(req.params.id);

    const [company] = await db
      .select({ id: companiesTable.id })
      .from(companiesTable)
      .where(eq(companiesTable.id, id))
      .limit(1);
    if (!company) {
      res.status(404).json({ error: "INVALID_REFERENCE", message: "الشركة غير موجودة" });
      return;
    }

    const rows = await db
      .select({
        id: userCompaniesTable.id,
        userId: usersTable.id,
        name: usersTable.name,
        email: usersTable.email,
        role: userCompaniesTable.role,
        isDefault: userCompaniesTable.isDefault,
        isActive: usersTable.isActive,
        createdAt: userCompaniesTable.createdAt,
      })
      .from(userCompaniesTable)
      .innerJoin(usersTable, eq(usersTable.id, userCompaniesTable.userId))
      .where(eq(userCompaniesTable.companyId, id))
      .orderBy(desc(userCompaniesTable.isDefault), asc(usersTable.name));

    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "List company users failed");
    handleRouteError(err, res);
  }
});

/**
 * POST /admin/companies/:id/users — grant a user access to the company
 * with a given per-company role. If `isDefault` is true, clears any
 * previous default for that user.
 */
router.post("/admin/companies/:id/users", ownerOnly, async (req, res) => {
  try {
    const companyId = IdParam.parse(req.params.id);
    const body = AssignUserBody.parse(req.body);

    const [company] = await db
      .select({ id: companiesTable.id })
      .from(companiesTable)
      .where(eq(companiesTable.id, companyId))
      .limit(1);
    if (!company) {
      res.status(404).json({ error: "INVALID_REFERENCE", message: "الشركة غير موجودة" });
      return;
    }

    const [user] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.id, body.userId))
      .limit(1);
    if (!user) {
      res.status(404).json({ error: "INVALID_REFERENCE", message: "المستخدم غير موجود" });
      return;
    }

    const inserted = await db.transaction(async (tx) => {
      // Wipe any previous default flag for this user if we're setting one.
      if (body.isDefault) {
        await tx
          .update(userCompaniesTable)
          .set({ isDefault: false })
          .where(
            and(
              eq(userCompaniesTable.userId, body.userId),
              ne(userCompaniesTable.companyId, companyId),
            ),
          );
      }
      const [existing] = await tx
        .select()
        .from(userCompaniesTable)
        .where(
          and(
            eq(userCompaniesTable.userId, body.userId),
            eq(userCompaniesTable.companyId, companyId),
          ),
        )
        .limit(1);
      if (existing) {
        const [updated] = await tx
          .update(userCompaniesTable)
          .set({
            role: body.role,
            isDefault: body.isDefault ?? existing.isDefault,
          })
          .where(eq(userCompaniesTable.id, existing.id))
          .returning();
        return updated;
      }
      const [row] = await tx
        .insert(userCompaniesTable)
        .values({
          userId: body.userId,
          companyId,
          role: body.role,
          isDefault: body.isDefault ?? false,
        })
        .returning();
      return row;
    });

    await recordAudit(req, {
      action: "company.user.assign",
      entity: `company#${companyId}`,
      details: `إسناد المستخدم #${body.userId} بدور ${body.role}`,
      severity: "warning",
    });

    res.status(201).json(inserted);
  } catch (err) {
    req.log.error({ err }, "Assign company user failed");
    handleRouteError(err, res);
  }
});

/**
 * DELETE /admin/companies/:id/users/:userId — remove a user's access.
 * Refuses to leave the company with zero users (would lock everyone out
 * of that tenant). The caller (owner) may revoke their own access only
 * if other users remain.
 */
router.delete(
  "/admin/companies/:id/users/:userId",
  ownerOnly,
  async (req, res) => {
    try {
      const companyId = IdParam.parse(req.params.id);
      const userId = IdParam.parse(req.params.userId);

      const [existing] = await db
        .select()
        .from(userCompaniesTable)
        .where(
          and(
            eq(userCompaniesTable.userId, userId),
            eq(userCompaniesTable.companyId, companyId),
          ),
        )
        .limit(1);
      if (!existing) {
        res
          .status(404)
          .json({ error: "INVALID_REFERENCE", message: "لا يوجد ربط بين المستخدم والشركة" });
        return;
      }

      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(userCompaniesTable)
        .where(eq(userCompaniesTable.companyId, companyId));
      if (Number(count) <= 1) {
        res.status(409).json({
          error: "LAST_COMPANY_USER",
          message: "لا يمكن إزالة آخر مستخدم في الشركة",
        });
        return;
      }

      await db
        .delete(userCompaniesTable)
        .where(eq(userCompaniesTable.id, existing.id));

      await recordAudit(req, {
        action: "company.user.revoke",
        entity: `company#${companyId}`,
        details: `إزالة وصول المستخدم #${userId}`,
        severity: "warning",
      });

      res.status(204).end();
    } catch (err) {
      req.log.error({ err }, "Revoke company user failed");
      handleRouteError(err, res);
    }
  },
);

// Avoid unused-import noise — isRole is exported for future per-route checks.
void isRole;

export default router;
