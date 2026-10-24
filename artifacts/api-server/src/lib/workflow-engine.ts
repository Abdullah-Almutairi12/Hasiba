import type { Request, Response, NextFunction } from "express";
import {
  db,
  approvalRulesTable,
  approvalStepsTable,
  approvalRequestsTable,
  approvalActionsTable,
  approverDelegationsTable,
  usersTable,
  userCompaniesTable,
  companiesTable,
} from "@workspace/db";
import { and, asc, desc, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import { logger } from "./logger";
import { recordAudit } from "./audit";
import { returnAuthorize, assertReturnSnapshot } from "./return-access";
import { assertCompanyBranch } from "./company-access";
import { assertWorkflowMember, workflowMember } from "./workflow-access";
import { financialPolicy } from "./financial-policy";
import { FinancialRequestError } from "./financial-transaction";
import { notify } from "./workflow-notifications";

// ---------------------------------------------------------------------------
// Document types known to the engine. Each module that wants to trigger an
// approval must call `registerOnApprove(docType, callback)` so that when the
// chain completes the engine can re-run the original confirmation logic.
// ---------------------------------------------------------------------------
export type DocType =
  | "purchase_order"
  | "sales_order"
  | "expense_claim"
  | "leave_request"
  | "journal_entry"
  | "credit_note"
  | "credit_note_cancel"
  | "payment_run"
  | "pos_over_limit";

type OnApproveHandler = (recordId: number, requestId: number) => Promise<void> | void;
type OnRejectHandler = (recordId: number, requestId: number, reason: "rejected" | "changes_requested") => Promise<void> | void;
const handlers = new Map<DocType, OnApproveHandler>();
const rejectHandlers = new Map<DocType, OnRejectHandler>();

export function registerOnApprove(docType: DocType, handler: OnApproveHandler): void {
  handlers.set(docType, handler);
}

export function registerOnReject(docType: DocType, handler: OnRejectHandler): void {
  rejectHandlers.set(docType, handler);
}

// ---------------------------------------------------------------------------
// Submit a record for approval. Returns:
//   { required: false } if no matching active rule — caller proceeds normally.
//   { required: true,  requestId, status: "pending" } if a request was opened.
//   { required: false, autoApproved: true } if rule matched but no steps.
// ---------------------------------------------------------------------------
export interface SubmitInput {
  companyId: number;
  /** Branchless legacy matrices have no provable company owner. */
  scopedBranchOnly?: boolean;
  docType: DocType;
  recordId: number;
  recordRef?: string | null;
  amount?: number;
  branchId?: number | null;
  submittedByUserId?: number | null;
  submittedByName?: string | null;
  notes?: string | null;
  /**
   * Force a fallback approval chain when no admin-configured rule matches.
   * Used by classic ERP gates (e.g. SO over credit limit) so a finance
   * approver still has to sign off even without a configured matrix.
   */
  forceRoles?: string[];
  forceReason?: string | null;
}

export interface SubmitResult {
  required: boolean;
  autoApproved?: boolean;
  requestId?: number;
  status?: string;
}

export async function submitForApproval(input: SubmitInput): Promise<SubmitResult> {
  if (!Number.isSafeInteger(input.companyId) || input.companyId <= 0) throw new Error("يلزم نطاق شركة للاعتماد");
  if (input.branchId != null) await assertCompanyBranch(input.branchId, input.companyId);
  if (input.submittedByUserId != null) await assertWorkflowMember(input.companyId, input.submittedByUserId);
  const amount = Number(input.amount ?? 0);
  if (!Number.isFinite(amount) || amount < 0) throw new Error("قيمة اعتماد غير صحيحة");
  // Find the most-specific active rule: same branch beats null branch,
  // tighter amount window beats wider. Take the highest min_amount that
  // still matches our amount, then highest specificity.
  const candidates = await db
    .select()
    .from(approvalRulesTable)
    .where(
      and(
        eq(approvalRulesTable.companyId, input.companyId),
        eq(approvalRulesTable.docType, input.docType),
        eq(approvalRulesTable.isActive, true),
        lte(approvalRulesTable.minAmount, String(amount)),
        or(isNull(approvalRulesTable.maxAmount), gt(approvalRulesTable.maxAmount, String(amount))),
      ),
    );
  // Branch matching:
  //   - rule.branchId == null  → global rule, applies to any document.
  //   - rule.branchId == X     → applies only when document.branchId === X.
  //     A document with no branchId never matches a branch-scoped rule.
  // Specificity: branch-specific rule beats global; within ties the
  // tightest min_amount wins.
  const matched = candidates
    .filter((r) => input.scopedBranchOnly ? r.branchId != null && r.branchId === input.branchId : r.branchId == null || r.branchId === input.branchId)
    .sort((a, b) => {
      const branchA = a.branchId === input.branchId && a.branchId != null ? 1 : 0;
      const branchB = b.branchId === input.branchId && b.branchId != null ? 1 : 0;
      if (branchA !== branchB) return branchB - branchA;
      return Number(b.minAmount) - Number(a.minAmount);
    })[0];

  if (!matched) {
    // Quarantine must not turn a previously required approval into a silent
    // exemption. Do not infer which tenant owns a legacy matrix.
    const [legacy] = await db.select({ id: approvalRulesTable.id }).from(approvalRulesTable).where(and(
      isNull(approvalRulesTable.companyId), eq(approvalRulesTable.docType, input.docType),
      eq(approvalRulesTable.isActive, true), lte(approvalRulesTable.minAmount, String(amount)),
      or(isNull(approvalRulesTable.maxAmount), gt(approvalRulesTable.maxAmount, String(amount))),
    )).limit(1);
    if (legacy) throw Object.assign(new Error("يلزم إعادة تهيئة سياسة الاعتماد للشركة؛ توجد سياسة قديمة مجهولة المالك"), { status: 409 });
    // No admin rule. If caller asked for a forced fallback, synthesize
    // an ad-hoc approval request without a ruleId, routed to the
    // requested roles.
    if (input.forceRoles && input.forceRoles.length > 0) {
      return await createForcedApproval(input, input.forceRoles);
    }
    return { required: false };
  }

  // Existing pending or approved request for this record? Idempotent.
  // - pending: caller is told the request is still in progress (HTTP 202).
  // - approved: chain has already completed; caller may proceed (the
  //   onApprove handler has run, but routes that finalize work by
  //   replaying themselves need a second call to actually do the work —
  //   this lets that second call pass through cleanly).
  const existing = await db
    .select()
    .from(approvalRequestsTable)
    .where(
      and(
        eq(approvalRequestsTable.companyId, input.companyId),
        eq(approvalRequestsTable.docType, input.docType),
        eq(approvalRequestsTable.recordId, input.recordId),
      ),
    )
    .orderBy(desc(approvalRequestsTable.id))
    .limit(1);
  if (existing[0]) {
    if (existing[0].status === "approved") return { required: false };
    if (existing[0].status === "pending") {
      return { required: true, requestId: existing[0].id, status: existing[0].status };
    }
    // rejected/changes_requested: allow a fresh submission below.
  }

  const allSteps = await db
    .select()
    .from(approvalStepsTable)
    .where(eq(approvalStepsTable.ruleId, matched.id))
    .orderBy(asc(approvalStepsTable.sequence));

  // Step-level threshold: only steps whose minAmount <= requested amount
  // participate in this chain. e.g. ">10k finance, >50k CEO" is one rule
  // with two steps; a 12k request only requires finance.
  const steps = allSteps.filter((s) => Number(s.minAmount ?? 0) <= amount);
  if (steps.length === 0) {
    // No step threshold matches at this amount — treat as auto-approved.
    return { required: false, autoApproved: true };
  }

  const [request] = await db
    .insert(approvalRequestsTable)
    .values({
      companyId: input.companyId,
      ruleId: matched.id,
      docType: input.docType,
      recordId: input.recordId,
      recordRef: input.recordRef ?? null,
      branchId: input.branchId ?? null,
      amount: String(amount),
      submittedByUserId: input.submittedByUserId ?? null,
      submittedByName: input.submittedByName ?? null,
      notes: input.notes ?? null,
      status: "pending",
      currentStep: steps[0].sequence,
    })
    .returning();

  // Notify all currently-pending approvers.
  await notifyStepApprovers(request.id, steps, matched.mode, request.currentStep, {
    companyId: input.companyId,
    docType: input.docType,
    recordRef: input.recordRef ?? `#${input.recordId}`,
    amount,
    branchId: input.branchId ?? null,
  });

  return { required: true, requestId: request.id, status: "pending" };
}

// Synthesize an ad-hoc approval request without an underlying rule. Used
// for hard-coded gates (e.g. credit-limit breach). Routes to the given
// roles sequentially, one step per role.
async function createForcedApproval(
  input: SubmitInput,
  roles: string[],
): Promise<SubmitResult> {
  const amount = Number(input.amount ?? 0);

  // Idempotency: don't create a duplicate forced request if one is
  // already pending or already approved for this record.
  const existing = await db
    .select()
    .from(approvalRequestsTable)
    .where(
      and(
        eq(approvalRequestsTable.companyId, input.companyId),
        eq(approvalRequestsTable.docType, input.docType),
        eq(approvalRequestsTable.recordId, input.recordId),
      ),
    )
    .orderBy(desc(approvalRequestsTable.id))
    .limit(1);
  if (existing[0]) {
    if (existing[0].status === "approved") return { required: false };
    if (existing[0].status === "pending") {
      return { required: true, requestId: existing[0].id, status: existing[0].status };
    }
  }

  // Persist the synthesized step chain on the request itself so
  // actOnApproval can read it back and advance multi-role forced
  // approvals (it cannot use approval_steps because ruleId is null).
  const synthSteps = roles.map((role, i) => ({
    sequence: i + 1,
    approverRole: role,
    approverUserId: null as number | null,
  }));
  const [request] = await db
    .insert(approvalRequestsTable)
    .values({
      companyId: input.companyId,
      ruleId: null,
      docType: input.docType,
      recordId: input.recordId,
      recordRef: input.recordRef ?? null,
      branchId: input.branchId ?? null,
      amount: String(amount),
      submittedByUserId: input.submittedByUserId ?? null,
      submittedByName: input.submittedByName ?? null,
      notes: input.forceReason ?? input.notes ?? null,
      forcedSteps: synthSteps,
      status: "pending",
      currentStep: 1,
    })
    .returning();
  await notifyStepApprovers(request.id, synthSteps, "sequential", request.currentStep, {
    companyId: input.companyId,
    docType: input.docType,
    recordRef: input.recordRef ?? `#${input.recordId}`,
    amount,
    branchId: input.branchId ?? null,
  });

  return { required: true, requestId: request.id, status: "pending" };
}

async function notifyStepApprovers(
  requestId: number,
  steps: Array<{ sequence: number; approverRole: string; approverUserId: number | null }>,
  mode: string,
  currentStep: number,
  ctx: { companyId: number; docType: string; recordRef: string; amount: number; branchId: number | null },
): Promise<void> {
  const targets = mode === "parallel"
    ? steps
    : steps.filter((s) => s.sequence === currentStep);
  for (const s of targets) {
    const recipients = await resolveApprovers(s.approverRole, s.approverUserId, ctx.branchId, ctx.companyId);
    for (const userId of recipients) {
      await notify(userId, {
        companyId: ctx.companyId,
        type: "approval",
        title: `طلب اعتماد: ${ctx.docType} ${ctx.recordRef}`,
        message: `بانتظار اعتمادك. القيمة: ${ctx.amount.toLocaleString("ar-SA")}`,
        link: `/inbox?request=${requestId}`,
        payload: { requestId, stepSequence: s.sequence },
      });
    }
  }
}

// Resolve an approver-role into user ids, honoring active delegations.
// When the request is branch-scoped (requestBranchId != null) we restrict
// the role pool to users assigned to that branch OR to company-wide
// approvers (users.branchId IS NULL). Otherwise rule branch filtering
// could match a branch-A rule but the approver pool would still include
// branch-B managers, letting them approve another branch's documents.
// A fixed user id (rule-level pick) and the resulting delegate are
// always honored even if their branch differs — that's an explicit
// admin choice, not a role pool resolution.
export async function resolveApprovers(
  role: string,
  fixedUserId: number | null,
  requestBranchId: number | null,
  companyId: number,
): Promise<number[]> {
  let baseIds: number[] = [];
  if (fixedUserId) {
    baseIds = await workflowMember(companyId, fixedUserId) ? [fixedUserId] : [];
  } else {
    const conds = [eq(userCompaniesTable.role, role), eq(usersTable.isActive, true),
      eq(userCompaniesTable.companyId, companyId), eq(companiesTable.isActive, true)];
    if (requestBranchId != null) {
      conds.push(
        or(
          eq(usersTable.branchId, requestBranchId),
          isNull(usersTable.branchId),
        )!,
      );
    }
    const rows = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .innerJoin(userCompaniesTable, eq(userCompaniesTable.userId, usersTable.id))
      .innerJoin(companiesTable, eq(companiesTable.id, userCompaniesTable.companyId))
      .where(and(...conds));
    baseIds = rows.map((r) => r.id);
  }
  const out = new Set<number>();
  const now = new Date();
  for (const id of baseIds) {
    const dels = await db
      .select()
      .from(approverDelegationsTable)
      .where(
        and(
          eq(approverDelegationsTable.companyId, companyId),
          eq(approverDelegationsTable.fromUserId, id),
          lte(approverDelegationsTable.fromDate, now),
          gt(approverDelegationsTable.toDate, now),
        ),
      );
    const delegates = [];
    for (const delegation of dels) {
      if (await workflowMember(companyId, delegation.toUserId)) delegates.push(delegation.toUserId);
    }
    // Ambiguous overlapping legacy delegations must not select an arbitrary
    // recipient. The original approver remains available if no valid delegate.
    if (new Set(delegates).size === 1) out.add(delegates[0]);
    else out.add(id);
  }
  return Array.from(out);
}

// ---------------------------------------------------------------------------
// Approver acts on a request.
// ---------------------------------------------------------------------------
export type ActionKind = "approve" | "reject" | "request_changes" | "comment";

export interface ActResult {
  status: string;
  finished: boolean;
}

export async function actOnApproval(
  requestId: number,
  userId: number | null,
  userName: string | null,
  action: ActionKind,
  companyId: number,
  comment?: string,
): Promise<ActResult> {
  if (!Number.isSafeInteger(companyId) || companyId <= 0) throw new Error("يلزم نطاق شركة للاعتماد");
  const [request] = await db
    .select()
    .from(approvalRequestsTable)
    .where(and(eq(approvalRequestsTable.id, requestId), eq(approvalRequestsTable.companyId, companyId)));
  if (!request) throw new Error("طلب الاعتماد غير موجود");
  if (!companyId || !userId) throw new Error("يلزم عضو وشركة للاعتماد");
  await assertWorkflowMember(companyId, userId);
  if (request.branchId != null) await assertCompanyBranch(request.branchId, companyId);
  if (request.status !== "pending") throw new Error("هذا الطلب لم يعد مفتوحاً");
  let returnApprover = false;
  if (request.docType === "credit_note" && action !== "comment") {
    const controls = await db.execute(sql`SELECT company_id,branch_id FROM return_controls WHERE note_id=${request.recordId}`);
    const control = controls.rows[0];
    if (control) {
      if (!userId) throw new Error("يلزم معتمد مسجل");
      await returnAuthorize(userId, Number(control.company_id), "approve", Number(control.branch_id));
      await assertReturnSnapshot(db, request.recordId);
      returnApprover = true;
    }
  }

  const rule = request.ruleId
    ? (await db.select().from(approvalRulesTable).where(and(eq(approvalRulesTable.id, request.ruleId),
      eq(approvalRulesTable.companyId, companyId))))[0]
    : undefined;
  if (request.ruleId && !rule) throw new Error("قاعدة اعتماد غير متاحة في الشركة");
  // Forced approvals (ruleId === null) persist their synthesized step
  // chain on the request itself (forcedSteps jsonb). We materialize that
  // chain so the rest of the act flow works uniformly with rule-based
  // requests, including multi-role sequential chains.
  const forcedSteps = (request.forcedSteps as Array<{
    sequence: number;
    approverRole: string;
    approverUserId: number | null;
  }> | null) ?? null;
  const allSteps = request.ruleId
    ? await db
        .select()
        .from(approvalStepsTable)
        .where(eq(approvalStepsTable.ruleId, request.ruleId))
        .orderBy(asc(approvalStepsTable.sequence))
    : (forcedSteps && forcedSteps.length > 0
        ? forcedSteps.map((s) => ({ id: -s.sequence, ruleId: -1, sequence: s.sequence, approverRole: s.approverRole, approverUserId: s.approverUserId, minAmount: "0" }))
        : ([{ id: -1, ruleId: -1, sequence: 1, approverRole: "manager", approverUserId: null, minAmount: "0" }] as Array<typeof approvalStepsTable.$inferSelect>));
  // Same step-threshold filter used at submission time, so the chain
  // resolution stays consistent (no advancing to a step that wasn't
  // notified because the request amount was below its threshold).
  const requestAmount = Number(request.amount);
  const steps = allSteps.filter((s) => Number(s.minAmount ?? 0) <= requestAmount);

  // Compute which steps are still actionable (not yet approved).
  const priorActions = await db
    .select()
    .from(approvalActionsTable)
    .where(eq(approvalActionsTable.requestId, requestId));
  const approvedSeq = new Set(
    priorActions.filter((a) => a.action === "approve").map((a) => a.stepSequence),
  );
  const actionableSteps = rule?.mode === "parallel"
    ? steps.filter((s) => !approvedSeq.has(s.sequence))
    : steps.filter((s) => s.sequence === request.currentStep);

  // Authorization is strict: only resolved approvers (including delegates)
  // for an actionable step may approve / reject / request_changes. There is
  // no "owner/manager override" — that would silently let any manager act
  // on accountant-only steps and defeat the approval matrix. Use the admin
  // matrix UI to reconfigure rules instead.
  let actingStep: number | null = null;
  if (returnApprover && request.ruleId == null) actingStep = actionableSteps[0]?.sequence ?? null;
  if (userId != null) {
    for (const s of actionableSteps) {
      const resolved = await resolveApprovers(s.approverRole, s.approverUserId, request.branchId ?? null, companyId);
      if (resolved.includes(userId)) {
        actingStep = s.sequence;
        break;
      }
    }
  }
  const isSubmitter = userId != null && request.submittedByUserId === userId;

  if (action === "comment") {
    // Comments are open to anyone with a stake (an actionable approver or
    // the submitter). Anything else would let unrelated users pollute the
    // trail.
    if (actingStep == null && !isSubmitter) {
      throw new Error("ليست لديك صلاحية إضافة تعليق على هذا الطلب");
    }
    actingStep = actingStep ?? request.currentStep;
  } else {
    if (actingStep == null) {
      throw new Error("ليست لديك صلاحية اتخاذ إجراء على هذا الطلب");
    }
    // Segregation of Duties: the user who submitted the request can never
    // approve / reject / request changes on their own request — even if they
    // happen to belong to an authorized approver role. This is the core of
    // the four-eyes (دعم المراقبة الثنائية) principle. Commenting is still
    // allowed above so the submitter can clarify.
    if (isSubmitter) {
      throw new Error("لا يمكنك اعتماد طلب قمت بإنشائه (مبدأ فصل المهام)");
    }
  }

  await db.insert(approvalActionsTable).values({
    requestId,
    stepSequence: actingStep,
    approverUserId: userId,
    approverName: userName,
    action,
    comment: comment ?? null,
  });

  if (action === "comment") {
    return { status: request.status, finished: false };
  }

  if (action === "reject" || action === "request_changes") {
    const finalStatus = action === "reject" ? "rejected" : "changes_requested";
    await db
      .update(approvalRequestsTable)
      .set({ status: finalStatus, decidedAt: new Date() })
      .where(eq(approvalRequestsTable.id, requestId));
    const rejectHandler = rejectHandlers.get(request.docType as DocType);
    if (rejectHandler) {
      try {
        await rejectHandler(request.recordId, requestId, finalStatus as "rejected" | "changes_requested");
      } catch (err) {
        logger.error({ err, requestId, docType: request.docType }, "approval reject handler failed");
      }
    }
    if (request.submittedByUserId) {
      await notify(request.submittedByUserId, {
        companyId,
        type: "approval",
        title: `طلبك ${request.recordRef ?? "#" + request.recordId} ${
          action === "reject" ? "مرفوض" : "بحاجة لتعديلات"
        }`,
        message: comment ?? "",
        link: `/inbox?request=${requestId}`,
        payload: { requestId, action },
      });
    }
    return { status: finalStatus, finished: true };
  }

  // approve: advance or finish
  approvedSeq.add(actingStep);
  const allDone = steps.every((s) => approvedSeq.has(s.sequence));
  if (allDone) {
    await db
      .update(approvalRequestsTable)
      .set({ status: "approved", decidedAt: new Date() })
      .where(eq(approvalRequestsTable.id, requestId));
    if (request.submittedByUserId) {
      await notify(request.submittedByUserId, {
        companyId,
        type: "approval",
        title: `تم اعتماد ${request.recordRef ?? "#" + request.recordId}`,
        message: comment ?? "",
        link: `/inbox?request=${requestId}`,
        payload: { requestId },
      });
    }
    const handler = handlers.get(request.docType as DocType);
    if (handler) {
      try {
        await handler(request.recordId, requestId);
      } catch (err) {
        // Finalization failed: roll the request back to pending so workflow
        // and document state stay consistent. The record can be re-acted on
        // once the underlying problem (e.g. blanket-agreement overrun) is
        // fixed. The error is also surfaced to the caller.
        logger.error({ err, requestId, docType: request.docType }, "approval finalize handler failed — reverting to pending");
        await db
          .update(approvalRequestsTable)
          .set({ status: "pending", decidedAt: null })
          .where(eq(approvalRequestsTable.id, requestId));
        await db.insert(approvalActionsTable).values({
          requestId,
          stepSequence: actingStep,
          action: "comment",
          approverUserId: null,
          approverName: "system",
          comment: `فشل تنفيذ الاعتماد: ${err instanceof Error ? err.message : String(err)}`,
        });
        throw err;
      }
    }
    return { status: "approved", finished: true };
  }

  // Sequential: advance currentStep to next un-approved
  if (rule?.mode !== "parallel") {
    const next = steps.find((s) => !approvedSeq.has(s.sequence));
    if (next) {
      await db
        .update(approvalRequestsTable)
        .set({ currentStep: next.sequence })
        .where(eq(approvalRequestsTable.id, requestId));
      await notifyStepApprovers(requestId, steps, "sequential", next.sequence, {
        companyId,
        docType: request.docType,
        recordRef: request.recordRef ?? `#${request.recordId}`,
        amount: Number(request.amount),
        branchId: request.branchId ?? null,
      });
    }
  }
  return { status: "pending", finished: false };
}

// ---------------------------------------------------------------------------
// Financial-limit middleware
// ---------------------------------------------------------------------------
export async function checkFinancialLimit(
  companyId: number,
  userId: number,
  actionKey: string,
  value: number,
  branchId?: number | null,
  approvalRequestId?: number | null,
): Promise<{ allowed: boolean; max: number | null; source: string; reason?: string }> {
  const member = await assertWorkflowMember(companyId, userId);
  if (branchId != null) {
    await assertCompanyBranch(branchId, companyId);
    if (member.role !== "owner" && member.branchId != null && member.branchId !== branchId) {
      throw new FinancialRequestError("الفرع خارج نطاق العضو", 403);
    }
  }
  if (!Number.isFinite(value) || value < 0) throw new FinancialRequestError("قيمة مالية غير صحيحة", 400);
  let role = member.role;
  // This only selects the cap; POS still verifies the immutable transaction
  // fingerprint and consumes the approval atomically with the sale.
  if (approvalRequestId != null) {
    const [approval] = await db.select().from(approvalRequestsTable).where(and(
      eq(approvalRequestsTable.id, approvalRequestId), eq(approvalRequestsTable.companyId, companyId),
      eq(approvalRequestsTable.submittedByUserId, userId), eq(approvalRequestsTable.status, "approved"),
      eq(approvalRequestsTable.docType, "pos_over_limit"),
    ));
    if (!approval || !actionKey.startsWith("pos.") || approval.branchId !== branchId) {
      throw new FinancialRequestError("اعتماد الحد غير متاح", 403);
    }
    role = "manager";
  }
  const policy = await financialPolicy(companyId, role, actionKey);
  const { max, source } = policy;
  if (policy.blocked) return { allowed: false, max, source, reason: "يلزم تهيئة الحد المالي للشركة بواسطة صاحب الصلاحية؛ السياسة القديمة غير منسوبة" };
  if (max == null) return { allowed: true, max, source };
  if (value <= max) return { allowed: true, max, source };
  return {
    allowed: false,
    max,
    source,
    reason: `تجاوزت حدّك المسموح (${max}) لهذا الإجراء (${actionKey})`,
  };
}

export function requireFinancialLimit(actionKey: string, getValue: (req: Request) => number) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const role = (req.session as { role?: string } | undefined)?.role;
    if (!role) {
      res.status(401).json({ error: "غير مصرّح" });
      return;
    }
    let value = 0;
    try {
      value = Math.abs(getValue(req));
      if (!Number.isFinite(value)) throw new Error("invalid value");
    } catch (err) {
      // Fail CLOSED: an authorization gate must never let a request through
      // because its own value extractor blew up. Audit the failure and
      // reject so callers fix their payload (or the getter) instead of
      // silently bypassing the cap.
      void recordAudit(req, {
        action: "financial_limit_check_error",
        entity: actionKey,
        details: `تعذّر حساب قيمة الإجراء (${actionKey}) للدور ${role}: ${err instanceof Error ? err.message : String(err)}`,
        severity: "warning",
      });
      res.status(400).json({ error: "تعذّر التحقق من الحد المالي للطلب", actionKey });
      return;
    }
    const r = await checkFinancialLimit(req.session.companyId!, req.session.userId!, actionKey, value);
    if (!r.allowed) {
      // Audit failed attempts so admins can see who tried to exceed which cap.
      // Fire-and-forget: never block the request response on the audit write.
      void recordAudit(req, {
        action: "financial_limit_exceeded",
        entity: actionKey,
        details: `الدور ${role} حاول إجراء بقيمة ${value} وتجاوز الحد المسموح (${r.max ?? "—"}) لـ ${actionKey}`,
        severity: "warning",
      });
      res.status(403).json({ error: r.reason ?? "تجاوزت الحد المسموح", actionKey, max: r.max, attempted: value });
      return;
    }
    next();
  };
}

// ---------------------------------------------------------------------------
// Company-owned, source-checked in-app notifications. External channels are
// rejected here; they are not simulated as successful provider dispatches.
// ---------------------------------------------------------------------------
export { notify } from "./workflow-notifications";
export type { NotifyInput } from "./workflow-notifications";

// ---------------------------------------------------------------------------
// Automation engine
// ---------------------------------------------------------------------------
export { triggerEvent, runScheduledAutomations } from "./workflow-automation";

// Re-exports for convenience
export { db as workflowDb };
