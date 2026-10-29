import type { Request, Response, NextFunction } from "express";
import { managedProfile, selectedResponsibility } from "./responsibility-context";
import { procurementReviewAuthority } from "./procurement-authority";
import { invoiceDecisionAuthority } from "./supplier-invoice-access";
import { assertScopedReturnReview, scopedReturnGrants } from "./scoped-return-review";
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
import { notify, approvalViewer } from "./workflow-notifications";
import type { DbOrTx } from "./journal-posting";
import type { ApprovalExecutionContext, ApprovalEffect } from "./approval-context";
import { freezeApprovalPolicy, frozenApprovalPolicy } from "./approval-policy";
import { approvalSourceFingerprint, approvalSourceMatches, isApprovalSourceCreator } from "./approval-source";
import { decisionIntent, decisionResultSchema, reviewStepToken, type DecisionIdentity } from "./approval-decision";
import { authorityFingerprint, lockApprovalAuthority } from "./approval-authority";

// ---------------------------------------------------------------------------
// Document types known to the engine. Each module that wants to trigger an
// approval must call `registerOnApprove(docType, callback)` so that when the
// chain completes the engine can re-run the original confirmation logic.
// ---------------------------------------------------------------------------
export type DocType =
  | "supplier_invoice"
  | "purchase_order"
  | "sales_order"
  | "expense_claim"
  | "leave_request"
  | "journal_entry"
  | "credit_note"
  | "credit_note_cancel"
  | "payment_run"
  | "pos_over_limit";

type OnApproveHandler = (recordId: number, requestId: number, context: ApprovalExecutionContext) => Promise<void> | void;
type OnRejectHandler = (recordId: number, requestId: number, reason: "rejected" | "changes_requested", context: ApprovalExecutionContext) => Promise<void> | void;
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

export async function submitForApproval(input: SubmitInput, connection: DbOrTx = db): Promise<SubmitResult> {
  return connection.transaction((tx) => submitForApprovalTransaction(input, tx));
}

async function approvalCandidates(input:Pick<SubmitInput,"companyId"|"docType"|"amount">,connection:DbOrTx) {
  const amount=String(Number(input.amount??0));
  return connection.select().from(approvalRulesTable).where(and(
    eq(approvalRulesTable.companyId,input.companyId),eq(approvalRulesTable.docType,input.docType),
    eq(approvalRulesTable.isActive,true),lte(approvalRulesTable.minAmount,amount),
    or(isNull(approvalRulesTable.maxAmount),gt(approvalRulesTable.maxAmount,amount))));
}

/** Old OCR booking is not an alternative route around a company's approval
 * matrix. Branchless legacy input cannot assert exemption from a branch rule. */
export async function assertLegacyInvoiceCommitAllowed(connection:DbOrTx,companyId:number,amount:number,branchId:number|null) {
  await lockApprovalAuthority(connection);
  const candidates=await approvalCandidates({companyId,docType:"supplier_invoice",amount},connection);
  const legacy=await connection.select({id:approvalRulesTable.id}).from(approvalRulesTable).where(and(
    isNull(approvalRulesTable.companyId),eq(approvalRulesTable.docType,"supplier_invoice"),
    eq(approvalRulesTable.isActive,true))).limit(1);
  if(legacy.length||candidates.some(r=>branchId==null||r.branchId==null||r.branchId===branchId))
    throw new FinancialRequestError("لا يجوز تجاوز سياسة اعتماد فواتير الموردين بالإدخال الفوري؛ استخدم مسودة الفاتورة ومراجعتها وتقديمها",409);
}

