import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Row = Record<string, unknown>;
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  return value;
}
export async function captureClosingSettlement(tx: Tx, companyId: number, sessionId: number, closing: Row) {
  const rows = (await tx.execute(sql`SELECT s.opening_cash::text,s.branch_id,s.cashier_user_id,s.pos_station_id,
    coalesce((SELECT jsonb_agg(jsonb_build_array(p.id,p.order_id,p.amount::text,p.method,o.status) ORDER BY p.id)
      FROM pos_order_payments p JOIN pos_orders o ON o.id=p.order_id
      WHERE o.session_id=s.id AND o.company_id=${companyId} AND p.method='cash'),'[]'::jsonb) AS payments,
    coalesce((SELECT jsonb_agg(jsonb_build_array(r.id,r.amount::text,r.status) ORDER BY r.id)
      FROM return_payouts r WHERE r.session_id=s.id AND r.company_id=${companyId}
      AND r.method='cash'),'[]'::jsonb) AS refunds,
    coalesce((SELECT jsonb_agg(jsonb_build_array(e.id,e.amount::text,e.journal_id) ORDER BY e.id)
      FROM pos_cash_expenses e WHERE e.session_id=s.id AND e.company_id=${companyId}),'[]'::jsonb) AS expenses
    FROM pos_sessions s JOIN branches b ON b.id=s.branch_id
    WHERE s.id=${sessionId} AND b.company_id=${companyId}`)).rows;
  const snapshot = canonical({
    format: 1, companyId, sessionId, source: rows[0],
    expected: Number(closing.expected).toFixed(2), counted: Number(closing.counted).toFixed(2),
    difference: Number(closing.difference).toFixed(2), cashierId: Number(closing.created_by),
    cashierReason: closing.reason, reconciliationReason: closing.reconciliation_reason ?? null,
    version: Number(closing.settlement_version ?? 1),
  });
  return { snapshot, revision: createHash("sha256").update(JSON.stringify(snapshot)).digest("hex") };
}
export async function auditClosingDecision(tx: Tx, companyId: number, userId: number, action: string, details: unknown) {
  await tx.execute(sql`INSERT INTO audit_logs(company_id,user_id,user_name,action,entity,details,ip_address,severity)
    VALUES(${companyId},${userId},(SELECT name FROM users WHERE id=${userId}),${action},
      'pos_cash_closing',${JSON.stringify(details)},'server','info')`);
}
