import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db, companiesTable, usersTable, userCompaniesTable, branchesTable, auditLogsTable,
  approvalRulesTable, approvalStepsTable, approvalRequestsTable, approvalActionsTable, approverDelegationsTable, notificationInboxTable,
  warehousesTable, posSessionsTable,
  financialLimitsTable,
  automationRulesTable, automationRunsTable, purchaseOrdersTable, purchaseOrderLinesTable, suppliersTable,
} from "@workspace/db";
import app from "../app";
import { cleanupCompanyDefaults } from "../test/cleanup-company-defaults";
import { submitForApproval, resolveApprovers, actOnApproval, checkFinancialLimit } from "../lib/workflow-engine";
import { triggerEvent, runScheduledAutomations } from "../lib/workflow-automation";
import { notify } from "../lib/workflow-notifications";
import { approvalSourceFingerprint } from "../lib/approval-source";

const tag = `workflow-tenants-${Date.now()}`;
const password = "SyntheticWorkflow123!";
type Agent = ReturnType<typeof request.agent>;
const ids: number[] = [];
const ruleIds: number[] = [];
const requestIds: number[] = [];
const sessionIds: number[] = [];
const extraPoIds: number[] = [];
const legacyLimitIds: number[] = [];
let a: number, b: number, branchA: number, branchB: number, branchA2: number;
let maker: Agent, owner: Agent, manager: Agent, foreign: Agent, delegate: Agent;
let makerId: number, managerId: number, foreignId: number, delegateId: number;
let ownerId: number, branchManagerId: number, branchManager: Agent, poA: number, poB: number, poA2: number;
const supplierIds: number[] = [];

async function user(companyId: number, membershipRole: string, globalRole: string) {
  const [row] = await db.insert(usersTable).values({
    name: `${tag}-${ids.length}`, email: `${tag}-${ids.length}@example.invalid`,
    passwordHash: await bcrypt.hash(password, 4), role: globalRole, isActive: true,
  }).returning();
  ids.push(row.id);
  await db.insert(userCompaniesTable).values({ userId: row.id, companyId, role: membershipRole, isDefault: true });
  const agent = request.agent(app);
  expect((await agent.post("/api/auth/login").send({ email: row.email, password })).status).toBe(200);
  return { agent, id: row.id };
}
const window = () => ({
  fromDate: new Date(Date.now() - 60_000).toISOString(),
  toDate: new Date(Date.now() + 3_600_000).toISOString(),
  branchId: null, docTypes: ["pos_over_limit"], maxAmount: 2,
});
async function pending(amount = 1) {
  const [session] = await db.insert(posSessionsTable).values({
    branchId: branchA, sessionNumber: `${tag}-${sessionIds.length}`, cashierName: tag,
  }).returning();
  sessionIds.push(session.id);
  const result = await submitForApproval({
    companyId: a, branchId: branchA, docType: "pos_over_limit", recordId: session.id,
    recordRef: `${tag} — pos.discount_pct`, submittedByUserId: makerId, submittedByName: tag, amount, forceRoles: ["manager"],
  });
  expect(result.required).toBe(true);
  requestIds.push(result.requestId!);
  return result.requestId!;
}
const ruleBody = (extra = {}) => ({
  name: tag, docType: "purchase_order", minAmount: 0, mode: "sequential",
  steps: [{ sequence: 1, approverRole: "manager", minAmount: 0 }], ...extra,
});
async function approvalOrder(amount: string) {
  const [original] = await db.select().from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, poA));
  const [po] = await db.insert(purchaseOrdersTable).values({
    companyId: a, warehouseId: original.warehouseId, supplierId: original.supplierId, supplierName: tag,
    reference: `${tag}-approval-${extraPoIds.length}`, orderDate: "2026-10-23",
    status: "pending_approval", total: amount,
  }).returning();
  extraPoIds.push(po.id);
  return po;
}
async function orderReview(recordId: number, amount: number) {
  const result = await submitForApproval({
    companyId: a, branchId: branchA, docType: "purchase_order", recordId,
    amount, submittedByUserId: makerId, submittedByName: tag, forceRoles: ["manager"],
  });
  if (result.requestId && !requestIds.includes(result.requestId)) requestIds.push(result.requestId);
  return result;
}

beforeAll(async () => {
  const [ca, cb] = await db.insert(companiesTable).values([
    { name: `${tag}-A` }, { name: `${tag}-B` },
  ]).returning();
  a = ca.id; b = cb.id;
  const branches = await db.insert(branchesTable).values([
    { companyId: a, name: tag, nameAr: tag, city: "Synthetic" },
    { companyId: b, name: tag, nameAr: tag, city: "Synthetic" },
    { companyId: a, name: `${tag}-A2`, nameAr: tag, city: "Synthetic" },
  ]).returning();
  branchA = branches[0].id; branchB = branches[1].id; branchA2 = branches[2].id;
  ({ agent: owner, id: ownerId } = await user(a, "owner", "owner"));
  ({ agent: maker, id: makerId } = await user(a, "sales", "owner"));
  ({ agent: manager, id: managerId } = await user(a, "manager", "sales"));
  ({ agent: foreign, id: foreignId } = await user(b, "manager", "manager"));
  ({ agent: delegate, id: delegateId } = await user(a, "cashier", "cashier"));
  ({ agent: branchManager, id: branchManagerId } = await user(a, "manager", "manager"));
  await db.update(usersTable).set({ branchId: branchA2 }).where(eq(usersTable.id, branchManagerId));
  await db.insert(userCompaniesTable).values({ userId: ownerId, companyId: b, role: "cashier" });
  const suppliers = await db.insert(suppliersTable).values([{ companyId: a, name: tag }, { companyId: b, name: tag }]).returning();
  supplierIds.push(...suppliers.map(x => x.id));
  for (const [companyId, branchId, supplierId, name] of [[a, branchA, suppliers[0].id, "A"], [b, branchB, suppliers[1].id, "B"], [a, branchA2, suppliers[0].id, "A2"]] as const) {
    const [warehouse] = await db.insert(warehousesTable).values({ companyId, branchId, name: tag, nameAr: tag }).returning();
    const [po] = await db.insert(purchaseOrdersTable).values({
      companyId, warehouseId: warehouse.id, supplierId, supplierName: tag, reference: `${tag}-${name}`,
      orderDate: "2026-10-23", total: "10", notes: "original",
    }).returning();
    if (name === "A") poA = po.id; else if (name === "B") poB = po.id; else poA2 = po.id;
  }
});

