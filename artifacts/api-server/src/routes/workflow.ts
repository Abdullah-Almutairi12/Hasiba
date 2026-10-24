import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import {
  db,
  approvalRulesTable,
  approvalStepsTable,
  approvalRequestsTable,
  approvalActionsTable,
  approverDelegationsTable,
  financialLimitsTable,
  automationRulesTable,
  automationRunsTable,
  notificationInboxTable,
  usersTable,
  userCompaniesTable,
  companiesTable,
} from "@workspace/db";
import { and, asc, desc, eq, sql, or, isNull, inArray, lt, gt } from "drizzle-orm";
import { adminGuard } from "../middlewares/require-role";
import { actOnApproval, checkFinancialLimit, resolveApprovers } from "../lib/workflow-engine";
import { frozenApprovalPolicy } from "../lib/approval-policy";
import { approvalViewer } from "../lib/workflow-notifications";
import { recordAudit } from "../lib/audit";
import { isPublishedBootstrapPassword } from "../lib/bootstrap-password";
import { assertCompanyBranch, branchScope } from "../lib/company-access";
import { assertWorkflowMember } from "../lib/workflow-access";
import { handleRouteError } from "../lib/handle-error";
import { FINANCIAL_DEFAULTS, FINANCIAL_ACTIONS, financialPolicy } from "../lib/financial-policy";
import { ALL_ROLES } from "../middlewares/require-role";
import { AutomationDefinition, assertAutomationAdministrator, automationVisibility } from "../lib/workflow-automation";
import { canReadNotification } from "../lib/workflow-notifications";
import type { DbOrTx } from "../lib/journal-posting";

const router = Router();

function isAdmin(req: { session?: { role?: string } }): boolean {
  const r = req.session?.role;
  return r === "owner" || r === "manager";
}

router.use("/workflow/approval-rules/:id", async (req, res, next) => {
  if (!Number.isSafeInteger(Number(req.params.id)) || Number(req.params.id) <= 0) {
    res.status(400).json({ error: "معرف غير صحيح" }); return;
  }
  const [owned] = await db.select({ id: approvalRulesTable.id }).from(approvalRulesTable)
    .where(and(eq(approvalRulesTable.id, Number(req.params.id)),
      eq(approvalRulesTable.companyId, req.session.companyId!),
      or(isNull(approvalRulesTable.branchId), branchScope(approvalRulesTable.branchId, req.session.companyId!))));
  if (!owned) { res.status(404).json({ error: "قاعدة الاعتماد غير متاحة" }); return; }
  next();
});

router.use("/workflow/approval-requests/:id", async (req, res, next) => {
  if (!Number.isSafeInteger(Number(req.params.id)) || Number(req.params.id) <= 0) {
    res.status(400).json({ error: "معرف غير صحيح" }); return;
  }
  const [owned] = await db.select({ id: approvalRequestsTable.id }).from(approvalRequestsTable)
    .where(and(eq(approvalRequestsTable.id, Number(req.params.id)),
      eq(approvalRequestsTable.companyId, req.session.companyId!),
      or(isNull(approvalRequestsTable.branchId), branchScope(approvalRequestsTable.branchId, req.session.companyId!))));
  if (!owned) { res.status(404).json({ error: "طلب الاعتماد غير متاح" }); return; }
  next();
});

async function validateRuleMembers(companyId: number, body: {
  branchId?: number | null; steps?: Array<{ approverUserId?: number | null }>;
}) {
  if (body.branchId != null) await assertCompanyBranch(body.branchId, companyId);
  for (const step of body.steps ?? []) {
    if (step.approverUserId != null) await assertWorkflowMember(companyId, step.approverUserId);
  }
}

// --------------------------------------------------------------------------
// Approval Rules (admin/manager only — read & write)
// --------------------------------------------------------------------------
router.get("/workflow/approval-rules", adminGuard, async (req, res) => {
  const rules = await db
    .select()
    .from(approvalRulesTable)
    .where(and(eq(approvalRulesTable.companyId, req.session.companyId!),
      or(isNull(approvalRulesTable.branchId), branchScope(approvalRulesTable.branchId, req.session.companyId!))))
    .orderBy(asc(approvalRulesTable.docType), asc(approvalRulesTable.minAmount));
  const ids = rules.map((r) => r.id);
  const steps = ids.length
    ? await db
        .select()
        .from(approvalStepsTable)
        .where(inArray(approvalStepsTable.ruleId, ids))
        .orderBy(asc(approvalStepsTable.ruleId), asc(approvalStepsTable.sequence))
    : [];
  const stepsByRule = new Map<number, typeof steps>();
  for (const s of steps) {
    const arr = stepsByRule.get(s.ruleId) ?? [];
    arr.push(s);
    stepsByRule.set(s.ruleId, arr);
  }
  res.json(
    rules.map((r) => ({
      ...r,
      minAmount: Number(r.minAmount),
      maxAmount: r.maxAmount == null ? null : Number(r.maxAmount),
      createdAt: r.createdAt.toISOString(),
      steps: (stepsByRule.get(r.id) ?? []).map((s) => ({
        ...s,
        minAmount: Number(s.minAmount),
      })),
    })),
  );
});

