import { createHash } from "node:crypto";
import { z } from "zod";
import type { approvalRequestsTable } from "@workspace/db";
import { frozenApprovalPolicy } from "./approval-policy";

export interface DecisionIdentity { stepToken?: string; decisionId?: string }
export const decisionResultSchema = z.object({ status: z.string(), finished: z.boolean() });

export function reviewStepToken(request: typeof approvalRequestsTable.$inferSelect, sequence: number): string {
  return createHash("sha256").update(JSON.stringify([
    request.id, frozenApprovalPolicy(request)?.revision ?? null,
    request.sourceFingerprintVersion, request.sourceFingerprint, sequence,
    request.amount, request.branchId, request.notes,
  ])).digest("hex");
}

export function decisionIntent(userId: number, action: string, comment: string | undefined, stepToken: string | undefined): string {
  return createHash("sha256").update(JSON.stringify([userId, action, comment ?? null, stepToken ?? null])).digest("hex");
}
