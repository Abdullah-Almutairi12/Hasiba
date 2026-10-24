import { createHash } from "node:crypto";
import { z } from "zod/v4";
import type { ApprovalRequest, ApprovalRule } from "@workspace/db";
import { FinancialRequestError } from "./financial-transaction";

const stepSchema = z.object({
  id: z.number().int(),
  ruleId: z.number().int(),
  sequence: z.number().int().positive(),
  approverRole: z.string().min(1),
  approverUserId: z.number().int().positive().nullable(),
  minAmount: z.string().regex(/^\d+(?:\.\d+)?$/),
}).strict();
const definitionSchema = z.object({
  version: z.literal(1),
  companyId: z.number().int().positive(),
  ruleId: z.number().int().positive().nullable(),
  name: z.string(),
  branchId: z.number().int().positive().nullable(),
  mode: z.enum(["sequential", "parallel"]),
  minAmount: z.string(),
  maxAmount: z.string().nullable(),
  fourEyes: z.literal(true),
  steps: z.array(stepSchema).min(1),
}).strict();
const snapshotSchema = definitionSchema.extend({
  capturedAt: z.iso.datetime(),
  revision: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type FrozenApprovalPolicy = z.infer<typeof snapshotSchema>;

// JSONB does not preserve object key order. The revision describes the
// definition, not serialization order or the time a request was submitted.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
function revision(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

export function freezeApprovalPolicy(
  companyId: number,
  rule: ApprovalRule | null,
  steps: Array<{ id: number; ruleId: number; sequence: number; approverRole: string; approverUserId: number | null; minAmount: string | null }>,
  forcedName?: string,
): FrozenApprovalPolicy {
  if (rule && rule.companyId !== companyId) throw new FinancialRequestError("سياسة الاعتماد خارج الشركة", 403);
  if (new Set(steps.map(step => step.sequence)).size !== steps.length) {
    throw new FinancialRequestError("تعريف خطوات متداخل؛ يلزم تصحيح السياسة قبل تقديم مراجعة جديدة", 409);
  }
  const definition = definitionSchema.parse({
    version: 1, companyId, ruleId: rule?.id ?? null, name: rule?.name ?? forcedName ?? "سلسلة مراجعة إلزامية",
    branchId: rule?.branchId ?? null, mode: rule?.mode ?? "sequential",
    minAmount: rule?.minAmount ?? "0", maxAmount: rule?.maxAmount ?? null,
    fourEyes: true,
    steps: steps.map((step) => ({
      id: step.id, ruleId: step.ruleId, sequence: step.sequence, approverRole: step.approverRole,
      approverUserId: step.approverUserId ?? null, minAmount: step.minAmount ?? "0",
    })),
  });
  return { ...definition, capturedAt: new Date().toISOString(), revision: revision(definition) };
}

export function frozenApprovalPolicy(request: Pick<ApprovalRequest, "companyId" | "policySnapshot">): FrozenApprovalPolicy | null {
  if (request.policySnapshot == null) return null;
  const parsed = snapshotSchema.safeParse(request.policySnapshot);
  if (!parsed.success || parsed.data.companyId !== request.companyId ||
    new Set(parsed.data.steps.map(step => step.sequence)).size !== parsed.data.steps.length) {
    throw new FinancialRequestError("نسخة سياسة الاعتماد غير صالحة؛ يلزم إعادة المراجعة", 409);
  }
  const { capturedAt: _capturedAt, revision: expected, ...definition } = parsed.data;
  if (revision(definition) !== expected) throw new FinancialRequestError("تغيرت نسخة سياسة الاعتماد؛ يلزم إعادة المراجعة", 409);
  return parsed.data;
}