async function submitForApprovalTransaction(input: SubmitInput, db: DbOrTx): Promise<SubmitResult> {
  await lockApprovalAuthority(db);
  if (!Number.isSafeInteger(input.companyId) || input.companyId <= 0) throw new Error("يلزم نطاق شركة للاعتماد");
  if (input.branchId != null) await assertCompanyBranch(input.branchId, input.companyId);
  if (input.submittedByUserId != null) await assertWorkflowMember(input.companyId, input.submittedByUserId, db);
  const amount = Number(input.amount ?? 0);
  if (!Number.isFinite(amount) || amount < 0) throw new Error("قيمة اعتماد غير صحيحة");
  // Native header first, before reading a prior decision: a concurrent final
  // approval must not be overwritten using a stale, previously-pending row.
  let sourceFingerprint: string;
  try {
    sourceFingerprint = await approvalSourceFingerprint(input.companyId, input.docType, input.recordId, db);
  } catch (error) {
    const [legacy] = await db.select({ id: approvalRulesTable.id }).from(approvalRulesTable).where(and(
      isNull(approvalRulesTable.companyId), eq(approvalRulesTable.docType, input.docType),
      eq(approvalRulesTable.isActive, true),
    )).limit(1);
    if (legacy) throw new FinancialRequestError("يلزم إعادة تهيئة سياسة الاعتماد للشركة؛ توجد سياسة قديمة مجهولة المالك", 409);
    throw error;
  }
  if (input.docType === "pos_over_limit") {
    const native = await db.execute(sql`SELECT p.branch_id FROM pos_sessions p
      JOIN branches b ON b.id=p.branch_id
      WHERE p.id=${input.recordId} AND b.company_id=${input.companyId}`);
    const branch = native.rows[0]?.branch_id;
    if (typeof branch !== "number" || (input.branchId != null && input.branchId !== branch)) {
      throw new FinancialRequestError("فرع مراجعة POS لا يطابق الوردية الأصلية", 409);
    }
    input = { ...input, branchId: branch };
  }
  await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(
    ${`approval-submit:${input.companyId}:${input.docType}:${input.recordId}`}, 0))`);
  // An existing review does not disappear merely because its administrator
  // deactivates the prospective rule. Reuse only the bound amount/scope.
  const [prior] = await db.select().from(approvalRequestsTable).where(and(
    eq(approvalRequestsTable.companyId, input.companyId), eq(approvalRequestsTable.docType, input.docType),
    eq(approvalRequestsTable.recordId, input.recordId),
  )).orderBy(desc(approvalRequestsTable.id)).limit(1);
  let replacesReview = false;
  if (prior && ["pending", "approved"].includes(prior.status)) {
    let currentAuthority = true;
    if (prior.status === "approved" && prior.docType === "supplier_invoice") {
      try { await assertDeferredInvoiceApproval(input.companyId,prior.recordId,db); }
      catch(error) {
        if(!(error instanceof FinancialRequestError)||![403,409].includes(error.status))throw error;
        currentAuthority=false;
      }
    }
    if (prior.status === "approved" && prior.docType === "pos_over_limit") {
      try { await assertDeferredPosApproval(prior, db); }
      catch (error) {
        if (!(error instanceof FinancialRequestError) || error.status !== 403) throw error;
        currentAuthority = false;
      }
    }
    if (prior.status === "approved" && prior.docType === "credit_note") {
      const control = await db.execute(sql`SELECT note_id FROM return_controls
        WHERE note_id=${prior.recordId} AND company_id=${input.companyId} AND approval_id=${prior.id}`);
      if (control.rows.length) {
        try { await assertDeferredReturnApproval(prior.recordId, input.companyId, db); }
        catch (error) {
          if (!(error instanceof FinancialRequestError) || ![403,409].includes(error.status)) throw error;
          currentAuthority = false;
        }
      }
    }
    const same = await db.execute(sql`SELECT ${String(amount)}::numeric(18,2) = ${prior.amount}::numeric AS same`);
    if (currentAuthority && !prior.reviewInvalidatedAt && frozenApprovalPolicy(prior) &&
      prior.sourceFingerprintVersion === 1 && prior.sourceFingerprint === sourceFingerprint &&
      same.rows[0]?.same === true && (prior.branchId ?? null) === (input.branchId ?? null) &&
      (prior.notes ?? null) === (input.notes ?? null) &&
      (input.docType !== "pos_over_limit" || prior.submittedByUserId === (input.submittedByUserId ?? null))) {
      if (prior.status === "pending") return { required: true, requestId: prior.id, status: "pending" };
      return { required: false };
    }
    replacesReview = true;
    // Invalidation is subsequent evidence, not a rewrite of a historical
    // approval. Only pending requests change their undecided status.
    await db.update(approvalRequestsTable).set({
      status: prior.status === "pending" ? "changes_requested" : prior.status,
      decidedAt: prior.status === "pending" ? new Date() : prior.decidedAt,
      reviewInvalidatedAt: new Date(),
      reviewInvalidatedReason: !currentAuthority ? "سحبت أو تغيرت أهلية القرار السابق؛ أعيدت المراجعة دون تغيير القرار التاريخي" : "تغيرت حقائق الطلب أو سياسة المراجعة",
    })
      .where(eq(approvalRequestsTable.id, prior.id));
    await db.insert(approvalActionsTable).values({
      requestId: prior.id, stepSequence: prior.currentStep, action: "comment", approverName: "system",
      comment: "أبطلت إعادة التقديم صلاحية المراجعة السابقة لتغير المبلغ/النطاق/بصمة الطلب أو غياب نسخة السياسة؛ القرار التاريخي محفوظ ويلزم طلب جديد.",
    });
  }
  // Find the most-specific active rule: same branch beats null branch,
  // tighter amount window beats wider. Take the highest min_amount that
  // still matches our amount, then highest specificity.
  const candidates = await approvalCandidates(input,db);
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
      return await createForcedApproval(input, input.forceRoles, db, sourceFingerprint);
    }
    if (replacesReview) throw new FinancialRequestError("يلزم إعداد سياسة مراجعة صريحة قبل إعادة تقديم هذا الطلب؛ لا تُلغى المراجعة السابقة بصمت", 409);
    return { required: false };
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
      policySnapshot: freezeApprovalPolicy(input.companyId, matched, steps),
      sourceFingerprint,
      sourceFingerprintVersion: 1,
    })
    .returning();

  // Notify all currently-pending approvers.
  await notifyStepApprovers(request.id, steps, matched.mode, request.currentStep, {
    companyId: input.companyId,
    docType: input.docType,
    recordRef: input.recordRef ?? `#${input.recordId}`,
    amount,
    branchId: input.branchId ?? null,
  }, db);

  return { required: true, requestId: request.id, status: "pending" };
}

// Synthesize an ad-hoc approval request without an underlying rule. Used
// for hard-coded gates (e.g. credit-limit breach). Routes to the given
// roles sequentially, one step per role.
async function createForcedApproval(
  input: SubmitInput,
  roles: string[],
  db: DbOrTx,
  sourceFingerprint: string,
): Promise<SubmitResult> {
  const amount = Number(input.amount ?? 0);

  // The caller holds the document lock and has already checked reuse and
  // invalidation. Rechecking an old approved row here would bypass re-review.

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
      notes: input.notes ?? input.forceReason ?? null,
      sourceFingerprint,
      sourceFingerprintVersion: 1,
      forcedSteps: synthSteps,
      policySnapshot: freezeApprovalPolicy(input.companyId, null, synthSteps.map((step) => ({
        ...step, id: -step.sequence, ruleId: -1, minAmount: "0",
      })), input.forceReason ?? undefined),
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
  }, db);

  return { required: true, requestId: request.id, status: "pending" };
}