const StepSchema = z.object({
  sequence: z.number().int().min(1),
  approverRole: z.string().min(1),
  approverUserId: z.number().int().nullish(),
  minAmount: z.number().min(0).default(0),
});

const RuleBody = z.object({
  name: z.string().min(1),
  docType: z.enum([
    "purchase_order",
    "sales_order",
    "expense_claim",
    "leave_request",
    "journal_entry",
    "credit_note",
    "credit_note_cancel",
    "payment_run",
  ]),
  branchId: z.number().int().nullish(),
  minAmount: z.number().min(0).default(0),
  maxAmount: z.number().nullish(),
  mode: z.enum(["sequential", "parallel"]).default("sequential"),
  isActive: z.boolean().default(true),
  steps: z.array(StepSchema).min(1),
});

router.post("/workflow/approval-rules", adminGuard, async (req, res) => {
  try {
    const body = RuleBody.parse(req.body);
    await validateRuleMembers(req.session.companyId!, body);
    const out = await db.transaction(async (tx) => {
      const [rule] = await tx
        .insert(approvalRulesTable)
        .values({
          companyId: req.session.companyId!,
          name: body.name,
          docType: body.docType,
          branchId: body.branchId ?? null,
          minAmount: String(body.minAmount),
          maxAmount: body.maxAmount == null ? null : String(body.maxAmount),
          mode: body.mode,
          isActive: body.isActive,
        })
        .returning();
      for (const s of body.steps) {
        await tx.insert(approvalStepsTable).values({
          ruleId: rule.id,
          sequence: s.sequence,
          approverRole: s.approverRole,
          approverUserId: s.approverUserId ?? null,
          minAmount: String(s.minAmount),
        });
      }
      return rule;
    });
    void recordAudit(req, { action: "create", entity: "approval_rule", details: out.name });
    res.status(201).json({ id: out.id });
  } catch (err) {
    req.log.error({ err }, "create approval rule failed");
    handleRouteError(err, res);
  }
});

router.patch("/workflow/approval-rules/:id", adminGuard, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const body = RuleBody.partial().parse(req.body);
    await validateRuleMembers(req.session.companyId!, body);
    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.docType !== undefined) updates.docType = body.docType;
    if (body.branchId !== undefined) updates.branchId = body.branchId;
    if (body.minAmount !== undefined) updates.minAmount = String(body.minAmount);
    if (body.maxAmount !== undefined) updates.maxAmount = body.maxAmount == null ? null : String(body.maxAmount);
    if (body.mode !== undefined) updates.mode = body.mode;
    if (body.isActive !== undefined) updates.isActive = body.isActive;
    await db.transaction(async (tx) => {
      await tx.select({ id: approvalRulesTable.id }).from(approvalRulesTable)
        .where(and(eq(approvalRulesTable.id, id), eq(approvalRulesTable.companyId, req.session.companyId!))).for("update");
      const [used] = await tx.select({ id: approvalRequestsTable.id }).from(approvalRequestsTable)
        .where(eq(approvalRequestsTable.ruleId, id)).limit(1);
      if (used && Object.keys(body).some(key => key !== "isActive")) {
        throw Object.assign(new Error("قاعدة مستخدمة تاريخيًا؛ أنشئ قاعدة جديدة بدل تغيير سلسلة اعتماد قائمة"), { status: 409 });
      }
      if (Object.keys(updates).length) {
        await tx.update(approvalRulesTable).set(updates).where(and(eq(approvalRulesTable.id, id),
          eq(approvalRulesTable.companyId, req.session.companyId!)));
      }
      if (body.steps) {
        await tx.delete(approvalStepsTable).where(eq(approvalStepsTable.ruleId, id));
        for (const s of body.steps) {
          await tx.insert(approvalStepsTable).values({
            ruleId: id, sequence: s.sequence, approverRole: s.approverRole,
            approverUserId: s.approverUserId ?? null, minAmount: String(s.minAmount),
          });
        }
      }
    });
    res.json({ ok: true });
  } catch (err) {
    handleRouteError(err, res);
  }
});

