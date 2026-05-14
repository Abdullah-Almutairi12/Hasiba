import type { Request, Response, NextFunction } from "express";
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
  purchaseOrdersTable,
  invoicesTable,
  leaveRequestsTable,
} from "@workspace/db";
import type { PgTable } from "drizzle-orm/pg-core";
import { and, asc, desc, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import { logger } from "./logger";
import { sendMail, isMailerConfigured } from "./mailer";
import { recordAudit } from "./audit";

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
  | "payment_run";

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
  const amount = Number(input.amount ?? 0);
  // Find the most-specific active rule: same branch beats null branch,
  // tighter amount window beats wider. Take the highest min_amount that
  // still matches our amount, then highest specificity.
  const candidates = await db
    .select()
    .from(approvalRulesTable)
    .where(
      and(
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
    .filter((r) => r.branchId == null || r.branchId === input.branchId)
    .sort((a, b) => {
      const branchA = a.branchId === input.branchId && a.branchId != null ? 1 : 0;
      const branchB = b.branchId === input.branchId && b.branchId != null ? 1 : 0;
      if (branchA !== branchB) return branchB - branchA;
      return Number(b.minAmount) - Number(a.minAmount);
    })[0];

  if (!matched) {
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
  ctx: { docType: string; recordRef: string; amount: number; branchId: number | null },
): Promise<void> {
  const targets = mode === "parallel"
    ? steps
    : steps.filter((s) => s.sequence === currentStep);
  for (const s of targets) {
    const recipients = await resolveApprovers(s.approverRole, s.approverUserId, ctx.branchId);
    for (const userId of recipients) {
      await notify(userId, {
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
async function resolveApprovers(
  role: string,
  fixedUserId: number | null,
  requestBranchId: number | null,
): Promise<number[]> {
  let baseIds: number[] = [];
  if (fixedUserId) {
    baseIds = [fixedUserId];
  } else {
    const conds = [eq(usersTable.role, role), eq(usersTable.isActive, true)];
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
          eq(approverDelegationsTable.fromUserId, id),
          lte(approverDelegationsTable.fromDate, now),
          gt(approverDelegationsTable.toDate, now),
        ),
      );
    if (dels[0]) out.add(dels[0].toUserId);
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
  comment?: string,
): Promise<ActResult> {
  const [request] = await db
    .select()
    .from(approvalRequestsTable)
    .where(eq(approvalRequestsTable.id, requestId));
  if (!request) throw new Error("طلب الاعتماد غير موجود");
  if (request.status !== "pending") throw new Error("هذا الطلب لم يعد مفتوحاً");

  const rule = request.ruleId
    ? (await db.select().from(approvalRulesTable).where(eq(approvalRulesTable.id, request.ruleId)))[0]
    : undefined;
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
  if (userId != null) {
    for (const s of actionableSteps) {
      const resolved = await resolveApprovers(s.approverRole, s.approverUserId, request.branchId ?? null);
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
  role: string,
  actionKey: string,
  value: number,
): Promise<{ allowed: boolean; max: number | null; reason?: string }> {
  const rows = await db
    .select()
    .from(financialLimitsTable)
    .where(and(eq(financialLimitsTable.role, role), eq(financialLimitsTable.actionKey, actionKey)));
  const limit = rows[0];
  if (!limit) return { allowed: true, max: null }; // no limit configured
  if (limit.maxValue == null) return { allowed: true, max: null }; // unlimited
  const max = Number(limit.maxValue);
  if (value <= max + 1e-6) return { allowed: true, max };
  return {
    allowed: false,
    max,
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
    const r = await checkFinancialLimit(role, actionKey, value);
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
// In-app notification helper. Also emits an email if the user has one and
// SMTP is configured. WhatsApp/SMS dispatch routes through the real
// outbound messaging adapter (records spend, audit log, retry).
// ---------------------------------------------------------------------------
export interface NotifyInput {
  type: "approval" | "automation" | "system";
  title: string;
  message: string;
  link?: string | null;
  payload?: unknown;
  channel?: "inapp" | "email" | "whatsapp" | "sms";
}

export async function notify(userId: number, input: NotifyInput): Promise<void> {
  try {
    await db.insert(notificationInboxTable).values({
      userId,
      type: input.type,
      title: input.title,
      message: input.message,
      link: input.link ?? null,
      payload: (input.payload as object | undefined) ?? null,
    });
  } catch (err) {
    logger.warn({ err }, "inbox insert failed");
  }
  const emailFallback = async () => {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    if (user?.email && isMailerConfigured()) {
      await sendMail({
        to: user.email,
        subject: input.title,
        body: `${input.message}\n\n${input.link ?? ""}`,
      }).catch(() => {});
    }
  };
  if (input.channel === "email" || input.channel == null) {
    await emailFallback();
  }
  if (input.channel === "whatsapp" || input.channel === "sms") {
    // Real outbound dispatch via the integrations messaging
    // adapter — picks up the company's stored WhatsApp /
    // SMS credentials, records the call in `integration_calls`
    // and persists the message + cost in `outbound_messages`.
    // Fire-and-forget: a missing phone or missing credential
    // must never break the in-app notification path.
    try {
      const [user] = await db
        .select({ phone: usersTable.phone })
        .from(usersTable)
        .where(eq(usersTable.id, userId));
      const phone = user?.phone?.trim();
      if (!phone) {
        logger.info(
          { userId, title: input.title },
          "outbound notification skipped: user has no phone; falling back to email",
        );
        await emailFallback().catch(() => {});
      } else {
        const { sendMessage } = await import("./integrations/messaging");
        const provider =
          input.channel === "whatsapp"
            ? ("whatsapp" as const)
            : (((process.env.DEFAULT_SMS_PROVIDER as
                | "unifonic"
                | "mobily"
                | "taqnyat"
                | undefined) ?? "unifonic") as
                | "unifonic"
                | "mobily"
                | "taqnyat");
        const result = await sendMessage({
          channel: input.channel,
          provider,
          to: phone,
          body: input.link
            ? `${input.title}\n\n${input.message}\n${input.link}`
            : `${input.title}\n\n${input.message}`,
        });
        if (result.status !== "sent") {
          logger.warn(
            { userId, status: result.status, channel: input.channel },
            "outbound notification not delivered; falling back to email",
          );
          await emailFallback().catch(() => {});
        }
      }
    } catch (err) {
      logger.warn({ err, userId }, "outbound notification dispatch threw; falling back to email");
      await emailFallback().catch(() => {});
    }
  }
}

// ---------------------------------------------------------------------------
// Automation engine
// ---------------------------------------------------------------------------
type AutoTrigger = {
  type: "record_created" | "record_updated" | "state_changed" | "scheduled";
  entity?: string;
  state?: string;
  cron?: string; // simple "every N minutes" or HH:MM daily; we use a minute-sweep
  intervalMinutes?: number;
};
type AutoCondition = {
  field: string;
  op: "eq" | "ne" | "gt" | "lt" | "gte" | "lte" | "contains";
  value: unknown;
};
type AutoAction =
  | { type: "set_field"; field: string; value: unknown }
  | { type: "send_notification"; recipientRole?: string; recipientUserId?: number; title: string; message: string; channel?: "inapp" | "email" | "whatsapp" }
  | { type: "create_record"; entity: string; payload: Record<string, unknown> }
  | { type: "call_webhook"; url: string; method?: "POST" | "PUT" | "PATCH"; payload?: unknown };

function applyConditions(record: Record<string, unknown>, conditions: AutoCondition[]): boolean {
  for (const c of conditions) {
    const val = record[c.field];
    const cv = c.value;
    switch (c.op) {
      case "eq": if (val !== cv) return false; break;
      case "ne": if (val === cv) return false; break;
      case "gt": if (!(Number(val) > Number(cv))) return false; break;
      case "lt": if (!(Number(val) < Number(cv))) return false; break;
      case "gte": if (!(Number(val) >= Number(cv))) return false; break;
      case "lte": if (!(Number(val) <= Number(cv))) return false; break;
      case "contains": if (!String(val ?? "").includes(String(cv))) return false; break;
    }
  }
  return true;
}

async function executeAction(action: AutoAction, record: Record<string, unknown>): Promise<void> {
  if (action.type === "send_notification") {
    let userIds: number[] = [];
    if (action.recipientUserId) userIds = [action.recipientUserId];
    else if (action.recipientRole) {
      const rows = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(and(eq(usersTable.role, action.recipientRole), eq(usersTable.isActive, true)));
      userIds = rows.map((r) => r.id);
    }
    for (const uid of userIds) {
      await notify(uid, {
        type: "automation",
        title: interpolate(action.title, record),
        message: interpolate(action.message, record),
        channel: action.channel ?? "inapp",
      });
    }
    return;
  }
  if (action.type === "call_webhook") {
    if (!isWebhookUrlSafe(action.url)) {
      logger.warn({ url: action.url }, "webhook action blocked (SSRF guard)");
      return;
    }
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 10_000);
      await fetch(action.url, {
        method: action.method ?? "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(action.payload ?? record),
        signal: ctrl.signal,
        redirect: "error",
      }).finally(() => clearTimeout(t));
    } catch (err) {
      logger.warn({ err, url: action.url }, "webhook action failed");
    }
    return;
  }
  if (action.type === "set_field") {
    const entity = (record.__entity as string | undefined) ?? null;
    const id = Number(record.id);
    if (!entity || !Number.isFinite(id)) {
      logger.warn({ action }, "set_field: missing entity or id on record");
      return;
    }
    const table = ENTITY_TABLES[entity];
    if (!table) {
      logger.warn({ entity }, "set_field: unknown entity (not in allow-list)");
      return;
    }
    try {
      const idCol = (table as unknown as { id: unknown }).id;
      await db
        .update(table)
        .set({ [action.field]: action.value } as Record<string, unknown>)
        .where(sql`${idCol} = ${id}`);
    } catch (err) {
      logger.warn({ err, entity, field: action.field }, "set_field failed");
    }
    return;
  }
  if (action.type === "create_record") {
    const table = ENTITY_TABLES[action.entity];
    if (!table) {
      logger.warn({ entity: action.entity }, "create_record: unknown entity (not in allow-list)");
      return;
    }
    try {
      await db.insert(table).values(action.payload as Record<string, unknown>);
    } catch (err) {
      logger.warn({ err, entity: action.entity }, "create_record failed");
    }
  }
}

// Allow-list of tables that automation actions may write to. Only safe,
// audited targets are exposed; arbitrary table writes are intentionally
// blocked.
const ENTITY_TABLES: Record<string, PgTable> = {
  purchase_order: purchaseOrdersTable,
  invoice: invoicesTable,
  leave_request: leaveRequestsTable,
  notification_inbox: notificationInboxTable,
};

// SSRF guard for admin-configured webhook URLs. Only http(s) public hosts
// are allowed; localhost, private RFC1918 ranges, link-local, IPv6 ULA
// and unspecified addresses are blocked. Hostname-based blocks cover the
// common metadata services and reserved names.
function isWebhookUrlSafe(raw: string): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  if (!host) return false;
  const blockedHosts = ["localhost", "metadata.google.internal", "metadata", "169.254.169.254"];
  if (blockedHosts.includes(host)) return false;
  if (host.endsWith(".local") || host.endsWith(".internal")) return false;
  // IPv4 literal
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10) return false;
    if (a === 127) return false;
    if (a === 0) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a >= 224) return false; // multicast / reserved
  }
  // IPv6 literal (bracketed)
  if (host.startsWith("[") && host.endsWith("]")) {
    const v6 = host.slice(1, -1).toLowerCase();
    if (v6 === "::1" || v6 === "::") return false;
    if (v6.startsWith("fc") || v6.startsWith("fd")) return false; // ULA
    if (v6.startsWith("fe80")) return false; // link-local
  }
  return true;
}

function interpolate(tpl: string, record: Record<string, unknown>): string {
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => String(record[k] ?? ""));
}

/**
 * Fired by hook points whenever a record is created, updated, or transitions
 * state. Synchronous-best-effort; failures are logged, never thrown.
 */
export async function triggerEvent(
  type: "record_created" | "record_updated" | "state_changed",
  entity: string,
  record: Record<string, unknown>,
  state?: string,
): Promise<void> {
  try {
    const rules = await db
      .select()
      .from(automationRulesTable)
      .where(eq(automationRulesTable.isActive, true));
    // Annotate the record with its entity name so set_field can route writes.
    const enrichedRecord = { ...record, __entity: entity };
    for (const rule of rules) {
      const trig = rule.trigger as AutoTrigger;
      if (trig.type !== type) continue;
      if (trig.entity && trig.entity !== entity) continue;
      if (type === "state_changed" && trig.state && trig.state !== state) continue;
      const conditions = (rule.conditions as AutoCondition[]) ?? [];
      if (!applyConditions(enrichedRecord, conditions)) continue;
      await runRule(rule.id, [enrichedRecord]);
    }
  } catch (err) {
    logger.warn({ err, entity, type }, "triggerEvent failed");
  }
}

async function runRule(ruleId: number, records: Array<Record<string, unknown>>): Promise<void> {
  const [rule] = await db.select().from(automationRulesTable).where(eq(automationRulesTable.id, ruleId));
  if (!rule) return;
  const actions = (rule.actions as AutoAction[]) ?? [];
  let executed = 0;
  let status: "success" | "partial" | "failed" = "success";
  let lastError: string | null = null;
  for (const rec of records) {
    for (const a of actions) {
      try {
        await executeAction(a, rec);
        executed++;
      } catch (err) {
        status = "partial";
        lastError = err instanceof Error ? err.message : String(err);
      }
    }
  }
  await db
    .update(automationRulesTable)
    .set({ lastRunAt: new Date() })
    .where(eq(automationRulesTable.id, ruleId));
  await db.insert(automationRunsTable).values({
    ruleId,
    status: executed === 0 && actions.length > 0 ? "failed" : status,
    matchedRecords: records.length,
    actionsExecuted: executed,
    error: lastError,
  });
}

/**
 * Cron sweep — fires scheduled rules whose interval has elapsed.
 *
 * For each scheduled rule we look up its target entity in the allow-list,
 * select all rows from that table, apply the rule's conditions in-memory,
 * and run the actions against each matching record. This makes use cases
 * like "invoices > 30 days overdue → notify accountant" expressible in
 * the UI without writing custom code: trigger=scheduled, entity=invoice,
 * condition `daysOverdue gte 30`, action=send_notification.
 */
export async function runScheduledAutomations(): Promise<void> {
  const rules = await db
    .select()
    .from(automationRulesTable)
    .where(eq(automationRulesTable.isActive, true));
  const now = new Date();
  for (const rule of rules) {
    const trig = rule.trigger as AutoTrigger;
    if (trig.type !== "scheduled") continue;
    const interval = Math.max(1, Number(trig.intervalMinutes ?? 60));
    const last = rule.lastRunAt ? new Date(rule.lastRunAt).getTime() : 0;
    if (now.getTime() - last < interval * 60_000) continue;

    const conditions = (rule.conditions as AutoCondition[]) ?? [];
    let matched: Array<Record<string, unknown>> = [];
    if (trig.entity && ENTITY_TABLES[trig.entity]) {
      try {
        const rows = (await db.select().from(ENTITY_TABLES[trig.entity])) as Array<Record<string, unknown>>;
        matched = rows
          .map((r) => enrichRowForConditions(r, trig.entity!))
          .filter((r) => applyConditions(r, conditions));
      } catch (err) {
        logger.warn({ err, entity: trig.entity }, "scheduled rule: entity scan failed");
      }
    } else {
      // No entity → run once with a clock context so simple "every N min"
      // notification rules still work.
      matched = [{ now: now.toISOString(), __entity: "clock" }];
    }
    if (matched.length > 0) await runRule(rule.id, matched);
    else {
      // Touch lastRunAt even when nothing matched, so the cadence advances.
      await db
        .update(automationRulesTable)
        .set({ lastRunAt: now })
        .where(eq(automationRulesTable.id, rule.id));
    }
  }
}

// Add convenience derived fields (e.g. `daysOverdue` for invoices) so
// admins can write conditions like `daysOverdue gte 30` without needing
// SQL date math in the UI.
function enrichRowForConditions(
  row: Record<string, unknown>,
  entity: string,
): Record<string, unknown> {
  const enriched: Record<string, unknown> = { ...row, __entity: entity };
  const due = row.dueDate ?? row.due_date;
  if (due) {
    const t = new Date(due as string | Date).getTime();
    if (Number.isFinite(t)) {
      enriched.daysOverdue = Math.floor((Date.now() - t) / 86_400_000);
    }
  }
  return enriched;
}

// Re-exports for convenience
export { db as workflowDb };
