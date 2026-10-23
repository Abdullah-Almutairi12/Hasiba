import { db, approvalRequestsTable, approvalRulesTable, approvalStepsTable, notificationInboxTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { assertWorkflowMember } from "./workflow-access";
import { returnActor } from "./return-access";
import type { DbOrTx } from "./journal-posting";
import { supplyScope } from "./supply-chain-scope";
import { paymentRunsTable } from "@workspace/db";

async function approvalSourceAllowed(companyId: number, userId: number, request: typeof approvalRequestsTable.$inferSelect,
  actor: Awaited<ReturnType<typeof returnActor>>, connection: DbOrTx) {
  if (request.docType === "purchase_order" || request.docType === "leave_request") {
    const { canReadAutomationSource } = await import("./workflow-automation");
    return canReadAutomationSource(companyId, userId, { entity: request.docType, recordId: request.recordId }, connection);
  }
  if (request.docType === "pos_over_limit") {
    const result = await connection.execute(sql`SELECT p.branch_id FROM pos_sessions p JOIN branches b ON b.id=p.branch_id
      WHERE p.id=${request.recordId} AND b.company_id=${companyId}`);
    const branch = result.rows[0]?.branch_id;
    return branch != null && actor.capabilities.includes("view") && (actor.branches == null || actor.branches.includes(Number(branch)));
  }
  const table = ({ expense_claim: "expense_claims", sales_order: "sales_orders", journal_entry: "journal_entries",
    credit_note: "credit_notes", credit_note_cancel: "credit_notes", payment_run: "payment_runs" } as Record<string, string>)[request.docType];
  if (!table) return false;
  const result = await connection.execute(sql`SELECT to_jsonb(s) AS source FROM ${sql.identifier(table)} s
    WHERE s.id=${request.recordId} AND s.company_id=${companyId}`);
  const row = result.rows[0]?.source as Record<string, unknown> | undefined;
  if (!row) return false;
  if (!["owner", "manager", "accountant", "auditor", ...(request.docType === "sales_order" || request.docType.startsWith("credit_note") ? ["sales"] : []),
    ...(request.docType === "expense_claim" ? ["hr"] : [])].includes(actor.role)) return false;
  if (actor.custom && !actor.capabilities.includes(request.docType === "expense_claim" ? "hr_view" : "view")) return false;
  let branch = row.branch_id as number | null;
  if (table === "expense_claims") {
    const owned = await connection.execute(sql`SELECT branch_id FROM employees WHERE id=${Number(row.employee_id)} AND company_id=${companyId}`);
    if (!owned.rows.length) return false;
    branch = owned.rows[0].branch_id as number | null;
  }
  if (table === "sales_orders") {
    const owned = await connection.execute(sql`SELECT id FROM customers WHERE id=${Number(row.customer_id)} AND company_id=${companyId}`);
    if (!owned.rows.length) return false;
  }
  if (table === "credit_notes") {
    const owned = await connection.execute(sql`SELECT id FROM customer_invoices WHERE id=${Number(row.invoice_id)} AND company_id=${companyId}`);
    if (!owned.rows.length) return false;
  }
  if (table === "payment_runs") {
    const [owned] = await connection.select({ id: paymentRunsTable.id }).from(paymentRunsTable).where(and(
      eq(paymentRunsTable.id, request.recordId), supplyScope("paymentRun", paymentRunsTable.id, companyId),
    ));
    if (!owned) return false;
  }
  if (row.warehouse_id != null) {
    const warehouse = await connection.execute(sql`SELECT branch_id FROM warehouses WHERE id=${Number(row.warehouse_id)} AND company_id=${companyId}`);
    if (!warehouse.rows.length) return false;
    branch = warehouse.rows[0].branch_id as number | null;
  }
  return actor.branches == null || (branch != null && actor.branches.includes(branch));
}

export interface NotifyInput {
  companyId: number;
  type: "approval" | "automation" | "system";
  title: string;
  message: string;
  link?: string | null;
  payload?: unknown;
  channel?: "inapp" | "email" | "whatsapp" | "sms";
}

export async function canReadNotification(userId: number, row: {
  companyId: number | null; type: string; link: string | null; payload: unknown;
}, connection: DbOrTx = db): Promise<boolean> {
  if (row.companyId == null) return false;
  const actor = await returnActor(userId, row.companyId, connection);
  const payload = row.payload as Record<string, unknown> | null;
  if (row.type === "approval") {
    const requestId = Number(payload?.requestId);
    if (!Number.isSafeInteger(requestId)) return false;
    const [request] = await connection.select().from(approvalRequestsTable).where(and(
      eq(approvalRequestsTable.id, requestId), eq(approvalRequestsTable.companyId, row.companyId),
    ));
    if (!request || (request.branchId != null && actor.branches != null && !actor.branches.includes(request.branchId))) return false;
    if (!await approvalSourceAllowed(row.companyId, userId, request, actor, connection)) return false;
    if (["leave_request", "expense_claim"].includes(request.docType) &&
      (!["owner", "manager", "hr", "accountant", "auditor"].includes(actor.role) ||
        (actor.custom && !actor.capabilities.includes("hr_view")))) return false;
    if (request.submittedByUserId === userId) return true;
    let steps = request.forcedSteps as Array<{ sequence: number; approverRole: string; approverUserId: number | null }> | null;
    if (request.ruleId != null) {
      const [rule] = await connection.select().from(approvalRulesTable).where(and(
        eq(approvalRulesTable.id, request.ruleId), eq(approvalRulesTable.companyId, row.companyId),
      ));
      if (!rule) return false;
      steps = await connection.select().from(approvalStepsTable).where(eq(approvalStepsTable.ruleId, request.ruleId));
    }
    const { resolveApprovers } = await import("./workflow-engine");
    for (const step of steps ?? []) {
      if ((await resolveApprovers(step.approverRole, step.approverUserId, request.branchId, row.companyId)).includes(userId)) return true;
    }
    return false;
  }
  if (row.type === "automation") {
    const { canReadAutomationSource } = await import("./workflow-automation");
    return canReadAutomationSource(row.companyId, userId, payload, connection);
  }
  // Unclassified links may point to unowned/sensitive legacy records.
  // A future system producer must supply a verified source, not an arbitrary URL.
  return row.link == null && payload == null;
}

export async function notify(userId: number, input: NotifyInput, connection: DbOrTx = db): Promise<void> {
  await assertWorkflowMember(input.companyId, userId, connection);
  if (input.channel != null && input.channel !== "inapp") {
    throw new Error("التنبيه الخارجي غير متاح دون موصل خاص بالشركة متحقق الصلاحية");
  }
  const row = { ...input, link: input.link ?? null, payload: input.payload ?? null };
  if (!await canReadNotification(userId, row, connection)) return;
  await connection.insert(notificationInboxTable).values({
    companyId: input.companyId, userId, type: input.type,
    title: input.title, message: input.message, link: row.link,
    payload: row.payload, isRead: false,
  });
}