router.delete("/workflow/approval-rules/:id", adminGuard, async (req, res) => {
  const id = Number(req.params.id);
  try {
    await db.transaction(async (tx) => {
      await tx.select({ id: approvalRulesTable.id }).from(approvalRulesTable)
        .where(and(eq(approvalRulesTable.id, id), eq(approvalRulesTable.companyId, req.session.companyId!))).for("update");
      const [used] = await tx.select({ id: approvalRequestsTable.id }).from(approvalRequestsTable)
        .where(eq(approvalRequestsTable.ruleId, id)).limit(1);
      if (used) throw Object.assign(new Error("لا تحذف قاعدة مرتبطة بسجل اعتماد؛ يمكن تعطيلها للمستقبل"), { status: 409 });
      await tx.delete(approvalRulesTable).where(and(eq(approvalRulesTable.id, id),
        eq(approvalRulesTable.companyId, req.session.companyId!)));
    });
    res.json({ ok: true });
  } catch (error) { handleRouteError(error, res); }
});

// --------------------------------------------------------------------------
// Approval Requests — visible to admins, the submitter, and any user who is
// an approver (directly, by role, or by active delegation) on a step.
// --------------------------------------------------------------------------
async function userCanSeeRequest(
  userId: number | null,
  _userRole: string | undefined,
  request: typeof approvalRequestsTable.$inferSelect,
  companyId: number,
): Promise<boolean> {
  if (request.companyId !== companyId) return false;
  if (userId == null) return false;
  const viewer = await approvalViewer(userId, request);
  if (!viewer) return false;
  if (viewer.role === "owner" || viewer.role === "manager") return true;
  if (request.submittedByUserId === userId) return true;
  // Materialize the step list. For rule-based requests we read
  // approval_steps; for forced/ad-hoc requests (ruleId = null, used by
  // e.g. SO credit-limit gating) the synthesized chain lives in
  // approval_requests.forced_steps. Both paths must surface visibility
  // to the actual approvers (and their delegates), otherwise approvers
  // get notified into /inbox?request=N but receive 403 on detail.
  const steps: Array<{ approverUserId: number | null; approverRole: string | null }> =
    frozenApprovalPolicy(request)?.steps ?? (request.ruleId != null
      ? await db
          .select({
            approverUserId: approvalStepsTable.approverUserId,
            approverRole: approvalStepsTable.approverRole,
          })
          .from(approvalStepsTable)
          .where(eq(approvalStepsTable.ruleId, request.ruleId))
      : (((request.forcedSteps as Array<{
          approverRole: string;
          approverUserId: number | null;
        }> | null) ?? []).map((s) => ({
          approverUserId: s.approverUserId,
          approverRole: s.approverRole,
        }))));
  if (steps.length === 0) return false;
  for (const s of steps) {
    const recipients = await resolveApprovers(s.approverRole ?? "", s.approverUserId, request.branchId, companyId);
    if (recipients.includes(userId)) return true;
  }
  return false;
}

router.get("/workflow/approval-requests", async (req, res) => {
  const userId = req.session?.userId ?? null;
  const userRole = req.session?.role;
  if (!userId) return res.status(401).json({ error: "غير مسجل دخول" });
  const status = req.query.status ? String(req.query.status) : undefined;
  const docType = req.query.docType ? String(req.query.docType) : undefined;
  const where = and(
    eq(approvalRequestsTable.companyId, req.session.companyId!),
    or(isNull(approvalRequestsTable.branchId), branchScope(approvalRequestsTable.branchId, req.session.companyId!)),
    or(isNull(approvalRequestsTable.ruleId), inArray(approvalRequestsTable.ruleId,
      db.select({ id: approvalRulesTable.id }).from(approvalRulesTable).where(eq(approvalRulesTable.companyId, req.session.companyId!)))),
    status ? eq(approvalRequestsTable.status, status) : sql`true`,
    docType ? eq(approvalRequestsTable.docType, docType) : sql`true`,
  );
  const rows = await db
    .select()
    .from(approvalRequestsTable)
    .where(where)
    .orderBy(desc(approvalRequestsTable.createdAt))
    .limit(200);
  const visible: typeof rows = [];
  for (const r of rows) {
    if (await userCanSeeRequest(userId, userRole, r, req.session.companyId!)) visible.push(r);
  }
  return res.json(
    visible.map((r) => ({
      ...r,
      amount: Number(r.amount),
      policyRevision: frozenApprovalPolicy(r)?.revision ?? null,
      policyReviewRequired: r.policySnapshot == null || r.reviewInvalidatedAt != null,
      createdAt: r.createdAt.toISOString(),
      decidedAt: r.decidedAt?.toISOString() ?? null,
    })),
  );
});