afterAll(async () => {
  await db.delete(automationRulesTable).where(sql`${automationRulesTable.companyId} IN (${a},${b}) OR ${automationRulesTable.name} = ${tag}`);
  // Financial history is removed only in this disposable fixture, before
  // deleting its confirmed source records. The application forbids that edit.
  await db.delete(approvalRequestsTable).where(inArray(approvalRequestsTable.id, requestIds));
  await db.delete(purchaseOrdersTable).where(inArray(purchaseOrdersTable.id, [poA, poB, poA2, ...extraPoIds]));
  await db.delete(suppliersTable).where(inArray(suppliersTable.id, supplierIds));
  await db.delete(financialLimitsTable).where(sql`${financialLimitsTable.companyId} IN (${a},${b}) OR ${financialLimitsTable.id} IN (${legacyLimitIds.length ? sql.join(legacyLimitIds.map(x => sql`${x}`), sql`,`) : sql`-1`})`);
  await db.delete(notificationInboxTable).where(inArray(notificationInboxTable.userId, ids));
  await db.delete(approverDelegationsTable).where(orOwnedDelegations());
  await db.delete(approvalRequestsTable).where(inArray(approvalRequestsTable.id, requestIds));
  await db.delete(posSessionsTable).where(inArray(posSessionsTable.id, sessionIds));
  await db.delete(approvalRulesTable).where(inArray(approvalRulesTable.id, ruleIds));
  await db.delete(auditLogsTable).where(inArray(auditLogsTable.companyId, [a, b]));
  await db.delete(userCompaniesTable).where(inArray(userCompaniesTable.companyId, [a, b]));
  await db.delete(usersTable).where(inArray(usersTable.id, ids));
  await db.delete(warehousesTable).where(inArray(warehousesTable.companyId, [a, b]));
  await db.delete(branchesTable).where(inArray(branchesTable.id, [branchA, branchB, branchA2]));
  await cleanupCompanyDefaults([a, b]);
  await db.delete(companiesTable).where(inArray(companiesTable.id, [a, b]));
});
function orOwnedDelegations() {
  return sql`${approverDelegationsTable.companyId} IN (${a},${b}) OR ${approverDelegationsTable.reason} = ${tag}`;
}

