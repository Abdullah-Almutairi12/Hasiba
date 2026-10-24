import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DbOrTx } from "./journal-posting";
import { FinancialRequestError } from "./financial-transaction";

// These are native document relationships, not browser-controlled table names.
const sources = {
  purchase_order: { table: "purchase_orders", lines: "purchase_order_lines", parent: "po_id" },
  sales_order: { table: "sales_orders", lines: "sales_order_lines", parent: "so_id" },
  journal_entry: { table: "journal_entries", lines: "journal_entry_lines", parent: "entry_id" },
  payment_run: { table: "payment_runs", lines: "payment_run_lines", parent: "run_id" },
  credit_note: { table: "credit_notes", lines: "credit_note_lines", parent: "note_id" },
  credit_note_cancel: { table: "credit_notes", lines: "credit_note_lines", parent: "note_id" },
  leave_request: { table: "leave_requests", lines: null, parent: null },
  expense_claim: { table: "expense_claims", lines: null, parent: null },
  pos_over_limit: { table: "pos_sessions", lines: null, parent: null },
} as const;

function sourceScope(companyId: number, docType: string) {
  if (!Object.hasOwn(sources, docType)) throw new FinancialRequestError("مصدر مراجعة غير مدعوم", 409);
  const source = sources[docType as keyof typeof sources];
  const employeeSource = ["expense_claim", "leave_request"].includes(docType);
  const warehouseSource = ["purchase_order", "sales_order", "credit_note", "credit_note_cancel"].includes(docType);
  const owner = employeeSource
    ? sql`JOIN employees scope ON scope.id=s.employee_id`
    : docType === "pos_over_limit"
      ? sql`JOIN branches scope ON scope.id=s.branch_id`
      : sql``;
  const ownerCompany = ["expense_claim", "pos_over_limit"].includes(docType)
    ? sql`scope.company_id` : sql`s.company_id`;
  const context = employeeSource
    ? sql`jsonb_build_object('company',scope.company_id,'branch',scope.branch_id,'department',scope.department_id)`
    : warehouseSource ? sql`(SELECT jsonb_build_object('company',location.company_id,'branch',location.branch_id)
        FROM warehouses location WHERE location.id=s.warehouse_id AND location.company_id=${companyId} FOR SHARE)`
      : sql`'{}'::jsonb`;
  const nativeScope = employeeSource ? sql`AND scope.company_id=${companyId}`
    : warehouseSource ? sql`AND (s.warehouse_id IS NULL OR EXISTS (
        SELECT 1 FROM warehouses w WHERE w.id=s.warehouse_id AND w.company_id=${companyId}))` : sql``;
  return { source, owner, ownerCompany, nativeScope, context, employeeSource };
}

export async function isApprovalSourceCreator(
  companyId: number, docType: string, recordId: number, userId: number, connection: DbOrTx,
): Promise<boolean> {
  // A till/shift opener is not the creator of every later checkout attempt.
  // POS segregation uses the server-recorded submitting cashier instead.
  if (docType === "pos_over_limit") return false;
  const { source, owner, ownerCompany, nativeScope } = sourceScope(companyId, docType);
  const result = await connection.execute(sql`SELECT to_jsonb(s)->>'created_by' AS creator
    FROM ${sql.identifier(source.table)} s ${owner}
    WHERE s.id=${recordId} AND ${ownerCompany}=${companyId} ${nativeScope}`);
  return result.rows[0]?.creator === String(userId);
}

export async function approvalSourceFingerprint(
  companyId: number, docType: string, recordId: number, connection: DbOrTx,
): Promise<string> {
  const { source, owner, ownerCompany, nativeScope, context, employeeSource } = sourceScope(companyId, docType);
  const employeeLock = employeeSource || docType === "pos_over_limit" ? sql`FOR SHARE OF scope` : sql``;
  const lines = source.lines
    ? sql`(SELECT coalesce(jsonb_agg(approval_material_row_v1(to_jsonb(l)) ORDER BY l.id),'[]'::jsonb)
        FROM ${sql.identifier(source.lines)} l WHERE ${sql.identifier(source.parent)}=s.id)`
    : sql`'[]'::jsonb`;
  // jsonb::text is hashed BEFORE parsing in JS: decimal precision and every
  // material field are retained, including equal-total distributions.
  const result = await connection.execute(sql`
    SELECT jsonb_build_object('header',approval_material_row_v1(to_jsonb(s)),
      'lines',${lines},'owner',${ownerCompany},'context',${context})::text AS facts
    FROM ${sql.identifier(source.table)} s ${owner}
    WHERE s.id=${recordId} AND ${ownerCompany}=${companyId} ${nativeScope} FOR UPDATE OF s ${employeeLock}`);
  const facts = result.rows[0]?.facts;
  if (typeof facts !== "string") throw new FinancialRequestError("المستند غير موجود في نطاق الشركة", 404);
  return createHash("sha256").update(`v1:${companyId}:${docType}:${recordId}:${facts}`).digest("hex");
}

export async function approvalSourceMatches(request: {
  companyId: number | null; docType: string; recordId: number;
  sourceFingerprint: string | null; sourceFingerprintVersion: number | null;
}, connection: DbOrTx): Promise<boolean> {
  if (!request.companyId || request.sourceFingerprintVersion !== 1 || !request.sourceFingerprint) return false;
  return request.sourceFingerprint === await approvalSourceFingerprint(
    request.companyId, request.docType, request.recordId, connection);
}