router.get("/workflow/approval-requests/:id", async (req, res) => {
  const userId = req.session?.userId ?? null;
  const userRole = req.session?.role;
  if (!userId) return res.status(401).json({ error: "غير مسجل دخول" });
  const id = Number(req.params.id);
  const [request] = await db
    .select()
    .from(approvalRequestsTable)
    .where(and(eq(approvalRequestsTable.id, id), eq(approvalRequestsTable.companyId, req.session.companyId!)));
  if (!request) return res.status(404).json({ error: "not found" });
  if (request.ruleId) {
    const [rule] = await db.select({ id: approvalRulesTable.id }).from(approvalRulesTable)
      .where(and(eq(approvalRulesTable.id, request.ruleId), eq(approvalRulesTable.companyId, req.session.companyId!)));
    if (!rule) { res.status(404).json({ error: "قاعدة الاعتماد غير متاحة" }); return; }
  }
  if (!(await userCanSeeRequest(userId, userRole, request, req.session.companyId!))) {
    return res.status(403).json({ error: "ليست لديك صلاحية لعرض هذا الطلب" });
  }
  // For rule-based requests, return the configured steps. For forced
  // requests (ruleId = null) the engine persists the synthesized chain
  // on approval_requests.forced_steps; surface that here so the inbox
  // detail view can render the full approval chain and history for
  // ad-hoc approvals (e.g. SO credit-limit forced routing).
  const policy = frozenApprovalPolicy(request);
  const steps = policy?.steps ?? (request.ruleId
    ? await db
        .select()
        .from(approvalStepsTable)
        .where(eq(approvalStepsTable.ruleId, request.ruleId))
        .orderBy(asc(approvalStepsTable.sequence))
    : (((request.forcedSteps as Array<{
        sequence: number;
        approverRole: string;
        approverUserId: number | null;
      }> | null) ?? []).map((s) => ({
        id: -s.sequence,
        ruleId: -1,
        sequence: s.sequence,
        approverRole: s.approverRole,
        approverUserId: s.approverUserId,
        minAmount: "0",
      }))));
  const actions = await db
    .select()
    .from(approvalActionsTable)
    .where(eq(approvalActionsTable.requestId, id))
    .orderBy(asc(approvalActionsTable.actedAt));
  return res.json({
    ...request,
    amount: Number(request.amount),
    policyRevision: policy?.revision ?? null,
    policyReviewRequired: !policy || request.reviewInvalidatedAt != null,
    createdAt: request.createdAt.toISOString(),
    decidedAt: request.decidedAt?.toISOString() ?? null,
    steps: steps.map((s) => ({ ...s, minAmount: Number(s.minAmount) })),
    actions: actions.map((a) => ({ ...a, actedAt: a.actedAt.toISOString() })),
  });
});

const ActBody = z.object({
  action: z.enum(["approve", "reject", "request_changes", "comment"]),
  comment: z.string().nullish(),
});

router.post("/workflow/approval-requests/:id/act", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const body = ActBody.parse(req.body);
    const userId = req.session.userId ?? null;
    const userName = (req.session as { userName?: string }).userName ?? null;
    const out = await actOnApproval(id, userId, userName, body.action, req.session.companyId!, body.comment ?? undefined);
    void recordAudit(req, {
      action: body.action,
      entity: "approval_request",
      details: `#${id}`,
    });
    res.json(out);
  } catch (err) {
    handleRouteError(err, res);
  }
});

// --------------------------------------------------------------------------
// Delegations — admins see all; regular users see only their own (incoming or
// outgoing). Non-admins may only create/delete delegations FROM themselves.
// --------------------------------------------------------------------------
router.get("/workflow/delegations", async (req, res) => {
  const userId = req.session?.userId ?? null;
  if (!userId) return res.status(401).json({ error: "غير مسجل دخول" });
  const where = isAdmin(req)
    ? sql`true`
    : sql`${approverDelegationsTable.fromUserId} = ${userId} OR ${approverDelegationsTable.toUserId} = ${userId}`;
  const rows = await db
    .select()
    .from(approverDelegationsTable)
    .where(and(eq(approverDelegationsTable.companyId, req.session.companyId!), where))
    .orderBy(desc(approverDelegationsTable.createdAt));
  return res.json(
    rows.map((r) => ({
      ...r,
      fromDate: r.fromDate.toISOString(),
      toDate: r.toDate.toISOString(),
      createdAt: r.createdAt.toISOString(),
    })),
  );
});

const DelegationBody = z.object({
  fromUserId: z.number().int().positive(),
  toUserId: z.number().int().positive(),
  fromDate: z.string().datetime({ offset: true }),
  toDate: z.string().datetime({ offset: true }),
  reason: z.string().nullish(),
}).refine(body => body.fromUserId !== body.toUserId && Date.parse(body.toDate) > Date.parse(body.fromDate),
  "يلزم مفوض مختلف وفترة زمنية صحيحة");