async function notifyStepApprovers(
  requestId: number,
  steps: Array<{ sequence: number; approverRole: string; approverUserId: number | null }>,
  mode: string,
  currentStep: number,
  ctx: { companyId: number; docType: string; recordRef: string; amount: number; branchId: number | null },
  connection: DbOrTx = db,
): Promise<void> {
  const targets = mode === "parallel"
    ? steps
    : steps.filter((s) => s.sequence === currentStep);
  const [source] = await connection.select().from(approvalRequestsTable).where(eq(approvalRequestsTable.id, requestId));
  for (const s of targets) {
    const recipients = await resolveApprovers(s.approverRole, s.approverUserId, ctx.branchId, ctx.companyId, connection, source);
    for (const userId of recipients) {
      await notify(userId, {
        companyId: ctx.companyId,
        type: "approval",
        title: `طلب اعتماد: ${ctx.docType} ${ctx.recordRef}`,
        message: `بانتظار اعتمادك. القيمة: ${ctx.amount.toLocaleString("ar-SA")}`,
        link: `/inbox?request=${requestId}`,
        payload: { requestId, stepSequence: s.sequence },
      }, connection);
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
  connection: DbOrTx = db,
  scope?: { docType: string; recordId: number; amount: string | number },
): Promise<number[]> {
  return [...new Set((await resolveApproverAuthorities(role, fixedUserId, requestBranchId, companyId, connection, scope))
    .map(a => a.userId))];
}

async function resolveApproverAuthorities(
  role: string, fixedUserId: number | null, requestBranchId: number | null,
  companyId: number, connection: DbOrTx,
  scope?: { docType: string; recordId: number; amount: string | number },
) {
  let baseIds: number[] = [];
  if (fixedUserId) {
    baseIds = await workflowMember(companyId, fixedUserId, connection) ? [fixedUserId] : [];
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
    const rows = await connection
      .select({ id: usersTable.id })
      .from(usersTable)
      .innerJoin(userCompaniesTable, eq(userCompaniesTable.userId, usersTable.id))
      .innerJoin(companiesTable, eq(companiesTable.id, userCompaniesTable.companyId))
      .where(and(...conds));
    baseIds = rows.map((r) => r.id);
  }
  const out: Array<{ userId: number; fromUserId: number; delegationId: number | null }> = [];
  const now = new Date();
  for (const id of baseIds) {
    const dels = await connection
      .select()
      .from(approverDelegationsTable)
      .where(
        and(
          eq(approverDelegationsTable.companyId, companyId),
          eq(approverDelegationsTable.fromUserId, id),
          lte(approverDelegationsTable.fromDate, now),
          gt(approverDelegationsTable.toDate, now),
          isNull(approverDelegationsTable.revokedAt),
          scope ? sql`${scope.docType} = ANY(${approverDelegationsTable.docTypes})` : sql`false`,
          or(isNull(approverDelegationsTable.branchId), eq(approverDelegationsTable.branchId, requestBranchId ?? -1)),
          scope ? or(isNull(approverDelegationsTable.maxAmount),
            sql`${approverDelegationsTable.maxAmount} >= ${String(scope.amount)}::numeric`) : sql`false`,
        ),
      );
    const delegates: typeof dels = [];
    for (const delegation of dels) {
      const nativeScope = scope && { companyId, branchId: requestBranchId, docType: scope.docType, recordId: scope.recordId };
      if (nativeScope && await workflowMember(companyId, delegation.toUserId, connection) &&
        await approvalViewer(id, nativeScope, connection) && await approvalViewer(delegation.toUserId, nativeScope, connection)) {
        delegates.push(delegation);
      }
    }
    // Ambiguous overlapping legacy delegations must not select an arbitrary
    // recipient. The original approver remains available if no valid delegate.
    if (delegates.length === 1) out.push({ userId: delegates[0].toUserId, fromUserId: id, delegationId: delegates[0].id });
    else out.push({ userId: id, fromUserId: id, delegationId: null });
  }
  return out;
}

/** Trusted operation scope, not a generic manager role or browser-provided cap. */
async function posDecisionAuthority(
  request: typeof approvalRequestsTable.$inferSelect, step: { approverRole: string; approverUserId: number | null },
  userId: number, connection: DbOrTx,
): Promise<string | null> {
  const key = request.recordRef?.split("— ")[1]?.trim();
  if (!request.companyId || !["pos.discount_pct", "pos.refund_amount"].includes(key ?? "") ||
    userId === request.submittedByUserId) return null;
  const paths = (await resolveApproverAuthorities(step.approverRole, step.approverUserId,
    request.branchId, request.companyId, connection, request)).filter(p => p.userId === userId);
  if (!paths.length) return null;
  const evidence = [];
  for (const path of paths.sort((a, b) => a.fromUserId - b.fromUserId || (a.delegationId ?? 0) - (b.delegationId ?? 0))) {
    const principals = [];
    for (const principal of [...new Set([path.userId, path.fromUserId])]) {
      const member = await workflowMember(request.companyId, principal, connection);
      if (!member) return null;
      const viewer = await approvalViewer(principal, request, connection);
      if (!viewer) return null;
      // A named reviewer still needs approval authority, not merely read access.
      // A bounded delegation may grant that operation to a native reader, but
      // never override the recipient's explicit custom denial.
      if ((principal === path.fromUserId || viewer.custom) &&
        !viewer.capabilities.includes("approve")) return null;
      const cap = await financialPolicy(request.companyId, member.role, key!, connection);
      if (cap.blocked || (cap.max != null && Number(request.amount) > cap.max)) return null;
      principals.push({ userId: principal, role: member.role, branch: member.branchId,
        capabilities: [...viewer.capabilities].sort(), branches: viewer.branches?.slice().sort((a,b) => a-b) ?? null,
        cap: cap.max, capSource: cap.source });
    }
    evidence.push({ ...path, principals });
  }
  return authorityFingerprint({ version: 1, company: request.companyId, branch: request.branchId, key, evidence });
}

/** Caller holds the source then request locks inside the financial transaction. */
export async function assertDeferredPosApproval(
  request: typeof approvalRequestsTable.$inferSelect, connection: DbOrTx,
) {
  await lockApprovalAuthority(connection);
  const policy = frozenApprovalPolicy(request);
  if (request.docType !== "pos_over_limit" || request.status !== "approved" ||
    request.reviewInvalidatedAt || !policy || !policy.steps.length) {
    throw new FinancialRequestError("اعتماد POS غير متاح للتنفيذ", 403);
  }
  const actions = await connection.select().from(approvalActionsTable)
    .where(and(eq(approvalActionsTable.requestId, request.id), eq(approvalActionsTable.action, "approve")))
    .orderBy(asc(approvalActionsTable.id));
  if (actions.length !== policy.steps.length) throw new FinancialRequestError("سلسلة الاعتماد غير مكتملة أو مكررة", 403);
  for (let index = 0; index < policy.steps.length; index++) {
    const step = policy.steps[index];
    const matches = actions.filter(a => a.stepSequence === step.sequence);
    const action = matches[0];
    if (matches.length !== 1 || action.approverUserId == null || !action.authorityFingerprint ||
      (policy.mode !== "parallel" && actions[index].id !== action.id) ||
      action.authorityFingerprint !== await posDecisionAuthority(request, step, action.approverUserId, connection)) {
      throw new FinancialRequestError("انتهت أهلية أحد المعتمدين أو تفويضه؛ يلزم مراجعة جديدة قبل تنفيذ البيع", 403);
    }
  }
}

async function returnDecisionAuthorities(request: typeof approvalRequestsTable.$inferSelect, userId: number,
  connection: DbOrTx, delayed = false): Promise<string[]> {
  const scoped = await scopedReturnGrants(connection, userId, request.companyId!, request.recordId, "pos.return.approve", delayed);
  if (scoped) return scoped.map(g => g.fingerprint);
  const actor = await approvalViewer(userId, request, connection);
  if (!actor || !actor.capabilities.includes("approve")) return [];
  const cap = await financialPolicy(request.companyId!, actor.role, "sales.credit_note_amount", connection);
  if (cap.blocked || cap.max != null && Number(request.amount) > cap.max) return [];
  const policy = await connection.execute(sql`SELECT * FROM return_policies WHERE company_id=${request.companyId!}
    AND branch_id IN (0,${request.branchId ?? 0}) ORDER BY branch_id DESC LIMIT 1`);
  return [authorityFingerprint({ version: 1, actor, cap, companyId: request.companyId, branchId: request.branchId,
    recordId: request.recordId, returnPolicy: policy.rows[0] ?? null })];
}

/** Receipt execution is a new financial acceptance, not replay of the decision. */
export async function assertDeferredReturnApproval(noteId: number, companyId: number, connection: DbOrTx) {
  await lockApprovalAuthority(connection);
  const controls = await connection.execute(sql`SELECT approval_id FROM return_controls
    WHERE note_id=${noteId} AND company_id=${companyId}`);
  if (controls.rows.length && controls.rows[0].approval_id == null) {
    // A direct decision is NOT an independent approval. It can wait for a
    // different receiver, but its original authority must still be usable.
    const direct = await connection.execute(sql`SELECT user_id,details::jsonb AS facts FROM audit_logs
      WHERE company_id=${companyId} AND action='pos.return.direct.used' AND entity='credit_note'
      AND details::jsonb->>'noteId'=${String(noteId)} ORDER BY id DESC LIMIT 1`);
    const saved = direct.rows[0];
    if (saved) {
      const facts = saved.facts as { authorityFingerprint?: string };
      const candidates = await scopedReturnGrants(connection, Number(saved.user_id), companyId, noteId, "pos.return.direct", true);
      const mandatory = await connection.execute(sql`SELECT EXISTS(SELECT 1 FROM approval_rules
        WHERE (company_id=${companyId} OR company_id IS NULL) AND doc_type='credit_note' AND is_active) AS required`);
      if (mandatory.rows[0]?.required || !facts.authorityFingerprint ||
        !candidates?.some(c => c.fingerprint === facts.authorityFingerprint)) {
        throw new FinancialRequestError("تغيرت أهلية قرار المرتجع المباشر؛ يلزم قرار جديد صالح قبل الاستلام", 403);
      }
      await assertReturnSnapshot(connection, noteId);
      return;
    }
  }
  const [request] = await connection.select().from(approvalRequestsTable).where(and(
    eq(approvalRequestsTable.id, Number(controls.rows[0]?.approval_id ?? -1)),
    eq(approvalRequestsTable.companyId, companyId))).for("update");
  if (!request || request.docType !== "credit_note" || request.recordId !== noteId ||
    request.status !== "approved" || request.reviewInvalidatedAt || !await approvalSourceMatches(request, connection)) {
    throw new FinancialRequestError("يلزم اعتماد مرتجع صالح لم يتغير مصدره قبل الاستلام", 409);
  }
  await assertReturnSnapshot(connection, noteId);
  const policy = frozenApprovalPolicy(request);
  const actions = await connection.select().from(approvalActionsTable).where(and(
    eq(approvalActionsTable.requestId, request.id), eq(approvalActionsTable.action, "approve")));
  if (!policy?.steps.length || actions.length !== policy.steps.length) throw new FinancialRequestError("سلسلة اعتماد المرتجع غير مكتملة", 403);
  for (const step of policy.steps) {
    const matches = actions.filter(a => a.stepSequence === step.sequence);
    const action = matches[0];
    if (matches.length !== 1 || !action.approverUserId || !action.authorityFingerprint ||
      !(await returnDecisionAuthorities(request, action.approverUserId, connection, true)).includes(action.authorityFingerprint)) {
      throw new FinancialRequestError("سحبت أو تغيرت أهلية معتمد المرتجع؛ يلزم مراجعة جديدة قبل التنفيذ", 403);
    }
    if (request.ruleId != null && !(await resolveApprovers(step.approverRole, step.approverUserId,
      request.branchId, companyId, connection, request)).includes(action.approverUserId)) {
      throw new FinancialRequestError("المعتمد لم يعد مؤهلًا في تسلسل المراجعة", 403);
    }
  }
}

// ---------------------------------------------------------------------------
// Approver acts on a request.
// ---------------------------------------------------------------------------
export type ActionKind = "approve" | "reject" | "request_changes" | "comment";

export async function actionableApprovalSteps(
  request: typeof approvalRequestsTable.$inferSelect, userId: number, connection: DbOrTx = db,
) {
  if (request.status !== "pending" || request.reviewInvalidatedAt ||
    !request.sourceFingerprint || request.submittedByUserId === userId ||
    !await approvalViewer(userId, request, connection)) return [];
  if (await isApprovalSourceCreator(request.companyId!, request.docType, request.recordId, userId, connection) ||
    !await approvalSourceMatches(request, connection)) return [];
  const policy = frozenApprovalPolicy(request);
  if (!policy) return [];
  let nativeReturnApprover = false;
  if(request.docType==="purchase_order"&&request.ruleId==null)
    nativeReturnApprover=!!await procurementReviewAuthority(connection,request.companyId!,userId,request.recordId);
  if(request.docType==="supplier_invoice"&&request.ruleId==null)
    nativeReturnApprover=!!await invoiceDecisionAuthority(connection,request.companyId!,userId,request.recordId);
  if (request.docType === "credit_note") {
    const controls = await connection.execute(sql`SELECT branch_id FROM return_controls
      WHERE note_id=${request.recordId} AND company_id=${request.companyId}`);
    const control = controls.rows[0];
    if (control) {
      try {
        await returnAuthorize(userId, request.companyId!, "approve", Number(control.branch_id), connection);
        await assertScopedReturnReview(connection, userId, request.companyId!, request.recordId);
        await assertReturnSnapshot(connection, request.recordId);
        nativeReturnApprover = request.ruleId == null;
      } catch (error) {
        if (typeof error === "object" && error != null && "status" in error &&
          (error.status === 403 || error.status === 409)) return [];
        throw error;
      }
    }
  }
  const actions = await connection.select().from(approvalActionsTable).where(eq(approvalActionsTable.requestId, request.id));
  const approved = new Set(actions.filter(a => a.action === "approve").map(a => a.stepSequence));
  const available = [];
  for (const step of policy.steps) {
    if (approved.has(step.sequence) || (policy.mode !== "parallel" && step.sequence !== request.currentStep)) continue;
    const resolved = await resolveApprovers(step.approverRole, step.approverUserId, request.branchId, request.companyId!, connection, request);
    if (resolved.includes(userId) || nativeReturnApprover) available.push({
      sequence: step.sequence, approverRole: step.approverRole, stepToken: reviewStepToken(request, step.sequence),
    });
  }
  return available;
}

export interface ActResult {
  status: string;
  finished: boolean;
  /** Internal transaction result; converted to HTTP 409 after commit. */
  reviewInvalidated?: boolean;
}

export async function actOnApproval(
  requestId: number,
  userId: number | null,
  userName: string | null,
  action: ActionKind,
  companyId: number,
  comment?: string,
  identity: DecisionIdentity = {},
): Promise<ActResult> {
  const effects: ApprovalEffect[] = [];
  const result = await db.transaction((tx) =>
    actOnApprovalTransaction(requestId, userId, userName, action, companyId, comment, tx, effects, identity));
  if (result.reviewInvalidated) throw new FinancialRequestError("تغيرت حقائق المستند أو لم تثبت؛ يلزم تقديم مراجعة جديدة", 409);
  // A notification failure after commit must never turn a confirmed financial
  // decision into a failed transaction response or re-run its business effect.
  for (const effect of effects) {
    try { await effect(); }
    catch (err) { logger.error({ err, requestId, companyId }, "approval post-commit effect failed"); }
  }
  return result;
}

export async function assertDeferredInvoiceApproval(companyId:number,id:number,connection:DbOrTx):Promise<boolean>{
  const [request]=await connection.select().from(approvalRequestsTable).where(and(
    eq(approvalRequestsTable.companyId,companyId),eq(approvalRequestsTable.docType,"supplier_invoice"),
    eq(approvalRequestsTable.recordId,id))).orderBy(desc(approvalRequestsTable.id)).limit(1).for("update");
  if(!request)return false;
  if(request.status!=="approved"||request.reviewInvalidatedAt||!await approvalSourceMatches(request,connection))
    throw new FinancialRequestError("اعتماد الفاتورة غير صالح لحقائقها الحالية",409);
  const policy=frozenApprovalPolicy(request);
  const actions=await connection.select().from(approvalActionsTable).where(and(
    eq(approvalActionsTable.requestId,request.id),eq(approvalActionsTable.action,"approve")));
  if(!policy||actions.length!==policy.steps.length)
    throw new FinancialRequestError("سلسلة اعتماد الفاتورة غير مكتملة",403);
  for(const step of policy.steps){
    const matches=actions.filter(a=>a.stepSequence===step.sequence),action=matches[0];
    if(matches.length!==1||!action.approverUserId||!action.authorityFingerprint||
      action.authorityFingerprint!==await invoiceDecisionAuthority(connection,companyId,action.approverUserId,id)||
      request.ruleId!=null&&!(await resolveApprovers(step.approverRole,step.approverUserId,request.branchId,companyId,connection,request)).includes(action.approverUserId))
      throw new FinancialRequestError("تغيرت أهلية معتمد الفاتورة؛ يلزم اعتماد جديد",403);
  }
  return true;
}

/** Sales conversion consumes the existing order decision, not the invoice
 * executor's authority. Source fingerprints deliberately exclude fulfilment
 * counters, but include the agreed pricing evidence and all material inputs. */
export async function assertDeferredSalesOrderApproval(companyId:number,id:number,amount:number,
  branchId:number|null,connection:DbOrTx,currentFinancialTotal=amount,financialFactsChanged=false){
  const [request]=await connection.select().from(approvalRequestsTable).where(and(
    eq(approvalRequestsTable.companyId,companyId),eq(approvalRequestsTable.docType,"sales_order"),
    eq(approvalRequestsTable.recordId,id))).orderBy(desc(approvalRequestsTable.id)).limit(1).for("update");
  if(!request){
    const rules=await approvalCandidates({companyId,docType:"sales_order",amount:currentFinancialTotal},connection);
    if(rules.some(r=>r.branchId==null||r.branchId===branchId))
      throw new FinancialRequestError("أمر البيع يحتاج اعتمادًا؛ لا تكفي حالته لتجاوز مسار الموافقات",409);
    return;
  }
  if(financialFactsChanged||Math.round(currentFinancialTotal*100)!==Math.round(amount*100))
    throw new FinancialRequestError("تغيرت الحقائق المالية الضريبية عن مبلغ اعتماد الأمر؛ يلزم مراجعة واعتماد جديدان",409);
  if(request.status!=="approved"||request.reviewInvalidatedAt||!await approvalSourceMatches(request,connection))
    throw new FinancialRequestError("اعتماد أمر البيع لا يطابق حقائقه الحالية",409);
  const policy=frozenApprovalPolicy(request);
  const actions=await connection.select().from(approvalActionsTable).where(and(
    eq(approvalActionsTable.requestId,request.id),eq(approvalActionsTable.action,"approve")));
  if(!policy||actions.length!==policy.steps.length)
    throw new FinancialRequestError("سلسلة اعتماد أمر البيع غير مكتملة",403);
  for(const step of policy.steps){
    const matches=actions.filter(a=>a.stepSequence===step.sequence),action=matches[0];
    if(matches.length!==1||!action?.approverUserId||
      !(await resolveApprovers(step.approverRole,step.approverUserId,request.branchId,companyId,connection,request)).includes(action.approverUserId))
      throw new FinancialRequestError("تغيرت أهلية معتمد أمر البيع؛ يلزم اعتماد صالح عند التنفيذ",403);
  }
}

async function actOnApprovalTransaction(
  requestId: number, userId: number | null, userName: string | null, action: ActionKind,
  companyId: number, comment: string | undefined, db: DbOrTx, effects: ApprovalEffect[],
  identity: DecisionIdentity,
): Promise<ActResult> {
  await lockApprovalAuthority(db);
  if (!Number.isSafeInteger(companyId) || companyId <= 0) throw new FinancialRequestError("يلزم نطاق شركة للاعتماد", 400);
  const [locator] = await db.select().from(approvalRequestsTable).where(and(
    eq(approvalRequestsTable.id, requestId), eq(approvalRequestsTable.companyId, companyId)));
  if (!locator) throw new FinancialRequestError("طلب الاعتماد غير موجود", 404);
  // Lock the source BEFORE the request, matching all native source writers.
  await approvalSourceFingerprint(companyId, locator.docType, locator.recordId, db);
  const [request] = await db
    .select()
    .from(approvalRequestsTable)
    .where(and(eq(approvalRequestsTable.id, requestId), eq(approvalRequestsTable.companyId, companyId))).for("update");
  if (!request) throw new FinancialRequestError("طلب الاعتماد غير موجود", 404);
  if (!companyId || !userId) throw new FinancialRequestError("يلزم عضو وشركة للاعتماد", 401);
  await db.execute(sql`SELECT u.id FROM users u
    JOIN user_companies m ON m.user_id=u.id
    WHERE u.id=${userId} AND m.company_id=${companyId}
    FOR SHARE OF u,m`);
  await assertWorkflowMember(companyId, userId, db);
  if (!await approvalViewer(userId, request, db)) throw new FinancialRequestError("المستند خارج صلاحية المستخدم الحالية", 403);
  if (identity.decisionId) {
    const [receipt] = await db.select().from(approvalActionsTable).where(and(
      eq(approvalActionsTable.requestId, request.id), eq(approvalActionsTable.decisionKey, identity.decisionId)));
    if (receipt) {
      if (receipt.approverUserId !== userId || receipt.decisionFingerprint !== decisionIntent(userId, action, comment, identity.stepToken)) {
        throw new FinancialRequestError("هوية القرار مستخدمة لمدخلات مختلفة؛ لم ينفذ قرار آخر", 409);
      }
      return decisionResultSchema.parse(receipt.decisionResult);
    }
  }
  if (request.reviewInvalidatedAt) throw new FinancialRequestError("انتهت صلاحية هذه المراجعة؛ افتح الطلب الجديد", 409);
  const execution: ApprovalExecutionContext = {
    connection: db, companyId, userId, afterCommit: (effect) => { effects.push(effect); },
  };
  if (request.branchId != null) await assertCompanyBranch(request.branchId, companyId);
  if (request.status !== "pending") {
    if (action === "approve" && request.status === "approved" && frozenApprovalPolicy(request)) {
      const [decision] = await db.select({ id: approvalActionsTable.id }).from(approvalActionsTable)
        .where(and(eq(approvalActionsTable.requestId, requestId), eq(approvalActionsTable.action, "approve"),
          eq(approvalActionsTable.approverUserId, userId))).limit(1);
      if (decision) return { status: "approved", finished: true };
    }
    throw new FinancialRequestError("هذا الطلب لم يعد مفتوحاً", 409);
  }
  let returnApprover = false;
  if (request.docType === "credit_note" && action !== "comment") {
    const controls = await db.execute(sql`SELECT company_id,branch_id FROM return_controls WHERE note_id=${request.recordId}`);
    const control = controls.rows[0];
    if (control) {
      if (Number(control.company_id) !== companyId) throw new FinancialRequestError("مصدر المرتجع لا يطابق شركة المراجعة", 403);
      if (!userId) throw new Error("يلزم معتمد مسجل");
      await returnAuthorize(userId, Number(control.company_id), "approve", Number(control.branch_id), db);
      await assertScopedReturnReview(db, userId, companyId, request.recordId);
      await assertReturnSnapshot(db, request.recordId);
      returnApprover = true;
    }
  }

  const policy = frozenApprovalPolicy(request);
  const rule = policy ?? (request.ruleId
    ? (await db.select().from(approvalRulesTable).where(and(eq(approvalRulesTable.id, request.ruleId),
      eq(approvalRulesTable.companyId, companyId))))[0]
    : undefined);
  if (request.ruleId && !rule) throw new FinancialRequestError("قاعدة اعتماد غير متاحة في الشركة", 409);
  // Forced approvals (ruleId === null) persist their synthesized step
  // chain on the request itself (forcedSteps jsonb). We materialize that
  // chain so the rest of the act flow works uniformly with rule-based
  // requests, including multi-role sequential chains.
  const forcedSteps = (request.forcedSteps as Array<{
    sequence: number;
    approverRole: string;
    approverUserId: number | null;
  }> | null) ?? null;
  const allSteps = policy?.steps ?? (request.ruleId
    ? await db
        .select()
        .from(approvalStepsTable)
        .where(eq(approvalStepsTable.ruleId, request.ruleId))
        .orderBy(asc(approvalStepsTable.sequence))
    : (forcedSteps && forcedSteps.length > 0
        ? forcedSteps.map((s) => ({ id: -s.sequence, ruleId: -1, sequence: s.sequence, approverRole: s.approverRole, approverUserId: s.approverUserId, minAmount: "0" }))
        : ([{ id: -1, ruleId: -1, sequence: 1, approverRole: "manager", approverUserId: null, minAmount: "0" }] as Array<typeof approvalStepsTable.$inferSelect>)));
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
  const targetedSteps = identity.stepToken
    ? actionableSteps.filter(s => reviewStepToken(request, s.sequence) === identity.stepToken)
    : actionableSteps;
  if (identity.stepToken && targetedSteps.length === 0) {
    throw new FinancialRequestError("الخطوة المقصودة انتهت أو تغيرت المراجعة؛ لم يستهلك القرار خطوة أخرى", 409);
  }

  // Authorization is strict: only resolved approvers (including delegates)
  // for an actionable step may approve / reject / request_changes. There is
  // no "owner/manager override" — that would silently let any manager act
  // on accountant-only steps and defeat the approval matrix. Use the admin
  // matrix UI to reconfigure rules instead.
  const purchaseAuthority=request.docType==="purchase_order"
    ? await procurementReviewAuthority(db,companyId,userId,request.recordId)
    :request.docType==="supplier_invoice" && userId!=null
      ?await invoiceDecisionAuthority(db,companyId,userId,request.recordId):null;
  let actingStep: number | null = null;
  if(purchaseAuthority && request.ruleId==null) actingStep=targetedSteps[0]?.sequence??null;
  if (returnApprover && request.ruleId == null) actingStep = targetedSteps[0]?.sequence ?? null;
  if (userId != null) {
    for (const s of targetedSteps) {
      const resolved = await resolveApprovers(s.approverRole, s.approverUserId, request.branchId ?? null, companyId, db, request);
      if (resolved.includes(userId)) {
        actingStep = s.sequence;
        break;
      }
    }
  }
  const isSubmitter = userId != null && (request.submittedByUserId === userId ||
    await isApprovalSourceCreator(companyId, request.docType, request.recordId, userId, db));

  if (action === "comment") {
    // Comments are open to anyone with a stake (an actionable approver or
    // the submitter). Anything else would let unrelated users pollute the
    // trail.
    if (actingStep == null && !isSubmitter) {
      throw new FinancialRequestError("ليست لديك صلاحية إضافة تعليق على هذا الطلب", 403);
    }
    actingStep = actingStep ?? request.currentStep;
  } else {
    if (actingStep == null) {
      throw new FinancialRequestError("ليست لديك صلاحية اتخاذ إجراء على هذا الطلب", 403);
    }
    // Segregation of Duties: the user who submitted the request can never
    // approve / reject / request changes on their own request — even if they
    // happen to belong to an authorized approver role. This is the core of
    // the four-eyes (دعم المراقبة الثنائية) principle. Commenting is still
    // allowed above so the submitter can clarify.
    if (isSubmitter) {
      throw new FinancialRequestError("لا يمكنك اعتماد طلب قمت بإنشائه (مبدأ فصل المهام)", 403);
    }
  }

  if (action === "approve" && !policy) {
    throw new FinancialRequestError("الطلب القديم بلا نسخة سياسة مثبتة؛ اطلب إعادة تقديمه من المستند للمراجعة", 409);
  }
  if (action !== "comment" && steps.length > 1 && (!identity.stepToken || !identity.decisionId)) {
    throw new FinancialRequestError("يلزم تحديد هوية المراجعة والخطوة والمحاولة للقرار متعدد الخطوات", 400);
  }
  if (action === "approve" && !await approvalSourceMatches(request, db)) {
    await db.update(approvalRequestsTable).set({
      status: "changes_requested", decidedAt: new Date(), reviewInvalidatedAt: new Date(),
      reviewInvalidatedReason: "فشلت مطابقة بصمة حقائق المصدر؛ لا اعتماد دون مراجعة جديدة",
    }).where(eq(approvalRequestsTable.id, request.id));
    await db.insert(approvalActionsTable).values({
      requestId: request.id, stepSequence: request.currentStep, action: "comment", approverName: "system",
      comment: "أوقفت مراجعة بلا حقائق مصدر مطابقة؛ يلزم إعادة التقديم.",
    });
    return { status: "changes_requested", finished: true, reviewInvalidated: true };
  }
  const decisionResult = action === "comment" ? { status: request.status, finished: false }
    : action === "reject" ? { status: "rejected", finished: true }
    : action === "request_changes" ? { status: "changes_requested", finished: true }
    : steps.every(s => approvedSeq.has(s.sequence) || s.sequence === actingStep)
      ? { status: "approved", finished: true } : { status: "pending", finished: false };
  const authority = action==="approve" && ["purchase_order","supplier_invoice"].includes(request.docType) ? purchaseAuthority : action === "approve" && request.docType === "pos_over_limit" && userId != null
    ? await posDecisionAuthority(request, steps.find(s => s.sequence === actingStep)!, userId, db)
    : action === "approve" && request.docType === "credit_note" && userId != null
      ? (await returnDecisionAuthorities(request, userId, db))[0] ?? null : null;
  if (action === "approve" && request.docType === "pos_over_limit" && !authority) {
    throw new FinancialRequestError("صلاحية المعتمد الحالية أو حده المالي لا يسمحان بهذه العملية", 403);
  }
  if(action==="approve"&&["purchase_order","supplier_invoice"].includes(request.docType)&&!authority)
    throw new FinancialRequestError("المراجع لا يملك صلاحية اعتماد حالية على حقائق أمر الشراء",403);
  if (action === "approve" && request.docType === "credit_note" && !authority) {
    const operational = await db.execute(sql`SELECT note_id FROM return_controls WHERE note_id=${request.recordId} AND company_id=${companyId}`);
    if (operational.rows.length) throw new FinancialRequestError("صلاحية معتمد المرتجع أو حده المالي غير متاحين", 403);
  }
  await db.insert(approvalActionsTable).values({
    requestId,
    stepSequence: actingStep,
    approverUserId: userId,
    approverName: userName,
    action,
    comment: comment ?? null,
    decisionKey: identity.decisionId ?? null,
    decisionFingerprint: identity.decisionId ? decisionIntent(userId, action, comment, identity.stepToken) : null,
    decisionResult: identity.decisionId ? decisionResult : null,
    authorityFingerprint: authority,
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
        await rejectHandler(request.recordId, requestId, finalStatus as "rejected" | "changes_requested", execution);
      } catch (err) {
        logger.error({ err, requestId, docType: request.docType }, "approval reject handler failed");
        throw err;
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
      }, db);
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
      }, db);
    }
    const handler = handlers.get(request.docType as DocType);
    if (handler) {
      try {
        await handler(request.recordId, requestId, execution);
        if (!await approvalSourceMatches(request, db)) {
          throw new FinancialRequestError("غير التنفيذ حقيقة جوهرية غير مشمولة بالمراجعة؛ ألغيت المعاملة كاملة", 409);
        }
      } catch (err) {
        // The surrounding transaction rolls back the decision, action,
        // notification and module writes together.
        logger.error({ err, requestId, docType: request.docType }, "approval finalize handler failed — transaction rolled back");
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
      }, db);
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
  connection: DbOrTx = db,
): Promise<{ allowed: boolean; max: number | null; source: string; reason?: string }> {
  const member = await assertWorkflowMember(companyId, userId, connection);
  const managed = await managedProfile(userId, companyId, connection);
  if (branchId != null) {
    await assertCompanyBranch(branchId, companyId);
    const responsibility = managed && await selectedResponsibility(userId, companyId, connection);
    if (managed && (!responsibility || responsibility.branchId !== branchId) ||
      !managed && member.role !== "owner" && member.branchId != null && member.branchId !== branchId) {
      throw new FinancialRequestError("الفرع خارج نطاق العضو", 403);
    }
  }
  if (!Number.isFinite(value) || value < 0) throw new FinancialRequestError("قيمة مالية غير صحيحة", 400);
  const role = managed ? "scoped" : member.role;
  // This only selects the cap; POS still verifies the immutable transaction
  // fingerprint and consumes the approval atomically with the sale.
  if (approvalRequestId != null) {
    const [approval] = await connection.select().from(approvalRequestsTable).where(and(
      eq(approvalRequestsTable.id, approvalRequestId), eq(approvalRequestsTable.companyId, companyId),
      eq(approvalRequestsTable.submittedByUserId, userId), eq(approvalRequestsTable.status, "approved"),
      eq(approvalRequestsTable.docType, "pos_over_limit"),
    ));
    if (!approval || approval.reviewInvalidatedAt || !approval.sourceFingerprint || approval.sourceFingerprintVersion !== 1 ||
      !frozenApprovalPolicy(approval) || !actionKey.startsWith("pos.") || approval.branchId !== branchId) {
      throw new FinancialRequestError("اعتماد الحد غير متاح", 403);
    }
    // Only this exact approved action is exempt from the submitter's cap.
    // The approvers' real, current caps are checked; no role is promoted.
    if (approval.recordRef?.split("— ")[1]?.trim() === actionKey && value <= Number(approval.amount)) {
      await assertDeferredPosApproval(approval, connection);
      return { allowed: true, max: Number(approval.amount), source: "operation_approval" };
    }
  }
  const policy = await financialPolicy(companyId, role, actionKey, connection);
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
