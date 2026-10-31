import { lockApprovalAuthorityWrite } from "../lib/approval-authority";
import { enrollCompanyAdministrator } from "../lib/administration-enrollment";
import { Router } from "express";
import {
  db,
  companiesTable,
  userCompaniesTable,
  usersTable,
} from "@workspace/db";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { ownerOnly } from "../middlewares/require-role";
import { ALL_ROLES, isRole } from "../middlewares/require-role";
import { requireCompanyContext } from "../middlewares/require-company-context";
import { assertAnotherActiveOwner } from "../lib/company-ownership";
import { handleRouteError } from "../lib/handle-error";
import { requireAdministrative } from "../lib/administration-authority";
import { recordAudit } from "../lib/audit";
import {assertLegacyTaxWritable,taxContext} from "../lib/vat-policy";
import {FinancialRequestError} from "../lib/financial-transaction";
import {
  countActiveCompanies,
  countActiveDataForCompany,
  provisionNewCompany,
} from "../lib/company-service";

const router = Router();
// Company administration is tenant authority, not platform-wide authority.
// Revalidate membership even on endpoints mounted before the global scope guard.
router.use(requireCompanyContext);

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
  address: z.record(z.string(), z.unknown()).optional(),
});

const UpdateCompanyBody = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  nameEn: z.string().trim().min(1).max(120).nullable().optional(),
  vatNumber: z.string().trim().min(1).max(50).nullable().optional(),
  crNumber: z.string().trim().min(1).max(50).nullable().optional(),
  baseCurrency: z.string().trim().length(3).optional(),
  fiscalYearStartMonth: z.number().int().min(1).max(12).optional(),
  logoUrl: z.string().trim().url().nullable().optional(),
  address: z.record(z.string(), z.unknown()).optional(),
});

const AssignUserBody = z.object({
  userId: z.number().int().positive(),
  role: RoleEnum,
  isDefault: z.boolean().optional(),
});

const IdParam = z.coerce.number().int().positive();

router.use("/admin/companies/:id", ownerOnly, async (req, res, next) => {
  const parsed = IdParam.safeParse(req.params.id);
  if (!parsed.success) {
    res.status(400).json({ error: "INVALID_REFERENCE" });
    return;
  }
  const [membership] = await db.select({ id: userCompaniesTable.id }).from(userCompaniesTable)
    .where(and(eq(userCompaniesTable.userId, req.session.userId!),
      eq(userCompaniesTable.companyId, parsed.data), eq(userCompaniesTable.role, "owner"))).limit(1);
  if (!membership) {
    res.status(404).json({ error: "INVALID_REFERENCE", message: "الشركة غير متاحة" });
    return;
  }
  try {await requireAdministrative(parsed.data,req.session.userId!,
    /\/users(?:\/|$)/.test(req.originalUrl.split("?")[0])?"users":"settings");}
  catch(err){handleRouteError(err,res);return;}
  next();
});

// ============== List companies ==============

/**
 * GET /admin/companies — only companies the caller explicitly owns.
 * Ownership of one company never grants platform-wide tenant access.
 */
/**
 * GET /companies/siblings — list every company the *current user* can
 * see (any role on `user_companies`). Phase-5 helper so accountants /
 * managers can populate the "linked sibling company" dropdown on
 * customer/supplier forms without needing owner-only `/admin/companies`.
 */
const BUSINESS_TYPES = ["retail", "fb", "wholesale", "services"] as const;
const UpdateCurrentCompanyBody = z.object({
  businessType: z.enum(BUSINESS_TYPES).optional(),
});

/**
 * PATCH /companies/me — update self-serve attributes on the caller's
 * ACTIVE company. Currently scoped to `businessType` (set during
 * onboarding). Owner/manager only; cross-tenant writes are impossible
 * because we only ever touch `req.session.companyId`.
 */
router.patch("/companies/me", async (req, res) => {
  try {
    const userId = req.session?.userId;
    const companyId = req.session?.companyId;
    const role = req.session?.role;
    if (!userId || companyId == null) {
      res.status(401).json({ error: "غير مسجل دخول" });
      return;
    }
    if (role !== "owner" && role !== "manager") {
      res.status(403).json({ error: "صلاحية غير كافية" });
      return;
    }
    const parsed = UpdateCurrentCompanyBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "بيانات غير صحيحة" });
      return;
    }
    const patch = parsed.data;
    if (Object.keys(patch).length === 0) {
      res.status(400).json({ error: "لا توجد حقول للتحديث" });
      return;
    }
    const [updated] = await db
      .update(companiesTable)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(companiesTable.id, companyId))
      .returning({
        id: companiesTable.id,
        businessType: companiesTable.businessType,
      });
    if (!updated) {
      res.status(404).json({ error: "الشركة غير موجودة" });
      return;
    }
    await recordAudit(req, {
      action: "update",
      entity: `company#${companyId}`,
      details: `business_type=${updated.businessType}`,
    });
    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "PATCH /companies/me failed");
    handleRouteError(err, res);
  }
});