router.post("/workflow/delegations", async (req, res) => {
  try {
    const userId = req.session?.userId ?? null;
    if (!userId) return res.status(401).json({ error: "غير مسجل دخول" });
    const body = DelegationBody.parse(req.body);
    if (!isAdmin(req) && body.fromUserId !== userId) {
      return res.status(403).json({
        error: "يمكنك تفويض صلاحياتك أنت فقط",
      });
    }
    await assertWorkflowMember(req.session.companyId!, body.fromUserId);
    await assertWorkflowMember(req.session.companyId!, body.toUserId);
    const created = await db.transaction(async (tx) => {
      await tx.select({ id: companiesTable.id }).from(companiesTable)
        .where(eq(companiesTable.id, req.session.companyId!)).for("update");
      const [overlap] = await tx.select({ id: approverDelegationsTable.id }).from(approverDelegationsTable)
        .where(and(eq(approverDelegationsTable.companyId, req.session.companyId!),
          eq(approverDelegationsTable.fromUserId, body.fromUserId),
          lt(approverDelegationsTable.fromDate, new Date(body.toDate)),
          gt(approverDelegationsTable.toDate, new Date(body.fromDate)))).limit(1);
      if (overlap) throw Object.assign(new Error("يوجد تفويض متداخل لهذا العضو في الشركة"), { status: 409 });
      const [row] = await tx.insert(approverDelegationsTable).values({
        companyId: req.session.companyId!, fromUserId: body.fromUserId, toUserId: body.toUserId,
        fromDate: new Date(body.fromDate), toDate: new Date(body.toDate), reason: body.reason ?? null,
      }).returning();
      return row;
    });
    void recordAudit(req, { action: "create", entity: "approver_delegation", details: `${body.fromUserId}→${body.toUserId}` });
    return res.status(201).json({ id: created.id });
  } catch (err) {
    return handleRouteError(err, res);
  }
});

router.delete("/workflow/delegations/:id", async (req, res) => {
  const userId = req.session?.userId ?? null;
  if (!userId) return res.status(401).json({ error: "غير مسجل دخول" });
  const id = Number(req.params.id);
  const [existing] = await db
    .select()
    .from(approverDelegationsTable)
    .where(and(eq(approverDelegationsTable.id, id), eq(approverDelegationsTable.companyId, req.session.companyId!)));
  if (!existing) return res.status(404).json({ error: "not found" });
  if (!isAdmin(req) && existing.fromUserId !== userId) {
    return res.status(403).json({ error: "يمكنك حذف تفويضاتك أنت فقط" });
  }
  await db.delete(approverDelegationsTable).where(eq(approverDelegationsTable.id, id));
  void recordAudit(req, { action: "delete", entity: "approver_delegation", details: `#${id}` });
  return res.json({ ok: true });
});

// --------------------------------------------------------------------------
// Financial Limits
// --------------------------------------------------------------------------
router.get("/workflow/financial-limits", adminGuard, async (req, res) => {
  const rows = await db
    .select()
    .from(financialLimitsTable)
    .where(eq(financialLimitsTable.companyId, req.session.companyId!))
    .orderBy(asc(financialLimitsTable.actionKey), asc(financialLimitsTable.role));
  const defaults = await Promise.all(FINANCIAL_DEFAULTS.filter(([role, key]) => !rows.some(x => x.role === role && x.actionKey === key))
    .map(async ([role, actionKey], i) => {
      const policy = await financialPolicy(req.session.companyId!, role, actionKey);
      return { id: -1 - i, companyId: req.session.companyId, role, actionKey, maxValue: policy.max,
        description: policy.blocked ? "موقوف حتى إعادة التهيئة — سياسة قديمة مجهولة المالك" : "سياسة النظام الأساسية — التخصيص محفوظ للشركة فقط",
        updatedAt: "1970-01-01T00:00:00.000Z", source: policy.source };
    }));
  res.json([
    ...defaults, ...rows.map((r) => ({
      ...r,
      source: "company",
      maxValue: r.maxValue == null ? null : Number(r.maxValue),
      updatedAt: r.updatedAt.toISOString(),
    })),
  ]);
});

const LimitBody = z.object({
  role: z.enum(ALL_ROLES),
  actionKey: z.enum(FINANCIAL_ACTIONS),
  maxValue: z.number().finite().min(0).max(9999999999999).multipleOf(0.01).nullable(),
  description: z.string().nullish(),
}).refine(x => x.actionKey !== "pos.discount_pct" || x.maxValue == null || x.maxValue <= 100, "الخصم لا يتجاوز 100%");