function registerApprovalSnapshotCases() {
describe("approval snapshot and atomic execution", () => {
  it("does not let the native document creator approve a request submitted by another employee", async () => {
    const po = await approvalOrder("24");
    await db.update(purchaseOrdersTable).set({ createdBy: managerId }).where(eq(purchaseOrdersTable.id, po.id));
    const review = await orderReview(po.id, 24);
    expect((await manager.get(`/api/workflow/approval-requests/${review.requestId}`)).body.actionableSteps).toEqual([]);
    expect((await manager.post(`/api/workflow/approval-requests/${review.requestId}/act`).send({ action: "approve" })).status).toBe(403);
    expect((await db.select().from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, po.id)))[0].status).not.toBe("confirmed");
  });
  it("binds a repeated concurrent decision to its original sequential step and original result", async () => {
    const created = await owner.post("/api/workflow/approval-rules").send(ruleBody({
      branchId: branchA, minAmount: 500, maxAmount: 501,
      steps: [{ sequence: 1, approverRole: "manager" }, { sequence: 2, approverRole: "manager" }],
    }));
    expect(created.status).toBe(201); ruleIds.push(created.body.id);
    const po = await approvalOrder("500");
    const review = await orderReview(po.id, 500);
    const detail = await manager.get(`/api/workflow/approval-requests/${review.requestId}`);
    expect(detail.body.actionableSteps).toHaveLength(1);
    const first = { action: "approve", stepToken: detail.body.actionableSteps[0].stepToken, decisionId: randomUUID() };
    const responses = await Promise.all([manager.post(`/api/workflow/approval-requests/${review.requestId}/act`).send(first),
      manager.post(`/api/workflow/approval-requests/${review.requestId}/act`).send(first)]);
    for (const response of responses) expect(response.body).toMatchObject({ status: "pending", finished: false });
    const later = await manager.get(`/api/workflow/approval-requests/${review.requestId}`);
    expect(later.body.currentStep).toBe(2);
    expect(later.body.actions.filter((x: { action: string }) => x.action === "approve")).toHaveLength(1);
    expect((await manager.post(`/api/workflow/approval-requests/${review.requestId}/act`).send(first)).body).toMatchObject({ status: "pending", finished: false });
    expect((await manager.post(`/api/workflow/approval-requests/${review.requestId}/act`).send({ ...first, comment: "different intent" })).status).toBe(409);
    expect((await manager.post(`/api/workflow/approval-requests/${review.requestId}/act`).send({ ...first, decisionId: randomUUID() })).status).toBe(409);
    expect((await manager.post(`/api/workflow/approval-requests/${review.requestId}/act`).send({
      action: "approve", stepToken: later.body.actionableSteps[0].stepToken, decisionId: randomUUID(),
    })).body).toMatchObject({ status: "approved", finished: true });
    expect((await db.select().from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, po.id)))[0].status).toBe("confirmed");
  });

  it("targets independent parallel steps and preserves a rejected decision under retries", async () => {
    const created = await owner.post("/api/workflow/approval-rules").send(ruleBody({
      branchId: branchA, minAmount: 501, maxAmount: 502, mode: "parallel",
      steps: [{ sequence: 1, approverRole: "manager" }, { sequence: 2, approverRole: "manager" }],
    }));
    expect(created.status).toBe(201); ruleIds.push(created.body.id);
    const po = await approvalOrder("501");
    const review = await orderReview(po.id, 501);
    let detail = await manager.get(`/api/workflow/approval-requests/${review.requestId}`);
    expect(detail.body.actionableSteps).toHaveLength(2);
    const approve = { action: "approve", stepToken: detail.body.actionableSteps[1].stepToken, decisionId: randomUUID() };
    expect((await manager.post(`/api/workflow/approval-requests/${review.requestId}/act`).send(approve)).body.finished).toBe(false);
    detail = await manager.get(`/api/workflow/approval-requests/${review.requestId}`);
    expect(detail.body.actionableSteps.map((s: { sequence: number }) => s.sequence)).toEqual([1]);
    const reject = { action: "reject", stepToken: detail.body.actionableSteps[0].stepToken, decisionId: randomUUID(), comment: "needs correction" };
    expect((await manager.post(`/api/workflow/approval-requests/${review.requestId}/act`).send(reject)).body).toMatchObject({ status: "rejected", finished: true });
    expect((await manager.post(`/api/workflow/approval-requests/${review.requestId}/act`).send(reject)).body).toMatchObject({ status: "rejected", finished: true });
    const history = await db.select().from(approvalActionsTable).where(eq(approvalActionsTable.requestId, review.requestId!));
    expect(history.filter(a => a.action === "approve")).toHaveLength(1);
    expect(history.filter(a => a.action === "reject")).toHaveLength(1);
    expect((await db.select().from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, po.id)))[0].status).not.toBe("confirmed");
    const changedSource = await approvalOrder("501");
    const changedReview = await orderReview(changedSource.id, 501);
    const changedDetail = await manager.get(`/api/workflow/approval-requests/${changedReview.requestId}`);
    const changes = { action: "request_changes", stepToken: changedDetail.body.actionableSteps[0].stepToken,
      decisionId: randomUUID(), comment: "Please amend the source" };
    for (let attempt = 0; attempt < 2; attempt++) {
      expect((await manager.post(`/api/workflow/approval-requests/${changedReview.requestId}/act`).send(changes)).body)
        .toMatchObject({ status: "changes_requested", finished: true });
    }
    const changeActions = await db.select().from(approvalActionsTable).where(eq(approvalActionsTable.requestId, changedReview.requestId!));
    expect(changeActions.filter(a => a.action === "request_changes")).toHaveLength(1);
    expect((await db.select().from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, changedSource.id)))[0].status).not.toBe("confirmed");
  });

  it("distinguishes unread notification history from an actionable approval after the decision", async () => {
    const po = await approvalOrder("23");
    const review = await orderReview(po.id, 23);
    const before = await manager.get("/api/workflow/inbox");
    const entry = before.body.find((x: { payload?: { requestId?: number } }) => x.payload?.requestId === review.requestId);
    expect(entry).toMatchObject({ isRead: false, requiresAction: true });
    expect((await manager.post(`/api/workflow/approval-requests/${review.requestId}/act`).send({ action: "approve" })).status).toBe(200);
    const after = await manager.get("/api/workflow/inbox");
    const updated = after.body.find((x: { id: number }) => x.id === entry.id);
    expect(updated).toMatchObject({ isRead: false, requiresAction: false, requestStatus: "approved" });
    expect(updated.message).not.toContain("بانتظار اعتمادك");
    const [stored] = await db.select().from(notificationInboxTable).where(eq(notificationInboxTable.id, entry.id));
    expect(stored.message).toContain("بانتظار اعتمادك");
  });
  it("invalidates a supplier change with an unchanged total and requires a new source review", async () => {
    const po = await approvalOrder("40");
    const original = await orderReview(po.id, 40);
    const [supplier] = await db.insert(suppliersTable).values({ companyId: a, name: `${tag}-replacement` }).returning();
    supplierIds.push(supplier.id);
    await db.update(purchaseOrdersTable).set({ supplierId: supplier.id, supplierName: supplier.name }).where(eq(purchaseOrdersTable.id, po.id));
    const [old] = await db.select().from(approvalRequestsTable).where(eq(approvalRequestsTable.id, original.requestId!));
    expect(old).toMatchObject({ status: "changes_requested" });
    expect(old.reviewInvalidatedAt).not.toBeNull();
    expect((await manager.post(`/api/workflow/approval-requests/${old.id}/act`).send({ action: "approve" })).status).toBe(409);
    const replacement = await orderReview(po.id, 40);
    expect(replacement.requestId).not.toBe(old.id);
    const [fresh] = await db.select().from(approvalRequestsTable).where(eq(approvalRequestsTable.id, replacement.requestId!));
    expect(fresh.sourceFingerprint).not.toBe(old.sourceFingerprint);
    expect(fresh.sourceFingerprintVersion).toBe(1);
  });

  it("binds line quantities and equal-total distributions, not just the header amount", async () => {
    const po = await approvalOrder("40");
    const lines = await db.insert(purchaseOrderLinesTable).values([
      { poId: po.id, description: "أول", quantity: "2", unitPrice: "10", lineTotal: "20" },
      { poId: po.id, description: "ثان", quantity: "2", unitPrice: "10", lineTotal: "20" },
    ]).returning();
    const review = await orderReview(po.id, 40);
    await db.transaction(async tx => {
      await tx.update(purchaseOrderLinesTable).set({ quantity: "1", lineTotal: "10" }).where(eq(purchaseOrderLinesTable.id, lines[0].id));
      await tx.update(purchaseOrderLinesTable).set({ quantity: "3", lineTotal: "30" }).where(eq(purchaseOrderLinesTable.id, lines[1].id));
    });
    const [stored] = await db.select().from(approvalRequestsTable).where(eq(approvalRequestsTable.id, review.requestId!));
    expect(stored.reviewInvalidatedAt).not.toBeNull();
    expect((await db.select().from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, po.id)))[0].total).toBe("40.00");
    expect((await manager.post(`/api/workflow/approval-requests/${stored.id}/act`).send({ action: "approve" })).status).toBe(409);
  });

  it("binds currency and warehouse branch but excludes supplier-email display metadata", async () => {
    const po = await approvalOrder("20");
    const first = await orderReview(po.id, 20);
    await db.update(purchaseOrdersTable).set({ sentToSupplierAt: new Date(), sentToSupplierEmail: "synthetic@example.invalid" }).where(eq(purchaseOrdersTable.id, po.id));
    let [stored] = await db.select().from(approvalRequestsTable).where(eq(approvalRequestsTable.id, first.requestId!));
    expect(stored.reviewInvalidatedAt).toBeNull();
    expect(await approvalSourceFingerprint(a, "purchase_order", po.id, db)).toBe(stored.sourceFingerprint);
    await db.update(purchaseOrdersTable).set({ currencyCode: "USD" }).where(eq(purchaseOrdersTable.id, po.id));
    [stored] = await db.select().from(approvalRequestsTable).where(eq(approvalRequestsTable.id, first.requestId!));
    expect(stored.reviewInvalidatedAt).not.toBeNull();
    const fresh = await orderReview(po.id, 20);
    const [warehouse] = await db.select().from(warehousesTable).where(eq(warehousesTable.branchId, branchA2));
    await db.update(purchaseOrdersTable).set({ warehouseId: warehouse.id }).where(eq(purchaseOrdersTable.id, po.id));
    expect((await db.select().from(approvalRequestsTable).where(eq(approvalRequestsTable.id, fresh.requestId!)))[0].reviewInvalidatedAt).not.toBeNull();
  });

  it("does not lose decimal precision through JavaScript JSON parsing", async () => {
    const po = await approvalOrder("90071992547409.01");
    const first = await approvalSourceFingerprint(a, "purchase_order", po.id, db);
    await db.update(purchaseOrdersTable).set({ total: "90071992547409.02" }).where(eq(purchaseOrdersTable.id, po.id));
    expect(await approvalSourceFingerprint(a, "purchase_order", po.id, db)).not.toBe(first);
  });

  it("authorizes the intended reviewer before invalidating mismatching evidence", async () => {
    const po = await approvalOrder("21");
    const review = await orderReview(po.id, 21);
    await db.update(approvalRequestsTable).set({ sourceFingerprint: "mismatching-test-proof" }).where(eq(approvalRequestsTable.id, review.requestId!));
    expect((await owner.post(`/api/workflow/approval-requests/${review.requestId}/act`).send({ action: "approve" })).status).toBe(403);
    expect((await db.select().from(approvalRequestsTable).where(eq(approvalRequestsTable.id, review.requestId!)))[0].reviewInvalidatedAt).toBeNull();
    expect((await manager.post(`/api/workflow/approval-requests/${review.requestId}/act`).send({ action: "approve" })).status).toBe(409);
    expect((await db.select().from(approvalRequestsTable).where(eq(approvalRequestsTable.id, review.requestId!)))[0].status).toBe("changes_requested");
    expect((await db.select().from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, po.id)))[0].status).toBe("pending_approval");
  });

  it("serializes material edits against decision and execution without rewriting a committed decision", async () => {
    const po = await approvalOrder("22");
    const review = await orderReview(po.id, 22);
    const outcomes = await Promise.allSettled([
      db.update(purchaseOrdersTable).set({ supplierName: `${tag}-concurrent` }).where(eq(purchaseOrdersTable.id, po.id)),
      manager.post(`/api/workflow/approval-requests/${review.requestId}/act`).send({ action: "approve" }),
    ]);
    const [stored] = await db.select().from(approvalRequestsTable).where(eq(approvalRequestsTable.id, review.requestId!));
    const [current] = await db.select().from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, po.id));
    const decisions = await db.select().from(approvalActionsTable).where(and(
      eq(approvalActionsTable.requestId, stored.id), eq(approvalActionsTable.action, "approve")));
    if (stored.status === "approved") {
      expect(current).toMatchObject({ status: "confirmed", supplierName: po.supplierName });
      expect(decisions).toHaveLength(1);
      expect(outcomes[0].status).toBe("rejected");
      const decidedAt = stored.decidedAt;
      await expect(db.update(purchaseOrdersTable).set({ notes: "material purpose changed" }).where(eq(purchaseOrdersTable.id, po.id))).rejects.toThrow();
      expect((await db.select().from(approvalRequestsTable).where(eq(approvalRequestsTable.id, stored.id)))[0].decidedAt).toEqual(decidedAt);
    } else {
      expect(stored).toMatchObject({ status: "changes_requested" });
      expect(stored.reviewInvalidatedAt).not.toBeNull();
      expect(current.status).toBe("pending_approval");
      expect(decisions).toHaveLength(0);
      expect(outcomes[0].status).toBe("fulfilled");
      expect(outcomes[1].status === "fulfilled" && outcomes[1].value.status).toBe(409);
    }
  });
  it("starts a new review for a changed POS intent without rewriting the original approved decision", async () => {
    const firstId = await pending();
    expect((await manager.post(`/api/workflow/approval-requests/${firstId}/act`).send({ action: "approve" })).status).toBe(200);
    const [original] = await db.select().from(approvalRequestsTable).where(eq(approvalRequestsTable.id, firstId));
    const next = await submitForApproval({
      companyId: a, branchId: branchA, docType: "pos_over_limit", recordId: original.recordId,
      amount: Number(original.amount), notes: "different synthetic intent", submittedByUserId: makerId, forceRoles: ["manager"],
    });
    requestIds.push(next.requestId!);
    expect(next).toMatchObject({ required: true, status: "pending" });
    expect(next.requestId).not.toBe(firstId);
    const [historical] = await db.select().from(approvalRequestsTable).where(eq(approvalRequestsTable.id, firstId));
    expect(historical.status).toBe("approved");
    expect(historical.decidedAt).toEqual(original.decidedAt);
    expect(historical.policySnapshot).toEqual(original.policySnapshot);
    expect(historical.reviewInvalidatedAt).toBeInstanceOf(Date);
    await expect(checkFinancialLimit(a, makerId, "pos.discount_pct", 10, branchA, firstId)).rejects.toThrow("اعتماد الحد غير متاح");
    expect((await manager.post(`/api/workflow/approval-requests/${firstId}/act`).send({ action: "approve" })).status).toBe(409);
  });

  it("supersedes a changed pending amount while retaining its policy and audit comment", async () => {
    const firstId = await pending();
    const [original] = await db.select().from(approvalRequestsTable).where(eq(approvalRequestsTable.id, firstId));
    const next = await submitForApproval({
      companyId: a, branchId: branchA, docType: "pos_over_limit", recordId: original.recordId,
      amount: 11, submittedByUserId: makerId, forceRoles: ["manager"],
    });
    requestIds.push(next.requestId!);
    expect(next.requestId).not.toBe(firstId);
    const [old] = await db.select().from(approvalRequestsTable).where(eq(approvalRequestsTable.id, firstId));
    expect(old.status).toBe("changes_requested");
    expect(old.policySnapshot).toEqual(original.policySnapshot);
    expect(await db.select().from(approvalActionsTable).where(eq(approvalActionsTable.requestId, firstId))).toHaveLength(1);
  });

  it("keeps the reviewed steps after policy edits/deactivation and commits one real PO confirmation for concurrent decisions", async () => {
    const created = await owner.post("/api/workflow/approval-rules").send(ruleBody({
      minAmount: 1000, maxAmount: 1001, branchId: branchA,
    }));
    expect(created.status).toBe(201);
    ruleIds.push(created.body.id);
    const po = await approvalOrder("1000");
    const submitted = await orderReview(po.id, 1000);
    expect(submitted.required).toBe(true);
    const original = await manager.get(`/api/workflow/approval-requests/${submitted.requestId}`);
    expect(original.status).toBe(200);
    expect(original.body.policyRevision).toMatch(/^[a-f0-9]{64}$/);
    await db.update(approvalStepsTable).set({ approverRole: "cashier", approverUserId: delegateId })
      .where(eq(approvalStepsTable.ruleId, created.body.id));
    await db.update(approvalRulesTable).set({ isActive: false }).where(eq(approvalRulesTable.id, created.body.id));
    expect(await orderReview(po.id, 1000)).toMatchObject({ required: true, requestId: submitted.requestId });
    const detail = await manager.get(`/api/workflow/approval-requests/${submitted.requestId}`);
    expect(detail.body.steps[0].approverRole).toBe("manager");
    expect(detail.body.policyRevision).toBe(original.body.policyRevision);
    const decisions = await Promise.all([0, 1].map(() => manager.post(
      `/api/workflow/approval-requests/${submitted.requestId}/act`).send({ action: "approve" })));
    expect(decisions.map(r => r.status)).toEqual([200, 200]);
    const [confirmed] = await db.select().from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, po.id));
    expect(confirmed).toMatchObject({ status: "confirmed", approvedBy: managerId });
    expect(await db.select().from(approvalActionsTable).where(and(
      eq(approvalActionsTable.requestId, submitted.requestId!), eq(approvalActionsTable.action, "approve"),
    ))).toHaveLength(1);
  });

  it("rolls back the decision, action, business update and notification if the real confirmation fails, then permits a clean retry", async () => {
    const po = await approvalOrder("1002");
    const submitted = await orderReview(po.id, 1002);
    const trigger = `approval_fault_${po.id}`;
    await db.execute(sql.raw(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.id=${po.id} AND NEW.status='confirmed' THEN
      RAISE EXCEPTION 'synthetic confirmation failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER ${trigger} BEFORE UPDATE ON purchase_orders FOR EACH ROW EXECUTE FUNCTION ${trigger}();`));
    try {
      const before = await db.select().from(notificationInboxTable).where(eq(notificationInboxTable.userId, makerId));
      const failed = await manager.post(`/api/workflow/approval-requests/${submitted.requestId}/act`).send({ action: "approve" });
      expect(failed.status).not.toBe(200);
      const [review] = await db.select().from(approvalRequestsTable).where(eq(approvalRequestsTable.id, submitted.requestId!));
      expect(review).toMatchObject({ status: "pending", decidedAt: null });
      const [unchanged] = await db.select().from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, po.id));
      expect(unchanged.status).toBe("pending_approval");
      expect(await db.select().from(approvalActionsTable).where(eq(approvalActionsTable.requestId, submitted.requestId!))).toHaveLength(0);
      expect(await db.select().from(notificationInboxTable).where(eq(notificationInboxTable.userId, makerId))).toHaveLength(before.length);
    } finally {
      await db.execute(sql.raw(`DROP TRIGGER IF EXISTS ${trigger} ON purchase_orders; DROP FUNCTION IF EXISTS ${trigger}();`));
    }
    expect((await manager.post(`/api/workflow/approval-requests/${submitted.requestId}/act`).send({ action: "approve" })).status).toBe(200);
  });
});

}

