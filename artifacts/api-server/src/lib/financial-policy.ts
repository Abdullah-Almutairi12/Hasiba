import { db, financialLimitsTable } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { isRole } from "../middlewares/require-role";
import type { DbOrTx } from "./journal-posting";

// Prospective built-in defaults, not copies of unknown tenants' old policies.
export const FINANCIAL_DEFAULTS = [
  ["cashier", "pos.discount_pct", 5], ["sales", "pos.discount_pct", 10],
  ["manager", "pos.discount_pct", 20], ["owner", "pos.discount_pct", null],
  ["cashier", "pos.refund_amount", 500], ["manager", "pos.refund_amount", 5000],
  ["owner", "pos.refund_amount", null], ["accountant", "ap.payment_amount", 100000],
  ["manager", "ap.payment_amount", 500000], ["owner", "ap.payment_amount", null],
  ["sales", "sales.credit_note_amount", 1000], ["manager", "sales.credit_note_amount", 20000],
  ["owner", "sales.credit_note_amount", null],
] as const;
export const FINANCIAL_ACTIONS = ["pos.discount_pct", "pos.refund_amount", "ap.payment_amount", "sales.credit_note_amount"] as const;

export async function financialPolicy(companyId: number, role: string, actionKey: string, connection: DbOrTx = db) {
  if (!isRole(role) || !(FINANCIAL_ACTIONS as readonly string[]).includes(actionKey)) {
    return { max: 0, source: "unconfigured", blocked: true };
  }
  const [owned] = await connection.select().from(financialLimitsTable).where(and(
    eq(financialLimitsTable.companyId, companyId), eq(financialLimitsTable.role, role),
    eq(financialLimitsTable.actionKey, actionKey),
  ));
  if (owned) return { max: owned.maxValue == null ? null : Number(owned.maxValue), source: "company", blocked: false };
  // Preserve the existing documented no-cap behavior for known roles/actions
  // without a built-in cap. Route/capability authorization remains mandatory.
  const baseline = FINANCIAL_DEFAULTS.find(x => x[0] === role && x[1] === actionKey)?.[2] ?? null;
  const legacy = await connection.select().from(financialLimitsTable).where(and(
    isNull(financialLimitsTable.companyId), eq(financialLimitsTable.role, role),
    eq(financialLimitsTable.actionKey, actionKey),
  ));
  if (legacy.some(x => (x.maxValue == null ? null : Number(x.maxValue)) !== baseline)) {
    return { max: 0, source: "legacy_requires_review", blocked: true };
  }
  return { max: baseline, source: "baseline", blocked: false };
}