router.post("/workflow/financial-limits", adminGuard, async (req, res) => {
  try {
    const actor = await assertAutomationAdministrator(req.session.companyId!, req.session.userId!);
    if (actor.branches != null) {
      res.status(403).json({ error: "تعديل حدود الشركة يتطلب صلاحية على الشركة كاملة" });
      return;
    }
    const body = LimitBody.parse(req.body);
    await db
      .insert(financialLimitsTable)
      .values({
        companyId: req.session.companyId!,
        role: body.role,
        actionKey: body.actionKey,
        maxValue: body.maxValue == null ? null : String(body.maxValue),
        description: body.description ?? null,
      })
      .onConflictDoUpdate({
        target: [financialLimitsTable.companyId, financialLimitsTable.role, financialLimitsTable.actionKey],
        set: {
          maxValue: body.maxValue == null ? null : String(body.maxValue),
          description: body.description ?? null,
          updatedAt: new Date(),
        },
      });
    await recordAudit(req, { action: "configure", entity: "financial_limit", details: JSON.stringify(body) });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "خطأ" });
  }
});

router.get("/workflow/financial-limits/check", async (req, res) => {
  const actionKey = String(req.query.actionKey ?? "");
  const value = Number(req.query.value ?? 0);
  if (!actionKey || !Number.isFinite(value) || value < 0) return res.status(400).json({ error: "actionKey/value invalid" });
  const r = await checkFinancialLimit(req.session.companyId!, req.session.userId!, actionKey, value);
  return res.json(r);
});

// --------------------------------------------------------------------------
// Automation Rules
// --------------------------------------------------------------------------
router.get("/workflow/automation-rules", adminGuard, async (req, res) => {
  const actor = await assertAutomationAdministrator(req.session.companyId!, req.session.userId!);
  const rows = await db
    .select()
    .from(automationRulesTable)
    .where(and(eq(automationRulesTable.companyId, req.session.companyId!), automationVisibility(actor)))
    .orderBy(desc(automationRulesTable.createdAt));
  res.json(
    rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      lastRunAt: r.lastRunAt?.toISOString() ?? null,
    })),
  );
});

router.use("/workflow/automation-rules/:id", async (req, res, next) => {
  const actor = await assertAutomationAdministrator(req.session.companyId!, req.session.userId!);
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: "معرّف غير صحيح" });
  const [rule] = await db.select({ id: automationRulesTable.id }).from(automationRulesTable).where(and(
    eq(automationRulesTable.id, id), eq(automationRulesTable.companyId, req.session.companyId!), automationVisibility(actor),
  ));
  if (!rule) return res.status(404).json({ error: "غير موجود" });
  await assertAutomationAdministrator(req.session.companyId!, req.session.userId!);
  return next();
});
const AutomationBody = z.object({
  name: z.string().min(1),
  description: z.string().nullish(),
  trigger: z.object({
    type: z.enum(["record_created", "record_updated", "state_changed", "scheduled"]),
    entity: z.string().nullish(),
    state: z.string().nullish(),
    intervalMinutes: z.number().int().min(1).nullish(),
  }),
  conditions: z
    .array(
      z.object({
        field: z.string(),
        op: z.enum(["eq", "ne", "gt", "lt", "gte", "lte", "contains"]),
        value: z.unknown(),
      }),
    )
    .default([]),
  actions: z.array(z.record(z.string(), z.unknown())).default([]),
  isActive: z.boolean().default(true),
});

router.post("/workflow/automation-rules", adminGuard, async (req, res) => {
  try {
    const body = AutomationBody.parse(req.body);
    AutomationDefinition.parse(body);
    const actor = await assertAutomationAdministrator(req.session.companyId!, req.session.userId!);
    const [created] = await db
      .insert(automationRulesTable)
      .values({
        companyId: req.session.companyId!,
        branchIds: actor.branches,
        name: body.name,
        description: body.description ?? null,
        trigger: body.trigger,
        conditions: body.conditions,
        actions: body.actions,
        isActive: body.isActive,
        createdByUserId: req.session.userId ?? null,
      })
      .returning();
    void recordAudit(req, { action: "create", entity: "automation_rule", details: created.name });
    res.status(201).json({ id: created.id });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "خطأ" });
  }
});

router.patch("/workflow/automation-rules/:id", adminGuard, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const body = AutomationBody.partial().parse(req.body);
    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.description !== undefined) updates.description = body.description;
    if (body.trigger !== undefined) updates.trigger = body.trigger;
    if (body.conditions !== undefined) updates.conditions = body.conditions;
    if (body.actions !== undefined) updates.actions = body.actions;
    if (body.isActive !== undefined) updates.isActive = body.isActive;
    await db.transaction(async tx => {
      const actor = await assertAutomationAdministrator(req.session.companyId!, req.session.userId!, tx);
      const [rule] = await tx.select().from(automationRulesTable).where(and(
        eq(automationRulesTable.id, id), eq(automationRulesTable.companyId, req.session.companyId!), automationVisibility(actor),
      )).for("update");
      if (!rule) throw new Error("غير موجود");
      AutomationDefinition.parse({ ...rule, ...updates });
      // Updating a rule does not silently replace its owner with a different
      // company. It does transfer execution responsibility to this local editor.
      await tx.update(automationRulesTable).set({ ...updates, createdByUserId: req.session.userId! })
        .where(and(eq(automationRulesTable.id, id), eq(automationRulesTable.companyId, req.session.companyId!)));
    });
    await recordAudit(req, { action: "update", entity: "automation_rule", details: `#${id}` });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "خطأ" });
  }
});