router.get("/companies/siblings", async (req, res) => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      res.status(401).json({ error: "غير مسجل دخول" });
      return;
    }
    const rows = await db
      .select({ id: companiesTable.id, name: companiesTable.name, isActive: companiesTable.isActive })
      .from(companiesTable)
      .innerJoin(userCompaniesTable, eq(userCompaniesTable.companyId, companiesTable.id))
      .where(eq(userCompaniesTable.userId, userId))
      .orderBy(asc(companiesTable.name));
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "list sibling companies failed");
    handleRouteError(err, res);
  }
});

router.get("/admin/companies", ownerOnly, async (req, res) => {
  try {
    const rows = await db
      .select({ company: companiesTable })
      .from(companiesTable)
      .innerJoin(userCompaniesTable, eq(userCompaniesTable.companyId, companiesTable.id))
      .where(and(eq(userCompaniesTable.userId, req.session.userId!),
        eq(userCompaniesTable.role, "owner")))
      .orderBy(asc(companiesTable.name));
    res.json(await Promise.all(rows.map(async({company})=>{
      if(!company.isActive)return company;
      const identity=await taxContext(company.id);
      if(identity.mode==="legacy")return company;
      return {...company,vatNumber:identity.vatNumber,vatRegistrationStatus:identity.status};
    })));
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
      // Grant the authorized creator non-default administrative access so
      // they can opt-in via /auth/switch-company. We deliberately do NOT
      // flip isDefault — that's the user's tenant of record.
      await tx.insert(userCompaniesTable).values({
        userId: callerId,
        companyId: created.id,
        role: "scoped",
        isDefault: false,
      });
      await enrollCompanyAdministrator(tx,created.id,callerId);
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

    const updated=await db.transaction(async tx=>{
      await lockApprovalAuthorityWrite(tx);
      await tx.execute(sql`SELECT id FROM companies WHERE id=${id} FOR UPDATE`);
      await requireAdministrative(id,req.session.userId!,"settings",tx);
      const membership=await tx.execute(sql`SELECT 1 FROM user_companies WHERE
        company_id=${id} AND user_id=${req.session.userId!} AND role='owner'`);
      if(!membership.rows.length)throw new FinancialRequestError("سحبت صلاحية إدارة المنشأة",403);
      if(body.vatNumber!==undefined)await assertLegacyTaxWritable(tx,id);
      const [saved]=await tx.update(companiesTable).set(patch).where(eq(companiesTable.id,id)).returning();
      await tx.execute(sql`INSERT INTO audit_logs(company_id,user_id,user_name,action,entity,details,severity)
        SELECT ${id},id,name,'company.update',${`company#${id}`},
          ${JSON.stringify({fields:Object.keys(patch).filter(k=>k!=="updatedAt"),source:"company_administration"})},'info'
        FROM users WHERE id=${req.session.userId!}`);
      const identity=await taxContext(id,undefined,tx);
      return identity.mode==="unified"?{...saved,vatNumber:identity.vatNumber,vatRegistrationStatus:identity.status}:saved;
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
      .innerJoin(userCompaniesTable, eq(userCompaniesTable.userId, usersTable.id))
      .where(and(eq(usersTable.id, body.userId),
        inArray(userCompaniesTable.companyId, [companyId, req.session.companyId!])))
      .limit(1);
    if (!user) {
      res.status(404).json({ error: "INVALID_REFERENCE", message: "المستخدم غير موجود" });
      return;
    }

    const inserted = await db.transaction(async (tx) => {
      await lockApprovalAuthorityWrite(tx);
      // Serialize role changes/removals for this tenant, preserving at least
      // one active owner. A company-local admin cannot change another tenant's
      // default landing preference for a shared identity.
      await tx.select({ id: companiesTable.id }).from(companiesTable)
        .where(eq(companiesTable.id, companyId)).for("update");
      const [foreignMembership] = await tx.select({ id: userCompaniesTable.id }).from(userCompaniesTable)
        .where(and(eq(userCompaniesTable.userId, body.userId),
          ne(userCompaniesTable.companyId, companyId))).limit(1);
      if (body.isDefault && foreignMembership && body.userId !== req.session.userId) {
        throw Object.assign(new Error("لا يمكن تغيير الشركة الافتراضية لهوية مشتركة نيابة عن صاحبها"), { status: 403 });
      }
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
        if (existing.role === "owner" && body.role !== "owner") {
          await assertAnotherActiveOwner(tx, companyId, body.userId);
        }
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

      await db.transaction(async (tx) => {
        await lockApprovalAuthorityWrite(tx);
        await tx.select({ id: companiesTable.id }).from(companiesTable)
          .where(eq(companiesTable.id, companyId)).for("update");
      await requireAdministrative(companyId,req.session.userId!,"settings",tx);
        const [existing] = await tx.select().from(userCompaniesTable)
          .where(and(eq(userCompaniesTable.userId, userId), eq(userCompaniesTable.companyId, companyId))).limit(1);
        if (!existing) {
          throw Object.assign(new Error("لا يوجد ربط بين المستخدم والشركة"), { status: 404 });
        }
        await assertAnotherActiveOwner(tx, companyId, userId);
        const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` }).from(userCompaniesTable)
          .where(eq(userCompaniesTable.companyId, companyId));
        if (Number(count) <= 1) {
          throw Object.assign(new Error("لا يمكن إزالة آخر مستخدم في الشركة"), { status: 409 });
        }
        await tx.delete(userCompaniesTable).where(eq(userCompaniesTable.id, existing.id));
      });

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