describe("approval company ownership", () => {
  it("keeps the same role/action cap independent across companies, including concurrent upserts", async () => {
    const body = { role: "manager", actionKey: "pos.discount_pct", maxValue: 2 };
    expect((await owner.post("/api/workflow/financial-limits").send({ ...body, companyId: b })).status).toBe(200);
    expect((await foreign.post("/api/workflow/financial-limits").send({ ...body, maxValue: 40 })).status).toBe(200);
    expect(await checkFinancialLimit(a, managerId, body.actionKey, 3)).toMatchObject({ allowed: false, max: 2, source: "company" });
    expect(await checkFinancialLimit(b, foreignId, body.actionKey, 3)).toMatchObject({ allowed: true, max: 40 });
    expect((await owner.get("/api/workflow/financial-limits")).body.every((r: { companyId: number }) => r.companyId === a)).toBe(true);
    await Promise.all([7, 8].map(maxValue => owner.post("/api/workflow/financial-limits").send({ ...body, maxValue })));
    const rows = await db.select().from(financialLimitsTable).where(and(eq(financialLimitsTable.companyId, a), eq(financialLimitsTable.role, "manager"), eq(financialLimitsTable.actionKey, body.actionKey)));
    expect(rows).toHaveLength(1);
    expect([7, 8]).toContain(Number(rows[0].maxValue));
    expect((await checkFinancialLimit(b, foreignId, body.actionKey, 30)).max).toBe(40);
  });

  it("derives financial role from live membership, rejects spoofing and invalid/foreign scope", async () => {
    expect((await maker.get("/api/workflow/financial-limits/check?role=owner&actionKey=pos.discount_pct&value=11")).body).toMatchObject({ allowed: false, max: 10 });
    expect((await maker.get("/api/workflow/financial-limits/check?actionKey=pos.discount_pct&value=-1")).status).toBe(400);
    expect((await owner.post("/api/workflow/financial-limits").send({ role: "cashier", actionKey: "pos.discount_pct", maxValue: -1 })).status).toBe(400);
    await expect(checkFinancialLimit(a, foreignId, "pos.discount_pct", 1)).rejects.toThrow();
    await expect(checkFinancialLimit(a, makerId, "pos.discount_pct", 1, branchB)).rejects.toThrow();
    await db.update(userCompaniesTable).set({ role: "cashier" }).where(and(eq(userCompaniesTable.userId, makerId), eq(userCompaniesTable.companyId, a)));
    expect((await maker.get("/api/workflow/financial-limits/check?actionKey=pos.discount_pct&value=6")).body.allowed).toBe(false);
    await db.update(userCompaniesTable).set({ role: "sales" }).where(and(eq(userCompaniesTable.userId, makerId), eq(userCompaniesTable.companyId, a)));
  });

  it("preserves legacy custom caps without turning their quarantine into an unlimited exemption", async () => {
    const [old] = await db.insert(financialLimitsTable).values({ role: "cashier", actionKey: "pos.refund_amount", maxValue: "1", description: tag }).returning();
    legacyLimitIds.push(old.id);
    expect(await checkFinancialLimit(a, delegateId, "pos.refund_amount", 2)).toMatchObject({ allowed: false, source: "legacy_requires_review" });
    expect((await owner.post("/api/workflow/financial-limits").send({ role: "cashier", actionKey: "pos.refund_amount", maxValue: 3 })).status).toBe(200);
    expect(await checkFinancialLimit(a, delegateId, "pos.refund_amount", 2)).toMatchObject({ allowed: true, max: 3, source: "company" });
    const [unchanged] = await db.select().from(financialLimitsTable).where(eq(financialLimitsTable.id, old.id));
    expect(unchanged.companyId).toBeNull(); expect(unchanged.maxValue).toBe("1.0000");
  });

  it("blocks an unowned required approval until an authorized local policy is configured", async () => {
    const [old] = await db.insert(approvalRulesTable).values({ name: tag, docType: "expense_claim", minAmount: "0" }).returning();
    ruleIds.push(old.id);
    const employee = await db.execute(sql`INSERT INTO employees(company_id,employee_no,name,name_ar,hire_date,branch_id)
      VALUES(${a},${`${tag}-claimant`},${tag},${tag},'2026-01-01',${branchA}) RETURNING id`);
    const claim = await db.execute(sql`INSERT INTO expense_claims(reference,employee_id,claim_date,amount,description)
      VALUES(${`${tag}-expense`},${Number(employee.rows[0].id)},'2026-10-24',10,${tag}) RETURNING id`);
    const input = { companyId: a, docType: "expense_claim" as const, recordId: Number(claim.rows[0].id), amount: 10, submittedByUserId: makerId };
    await expect(submitForApproval(input)).rejects.toThrow("إعادة تهيئة");
    const created = await owner.post("/api/workflow/approval-rules").send(ruleBody({ docType: "expense_claim" }));
    expect(created.status).toBe(201); ruleIds.push(created.body.id);
    const result = await submitForApproval(input);
    expect(result.required).toBe(true); requestIds.push(result.requestId!);
    const [unchanged] = await db.select().from(approvalRulesTable).where(eq(approvalRulesTable.id, old.id));
    expect(unchanged.companyId).toBeNull();
    await db.delete(approvalRequestsTable).where(eq(approvalRequestsTable.id, result.requestId!));
    await db.execute(sql`DELETE FROM expense_claims WHERE id=${input.recordId}`);
    await db.execute(sql`DELETE FROM employees WHERE id=${Number(employee.rows[0].id)}`);
  });
  it("lists active local membership roles, not global roles or another company's users", async () => {
    const response = await maker.get("/api/workflow/approver-candidates");
    expect(response.status).toBe(200);
    expect(response.body.find((x: { id: number }) => x.id === managerId).role).toBe("manager");
    expect(response.body.find((x: { id: number }) => x.id === makerId).role).toBe("sales");
    expect(response.body.some((x: { id: number }) => x.id === foreignId)).toBe(false);
  });

  it("stamps rule ownership, rejects foreign branches/fixed users and isolates CRUD", async () => {
    expect((await owner.post("/api/workflow/approval-rules").send(ruleBody({ branchId: branchB }))).status).toBe(404);
    expect((await owner.post("/api/workflow/approval-rules").send(ruleBody({
      steps: [{ sequence: 1, approverRole: "manager", approverUserId: foreignId, minAmount: 0 }],
    }))).status).toBe(404);
    const created = await owner.post("/api/workflow/approval-rules").send(ruleBody({ companyId: b }));
    expect(created.status).toBe(201); ruleIds.push(created.body.id);
    const [stored] = await db.select().from(approvalRulesTable).where(eq(approvalRulesTable.id, created.body.id));
    expect(stored.companyId).toBe(a);
    expect((await foreign.get("/api/workflow/approval-rules")).body.some((r: { id: number }) => r.id === stored.id)).toBe(false);
    expect((await foreign.patch(`/api/workflow/approval-rules/${stored.id}`).send({ name: "foreign edit" })).status).toBe(404);
    expect((await foreign.delete(`/api/workflow/approval-rules/${stored.id}`)).status).toBe(404);
    expect((await owner.patch(`/api/workflow/approval-rules/${stored.id}`).send({ name: `${tag}-edited` })).status).toBe(200);
    expect((await maker.post("/api/workflow/approval-rules").send(ruleBody())).status).toBe(403);
  });

  it("quarantines legacy rules, requests and delegations even with a recognizable branch", async () => {
    const [rule] = await db.insert(approvalRulesTable).values({
      name: tag, docType: "journal_entry", branchId: branchA, minAmount: "0",
    }).returning(); ruleIds.push(rule.id);
    const [legacy] = await db.insert(approvalRequestsTable).values({
      docType: "pos_over_limit", recordId: 800_001, branchId: branchA, submittedByUserId: makerId,
      amount: "10", status: "pending", forcedSteps: [{ sequence: 1, approverRole: "manager", approverUserId: null }],
    }).returning(); requestIds.push(legacy.id);
    await db.insert(approverDelegationsTable).values({
      fromUserId: managerId, toUserId: delegateId, fromDate: new Date(Date.now() - 60_000),
      toDate: new Date(Date.now() + 3_600_000), reason: tag,
    });
    expect((await owner.get("/api/workflow/approval-rules")).body.some((r: { id: number }) => r.id === rule.id)).toBe(false);
    expect((await owner.patch(`/api/workflow/approval-rules/${rule.id}`).send({ companyId: a, isActive: false })).status).toBe(404);
    expect((await owner.get("/api/workflow/approval-requests")).body.some((r: { id: number }) => r.id === legacy.id)).toBe(false);
    expect((await owner.get(`/api/workflow/approval-requests/${legacy.id}`)).status).toBe(404);
    expect((await owner.post(`/api/workflow/approval-requests/${legacy.id}/act`).send({ action: "approve" })).status).toBe(404);
    expect((await owner.get("/api/workflow/delegations")).body.some((d: { companyId: number | null }) => d.companyId === null)).toBe(false);
    expect(await resolveApprovers("manager", null, branchA, a)).toEqual([managerId]);
    await expect(submitForApproval({ companyId: a, docType: "journal_entry", branchId: branchA, recordId: 800_002, amount: 10 }))
      .rejects.toThrow("إعادة تهيئة");
    expect((await db.select().from(approvalRequestsTable).where(eq(approvalRequestsTable.id, legacy.id)))[0].companyId).toBeNull();
  });

  it("routes to active local roles and refuses foreign reads, decisions and global-owner bypass", async () => {
    const id = await pending();
    expect((await foreign.get("/api/workflow/approval-requests")).body.some((r: { id: number }) => r.id === id)).toBe(false);
    expect((await foreign.get(`/api/workflow/approval-requests/${id}`)).status).toBe(404);
    expect((await foreign.post(`/api/workflow/approval-requests/${id}/act`).send({ action: "approve" })).status).toBe(404);
    await expect(actOnApproval(id, foreignId, tag, "approve", b)).rejects.toThrow("غير موجود");
    expect((await maker.post(`/api/workflow/approval-requests/${id}/act`).send({ action: "approve" })).status).toBe(403);
    expect((await manager.get(`/api/workflow/approval-requests/${id}`)).status).toBe(200);
    expect((await manager.post(`/api/workflow/approval-requests/${id}/act`).send({ action: "approve" })).status).toBe(200);
    expect((await db.select().from(approvalRequestsTable).where(eq(approvalRequestsTable.id, id)))[0].status).toBe("approved");
    const foreignNotifications = await db.select().from(notificationInboxTable)
      .where(and(eq(notificationInboxTable.userId, foreignId), sql`${notificationInboxTable.payload}->>'requestId' = ${String(id)}`));
    expect(foreignNotifications).toHaveLength(0);
  });

  it("validates delegates and serializes overlapping temporary assignments", async () => {
    const dates = window();
    expect((await owner.post("/api/workflow/delegations").send({ ...dates, fromUserId: managerId, toUserId: foreignId })).status).toBe(404);
    expect((await owner.post("/api/workflow/delegations").send({ ...dates, fromUserId: foreignId, toUserId: delegateId })).status).toBe(404);
    expect((await owner.post("/api/workflow/delegations").send({ ...dates, fromUserId: managerId, toUserId: managerId })).status).toBe(400);
    expect((await owner.post("/api/workflow/delegations").send({
      fromUserId: managerId, toUserId: delegateId, fromDate: dates.toDate, toDate: dates.fromDate,
    })).status).toBe(400);
    const body = { ...dates, fromUserId: managerId, toUserId: delegateId, reason: tag };
    const responses = await Promise.all([
      owner.post("/api/workflow/delegations").send(body), owner.post("/api/workflow/delegations").send(body),
    ]);
    expect(responses.map(r => r.status).sort()).toEqual([201, 409]);
    const delegationId = responses.find(r => r.status === 201)!.body.id;
    expect((await foreign.delete(`/api/workflow/delegations/${delegationId}`)).status).toBe(404);
    expect(await resolveApprovers("manager", null, branchA, a)).toEqual([managerId]);
    // Delegation cannot lend the manager's higher financial cap to a cashier.
    const id = await pending(1);
    expect((await delegate.get(`/api/workflow/approval-requests/${id}`)).status).toBe(403);
    expect((await delegate.post(`/api/workflow/approval-requests/${id}/act`).send({ action: "approve" })).status).toBe(403);
    await db.update(usersTable).set({ branchId: branchA }).where(eq(usersTable.id, delegateId));
    const [nativeReview] = await db.select().from(approvalRequestsTable).where(eq(approvalRequestsTable.id, id));
    expect(await resolveApprovers("manager", null, branchA, a, db, nativeReview)).toEqual([delegateId]);
    expect((await delegate.get(`/api/workflow/approval-requests/${id}`)).status).toBe(200);
    expect((await delegate.post(`/api/workflow/approval-requests/${id}/act`).send({ action: "approve" })).status).toBe(200);
    await db.delete(userCompaniesTable).where(and(eq(userCompaniesTable.userId, delegateId), eq(userCompaniesTable.companyId, a)));
    expect(await resolveApprovers("manager", null, branchA, a)).toEqual([managerId]);
    await db.insert(userCompaniesTable).values({ userId: delegateId, companyId: a, role: "cashier", isDefault: true });
    expect((await owner.delete(`/api/workflow/delegations/${delegationId}`)).status).toBe(200);
    const [preserved] = await db.select().from(approverDelegationsTable).where(eq(approverDelegationsTable.id, delegationId));
    expect(preserved.revokedAt).not.toBeNull();
    await db.update(usersTable).set({ branchId: null }).where(eq(usersTable.id, delegateId));
    expect(await resolveApprovers("manager", null, branchA, a)).toEqual([managerId]);
  });

  it("bounds delegation by native document, branch, amount and both principals, and quarantines unscoped history", async () => {
    const id = await pending();
    const [review] = await db.select().from(approvalRequestsTable).where(eq(approvalRequestsTable.id, id));
    await db.update(usersTable).set({ branchId: branchA }).where(eq(usersTable.id, delegateId));
    const [delegation] = await db.insert(approverDelegationsTable).values({
      companyId: a, fromUserId: managerId, toUserId: delegateId,
      fromDate: new Date(Date.now() - 60_000), toDate: new Date(Date.now() + 60_000),
      reason: tag, branchId: branchA, docTypes: ["pos_over_limit"], maxAmount: "1",
    }).returning();
    const resolve = () => resolveApprovers("manager", null, branchA, a, db, review);
    try {
      expect(await resolve()).toEqual([delegateId]);
      expect(await resolveApprovers("manager", null, branchA, a, db, { ...review, amount: "1.0001" })).toEqual([managerId]);
      await db.update(approverDelegationsTable).set({ docTypes: ["purchase_order"] }).where(eq(approverDelegationsTable.id, delegation.id));
      expect(await resolve()).toEqual([managerId]);
      await db.update(approverDelegationsTable).set({ docTypes: ["pos_over_limit"], branchId: branchA2 }).where(eq(approverDelegationsTable.id, delegation.id));
      expect(await resolve()).toEqual([managerId]);
      await db.update(approverDelegationsTable).set({ branchId: branchA, docTypes: null }).where(eq(approverDelegationsTable.id, delegation.id));
      expect(await resolve()).toEqual([managerId]); // preserve legacy row, never treat NULL as all types
      await db.update(approverDelegationsTable).set({ docTypes: ["pos_over_limit"] }).where(eq(approverDelegationsTable.id, delegation.id));
      await db.update(usersTable).set({ branchId: branchA2 }).where(eq(usersTable.id, managerId));
      expect(await resolve()).toEqual([]);
      await db.update(usersTable).set({ branchId: null }).where(eq(usersTable.id, managerId));
      expect((await manager.post("/api/workflow/delegations").send({
        ...window(), fromUserId: ownerId, toUserId: delegateId,
      })).status).toBe(403);
      expect((await manager.post("/api/workflow/delegations").send({
        fromUserId: managerId, toUserId: delegateId, fromDate: window().fromDate, toDate: window().toDate,
      })).status).toBe(400);
    } finally {
      await db.update(approverDelegationsTable).set({ revokedAt: new Date(), revokedBy: ownerId }).where(eq(approverDelegationsTable.id, delegation.id));
      await db.update(usersTable).set({ branchId: null }).where(inArray(usersTable.id, [delegateId, managerId]));
    }
  });

  it("preserves referenced rule chains while allowing prospective deactivation", async () => {
    const response = await owner.post("/api/workflow/approval-rules").send(ruleBody({ docType: "purchase_order", minAmount: 1 }));
    expect(response.status).toBe(201); const ruleId = response.body.id; ruleIds.push(ruleId);
    const submission = await submitForApproval({
      companyId: a, docType: "purchase_order", recordId: poA, amount: 10, submittedByUserId: makerId,
    });
    expect(submission.required).toBe(true); requestIds.push(submission.requestId!);
    expect((await owner.patch(`/api/workflow/approval-rules/${ruleId}`).send({
      steps: [{ sequence: 1, approverRole: "sales", minAmount: 0 }],
    })).status).toBe(409);
    expect((await owner.delete(`/api/workflow/approval-rules/${ruleId}`)).status).toBe(409);
    expect((await owner.patch(`/api/workflow/approval-rules/${ruleId}`).send({ isActive: false })).status).toBe(200);
    expect((await owner.get(`/api/workflow/approval-requests/${submission.requestId}`)).body.steps[0].approverRole).toBe("manager");
  });
});