router.delete("/workflow/automation-rules/:id", adminGuard, async (req, res) => {
  const actor = await assertAutomationAdministrator(req.session.companyId!, req.session.userId!);
  const removed = await db.transaction(async tx => {
    const [rule] = await tx.select().from(automationRulesTable).where(and(
      eq(automationRulesTable.id, Number(req.params.id)), eq(automationRulesTable.companyId, req.session.companyId!), automationVisibility(actor),
    )).for("update");
    if (!rule) return false;
    const [run] = await tx.select({ id: automationRunsTable.id }).from(automationRunsTable).where(eq(automationRunsTable.ruleId, rule.id)).limit(1);
    if (run) return false;
    await tx.delete(automationRulesTable).where(and(eq(automationRulesTable.id, rule.id), eq(automationRulesTable.companyId, req.session.companyId!)));
    return true;
  });
  if (!removed) return res.status(409).json({ error: "للقاعدة سجل تنفيذ محفوظ؛ أوقفها بدل حذفها" });
  await recordAudit(req, { action: "delete", entity: "automation_rule", details: `#${req.params.id}` });
  return res.json({ ok: true });
});

router.get("/workflow/automation-runs", adminGuard, async (req, res) => {
  const actor = await assertAutomationAdministrator(req.session.companyId!, req.session.userId!);
  const ruleId = req.query.ruleId ? Number(req.query.ruleId) : null;
  const rows = await db
    .select()
    .from(automationRunsTable)
    .where(and(eq(automationRunsTable.companyId, req.session.companyId!),
      inArray(automationRunsTable.ruleId, db.select({ id: automationRulesTable.id }).from(automationRulesTable)
        .where(and(eq(automationRulesTable.companyId, req.session.companyId!), automationVisibility(actor)))),
      ruleId ? eq(automationRunsTable.ruleId, ruleId) : sql`true`))
    .orderBy(desc(automationRunsTable.triggeredAt))
    .limit(100);
  res.json(rows.map((r) => ({ ...r, triggeredAt: r.triggeredAt.toISOString() })));
});

// --------------------------------------------------------------------------
// Notification Inbox
// --------------------------------------------------------------------------
async function visibleInbox(companyId: number, userId: number, connection: DbOrTx = db) {
  await assertWorkflowMember(companyId, userId, connection);
  const all = await connection.select().from(notificationInboxTable).where(and(
    eq(notificationInboxTable.companyId, companyId), eq(notificationInboxTable.userId, userId),
  )).orderBy(desc(notificationInboxTable.createdAt));
  const visible = [];
  for (const row of all) if (await canReadNotification(userId, row, connection)) visible.push(row);
  return visible;
}
router.get("/workflow/inbox/unread-count", async (req, res) => {
  const rows = await visibleInbox(req.session.companyId!, req.session.userId!);
  return res.json({ count: rows.filter(r => !r.isRead).length });
});
router.get("/workflow/inbox", async (req, res) => {
  const userId = req.session.userId;
  if (!userId) return res.status(401).json({ error: "غير مصرّح" });
  const onlyUnread = req.query.unread === "true";
  const rows = (await visibleInbox(req.session.companyId!, userId)).filter(r => !onlyUnread || !r.isRead).slice(0, 50);
  return res.json(rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })));
});

router.patch("/workflow/inbox/:id/read", async (req, res) => {
  const userId = req.session.userId;
  if (!userId) return res.status(401).json({ error: "غير مصرّح" });
  const found = await db.transaction(async tx => {
    const rows = await visibleInbox(req.session.companyId!, userId, tx);
    const row = rows.find(r => r.id === Number(req.params.id));
    if (!row) return false;
    await tx.update(notificationInboxTable).set({ isRead: true }).where(and(
      eq(notificationInboxTable.id, row.id), eq(notificationInboxTable.userId, userId),
      eq(notificationInboxTable.companyId, req.session.companyId!),
    ));
    return true;
  });
  if (!found) return res.status(404).json({ error: "غير موجود" });
  return res.json({ ok: true });
});

