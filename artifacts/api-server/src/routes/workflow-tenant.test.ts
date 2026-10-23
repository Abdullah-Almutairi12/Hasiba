import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db, companiesTable, usersTable, userCompaniesTable, branchesTable, auditLogsTable,
  approvalRulesTable, approvalRequestsTable, approverDelegationsTable, notificationInboxTable,
  warehousesTable,
} from "@workspace/db";
import app from "../app";
import { cleanupCompanyDefaults } from "../test/cleanup-company-defaults";
import { submitForApproval, resolveApprovers, actOnApproval } from "../lib/workflow-engine";

const tag = `workflow-tenants-${Date.now()}`;
const password = "SyntheticWorkflow123!";
type Agent = ReturnType<typeof request.agent>;
const ids: number[] = [];
const ruleIds: number[] = [];
const requestIds: number[] = [];
let a: number, b: number, branchA: number, branchB: number;
let maker: Agent, owner: Agent, manager: Agent, foreign: Agent, delegate: Agent;
let makerId: number, managerId: number, foreignId: number, delegateId: number;

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
});
async function pending() {
  const result = await submitForApproval({
    companyId: a, branchId: branchA, docType: "pos_over_limit", recordId: 900_000 + requestIds.length,
    recordRef: tag, submittedByUserId: makerId, submittedByName: tag, amount: 10, forceRoles: ["manager"],
  });
  expect(result.required).toBe(true);
  requestIds.push(result.requestId!);
  return result.requestId!;
}
const ruleBody = (extra = {}) => ({
  name: tag, docType: "purchase_order", minAmount: 0, mode: "sequential",
  steps: [{ sequence: 1, approverRole: "manager", minAmount: 0 }], ...extra,
});

beforeAll(async () => {
  const [ca, cb] = await db.insert(companiesTable).values([
    { name: `${tag}-A` }, { name: `${tag}-B` },
  ]).returning();
  a = ca.id; b = cb.id;
  const branches = await db.insert(branchesTable).values([
    { companyId: a, name: tag, nameAr: tag, city: "Synthetic" },
    { companyId: b, name: tag, nameAr: tag, city: "Synthetic" },
  ]).returning();
  branchA = branches[0].id; branchB = branches[1].id;
  ({ agent: owner } = await user(a, "owner", "owner"));
  ({ agent: maker, id: makerId } = await user(a, "sales", "owner"));
  ({ agent: manager, id: managerId } = await user(a, "manager", "sales"));
  ({ agent: foreign, id: foreignId } = await user(b, "manager", "manager"));
  ({ agent: delegate, id: delegateId } = await user(a, "cashier", "cashier"));
});

afterAll(async () => {
  await db.delete(notificationInboxTable).where(inArray(notificationInboxTable.userId, ids));
  await db.delete(approverDelegationsTable).where(orOwnedDelegations());
  await db.delete(approvalRequestsTable).where(inArray(approvalRequestsTable.id, requestIds));
  await db.delete(approvalRulesTable).where(inArray(approvalRulesTable.id, ruleIds));
  await db.delete(auditLogsTable).where(inArray(auditLogsTable.companyId, [a, b]));
  await db.delete(userCompaniesTable).where(inArray(userCompaniesTable.companyId, [a, b]));
  await db.delete(usersTable).where(inArray(usersTable.id, ids));
  await db.delete(warehousesTable).where(inArray(warehousesTable.companyId, [a, b]));
  await db.delete(branchesTable).where(inArray(branchesTable.id, [branchA, branchB]));
  await cleanupCompanyDefaults([a, b]);
  await db.delete(companiesTable).where(inArray(companiesTable.id, [a, b]));
});
function orOwnedDelegations() {
  return sql`${approverDelegationsTable.companyId} IN (${a},${b}) OR ${approverDelegationsTable.reason} = ${tag}`;
}

describe("approval company ownership", () => {
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
    const noRule = await submitForApproval({ companyId: a, docType: "journal_entry", branchId: branchA, recordId: 800_002, amount: 10 });
    expect(noRule.required).toBe(false);
    expect((await db.select().from(approvalRequestsTable).where(eq(approvalRequestsTable.id, legacy.id)))[0].companyId).toBeNull();
  });

  it("routes to active local roles and refuses foreign reads, decisions and global-owner bypass", async () => {
    const id = await pending();
    expect((await foreign.get("/api/workflow/approval-requests")).body.some((r: { id: number }) => r.id === id)).toBe(false);
    expect((await foreign.get(`/api/workflow/approval-requests/${id}`)).status).toBe(404);
    expect((await foreign.post(`/api/workflow/approval-requests/${id}/act`).send({ action: "approve" })).status).toBe(404);
    await expect(actOnApproval(id, foreignId, tag, "approve", undefined, b)).rejects.toThrow("غير موجود");
    expect((await maker.post(`/api/workflow/approval-requests/${id}/act`).send({ action: "approve" })).status).toBe(400);
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
    expect(await resolveApprovers("manager", null, branchA, a)).toEqual([delegateId]);
    const id = await pending();
    expect((await delegate.get(`/api/workflow/approval-requests/${id}`)).status).toBe(200);
    expect((await delegate.post(`/api/workflow/approval-requests/${id}/act`).send({ action: "approve" })).status).toBe(200);
    await db.delete(userCompaniesTable).where(and(eq(userCompaniesTable.userId, delegateId), eq(userCompaniesTable.companyId, a)));
    expect(await resolveApprovers("manager", null, branchA, a)).toEqual([managerId]);
    await db.insert(userCompaniesTable).values({ userId: delegateId, companyId: a, role: "cashier", isDefault: true });
    expect((await owner.delete(`/api/workflow/delegations/${delegationId}`)).status).toBe(200);
    expect(await resolveApprovers("manager", null, branchA, a)).toEqual([managerId]);
  });

  it("preserves referenced rule chains while allowing prospective deactivation", async () => {
    const response = await owner.post("/api/workflow/approval-rules").send(ruleBody({ docType: "expense_claim" }));
    expect(response.status).toBe(201); const ruleId = response.body.id; ruleIds.push(ruleId);
    const submission = await submitForApproval({
      companyId: a, docType: "expense_claim", recordId: 800_004, amount: 5, submittedByUserId: makerId,
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