const autoBody = (extra = {}) => ({
  name: tag, trigger: { type: "record_created", entity: "purchase_order" }, conditions: [],
  actions: [{ type: "send_notification", recipientRole: "manager", title: tag, message: "{{reference}}", channel: "inapp" }],
  ...extra,
});
describe("company automation and inbox", () => {
  it("does not round invalid policy precision or admit a value just above the financial cap", async () => {
    const policy = await checkFinancialLimit(a, managerId, "pos.discount_pct", 0, branchA);
    expect(policy.max).not.toBeNull();
    expect((await checkFinancialLimit(a, managerId, "pos.discount_pct", policy.max!, branchA)).allowed).toBe(true);
    expect((await checkFinancialLimit(a, managerId, "pos.discount_pct", policy.max! + 0.0000005, branchA)).allowed).toBe(false);
    for (const maxValue of [0.001, 10000000000000]) {
      expect((await owner.post("/api/workflow/financial-limits").send({ role: "manager", actionKey: "ap.payment_amount", maxValue })).status).toBe(400);
    }
  });
  it("scopes rule CRUD and logs, reloads owned targets and suppresses concurrent/reordered event retries", async () => {
    const created = await owner.post("/api/workflow/automation-rules").send(autoBody({ companyId: b }));
    expect(created.status).toBe(201);
    const id = created.body.id;
    expect((await foreign.get("/api/workflow/automation-rules")).body.some((r: { id: number }) => r.id === id)).toBe(false);
    expect((await foreign.patch(`/api/workflow/automation-rules/${id}`).send({ isActive: false })).status).toBe(404);
    expect((await foreign.delete(`/api/workflow/automation-rules/${id}`)).status).toBe(404);
    await triggerEvent(a, "record_created", "purchase_order", { id: poB, total: 999 });
    await Promise.all([
      triggerEvent(a, "record_created", "purchase_order", { id: poA, total: 999 }),
      triggerEvent(a, "record_created", "purchase_order", { total: 999, id: poA }),
    ]);
    const notes = await db.select().from(notificationInboxTable).where(and(eq(notificationInboxTable.companyId, a), eq(notificationInboxTable.title, tag)));
    expect(notes.filter(x => x.userId === managerId)).toHaveLength(1);
    expect(notes.some(x => x.userId === foreignId || x.userId === branchManagerId)).toBe(false);
    expect(notes[0].message).toBe(`${tag}-A`);
    const logs = await owner.get(`/api/workflow/automation-runs?ruleId=${id}`);
    expect(logs.body.filter((r: { matchedRecords: number }) => r.matchedRecords === 1)).toHaveLength(1);
    expect((await foreign.get(`/api/workflow/automation-runs?ruleId=${id}`)).body).toEqual([]);
    expect((await owner.patch(`/api/workflow/automation-rules/${id}`).send({ description: "updated configuration" })).status).toBe(200);
    await triggerEvent(a, "record_created", "purchase_order", { id: poA, total: 999 });
    expect(await db.select().from(notificationInboxTable).where(and(eq(notificationInboxTable.title, tag), eq(notificationInboxTable.userId, managerId)))).toHaveLength(1);
    expect((await owner.delete(`/api/workflow/automation-rules/${id}`)).status).toBe(409);
  });

  it("rejects protected fields, ownership/status/financial writes, arbitrary creation and outbound channels", async () => {
    for (const action of [
      { type: "set_field", field: "companyId", value: b }, { type: "set_field", field: "status", value: "approved" },
      { type: "set_field", field: "total", value: 0 }, { type: "create_record", entity: "invoice", payload: { companyId: a } },
      { type: "call_webhook", url: "https://example.invalid" },
      { type: "send_notification", recipientRole: "manager", title: tag, message: "x", channel: "email" },
    ]) expect((await owner.post("/api/workflow/automation-rules").send(autoBody({ actions: [action] }))).status).toBe(400);
    const [row] = await db.select().from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, poA));
    expect(row.companyId).toBe(a); expect(row.status).toBe("draft"); expect(row.total).toBe("10.00");
  });

  it("rolls back an entire failed action chain and receipt, then retries internal effects once", async () => {
    const source = await approvalOrder("10");
    const title = `${tag}-atomic`;
    const result = await owner.post("/api/workflow/automation-rules").send(autoBody({
      trigger: { type: "record_updated", entity: "purchase_order" },
      actions: [{ type: "send_notification", recipientRole: "manager", title, message: "x" },
        { type: "set_field", field: "notes", value: "safe notes" }],
    }));
    expect(result.status).toBe(201);
    await db.update(purchaseOrdersTable).set({ status: "confirmed" }).where(eq(purchaseOrdersTable.id, source.id));
    await triggerEvent(a, "record_updated", "purchase_order", { id: source.id });
    expect(await db.select().from(notificationInboxTable).where(eq(notificationInboxTable.title, title))).toHaveLength(0);
    await db.update(purchaseOrdersTable).set({ status: "draft" }).where(eq(purchaseOrdersTable.id, source.id));
    await triggerEvent(a, "record_updated", "purchase_order", { id: source.id });
    await triggerEvent(a, "record_updated", "purchase_order", { id: source.id });
    expect(await db.select().from(notificationInboxTable).where(and(eq(notificationInboxTable.title, title), eq(notificationInboxTable.userId, managerId)))).toHaveLength(1);
    const [row] = await db.select().from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, source.id));
    expect(row.notes).toBe("safe notes"); expect(row.total).toBe("10.00");
  });

  it("scopes scheduled scans and creation through the notification service, preserving unowned rules", async () => {
    const title = `${tag}-scheduled`;
    const created = await owner.post("/api/workflow/automation-rules").send(autoBody({
      trigger: { type: "scheduled", entity: "purchase_order", intervalMinutes: 1 },
      actions: [{ type: "create_record", entity: "notification_inbox", payload: { recipientRole: "manager", title, message: "{{reference}}" } }],
    }));
    expect(created.status).toBe(201);
    await db.insert(automationRulesTable).values({ name: tag, trigger: { type: "scheduled" }, conditions: [], actions: [{ type: "set_field", field: "total", value: 0 }] });
    await Promise.all([runScheduledAutomations(), runScheduledAutomations()]);
    const notices = await db.select().from(notificationInboxTable).where(eq(notificationInboxTable.title, title));
    const ownedSources = await db.select({ reference: purchaseOrdersTable.reference }).from(purchaseOrdersTable)
      .where(eq(purchaseOrdersTable.companyId, a));
    expect(notices.filter(x => x.userId === managerId).map(x => x.message).sort())
      .toEqual(ownedSources.map(x => x.reference).sort()); // Includes the independently created retry fixture, never B.
    expect(notices.some(x => x.message === `${tag}-B` || x.userId === foreignId)).toBe(false);
    const [old] = await db.select().from(automationRulesTable).where(sql`${automationRulesTable.name}=${tag} AND ${automationRulesTable.companyId} IS NULL`);
    expect(old.companyId).toBeNull(); expect(old.lastRunAt).toBeNull();
  });

  it("honors stored branch scope and revokes a creator's scheduled authority with their membership", async () => {
    expect((await branchManager.post("/api/workflow/financial-limits").send({ role: "manager", actionKey: "pos.discount_pct", maxValue: 99 })).status).toBe(403);
    const title = `${tag}-branch`;
    const created = await branchManager.post("/api/workflow/automation-rules").send(autoBody({
      trigger: { type: "scheduled", entity: "purchase_order", intervalMinutes: 1 },
      actions: [{ type: "send_notification", recipientRole: "manager", title, message: "{{reference}}" }],
    }));
    expect(created.status).toBe(201);
    const [stored] = await db.select().from(automationRulesTable).where(eq(automationRulesTable.id, created.body.id));
    expect(stored.branchIds).toEqual([branchA2]);
    expect((await branchManager.get("/api/workflow/automation-rules")).body.every((r: { branchIds: number[] | null }) => r.branchIds?.includes(branchA2))).toBe(true);
    await db.delete(userCompaniesTable).where(and(eq(userCompaniesTable.userId, branchManagerId), eq(userCompaniesTable.companyId, a)));
    expect((await branchManager.get("/api/workflow/automation-rules")).status).toBe(403);
    await runScheduledAutomations();
    expect(await db.select().from(notificationInboxTable).where(eq(notificationInboxTable.title, title))).toHaveLength(0);
    await db.insert(userCompaniesTable).values({ userId: branchManagerId, companyId: a, role: "manager", isDefault: true });
    await runScheduledAutomations();
    const rows = await db.select().from(notificationInboxTable).where(eq(notificationInboxTable.title, title));
    expect(rows.every(x => x.message === `${tag}-A2`)).toBe(true);
    expect(rows.some(x => x.userId === branchManagerId)).toBe(true);
  });

  it("isolates shared-member inbox reads/counts/read actions across company switches and quarantines legacy rows", async () => {
    const title = `${tag}-inbox`;
    for (const companyId of [a, b]) await notify(ownerId, { companyId, type: "system", title, message: String(companyId), channel: "inapp" });
    await db.insert(notificationInboxTable).values({ userId: ownerId, type: "system", title, message: "unowned" });
    const rows = await db.select().from(notificationInboxTable).where(and(eq(notificationInboxTable.userId, ownerId), eq(notificationInboxTable.title, title)));
    const rowA = rows.find(x => x.companyId === a)!, rowB = rows.find(x => x.companyId === b)!;
    expect((await owner.get("/api/workflow/inbox")).body.filter((r: { title: string }) => r.title === title).map((r: { message: string }) => r.message)).toEqual([String(a)]);
    expect((await owner.post("/api/auth/switch-company").send({ companyId: b })).status).toBe(200);
    expect((await owner.patch(`/api/workflow/inbox/${rowA.id}/read`)).status).toBe(404);
    expect((await owner.get("/api/workflow/inbox/unread-count")).body.count).toBe(1);
    expect((await owner.post("/api/workflow/inbox/mark-all-read")).status).toBe(200);
    const updated = await db.select().from(notificationInboxTable).where(inArray(notificationInboxTable.id, [rowA.id, rowB.id]));
    expect(updated.find(x => x.id === rowA.id)!.isRead).toBe(false);
    expect(updated.find(x => x.id === rowB.id)!.isRead).toBe(true);
    expect((await owner.post("/api/auth/switch-company").send({ companyId: a })).status).toBe(200);
    await db.insert(notificationInboxTable).values(Array.from({ length: 52 }, (_, i) => ({
      companyId: a, userId: ownerId, type: "system", title: `${title}-${i}`, message: "synthetic pagination fixture",
    })));
    expect((await owner.get("/api/workflow/inbox")).body).toHaveLength(50);
    expect((await owner.get("/api/workflow/inbox/unread-count")).body.count).toBe(53);
    expect((await owner.post("/api/workflow/inbox/mark-all-read")).status).toBe(200);
    expect((await owner.get("/api/workflow/inbox/unread-count")).body.count).toBe(0);
    await expect(notify(foreignId, { companyId: a, type: "system", title, message: "no" })).rejects.toThrow();
  });

  it("hides a notification's title/content and count after the recipient loses access to its source", async () => {
    const title = `${tag}-foreign-source`;
    const input = { companyId: a, type: "automation" as const, title, message: "must never be visible",
      payload: { entity: "purchase_order", recordId: poB }, channel: "inapp" as const };
    await notify(managerId, input);
    expect(await db.select().from(notificationInboxTable).where(eq(notificationInboxTable.title, title))).toHaveLength(0);
    const { channel: _channel, ...stored } = input;
    const [historical] = await db.insert(notificationInboxTable).values({ ...stored, userId: managerId }).returning();
    expect((await manager.get("/api/workflow/inbox")).body.some((r: { title: string }) => r.title === title)).toBe(false);
    expect((await manager.patch(`/api/workflow/inbox/${historical.id}/read`)).status).toBe(404);
    const before = await manager.get("/api/workflow/inbox");
    expect(before.body.some((r: { type: string }) => r.type === "automation")).toBe(true);
    const id = before.body.find((r: { type: string }) => r.type === "automation").id;
    await db.update(userCompaniesTable).set({ role: "cashier" }).where(and(eq(userCompaniesTable.userId, managerId), eq(userCompaniesTable.companyId, a)));
    expect((await manager.get("/api/workflow/inbox")).body.some((r: { type: string }) => r.type === "automation")).toBe(false);
    expect((await manager.patch(`/api/workflow/inbox/${id}/read`)).status).toBe(404);
    await db.update(userCompaniesTable).set({ role: "manager" }).where(and(eq(userCompaniesTable.userId, managerId), eq(userCompaniesTable.companyId, a)));
  });
});

registerApprovalSnapshotCases();