router.post("/workflow/inbox/mark-all-read", async (req, res) => {
  const userId = req.session.userId;
  if (!userId) return res.status(401).json({ error: "غير مصرّح" });
  await db.transaction(async tx => {
    const rows = await visibleInbox(req.session.companyId!, userId, tx);
    if (rows.length) await tx.update(notificationInboxTable).set({ isRead: true }).where(and(
      eq(notificationInboxTable.userId, userId), eq(notificationInboxTable.companyId, req.session.companyId!),
      inArray(notificationInboxTable.id, rows.map(r => r.id)),
    ));
  });
  return res.json({ ok: true });
});

// --------------------------------------------------------------------------
// Roles / users helper for the admin builder
// --------------------------------------------------------------------------
// Available to any authenticated user so non-admin approvers (e.g. the
// accountant) can pick a delegate from the user list when configuring
// their own vacation delegation on /inbox. The list itself is non-
// sensitive (active users + roles only).
router.get("/workflow/approver-candidates", async (req, res) => {
  // Authenticated only — exposes (id, name, role) of active users so any
  // approver can pick a delegate. Not gated by adminGuard so non-admins
  // can self-configure delegations from /inbox.
  if (!req.session?.userId) {
    res.status(401).json({ error: "غير مصرح" });
    return;
  }
  const rows = await db
    .select({ id: usersTable.id, name: usersTable.name, role: userCompaniesTable.role })
    .from(usersTable)
    .innerJoin(userCompaniesTable, eq(userCompaniesTable.userId, usersTable.id))
    .where(and(eq(usersTable.isActive, true), eq(userCompaniesTable.companyId, req.session.companyId!)))
    .orderBy(asc(usersTable.name));
  res.json(rows);
});

// --------------------------------------------------------------------------
// Manager PIN verification — used by POS for void/refund overrides and any
// other on-site dual-authorization need. The cashier (or any non-manager
// user) calls this endpoint with a manager's email + password; if the
// supplied credentials match an active manager/owner user, we return 200
// and an audit row is recorded. We deliberately do NOT create a session
// for that user — the cashier remains logged in, and the override is
// captured as an `overrideUserId` that the calling route can stamp onto
// the underlying transaction.
// --------------------------------------------------------------------------
const VerifyPinBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  reason: z.string().trim().min(1).max(500).optional(),
});

// Hard rate-limit on this endpoint to defend against online brute-force
// of manager/owner passwords. 10 attempts per 15 minutes per (IP, target
// email). Authenticated only — the global requireAuth already gates this
// router — so anonymous floods are not possible to begin with.
const verifyPinLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const ip = ipKeyGenerator(req.ip ?? "");
    const email = typeof req.body?.email === "string" ? String(req.body.email).toLowerCase() : "";
    return `verify-pin:${ip}:${email}`;
  },
  message: { error: "محاولات كثيرة. حاول مرة أخرى بعد قليل." },
});

router.post("/approvals/verify-pin", verifyPinLimiter, async (req, res) => {
  if (!req.session?.userId) {
    res.status(401).json({ error: "غير مصرح" });
    return;
  }
  const parsed = VerifyPinBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "بيانات غير صالحة", details: parsed.error.issues });
    return;
  }
  const { email, password, reason } = parsed.data;
  if (isPublishedBootstrapPassword(password)) {
    res.status(401).json({ error: "بيانات المدير غير صحيحة" });
    return;
  }
  const [user] = await db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      passwordHash: usersTable.passwordHash,
      role: userCompaniesTable.role,
    })
    .from(usersTable)
    .innerJoin(userCompaniesTable, eq(userCompaniesTable.userId, usersTable.id))
    .innerJoin(companiesTable, eq(companiesTable.id, userCompaniesTable.companyId))
    .where(and(eq(usersTable.email, email.toLowerCase().trim()), eq(usersTable.isActive, true),
      eq(userCompaniesTable.companyId, req.session.companyId!), eq(companiesTable.isActive, true)));
  if (!user || !user.passwordHash) {
    res.status(401).json({ error: "بيانات المدير غير صحيحة" });
    return;
  }
  if (user.role !== "owner" && user.role !== "manager") {
    res.status(403).json({ error: "هذا المستخدم لا يملك صلاحية اعتماد التجاوز" });
    return;
  }
  // Self-override is forbidden — defeats the four-eyes principle.
  if (user.id === req.session.userId) {
    res.status(403).json({ error: "لا يمكنك اعتماد تجاوز لنفسك (مبدأ فصل المهام)" });
    return;
  }
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    res.status(401).json({ error: "بيانات المدير غير صحيحة" });
    return;
  }
  void recordAudit(req, {
    action: "override",
    entity: "approval_pin",
    details: `معتمد بواسطة ${user.name} (${user.email})${reason ? " — " + reason : ""}`,
  });
  res.json({ ok: true, overrideUserId: user.id, overrideUserName: user.name });
});

export default router;
